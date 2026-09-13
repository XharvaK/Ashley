import type { DatabaseSync } from "node:sqlite";
import { canonicalize } from "./canonical-json.js";
import { fieldDayWhere, type FieldDayWhere } from "./coverage.js";
import { allowlistedRows, pragmaUserVersion, tableColumns, tableExists } from "./sqlite.js";
import { fieldDayWindow } from "./field-day.js";
import type {
  EvidenceExtraction,
  EvidenceProjection,
  FieldDayWindow,
  Identity,
  IdentityExtraction,
  JsonObject,
  SurfaceReport,
  SurfaceTableStatus,
} from "./types.js";

const IDENTITY_TABLES = [
  "capability_contracts",
  "capability_releases",
  "memory_contract_state",
  "memory_evidence_qualification_epochs",
  "recall_qualification_epochs",
  "recall_live_cutovers",
  "continuity_meta",
  "lineage_state",
  "runtime_sessions",
] as const;

function emptySurface(): SurfaceReport {
  return { tables: {}, used: [], failed: [] };
}

function markTable(surface: SurfaceReport, db: DatabaseSync | null, table: string): void {
  if (!db) {
    surface.tables[table] = "schema_surface_absent";
    return;
  }
  surface.tables[table] = tableExists(db, table) ? "present" : "schema_surface_absent";
}

function markDb(surface: SurfaceReport, db: DatabaseSync | null, name: string): void {
  if (db) surface.used.push(name);
  else surface.failed.push({ name, error_class: "source_missing", state: "UNKNOWN" });
}

function mergeSurfaces(...reports: SurfaceReport[]): SurfaceReport {
  const merged = emptySurface();
  for (const report of reports) {
    for (const [table, status] of Object.entries(report.tables)) {
      if (merged.tables[table] === "present" || status === "present") merged.tables[table] = "present";
      else if (merged.tables[table] == null) merged.tables[table] = status;
    }
    merged.used.push(...report.used);
    merged.failed.push(...report.failed);
  }
  merged.used = [...new Set(merged.used)].sort();
  merged.failed.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return merged;
}

function stringValue(value: unknown): string | "UNKNOWN" {
  return typeof value === "string" && value.trim() !== "" ? value : "UNKNOWN";
}

function numberValue(value: unknown): number | "UNKNOWN" {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : "UNKNOWN";
}

function rowValue(row: Record<string, unknown> | undefined, key: string): unknown {
  return row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
}

function cleanRow(row: Record<string, unknown>): JsonObject {
  const output = { ...row };
  delete output.data_classification;
  return output as JsonObject;
}

function sanitizedRows(rows: Array<Record<string, unknown>>): JsonObject[] {
  return rows
    .filter((row) => row.data_classification !== "secret")
    .map(cleanRow)
    .sort((a, b) => {
      const left = canonicalize(a);
      const right = canonicalize(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

function readRows(
  db: DatabaseSync | null,
  surface: SurfaceReport,
  table: string,
  fields: string[],
  options: { orderBy?: string; limit?: number; where?: FieldDayWhere } = {},
): JsonObject[] {
  markTable(surface, db, table);
  if (!db || !tableExists(db, table)) return [];
  try {
    return sanitizedRows(allowlistedRows(db, table, fields, options));
  } catch {
    surface.tables[table] = "query_failed";
    surface.failed.push({ name: table, error_class: "query_failed", state: "UNKNOWN" });
    return [];
  }
}

const LIFECYCLE_ROW_LIMIT = 500;

type RequiredRows = {
  rows: JsonObject[];
  complete: boolean;
};

function readBoundedRows(
  db: DatabaseSync,
  surface: SurfaceReport,
  table: string,
  fields: string[],
  limit: number,
  options: { orderBy?: string; where?: FieldDayWhere } = {},
): RequiredRows {
  try {
    const rawRows = allowlistedRows(db, table, fields, {
      ...options,
      limit: limit + 1,
    });
    const overflow = rawRows.length > limit;
    if (overflow) {
      surface.failed.push({
        name: table,
        error_class: `enumeration_overflow:${table}`,
        state: "UNKNOWN",
      });
    }
    return {
      rows: sanitizedRows(rawRows).slice(0, limit),
      complete: !overflow,
    };
  } catch {
    surface.tables[table] = "query_failed";
    surface.failed.push({ name: table, error_class: "query_failed", state: "UNKNOWN" });
    return { rows: [], complete: false };
  }
}

function readRequiredRows(
  db: DatabaseSync | null,
  surface: SurfaceReport,
  table: string,
  fields: string[],
  requiredFields: readonly string[],
  options: { orderBy?: string; limit?: number; where?: FieldDayWhere } = {},
): RequiredRows {
  markTable(surface, db, table);
  if (!db || !tableExists(db, table)) return { rows: [], complete: false };
  const available = tableColumns(db, table);
  const missing = requiredFields.filter((field) => !available.has(field));
  if (missing.length > 0) {
    surface.tables[table] = "query_failed";
    surface.failed.push({
      name: table,
      error_class: `column_absent:${table}.${missing[0]}`,
      state: "UNKNOWN",
    });
    return { rows: [], complete: false };
  }
  const rows = readBoundedRows(
    db,
    surface,
    table,
    fields,
    options.limit ?? LIFECYCLE_ROW_LIMIT,
    options,
  );
  return {
    rows: rows.rows,
    complete: surface.tables[table] === "present"
      && rows.complete
      && !surface.failed.some((failure) => failure.name === table),
  };
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function integerValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function boundedCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return null;
  return /^[a-z0-9_.:-]+$/iu.test(value) ? value : null;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseStringArray(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : null;
  } catch {
    return null;
  }
}

function countArray(value: unknown): number | "UNKNOWN" {
  const parsed = parseStringArray(value);
  return parsed ? parsed.length : "UNKNOWN";
}

function epochInWindow(value: unknown, window: FieldDayWindow): boolean {
  const number = integerValue(value);
  return number !== null && number >= window.start.getTime() && number < window.end.getTime();
}

function isoInWindow(value: unknown, window: FieldDayWindow): boolean {
  if (typeof value !== "string") return false;
  const number = Date.parse(value);
  return !Number.isNaN(number) && number >= window.start.getTime() && number < window.end.getTime();
}

function rowInEpochWindow(row: JsonObject, fields: readonly string[], window: FieldDayWindow): boolean {
  return fields.some((field) => epochInWindow(row[field], window));
}

function rowInIsoWindow(row: JsonObject, fields: readonly string[], window: FieldDayWindow): boolean {
  return fields.some((field) => isoInWindow(row[field], window));
}

function safeMessageIdCount(value: unknown): number | "UNKNOWN" {
  return countArray(value);
}

type SettlementFacts = {
  speechMode: "none" | "draft" | "UNKNOWN";
  semanticSilence: "explicit" | "not_explicit" | "UNKNOWN";
  speechAuthored: boolean | "UNKNOWN";
  observationCount: number | "UNKNOWN";
  effectCount: number | "UNKNOWN";
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArrayValue(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : null;
}

function settlementFacts(row: JsonObject): SettlementFacts {
  const payload = parseObject(row.payload_json);
  if (!payload) {
    return {
      speechMode: "UNKNOWN",
      semanticSilence: "UNKNOWN",
      speechAuthored: "UNKNOWN",
      observationCount: "UNKNOWN",
      effectCount: "UNKNOWN",
    };
  }
  const speech = objectValue(payload.speech);
  const commitments = objectValue(payload.commitments);
  const operations = objectValue(payload.operations);
  const mode = speech?.mode === "none" || speech?.mode === "draft" ? speech.mode : "UNKNOWN";
  const conversational = stringArrayValue(commitments?.conversational);
  const semanticSilence = mode === "UNKNOWN"
    ? "UNKNOWN"
    : conversational?.includes("silence") === true
      ? "explicit"
      : "not_explicit";
  const observations = stringArrayValue(operations?.observationsConsumed);
  const effects = stringArrayValue(operations?.effectsCompleted);
  return {
    speechMode: mode,
    semanticSilence,
    speechAuthored: mode === "UNKNOWN" ? "UNKNOWN" : mode === "draft",
    observationCount: observations ? observations.length : "UNKNOWN",
    effectCount: effects ? effects.length : "UNKNOWN",
  };
}

function sourceCaptureStatus(db: DatabaseSync | null, reports: readonly RequiredRows[]): "complete" | "partial" | "UNKNOWN" {
  if (!db) return "UNKNOWN";
  return reports.every((report) => report.complete) ? "complete" : "partial";
}

function cycleInWindow(cycle: JsonObject | undefined, window: FieldDayWindow): boolean {
  if (!cycle) return true;
  return rowInEpochWindow(cycle, ["admitted_at_ms", "updated_at_ms"], window);
}

function nullableInteger(value: unknown): number | null {
  return integerValue(value);
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.length <= 256 ? value : null;
}

function safeCountFromJson(value: unknown): number | "UNKNOWN" {
  const parsed = parseStringArray(value);
  return parsed ? parsed.length : "UNKNOWN";
}

function lifecycleEvidence(input: {
  nuclear: DatabaseSync | null;
  cognitiveSidecar: DatabaseSync | null;
  cognitiveObservability: DatabaseSync | null;
  window: FieldDayWindow;
  surfaces: SurfaceReport;
}): JsonObject {
  const sidecarReports = [
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "inbox_events",
      ["id", "conversation_id", "kind", "created_at_ms", "status", "state", "wake_id", "attempt_count", "consumed_at_ms", "next_eligible_at_ms", "terminal_reason", "last_failure_class"],
      ["id", "conversation_id", "kind", "created_at_ms", "status", "state", "terminal_reason", "wake_id"],
      { where: fieldDayWhere("inbox_events", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "wakes",
      ["wake_id", "occurrence_id", "source_kind", "conversation_id", "cycle_id", "state", "terminal_reason", "captured_trigger_generation", "captured_authority_revision", "created_at_ms", "updated_at_ms"],
      ["wake_id", "occurrence_id", "conversation_id", "cycle_id", "state", "terminal_reason", "created_at_ms", "updated_at_ms"],
      { where: fieldDayWhere("wakes", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "cycle_records",
      ["cycle_id", "conversation_id", "generation", "state", "trigger_kind", "trigger_ref", "occupant_id", "authority_epoch", "architecture_epoch", "admitted_at_ms", "updated_at_ms"],
      ["cycle_id", "conversation_id", "generation", "state", "admitted_at_ms", "updated_at_ms"],
      { where: fieldDayWhere("cycle_records", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "settlements",
      ["settlement_id", "cycle_id", "generation", "wake_id", "semantic_pass", "payload_json"],
      ["settlement_id", "cycle_id", "generation", "payload_json"],
      { where: fieldDayWhere("settlements", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "speech_outbox",
      ["outbox_id", "settlement_id", "projection_key", "cycle_id", "generation", "conversation_id", "send_status", "nuclear_reservation_id", "discord_message_ids_json", "suppressed", "origin", "nuclear_finalization_reason"],
      ["outbox_id", "settlement_id", "projection_key", "cycle_id", "generation", "send_status", "nuclear_reservation_id", "discord_message_ids_json"],
      { where: fieldDayWhere("speech_outbox", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "system_notice_outbox",
      ["notice_id", "notice_key", "projection_key", "cycle_id", "conversation_id", "send_status", "nuclear_reservation_id", "discord_message_id", "origin"],
      ["notice_id", "cycle_id", "conversation_id", "send_status", "nuclear_reservation_id", "discord_message_id"],
      { where: fieldDayWhere("system_notice_outbox", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "conversation_evidence_log",
      ["row_id", "lineage_id", "version", "conversation_id", "role", "created_at_ms", "discord_message_ids_json", "reservation_id", "producing_cycle_id", "content_hash", "source_status", "data_classification", "secret_omitted", "delivered"],
      ["row_id", "lineage_id", "version", "conversation_id", "role", "created_at_ms", "discord_message_ids_json", "reservation_id", "producing_cycle_id", "content_hash", "source_status", "secret_omitted", "delivered"],
      { where: fieldDayWhere("conversation_evidence_log", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "observations",
      ["observation_id", "cycle_id", "generation", "derived", "replay_safe", "modality", "provenance", "data_classification", "secret_omitted", "created_at_ms"],
      ["observation_id", "cycle_id", "generation", "derived", "replay_safe", "modality", "provenance", "created_at_ms"],
      { where: fieldDayWhere("observations", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "periodic_cognition_schedule",
      ["id", "authority_epoch", "next_eligible_at_ms", "pending_occurrence_id", "pending_wake_id", "pending_due_at_ms", "pending_expires_at_ms", "updated_at_ms"],
      ["id", "authority_epoch", "next_eligible_at_ms", "updated_at_ms"],
      { where: fieldDayWhere("periodic_cognition_schedule", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "periodic_cognition_occurrence_receipts",
      ["schedule_occurrence_id", "disposition", "wake_id", "authority_epoch", "eligible_at_ms", "closed_at_ms"],
      ["schedule_occurrence_id", "disposition", "wake_id", "authority_epoch", "eligible_at_ms", "closed_at_ms"],
      { where: fieldDayWhere("periodic_cognition_occurrence_receipts", input.window) },
    ),
    readRequiredRows(
      input.cognitiveSidecar,
      input.surfaces,
      "causal_ledger",
      ["id", "cycle_id", "generation", "thought_unavailable"],
      ["id", "cycle_id", "generation", "thought_unavailable"],
      { where: fieldDayWhere("causal_ledger", input.window) },
    ),
  ];
  const [inboxReport, wakeReport, cycleReport, settlementReport, speechReport, noticeReport, evidenceReport, observationReport, scheduleReport, occurrenceReport, causalReport] = sidecarReports;
  const cycles = cycleReport.rows;
  const cycleById = new Map(cycles.map((row) => [String(row.cycle_id), row]));
  const wakes = wakeReport.rows;
  const wakeById = new Map(wakes.map((row) => [String(row.wake_id), row]));
  const settlements = settlementReport.rows;
  const factsBySettlement = new Map(settlements.map((row) => [String(row.settlement_id), settlementFacts(row)]));
  const speeches = speechReport.rows;
  const speechBySettlement = new Map(speeches.map((row) => [String(row.settlement_id), row]));

  const nuclearReports = [
    readRequiredRows(
      input.nuclear,
      input.surfaces,
      "delivery_reservations",
      ["id", "owner_id", "channel", "thread_id", "trigger", "delivery_lane", "state", "error_category", "finalization_reason", "created_at", "finalized_at", "cognitive_v021_projection_key"],
      ["id", "state", "created_at", "finalized_at"],
      { where: fieldDayWhere("delivery_reservations", input.window) },
    ),
    readRequiredRows(
      input.nuclear,
      input.surfaces,
      "delivery_bubbles",
      ["id", "reservation_id", "ordinal", "discord_message_id", "sent_at"],
      ["reservation_id", "ordinal", "discord_message_id", "sent_at"],
      { where: fieldDayWhere("delivery_bubbles", input.window) },
    ),
  ];
  const [reservationReport, bubbleReport] = nuclearReports;
  const reservations = reservationReport.rows;
  const bubbles = bubbleReport.rows;
  const bubblesByReservation = new Map<number, JsonObject[]>();
  for (const bubble of bubbles) {
    const reservationId = nullableInteger(bubble.reservation_id);
    if (reservationId === null) continue;
    const current = bubblesByReservation.get(reservationId) ?? [];
    current.push(bubble);
    bubblesByReservation.set(reservationId, current);
  }

  const observationRows = observationReport.rows;
  const observationsByCycle = new Map<string, number>();
  for (const observation of observationRows) {
    const cycleId = nullableString(observation.cycle_id);
    if (cycleId) observationsByCycle.set(cycleId, (observationsByCycle.get(cycleId) ?? 0) + 1);
  }

  const evidenceRows = evidenceReport.rows;
  const evidenceByReservation = new Map<number, JsonObject[]>();
  for (const row of evidenceRows) {
    const reservationId = nullableInteger(row.reservation_id);
    if (reservationId === null) continue;
    const current = evidenceByReservation.get(reservationId) ?? [];
    current.push(row);
    evidenceByReservation.set(reservationId, current);
  }

  const projectedEvidence = evidenceRows
    .filter((row) => rowInEpochWindow(row, ["created_at_ms"], input.window))
    .map((row) => jsonObject({
      row_id: nullableString(row.row_id),
      lineage_id: nullableString(row.lineage_id),
      version: nullableInteger(row.version),
      conversation_id: nullableString(row.conversation_id),
      role: nullableString(row.role),
      created_at_ms: nullableInteger(row.created_at_ms),
      discord_message_count: safeMessageIdCount(row.discord_message_ids_json),
      reservation_id: nullableInteger(row.reservation_id),
      producing_cycle_id: nullableString(row.producing_cycle_id),
      content_hash: safeString(row.content_hash),
      source_status: safeString(row.source_status),
      secret_omitted: booleanValue(row.secret_omitted),
      delivered: booleanValue(row.delivered),
    }));

  const publications: JsonObject[] = [];
  const publishedSettlementIds = new Set<string>();
  for (const settlement of settlements) {
    const settlementId = nullableString(settlement.settlement_id);
    if (!settlementId) continue;
    const cycle = cycleById.get(String(settlement.cycle_id));
    if (!cycleInWindow(cycle, input.window)) continue;
    const facts = factsBySettlement.get(settlementId)!;
    const speech = speechBySettlement.get(settlementId);
    publishedSettlementIds.add(settlementId);
    publications.push(jsonObject({
      settlement_id: settlementId,
      cycle_id: nullableString(settlement.cycle_id),
      generation: nullableInteger(settlement.generation),
      wake_id: nullableString(settlement.wake_id),
      semantic_pass: nullableInteger(settlement.semantic_pass),
      publication_status: "succeeded",
      speech_mode: facts.speechMode,
      speech_authored: facts.speechAuthored,
      semantic_silence: facts.semanticSilence,
      observation_count: facts.observationCount,
      effect_count: facts.effectCount,
      speech_transferred: speech != null,
      speech_outbox_id: speech ? nullableInteger(speech.outbox_id) : null,
      speech_send_status: speech ? safeString(speech.send_status) : null,
    }));
  }
  for (const speech of speeches) {
    const settlementId = nullableString(speech.settlement_id);
    if (!settlementId || publishedSettlementIds.has(settlementId)) continue;
    const cycle = cycleById.get(String(speech.cycle_id));
    if (!cycleInWindow(cycle, input.window)) continue;
    publications.push(jsonObject({
      settlement_id: settlementId,
      cycle_id: nullableString(speech.cycle_id),
      generation: nullableInteger(speech.generation),
      publication_status: "UNKNOWN",
      speech_mode: "UNKNOWN",
      speech_authored: "UNKNOWN",
      semantic_silence: "UNKNOWN",
      speech_transferred: true,
      speech_outbox_id: nullableInteger(speech.outbox_id),
      speech_send_status: safeString(speech.send_status),
    }));
  }

  const delivery: JsonObject[] = [];
  const coveredReservationIds = new Set<number>();
  for (const reservation of reservations) {
    const reservationId = nullableInteger(reservation.id);
    if (reservationId === null) continue;
    const reservationBubbles = bubblesByReservation.get(reservationId) ?? [];
    const speech = speeches.find((row) => nullableInteger(row.nuclear_reservation_id) === reservationId);
    const relevant = rowInIsoWindow(reservation, ["created_at", "finalized_at"], input.window)
      || reservationBubbles.some((bubble) => rowInIsoWindow(bubble, ["sent_at"], input.window))
      || speech != null;
    if (!relevant) continue;
    coveredReservationIds.add(reservationId);
    const confirmed = reservationBubbles.filter((bubble) => nullableString(bubble.discord_message_id) !== null);
    const total = reservationBubbles.length;
    const state = safeString(reservation.state);
    const terminal = state === "cancelled" || state === "aborted" || state === "expired";
    const deliveryStatus = total > 0 && confirmed.length === total
      ? "delivery_confirmed"
      : confirmed.length > 0
        ? "delivery_partial"
        : terminal
          ? "delivery_failed"
          : "delivery_pending";
    const evidence = evidenceByReservation.get(reservationId) ?? [];
    const evidenceIds = new Set<string>();
    for (const row of evidence) {
      for (const id of parseStringArray(row.discord_message_ids_json) ?? []) evidenceIds.add(id);
    }
    const evidenceConvergence = confirmed.length === 0
      ? "not_applicable"
      : confirmed.every((bubble) => evidenceIds.has(String(bubble.discord_message_id)))
        && evidence.some((row) => booleanValue(row.delivered))
        ? "converged"
        : "gap";
    delivery.push(jsonObject({
      reservation_id: reservationId,
      reservation_state: state,
      finalization_reason: safeString(reservation.finalization_reason),
      error_category: safeString(reservation.error_category),
      planned_bubble_count: total,
      confirmed_bubble_count: confirmed.length,
      delivered_speech: confirmed.length > 0,
      delivery_status: deliveryStatus,
      speech_transferred: speech != null,
      speech_outbox_id: speech ? nullableInteger(speech.outbox_id) : null,
      speech_send_status: speech ? safeString(speech.send_status) : null,
      conversation_evidence_row_count: evidence.length,
      conversation_evidence_convergence: evidenceConvergence,
    }));
  }
  for (const speech of speeches) {
    const reservationId = nullableInteger(speech.nuclear_reservation_id);
    if (reservationId !== null && coveredReservationIds.has(reservationId)) continue;
    const cycle = cycleById.get(String(speech.cycle_id));
    if (!cycleInWindow(cycle, input.window)) continue;
    delivery.push(jsonObject({
      reservation_id: reservationId,
      delivery_status: "delivery_unknown",
      delivered_speech: false,
      planned_bubble_count: "UNKNOWN",
      confirmed_bubble_count: "UNKNOWN",
      speech_transferred: true,
      speech_outbox_id: nullableInteger(speech.outbox_id),
      speech_send_status: safeString(speech.send_status),
      conversation_evidence_convergence: "UNKNOWN",
    }));
  }

  const ownerObligations: JsonObject[] = [];
  const infrastructureFailures: JsonObject[] = [];
  for (const event of inboxReport.rows.filter((row) => rowInEpochWindow(row, ["created_at_ms"], input.window))) {
    const kind = nullableString(event.kind);
    if (kind !== "owner_message" && kind !== "owner_utterance") continue;
    const wake = wakeById.get(String(event.wake_id));
    const cycle = wake ? cycleById.get(String(wake.cycle_id)) : undefined;
    const settlement = cycle
      ? settlements.find((row) => String(row.cycle_id) === String(cycle.cycle_id) && String(row.generation) === String(cycle.generation))
      : undefined;
    const settlementId = settlement ? nullableString(settlement.settlement_id) : null;
    const facts = settlementId ? factsBySettlement.get(settlementId) : undefined;
    const speech = settlementId ? speechBySettlement.get(settlementId) : undefined;
    const eventCompleted = event.state === "terminal"
      && event.status === "consumed"
      && event.terminal_reason === "completed";
    const eventSuperseded = event.state === "terminal"
      && event.status === "consumed"
      && event.terminal_reason === "superseded";
    const disposition = eventSuperseded
      ? "superseded"
      : eventCompleted && facts?.speechMode === "draft" && speech
        ? "transferred"
        : eventCompleted && facts?.semanticSilence === "explicit"
          ? "resolved"
          : "unresolved";
    ownerObligations.push(jsonObject({
      owner_event_id: nullableString(event.id),
      conversation_id: nullableString(event.conversation_id),
      wake_id: nullableString(event.wake_id),
      cycle_id: cycle ? nullableString(cycle.cycle_id) : null,
      generation: cycle ? nullableInteger(cycle.generation) : null,
      event_status: safeString(event.status),
      event_state: safeString(event.state),
      disposition,
      settlement_id: settlementId,
      speech_outbox_id: speech ? nullableInteger(speech.outbox_id) : null,
      failure_class: boundedCode(event.last_failure_class),
    }));
    const failureClass = boundedCode(event.last_failure_class);
    if (failureClass) {
      infrastructureFailures.push(jsonObject({
        source: "inbox_events",
        failure_kind: "infrastructure_failure",
        event_id: nullableString(event.id),
        failure_class: failureClass,
      }));
    }
  }

  const diagnosticsReport = [
    readRequiredRows(
      input.cognitiveObservability,
      input.surfaces,
      "allocation_receipts",
      ["request_id", "cycle_id", "generation", "policy_id", "policy_version", "quota_bucket", "estimated_input_tokens", "estimated_output_tokens", "total_demand_tokens", "headroom_tokens", "compression", "required_overflow", "semantic_projection_hash", "dispatch_messages_hash", "created_at_ms"],
      ["request_id", "cycle_id", "generation", "created_at_ms"],
      { where: fieldDayWhere("allocation_receipts", input.window) },
    ),
    readRequiredRows(
      input.cognitiveObservability,
      input.surfaces,
      "thought_dispatch_diagnostics",
      ["id", "cycle_id", "generation", "request_id", "pass", "code", "stage", "dispatch_truth", "primary_dispatch_truth", "secondary_dispatch_truth", "publication_reason", "attempt_ordinal", "finish_reason", "error_code", "created_at_ms"],
      ["id", "cycle_id", "generation", "request_id", "pass", "code", "stage", "dispatch_truth", "created_at_ms"],
      { where: fieldDayWhere("thought_dispatch_diagnostics", input.window) },
    ),
  ];
  const [allocationReport, diagnosticReport] = diagnosticsReport;
  const allocations = allocationReport.rows
    .filter((row) => rowInEpochWindow(row, ["created_at_ms"], input.window))
    .map((row) => jsonObject({
      request_id: nullableString(row.request_id),
      cycle_id: nullableString(row.cycle_id),
      generation: nullableInteger(row.generation),
      policy_id: boundedCode(row.policy_id),
      policy_version: nullableInteger(row.policy_version),
      quota_bucket: boundedCode(row.quota_bucket),
      estimated_input_tokens: nullableInteger(row.estimated_input_tokens),
      estimated_output_tokens: nullableInteger(row.estimated_output_tokens),
      total_demand_tokens: nullableInteger(row.total_demand_tokens),
      headroom_tokens: nullableInteger(row.headroom_tokens),
      compressed: booleanValue(row.compression),
      required_overflow: booleanValue(row.required_overflow),
      semantic_projection_hash: safeString(row.semantic_projection_hash),
      dispatch_messages_hash: safeString(row.dispatch_messages_hash),
      created_at_ms: nullableInteger(row.created_at_ms),
    }));
  const diagnostics = diagnosticReport.rows
    .filter((row) => rowInEpochWindow(row, ["created_at_ms"], input.window))
    .map((row) => {
      const code = boundedCode(row.code);
      const failureKind = code === "publication_rejected" ? "publication_rejection" : "infrastructure_failure";
      const projection = jsonObject({
        source: "thought_dispatch_diagnostics",
        failure_kind: failureKind,
        diagnostic_id: nullableInteger(row.id),
        cycle_id: nullableString(row.cycle_id),
        generation: nullableInteger(row.generation),
        request_id: nullableString(row.request_id),
        pass: nullableInteger(row.pass),
        code,
        stage: boundedCode(row.stage),
        dispatch_truth: boundedCode(row.dispatch_truth),
        primary_dispatch_truth: boundedCode(row.primary_dispatch_truth),
        secondary_dispatch_truth: boundedCode(row.secondary_dispatch_truth),
        publication_reason: boundedCode(row.publication_reason),
        attempt_ordinal: nullableInteger(row.attempt_ordinal),
        finish_reason: boundedCode(row.finish_reason),
        error_code: boundedCode(row.error_code),
        created_at_ms: nullableInteger(row.created_at_ms),
      });
      infrastructureFailures.push(projection);
      return projection;
    });

  for (const row of causalReport.rows
    .filter((candidate) => rowInEpochWindow(cycleById.get(String(candidate.cycle_id)) ?? candidate, ["updated_at_ms", "admitted_at_ms"], input.window))) {
    if (!booleanValue(row.thought_unavailable)) continue;
    infrastructureFailures.push(jsonObject({
      source: "causal_ledger",
      failure_kind: "infrastructure_failure",
      ledger_id: nullableInteger(row.id),
      cycle_id: nullableString(row.cycle_id),
      generation: nullableInteger(row.generation),
      thought_unavailable: true,
    }));
  }

  const systemNotices = noticeReport.rows
    .filter((row) => cycleInWindow(cycleById.get(String(row.cycle_id)), input.window))
    .map((row) => jsonObject({
      notice_id: nullableInteger(row.notice_id),
      cycle_id: nullableString(row.cycle_id),
      conversation_id: nullableString(row.conversation_id),
      send_status: safeString(row.send_status),
      nuclear_reservation_id: nullableInteger(row.nuclear_reservation_id),
      discord_message_present: nullableString(row.discord_message_id) !== null,
      origin: boundedCode(row.origin),
    }));

  const periodic: JsonObject[] = [];
  const schedule = scheduleReport.rows[0];
  if (schedule) {
    periodic.push(jsonObject({
      record_type: "schedule",
      schedule_id: nullableString(schedule.id),
      authority_epoch: nullableInteger(schedule.authority_epoch),
      next_eligible_at_ms: nullableInteger(schedule.next_eligible_at_ms),
      pending_occurrence_id: nullableString(schedule.pending_occurrence_id),
      pending_wake_id: nullableString(schedule.pending_wake_id),
      pending_due_at_ms: nullableInteger(schedule.pending_due_at_ms),
      pending_expires_at_ms: nullableInteger(schedule.pending_expires_at_ms),
      updated_at_ms: nullableInteger(schedule.updated_at_ms),
    }));
  }
  for (const receipt of occurrenceReport.rows
    .filter((row) => epochInWindow(row.eligible_at_ms, input.window) || epochInWindow(row.closed_at_ms, input.window))) {
    const wake = nullableString(receipt.wake_id) ? wakeById.get(String(receipt.wake_id)) : undefined;
    const cycle = wake ? cycleById.get(String(wake.cycle_id)) : undefined;
    const settlement = cycle
      ? settlements.find((row) => String(row.cycle_id) === String(cycle.cycle_id) && String(row.generation) === String(cycle.generation))
      : undefined;
    const facts = settlement ? factsBySettlement.get(String(settlement.settlement_id)) : undefined;
    periodic.push(jsonObject({
      record_type: "occurrence",
      occurrence_id: nullableString(receipt.schedule_occurrence_id),
      disposition: boundedCode(receipt.disposition),
      no_action: nullableString(receipt.disposition) === "skipped_empty",
      wake_id: nullableString(receipt.wake_id),
      cycle_id: cycle ? nullableString(cycle.cycle_id) : null,
      generation: cycle ? nullableInteger(cycle.generation) : null,
      authority_epoch: nullableInteger(receipt.authority_epoch),
      eligible_at_ms: nullableInteger(receipt.eligible_at_ms),
      closed_at_ms: nullableInteger(receipt.closed_at_ms),
      observation_count: cycle ? observationsByCycle.get(String(cycle.cycle_id)) ?? 0 : 0,
      publication_status: settlement ? "succeeded" : "UNKNOWN",
      semantic_silence: facts?.semanticSilence ?? "UNKNOWN",
      detail_present: Object.prototype.hasOwnProperty.call(receipt, "detail") && receipt.detail != null,
    }));
  }

  const sidecarCapture = sourceCaptureStatus(input.cognitiveSidecar, sidecarReports);
  const nuclearCapture = sourceCaptureStatus(input.nuclear, nuclearReports);
  const observabilityCapture = sourceCaptureStatus(input.cognitiveObservability, diagnosticsReport);
  return jsonObject({
    source_capture: {
      nuclear: nuclearCapture,
      cognitive_sidecar: sidecarCapture,
      cognitive_observability: observabilityCapture,
    },
    publications,
    delivery,
    conversation_evidence: projectedEvidence,
    owner_obligations: ownerObligations,
    infrastructure_failures: infrastructureFailures,
    system_notices: systemNotices,
    allocations,
    diagnostics,
    periodic,
  });
}

function inWindow(value: unknown, window: FieldDayWindow): boolean {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && milliseconds >= window.start.getTime() && milliseconds < window.end.getTime();
}

function rowsInWindow(
  db: DatabaseSync | null,
  surface: SurfaceReport,
  table: string,
  fields: string[],
  window: FieldDayWindow,
): JsonObject[] {
  const rows = readRows(db, surface, table, fields);
  return rows.filter((row) => inWindow(row.created_at ?? row.occurred_at ?? row.started_at, window));
}

function latestReleaseRows(db: DatabaseSync | null, surface: SurfaceReport): JsonObject[] {
  const rows = readRows(
    db,
    surface,
    "capability_releases",
    [
      "capability",
      "release_id",
      "state",
      "eval_seed_count",
      "qualified_at",
      "promoted_at",
      "rolled_back_at",
      "failure_kind",
      "updated_at",
      "contract_id",
      "build_identity",
      "model_epoch",
      "data_classification",
    ],
    { orderBy: "updated_at" },
  );
  return rows.sort((a, b) => {
    const left = String(a.updated_at ?? "");
    const right = String(b.updated_at ?? "");
    return right < left ? -1 : right > left ? 1 : 0;
  });
}

function selectCurrent(rows: JsonObject[], capability?: string): JsonObject | undefined {
  return rows.find((row) => capability == null || row.capability === capability);
}

function continuityLineage(
  continuity: DatabaseSync | null,
  surface: SurfaceReport,
): { row: JsonObject | null | "UNKNOWN"; build: string | "UNKNOWN"; lineage: string | "UNKNOWN"; sourceSha: string | "UNKNOWN" } {
  const rows = readRows(
    continuity,
    surface,
    "lineage_state",
    ["lineage_id", "nuclear_schema_version", "build_identity", "updated_at", "runtime_source_sha", "source_sha", "cognition_mode", "data_classification"],
    { orderBy: "updated_at", limit: 1 },
  );
  let row = rows[0];
  if (!row && continuity && tableExists(continuity, "runtime_sessions")) {
    const sessionRows = readRows(
      continuity,
      surface,
      "runtime_sessions",
      ["lineage_id", "build_identity", "last_seen_at", "runtime_source_sha", "source_sha", "cognition_mode", "data_classification"],
      { orderBy: "last_seen_at", limit: 1 },
    );
    row = sessionRows[0];
  }
  return {
    row: row ?? (continuity && tableExists(continuity, "lineage_state") ? null : "UNKNOWN"),
    build: stringValue(rowValue(row, "build_identity")),
    lineage: stringValue(rowValue(row, "lineage_id")),
    sourceSha: stringValue(rowValue(row, "runtime_source_sha") ?? rowValue(row, "source_sha")),
  };
}

function activeContractId(nuclear: DatabaseSync | null, surface: SurfaceReport, releases: JsonObject[]): string | "UNKNOWN" {
  const rows = readRows(
    nuclear,
    surface,
    "capability_contracts",
    ["contract_id", "active", "created_at", "data_classification"],
    { orderBy: "created_at" },
  );
  const active = rows.find((row) => row.active === 1 || row.active === true);
  if (typeof active?.contract_id === "string" && active.contract_id !== "") return active.contract_id;
  const releaseContract = releases.find((row) => typeof row.contract_id === "string" && row.contract_id !== "");
  return typeof releaseContract?.contract_id === "string" ? releaseContract.contract_id : "UNKNOWN";
}

function currentEpoch(
  db: DatabaseSync | null,
  surface: SurfaceReport,
  table: string,
  fields: string[],
): { id: string | "UNKNOWN"; rows: JsonObject[] } {
  const rows = readRows(db, surface, table, fields, { orderBy: "started_at" });
  if (!db || !tableExists(db, table)) return { id: "UNKNOWN", rows };
  const current = rows.find((row) => row.status === "current");
  return {
    id: typeof current?.epoch_id === "string" ? current.epoch_id : "no_current_epoch",
    rows,
  };
}

function readMemoryContract(
  nuclear: DatabaseSync | null,
  surface: SurfaceReport,
): { row: JsonObject | null | "UNKNOWN"; currentness: string | "UNKNOWN"; c1Version: number | "UNKNOWN"; cutover: string | null | "UNKNOWN" } {
  const rows = readRows(
    nuclear,
    surface,
    "memory_contract_state",
    ["id", "c1_contract_version", "currentness_authority", "cutover_at", "applied_c1_authority_exists", "correction_seq", "data_classification"],
    { limit: 1 },
  );
  if (!nuclear || !tableExists(nuclear, "memory_contract_state")) {
    return { row: "UNKNOWN", currentness: "UNKNOWN", c1Version: "UNKNOWN", cutover: "UNKNOWN" };
  }
  const row = rows[0] ?? null;
  return {
    row,
    currentness: stringValue(rowValue(row, "currentness_authority")),
    c1Version: numberValue(rowValue(row, "c1_contract_version")),
    cutover: row && row.cutover_at != null ? stringValue(row.cutover_at) : null,
  };
}

function readRecallCutover(
  nuclear: DatabaseSync | null,
  surface: SurfaceReport,
  releaseId: string | "UNKNOWN",
): { present: true | "recall_cutoff_missing" | "UNKNOWN"; messageId: number | string | null | "UNKNOWN"; rows: JsonObject[] } {
  const rows = readRows(
    nuclear,
    surface,
    "recall_live_cutovers",
    ["owner_id", "capability", "release_id", "cutoff_message_id", "authorized_by", "contract_id", "build_identity", "created_at", "data_classification"],
    { orderBy: "created_at" },
  );
  if (!nuclear || !tableExists(nuclear, "recall_live_cutovers")) {
    return { present: "UNKNOWN", messageId: "UNKNOWN", rows };
  }
  const matches = rows
    .filter((row) => row.capability === "recall" && (releaseId === "UNKNOWN" || row.release_id === releaseId))
    .sort((a, b) => {
      const left = String(a.created_at ?? "");
      const right = String(b.created_at ?? "");
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const row = matches[matches.length - 1];
  if (!row) return { present: "recall_cutoff_missing", messageId: null, rows: [] };
  const id = row.cutoff_message_id;
  return {
    present: true,
    messageId: typeof id === "number" || typeof id === "string" ? id : "UNKNOWN",
    rows: [row],
  };
}

function cognitionMode(continuity: DatabaseSync | null, surface: SurfaceReport): string | "UNKNOWN" {
  const rows = readRows(continuity, surface, "runtime_sessions", ["cognition_mode", "last_seen_at", "data_classification"], { orderBy: "last_seen_at", limit: 1 });
  return stringValue(rowValue(rows[0], "cognition_mode"));
}

export function extractIdentity(input: {
  nuclear: DatabaseSync | null;
  continuity: DatabaseSync | null;
  checkoutSha: string | "UNKNOWN";
  fieldDay: string;
}): IdentityExtraction {
  const surfaces = emptySurface();
  markDb(surfaces, input.nuclear, "nuclear_snapshot");
  markDb(surfaces, input.continuity, "continuity_snapshot");
  for (const table of IDENTITY_TABLES) {
    markTable(surfaces, input.nuclear, table);
  }
  const nuclearSchemaVersion = input.nuclear ? pragmaUserVersion(input.nuclear) : "UNKNOWN";
  const continuitySchemaVersion = input.continuity ? pragmaUserVersion(input.continuity) : "UNKNOWN";
  const releases = latestReleaseRows(input.nuclear, surfaces);
  const lineage = continuityLineage(input.continuity, surfaces);
  const contractId = activeContractId(input.nuclear, surfaces, releases);
  const memoryContract = readMemoryContract(input.nuclear, surfaces);
  const c1 = currentEpoch(input.nuclear, surfaces, "memory_evidence_qualification_epochs", ["epoch_id", "status", "contract_id", "started_build_identity", "started_at", "retired_at", "eval_seed_count", "qualified_at", "sealed_at", "blocked_at", "block_code", "data_classification"]);
  const recall = currentEpoch(input.nuclear, surfaces, "recall_qualification_epochs", ["epoch_id", "status", "contract_id", "started_build_identity", "started_at", "retired_at", "eval_seed_count", "qualified_at", "model_epoch", "data_classification"]);
  const recallRelease = selectCurrent(releases, "recall");
  const cutoff = readRecallCutover(input.nuclear, surfaces, stringValue(rowValue(recallRelease, "release_id")));
  const identity: Identity = {
    checkoutSha: input.checkoutSha,
    runtimeBuildIdentity: lineage.build,
    runtimeSourceSha: lineage.sourceSha,
    buildIdentity: lineage.build,
    contractId,
    nuclearSchemaVersion,
    continuitySchemaVersion,
    lineageId: lineage.lineage,
    memoryEvidenceState: stringValue(rowValue(selectCurrent(releases, "memory_evidence"), "state")),
    recallState: stringValue(rowValue(recallRelease, "state")),
    currentnessAuthority: memoryContract.currentness,
    c1ContractVersion: memoryContract.c1Version,
    cutoverAt: memoryContract.cutover,
    c1EpochId: c1.id,
    recallEpochId: recall.id,
    recallCutoffPresent: cutoff.present,
    recallCutoffMessageId: cutoff.messageId,
    cognitionMode: cognitionMode(input.continuity, surfaces),
    fieldDay: input.fieldDay,
  };
  return { identity, surfaces };
}

function asWindow(input: FieldDayWindow | string): FieldDayWindow {
  return typeof input === "string" ? fieldDayWindow(input) : input;
}

export function extractEvidence(input: {
  nuclear: DatabaseSync | null;
  continuity: DatabaseSync | null;
  cognitiveSidecar?: DatabaseSync | null;
  cognitiveObservability?: DatabaseSync | null;
  window: FieldDayWindow | string;
}): EvidenceExtraction {
  const window = asWindow(input.window);
  const surfaces = emptySurface();
  markDb(surfaces, input.nuclear, "nuclear_snapshot");
  markDb(surfaces, input.continuity, "continuity_snapshot");
  const releases = latestReleaseRows(input.nuclear, surfaces);
  const contract = readMemoryContract(input.nuclear, surfaces);
  const c1Epochs = readRows(input.nuclear, surfaces, "memory_evidence_qualification_epochs", ["epoch_id", "status", "predecessor_epoch_id", "contract_id", "started_build_identity", "started_at", "retired_at", "eval_seed_count", "qualified_at", "sealed_at", "sealed_release_id", "blocked_at", "block_code", "block_source_key", "data_classification"]);
  const recallEpochs = readRows(input.nuclear, surfaces, "recall_qualification_epochs", ["epoch_id", "status", "predecessor_epoch_id", "contract_id", "started_build_identity", "started_at", "retired_at", "eval_seed_count", "qualified_at", "model_epoch", "data_classification"]);
  const recallRelease = selectCurrent(releases, "recall");
  const cutoff = readRecallCutover(input.nuclear, surfaces, stringValue(rowValue(recallRelease, "release_id")));
  const evidence: EvidenceProjection = {
    decision_log: rowsInWindow(input.nuclear, surfaces, "decision_log", ["id", "channel", "trigger", "decision_kind", "created_at", "completion", "uncertainty", "urgency", "thought_source", "data_classification"], window),
    capability_releases: releases,
    capability_events: rowsInWindow(input.nuclear, surfaces, "capability_events", ["id", "capability", "release_id", "kind", "source_key", "occurred_at", "contract_id", "build_identity", "model_epoch", "data_classification"], window),
    memory_contract_state: contract.row,
    memory_corrections: rowsInWindow(input.nuclear, surfaces, "memory_corrections", ["correction_id", "owner_id", "lifecycle_status", "created_at", "updated_at", "data_classification"], window),
    memory_correction_targets: rowsInWindow(input.nuclear, surfaces, "memory_correction_targets", ["correction_id", "target_type", "target_id", "action", "created_at", "data_classification"], window),
    memory_deny_barriers: rowsInWindow(input.nuclear, surfaces, "memory_deny_barriers", ["barrier_id", "correction_id", "lifecycle_status", "created_at", "released_at", "data_classification"], window),
    memory_deny_barrier_members: rowsInWindow(input.nuclear, surfaces, "memory_deny_barrier_members", ["barrier_id", "entity_type", "entity_id", "created_at", "data_classification"], window),
    memory_correction_receipts: rowsInWindow(input.nuclear, surfaces, "memory_correction_receipts", ["receipt_id", "correction_id", "lifecycle_status", "created_at", "data_classification"], window),
    memory_correction_outcomes: rowsInWindow(input.nuclear, surfaces, "memory_correction_outcomes", ["outcome_id", "correction_id", "lifecycle_status", "created_at", "data_classification"], window),
    memory_reconciliation_requests: rowsInWindow(input.nuclear, surfaces, "memory_reconciliation_requests", ["request_id", "correction_id", "lifecycle_status", "created_at", "data_classification"], window),
    memory_evidence_qualification_epochs: c1Epochs,
    memory_evidence_qualification_events: rowsInWindow(input.nuclear, surfaces, "memory_evidence_qualification_events", ["epoch_id", "kind", "source_key", "decision_class", "qualifies", "trigger", "source_count", "occurred_at", "contract_id", "build_identity", "data_classification"], window),
    recall_qualification_epochs: recallEpochs,
    recall_qualification_events: rowsInWindow(input.nuclear, surfaces, "recall_qualification_events", ["id", "epoch_id", "kind", "source_key", "occurred_at", "build_identity", "model_epoch", "data_classification"], window),
    recall_live_cutovers: cutoff.rows,
    continuity_lineage: continuityLineage(input.continuity, surfaces).row,
    continuity_sessions: rowsInWindow(input.continuity, surfaces, "runtime_sessions", ["session_id", "started_at", "last_seen_at", "clean_shutdown_at", "build_identity", "nuclear_schema_version", "lineage_id", "data_classification"], window),
    cognitive_lifecycle: lifecycleEvidence({
      nuclear: input.nuclear,
      cognitiveSidecar: input.cognitiveSidecar ?? null,
      cognitiveObservability: input.cognitiveObservability ?? null,
      window,
      surfaces,
    }),
  };
  return { evidence, surfaces };
}

export function mergeEvidenceSurfaces(...reports: SurfaceReport[]): SurfaceReport {
  return mergeSurfaces(...reports);
}

export function surfaceStatusForTable(status: SurfaceTableStatus | undefined): SurfaceTableStatus | "schema_surface_absent" {
  return status ?? "schema_surface_absent";
}
