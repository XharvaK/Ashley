import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { InFlightRecord } from "../types.js";
import type { EffectReceipt } from "../types.js";
import type { SocialAudience } from "../social/types.js";
import { mintEffectRef } from "./effect-ref.js";

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
  audienceScope?: SocialAudience | null;
  operationKind?: string;
};

type DbRow = Record<string, unknown>;
const HOST_EFFECT_PAYLOAD_SCHEMA = "ashley.effect_payload.v1";
function stringValue(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function numberValue(value: unknown, fallback = 0): number { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : fallback; }
function audienceScope(value: unknown): SocialAudience | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "owner_private") return { kind: "owner_private" };
  if (candidate.kind === "owner_dm" && typeof candidate.threadId === "string" && candidate.threadId.trim()) {
    return { kind: "owner_dm", threadId: candidate.threadId };
  }
  if (candidate.kind === "dm" && typeof candidate.principalId === "string" && candidate.principalId.trim()) {
    return { kind: "dm", principalId: candidate.principalId };
  }
  if (candidate.kind === "room" && typeof candidate.roomId === "string" && candidate.roomId.trim()) {
    return { kind: "room", roomId: candidate.roomId };
  }
  return null;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mapInFlight(row: unknown): InFlightRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as DbRow;
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(stringValue(value.payload_json, "{}"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch { /* legacy rows have no audience metadata */ }
  const hostMetadata = record(payload.__ashleyBclp);
  const isHostEnvelope = hostMetadata?.schema === HOST_EFFECT_PAYLOAD_SCHEMA
    && typeof hostMetadata.semanticOperationKind === "string"
    && Object.prototype.hasOwnProperty.call(payload, "request");
  const request = isHostEnvelope ? payload.request : payload;
  const requestRecord = record(request);
  const scope = audienceScope(requestRecord?.audienceScope ?? payload.audienceScope);
  const operationKind = isHostEnvelope
    && typeof hostMetadata.semanticOperationKind === "string"
    ? hostMetadata.semanticOperationKind
    : undefined;
  const payloadRedacted = requestRecord?.redacted === true || payload.redacted === true;
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
    ...(scope === undefined ? {} : { audienceScope: scope }),
    ...(operationKind === undefined ? {} : { operationKind }),
    request,
    ...(payloadRedacted ? { payloadRedacted: true } : {}),
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
  const requestRecord = record(input.payload);
  const requestPayload = input.audienceScope === undefined
    ? (input.payload ?? {})
    : requestRecord
      ? { ...requestRecord, audienceScope: input.audienceScope }
      : { value: input.payload ?? null, audienceScope: input.audienceScope };
  const storedPayload = input.operationKind
    ? {
        __ashleyBclp: { schema: HOST_EFFECT_PAYLOAD_SCHEMA, semanticOperationKind: input.operationKind },
        request: requestPayload,
      }
    : input.audienceScope === undefined
      ? requestPayload
      : requestPayload;
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
    JSON.stringify(storedPayload),
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
  return withReceipts(db, rows.map(mapInFlight).filter((row): row is InFlightRecord => row !== null));
}

function withReceipts(db: DatabaseSync, rows: readonly InFlightRecord[]): InFlightRecord[] {
  return rows.map((row) => ({ ...row, receipt: getEffectReceipt(db, row.effectId) }));
}

type ContinuationCycleRow = {
  cycle_id: string;
  conversation_id: string;
  generation: number;
  wake_id: string | null;
  trigger_ref: string | null;
  preempted_generation: number | null;
};

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try { return record(JSON.parse(value)); } catch { return null; }
}

function continuationCycles(db: DatabaseSync, cycleId: string): ContinuationCycleRow[] {
  const current = db.prepare(
    `SELECT cycle_id, conversation_id, generation, wake_id, trigger_ref, preempted_generation
       FROM cycle_records WHERE cycle_id = ? LIMIT 1`,
  ).get(cycleId) as ContinuationCycleRow | undefined;
  if (!current) return [];
  const rows = [current];
  const seen = new Set([current.cycle_id]);
  let child = current;
  while (child.preempted_generation != null) {
    const parents = db.prepare(
      `SELECT cycle_id, conversation_id, generation, wake_id, trigger_ref, preempted_generation
         FROM cycle_records
        WHERE conversation_id = ? AND generation = ? AND cycle_id <> ?`,
    ).all(child.conversation_id, child.preempted_generation, child.cycle_id) as ContinuationCycleRow[];
    if (parents.length !== 1) break;
    const parent = parents[0];
    if (parent.generation >= child.generation || seen.has(parent.cycle_id)) break;
    rows.push(parent);
    seen.add(parent.cycle_id);
    child = parent;
  }
  return rows;
}

function acceptedEffectFacts(
  db: DatabaseSync,
  cycles: readonly ContinuationCycleRow[],
): { completed: Set<string>; referenced: Set<string> } {
  if (cycles.length === 0) return { completed: new Set(), referenced: new Set() };
  const cycleIds = cycles.map((row) => row.cycle_id);
  const settlements = db.prepare(
    `SELECT payload_json FROM settlements
      WHERE cycle_id IN (${cycleIds.map(() => "?").join(",")})`,
  ).all(...cycleIds) as Array<{ payload_json: string }>;
  const completed = new Set<string>();
  const referenced = new Set<string>();
  for (const settlementRow of settlements) {
    const payload = parseJsonRecord(settlementRow.payload_json);
    const operations = record(payload?.operations);
    for (const id of Array.isArray(operations?.effectsCompleted)
      ? operations.effectsCompleted.filter((item): item is string => typeof item === "string")
      : []) completed.add(id);
    const addRefs = (values: unknown) => {
      if (!Array.isArray(values)) return;
      for (const item of values) if (typeof item === "string") referenced.add(item);
    };
    addRefs(operations?.intentsStillInFlight);
    const commitments = record(payload?.commitments);
    if (Array.isArray(commitments?.operational)) {
      for (const claim of commitments.operational) {
        const claimRecord = record(claim);
        if (typeof claimRecord?.effectRef === "string") referenced.add(claimRecord.effectRef);
      }
    }
  }
  return { completed, referenced };
}

/**
 * Return effects for the current cycle plus effects mechanically bound to its
 * admitted preemption chain. Conversation membership and composeLogIds alone
 * never join an effect. Exact accepted completion releases only that effect.
 */
export function listInFlightForThoughtCycle(db: DatabaseSync, cycleId: string): InFlightRecord[] {
  const cycles = continuationCycles(db, cycleId);
  if (cycles.length === 0) return [];
  const cycleIds = cycles.map((row) => row.cycle_id);
  const rows = db.prepare(
    `SELECT * FROM in_flight_effects
      WHERE cycle_id IN (${cycleIds.map(() => "?").join(",")})
      ORDER BY dispatched_at_ms ASC`,
  ).all(...cycleIds).map(mapInFlight).filter((row): row is InFlightRecord => row !== null);
  const current = cycles[0];
  const wakeIds = new Set(cycles.flatMap((row) => row.wake_id ? [row.wake_id] : []));
  const eventIds = new Set(cycles.flatMap((row) => row.trigger_ref ? [row.trigger_ref] : []));
  if (wakeIds.size > 0) {
    const values = [...wakeIds];
    for (const row of db.prepare(
      `SELECT id FROM inbox_events WHERE wake_id IN (${values.map(() => "?").join(",")})`,
    ).all(...values) as Array<{ id: string }>) eventIds.add(row.id);
  }
  const attemptIds = new Set<string>();
  if (wakeIds.size > 0) {
    const values = [...wakeIds];
    for (const row of db.prepare(
      `SELECT attempt_id FROM durable_work_attempts WHERE wake_id IN (${values.map(() => "?").join(",")})`,
    ).all(...values) as Array<{ attempt_id: string }>) attemptIds.add(row.attempt_id);
  }
  const facts = acceptedEffectFacts(db, cycles);
  const acceptedRefs = facts.referenced;
  return withReceipts(db, rows.filter((row) => {
    if (facts.completed.has(row.effectId)) return false;
    if (row.cycleId === current.cycle_id) return true;
    const namedByAcceptedRef = cycles.some((candidate) =>
      acceptedRefs.has(mintEffectRef(candidate.cycle_id, candidate.generation, row.effectId)));
    if (namedByAcceptedRef) return true;
    if (row.wakeId && wakeIds.has(row.wakeId)) return true;
    if (row.originEventId && eventIds.has(row.originEventId)) return true;
    if (row.originAttemptId && attemptIds.has(row.originAttemptId)) return true;
    return false;
  }));
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
