import type { DatabaseSync } from "node:sqlite";
import { sha256 } from "../../model-fabric/hash.js";

export type DetachedOperationKind = "project.investigate";

export type DetachedOperationState =
  | "admitted"
  | "started"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "cancelled"
  | "stopped";

export type DetachedOperationTerminalState =
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "cancelled"
  | "stopped";

export type DetachedOperationRecord = {
  operationId: string;
  conversationId: string;
  originCycleId: string;
  originGeneration: number;
  originOwnerEventId: string;
  originEvidenceRowId: string | null;
  operationKind: DetachedOperationKind;
  requestJson: string;
  purpose: string;
  evidenceNeed: string;
  admissionAtMs: number;
  operationDeadlineAtMs: number;
  idempotencyKey: string;
  workerBindingJson: string | null;
  startAtMs: number | null;
  startProofRef: string | null;
  terminalState: DetachedOperationTerminalState | null;
  terminalAtMs: number | null;
  observationRef: string | null;
  receiptRef: string | null;
  errorCode: string | null;
  interimOutboxRef: string | null;
  completionEventRef: string | null;
  cancelRequestedAtMs: number | null;
  supersededBy: string | null;
  successorOperationId: string | null;
  state: DetachedOperationState;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AdmitDetachedOperationInput = {
  idempotencyKey: string;
  conversationId: string;
  originCycleId: string;
  originGeneration: number;
  originOwnerEventId: string;
  originEvidenceRowId?: string | null;
  operationKind: DetachedOperationKind;
  /** Thought-authored Mode-B request; stored verbatim as JSON. */
  request: Record<string, unknown>;
  purpose: string;
  evidenceNeed: string;
  operationDeadlineAtMs: number;
  nowMs?: number;
};

export type StartDetachedOperationInput = {
  startProofRef: string;
  workerBinding?: Record<string, unknown> | null;
  nowMs?: number;
};

export type SetDetachedOperationTerminalInput = {
  terminalState: DetachedOperationTerminalState;
  observationRef?: string | null;
  receiptRef?: string | null;
  errorCode?: string | null;
  nowMs?: number;
};

export type DetachedOperationResult =
  | { ok: true; operation: DetachedOperationRecord; created: boolean }
  | { ok: false; reason: string };

export type DetachedOperationRead = DetachedOperationRecord | null;

/** Deterministic operation identity: retries and duplicate producers reuse it. */
export function detachedOperationIdFor(idempotencyKey: string): string {
  return `detached-operation:${sha256(idempotencyKey)}`;
}

const TERMINAL_STATES: ReadonlySet<DetachedOperationState> = new Set([
  "succeeded",
  "failed",
  "outcome_unknown",
  "cancelled",
  "stopped",
]);

function isTerminalState(state: DetachedOperationState): boolean {
  return TERMINAL_STATES.has(state);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

type DetachedRow = Record<string, unknown>;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function mapRow(row: DetachedRow): DetachedOperationRecord {
  return {
    operationId: String(row.operation_id),
    conversationId: String(row.conversation_id),
    originCycleId: String(row.origin_cycle_id),
    originGeneration: Number(row.origin_generation),
    originOwnerEventId: String(row.origin_owner_event_id),
    originEvidenceRowId: stringOrNull(row.origin_evidence_row_id),
    operationKind: row.operation_kind as DetachedOperationKind,
    requestJson: String(row.request_json),
    purpose: String(row.purpose),
    evidenceNeed: String(row.evidence_need),
    admissionAtMs: Number(row.admission_at_ms),
    operationDeadlineAtMs: Number(row.operation_deadline_at_ms),
    idempotencyKey: String(row.idempotency_key),
    workerBindingJson: stringOrNull(row.worker_binding_json),
    startAtMs: numberOrNull(row.start_at_ms),
    startProofRef: stringOrNull(row.start_proof_ref),
    terminalState: (row.terminal_state as DetachedOperationTerminalState | null) ?? null,
    terminalAtMs: numberOrNull(row.terminal_at_ms),
    observationRef: stringOrNull(row.observation_ref),
    receiptRef: stringOrNull(row.receipt_ref),
    errorCode: stringOrNull(row.error_code),
    interimOutboxRef: stringOrNull(row.interim_outbox_ref),
    completionEventRef: stringOrNull(row.completion_event_ref),
    cancelRequestedAtMs: numberOrNull(row.cancel_requested_at_ms),
    supersededBy: stringOrNull(row.superseded_by),
    successorOperationId: stringOrNull(row.successor_operation_id),
    state: row.state as DetachedOperationState,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export function getDetachedOperation(
  sidecar: DatabaseSync,
  operationId: string,
): DetachedOperationRead {
  const row = sidecar
    .prepare("SELECT * FROM detached_operations WHERE operation_id = ?")
    .get(operationId) as DetachedRow | undefined;
  return row ? mapRow(row) : null;
}

function getByIdempotencyKey(
  sidecar: DatabaseSync,
  idempotencyKey: string,
): DetachedOperationRead {
  const row = sidecar
    .prepare("SELECT * FROM detached_operations WHERE idempotency_key = ?")
    .get(idempotencyKey) as DetachedRow | undefined;
  return row ? mapRow(row) : null;
}

/**
 * Durably admit a detached investigation. Idempotent on the caller-supplied
 * idempotency key: a repeat admission returns the existing operation with
 * created=false and never mints a duplicate. A second *active* operation for
 * the same conversation is refused with operation_already_pending — work is
 * never queued.
 */
export function admitDetachedOperation(
  sidecar: DatabaseSync,
  input: AdmitDetachedOperationInput,
): DetachedOperationResult {
  const nowMs = input.nowMs ?? Date.now();
  if (
    !nonEmptyString(input.idempotencyKey)
    || !nonEmptyString(input.conversationId)
    || !nonEmptyString(input.originCycleId)
    || !Number.isSafeInteger(input.originGeneration)
    || !nonEmptyString(input.originOwnerEventId)
    || input.operationKind !== "project.investigate"
    || typeof input.request !== "object"
    || input.request === null
    || Array.isArray(input.request)
    || !nonEmptyString(input.purpose)
    || !nonEmptyString(input.evidenceNeed)
    || !safeMs(input.operationDeadlineAtMs)
    || !safeMs(nowMs)
    || input.operationDeadlineAtMs <= nowMs
  ) {
    return { ok: false, reason: "invalid_admission" };
  }

  let requestJson: string;
  try {
    requestJson = JSON.stringify(input.request);
    JSON.parse(requestJson);
  } catch {
    return { ok: false, reason: "invalid_admission" };
  }

  const existing = getByIdempotencyKey(sidecar, input.idempotencyKey);
  if (existing) return { ok: true, operation: existing, created: false };

  const active = sidecar
    .prepare(
      `SELECT operation_id FROM detached_operations
        WHERE conversation_id = ? AND state IN ('admitted', 'started')
        LIMIT 1`,
    )
    .get(input.conversationId) as { operation_id?: unknown } | undefined;
  if (typeof active?.operation_id === "string") {
    return { ok: false, reason: "operation_already_pending" };
  }

  const operationId = detachedOperationIdFor(input.idempotencyKey);
  try {
    sidecar
      .prepare(
        `INSERT INTO detached_operations
           (operation_id, conversation_id, origin_cycle_id, origin_generation,
            origin_owner_event_id, origin_evidence_row_id, operation_kind,
            request_json, purpose, evidence_need, admission_at_ms,
            operation_deadline_at_ms, idempotency_key, state,
            created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?, ?)`,
      )
      .run(
        operationId,
        input.conversationId,
        input.originCycleId,
        input.originGeneration,
        input.originOwnerEventId,
        input.originEvidenceRowId ?? null,
        input.operationKind,
        requestJson,
        input.purpose,
        input.evidenceNeed,
        nowMs,
        input.operationDeadlineAtMs,
        input.idempotencyKey,
        nowMs,
        nowMs,
      );
  } catch {
    // A concurrent duplicate admission loses here; the winner's row is truth.
    const winner = getByIdempotencyKey(sidecar, input.idempotencyKey);
    if (winner) return { ok: true, operation: winner, created: false };
    return { ok: false, reason: "operation_already_pending" };
  }
  const created = getDetachedOperation(sidecar, operationId);
  if (!created) return { ok: false, reason: "operation_admission_failed" };
  return { ok: true, operation: created, created: true };
}

/**
 * Record truthful worker start. Only an admitted operation may start, and
 * only with a start proof ref. There is no blind automatic rerun: an
 * ambiguous dispatch never re-enters admitted.
 */
export function markDetachedOperationStarted(
  sidecar: DatabaseSync,
  operationId: string,
  input: StartDetachedOperationInput,
): DetachedOperationResult {
  const nowMs = input.nowMs ?? Date.now();
  if (!nonEmptyString(operationId) || !nonEmptyString(input.startProofRef) || !safeMs(nowMs)) {
    return { ok: false, reason: "invalid_start" };
  }
  const current = getDetachedOperation(sidecar, operationId);
  if (!current) return { ok: false, reason: "detached_operation_missing" };
  if (isTerminalState(current.state)) {
    return { ok: false, reason: "detached_operation_terminal_immutable" };
  }
  if (current.state !== "admitted") {
    return { ok: false, reason: "detached_operation_transition_invalid" };
  }
  let workerBindingJson: string | null = null;
  if (input.workerBinding !== undefined && input.workerBinding !== null) {
    try {
      workerBindingJson = JSON.stringify(input.workerBinding);
      JSON.parse(workerBindingJson);
    } catch {
      return { ok: false, reason: "invalid_start" };
    }
  }
  sidecar
    .prepare(
      `UPDATE detached_operations
          SET state = 'started', start_at_ms = ?, start_proof_ref = ?,
              worker_binding_json = COALESCE(?, worker_binding_json),
              updated_at_ms = ?
        WHERE operation_id = ? AND state = 'admitted'`,
    )
    .run(nowMs, input.startProofRef, workerBindingJson, nowMs, operationId);
  const updated = getDetachedOperation(sidecar, operationId);
  if (!updated || updated.state !== "started") {
    return { ok: false, reason: "detached_operation_transition_invalid" };
  }
  return { ok: true, operation: updated, created: false };
}

/**
 * Persist terminal truth. Terminal rows are immutable. Admitted work that
 * never started may only end as cancelled/failed/outcome_unknown (dispatch
 * failure without execution); only started work may succeed or stop.
 */
export function setDetachedOperationTerminal(
  sidecar: DatabaseSync,
  operationId: string,
  input: SetDetachedOperationTerminalInput,
): DetachedOperationResult {
  const nowMs = input.nowMs ?? Date.now();
  if (!nonEmptyString(operationId) || !safeMs(nowMs)) {
    return { ok: false, reason: "invalid_terminal" };
  }
  const current = getDetachedOperation(sidecar, operationId);
  if (!current) return { ok: false, reason: "detached_operation_missing" };
  if (isTerminalState(current.state)) {
    return { ok: false, reason: "detached_operation_terminal_immutable" };
  }
  const allowed =
    current.state === "admitted"
      ? input.terminalState === "cancelled"
        || input.terminalState === "failed"
        || input.terminalState === "outcome_unknown"
      : current.state === "started";
  if (!allowed) return { ok: false, reason: "detached_operation_transition_invalid" };
  sidecar
    .prepare(
      `UPDATE detached_operations
          SET state = ?, terminal_state = ?, terminal_at_ms = ?,
              observation_ref = COALESCE(?, observation_ref),
              receipt_ref = COALESCE(?, receipt_ref),
              error_code = COALESCE(?, error_code),
              updated_at_ms = ?
        WHERE operation_id = ? AND state = ?`,
    )
    .run(
      input.terminalState,
      input.terminalState,
      nowMs,
      input.observationRef ?? null,
      input.receiptRef ?? null,
      input.errorCode ?? null,
      nowMs,
      operationId,
      current.state,
    );
  const updated = getDetachedOperation(sidecar, operationId);
  if (!updated || updated.state !== input.terminalState) {
    return { ok: false, reason: "detached_operation_transition_invalid" };
  }
  return { ok: true, operation: updated, created: false };
}

/**
 * Record an Owner-endorsed cancel request. Request is distinct from outcome:
 * this never terminates work by itself. First request time is preserved.
 */
export function requestDetachedOperationCancel(
  sidecar: DatabaseSync,
  operationId: string,
  nowMs = Date.now(),
): DetachedOperationResult {
  if (!nonEmptyString(operationId) || !safeMs(nowMs)) {
    return { ok: false, reason: "invalid_cancel_request" };
  }
  const current = getDetachedOperation(sidecar, operationId);
  if (!current) return { ok: false, reason: "detached_operation_missing" };
  if (isTerminalState(current.state)) {
    return { ok: false, reason: "detached_operation_terminal_immutable" };
  }
  sidecar
    .prepare(
      `UPDATE detached_operations
          SET cancel_requested_at_ms = COALESCE(cancel_requested_at_ms, ?),
              updated_at_ms = ?
        WHERE operation_id = ?`,
    )
    .run(nowMs, nowMs, operationId);
  const updated = getDetachedOperation(sidecar, operationId);
  if (!updated) return { ok: false, reason: "detached_operation_missing" };
  return { ok: true, operation: updated, created: false };
}

/**
 * Record supersession. Superseded work keeps its evidence and terminal
 * truth; only relevance/currentness changes. Never erases.
 */
export function supersedeDetachedOperation(
  sidecar: DatabaseSync,
  operationId: string,
  input: { supersededBy: string; successorOperationId?: string | null; nowMs?: number },
): DetachedOperationResult {
  const nowMs = input.nowMs ?? Date.now();
  if (!nonEmptyString(operationId) || !nonEmptyString(input.supersededBy) || !safeMs(nowMs)) {
    return { ok: false, reason: "invalid_supersession" };
  }
  const current = getDetachedOperation(sidecar, operationId);
  if (!current) return { ok: false, reason: "detached_operation_missing" };
  sidecar
    .prepare(
      `UPDATE detached_operations
          SET superseded_by = ?, successor_operation_id = COALESCE(?, successor_operation_id),
              updated_at_ms = ?
        WHERE operation_id = ?`,
    )
    .run(input.supersededBy, input.successorOperationId ?? null, nowMs, operationId);
  const updated = getDetachedOperation(sidecar, operationId);
  if (!updated) return { ok: false, reason: "detached_operation_missing" };
  return { ok: true, operation: updated, created: false };
}

/**
 * Startup/reconciliation classification: expired ambiguous work becomes
 * OUTCOME_UNKNOWN when no stronger evidence exists. Terminal rows are never
 * touched, and nothing is rerun.
 */
export function reconcileDetachedOperations(
  sidecar: DatabaseSync,
  nowMs = Date.now(),
): { transitionedOperationIds: string[] } {
  if (!safeMs(nowMs)) return { transitionedOperationIds: [] };
  const rows = sidecar
    .prepare(
      `SELECT operation_id FROM detached_operations
        WHERE state IN ('admitted', 'started') AND operation_deadline_at_ms < ?
        ORDER BY operation_deadline_at_ms ASC, operation_id ASC`,
    )
    .all(nowMs) as Array<{ operation_id?: unknown }>;
  const ids = rows
    .map((row) => row.operation_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  for (const operationId of ids) {
    sidecar
      .prepare(
        `UPDATE detached_operations
            SET state = 'outcome_unknown', terminal_state = 'outcome_unknown',
                terminal_at_ms = ?,
                error_code = COALESCE(error_code, 'operation_deadline_expired'),
                updated_at_ms = ?
          WHERE operation_id = ? AND state IN ('admitted', 'started')`,
      )
      .run(nowMs, nowMs, operationId);
  }
  return { transitionedOperationIds: ids };
}
