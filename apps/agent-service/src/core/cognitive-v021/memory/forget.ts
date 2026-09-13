import type { DatabaseSync } from "node:sqlite";
import type { V021ForgetTarget } from "../types.js";
import { hashMemoryAssertion, getMemoryAssertion, REDACTED_MEMORY_STATEMENT } from "./assertions.js";
import { cancelDeliveryReservation } from "../../delivery/abort-registry.js";
import { getDeliveryReservation } from "../../delivery/store.js";
import { isTerminalDeliveryState } from "../../delivery/types.js";

type Row = Record<string, unknown>;

export const V021_FORGET_TARGET_MATRIX = {
  conversation_evidence_log: { behavior: "none", content: "redact" },
  thought_steps: { behavior: "none", content: "redact" },
  working_context_items: { behavior: "detach", content: "redact" },
  concerns: { behavior: "resolve", content: "redact" },
  mind_occupancy: { behavior: "detach", content: "none" },
  future_triggers: { behavior: "cancel", content: "redact" },
  observation_subscriptions: { behavior: "cancel", content: "redact" },
  observations: { behavior: "none", content: "redact" },
  effect_receipts: { behavior: "none", content: "redact" },
  durable_nominations: { behavior: "retract", content: "redact" },
  sidecar_memory_assertions: { behavior: "retract", content: "redact" },
  sidecar_memory_supports: { behavior: "none", content: "redact" },
  settlements: { behavior: "none", content: "redact" },
  speech_outbox: { behavior: "suppress", content: "redact" },
  system_notice_outbox: { behavior: "suppress", content: "redact" },
  causal_ledger: { behavior: "metadata_only", content: "metadata_only" },
  inbox_events: { behavior: "none", content: "redact" },
  in_flight_effects: { behavior: "cancel", content: "redact" },
} as const;

export type V021ForgetResult = {
  topic: string;
  targets: V021ForgetTarget[];
  changedRows: number;
};

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasTopic(value: unknown, topic: string): boolean {
  const needle = topic.toLocaleLowerCase();
  if (typeof value === "string") return value.toLocaleLowerCase().includes(needle);
  if (Array.isArray(value)) return value.some((item) => hasTopic(item, topic));
  if (isRow(value)) return Object.values(value).some((item) => hasTopic(item, topic));
  return false;
}

function redactValue(value: unknown, topic: string): unknown {
  if (typeof value === "string") return hasTopic(value, topic) ? REDACTED_MEMORY_STATEMENT : value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, topic));
  if (isRow(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, topic)]));
  return value;
}

function redactJson(value: unknown, topic: string): string {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return JSON.stringify(redactValue(parsed, topic));
  } catch {
    return JSON.stringify({ redacted: true });
  }
}

function addTarget(targets: V021ForgetTarget[], entityType: V021ForgetTarget["entityType"], entityUuid: string, action: V021ForgetTarget["action"] = "redact"): void {
  if (!entityUuid || targets.some((target) => target.entityType === entityType && target.entityUuid === entityUuid)) return;
  targets.push({ entityType, entityUuid, action });
}

function safePayload(value: unknown, topic: string): unknown {
  try { return JSON.parse(redactJson(value, topic)); } catch { return { redacted: true }; }
}

/** Apply the sidecar half of the v021 forget matrix. Continuity remains the tombstone authority. */
export function applyV021Forget(
  db: DatabaseSync,
  input: { topic: string; nowMs?: number },
): V021ForgetResult {
  const topic = input.topic.trim();
  if (!topic) throw new Error("forget_topic_required");
  const nowMs = input.nowMs ?? Date.now();
  const targets: V021ForgetTarget[] = [];
  let changedRows = 0;
  const concernIds = new Set<string>();
  const redactedAssertionKeys = new Set<string>();

  db.exec("BEGIN IMMEDIATE");
  try {
    const evidenceRows = db.prepare("SELECT row_id, text FROM conversation_evidence_log").all();
    for (const row of evidenceRows) {
      if (!isRow(row) || !hasTopic(row.text, topic)) continue;
      const result = db.prepare("UPDATE conversation_evidence_log SET text = NULL, source_status = 'redacted' WHERE row_id = ?").run(text(row.row_id));
      changedRows += number(result.changes);
      addTarget(targets, "v021_conversation_evidence", text(row.row_id));
    }

    const concerns = db.prepare("SELECT concern_id, statement FROM concerns").all();
    for (const row of concerns) {
      if (!isRow(row) || !hasTopic(row.statement, topic)) continue;
      const concernId = text(row.concern_id);
      concernIds.add(concernId);
      const result = db.prepare(
        `UPDATE concerns SET statement = '', source_refs_json = '[]', assertion_key = NULL,
             status = 'resolved', updated_cycle = updated_cycle WHERE concern_id = ?`,
      ).run(concernId);
      changedRows += number(result.changes);
      addTarget(targets, "v021_concern", concernId, "detach");
    }

    const contextRows = db.prepare("SELECT id, payload_json FROM working_context_items").all();
    for (const row of contextRows) {
      if (!isRow(row) || !hasTopic(row.payload_json, topic)) continue;
      const id = text(row.id);
      const result = db.prepare(
        `UPDATE working_context_items
            SET payload_json = ?, superseded = 1
          WHERE id = ?`,
      ).run(JSON.stringify({ type: "repair", text: "", concernId: null, sourceTurnIds: [], status: "abandoned", supersedesId: null }), id);
      changedRows += number(result.changes);
      addTarget(targets, "v021_working_context", id, "detach");
    }

    const occupancyRows = db.prepare("SELECT conversation_id, concern_id FROM mind_occupancy").all();
    for (const row of occupancyRows) {
      if (!isRow(row) || !concernIds.has(text(row.concern_id))) continue;
      const key = `${text(row.conversation_id)}:${text(row.concern_id)}`;
      const result = db.prepare("UPDATE mind_occupancy SET status = 'resolved' WHERE conversation_id = ? AND concern_id = ?").run(text(row.conversation_id), text(row.concern_id));
      changedRows += number(result.changes);
      addTarget(targets, "v021_occupancy", key, "detach");
    }

    const futureRows = db.prepare("SELECT trigger_id, concern_id, payload_json FROM future_triggers").all();
    for (const row of futureRows) {
      if (!isRow(row) || (!hasTopic(row.payload_json, topic) && !concernIds.has(text(row.concern_id)))) continue;
      const id = text(row.trigger_id);
      const result = db.prepare("UPDATE future_triggers SET status = 'cancelled', payload_json = '{}' WHERE trigger_id = ?").run(id);
      changedRows += number(result.changes);
      addTarget(targets, "v021_future_trigger", id, "cancel");
    }

    const subscriptions = db.prepare("SELECT subscription_id, spec_json FROM observation_subscriptions").all();
    for (const row of subscriptions) {
      if (!isRow(row) || !hasTopic(row.spec_json, topic)) continue;
      const id = text(row.subscription_id);
      const result = db.prepare("UPDATE observation_subscriptions SET cancelled = 1, spec_json = '{}' WHERE subscription_id = ?").run(id);
      changedRows += number(result.changes);
      addTarget(targets, "v021_subscription", id, "cancel");
    }

    const jsonTables: Array<{ table: string; id: string; target: V021ForgetTarget["entityType"] }> = [
      { table: "thought_steps", id: "request_id", target: "v021_thought_step" },
      { table: "observations", id: "observation_id", target: "v021_observation" },
      { table: "effect_receipts", id: "receipt_id", target: "v021_effect_receipt" },
      { table: "settlements", id: "settlement_id", target: "v021_settlement" },
      { table: "inbox_events", id: "id", target: "v021_inbox_event" },
    ];
    for (const descriptor of jsonTables) {
      const column = descriptor.table === "effect_receipts" ? "claims_json" : "payload_json";
      const rows = db.prepare(`SELECT ${descriptor.id}, ${column} FROM ${descriptor.table}`).all();
      for (const row of rows) {
        if (!isRow(row) || !hasTopic(row[column], topic)) continue;
        const id = text(row[descriptor.id]);
        const result = db.prepare(`UPDATE ${descriptor.table} SET ${column} = ? WHERE ${descriptor.id} = ?`).run(redactJson(row[column], topic), id);
        changedRows += number(result.changes);
        addTarget(targets, descriptor.target, id);
      }
    }

    const nominationRows = db.prepare("SELECT nomination_id, assertion_key, statement FROM durable_nominations").all();
    for (const row of nominationRows) {
      if (!isRow(row) || !hasTopic(row.statement, topic)) continue;
      const id = text(row.nomination_id);
      const result = db.prepare("UPDATE durable_nominations SET statement = ?, admitted = 0 WHERE nomination_id = ?").run(REDACTED_MEMORY_STATEMENT, id);
      changedRows += number(result.changes);
      addTarget(targets, "v021_nomination", id);
    }

    const assertionRows = db.prepare("SELECT * FROM sidecar_memory_assertions").all();
    for (const row of assertionRows) {
      if (!isRow(row) || !hasTopic(row.statement, topic)) continue;
      const key = text(row.assertion_key);
      redactedAssertionKeys.add(key);
      const existing = getMemoryAssertion(db, key);
      const contentHash = existing
        ? hashMemoryAssertion({ ...existing, statement: REDACTED_MEMORY_STATEMENT, admittedGeneration: null, live: false })
        : `redacted:${key}`;
      const result = db.prepare(
        `UPDATE sidecar_memory_assertions
            SET statement = ?, live = 0, admitted_generation = NULL, content_hash = ?
          WHERE assertion_key = ?`,
      ).run(REDACTED_MEMORY_STATEMENT, contentHash, key);
      changedRows += number(result.changes);
      addTarget(targets, "v021_memory_assertion", key);
    }

    for (const key of redactedAssertionKeys) {
      const supportRows = db.prepare("SELECT support_id FROM sidecar_memory_supports WHERE assertion_key = ?").all(key);
      const result = db.prepare(
        `UPDATE sidecar_memory_supports
            SET source_ref = NULL, settlement_id = NULL, evidence_lineage_id = NULL,
                observation_id = NULL, receipt_id = NULL
          WHERE assertion_key = ?`,
      ).run(key);
      changedRows += number(result.changes);
      for (const row of supportRows) if (isRow(row)) addTarget(targets, "v021_memory_support", text(row.support_id));
    }

    const outboxes = db.prepare("SELECT outbox_id, send_status, licensed_text FROM speech_outbox").all();
    for (const row of outboxes) {
      if (!isRow(row) || !hasTopic(row.licensed_text, topic)) continue;
      const id = text(row.outbox_id);
      const terminal = ["delivered", "partially_delivered", "send_failure", "suppressed", "suppressed_shadow"].includes(text(row.send_status));
      const result = db.prepare(
        "UPDATE speech_outbox SET licensed_text = ?, send_status = ?, suppressed = CASE WHEN ? = 'suppressed' THEN 1 ELSE suppressed END, nuclear_finalization_reason = ? WHERE outbox_id = ?",
      ).run(REDACTED_MEMORY_STATEMENT, terminal ? text(row.send_status) : "suppressed", terminal ? text(row.send_status) : "suppressed", "forgotten_content", Number(row.outbox_id));
      changedRows += number(result.changes);
      addTarget(targets, "v021_speech_outbox", id, "cancel");
    }

    const notices = db.prepare("SELECT notice_id, send_status, notice_text FROM system_notice_outbox").all();
    for (const row of notices) {
      if (!isRow(row) || !hasTopic(row.notice_text, topic)) continue;
      const id = text(row.notice_id);
      const terminal = ["delivered", "partially_delivered", "send_failure", "suppressed", "suppressed_shadow"].includes(text(row.send_status));
      const result = db.prepare("UPDATE system_notice_outbox SET notice_text = ?, send_status = ? WHERE notice_id = ?").run(REDACTED_MEMORY_STATEMENT, terminal ? text(row.send_status) : "suppressed", Number(row.notice_id));
      changedRows += number(result.changes);
      addTarget(targets, "v021_system_notice", id, "cancel");
    }

    const ledgerRows = db.prepare("SELECT id, cycle_id, generation, payload_json FROM causal_ledger").all();
    for (const row of ledgerRows) {
      if (!isRow(row) || !hasTopic(row.payload_json, topic)) continue;
      const id = text(row.id);
      const result = db.prepare("UPDATE causal_ledger SET payload_json = ? WHERE id = ?").run(JSON.stringify({ cycleId: text(row.cycle_id), generation: number(row.generation) }), Number(row.id));
      changedRows += number(result.changes);
      addTarget(targets, "v021_causal_ledger", id, "keep_metadata_only");
    }

    const inFlight = db.prepare("SELECT effect_id, payload_json FROM in_flight_effects").all();
    for (const row of inFlight) {
      if (!isRow(row) || !hasTopic(row.payload_json, topic)) continue;
      const id = text(row.effect_id);
      const result = db.prepare("UPDATE in_flight_effects SET state = 'unknown', payload_json = ? WHERE effect_id = ?").run(JSON.stringify({ redacted: true }), id);
      changedRows += number(result.changes);
      addTarget(targets, "v021_in_flight", id, "cancel");
    }

    // A redacted nomination must not be admitted on a later worker tick.
    void safePayload;
    void nowMs;
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
  return { topic, targets, changedRows };
}

export const forgetV021Topic = applyV021Forget;

export type V021ForgetPlan = {
  topic: string;
  targets: V021ForgetTarget[];
  preview: string[];
  categoryCounts: Record<string, number>;
};

function previewLabel(entityType: string, action: V021ForgetTarget["action"]): string {
  return `${entityType} (${action})`;
}

function countPlanTarget(
  targets: V021ForgetTarget[],
  categoryCounts: Record<string, number>,
  entityType: V021ForgetTarget["entityType"],
  entityUuid: string,
  action: V021ForgetTarget["action"] = "redact",
): void {
  const before = targets.length;
  addTarget(targets, entityType, entityUuid, action);
  if (targets.length === before) return;
  categoryCounts[entityType] = (categoryCounts[entityType] ?? 0) + 1;
}

/** Discover exact sidecar targets without changing any row. */
export function planV021Forget(
  db: DatabaseSync,
  input: { topic: string },
): V021ForgetPlan {
  const topic = input.topic.trim();
  if (!topic) throw new Error("forget_topic_required");
  const targets: V021ForgetTarget[] = [];
  const categoryCounts: Record<string, number> = {};
  const concernIds = new Set<string>();
  const redactedAssertionKeys = new Set<string>();

  const add = (
    entityType: V021ForgetTarget["entityType"],
    entityUuid: string,
    action: V021ForgetTarget["action"] = "redact",
  ) => countPlanTarget(targets, categoryCounts, entityType, entityUuid, action);

  for (const row of db.prepare("SELECT row_id, text FROM conversation_evidence_log").all()) {
    if (!isRow(row) || !hasTopic(row.text, topic)) continue;
    add("v021_conversation_evidence", text(row.row_id));
  }

  for (const row of db.prepare("SELECT concern_id, statement FROM concerns").all()) {
    if (!isRow(row) || !hasTopic(row.statement, topic)) continue;
    const concernId = text(row.concern_id);
    concernIds.add(concernId);
    add("v021_concern", concernId, "detach");
  }

  for (const row of db.prepare("SELECT id, payload_json FROM working_context_items").all()) {
    if (!isRow(row) || !hasTopic(row.payload_json, topic)) continue;
    add("v021_working_context", text(row.id), "detach");
  }

  for (const row of db.prepare("SELECT conversation_id, concern_id FROM mind_occupancy").all()) {
    if (!isRow(row) || !concernIds.has(text(row.concern_id))) continue;
    add("v021_occupancy", `${text(row.conversation_id)}:${text(row.concern_id)}`, "detach");
  }

  for (const row of db.prepare("SELECT trigger_id, concern_id, payload_json FROM future_triggers").all()) {
    if (!isRow(row) || (!hasTopic(row.payload_json, topic) && !concernIds.has(text(row.concern_id)))) continue;
    add("v021_future_trigger", text(row.trigger_id), "cancel");
  }

  for (const row of db.prepare("SELECT subscription_id, spec_json FROM observation_subscriptions").all()) {
    if (!isRow(row) || !hasTopic(row.spec_json, topic)) continue;
    add("v021_subscription", text(row.subscription_id), "cancel");
  }

  const jsonTables: Array<{ table: string; id: string; target: V021ForgetTarget["entityType"] }> = [
    { table: "thought_steps", id: "request_id", target: "v021_thought_step" },
    { table: "observations", id: "observation_id", target: "v021_observation" },
    { table: "effect_receipts", id: "receipt_id", target: "v021_effect_receipt" },
    { table: "settlements", id: "settlement_id", target: "v021_settlement" },
    { table: "inbox_events", id: "id", target: "v021_inbox_event" },
  ];
  for (const descriptor of jsonTables) {
    const column = descriptor.table === "effect_receipts" ? "claims_json" : "payload_json";
    for (const row of db.prepare(`SELECT ${descriptor.id}, ${column} FROM ${descriptor.table}`).all()) {
      if (!isRow(row) || !hasTopic(row[column], topic)) continue;
      add(descriptor.target, text(row[descriptor.id]));
    }
  }

  for (const row of db.prepare("SELECT nomination_id, statement FROM durable_nominations").all()) {
    if (!isRow(row) || !hasTopic(row.statement, topic)) continue;
    add("v021_nomination", text(row.nomination_id));
  }

  for (const row of db.prepare("SELECT assertion_key, statement FROM sidecar_memory_assertions").all()) {
    if (!isRow(row) || !hasTopic(row.statement, topic)) continue;
    const key = text(row.assertion_key);
    redactedAssertionKeys.add(key);
    add("v021_memory_assertion", key);
  }
  for (const key of redactedAssertionKeys) {
    for (const row of db.prepare("SELECT support_id FROM sidecar_memory_supports WHERE assertion_key = ?").all(key)) {
      if (isRow(row)) add("v021_memory_support", text(row.support_id));
    }
  }

  for (const row of db.prepare("SELECT outbox_id, licensed_text FROM speech_outbox").all()) {
    if (!isRow(row) || !hasTopic(row.licensed_text, topic)) continue;
    add("v021_speech_outbox", text(row.outbox_id), "cancel");
  }
  for (const row of db.prepare("SELECT notice_id, notice_text FROM system_notice_outbox").all()) {
    if (!isRow(row) || !hasTopic(row.notice_text, topic)) continue;
    add("v021_system_notice", text(row.notice_id), "cancel");
  }
  for (const row of db.prepare("SELECT id, cycle_id, generation, payload_json FROM causal_ledger").all()) {
    if (!isRow(row) || !hasTopic(row.payload_json, topic)) continue;
    add("v021_causal_ledger", text(row.id), "keep_metadata_only");
  }
  for (const row of db.prepare("SELECT effect_id, payload_json FROM in_flight_effects").all()) {
    if (!isRow(row) || !hasTopic(row.payload_json, topic)) continue;
    add("v021_in_flight", text(row.effect_id), "cancel");
  }

  return {
    topic,
    targets,
    preview: targets.map((target) => previewLabel(target.entityType, target.action)),
    categoryCounts,
  };
}

function targetIds(targets: V021ForgetTarget[], entityType: string): Set<string> {
  return new Set(targets.filter((target) => target.entityType === entityType).map((target) => target.entityUuid));
}

export type V021ForgetDeliveryAuthority = {
  nuclearDb: DatabaseSync;
  ownerId: string;
};

function linkedReservationIds(
  db: DatabaseSync,
  targets: V021ForgetTarget[],
): number[] {
  const ids = new Set<number>();
  for (const id of targetIds(targets, "v021_speech_outbox")) {
    const row = db.prepare(
      "SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
    ).get(Number(id)) as Row | undefined;
    const reservationId = number(row?.nuclear_reservation_id);
    if (reservationId > 0) ids.add(reservationId);
  }
  for (const id of targetIds(targets, "v021_system_notice")) {
    const row = db.prepare(
      "SELECT nuclear_reservation_id FROM system_notice_outbox WHERE notice_id = ?",
    ).get(Number(id)) as Row | undefined;
    const reservationId = number(row?.nuclear_reservation_id);
    if (reservationId > 0) ids.add(reservationId);
  }
  return [...ids];
}

/** Make linked Nuclear delivery terminal before any candidate text is redacted. */
function cancelLinkedDeliveries(
  db: DatabaseSync,
  targets: V021ForgetTarget[],
  authority: V021ForgetDeliveryAuthority,
): void {
  for (const reservationId of linkedReservationIds(db, targets)) {
    const reservation = getDeliveryReservation(authority.nuclearDb, reservationId);
    if (!reservation) throw new Error("forget_delivery_reservation_missing");
    if (isTerminalDeliveryState(reservation.state)) continue;
    const cancelled = cancelDeliveryReservation(authority.nuclearDb, {
      reservationId,
      ownerId: authority.ownerId,
    });
    if (!cancelled.ok) throw new Error("forget_delivery_cancel_failed");
    const finalized = getDeliveryReservation(authority.nuclearDb, reservationId);
    if (!finalized || !isTerminalDeliveryState(finalized.state)) {
      throw new Error("forget_delivery_cancel_incomplete");
    }
  }
}

function addChanges(result: { changes?: number | bigint }, counter: { value: number }): void {
  counter.value += number(result.changes);
}

function applyV021ForgetTargetsInTransaction(
  db: DatabaseSync,
  targets: V021ForgetTarget[],
  nowMs: number,
): V021ForgetResult {
  const changed = { value: 0 };
  const evidenceIds = targetIds(targets, "v021_conversation_evidence");
  for (const id of evidenceIds) {
    addChanges(db.prepare("UPDATE conversation_evidence_log SET text = NULL, source_status = 'redacted' WHERE row_id = ?").run(id), changed);
  }

  for (const id of targetIds(targets, "v021_thought_step")) {
    addChanges(db.prepare("UPDATE thought_steps SET payload_json = ? WHERE request_id = ?").run(JSON.stringify({ redacted: true }), id), changed);
  }
  for (const id of targetIds(targets, "v021_observation")) {
    addChanges(db.prepare("UPDATE observations SET payload_json = ? WHERE observation_id = ?").run(JSON.stringify({ redacted: true }), id), changed);
  }
  for (const id of targetIds(targets, "v021_effect_receipt")) {
    addChanges(db.prepare("UPDATE effect_receipts SET claims_json = ? WHERE receipt_id = ?").run(JSON.stringify({ redacted: true }), id), changed);
  }
  for (const id of targetIds(targets, "v021_settlement")) {
    addChanges(db.prepare("UPDATE settlements SET payload_json = ? WHERE settlement_id = ?").run(JSON.stringify({ redacted: true }), id), changed);
  }
  for (const id of targetIds(targets, "v021_inbox_event")) {
    addChanges(db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(JSON.stringify({ redacted: true }), id), changed);
  }

  for (const id of targetIds(targets, "v021_working_context")) {
    addChanges(db.prepare(
      `UPDATE working_context_items
          SET payload_json = ?, superseded = 1
        WHERE id = ?`,
    ).run(JSON.stringify({ type: "repair", text: "", concernId: null, sourceTurnIds: [], status: "abandoned", supersedesId: null }), id), changed);
  }
  for (const id of targetIds(targets, "v021_concern")) {
    addChanges(db.prepare(
      `UPDATE concerns SET statement = '', source_refs_json = '[]', assertion_key = NULL,
           status = 'resolved' WHERE concern_id = ?`,
    ).run(id), changed);
  }
  for (const key of targetIds(targets, "v021_occupancy")) {
    const separator = key.indexOf(":");
    if (separator <= 0) continue;
    addChanges(db.prepare("UPDATE mind_occupancy SET status = 'resolved' WHERE conversation_id = ? AND concern_id = ?").run(key.slice(0, separator), key.slice(separator + 1)), changed);
  }
  for (const id of targetIds(targets, "v021_future_trigger")) {
    addChanges(db.prepare("UPDATE future_triggers SET status = 'cancelled', payload_json = '{}' WHERE trigger_id = ?").run(id), changed);
  }
  for (const id of targetIds(targets, "v021_subscription")) {
    addChanges(db.prepare("UPDATE observation_subscriptions SET cancelled = 1, spec_json = '{}' WHERE subscription_id = ?").run(id), changed);
  }

  for (const id of targetIds(targets, "v021_nomination")) {
    addChanges(db.prepare("UPDATE durable_nominations SET statement = ?, admitted = 0 WHERE nomination_id = ?").run(REDACTED_MEMORY_STATEMENT, id), changed);
  }
  for (const key of targetIds(targets, "v021_memory_assertion")) {
    const existing = getMemoryAssertion(db, key);
    const contentHash = existing
      ? hashMemoryAssertion({ ...existing, statement: REDACTED_MEMORY_STATEMENT, admittedGeneration: null, live: false })
      : `redacted:${key}`;
    addChanges(db.prepare(
      `UPDATE sidecar_memory_assertions
          SET statement = ?, live = 0, admitted_generation = NULL, content_hash = ?
        WHERE assertion_key = ?`,
    ).run(REDACTED_MEMORY_STATEMENT, contentHash, key), changed);
  }
  for (const id of targetIds(targets, "v021_memory_support")) {
    addChanges(db.prepare(
      `UPDATE sidecar_memory_supports
          SET source_ref = NULL, settlement_id = NULL, evidence_lineage_id = NULL,
              observation_id = NULL, receipt_id = NULL
        WHERE support_id = ?`,
    ).run(id), changed);
  }

  for (const id of targetIds(targets, "v021_speech_outbox")) {
    const row = db.prepare("SELECT send_status FROM speech_outbox WHERE outbox_id = ?").get(Number(id)) as Row | undefined;
    if (!row) continue;
    const status = text(row.send_status);
    const terminal = ["delivered", "partially_delivered", "send_failure", "suppressed", "suppressed_shadow"].includes(status);
    addChanges(db.prepare(
      `UPDATE speech_outbox
          SET licensed_text = ?, send_status = ?,
              suppressed = CASE WHEN ? = 'suppressed' THEN 1 ELSE suppressed END,
              nuclear_finalization_reason = ?
        WHERE outbox_id = ?`,
    ).run(REDACTED_MEMORY_STATEMENT, terminal ? status : "suppressed", terminal ? status : "suppressed", "forgotten_content", Number(id)), changed);
  }
  for (const id of targetIds(targets, "v021_system_notice")) {
    const row = db.prepare("SELECT send_status FROM system_notice_outbox WHERE notice_id = ?").get(Number(id)) as Row | undefined;
    if (!row) continue;
    const status = text(row.send_status);
    const terminal = ["delivered", "partially_delivered", "send_failure", "suppressed", "suppressed_shadow"].includes(status);
    addChanges(db.prepare("UPDATE system_notice_outbox SET notice_text = ?, send_status = ? WHERE notice_id = ?").run(REDACTED_MEMORY_STATEMENT, terminal ? status : "suppressed", Number(id)), changed);
  }
  for (const id of targetIds(targets, "v021_causal_ledger")) {
    const row = db.prepare("SELECT cycle_id, generation FROM causal_ledger WHERE id = ?").get(Number(id)) as Row | undefined;
    if (!row) continue;
    addChanges(db.prepare("UPDATE causal_ledger SET payload_json = ? WHERE id = ?").run(JSON.stringify({ cycleId: text(row.cycle_id), generation: number(row.generation) }), Number(id)), changed);
  }
  for (const id of targetIds(targets, "v021_in_flight")) {
    addChanges(db.prepare("UPDATE in_flight_effects SET state = 'unknown', payload_json = ? WHERE effect_id = ?").run(JSON.stringify({ redacted: true }), id), changed);
  }

  void nowMs;
  return { topic: "", targets, changedRows: changed.value };
}

/** Apply only the exact sidecar targets previously recorded in a preview. */
export function applyV021ForgetTargets(
  db: DatabaseSync,
  targets: V021ForgetTarget[],
  options: {
    nowMs?: number;
    inTransaction?: boolean;
    delivery?: V021ForgetDeliveryAuthority;
  } = {},
): V021ForgetResult {
  const nowMs = options.nowMs ?? Date.now();
  if (options.delivery) cancelLinkedDeliveries(db, targets, options.delivery);
  if (options.inTransaction === true) return applyV021ForgetTargetsInTransaction(db, targets, nowMs);
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyV021ForgetTargetsInTransaction(db, targets, nowMs);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}
