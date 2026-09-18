import type { DatabaseSync } from "node:sqlite";
import { sha256, stableJson } from "../../model-fabric/hash.js";

export const MAX_ACTIVE_WORKERS = 1 as const;
export const MAX_NONTERMINAL_WORKER_UNDERTAKINGS = 64 as const;
export const MAX_PENDING_CURIOSITY = 3 as const;
export const CURIOSITY_TTL_MS = 48 * 60 * 60 * 1000;
export const WORKER_DISPATCH_CLAIM_LEASE_MS = 120_000 as const;

export type WorkerUndertakingSemanticKind = "project.inspect";
export type WorkerOriginKind = "OWNER_REQUEST" | "ASHLEY_COMMITMENT" | "ASHLEY_CURIOSITY";
export type WorkerUndertakingState =
  | "queued"
  | "dispatching"
  | "running"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "cancelled"
  | "superseded"
  | "expired";
export type WorkerUndertakingTerminalState = Exclude<
  WorkerUndertakingState,
  "queued" | "dispatching" | "running"
>;
export type WorkerQueueBlockedReason = "worker_busy" | "capacity";

export type WorkerUndertakingOrigin = {
  kind: WorkerOriginKind;
  ref: string;
  ownerEventId?: string | null;
  evidenceRowId?: string | null;
};

export type EnqueueWorkerUndertakingInput = {
  semanticKind: WorkerUndertakingSemanticKind;
  origin: WorkerUndertakingOrigin;
  ownerId: string;
  conversationId?: string | null;
  originCycleId: string;
  originGeneration: number;
  request: Record<string, unknown>;
  purpose: string;
  evidenceNeed: string;
  nowMs?: number;
};

export type WorkerUndertakingRecord = {
  undertakingId: string;
  semanticKind: WorkerUndertakingSemanticKind;
  originKind: WorkerOriginKind;
  originRef: string;
  ownerId: string;
  conversationId: string | null;
  originCycleId: string;
  originGeneration: number;
  originOwnerEventId: string | null;
  originEvidenceRowId: string | null;
  requestJson: string;
  purpose: string;
  evidenceNeed: string;
  admissionKey: string;
  state: WorkerUndertakingState;
  blockedReason: WorkerQueueBlockedReason | null;
  queuedAtMs: number;
  updatedAtMs: number;
  curiosityExpiresAtMs: number | null;
  selectedOperationId: string | null;
  selectedCalendarIndex: number | null;
  acknowledgementRef: string | null;
  cancelRequestedAtMs: number | null;
  supersededBy: string | null;
  terminalReason: string | null;
  terminalAtMs: number | null;
  dispatchClaimToken: string | null;
  dispatchClaimExpiresAtMs: number | null;
  capacityWaitStartedAtMs: number | null;
  capacityNextProbeAtMs: number | null;
};

export type WorkerUndertakingAdmissionResult =
  | { ok: true; undertaking: WorkerUndertakingRecord; created: boolean }
  | { ok: false; reason: "invalid_admission" | "queue_capacity_exhausted" | "curiosity_pending_capacity" | "queue_admission_retryable" | "queue_admission_failed" };

export type WorkerUndertakingMutationResult =
  | { ok: true; undertaking: WorkerUndertakingRecord; changed: boolean }
  | { ok: false; reason: "invalid_request" | "undertaking_missing" | "undertaking_terminal" | "undertaking_not_queued" | "mutation_failed" };

export type WorkerExecutionSlot = {
  undertakingId: string | null;
  operationId: string | null;
  claimToken: string | null;
  claimExpiresAtMs: number | null;
  updatedAtMs: number;
};

export const WORKER_SERVICE_CALENDAR: readonly WorkerOriginKind[] = [
  "OWNER_REQUEST",
  "ASHLEY_COMMITMENT",
  "OWNER_REQUEST",
  "ASHLEY_CURIOSITY",
  "OWNER_REQUEST",
  "ASHLEY_COMMITMENT",
  "OWNER_REQUEST",
];

function safeMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableMs(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function parseRequest(value: unknown): Record<string, unknown> | null {
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

function mapRow(row: Record<string, unknown>): WorkerUndertakingRecord {
  return {
    undertakingId: String(row.undertaking_id),
    semanticKind: row.semantic_kind as WorkerUndertakingSemanticKind,
    originKind: row.origin_kind as WorkerOriginKind,
    originRef: String(row.origin_ref),
    ownerId: String(row.owner_id),
    conversationId: nullableString(row.conversation_id),
    originCycleId: String(row.origin_cycle_id),
    originGeneration: Number(row.origin_generation),
    originOwnerEventId: nullableString(row.origin_owner_event_id),
    originEvidenceRowId: nullableString(row.origin_evidence_row_id),
    requestJson: String(row.request_json),
    purpose: String(row.purpose),
    evidenceNeed: String(row.evidence_need),
    admissionKey: String(row.admission_key),
    state: row.state as WorkerUndertakingState,
    blockedReason: row.blocked_reason === "worker_busy" || row.blocked_reason === "capacity"
      ? row.blocked_reason
      : null,
    queuedAtMs: Number(row.queued_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
    curiosityExpiresAtMs: nullableMs(row.curiosity_expires_at_ms),
    selectedOperationId: nullableString(row.selected_operation_id),
    selectedCalendarIndex: nullableMs(row.selected_calendar_index),
    acknowledgementRef: nullableString(row.acknowledgement_ref),
    cancelRequestedAtMs: nullableMs(row.cancel_requested_at_ms),
    supersededBy: nullableString(row.superseded_by),
    terminalReason: nullableString(row.terminal_reason),
    terminalAtMs: nullableMs(row.terminal_at_ms),
    dispatchClaimToken: nullableString(row.dispatch_claim_token),
    dispatchClaimExpiresAtMs: nullableMs(row.dispatch_claim_expires_at_ms),
    capacityWaitStartedAtMs: nullableMs(row.capacity_wait_started_at_ms),
    capacityNextProbeAtMs: nullableMs(row.capacity_next_probe_at_ms),
  };
}

function rowById(sidecar: DatabaseSync, undertakingId: string): WorkerUndertakingRecord | null {
  const row = sidecar
    .prepare("SELECT * FROM worker_undertakings WHERE undertaking_id = ?")
    .get(undertakingId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

function rowByAdmissionKey(sidecar: DatabaseSync, admissionKey: string): WorkerUndertakingRecord | null {
  const row = sidecar
    .prepare("SELECT * FROM worker_undertakings WHERE admission_key = ?")
    .get(admissionKey) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

function rollback(sidecar: DatabaseSync): void {
  try { sidecar.exec("ROLLBACK"); } catch { /* preserve the primary failure */ }
}

function originIsValid(origin: WorkerUndertakingOrigin): boolean {
  if (!origin || !nonEmpty(origin.kind) || !nonEmpty(origin.ref)) return false;
  if (origin.kind === "OWNER_REQUEST") {
    return nonEmpty(origin.ownerEventId) && origin.ownerEventId === origin.ref;
  }
  return origin.ownerEventId == null;
}

function canonicalAdmissionKey(input: EnqueueWorkerUndertakingInput, requestJson: string): string {
  return `worker-undertaking-admission:${sha256({
    semanticKind: input.semanticKind,
    origin: {
      kind: input.origin.kind,
      ref: input.origin.ref,
      ownerEventId: input.origin.ownerEventId ?? null,
      evidenceRowId: input.origin.evidenceRowId ?? null,
    },
    ownerId: input.ownerId,
    conversationId: input.conversationId ?? null,
    originCycleId: input.originCycleId,
    originGeneration: input.originGeneration,
    requestJson,
    purpose: input.purpose,
    evidenceNeed: input.evidenceNeed,
  })}`;
}

function retryableSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked|cannot start a transaction within a transaction|busy/i.test(message);
}

export function workerUndertakingIdFor(admissionKey: string): string {
  return `worker-undertaking:${sha256(admissionKey)}`;
}

export function detachedIdempotencyKeyForWorkerUndertaking(undertakingId: string): string {
  return `detached-for-worker-undertaking:${undertakingId}`;
}

export function getWorkerUndertaking(
  sidecar: DatabaseSync,
  undertakingId: string,
): WorkerUndertakingRecord | null {
  return nonEmpty(undertakingId) ? rowById(sidecar, undertakingId) : null;
}

export function getWorkerUndertakingByAdmissionKey(
  sidecar: DatabaseSync,
  admissionKey: string,
): WorkerUndertakingRecord | null {
  return nonEmpty(admissionKey) ? rowByAdmissionKey(sidecar, admissionKey) : null;
}

export function enqueueWorkerUndertaking(
  sidecar: DatabaseSync,
  input: EnqueueWorkerUndertakingInput,
): WorkerUndertakingAdmissionResult {
  const nowMs = input.nowMs ?? Date.now();
  if (
    input.semanticKind !== "project.inspect"
    || !nonEmpty(input.ownerId)
    || !nonEmpty(input.originCycleId)
    || !Number.isSafeInteger(input.originGeneration)
    || input.originGeneration < 0
    || !originIsValid(input.origin)
    || !safeMs(nowMs)
    || typeof input.request !== "object"
    || input.request === null
    || Array.isArray(input.request)
    || !nonEmpty(input.purpose)
    || !nonEmpty(input.evidenceNeed)
  ) {
    return { ok: false, reason: "invalid_admission" };
  }
  const projectId = input.request.projectId;
  if (!nonEmpty(projectId)) return { ok: false, reason: "invalid_admission" };

  let requestJson: string;
  try {
    requestJson = stableJson(input.request);
    JSON.parse(requestJson);
  } catch {
    return { ok: false, reason: "invalid_admission" };
  }
  const admissionKey = canonicalAdmissionKey(input, requestJson);
  const undertakingId = workerUndertakingIdFor(admissionKey);
  const curiosityExpiresAtMs = input.origin.kind === "ASHLEY_CURIOSITY"
    ? nowMs + CURIOSITY_TTL_MS
    : null;

  try {
    sidecar.exec("BEGIN IMMEDIATE");
    const existing = rowByAdmissionKey(sidecar, admissionKey);
    if (existing) {
      sidecar.exec("COMMIT");
      return { ok: true, undertaking: existing, created: false };
    }
    if (input.origin.kind === "OWNER_REQUEST") {
      const predOwnerEventId = input.origin.ownerEventId ?? input.origin.ref;
      const activeCandidates = sidecar.prepare(
        `SELECT * FROM worker_undertakings
          WHERE origin_kind = 'OWNER_REQUEST'
            AND (origin_ref = ? OR origin_owner_event_id = ?)
            AND semantic_kind = ?
            AND state IN ('queued', 'dispatching', 'running')`,
      ).all(predOwnerEventId, predOwnerEventId, input.semanticKind) as Record<string, unknown>[];

      const exactMatch = activeCandidates.find((candidate) => {
        const candidatePurpose = String(candidate.purpose ?? "");
        const candidateNeed = String(candidate.evidence_need ?? "");
        const candidateReqJson = String(candidate.request_json ?? "");
        let candidateCanonicalReq = candidateReqJson;
        try {
          const parsed = JSON.parse(candidateReqJson);
          candidateCanonicalReq = stableJson(parsed);
        } catch {
          // preserve raw
        }
        return (
          candidatePurpose === input.purpose &&
          candidateNeed === input.evidenceNeed &&
          candidateCanonicalReq === requestJson
        );
      });

      if (exactMatch) {
        sidecar.exec("COMMIT");
        return { ok: true, undertaking: mapRow(exactMatch), created: false };
      }
    }
    const nonterminal = Number((sidecar.prepare(
      `SELECT COUNT(*) AS count FROM worker_undertakings
        WHERE state IN ('queued', 'dispatching', 'running')`,
    ).get() as { count?: unknown }).count ?? 0);
    if (nonterminal >= MAX_NONTERMINAL_WORKER_UNDERTAKINGS) {
      rollback(sidecar);
      return { ok: false, reason: "queue_capacity_exhausted" };
    }
    if (input.origin.kind === "ASHLEY_CURIOSITY") {
      const pendingCuriosity = Number((sidecar.prepare(
        `SELECT COUNT(*) AS count FROM worker_undertakings
          WHERE origin_kind = 'ASHLEY_CURIOSITY' AND state IN ('queued', 'dispatching')`,
      ).get() as { count?: unknown }).count ?? 0);
      if (pendingCuriosity >= MAX_PENDING_CURIOSITY) {
        rollback(sidecar);
        return { ok: false, reason: "curiosity_pending_capacity" };
      }
    }
    sidecar.prepare(
      `INSERT INTO worker_undertakings (
         undertaking_id, semantic_kind, origin_kind, origin_ref, owner_id,
         conversation_id, origin_cycle_id, origin_generation,
         origin_owner_event_id, origin_evidence_row_id, request_json,
         purpose, evidence_need, admission_key, state, blocked_reason,
         queued_at_ms, updated_at_ms, curiosity_expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?)`,
    ).run(
      undertakingId,
      input.semanticKind,
      input.origin.kind,
      input.origin.ref,
      input.ownerId,
      input.conversationId ?? null,
      input.originCycleId,
      input.originGeneration,
      input.origin.ownerEventId ?? null,
      input.origin.evidenceRowId ?? null,
      requestJson,
      input.purpose,
      input.evidenceNeed,
      admissionKey,
      nowMs,
      nowMs,
      curiosityExpiresAtMs,
    );
    sidecar.exec("COMMIT");
  } catch (error) {
    rollback(sidecar);
    const winner = rowByAdmissionKey(sidecar, admissionKey);
    if (winner) return { ok: true, undertaking: winner, created: false };
    if (retryableSqliteError(error)) return { ok: false, reason: "queue_admission_retryable" };
    return { ok: false, reason: "queue_admission_failed" };
  }
  const created = rowById(sidecar, undertakingId);
  return created
    ? { ok: true, undertaking: created, created: true }
    : { ok: false, reason: "queue_admission_failed" };
}

export type WorkerUndertakingSelection = {
  undertaking: WorkerUndertakingRecord;
  calendarIndex: number;
  selectedClass: WorkerOriginKind;
  skippedEmptyClasses: number;
};

export function getWorkerSchedulerCursor(sidecar: DatabaseSync): number {
  const row = sidecar.prepare(
    "SELECT cursor FROM worker_undertaking_scheduler WHERE scheduler_id = 1",
  ).get() as { cursor?: unknown } | undefined;
  const cursor = Number(row?.cursor ?? 0);
  return Number.isInteger(cursor) && cursor >= 0 && cursor < WORKER_SERVICE_CALENDAR.length ? cursor : 0;
}

export function selectNextWorkerUndertaking(
  sidecar: DatabaseSync,
  nowMs: number,
): WorkerUndertakingSelection | null {
  if (!safeMs(nowMs)) return null;
  const cursor = getWorkerSchedulerCursor(sidecar);
  for (let offset = 0; offset < WORKER_SERVICE_CALENDAR.length; offset += 1) {
    const calendarIndex = (cursor + offset) % WORKER_SERVICE_CALENDAR.length;
    const selectedClass = WORKER_SERVICE_CALENDAR[calendarIndex];
    const row = sidecar.prepare(
      `SELECT * FROM worker_undertakings
        WHERE state = 'queued'
          AND origin_kind = ?
          AND (curiosity_expires_at_ms IS NULL OR curiosity_expires_at_ms > ?)
          AND (capacity_next_probe_at_ms IS NULL OR capacity_next_probe_at_ms <= ?)
        ORDER BY queued_at_ms ASC, undertaking_id ASC
        LIMIT 1`,
    ).get(selectedClass, nowMs, nowMs) as Record<string, unknown> | undefined;
    if (row) {
      return {
        undertaking: mapRow(row),
        calendarIndex,
        selectedClass,
        skippedEmptyClasses: offset,
      };
    }
  }
  return null;
}

export function listDispatchingWorkerUndertakings(
  sidecar: DatabaseSync,
  limit = 50,
): WorkerUndertakingRecord[] {
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.max(1, Math.min(100, limit))
    : 50;
  const rows = sidecar.prepare(
    `SELECT * FROM worker_undertakings
      WHERE state IN ('dispatching', 'running')
      ORDER BY queued_at_ms ASC, undertaking_id ASC
      LIMIT ?`,
  ).all(boundedLimit) as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export function getWorkerExecutionSlot(sidecar: DatabaseSync): WorkerExecutionSlot {
  const row = sidecar.prepare(
    "SELECT undertaking_id, operation_id, claim_token, claim_expires_at_ms, updated_at_ms FROM worker_execution_slot WHERE slot_id = 1",
  ).get() as Record<string, unknown> | undefined;
  return {
    undertakingId: nullableString(row?.undertaking_id),
    operationId: nullableString(row?.operation_id),
    claimToken: nullableString(row?.claim_token),
    claimExpiresAtMs: nullableMs(row?.claim_expires_at_ms),
    updatedAtMs: Number(row?.updated_at_ms ?? 0),
  };
}

export function markWorkerUndertakingCapacity(
  sidecar: DatabaseSync,
  undertakingId: string,
  input: { reason: string; nextProbeAtMs?: number | null; nowMs?: number },
): WorkerUndertakingRecord | null {
  const nowMs = input.nowMs ?? Date.now();
  if (!nonEmpty(undertakingId) || !nonEmpty(input.reason) || !safeMs(nowMs)) return null;
  const nextProbeAtMs = input.nextProbeAtMs ?? null;
  if (nextProbeAtMs !== null && !safeMs(nextProbeAtMs)) return null;
  sidecar.prepare(
    `UPDATE worker_undertakings
        SET blocked_reason = 'capacity',
            capacity_wait_started_at_ms = COALESCE(capacity_wait_started_at_ms, ?),
            capacity_next_probe_at_ms = ?,
            updated_at_ms = ?
      WHERE undertaking_id = ? AND state IN ('queued', 'dispatching')`,
  ).run(nowMs, nextProbeAtMs, nowMs, undertakingId);
  return rowById(sidecar, undertakingId);
}

/** Return a bound but not-started undertaking to the queue after a capacity race. */
export function requeueWorkerUndertakingAfterCapacity(
  sidecar: DatabaseSync,
  undertakingId: string,
  input: { reason: string; nextProbeAtMs?: number | null; nowMs?: number },
): WorkerUndertakingRecord | null {
  const nowMs = input.nowMs ?? Date.now();
  const nextProbeAtMs = input.nextProbeAtMs ?? null;
  if (!nonEmpty(undertakingId) || !nonEmpty(input.reason) || !safeMs(nowMs)) return null;
  if (nextProbeAtMs !== null && !safeMs(nextProbeAtMs)) return null;
  try {
    sidecar.exec("BEGIN IMMEDIATE");
    const current = rowById(sidecar, undertakingId);
    if (!current) {
      rollback(sidecar);
      return null;
    }
    if (current.state === "queued") {
      sidecar.exec("COMMIT");
      return current;
    }
    if (current.state !== "dispatching") {
      rollback(sidecar);
      return current;
    }
    sidecar.prepare(
      `UPDATE worker_undertakings
          SET state = 'queued', blocked_reason = 'capacity',
              selected_calendar_index = NULL,
              dispatch_claim_token = NULL, dispatch_claim_expires_at_ms = NULL,
              capacity_wait_started_at_ms = COALESCE(capacity_wait_started_at_ms, ?),
              capacity_next_probe_at_ms = ?, updated_at_ms = ?
        WHERE undertaking_id = ? AND state = 'dispatching'`,
    ).run(nowMs, nextProbeAtMs, nowMs, undertakingId);
    sidecar.prepare(
      `UPDATE worker_execution_slot
          SET undertaking_id = NULL, operation_id = NULL, claim_token = NULL,
              claim_expires_at_ms = NULL, updated_at_ms = ?
        WHERE slot_id = 1 AND undertaking_id = ?`,
    ).run(nowMs, undertakingId);
    sidecar.exec("COMMIT");
    return rowById(sidecar, undertakingId);
  } catch {
    rollback(sidecar);
    return null;
  }
}

export function markWorkerUndertakingWorkerBusy(
  sidecar: DatabaseSync,
  undertakingId: string,
  nowMs = Date.now(),
): WorkerUndertakingRecord | null {
  if (!nonEmpty(undertakingId) || !safeMs(nowMs)) return null;
  sidecar.prepare(
    `UPDATE worker_undertakings
        SET blocked_reason = 'worker_busy', capacity_next_probe_at_ms = NULL, updated_at_ms = ?
      WHERE undertaking_id = ? AND state = 'queued'`,
  ).run(nowMs, undertakingId);
  return rowById(sidecar, undertakingId);
}

/** Cancel queued semantic work before it can acquire the execution slot. */
export function requestWorkerUndertakingCancel(
  sidecar: DatabaseSync,
  undertakingId: string,
  nowMs = Date.now(),
): WorkerUndertakingMutationResult {
  if (!nonEmpty(undertakingId) || !safeMs(nowMs)) return { ok: false, reason: "invalid_request" };
  const current = rowById(sidecar, undertakingId);
  if (!current) return { ok: false, reason: "undertaking_missing" };
  if (current.state === "queued") {
    sidecar.prepare(
      `UPDATE worker_undertakings
          SET state = 'cancelled', blocked_reason = NULL,
              cancel_requested_at_ms = COALESCE(cancel_requested_at_ms, ?),
              terminal_reason = COALESCE(terminal_reason, 'cancel_requested'),
              terminal_at_ms = COALESCE(terminal_at_ms, ?), updated_at_ms = ?
        WHERE undertaking_id = ? AND state = 'queued'`,
    ).run(nowMs, nowMs, nowMs, undertakingId);
    const updated = rowById(sidecar, undertakingId);
    return updated ? { ok: true, undertaking: updated, changed: updated.state === "cancelled" } : { ok: false, reason: "mutation_failed" };
  }
  if (current.state === "dispatching" || current.state === "running") {
    sidecar.prepare(
      `UPDATE worker_undertakings
          SET cancel_requested_at_ms = COALESCE(cancel_requested_at_ms, ?), updated_at_ms = ?
        WHERE undertaking_id = ? AND state IN ('dispatching', 'running')`,
    ).run(nowMs, nowMs, undertakingId);
    const updated = rowById(sidecar, undertakingId);
    return updated ? { ok: true, undertaking: updated, changed: updated.cancelRequestedAtMs === nowMs } : { ok: false, reason: "mutation_failed" };
  }
  return { ok: false, reason: "undertaking_terminal" };
}

/** Supersede queued work without manufacturing execution or stop truth. */
export function supersedeWorkerUndertaking(
  sidecar: DatabaseSync,
  undertakingId: string,
  input: { supersededBy: string; nowMs?: number },
): WorkerUndertakingMutationResult {
  const nowMs = input.nowMs ?? Date.now();
  if (!nonEmpty(undertakingId) || !nonEmpty(input.supersededBy) || !safeMs(nowMs)) {
    return { ok: false, reason: "invalid_request" };
  }
  const current = rowById(sidecar, undertakingId);
  if (!current) return { ok: false, reason: "undertaking_missing" };
  if (current.state !== "queued") {
    return current.state === "dispatching" || current.state === "running"
      ? { ok: false, reason: "undertaking_not_queued" }
      : { ok: false, reason: "undertaking_terminal" };
  }
  sidecar.prepare(
    `UPDATE worker_undertakings
        SET state = 'superseded', blocked_reason = NULL, superseded_by = ?,
            terminal_reason = 'superseded', terminal_at_ms = ?, updated_at_ms = ?
      WHERE undertaking_id = ? AND state = 'queued'`,
  ).run(input.supersededBy, nowMs, nowMs, undertakingId);
  const updated = rowById(sidecar, undertakingId);
  return updated ? { ok: true, undertaking: updated, changed: updated.state === "superseded" } : { ok: false, reason: "mutation_failed" };
}

export function markWorkerUndertakingRunning(
  sidecar: DatabaseSync,
  undertakingId: string,
  operationId: string,
  nowMs = Date.now(),
): WorkerUndertakingRecord | null {
  if (!nonEmpty(undertakingId) || !nonEmpty(operationId) || !safeMs(nowMs)) return null;
  try {
    sidecar.exec("BEGIN IMMEDIATE");
    const current = rowById(sidecar, undertakingId);
    if (!current || current.selectedOperationId !== operationId) {
      rollback(sidecar);
      return null;
    }
    if (current.state === "running") {
      sidecar.exec("COMMIT");
      return current;
    }
    if (current.state !== "dispatching") {
      rollback(sidecar);
      return null;
    }
    const changed = sidecar.prepare(
      `UPDATE worker_undertakings
          SET state = 'running', blocked_reason = NULL,
              dispatch_claim_expires_at_ms = NULL, capacity_next_probe_at_ms = NULL,
              updated_at_ms = ?
        WHERE undertaking_id = ? AND state = 'dispatching' AND selected_operation_id = ?`,
    ).run(nowMs, undertakingId, operationId);
    const slot = sidecar.prepare(
      `UPDATE worker_execution_slot
          SET operation_id = ?, claim_expires_at_ms = NULL, updated_at_ms = ?
        WHERE slot_id = 1 AND undertaking_id = ?`,
    ).run(operationId, nowMs, undertakingId);
    if (Number(changed.changes ?? 0) !== 1 || Number(slot.changes ?? 0) !== 1) {
      rollback(sidecar);
      return null;
    }
    if (current.selectedCalendarIndex !== null) {
      const nextCursor = (current.selectedCalendarIndex + 1) % WORKER_SERVICE_CALENDAR.length;
      sidecar.prepare(
        "UPDATE worker_undertaking_scheduler SET cursor = ?, updated_at_ms = ? WHERE scheduler_id = 1",
      ).run(nextCursor, nowMs);
    }
    sidecar.exec("COMMIT");
    return rowById(sidecar, undertakingId);
  } catch {
    rollback(sidecar);
    return null;
  }
}

export function releaseWorkerExecutionSlot(
  sidecar: DatabaseSync,
  undertakingId: string,
  nowMs = Date.now(),
): boolean {
  if (!nonEmpty(undertakingId) || !safeMs(nowMs)) return false;
  const result = sidecar.prepare(
    `UPDATE worker_execution_slot
        SET undertaking_id = NULL, operation_id = NULL, claim_token = NULL,
            claim_expires_at_ms = NULL, updated_at_ms = ?
      WHERE slot_id = 1 AND undertaking_id = ?`,
  ).run(nowMs, undertakingId);
  return Number(result.changes ?? 0) === 1;
}

export function projectWorkerUndertakingTerminal(
  sidecar: DatabaseSync,
  undertakingId: string,
  terminalState: "succeeded" | "failed" | "outcome_unknown" | "cancelled" | "superseded" | "expired" | "stopped",
  terminalReason: string | null,
  nowMs = Date.now(),
): WorkerUndertakingRecord | null {
  if (!nonEmpty(undertakingId) || !safeMs(nowMs)) return null;
  try {
    sidecar.exec("BEGIN IMMEDIATE");
    const current = rowById(sidecar, undertakingId);
    if (!current) {
      rollback(sidecar);
      return null;
    }
    if (["succeeded", "failed", "outcome_unknown", "cancelled", "superseded", "expired"].includes(current.state)) {
      sidecar.exec("COMMIT");
      return current;
    }
    let state: WorkerUndertakingTerminalState = terminalState === "stopped" ? "failed" : terminalState;
    let reason = terminalReason ?? terminalState;
    if (current.selectedOperationId) {
      const detached = sidecar.prepare(
        "SELECT terminal_state, error_code FROM detached_operations WHERE operation_id = ?",
      ).get(current.selectedOperationId) as { terminal_state?: unknown; error_code?: unknown } | undefined;
      if (terminalState !== "expired" && detached?.terminal_state) {
        state = detached.terminal_state === "stopped" ? "failed" : detached.terminal_state as WorkerUndertakingTerminalState;
        reason = typeof detached.error_code === "string" && detached.error_code.length > 0
          ? detached.error_code
          : reason;
      } else if (terminalState !== "expired" && state === "succeeded") {
        // A successful queue outcome requires durable detached success truth.
        rollback(sidecar);
        return null;
      }
    }
    sidecar.prepare(
      `UPDATE worker_undertakings
          SET state = ?, blocked_reason = NULL, terminal_reason = ?, terminal_at_ms = ?,
              dispatch_claim_token = NULL, dispatch_claim_expires_at_ms = NULL,
              capacity_next_probe_at_ms = NULL, updated_at_ms = ?
        WHERE undertaking_id = ? AND state IN ('dispatching', 'running', 'queued')`,
    ).run(state, reason, nowMs, nowMs, undertakingId);
    // This update is deliberately in the same transaction as queue terminal
    // truth. Its predicate prevents clearing another undertaking's slot.
    sidecar.prepare(
      `UPDATE worker_execution_slot
          SET undertaking_id = NULL, operation_id = NULL, claim_token = NULL,
              claim_expires_at_ms = NULL, updated_at_ms = ?
        WHERE slot_id = 1 AND undertaking_id = ?`,
    ).run(nowMs, undertakingId);
    sidecar.exec("COMMIT");
    return rowById(sidecar, undertakingId);
  } catch {
    rollback(sidecar);
    return null;
  }
}

function clearWorkerExecutionSlot(
  sidecar: DatabaseSync,
  undertakingId: string,
  nowMs: number,
): boolean {
  const result = sidecar.prepare(
    `UPDATE worker_execution_slot
        SET undertaking_id = NULL, operation_id = NULL, claim_token = NULL,
            claim_expires_at_ms = NULL, updated_at_ms = ?
      WHERE slot_id = 1 AND undertaking_id = ?`,
  ).run(nowMs, undertakingId);
  return Number(result.changes ?? 0) === 1;
}

/** Repair only stale ownership; preserve a slot for a genuinely started worker. */
export function repairWorkerExecutionSlot(
  sidecar: DatabaseSync,
  nowMs = Date.now(),
): string[] {
  if (!safeMs(nowMs)) return [];
  const slot = getWorkerExecutionSlot(sidecar);
  if (!slot.undertakingId) return [];
  const repaired: string[] = [];
  const undertaking = rowById(sidecar, slot.undertakingId);
  if (!undertaking) {
    clearWorkerExecutionSlot(sidecar, slot.undertakingId, nowMs);
    return repaired;
  }
  if (["succeeded", "failed", "outcome_unknown", "cancelled", "superseded", "expired"].includes(undertaking.state)) {
    clearWorkerExecutionSlot(sidecar, undertaking.undertakingId, nowMs);
    repaired.push(undertaking.undertakingId);
    return repaired;
  }
  const operation = undertaking.selectedOperationId
    ? sidecar.prepare(
      "SELECT state, terminal_state, error_code FROM detached_operations WHERE operation_id = ?",
    ).get(undertaking.selectedOperationId) as { state?: unknown; terminal_state?: unknown; error_code?: unknown } | undefined
    : undefined;
  if (operation?.terminal_state) {
    if (projectWorkerUndertakingTerminal(
      sidecar,
      undertaking.undertakingId,
      operation.terminal_state === "stopped" ? "failed" : operation.terminal_state as WorkerUndertakingTerminalState,
      typeof operation.error_code === "string" ? operation.error_code : "recovered_detached_terminal",
      nowMs,
    )) repaired.push(undertaking.undertakingId);
    return repaired;
  }
  if (operation && (operation.state === "admitted" || operation.state === "waiting_capacity")) {
    const reset = requeueWorkerUndertakingAfterCapacity(sidecar, undertaking.undertakingId, {
      reason: "recovered_pre_start_capacity_claim",
      nextProbeAtMs: nowMs,
      nowMs,
    });
    if (reset) repaired.push(undertaking.undertakingId);
    return repaired;
  }
  if (operation?.state === "started") {
    // The slot remains occupied. Queue projection is repaired separately by
    // the next service pass, but no started worker is cleared or rerun.
    return repaired;
  }
  if (undertaking.state === "dispatching") {
    const reset = sidecar.prepare(
      `UPDATE worker_undertakings
          SET state = 'queued', selected_operation_id = NULL,
              selected_calendar_index = NULL, dispatch_claim_token = NULL,
              dispatch_claim_expires_at_ms = NULL, blocked_reason = NULL,
              updated_at_ms = ?
        WHERE undertaking_id = ? AND state = 'dispatching'`,
    ).run(nowMs, undertaking.undertakingId);
    clearWorkerExecutionSlot(sidecar, undertaking.undertakingId, nowMs);
    if (Number(reset.changes ?? 0) === 1) repaired.push(undertaking.undertakingId);
  } else if (undertaking.state === "running") {
    // A running undertaking with no detached identity is an ambiguous
    // execution boundary. Preserve no rerun path and converge to unknown.
    if (projectWorkerUndertakingTerminal(
      sidecar,
      undertaking.undertakingId,
      "outcome_unknown",
      "detached_operation_missing_at_recovery",
      nowMs,
    )) repaired.push(undertaking.undertakingId);
  }
  return repaired;
}

export function expireQueuedCuriosity(
  sidecar: DatabaseSync,
  nowMs = Date.now(),
): string[] {
  if (!safeMs(nowMs)) return [];
  const rows = sidecar.prepare(
    `SELECT undertaking_id FROM worker_undertakings
      WHERE origin_kind = 'ASHLEY_CURIOSITY'
        AND state = 'queued'
        AND curiosity_expires_at_ms IS NOT NULL
        AND curiosity_expires_at_ms <= ?
      ORDER BY curiosity_expires_at_ms ASC, undertaking_id ASC`,
  ).all(nowMs) as Array<{ undertaking_id?: unknown }>;
  const ids = rows
    .map((row) => row.undertaking_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  for (const id of ids) projectWorkerUndertakingTerminal(sidecar, id, "expired", "curiosity_ttl_expired", nowMs);
  return ids;
}

export type WorkerUndertakingBindingResult =
  | { ok: true; undertaking: WorkerUndertakingRecord; operationId: string; created: boolean }
  | { ok: false; reason: "worker_busy" | "undertaking_missing" | "undertaking_not_queued" | "binding_failed" };

export function bindWorkerUndertakingToOperation(
  sidecar: DatabaseSync,
  input: {
    undertakingId: string;
    operationId: string;
    calendarIndex: number;
    nowMs?: number;
    claimLeaseMs?: number;
    admitOperation: () => { ok: true; operationId: string; created: boolean } | { ok: false; reason: string };
  },
): WorkerUndertakingBindingResult {
  const nowMs = input.nowMs ?? Date.now();
  const claimLeaseMs = input.claimLeaseMs ?? WORKER_DISPATCH_CLAIM_LEASE_MS;
  if (
    !nonEmpty(input.undertakingId)
    || !nonEmpty(input.operationId)
    || !Number.isInteger(input.calendarIndex)
    || input.calendarIndex < 0
    || input.calendarIndex >= WORKER_SERVICE_CALENDAR.length
    || !safeMs(nowMs)
    || !Number.isSafeInteger(claimLeaseMs)
    || claimLeaseMs <= 0
  ) return { ok: false, reason: "binding_failed" };
  try {
    sidecar.exec("BEGIN IMMEDIATE");
    const current = rowById(sidecar, input.undertakingId);
    if (!current) {
      rollback(sidecar);
      return { ok: false, reason: "undertaking_missing" };
    }
    if (current.state === "dispatching" && current.selectedOperationId === input.operationId) {
      const slot = getWorkerExecutionSlot(sidecar);
      if (slot.undertakingId && slot.undertakingId !== input.undertakingId) {
        rollback(sidecar);
        return { ok: false, reason: "worker_busy" };
      }
      if (!slot.undertakingId) {
        const claimToken = current.dispatchClaimToken ?? `worker-claim:${input.undertakingId}:${nowMs}`;
        sidecar.prepare(
          `UPDATE worker_execution_slot
              SET undertaking_id = ?, operation_id = ?, claim_token = ?,
                  claim_expires_at_ms = ?, updated_at_ms = ?
            WHERE slot_id = 1 AND undertaking_id IS NULL`,
        ).run(input.undertakingId, input.operationId, claimToken, nowMs + claimLeaseMs, nowMs);
      }
      const claimed = getWorkerExecutionSlot(sidecar);
      if (claimed.undertakingId !== input.undertakingId || claimed.operationId !== input.operationId) {
        rollback(sidecar);
        return { ok: false, reason: "worker_busy" };
      }
      sidecar.exec("COMMIT");
      return { ok: true, undertaking: rowById(sidecar, input.undertakingId) ?? current, operationId: input.operationId, created: false };
    }
    if (current.state !== "queued") {
      rollback(sidecar);
      return { ok: false, reason: "undertaking_not_queued" };
    }
    const slot = getWorkerExecutionSlot(sidecar);
    if (slot.undertakingId) {
      rollback(sidecar);
      return { ok: false, reason: "worker_busy" };
    }
    const claimToken = `worker-claim:${input.undertakingId}:${nowMs}`;
    if (current.selectedOperationId && current.selectedOperationId !== input.operationId) {
      rollback(sidecar);
      return { ok: false, reason: "binding_failed" };
    }
    sidecar.prepare(
      `UPDATE worker_undertakings
          SET state = 'dispatching', blocked_reason = NULL,
              selected_operation_id = COALESCE(selected_operation_id, ?),
              selected_calendar_index = ?, dispatch_claim_token = ?,
              dispatch_claim_expires_at_ms = ?, updated_at_ms = ?
        WHERE undertaking_id = ? AND state = 'queued'`,
    ).run(input.operationId, input.calendarIndex, claimToken, nowMs + claimLeaseMs, nowMs, input.undertakingId);
    const admitted = input.admitOperation();
    if (!admitted.ok || admitted.operationId !== input.operationId) {
      rollback(sidecar);
      return { ok: false, reason: "binding_failed" };
    }
    sidecar.prepare(
      `UPDATE worker_execution_slot
          SET undertaking_id = ?, operation_id = ?, claim_token = ?,
              claim_expires_at_ms = ?, updated_at_ms = ?
        WHERE slot_id = 1 AND undertaking_id IS NULL`,
    ).run(input.undertakingId, input.operationId, claimToken, nowMs + claimLeaseMs, nowMs);
    const claimed = getWorkerExecutionSlot(sidecar);
    if (claimed.undertakingId !== input.undertakingId || claimed.operationId !== input.operationId) {
      rollback(sidecar);
      return { ok: false, reason: "worker_busy" };
    }
    sidecar.exec("COMMIT");
    const undertaking = rowById(sidecar, input.undertakingId);
    return undertaking
      ? { ok: true, undertaking, operationId: input.operationId, created: admitted.created }
      : { ok: false, reason: "binding_failed" };
  } catch {
    rollback(sidecar);
    return { ok: false, reason: "binding_failed" };
  }
}

export function recoverExpiredDispatchClaims(
  sidecar: DatabaseSync,
  nowMs = Date.now(),
): string[] {
  if (!safeMs(nowMs)) return [];
  const rows = sidecar.prepare(
    `SELECT undertaking_id, selected_operation_id FROM worker_undertakings
      WHERE state = 'dispatching'
        AND dispatch_claim_expires_at_ms IS NOT NULL
        AND dispatch_claim_expires_at_ms <= ?
      ORDER BY undertaking_id ASC`,
  ).all(nowMs) as Array<{ undertaking_id?: unknown; selected_operation_id?: unknown }>;
  const recovered: string[] = [];
  for (const row of rows) {
    const undertakingId = typeof row.undertaking_id === "string" ? row.undertaking_id : "";
    const operationId = typeof row.selected_operation_id === "string" ? row.selected_operation_id : "";
    if (!undertakingId) continue;
    // A committed queue claim normally commits the detached row in the same
    // transaction. If a legacy/partial claim is found after restart, retain
    // the undertaking only when its selected execution identity exists.
    // Otherwise the claim is safe to return to queued without minting a new
    // execution identity.
    if (operationId) {
      const operation = sidecar.prepare(
        "SELECT state, terminal_state FROM detached_operations WHERE operation_id = ? LIMIT 1",
      ).get(operationId) as { state?: unknown; terminal_state?: unknown } | undefined;
      if (operation?.terminal_state || operation?.state === "started") {
        // A started or terminal detached identity is already execution truth;
        // never turn it into a fresh queue admission.
        continue;
      }
      if (operation && (operation.state === "admitted" || operation.state === "waiting_capacity")) {
        sidecar.prepare(
          `UPDATE worker_undertakings
              SET state = 'queued', selected_calendar_index = NULL,
                  blocked_reason = 'capacity', dispatch_claim_token = NULL,
                  dispatch_claim_expires_at_ms = NULL, capacity_next_probe_at_ms = ?,
                  updated_at_ms = ?
            WHERE undertaking_id = ? AND state = 'dispatching'`,
        ).run(nowMs, nowMs, undertakingId);
        releaseWorkerExecutionSlot(sidecar, undertakingId, nowMs);
        recovered.push(undertakingId);
        continue;
      }
    }
    sidecar.prepare(
      `UPDATE worker_undertakings
          SET state = 'queued', selected_operation_id = NULL,
              selected_calendar_index = NULL,
              blocked_reason = NULL, dispatch_claim_token = NULL, dispatch_claim_expires_at_ms = NULL,
              updated_at_ms = ?
        WHERE undertaking_id = ? AND state = 'dispatching'`,
    ).run(nowMs, undertakingId);
    releaseWorkerExecutionSlot(sidecar, undertakingId, nowMs);
    recovered.push(undertakingId);
  }
  return recovered;
}

export function hasActiveOwnerWorkerUndertaking(
  sidecar: DatabaseSync,
  conversationId: string,
  originCycleId?: string,
): boolean {
  if (!nonEmpty(conversationId)) return false;
  const cycleClause = originCycleId ? " AND origin_cycle_id = ?" : "";
  const row = sidecar.prepare(
    `SELECT 1 FROM worker_undertakings
      WHERE origin_kind = 'OWNER_REQUEST'
        AND conversation_id = ?
        AND state IN ('queued', 'dispatching', 'running')
        ${cycleClause}
      LIMIT 1`,
  ).get(...(originCycleId ? [conversationId, originCycleId] : [conversationId]));
  return Boolean(row);
}

export function listWorkerUndertakings(
  sidecar: DatabaseSync,
  options: { limit?: number; state?: WorkerUndertakingState } = {},
): WorkerUndertakingRecord[] {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const rows = options.state
    ? sidecar.prepare(
      `SELECT * FROM worker_undertakings WHERE state = ?
        ORDER BY queued_at_ms ASC, undertaking_id ASC LIMIT ?`,
    ).all(options.state, limit)
    : sidecar.prepare(
      `SELECT * FROM worker_undertakings
        ORDER BY queued_at_ms ASC, undertaking_id ASC LIMIT ?`,
    ).all(limit);
  return (rows as Array<Record<string, unknown>>).map(mapRow);
}
