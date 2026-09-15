import type { DatabaseSync } from "node:sqlite";
import { fieldDayWhere } from "./coverage.js";
import { allowlistedRows, tableColumns, tableExists } from "./sqlite.js";
import { isSecretClassification, redactObserverText } from "./privacy.js";
import type {
  ExternalIngressProjection,
  FieldDayWindow,
  JsonObject,
  TranscriptGap,
  TranscriptMessage,
  TranscriptSession,
} from "./types.js";

const MODERN_ROW_LIMIT = 500;

type Row = Record<string, unknown>;

type ReadResult = {
  rows: Row[];
  available: boolean;
  complete: boolean;
  error: string | null;
};

type EvidenceRow = {
  rowId: string;
  lineageId: string | null;
  conversationId: string;
  role: "owner" | "ashley" | "external_dialog";
  text: string;
  timestamp: string;
  milliseconds: number;
  discordMessageIds: string[];
  reservationId: number | null;
  producingCycleId: string | null;
  version: number | null;
  sourceStatus: string | null;
  speakerPrincipalId: string | null;
  speakerKind: "owner" | "external_human" | "external_bot" | "ashley" | "UNKNOWN";
  location: JsonObject | null;
  audienceAtCapture: "dm" | "room" | "UNKNOWN";
  provenance: JsonObject | null;
  attachmentCount: number | null;
  delivered: boolean;
};

type AttentionRow = {
  id: number | string;
  purpose: string;
  modelAlias: string;
  resolvedModelId: string | null;
  provider: string | null;
  route: string | null;
  state: string | null;
  outcome: string | null;
  errorClass: string | null;
  queuedAt: string | null;
  dispatchStartedAt: string | null;
  endedAt: string | null;
  inputTokens: number | "UNKNOWN";
  outputTokens: number | "UNKNOWN";
  reservationId: number | null;
  thoughtInvocationId: string | null;
  thoughtCycleId: string | null;
  thoughtGeneration: number | null;
  dispatchSequence: number | null;
};

type BubbleRow = {
  id: number | string;
  reservationId: number | null;
  ordinal: number | null;
  discordMessageId: string | null;
  text: string | null;
  sentAt: string | null;
};

export type ModernConversationCapture = {
  sessions: TranscriptSession[];
  externalIngress: ExternalIngressProjection[];
  turns: JsonObject[];
  expressionAttempts: JsonObject[];
  modernGaps: TranscriptGap[];
  modernActivityCount: number;
  modernMessageCount: number;
  sourceAvailable: boolean;
  sourceAttempted: boolean;
};

function jsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function numberOrUnknown(value: unknown): number | "UNKNOWN" {
  return numberValue(value) ?? "UNKNOWN";
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [];
  } catch {
    return [];
  }
}

function parseTimestamp(value: unknown): { iso: string; milliseconds: number } | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) return null;
  return { iso: new Date(milliseconds).toISOString(), milliseconds };
}

function safeText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function boundedText(value: unknown): string | null {
  return typeof value === "string" && value.length <= 100_000 ? value : null;
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

function parseArrayLength(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function externalLocation(value: unknown): JsonObject | null {
  const parsed = parseObject(value);
  const kind = stringValue(parsed?.kind);
  if (kind === "external_dm") {
    const principalId = stringValue(parsed?.principalId);
    const channelId = stringValue(parsed?.channelId);
    return principalId && channelId
      ? jsonObject({ kind, principalId, channelId })
      : null;
  }
  if (kind === "room") {
    const guildId = stringValue(parsed?.guildId);
    const channelId = stringValue(parsed?.channelId);
    return guildId && channelId
      ? jsonObject({ kind, guildId, channelId })
      : null;
  }
  return null;
}

function externalProvenance(value: unknown): JsonObject | null {
  const parsed = parseObject(value);
  const source = stringValue(parsed?.source);
  if (!source) return null;
  const receivedAtMs = numberValue(parsed?.receivedAtMs);
  return jsonObject({
    source,
    ...(receivedAtMs === null ? {} : { receivedAtMs }),
  });
}

function inboxPayload(row: Row): Record<string, unknown> | null {
  return parseObject(row.payload_json);
}

function inboxEvidenceRowId(row: Row): string | null {
  const payload = inboxPayload(row);
  return stringValue(payload?.evidenceRowId) ?? stringValue(payload?.evidence_row_id);
}

function inboxCaptureRef(row: Row): string | null {
  return stringValue(inboxPayload(row)?.captureRef) ?? stringValue(inboxPayload(row)?.capture_ref);
}

function inboxDiscordMessageId(row: Row): string | null {
  return stringValue(inboxPayload(row)?.discordMessageId) ?? stringValue(inboxPayload(row)?.discord_message_id);
}

function inboxReason(row: Row): string | null {
  return stringValue(row.quarantine_reason)
    ?? stringValue(row.terminal_reason)
    ?? stringValue(inboxPayload(row)?.reason);
}

function markerState(kind: unknown): "capture_only" | "external_eligible_pending" | "quarantined_external" | null {
  if (kind === "quarantined_external") return "quarantined_external";
  if (kind === "external_eligible_pending") return "external_eligible_pending";
  if (kind === "external_captured") return "capture_only";
  return null;
}

type ExternalMarker = {
  state: "capture_only" | "external_eligible_pending" | "quarantined_external";
  captureRef: string | null;
  discordMessageId: string | null;
  quarantineReason: string | null;
  captureStatus: string | null;
  captureState: string | null;
  admissionStatus: string | null;
  admissionMarkerState: string | null;
};

function readWindowRows(
  db: DatabaseSync | null,
  table: string,
  fields: string[],
  requiredFields: readonly string[],
  window: FieldDayWindow,
): ReadResult {
  if (!db) return { rows: [], available: false, complete: false, error: "source_unavailable" };
  if (!tableExists(db, table)) {
    return { rows: [], available: false, complete: false, error: `schema_surface_absent:${table}` };
  }
  const available = tableColumns(db, table);
  const missing = requiredFields.find((field) => !available.has(field));
  if (missing) {
    return {
      rows: [],
      available: false,
      complete: false,
      error: `column_absent:${table}.${missing}`,
    };
  }
  try {
    const rows = allowlistedRows(db, table, fields, {
      orderBy: available.has("id") ? "id" : undefined,
      limit: MODERN_ROW_LIMIT + 1,
      where: fieldDayWhere(table, window),
    });
    return {
      rows: rows.slice(0, MODERN_ROW_LIMIT),
      available: true,
      complete: rows.length <= MODERN_ROW_LIMIT,
      error: rows.length > MODERN_ROW_LIMIT ? `enumeration_overflow:${table}` : null,
    };
  } catch (error) {
    return {
      rows: [],
      available: false,
      complete: false,
      error: error instanceof Error ? `query_failed:${table}` : `query_failed:${table}`,
    };
  }
}

function readOptionalWindowRows(
  db: DatabaseSync | null,
  table: string,
  fields: string[],
  requiredFields: readonly string[],
  window: FieldDayWindow,
): ReadResult {
  if (!db || !tableExists(db, table)) {
    return { rows: [], available: false, complete: true, error: null };
  }
  return readWindowRows(db, table, fields, requiredFields, window);
}

function readModernRows(
  db: DatabaseSync | null,
  window: FieldDayWindow,
): {
  evidence: ReadResult;
  inboxEvents: ReadResult;
  cycles: ReadResult;
  thoughtSteps: ReadResult;
  settlements: ReadResult;
  speeches: ReadResult;
} {
  return {
    evidence: readWindowRows(
      db,
      "conversation_evidence_log",
      [
        "row_id", "lineage_id", "conversation_id", "role", "text", "created_at_ms",
        "discord_message_ids_json", "reservation_id", "producing_cycle_id", "version",
        "source_status", "data_classification", "speaker_principal_id", "speaker_kind",
        "location_json", "audience_at_capture", "sent_at_ms", "attachment_refs_json",
        "provenance_json", "delivered",
      ],
      ["row_id", "conversation_id", "role", "created_at_ms"],
      window,
    ),
    inboxEvents: readOptionalWindowRows(
      db,
      "inbox_events",
      [
        "id", "conversation_id", "kind", "payload_json", "created_at_ms", "status", "state",
        "terminal_reason", "quarantine_reason", "wake_id", "envelope_json",
      ],
      ["id", "conversation_id", "kind", "created_at_ms", "status", "state"],
      window,
    ),
    cycles: readWindowRows(
      db,
      "cycle_records",
      ["cycle_id", "conversation_id", "generation", "state", "trigger_kind", "compose_log_ids_json", "disposition", "admitted_at_ms", "updated_at_ms"],
      ["cycle_id", "conversation_id", "generation", "admitted_at_ms", "updated_at_ms"],
      window,
    ),
    thoughtSteps: readWindowRows(
      db,
      "thought_steps",
      ["request_id", "cycle_id", "generation", "pass", "kind", "payload_json", "created_at_ms"],
      ["request_id", "cycle_id", "generation", "pass", "kind", "payload_json", "created_at_ms"],
      window,
    ),
    settlements: readWindowRows(
      db,
      "settlements",
      ["settlement_id", "cycle_id", "generation", "wake_id", "semantic_pass", "payload_json"],
      ["settlement_id", "cycle_id", "generation", "payload_json"],
      window,
    ),
    speeches: readWindowRows(
      db,
      "speech_outbox",
      ["outbox_id", "settlement_id", "projection_key", "cycle_id", "generation", "conversation_id", "licensed_text", "send_status", "nuclear_reservation_id", "discord_message_ids_json", "suppressed", "origin"],
      ["outbox_id", "settlement_id", "cycle_id", "generation", "conversation_id", "licensed_text", "send_status", "nuclear_reservation_id", "discord_message_ids_json"],
      window,
    ),
  };
}

function readAttentionRows(db: DatabaseSync | null, window: FieldDayWindow): ReadResult {
  return readWindowRows(
    db,
    "attention_requests",
    ["id", "purpose", "model_alias", "resolved_model_id", "provider_id", "route_alias", "state", "outcome", "error_class", "queued_at", "dispatch_started_at", "ended_at", "actual_input_tokens", "actual_output_tokens", "delivery_reservation_id", "thought_invocation_id", "thought_cycle_id", "thought_generation", "dispatch_sequence", "actual_provider", "created_at"],
    ["id", "purpose", "model_alias", "state", "outcome", "created_at"],
    window,
  );
}

function readDeliveryRows(db: DatabaseSync | null, window: FieldDayWindow): {
  reservations: ReadResult;
  bubbles: ReadResult;
} {
  return {
    reservations: readWindowRows(
      db,
      "delivery_reservations",
      ["id", "state", "error_category", "finalization_reason", "created_at", "finalized_at", "cognitive_v021_projection_key"],
      ["id", "state", "created_at", "finalized_at"],
      window,
    ),
    bubbles: readWindowRows(
      db,
      "delivery_bubbles",
      ["id", "reservation_id", "ordinal", "text", "discord_message_id", "sent_at"],
      ["id", "reservation_id", "ordinal", "sent_at"],
      window,
    ),
  };
}

function toEvidenceRows(rows: readonly Row[], gaps: TranscriptGap[]): EvidenceRow[] {
  const result: EvidenceRow[] = [];
  for (const row of rows) {
    const role = row.role === "owner" || row.role === "ashley" || row.role === "external_dialog"
      ? row.role
      : null;
    const rowId = stringValue(row.row_id);
    const conversationId = stringValue(row.conversation_id);
    if (!role || !rowId || !conversationId || isSecretClassification(row.data_classification)) continue;
    const milliseconds = numberValue(row.created_at_ms);
    const timestamp = milliseconds === null || Number.isNaN(new Date(milliseconds).getTime())
      ? null
      : parseTimestamp(new Date(milliseconds).toISOString());
    if (!timestamp) {
      gaps.push({ class: "MISSING_MODERN", detail: `modern_evidence_timestamp_invalid:${rowId}` });
      continue;
    }
    const text = boundedText(row.text);
    if (text === null) {
      gaps.push({ class: "MISSING_MODERN", detail: `modern_evidence_text_missing:${rowId}` });
      continue;
    }
    const speakerKind = row.speaker_kind === "owner"
      || row.speaker_kind === "external_human"
      || row.speaker_kind === "external_bot"
      || row.speaker_kind === "ashley"
      ? row.speaker_kind
      : "UNKNOWN";
    const location = externalLocation(row.location_json);
    const audienceAtCapture = row.audience_at_capture === "dm" || row.audience_at_capture === "room"
      ? row.audience_at_capture
      : "UNKNOWN";
    const provenance = externalProvenance(row.provenance_json);
    if (role === "external_dialog") {
      if (!stringValue(row.speaker_principal_id)) {
        gaps.push({ class: "MISSING_MODERN", detail: `external_attribution_missing:${rowId}:speaker_principal_id` });
      }
      if (speakerKind !== "external_human" && speakerKind !== "external_bot") {
        gaps.push({ class: "MISSING_MODERN", detail: `external_attribution_missing:${rowId}:speaker_kind` });
      }
      if (!location) {
        gaps.push({ class: "MISSING_MODERN", detail: `external_attribution_missing:${rowId}:location` });
      }
      if (audienceAtCapture === "UNKNOWN") {
        gaps.push({ class: "MISSING_MODERN", detail: `external_attribution_missing:${rowId}:audience` });
      }
      if (!provenance) {
        gaps.push({ class: "MISSING_MODERN", detail: `external_attribution_missing:${rowId}:provenance` });
      }
    }
    result.push({
      rowId,
      lineageId: stringValue(row.lineage_id),
      conversationId,
      role,
      text,
      timestamp: timestamp.iso,
      milliseconds: timestamp.milliseconds,
      discordMessageIds: parseStringArray(row.discord_message_ids_json),
      reservationId: numberValue(row.reservation_id),
      producingCycleId: stringValue(row.producing_cycle_id),
      version: numberValue(row.version),
      sourceStatus: stringValue(row.source_status),
      speakerPrincipalId: stringValue(row.speaker_principal_id),
      speakerKind,
      location,
      audienceAtCapture,
      provenance,
      attachmentCount: parseArrayLength(row.attachment_refs_json),
      delivered: booleanValue(row.delivered),
    });
  }
  return result;
}

function toAttentionRows(rows: readonly Row[]): AttentionRow[] {
  return rows.flatMap((row) => {
    const id = numberValue(row.id) ?? stringValue(row.id);
    const purpose = stringValue(row.purpose);
    const modelAlias = stringValue(row.model_alias);
    if (id === null || !purpose || !modelAlias) return [];
    return [{
      id,
      purpose,
      modelAlias,
      resolvedModelId: stringValue(row.resolved_model_id),
      provider: stringValue(row.actual_provider) ?? stringValue(row.provider_id),
      route: stringValue(row.route_alias),
      state: stringValue(row.state),
      outcome: stringValue(row.outcome),
      errorClass: stringValue(row.error_class),
      queuedAt: stringValue(row.queued_at),
      dispatchStartedAt: stringValue(row.dispatch_started_at),
      endedAt: stringValue(row.ended_at),
      inputTokens: numberOrUnknown(row.actual_input_tokens),
      outputTokens: numberOrUnknown(row.actual_output_tokens),
      reservationId: numberValue(row.delivery_reservation_id),
      thoughtInvocationId: stringValue(row.thought_invocation_id),
      thoughtCycleId: stringValue(row.thought_cycle_id),
      thoughtGeneration: numberValue(row.thought_generation),
      dispatchSequence: numberValue(row.dispatch_sequence),
    }];
  });
}

function toBubbleRows(rows: readonly Row[]): BubbleRow[] {
  return rows.flatMap((row) => {
    const id = numberValue(row.id) ?? stringValue(row.id);
    if (id === null) return [];
    return [{
      id,
      reservationId: numberValue(row.reservation_id),
      ordinal: numberValue(row.ordinal),
      discordMessageId: stringValue(row.discord_message_id),
      text: safeText(row.text),
      sentAt: stringValue(row.sent_at),
    }];
  });
}

function durationMs(start: string | null, end: string | null): number | "UNKNOWN" {
  if (!start || !end) return "UNKNOWN";
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs ? "UNKNOWN" : endMs - startMs;
}

function attentionProjection(row: AttentionRow): JsonObject {
  return jsonObject({
    attention_request_id: row.id,
    request_id: row.thoughtInvocationId ?? row.id,
    provider: row.provider ?? "UNKNOWN",
    model_alias: row.modelAlias,
    resolved_model_id: row.resolvedModelId ?? "UNKNOWN",
    route: row.route ?? "UNKNOWN",
    state: row.state ?? "UNKNOWN",
    outcome: row.outcome ?? "UNKNOWN",
    error_class: row.errorClass,
    queued_at: row.queuedAt ?? "UNKNOWN",
    dispatch_started_at: row.dispatchStartedAt ?? "UNKNOWN",
    dispatch_ended_at: row.endedAt ?? "UNKNOWN",
    latency_ms: durationMs(row.dispatchStartedAt, row.endedAt),
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    reasoning_tokens: "UNKNOWN",
  });
}

function observedExpressionPath(row: AttentionRow): "QWEN_PRIMARY" | "LIGHTNING_FALLBACK" | "UNKNOWN" {
  if (row.route === "ashley_expression" && row.outcome === "completed") return "QWEN_PRIMARY";
  if (row.route === "ashley_expression_fallback" && row.outcome === "completed") return "LIGHTNING_FALLBACK";
  return "UNKNOWN";
}

function expressionAttemptProjection(row: AttentionRow, correlationStatus: "linked" | "unbound"): JsonObject {
  return jsonObject({
    ...attentionProjection(row),
    path: observedExpressionPath(row),
    correlation_status: correlationStatus,
  });
}

function selectSettlementPayload(row: Row | undefined): {
  surfaceDraft: string | "UNKNOWN";
  speechMode: string | "UNKNOWN";
} {
  const payload = parseObject(row?.payload_json);
  const settlement = payload?.settlement;
  const settlementObject = settlement && typeof settlement === "object" && !Array.isArray(settlement)
    ? settlement as Record<string, unknown>
    : payload;
  const speech = settlementObject?.speech;
  const speechObject = speech && typeof speech === "object" && !Array.isArray(speech)
    ? speech as Record<string, unknown>
    : null;
  return {
    surfaceDraft: typeof speechObject?.surfaceDraft === "string" ? redactObserverText(speechObject.surfaceDraft) : "UNKNOWN",
    speechMode: typeof speechObject?.mode === "string" ? speechObject.mode : "UNKNOWN",
  };
}

function selectThoughtStep(rows: readonly Row[], cycleId: string, generation: number): Row | undefined {
  return rows
    .filter((row) => String(row.cycle_id) === cycleId && numberValue(row.generation) === generation && row.kind === "settlement")
    .sort((left, right) => {
      const passDelta = (numberValue(right.pass) ?? -1) - (numberValue(left.pass) ?? -1);
      if (passDelta !== 0) return passDelta;
      return String(left.request_id ?? "").localeCompare(String(right.request_id ?? ""));
    })[0];
}

function selectedThoughtRows(rows: readonly AttentionRow[], cycleId: string, generation: number): AttentionRow[] {
  return rows
    .filter((row) => {
      if (row.purpose !== "thought" && row.purpose !== "thought_observation") return false;
      if (row.thoughtCycleId !== cycleId) return false;
      return row.thoughtGeneration === null || row.thoughtGeneration === generation;
    })
    .sort((left, right) => {
      const leftSequence = left.dispatchSequence ?? Number.MAX_SAFE_INTEGER;
      const rightSequence = right.dispatchSequence ?? Number.MAX_SAFE_INTEGER;
      return leftSequence - rightSequence || String(left.id).localeCompare(String(right.id));
    });
}

function selectedExpressionRows(rows: readonly AttentionRow[], reservationId: number | null): AttentionRow[] {
  if (reservationId === null) return [];
  return rows
    .filter((row) => row.purpose === "expression" && row.reservationId === reservationId)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function relatedAshleyEvidence(
  rows: readonly EvidenceRow[],
  cycleId: string,
  reservationId: number | null,
): EvidenceRow[] {
  return rows.filter((row) => {
    if (row.role !== "ashley") return false;
    return row.producingCycleId === cycleId || (reservationId !== null && row.reservationId === reservationId);
  });
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value !== ""))];
}

function uniqueIds(values: ReadonlyArray<number | string>): Array<number | string> {
  const seen = new Set<string>();
  const result: Array<number | string> = [];
  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function deliveryProjection(
  speech: Row,
  reservationRows: readonly Row[],
  bubbles: readonly BubbleRow[],
  gaps: TranscriptGap[],
): { projection: JsonObject; timestamp: string | null; messageIds: string[]; bubbleIds: Array<number | string> } {
  const reservationId = numberValue(speech.nuclear_reservation_id);
  const reservation = reservationId === null
    ? undefined
    : reservationRows.find((row) => numberValue(row.id) === reservationId);
  if (reservationId !== null && !reservation) gaps.push({ class: "MISSING_MODERN", detail: `delivery_reservation_missing:${reservationId}` });
  const reservationBubbles = reservationId === null
    ? []
    : bubbles.filter((bubble) => bubble.reservationId === reservationId)
      .sort((left, right) => (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER));
  const discordMessageIds = uniqueStrings([
    ...parseStringArray(speech.discord_message_ids_json),
    ...reservationBubbles.map((bubble) => bubble.discordMessageId),
  ]);
  const bubbleIds = uniqueIds(reservationBubbles.map((bubble) => bubble.id));
  const deliveredBubbles = reservationBubbles.map((bubble) => {
    const delivered = bubble.discordMessageId !== null && bubble.sentAt !== null;
    return jsonObject({
      bubble_id: bubble.id,
      discord_message_id: bubble.discordMessageId,
      delivered_text: delivered && bubble.text != null ? redactObserverText(bubble.text) : "UNKNOWN",
      delivered_at: bubble.sentAt ?? "UNKNOWN",
      result: delivered ? "delivered" : "UNKNOWN",
    });
  });
  const confirmed = reservationBubbles.filter((bubble) => bubble.discordMessageId !== null && bubble.sentAt !== null);
  const allConfirmed = reservationBubbles.length > 0 && confirmed.length === reservationBubbles.length;
  const reservationState = stringValue(reservation?.state) ?? "UNKNOWN";
  const terminal = ["cancelled", "aborted", "expired"].includes(reservationState);
  const deliveryResult = allConfirmed
    ? "delivered"
    : confirmed.length > 0
      ? "partial"
      : terminal
        ? "failed"
        : "UNKNOWN";
  if (reservationId !== null && reservationBubbles.length === 0 && ["sent", "delivered"].includes(stringValue(speech.send_status) ?? "")) {
    gaps.push({ class: "MISSING_MODERN", detail: `delivery_bubbles_missing:${reservationId}` });
  }
  const firstTimestamp = reservationBubbles
    .map((bubble) => bubble.sentAt)
    .filter((value): value is string => value !== null)
    .sort()[0] ?? null;
  return {
    timestamp: firstTimestamp,
    messageIds: discordMessageIds,
    bubbleIds,
    projection: jsonObject({
      delivery_reservation_id: reservationId,
      reservation_state: reservationState,
      delivery_result: deliveryResult,
      discord_message_ids: discordMessageIds,
      delivered_text: deliveredBubbles.length === 1
        ? deliveredBubbles[0]?.delivered_text ?? "UNKNOWN"
        : deliveredBubbles.map((bubble) => bubble.delivered_text),
      delivered_bubbles: deliveredBubbles,
      delivery_timestamp: firstTimestamp ?? "UNKNOWN",
    }),
  };
}

function assistantMessage(
  speech: Row,
  settlementId: string,
  cycleId: string,
  generation: number,
  evidence: readonly EvidenceRow[],
  delivery: ReturnType<typeof deliveryProjection>,
  gaps: TranscriptGap[],
): TranscriptMessage | null {
  const licensedText = safeText(speech.licensed_text);
  if (licensedText === null || licensedText === "") {
    gaps.push({ class: "MISSING_MODERN", detail: `licensed_speech_missing:${settlementId}` });
    return null;
  }
  const related = relatedAshleyEvidence(evidence, cycleId, numberValue(speech.nuclear_reservation_id));
  let evidenceRow: EvidenceRow | undefined;
  if (related.length === 1) evidenceRow = related[0];
  else if (related.length > 1) {
    const delivered = related.filter((row) => row.delivered);
    if (delivered.length === 1) evidenceRow = delivered[0];
    else gaps.push({ class: "AMBIGUOUS_MODERN_JOIN", detail: `ashley_evidence_ambiguous:${cycleId}` });
  }
  const timestamp = evidenceRow?.timestamp ?? delivery.timestamp;
  if (!timestamp) {
    gaps.push({ class: "MISSING_MODERN", detail: `assistant_timestamp_missing:${cycleId}` });
    return null;
  }
  const messageIds = uniqueStrings([
    ...(evidenceRow?.discordMessageIds ?? []),
    ...delivery.messageIds,
  ]);
  return {
    ts: timestamp,
    role: "assistant",
    text_redacted: redactObserverText(licensedText),
    source: "cognitive-v021.speech_outbox",
    run_id: null,
    decision_id: null,
    episode_id: null,
    provenance: "unknown",
    nuclear_message_id: null,
    join_method: "stable_identifier",
    join_confidence: "high",
    evidence_row_id: evidenceRow?.rowId ?? null,
    conversation_id: stringValue(speech.conversation_id),
    discord_message_ids: messageIds,
    cycle_id: cycleId,
    generation,
    reservation_id: numberValue(speech.nuclear_reservation_id),
    outbox_id: numberValue(speech.outbox_id),
    settlement_id: settlementId,
    delivery_bubble_ids: delivery.bubbleIds,
  };
}

function ownerMessage(row: EvidenceRow): TranscriptMessage {
  return {
    ts: row.timestamp,
    role: "user",
    text_redacted: redactObserverText(row.text),
    source: "cognitive-v021.conversation_evidence_log",
    run_id: null,
    decision_id: null,
    episode_id: null,
    provenance: "unknown",
    nuclear_message_id: null,
    join_method: null,
    join_confidence: null,
    evidence_row_id: row.rowId,
    conversation_id: row.conversationId,
    discord_message_ids: row.discordMessageIds,
    cycle_id: row.producingCycleId,
    generation: null,
    reservation_id: row.reservationId,
  };
}

function buildTurn(
  cycle: Row,
  rows: ReturnType<typeof readModernRows>,
  attention: readonly AttentionRow[],
  deliveryRows: ReturnType<typeof readDeliveryRows>,
  evidence: readonly EvidenceRow[],
  gaps: TranscriptGap[],
): { turn: JsonObject; assistant: TranscriptMessage | null } {
  const cycleId = stringValue(cycle.cycle_id) ?? "UNKNOWN";
  const generation = numberValue(cycle.generation) ?? 0;
  const conversationId = stringValue(cycle.conversation_id) ?? "UNKNOWN";
  const settlement = rows.settlements.rows.find((row) => String(row.cycle_id) === cycleId && numberValue(row.generation) === generation);
  const settlementId = stringValue(settlement?.settlement_id);
  const speech = settlementId
    ? rows.speeches.rows.find((row) => String(row.settlement_id) === settlementId)
    : undefined;
  const thoughtStep = selectThoughtStep(rows.thoughtSteps.rows, cycleId, generation);
  const settlementFacts = selectSettlementPayload(thoughtStep ?? settlement);
  const thoughtRows = selectedThoughtRows(attention, cycleId, generation);
  if (thoughtRows.length === 0) gaps.push({ class: "MISSING_MODERN", detail: `thought_attention_unobserved:${cycleId}` });
  if (!thoughtStep) gaps.push({ class: "MISSING_MODERN", detail: `thought_surface_draft_unobserved:${cycleId}` });
  if (!settlement) gaps.push({ class: "MISSING_MODERN", detail: `settlement_missing:${cycleId}` });
  const thoughtPrimary = thoughtRows[thoughtRows.length - 1];
  const thoughtProjection = thoughtPrimary
    ? jsonObject({
      ...attentionProjection(thoughtPrimary),
      attempts: thoughtRows.map(attentionProjection),
      cycle_id: cycleId,
      generation,
      settlement_id: settlementId,
      surface_draft: settlementFacts.surfaceDraft,
      speech_mode: settlementFacts.speechMode,
    })
    : jsonObject({
      attention_request_id: "UNKNOWN",
      request_id: "UNKNOWN",
      provider: "UNKNOWN",
      model_alias: "UNKNOWN",
      resolved_model_id: "UNKNOWN",
      route: "UNKNOWN",
      state: "UNKNOWN",
      outcome: "UNKNOWN",
      error_class: null,
      queued_at: "UNKNOWN",
      dispatch_started_at: "UNKNOWN",
      dispatch_ended_at: "UNKNOWN",
      latency_ms: "UNKNOWN",
      input_tokens: "UNKNOWN",
      output_tokens: "UNKNOWN",
      reasoning_tokens: "UNKNOWN",
      attempts: [],
      cycle_id: cycleId,
      generation,
      settlement_id: settlementId,
      surface_draft: settlementFacts.surfaceDraft,
      speech_mode: settlementFacts.speechMode,
    });

  const expressionRows = selectedExpressionRows(attention, numberValue(speech?.nuclear_reservation_id));
  const primarySuccess = expressionRows.find((row) => row.route === "ashley_expression" && row.outcome === "completed");
  const fallbackSuccess = expressionRows.find((row) => row.route === "ashley_expression_fallback" && row.outcome === "completed");
  const selected = primarySuccess ?? fallbackSuccess ?? expressionRows[expressionRows.length - 1];
  const path = primarySuccess
    ? "QWEN_PRIMARY"
    : fallbackSuccess
      ? "LIGHTNING_FALLBACK"
      : "UNKNOWN";
  const expressionProjection = selected
    ? jsonObject({
      ...attentionProjection(selected),
      adapted_output: speech ? redactObserverText(safeText(speech.licensed_text) ?? "") : "UNKNOWN",
      attempts: expressionRows.map(attentionProjection),
    })
    : jsonObject({
      attention_request_id: "UNKNOWN",
      request_id: "UNKNOWN",
      provider: "UNKNOWN",
      model_alias: "UNKNOWN",
      resolved_model_id: "UNKNOWN",
      route: "UNKNOWN",
      state: "UNKNOWN",
      outcome: "UNKNOWN",
      error_class: null,
      queued_at: "UNKNOWN",
      dispatch_started_at: "UNKNOWN",
      dispatch_ended_at: "UNKNOWN",
      latency_ms: "UNKNOWN",
      input_tokens: "UNKNOWN",
      output_tokens: "UNKNOWN",
      reasoning_tokens: "UNKNOWN",
      adapted_output: "UNKNOWN",
      attempts: [],
    });
  const fallback = expressionRows.find((row) => row.route === "ashley_expression_fallback")
    ? jsonObject({
      ...attentionProjection(expressionRows.find((row) => row.route === "ashley_expression_fallback")!),
      trigger: expressionRows.find((row) => row.route === "ashley_expression" && row.outcome !== "completed")?.errorClass
        ?? expressionRows.find((row) => row.route === "ashley_expression" && row.outcome !== "completed")?.outcome
        ?? "UNKNOWN",
    })
    : null;

  let finalSpeech: JsonObject | null = null;
  let assistant: TranscriptMessage | null = null;
  if (speech && settlementId) {
    const delivery = deliveryProjection(speech, deliveryRows.reservations.rows, toBubbleRows(deliveryRows.bubbles.rows), gaps);
    const licensedText = safeText(speech.licensed_text);
    const relatedEvidence = relatedAshleyEvidence(evidence, cycleId, numberValue(speech.nuclear_reservation_id));
    const publicDelivery = delivery.messageIds.length > 0 && delivery.timestamp !== null;
    const publicLicensedText = relatedEvidence.length === 1 || publicDelivery;
    finalSpeech = jsonObject({
      licensed_text: publicLicensedText && licensedText != null ? redactObserverText(licensedText) : "UNKNOWN",
      outbox_id: numberValue(speech.outbox_id),
      send_status: stringValue(speech.send_status) ?? "UNKNOWN",
      ...delivery.projection,
    });
    assistant = assistantMessage(speech, settlementId, cycleId, generation, evidence, delivery, gaps);
  } else if (settlementFacts.speechMode !== "none") {
    gaps.push({ class: "MISSING_MODERN", detail: `speech_outbox_missing:${settlementId ?? cycleId}` });
  }

  const licensedText = finalSpeech?.licensed_text;
  const deliveredText = finalSpeech?.delivered_text;
  const deliveredMatch = typeof licensedText === "string" && typeof deliveredText === "string"
    ? licensedText === deliveredText ? "observed_match" : "mismatch"
    : "UNKNOWN";
  const fidelity = jsonObject({
    status: "UNKNOWN",
    provenance: "no_standalone_durable_receipt",
    thought_surface_draft: settlementFacts.surfaceDraft,
    licensed_text: licensedText ?? "UNKNOWN",
    delivered_text_match: deliveredMatch,
  });
  return {
    assistant,
    turn: jsonObject({
      conversation_id: conversationId,
      cycle_id: cycleId,
      generation,
      settlement_id: settlementId,
      path,
      thought: thoughtProjection,
      expression: expressionProjection,
      fallback,
      final_speech: finalSpeech ?? jsonObject({
        licensed_text: "UNKNOWN",
        outbox_id: null,
        send_status: "UNKNOWN",
        delivery_reservation_id: null,
        delivery_result: "UNKNOWN",
        discord_message_ids: [],
        delivered_text: "UNKNOWN",
        delivered_bubbles: [],
        delivery_timestamp: "UNKNOWN",
      }),
      fidelity,
      gaps: gaps.map((gap) => gap.detail),
    }),
  };
}

function cycleForExternalEvidence(evidence: EvidenceRow, cycles: readonly Row[]): Row | undefined {
  if (evidence.producingCycleId) {
    const direct = cycles.find((cycle) => String(cycle.cycle_id) === evidence.producingCycleId);
    if (direct) return direct;
  }
  return cycles.find((cycle) => {
    if (stringValue(cycle.conversation_id) !== evidence.conversationId) return false;
    if (stringValue(cycle.trigger_kind) !== "external_message" && stringValue(cycle.trigger_kind) !== "external_utterance") {
      return false;
    }
    return parseStringArray(cycle.compose_log_ids_json).includes(evidence.rowId);
  });
}

function selectedExternalMarker(
  evidence: EvidenceRow,
  markerRows: readonly Row[],
): ExternalMarker | null {
  const matches = markerRows.filter((row) => {
    const state = markerState(row.kind);
    return state !== null && inboxEvidenceRowId(row) === evidence.rowId;
  });
  const selected = ["quarantined_external", "external_eligible_pending", "external_captured"]
    .map((kind) => matches.find((row) => row.kind === kind))
    .find((row): row is Row => row !== undefined);
  if (!selected) return null;
  const state = markerState(selected.kind);
  if (!state) return null;
  const captureMarker = matches.find((row) => row.kind === "external_captured");
  return {
    state,
    captureRef: inboxCaptureRef(selected) ?? (captureMarker ? inboxCaptureRef(captureMarker) : null),
    discordMessageId: inboxDiscordMessageId(selected) ?? (captureMarker ? inboxDiscordMessageId(captureMarker) : null),
    quarantineReason: state === "quarantined_external" ? inboxReason(selected) : null,
    captureStatus: stringValue(captureMarker?.status) ?? stringValue(selected.status),
    captureState: stringValue(captureMarker?.state) ?? stringValue(selected.state),
    admissionStatus: stringValue(selected.status),
    admissionMarkerState: stringValue(selected.state),
  };
}

function turnRecord(turn: unknown): Record<string, unknown> | null {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) return null;
  return turn as Record<string, unknown>;
}

function externalIngressProjection(
  evidence: EvidenceRow,
  rows: ReturnType<typeof readModernRows>,
  turns: readonly JsonObject[],
  marker: ExternalMarker | null,
): ExternalIngressProjection {
  const cycle = cycleForExternalEvidence(evidence, rows.cycles.rows);
  const cycleId = stringValue(cycle?.cycle_id);
  const thoughtObserved = cycleId !== null && rows.thoughtSteps.rows.some((row) => String(row.cycle_id) === cycleId);
  const turn = turnRecord(cycleId === null ? undefined : turns.find((candidate) => String(candidate.cycle_id) === cycleId));
  const finalSpeech = turnRecord(turn?.final_speech);
  const deliveryResult = finalSpeech?.delivery_result;
  const speechObserved = cycleId !== null && rows.speeches.rows.some((row) => String(row.cycle_id) === cycleId);
  const eligibleMarkerPending = marker?.state === "external_eligible_pending"
    && marker.admissionStatus === "pending"
    && marker.admissionMarkerState === "pending";
  const eligibleMarkerConsumedWithoutCycle = marker?.state === "external_eligible_pending" && cycleId === null && !eligibleMarkerPending;
  const cognitionState: ExternalIngressProjection["cognition_state"] = cycleId === null
    ? eligibleMarkerConsumedWithoutCycle
      ? "UNKNOWN"
      : rows.cycles.error === null ? "not_reached" : "UNKNOWN"
    : thoughtObserved
      ? "thought_observed"
      : "cycle_admitted";
  const admissionState: ExternalIngressProjection["admission_state"] = cycleId !== null
    ? "cognitively_admitted"
    : marker?.state === "external_eligible_pending"
      ? eligibleMarkerPending ? marker.state : "UNKNOWN"
      : marker?.state ?? "UNKNOWN";
  const publicationState: ExternalIngressProjection["publication_state"] = speechObserved
    ? "observed"
    : cycleId !== null && rows.speeches.error !== null
      ? "UNKNOWN"
      : "not_attempted";
  const deliveryState: ExternalIngressProjection["delivery_state"] = !speechObserved
    ? "not_attempted"
    : deliveryResult === "delivered" || deliveryResult === "partial" || deliveryResult === "failed"
      ? deliveryResult
      : "UNKNOWN";
  return {
    evidence_row_id: evidence.rowId,
    lineage_id: evidence.lineageId ?? "UNKNOWN",
    evidence_version: evidence.version ?? "UNKNOWN",
    conversation_id: evidence.conversationId,
    cycle_id: cycleId,
    cycle_disposition: cycleId === null ? null : stringValue(cycle?.disposition) ?? "UNKNOWN",
    captured_at: evidence.timestamp,
    text_redacted: redactObserverText(evidence.text),
    capture_ref: marker?.captureRef ?? "UNKNOWN",
    discord_message_id: marker?.discordMessageId ?? evidence.discordMessageIds[0] ?? null,
    speaker_principal_id: evidence.speakerPrincipalId ?? "UNKNOWN",
    speaker_kind: evidence.speakerKind === "external_human" || evidence.speakerKind === "external_bot"
      ? evidence.speakerKind
      : "UNKNOWN",
    location: evidence.location ?? "UNKNOWN",
    audience_at_capture: evidence.audienceAtCapture,
    provenance: evidence.provenance ?? "UNKNOWN",
    source_status: evidence.sourceStatus ?? "UNKNOWN",
    attachment_count: evidence.attachmentCount ?? "UNKNOWN",
    capture_status: marker?.captureStatus ?? "UNKNOWN",
    capture_state: marker?.captureState ?? "UNKNOWN",
    admission_status: marker?.admissionStatus ?? "UNKNOWN",
    admission_marker_state: marker?.admissionMarkerState ?? "UNKNOWN",
    admission_state: admissionState,
    quarantine_reason: marker?.quarantineReason ?? (admissionState === "UNKNOWN" ? "UNKNOWN" : null),
    cognition_state: cognitionState,
    publication_state: publicationState,
    delivery_state: deliveryState,
  };
}

function makeSessions(messages: readonly TranscriptMessage[]): TranscriptSession[] {
  const byConversation = new Map<string, TranscriptMessage[]>();
  for (const message of messages) {
    const conversationId = message.conversation_id;
    if (!conversationId) continue;
    const current = byConversation.get(conversationId) ?? [];
    current.push(message);
    byConversation.set(conversationId, current);
  }
  return [...byConversation.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([conversationId, conversationMessages]) => ({
      session_id: conversationId,
      channel: conversationMessages.some((message) => (message.discord_message_ids ?? []).length > 0) ? "discord" : "unknown",
      conversation_id: conversationId,
      source: "cognitive_v021",
      messages: [...conversationMessages].sort((left, right) => {
        const byTime = Date.parse(left.ts) - Date.parse(right.ts);
        return byTime !== 0 ? byTime : String(left.evidence_row_id ?? left.outbox_id ?? "").localeCompare(String(right.evidence_row_id ?? right.outbox_id ?? ""));
      }),
    }));
}

export function captureModernConversation(input: {
  cognitiveSidecar: DatabaseSync | null;
  nuclear: DatabaseSync | null;
  window: FieldDayWindow;
}): ModernConversationCapture {
  if (!input.cognitiveSidecar) {
    return {
      sessions: [],
      externalIngress: [],
      turns: [],
      expressionAttempts: [],
      modernGaps: [],
      modernActivityCount: 0,
      modernMessageCount: 0,
      sourceAvailable: false,
      sourceAttempted: true,
    };
  }
  const rows = readModernRows(input.cognitiveSidecar, input.window);
  const attentionResult = readAttentionRows(input.nuclear, input.window);
  const deliveryResults = readDeliveryRows(input.nuclear, input.window);
  const modernGaps: TranscriptGap[] = [];
  for (const result of [rows.evidence, rows.cycles, rows.thoughtSteps, rows.settlements, rows.speeches, attentionResult, deliveryResults.reservations, deliveryResults.bubbles]) {
    if (result.error && result.error !== "source_unavailable") modernGaps.push({ class: "MISSING_MODERN", detail: result.error });
  }
  const evidence = toEvidenceRows(rows.evidence.rows, modernGaps);
  const externalEvidence = evidence.filter((row) => row.role === "external_dialog");
  const externalMarkerRows = rows.inboxEvents.rows.filter((row) => markerState(row.kind) !== null);
  for (const event of externalMarkerRows) {
    const eventEvidenceId = inboxEvidenceRowId(event);
    if (!eventEvidenceId) {
      const eventId = stringValue(event.id) ?? "UNKNOWN";
      modernGaps.push({ class: "MISSING_MODERN", detail: `external_marker_invalid:${eventId}` });
      continue;
    }
    if (!externalEvidence.some((row) => row.rowId === eventEvidenceId)) {
      modernGaps.push({ class: "MISSING_MODERN", detail: `external_evidence_missing:${eventEvidenceId}` });
    }
  }
  if (externalEvidence.length > 0) {
    if (rows.inboxEvents.error) {
      modernGaps.push({ class: "MISSING_MODERN", detail: `external_markers_unreadable:${rows.inboxEvents.error}` });
    } else if (!rows.inboxEvents.available) {
      modernGaps.push({ class: "MISSING_MODERN", detail: "external_markers_unavailable" });
    }
    for (const row of externalEvidence) {
      const marker = rows.inboxEvents.available ? selectedExternalMarker(row, rows.inboxEvents.rows) : null;
      if (rows.inboxEvents.available && !marker) {
        modernGaps.push({ class: "MISSING_MODERN", detail: `external_marker_missing:${row.rowId}` });
      }
      if (marker?.state === "external_eligible_pending"
        && (marker.admissionStatus !== "pending" || marker.admissionMarkerState !== "pending")
        && !cycleForExternalEvidence(row, rows.cycles.rows)) {
        modernGaps.push({ class: "MISSING_MODERN", detail: `external_cycle_missing:${row.rowId}` });
      }
    }
  }
  const attention = toAttentionRows(attentionResult.rows);
  const linkedExpressionIds = new Set<string>();
  for (const speech of rows.speeches.rows) {
    const reservationId = numberValue(speech.nuclear_reservation_id);
    if (reservationId === null) continue;
    for (const row of selectedExpressionRows(attention, reservationId)) linkedExpressionIds.add(String(row.id));
  }
  const expressionAttempts = attention
    .filter((row) => row.purpose === "expression")
    .map((row) => {
      const linked = linkedExpressionIds.has(String(row.id));
      if (!linked) modernGaps.push({ class: "MISSING_MODERN", detail: `expression_attention_correlation_missing:${String(row.id)}` });
      return expressionAttemptProjection(row, linked ? "linked" : "unbound");
    });
  const activityKeys = new Set<string>();
  for (const row of evidence) activityKeys.add(`evidence:${row.rowId}`);
  for (const row of rows.inboxEvents.rows) {
    if (markerState(row.kind) !== null && stringValue(row.id)) activityKeys.add(`inbox:${String(row.id)}`);
  }
  for (const row of rows.cycles.rows) if (stringValue(row.cycle_id)) activityKeys.add(`cycle:${String(row.cycle_id)}`);
  for (const row of rows.thoughtSteps.rows) if (stringValue(row.request_id)) activityKeys.add(`thought:${String(row.request_id)}`);
  for (const row of rows.settlements.rows) if (stringValue(row.settlement_id)) activityKeys.add(`settlement:${String(row.settlement_id)}`);
  for (const row of rows.speeches.rows) if (stringValue(row.outbox_id)) activityKeys.add(`speech:${String(row.outbox_id)}`);
  for (const row of attention) activityKeys.add(`attention:${String(row.id)}`);
  for (const row of deliveryResults.reservations.rows) if (stringValue(row.id)) activityKeys.add(`reservation:${String(row.id)}`);
  for (const row of deliveryResults.bubbles.rows) if (stringValue(row.id)) activityKeys.add(`bubble:${String(row.id)}`);

  const messages: TranscriptMessage[] = evidence
    .filter((row) => row.role === "owner")
    .map(ownerMessage);
  const turns: JsonObject[] = [];
  for (const cycle of rows.cycles.rows) {
    const turnGaps: TranscriptGap[] = [];
    const built = buildTurn(cycle, rows, attention, deliveryResults, evidence, turnGaps);
    turns.push(built.turn);
    if (built.assistant) messages.push(built.assistant);
    modernGaps.push(...turnGaps);
  }
  const processedOutboxes = new Set(turns.map((turn) => String(turn.settlement_id ?? "")));
  for (const speech of rows.speeches.rows) {
    const settlementId = stringValue(speech.settlement_id);
    if (!settlementId || processedOutboxes.has(settlementId)) continue;
    modernGaps.push({ class: "MISSING_MODERN", detail: `speech_cycle_unmatched:${settlementId}` });
  }
  const externalIngress = externalEvidence.map((row) => externalIngressProjection(
    row,
    rows,
    turns,
    selectedExternalMarker(row, rows.inboxEvents.rows),
  ));
  const modernMessageCount = messages.length + externalIngress.length;
  if (activityKeys.size > 0 && modernMessageCount === 0) {
    modernGaps.push({ class: "MISSING_MODERN", detail: "modern_transcript_empty_with_activity" });
  }
  const uniqueGaps = [...new Map(modernGaps.map((gap) => [`${gap.class}:${gap.detail}`, gap])).values()];
  return {
    sessions: makeSessions(messages),
    externalIngress,
    turns,
    expressionAttempts,
    modernGaps: uniqueGaps,
    modernActivityCount: activityKeys.size,
    modernMessageCount,
    sourceAvailable: true,
    sourceAttempted: true,
  };
}
