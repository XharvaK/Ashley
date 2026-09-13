import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { InFlightRecord } from "../types.js";
import type { EffectReceipt } from "../types.js";

export type PutInFlightInput = {
  effectId?: string;
  cycleId: string;
  generation: number;
  wakeId?: string | null;
  correlationId: string;
  idempotencyKey: string;
  dispatchedAtMs?: number;
  originJobId?: string | null;
  payload?: unknown;
  originEventId: string;
  originAttemptId?: string | null;
};

type DbRow = Record<string, unknown>;
function stringValue(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function numberValue(value: unknown, fallback = 0): number { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : fallback; }
function mapInFlight(row: unknown): InFlightRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as DbRow;
  return {
    effectId: stringValue(value.effect_id),
    cycleId: stringValue(value.cycle_id),
    generation: numberValue(value.generation),
    wakeId: value.wake_id == null ? null : stringValue(value.wake_id),
    correlationId: stringValue(value.correlation_id),
    idempotencyKey: stringValue(value.idempotency_key),
    status: stringValue(value.state) as InFlightRecord["status"],
    dispatchedAtMs: numberValue(value.dispatched_at_ms),
    originJobId: value.origin_job_id == null ? null : stringValue(value.origin_job_id),
    originEventId: value.origin_event_id == null ? null : stringValue(value.origin_event_id),
    originAttemptId: value.origin_attempt_id == null ? null : stringValue(value.origin_attempt_id),
  };
}

export function getInFlight(db: DatabaseSync, effectOrIdempotencyKey: string): InFlightRecord | null {
  return mapInFlight(
    db.prepare("SELECT * FROM in_flight_effects WHERE effect_id = ? OR idempotency_key = ? LIMIT 1").get(effectOrIdempotencyKey, effectOrIdempotencyKey),
  );
}

export function putInFlight(db: DatabaseSync, input: PutInFlightInput): InFlightRecord {
  const existing = getInFlight(db, input.idempotencyKey);
  if (existing) return existing;
  if (!input.originEventId || typeof input.originEventId !== "string" || input.originEventId.trim().length === 0) {
    throw new Error("origin_event_id_required");
  }
  const cycle = db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = ? LIMIT 1").get(input.cycleId) as DbRow | undefined;
  const wakeId = input.wakeId ?? (typeof cycle?.wake_id === "string" ? cycle.wake_id : null);
  if (!wakeId) throw new Error("wake_required");
  const effectId = input.effectId ?? randomUUID();
  db.prepare(
    `INSERT INTO in_flight_effects
       (effect_id, cycle_id, generation, correlation_id, idempotency_key,
        state, payload_json, dispatched_at_ms, origin_job_id, wake_id,
        origin_event_id, origin_attempt_id)
     VALUES (?, ?, ?, ?, ?, 'in_flight', ?, ?, ?, ?, ?, ?)`,
  ).run(
    effectId,
    input.cycleId,
    input.generation,
    input.correlationId,
    input.idempotencyKey,
    JSON.stringify(input.payload ?? {}),
    input.dispatchedAtMs ?? Date.now(),
    input.originJobId ?? null,
    wakeId,
    input.originEventId,
    input.originAttemptId ?? null,
  );
  const row = getInFlight(db, effectId);
  if (!row) throw new Error("in_flight_insert_lost");
  return row;
}

export function markInFlightUnknown(db: DatabaseSync, effectId: string, _atMs = Date.now()): InFlightRecord {
  db.prepare("UPDATE in_flight_effects SET state = 'unknown' WHERE effect_id = ? AND state = 'in_flight'").run(effectId);
  const row = getInFlight(db, effectId);
  if (!row) throw new Error("in_flight_missing");
  return row;
}

export function markInFlightReceipted(db: DatabaseSync, effectId: string): InFlightRecord {
  db.prepare("UPDATE in_flight_effects SET state = 'receipted' WHERE effect_id = ?").run(effectId);
  const row = getInFlight(db, effectId);
  if (!row) throw new Error("in_flight_missing");
  return row;
}

export function listInFlight(db: DatabaseSync, cycleId?: string): InFlightRecord[] {
  const rows = cycleId
    ? db.prepare("SELECT * FROM in_flight_effects WHERE cycle_id = ? ORDER BY dispatched_at_ms ASC").all(cycleId)
    : db.prepare("SELECT * FROM in_flight_effects ORDER BY dispatched_at_ms ASC").all();
  return rows.map(mapInFlight).filter((row): row is InFlightRecord => row !== null);
}

function mapReceipt(row: unknown): EffectReceipt | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as DbRow;
  let claims: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(stringValue(value.claims_json, "{}"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) claims = parsed as Record<string, unknown>;
  } catch { /* preserve an empty safe claims object */ }
  return {
    receiptId: stringValue(value.receipt_id),
    effectId: stringValue(value.effect_id),
    idempotencyKey: stringValue(value.idempotency_key),
    outcome: (stringValue(value.outcome) === "unknown" ? "outcome_unknown" : stringValue(value.outcome, "outcome_unknown")) as EffectReceipt["outcome"],
    claims,
    atMs: numberValue(value.at_ms),
    dataClassification: stringValue(value.data_classification, "never_public") as EffectReceipt["dataClassification"],
    secretOmitted: numberValue(value.secret_omitted) === 1,
  };
}

export function getEffectReceipt(db: DatabaseSync, effectId: string): EffectReceipt | null {
  return mapReceipt(db.prepare("SELECT * FROM effect_receipts WHERE effect_id = ?").get(effectId));
}

export function getEffectReceiptByIdempotencyKey(
  db: DatabaseSync,
  idempotencyKey: string,
): EffectReceipt | null {
  return mapReceipt(db.prepare("SELECT * FROM effect_receipts WHERE idempotency_key = ?").get(idempotencyKey));
}

const VALID_RECEIPT_OUTCOMES = new Set<string>([
  "succeeded",
  "failed",
  "outcome_unknown",
  "not_attempted",
  "in_progress",
]);

export function recordEffectReceipt(db: DatabaseSync, receipt: EffectReceipt): EffectReceipt {
  if (!VALID_RECEIPT_OUTCOMES.has(receipt.outcome)) {
    throw new Error(`invalid_receipt_outcome:${receipt.outcome}`);
  }
  const existing = getEffectReceipt(db, receipt.effectId)
    ?? getEffectReceiptByIdempotencyKey(db, receipt.idempotencyKey);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO effect_receipts
       (receipt_id, effect_id, idempotency_key, outcome, claims_json, at_ms,
        data_classification, secret_omitted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    receipt.receiptId,
    receipt.effectId,
    receipt.idempotencyKey,
    receipt.outcome,
    JSON.stringify(receipt.claims),
    receipt.atMs,
    receipt.dataClassification,
    receipt.secretOmitted ? 1 : 0,
  );
  db.prepare("UPDATE in_flight_effects SET state = 'receipted' WHERE effect_id = ?").run(receipt.effectId);
  return getEffectReceipt(db, receipt.effectId) ?? receipt;
}

export function listEffectReceipts(db: DatabaseSync): EffectReceipt[] {
  return db.prepare("SELECT * FROM effect_receipts ORDER BY at_ms ASC").all()
    .map(mapReceipt)
    .filter((row): row is EffectReceipt => row !== null);
}
