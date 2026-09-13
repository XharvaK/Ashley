import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  MAX_THOUGHT_MODEL_ATTEMPTS,
  PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR,
  type PrivateBudgetAdmission,
  type PrivateBudgetPolicy,
  type PrivateBudgetReservation,
} from "../types.js";
import { advancePolicyClock } from "./policy-time-ledger.js";

export const PRIVATE_THOUGHT_POLICY_ID = "ashley.private_thought.v1" as const;
export const PRIVATE_THOUGHT_WINDOW_MS = 3_600_000 as const;
export const PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS = 300_000 as const;

export const DEFAULT_PRIVATE_THOUGHT_POLICY: PrivateBudgetPolicy = Object.freeze({
  policyId: PRIVATE_THOUGHT_POLICY_ID,
  limit: PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR,
  windowMs: PRIVATE_THOUGHT_WINDOW_MS,
  clockDiscontinuityMs: PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS,
});

export type PrivateBudgetDispatchBinding = Readonly<{
  sidecar: DatabaseSync;
  reservationId: string;
  /** F1: admitting wake/conversation, threaded through so repair-attempt binds can re-assert identity (no cross-wake hijack). */
  wakeId?: string;
  conversationId?: string;
}>;

export type PrivateBudgetProjection = Readonly<{
  source: "private_budget_ledger";
  policyId: string;
  limit: number;
  windowMs: number;
  policyTimeMs: number | null;
  lowerBoundMs: number | null;
  clockState: "stable" | "clock_reconciliation" | "migration_epoch_required";
  discrepancyMs: number | null;
  consumingCount: number;
  remaining: number;
  stateCounts: Readonly<Record<PrivateBudgetReservation["state"], number>>;
}>;

type ReservationRow = Record<string, unknown>;
type ClockRow = {
  last_policy_now_ms: number;
  clock_state: "stable" | "clock_reconciliation";
  discrepancy_ms: number;
};

function budgetError(code: string): Error {
  return new Error(code);
}

function requiredText(value: string, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw budgetError(code);
  return value;
}

function validTime(value: number, code = "policy_clock_invalid"): number {
  if (!Number.isFinite(value) || value < 0) throw budgetError(code);
  return Math.floor(value);
}

function now(input?: number): number {
  return validTime(input ?? Date.now(), "private_budget_time_invalid");
}

function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (caught) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw caught;
  }
}

function reservationFromRow(row: ReservationRow): PrivateBudgetReservation {
  return {
    reservationId: String(row.reservation_id),
    admissionId: String(row.admission_id),
    wakeId: String(row.wake_id),
    conversationId: String(row.conversation_id),
    policyId: String(row.policy_id),
    state: row.state as PrivateBudgetReservation["state"],
    policyTimeMs: Number(row.policy_time_ms),
    invocationId: row.invocation_id == null ? null : String(row.invocation_id),
    attemptId: row.attempt_id == null ? null : String(row.attempt_id),
    dispatchTruth: row.dispatch_truth as PrivateBudgetReservation["dispatchTruth"],
    releaseProofRef: row.release_proof_ref == null ? null : String(row.release_proof_ref),
  };
}

function reservationRow(db: DatabaseSync, reservationId: string): ReservationRow | undefined {
  return db.prepare("SELECT * FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as ReservationRow | undefined;
}

function reservationRequired(db: DatabaseSync, reservationId: string): PrivateBudgetReservation {
  const row = reservationRow(db, reservationId);
  if (!row) throw budgetError("reservation_missing");
  return reservationFromRow(row);
}

export function getPrivateReservation(db: DatabaseSync, reservationId: string): PrivateBudgetReservation | null {
  const row = reservationRow(db, reservationId);
  return row ? reservationFromRow(row) : null;
}

export function getPrivateReservationRequired(db: DatabaseSync, reservationId: string): PrivateBudgetReservation {
  return reservationRequired(db, requiredText(reservationId, "reservation_id_required"));
}

/**
 * Fail-closed wake reservation lookup.
 * Returns null if 0 rows match.
 * Returns the reservation if exactly 1 row matches.
 * Throws private_budget_wake_reservation_ambiguous if > 1 rows match.
 */
export function getPrivateReservationForWake(
  db: DatabaseSync,
  wakeId: string,
): PrivateBudgetReservation | null {
  requiredText(wakeId, "wake_id_required");
  const rows = db.prepare(
    "SELECT * FROM private_budget_reservations WHERE wake_id = ?",
  ).all(wakeId) as ReservationRow[];
  if (rows.length === 0) return null;
  if (rows.length > 1) throw budgetError("private_budget_wake_reservation_ambiguous");
  return reservationFromRow(rows[0]!);
}

function clockRow(db: DatabaseSync, policyId: string): ClockRow | undefined {
  return db.prepare(
    "SELECT last_policy_now_ms, clock_state, discrepancy_ms FROM private_budget_policy_clock WHERE policy_id = ?",
  ).get(policyId) as ClockRow | undefined;
}

function consumingCount(db: DatabaseSync, policyId: string, policyTimeMs: number): number {
  // F0 (R7 §15.1): ONE_ASHLEY global scope. The conversation predicate is
  // gone: every held|committed|reconcile_required row under the policy counts
  // toward one rolling 1-hour ceiling. conversation_id remains on each row as
  // execution-context evidence (admission identity), never as a scope key.
  const row = db.prepare(
    `SELECT COUNT(*) AS count
       FROM private_budget_reservations
      WHERE policy_id = ?
        AND policy_time_ms > ?
        AND state IN ('held', 'committed', 'reconcile_required')`,
  ).get(policyId, policyTimeMs - DEFAULT_PRIVATE_THOUGHT_POLICY.windowMs) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function expireInTransaction(db: DatabaseSync, policyId: string, policyTimeMs: number): number {
  const result = db.prepare(
    `UPDATE private_budget_reservations
        SET state = 'expired', updated_at_ms = ?
      WHERE policy_id = ?
        AND policy_time_ms <= ?
        AND state IN ('held', 'committed', 'reconcile_required')`,
  ).run(policyTimeMs, policyId, policyTimeMs - DEFAULT_PRIVATE_THOUGHT_POLICY.windowMs);
  return Number(result.changes ?? 0);
}

function verifyWakeForAdmission(db: DatabaseSync, input: { wakeId: string; conversationId: string }): void {
  const row = db.prepare("SELECT conversation_id, state FROM wakes WHERE wake_id = ?").get(input.wakeId) as { conversation_id?: unknown; state?: unknown } | undefined;
  if (!row) throw budgetError("wake_missing");
  if (String(row.conversation_id) !== input.conversationId) throw budgetError("wake_conversation_conflict");
  if (row.state === "terminal" || row.state === "reconciling" || row.state === "consequence_pending") throw budgetError("wake_not_dispatchable");
}

function validateAdmission(input: { admissionId: string; wakeId: string; conversationId: string; policyId: string; wallClockNowMs: number }): number {
  requiredText(input.admissionId, "admission_id_required");
  requiredText(input.wakeId, "wake_id_required");
  requiredText(input.conversationId, "conversation_id_required");
  requiredText(input.policyId, "policy_id_required");
  return validTime(input.wallClockNowMs);
}

/** Reserve one private Thought opportunity. Clock, expiry, count, and insert share one write transaction. */
export function reservePrivateThought(
  db: DatabaseSync,
  input: { admissionId: string; wakeId: string; conversationId: string; policyId: string; wallClockNowMs: number },
): PrivateBudgetAdmission {
  const wallClockNowMs = validateAdmission(input);
  return transaction(db, () => {
    const existingRow = db.prepare("SELECT * FROM private_budget_reservations WHERE admission_id = ?").get(input.admissionId) as ReservationRow | undefined;
    if (existingRow) {
      const existing = reservationFromRow(existingRow);
      if (
        existing.wakeId !== input.wakeId
        || existing.conversationId !== input.conversationId
        || existing.policyId !== input.policyId
      ) throw budgetError("admission_identity_conflict");
      const clock = clockRow(db, input.policyId);
      const projectionTime = Math.max(existing.policyTimeMs, Number(clock?.last_policy_now_ms ?? existing.policyTimeMs), wallClockNowMs);
      const remaining = Math.max(0, DEFAULT_PRIVATE_THOUGHT_POLICY.limit - consumingCount(db, input.policyId, projectionTime));
      return { kind: "existing", reservation: existing, remaining };
    }

    verifyWakeForAdmission(db, input);
    const currentClock = clockRow(db, input.policyId);
    if (!currentClock) {
      // F0 bootstrap (R7 §15.4): clock absence is consistent with genuinely
      // uninitialized history ONLY when no reservation rows exist for the
      // policy (the clock insert precedes every genuine reservation in the
      // same transaction). Fresh history bootstraps a stable clock and falls
      // through to the normal capacity/reservation path below (admit); rows
      // without a clock indicate restore/clone/partial-loss anomaly and fail
      // closed without writing state (conserve capacity; explicit
      // reconcilePolicyClock recovery remains available).
      const priorReservations = db.prepare(
        "SELECT COUNT(*) AS count FROM private_budget_reservations WHERE policy_id = ?",
      ).get(input.policyId) as { count?: number } | undefined;
      if (Number(priorReservations?.count ?? 0) > 0) {
        return { kind: "refused", reason: "clock_reconciliation", remaining: 0 };
      }
      db.prepare(
        `INSERT INTO private_budget_policy_clock
          (policy_id, last_policy_now_ms, clock_state, discrepancy_ms)
         VALUES (?, ?, 'stable', 0)`,
      ).run(input.policyId, wallClockNowMs);
    }

    const policyTime = advancePolicyClock(
      db,
      input.policyId,
      wallClockNowMs,
      DEFAULT_PRIVATE_THOUGHT_POLICY.clockDiscontinuityMs,
    );
    // F0 latch-free exit: advancePolicyClock already persisted the CURRENT
    // observation, so the computed state alone decides. Stored reconciliation
    // + safe wall auto-exits here (admit); backward-beyond-tolerance refuses.
    if (policyTime.state !== "stable") {
      return { kind: "refused", reason: "clock_reconciliation", remaining: 0 };
    }

    expireInTransaction(db, input.policyId, policyTime.policyTimeMs);
    const used = consumingCount(db, input.policyId, policyTime.policyTimeMs);
    if (used >= DEFAULT_PRIVATE_THOUGHT_POLICY.limit) {
      return { kind: "refused", reason: "capacity_exhausted", remaining: 0 };
    }

    const timestamp = wallClockNowMs;
    const reservationId = `private-reservation:${randomUUID()}`;
    db.prepare(
      `INSERT INTO private_budget_reservations
        (reservation_id, admission_id, wake_id, conversation_id, policy_id, state,
         policy_time_ms, dispatch_truth, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, 'held', ?, 'not_bound', ?, ?)`,
    ).run(
      reservationId,
      input.admissionId,
      input.wakeId,
      input.conversationId,
      input.policyId,
      policyTime.policyTimeMs,
      timestamp,
      timestamp,
    );
    return {
      kind: "reserved",
      reservation: reservationRequired(db, reservationId),
      remaining: DEFAULT_PRIVATE_THOUGHT_POLICY.limit - used - 1,
    };
  });
}

/** Bind the reservation to one exact Model Fabric invocation and attempt. */
export function bindPrivateReservationInvocation(
  db: DatabaseSync,
  input: { reservationId: string; invocationId: string; attemptId: string; nowMs?: number },
): PrivateBudgetReservation {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  requiredText(input.attemptId, "attempt_id_required");
  return transaction(db, () => {
    const current = reservationRequired(db, input.reservationId);
    if (current.state === "committed" && current.invocationId === input.invocationId && current.attemptId === input.attemptId) return current;
    if (current.state !== "held") throw budgetError("reservation_state_conflict");
    if (current.invocationId != null) {
      if (current.invocationId === input.invocationId && current.attemptId === input.attemptId) return current;
      throw budgetError("invocation_binding_conflict");
    }
    try {
      const result = db.prepare(
        `UPDATE private_budget_reservations
            SET invocation_id = ?, attempt_id = ?, dispatch_truth = 'not_started', updated_at_ms = ?
          WHERE reservation_id = ? AND state = 'held' AND invocation_id IS NULL`,
      ).run(input.invocationId, input.attemptId, timestamp, input.reservationId);
      if (Number(result.changes ?? 0) !== 1) throw budgetError("invocation_binding_conflict");
    } catch (caught) {
      if (caught instanceof Error && caught.message === "invocation_binding_conflict") throw caught;
      throw budgetError("invocation_binding_conflict");
    }
    return reservationRequired(db, input.reservationId);
  });
}

/** Commit capacity at the exact W0 dispatch-attempted boundary. */
export function commitPrivateDispatch(
  db: DatabaseSync,
  input: { reservationId: string; invocationId: string; attemptId: string; nowMs?: number },
): PrivateBudgetReservation {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  requiredText(input.attemptId, "attempt_id_required");
  return transaction(db, () => {
    const current = reservationRequired(db, input.reservationId);
    if (current.state === "committed" && current.invocationId === input.invocationId && current.attemptId === input.attemptId) return current;
    const canCommit = current.state === "held"
      || (current.state === "reconcile_required" && current.dispatchTruth === "unknown");
    if (!canCommit) throw budgetError("dispatch_without_reservation");
    if (current.invocationId !== input.invocationId || current.attemptId !== input.attemptId) throw budgetError("dispatch_without_reservation");
    const result = db.prepare(
      `UPDATE private_budget_reservations
          SET state = 'committed', dispatch_truth = 'attempted', updated_at_ms = ?
        WHERE reservation_id = ? AND state IN ('held', 'reconcile_required')
          AND dispatch_truth IN ('not_started', 'unknown')
          AND invocation_id = ? AND attempt_id = ?`,
    ).run(timestamp, input.reservationId, input.invocationId, input.attemptId);
    if (Number(result.changes ?? 0) !== 1) throw budgetError("dispatch_without_reservation");
    return reservationRequired(db, input.reservationId);
  });
}

/** Record a provider response without releasing the already-consumed reservation. */
export function recordPrivateProviderResponse(
  db: DatabaseSync,
  input: { reservationId: string; invocationId: string; attemptId: string; nowMs?: number },
): PrivateBudgetReservation {
  const timestamp = now(input.nowMs);
  return transaction(db, () => {
    const current = reservationRequired(db, input.reservationId);
    if (
      current.state === "committed"
      && current.invocationId === input.invocationId
      && current.attemptId === input.attemptId
      && current.dispatchTruth === "responded"
    ) return current;
    if (current.state !== "committed" || current.invocationId !== input.invocationId || current.attemptId !== input.attemptId) throw budgetError("reservation_state_conflict");
    db.prepare(
      `UPDATE private_budget_reservations
          SET dispatch_truth = 'responded', updated_at_ms = ?
        WHERE reservation_id = ? AND state = 'committed'
          AND invocation_id = ? AND attempt_id = ?`,
    ).run(timestamp, input.reservationId, input.invocationId, input.attemptId);
    return reservationRequired(db, input.reservationId);
  });
}

/** Release only when a durable no-dispatch proof is supplied. */
export function releasePrivateReservation(
  db: DatabaseSync,
  input: {
    reservationId: string;
    proofRef: string;
    dispatchTruth?: "not_started";
    invocationId?: string;
    attemptId?: string;
    nowMs?: number;
  },
): PrivateBudgetReservation {
  const timestamp = now(input.nowMs);
  if (input.dispatchTruth !== "not_started") throw budgetError("release_proof_missing");
  requiredText(input.proofRef, "release_proof_missing");
  return transaction(db, () => {
    const current = reservationRequired(db, input.reservationId);
    if (current.state === "released") {
      if (current.releaseProofRef === input.proofRef) return current;
      throw budgetError("release_proof_conflict");
    }
    if (current.state !== "held" && current.state !== "reconcile_required") throw budgetError("reservation_state_conflict");
    if (current.invocationId != null && input.invocationId != null && current.invocationId !== input.invocationId) throw budgetError("release_proof_conflict");
    if (current.attemptId != null && input.attemptId != null && current.attemptId !== input.attemptId) throw budgetError("release_proof_conflict");
    const result = db.prepare(
      `UPDATE private_budget_reservations
          SET state = 'released', dispatch_truth = 'not_started',
              invocation_id = COALESCE(invocation_id, ?),
              attempt_id = COALESCE(attempt_id, ?),
              release_proof_ref = ?, updated_at_ms = ?
        WHERE reservation_id = ? AND state IN ('held', 'reconcile_required')`,
    ).run(input.invocationId ?? null, input.attemptId ?? null, input.proofRef, timestamp, input.reservationId);
    if (Number(result.changes ?? 0) !== 1) throw budgetError("reservation_state_conflict");
    return reservationRequired(db, input.reservationId);
  });
}

/**
 * Record a durable no-dispatch proof on a held parent reservation without releasing capacity.
 * Used for continuable no-send events (e.g. compose abort before W0, Attention capacity deferral before W0).
 */
export function recordPrivateReservationNoDispatchProof(
  db: DatabaseSync,
  input: {
    reservationId: string;
    invocationId: string;
    attemptId: string;
    proofRef: string;
    nowMs?: number;
  },
): PrivateBudgetReservation {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  requiredText(input.attemptId, "attempt_id_required");
  requiredText(input.proofRef, "proof_ref_required");
  return transaction(db, () => {
    const current = reservationRequired(db, input.reservationId);
    if (current.state !== "held") {
      throw budgetError("reservation_state_conflict");
    }
    if (current.invocationId !== input.invocationId || current.attemptId !== input.attemptId) {
      throw budgetError("invocation_binding_conflict");
    }
    if (current.dispatchTruth !== "not_started") {
      throw budgetError("contradictory_dispatch_truth");
    }
    if (current.releaseProofRef != null) {
      if (current.releaseProofRef === input.proofRef) return current;
      throw budgetError("proof_ref_conflict");
    }
    const result = db.prepare(
      `UPDATE private_budget_reservations
          SET release_proof_ref = ?, updated_at_ms = ?
        WHERE reservation_id = ? AND state = 'held' AND dispatch_truth = 'not_started' AND release_proof_ref IS NULL`,
    ).run(input.proofRef, timestamp, input.reservationId);
    if (Number(result.changes ?? 0) !== 1) {
      throw budgetError("proof_recording_failed");
    }
    return reservationRequired(db, input.reservationId);
  });
}

/** Preserve capacity when W0/Model Fabric cannot prove that dispatch did not begin. */
export function markPrivateReservationUnknown(
  db: DatabaseSync,
  reservationId: string,
  options: { nowMs?: number } = {},
): PrivateBudgetReservation {
  const timestamp = now(options.nowMs);
  requiredText(reservationId, "reservation_id_required");
  return transaction(db, () => {
    const current = reservationRequired(db, reservationId);
    if (current.state === "reconcile_required") return current;
    if (current.state !== "held") {
      if (current.state === "released" || current.state === "expired") return current;
      throw budgetError("contradictory_dispatch_truth");
    }
    db.prepare(
      `UPDATE private_budget_reservations
          SET state = 'reconcile_required', dispatch_truth = 'unknown', updated_at_ms = ?
        WHERE reservation_id = ? AND state = 'held'`,
    ).run(timestamp, reservationId);
    return reservationRequired(db, reservationId);
  });
}

/** Expire only reservations outside the rolling window; clock reconciliation never refills by lowering high-water. */
export function expirePrivateReservations(
  db: DatabaseSync,
  input: { policyId: string; wallClockNowMs: number },
): { policyTimeMs: number; expired: number } {
  const wallClockNowMs = validTime(input.wallClockNowMs);
  requiredText(input.policyId, "policy_id_required");
  return transaction(db, () => {
    const clock = clockRow(db, input.policyId);
    if (!clock) return { policyTimeMs: wallClockNowMs, expired: 0 };
    const policy = advancePolicyClock(db, input.policyId, wallClockNowMs, DEFAULT_PRIVATE_THOUGHT_POLICY.clockDiscontinuityMs);
    const result = db.prepare(
      `UPDATE private_budget_reservations
          SET state = 'expired', updated_at_ms = ?
        WHERE policy_id = ? AND policy_time_ms <= ?
          AND state IN ('held', 'committed', 'reconcile_required')`,
    ).run(policy.policyTimeMs, input.policyId, policy.policyTimeMs - DEFAULT_PRIVATE_THOUGHT_POLICY.windowMs);
    return { policyTimeMs: policy.policyTimeMs, expired: Number(result.changes ?? 0) };
  });
}

/** Read-only authoritative budget projection for delivery gates and diagnostics. */
export function getPrivateBudgetProjection(
  db: DatabaseSync,
  input: { conversationId?: string; policyId: string; wallClockNowMs?: number },
): PrivateBudgetProjection {
  // F0 (R7 §15.1): policy-scoped. conversationId is accepted for diagnostic
  // continuity but no longer scopes counting — one global rolling count per
  // policy (PRIVATE_BUDGET_SCOPE_KEY=policy_id).
  requiredText(input.policyId, "policy_id_required");
  const wallClockNowMs = now(input.wallClockNowMs);
  const clock = clockRow(db, input.policyId);
  const policyTimeMs = clock ? Math.max(Number(clock.last_policy_now_ms), wallClockNowMs) : null;
  const discrepancyMs = clock ? Math.abs(wallClockNowMs - Number(clock.last_policy_now_ms)) : null;
  // F0 FRESH_CLOCK_PROJECTION_POLICY (R7 §15.4): no clock row + zero policy
  // reservations stays truthfully migration_epoch_required BUT is
  // BOOTSTRAP_ELIGIBLE (remaining = full limit so pre-admission gates reach
  // the atomic bootstrap-and-admit reserve path); no clock row + any policy
  // reservations is inconsistent history and reports clock_reconciliation
  // (fail closed). The stored-clock rule mirrors the latch-free write path:
  // backward-beyond-tolerance reconciles, anything else is stable (a stored
  // reconciliation exits the moment the wall clock is back in the safe
  // region — the read projection never disagrees with what reserve would do).
  let clockState: PrivateBudgetProjection["clockState"];
  if (!clock) {
    const priorReservations = db.prepare(
      "SELECT COUNT(*) AS count FROM private_budget_reservations WHERE policy_id = ?",
    ).get(input.policyId) as { count?: number } | undefined;
    clockState = Number(priorReservations?.count ?? 0) > 0 ? "clock_reconciliation" : "migration_epoch_required";
  } else if (Number(clock.last_policy_now_ms) - wallClockNowMs > DEFAULT_PRIVATE_THOUGHT_POLICY.clockDiscontinuityMs) {
    clockState = "clock_reconciliation";
  } else {
    clockState = "stable";
  }
  const stateCounts = {
    held: 0,
    committed: 0,
    released: 0,
    reconcile_required: 0,
    expired: 0,
  } satisfies Record<PrivateBudgetReservation["state"], number>;
  const rows = db.prepare(
    `SELECT state, COUNT(*) AS count FROM private_budget_reservations
      WHERE policy_id = ? GROUP BY state`,
  ).all(input.policyId) as Array<{ state?: string; count?: number }>;
  for (const row of rows) {
    if (row.state && row.state in stateCounts) stateCounts[row.state as PrivateBudgetReservation["state"]] = Number(row.count ?? 0);
  }
  const consuming = policyTimeMs == null ? 0 : consumingCount(db, input.policyId, policyTimeMs);
  return {
    source: "private_budget_ledger",
    policyId: input.policyId,
    limit: DEFAULT_PRIVATE_THOUGHT_POLICY.limit,
    windowMs: DEFAULT_PRIVATE_THOUGHT_POLICY.windowMs,
    policyTimeMs,
    lowerBoundMs: policyTimeMs == null ? null : policyTimeMs - DEFAULT_PRIVATE_THOUGHT_POLICY.windowMs,
    clockState,
    discrepancyMs,
    consumingCount: consuming,
    remaining: clockState === "clock_reconciliation"
      ? 0
      : clockState === "migration_epoch_required"
        ? DEFAULT_PRIVATE_THOUGHT_POLICY.limit
        : Math.max(0, DEFAULT_PRIVATE_THOUGHT_POLICY.limit - consuming),
    stateCounts,
  };
}

/**
 * F1 (periodic-autonomous-cognition R7 §15.5): append-only structural-repair
 * attempt authorization.
 *
 * One reservation authorizes one cycle (the parent row, attempt 1,
 * initial_dispatch). Each bounded structural-repair attempt binds one child
 * row (attempts 2..N, structural_repair). Repair attempts never create parent
 * rows, so they are invisible to the 4/hour count by construction. The
 * parent's first binding is immutable; every consumer reads the full attempt
 * set as UNION(parent AS ordinal 1, children AS ordinals 2..N).
 */

export type PrivateBudgetChildReason = "structural_repair" | "cycle_continuation";

export type PrivateBudgetAttemptBinding = Readonly<{
  bindingId: string;
  reservationId: string;
  invocationId: string;
  attemptId: string;
  ordinal: number;
  reason: PrivateBudgetChildReason;
  dispatchTruth: "not_started" | "attempted" | "responded" | "unknown";
  providerRequestId: string | null;
  releaseProofRef: string | null;
}>;

export type PrivateAttemptRecord = Readonly<{
  ordinal: number;
  reason: "initial_dispatch" | PrivateBudgetChildReason;
  invocationId: string;
  attemptId: string;
  dispatchTruth: "not_started" | "attempted" | "responded" | "unknown";
  providerRequestId: string | null;
  releaseProofRef: string | null;
}>;

type AttemptBindingRow = Record<string, unknown>;

function attemptBindingFromRow(row: AttemptBindingRow): PrivateBudgetAttemptBinding {
  return {
    bindingId: String(row.binding_id),
    reservationId: String(row.reservation_id),
    invocationId: String(row.invocation_id),
    attemptId: String(row.attempt_id),
    ordinal: Number(row.ordinal),
    reason: String(row.reason) as PrivateBudgetChildReason,
    dispatchTruth: row.dispatch_truth as PrivateBudgetAttemptBinding["dispatchTruth"],
    providerRequestId: row.provider_request_id == null ? null : String(row.provider_request_id),
    releaseProofRef: row.release_proof_ref == null ? null : String(row.release_proof_ref),
  };
}

function repairBindingRow(
  db: DatabaseSync,
  reservationId: string,
  invocationId: string,
): AttemptBindingRow | undefined {
  return db.prepare(
    "SELECT * FROM private_budget_attempt_bindings WHERE reservation_id = ? AND invocation_id = ?",
  ).get(reservationId, invocationId) as AttemptBindingRow | undefined;
}

/** Next repair ordinal for a reservation: max existing child ordinal + 1 (2 when no child exists). */
export function nextPrivateRepairOrdinal(db: DatabaseSync, reservationId: string): number {
  requiredText(reservationId, "reservation_id_required");
  const row = db.prepare(
    "SELECT MAX(ordinal) AS max_ordinal FROM private_budget_attempt_bindings WHERE reservation_id = ?",
  ).get(reservationId) as { max_ordinal?: unknown } | undefined;
  const maxOrdinal = typeof row?.max_ordinal === "number" ? row.max_ordinal : 0;
  return Math.max(2, maxOrdinal + 1);
}

export function getPrivateRepairBinding(
  db: DatabaseSync,
  reservationId: string,
  invocationId: string,
): PrivateBudgetAttemptBinding | null {
  const row = repairBindingRow(db, requiredText(reservationId, "reservation_id_required"), requiredText(invocationId, "invocation_id_required"));
  return row ? attemptBindingFromRow(row) : null;
}

/** Bind one structural-repair or cycle-continuation attempt. Previous-attempt response evidence is mandatory (unknown-outcome policy). */
export function bindPrivateRepairAttempt(
  db: DatabaseSync,
  input: {
    reservationId: string;
    invocationId: string;
    attemptId: string;
    wakeId: string;
    conversationId: string;
    ordinal: number;
    reason: PrivateBudgetChildReason;
    nowMs?: number;
  },
): PrivateBudgetAttemptBinding {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  requiredText(input.attemptId, "attempt_id_required");
  requiredText(input.wakeId, "wake_id_required");
  requiredText(input.conversationId, "conversation_id_required");
  const childReason: PrivateBudgetChildReason = input.reason;
  if (childReason !== "structural_repair" && childReason !== "cycle_continuation") {
    throw budgetError("repair_reason_invalid");
  }
  const ordinal = Math.floor(Number(input.ordinal));
  if (!Number.isInteger(ordinal)) throw budgetError("repair_ordinal_invalid");
  return transaction(db, () => {
    const parent = reservationRequired(db, input.reservationId);
    const isCommittedParent = parent.state === "committed";
    const isContinuableHeldParent = parent.state === "held"
      && parent.dispatchTruth === "not_started"
      && parent.releaseProofRef != null
      && parent.releaseProofRef.trim() !== ""
      && parent.invocationId != null
      && parent.attemptId != null;
    if (!isCommittedParent && !isContinuableHeldParent) {
      if (parent.state === "held") throw budgetError("repair_parent_held_unproven");
      throw budgetError("repair_parent_not_committed");
    }
    if (parent.wakeId !== input.wakeId || parent.conversationId !== input.conversationId) throw budgetError("repair_identity_conflict");
    if (ordinal < 2) throw budgetError("repair_ordinal_reserved");
    if (ordinal > MAX_THOUGHT_MODEL_ATTEMPTS) throw budgetError("repair_ordinal_exceeded");
    const byInvocation = db.prepare(
      "SELECT * FROM private_budget_attempt_bindings WHERE invocation_id = ?",
    ).get(input.invocationId) as AttemptBindingRow | undefined;
    if (byInvocation) {
      const existing = attemptBindingFromRow(byInvocation);
      if (existing.reservationId !== input.reservationId) throw budgetError("repair_invocation_conflict");
      return existing;
    }
    const byOrdinal = db.prepare(
      "SELECT * FROM private_budget_attempt_bindings WHERE reservation_id = ? AND ordinal = ?",
    ).get(input.reservationId, ordinal) as AttemptBindingRow | undefined;
    if (byOrdinal) throw budgetError("repair_ordinal_conflict");
    // Unknown-outcome policy: repair is permitted only with durable
    // provider-response evidence for the previous attempt — a `responded`
    // truth, or a `not_started` truth carrying a durable no-dispatch release
    // proof (that attempt provably never happened, so no duplicate-execution
    // risk exists). Anything else refuses: reconcile/terminal, never blind
    // re-dispatch.
    let previousTruth: string | null = null;
    let previousReleased = false;
    if (ordinal === 2) {
      previousTruth = parent.dispatchTruth;
      previousReleased = parent.releaseProofRef != null;
    } else {
      const previous = db.prepare(
        "SELECT dispatch_truth, release_proof_ref FROM private_budget_attempt_bindings WHERE reservation_id = ? AND ordinal = ?",
      ).get(input.reservationId, ordinal - 1) as { dispatch_truth?: unknown; release_proof_ref?: unknown } | undefined;
      if (!previous) throw budgetError("repair_previous_attempt_missing");
      previousTruth = typeof previous.dispatch_truth === "string" ? previous.dispatch_truth : null;
      previousReleased = previous.release_proof_ref != null;
    }
    if (previousTruth !== "responded" && !(previousTruth === "not_started" && previousReleased)) {
      throw budgetError("repair_requires_response_evidence");
    }
    const bindingId = `private-attempt-binding:${randomUUID()}`;
    try {
      db.prepare(
        `INSERT INTO private_budget_attempt_bindings
          (binding_id, reservation_id, invocation_id, attempt_id, ordinal, reason,
           dispatch_truth, provider_request_id, release_proof_ref, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, 'not_started', NULL, NULL, ?, ?)`,
      ).run(bindingId, input.reservationId, input.invocationId, input.attemptId, ordinal, childReason, timestamp, timestamp);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "repair_ordinal_conflict") throw caught;
      throw budgetError("repair_ordinal_conflict");
    }
    const inserted = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!inserted) throw budgetError("repair_binding_missing");
    return attemptBindingFromRow(inserted);
  });
}

/**
 * Route one provider dispatch through the correct authorization row: the
 * parent binding for the initial attempt, a child binding for structural
 * repair or cycle continuation. The child branch is taken ONLY for a committed parent
 * or a continuable held parent with a different invocation (post-response second dispatch
 * or proven pre-dispatch continuation). A held parent without proof still throws
 * invocation_binding_conflict (A2 guard preserved, never silently converted).
 */
export function bindPrivateReservationOrRepairAttempt(
  db: DatabaseSync,
  input: {
    reservationId: string;
    invocationId: string;
    attemptId: string;
    wakeId?: string;
    conversationId?: string;
    childReason?: PrivateBudgetChildReason;
    nowMs?: number;
  },
): { kind: "parent"; reservation: PrivateBudgetReservation } | { kind: "child"; binding: PrivateBudgetAttemptBinding; ordinal: number } {
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  requiredText(input.attemptId, "attempt_id_required");
  const parent = getPrivateReservation(db, input.reservationId);
  const isCommittedParent = parent?.state === "committed";
  const isContinuableHeldParent = parent?.state === "held"
    && parent.dispatchTruth === "not_started"
    && parent.releaseProofRef != null
    && parent.releaseProofRef.trim() !== ""
    && parent.invocationId != null
    && parent.attemptId != null;
  if (
    parent
    && (isCommittedParent || isContinuableHeldParent)
    && parent.invocationId != null
    && (parent.invocationId !== input.invocationId || parent.attemptId !== input.attemptId)
  ) {
    if (!input.childReason || (input.childReason !== "structural_repair" && input.childReason !== "cycle_continuation")) {
      throw budgetError("private_budget_child_reason_unavailable");
    }
    if (!input.wakeId || !input.conversationId) throw budgetError("repair_identity_unavailable");
    const ordinal = nextPrivateRepairOrdinal(db, input.reservationId);
    const binding = bindPrivateRepairAttempt(db, {
      reservationId: input.reservationId,
      invocationId: input.invocationId,
      attemptId: input.attemptId,
      wakeId: input.wakeId,
      conversationId: input.conversationId,
      ordinal,
      reason: input.childReason,
      nowMs: input.nowMs,
    });
    return { kind: "child", binding, ordinal: binding.ordinal };
  }
  return { kind: "parent", reservation: bindPrivateReservationInvocation(db, { reservationId: input.reservationId, invocationId: input.invocationId, attemptId: input.attemptId, nowMs: input.nowMs }) };
}

/** Commit a repair attempt at the exact W0 dispatch-attempted boundary (child counterpart of commitPrivateDispatch). */
export function commitPrivateRepairDispatch(
  db: DatabaseSync,
  input: { reservationId: string; invocationId: string; attemptId?: string; nowMs?: number },
): PrivateBudgetAttemptBinding {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  return transaction(db, () => {
    const current = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!current) throw budgetError("dispatch_without_reservation");
    const binding = attemptBindingFromRow(current);
    if (input.attemptId != null && binding.attemptId !== input.attemptId) throw budgetError("dispatch_without_reservation");
    if (binding.dispatchTruth !== "attempted" && binding.dispatchTruth !== "not_started") throw budgetError("dispatch_without_reservation");

    const parent = reservationRequired(db, input.reservationId);
    if (parent.state === "held") {
      if (
        parent.dispatchTruth !== "not_started" ||
        parent.releaseProofRef == null ||
        parent.releaseProofRef.trim() === "" ||
        parent.invocationId == null ||
        parent.invocationId.trim() === "" ||
        parent.attemptId == null ||
        parent.attemptId.trim() === ""
      ) {
        throw budgetError("child_commit_unproven_held_parent");
      }
      const parentCommitResult = db.prepare(
        `UPDATE private_budget_reservations
            SET state = 'committed', updated_at_ms = ?
          WHERE reservation_id = ? AND state = 'held' AND dispatch_truth = 'not_started' AND release_proof_ref IS NOT NULL
            AND invocation_id IS NOT NULL AND attempt_id IS NOT NULL`,
      ).run(timestamp, input.reservationId);
      if (Number(parentCommitResult.changes ?? 0) !== 1) {
        throw budgetError("child_commit_unproven_held_parent");
      }
    } else if (parent.state !== "committed") {
      throw budgetError("dispatch_without_reservation");
    }

    if (binding.dispatchTruth === "attempted") return binding;
    const result = db.prepare(
      `UPDATE private_budget_attempt_bindings
          SET dispatch_truth = 'attempted', updated_at_ms = ?
        WHERE reservation_id = ? AND invocation_id = ? AND dispatch_truth = 'not_started'`,
    ).run(timestamp, input.reservationId, input.invocationId);
    if (Number(result.changes ?? 0) !== 1) throw budgetError("dispatch_without_reservation");
    const updated = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!updated) throw budgetError("repair_binding_missing");
    return attemptBindingFromRow(updated);
  });
}

/** Record a repair-attempt provider response (child counterpart of recordPrivateProviderResponse). */
export function recordPrivateRepairResponse(
  db: DatabaseSync,
  input: { reservationId: string; invocationId: string; attemptId?: string; providerRequestId?: string; nowMs?: number },
): PrivateBudgetAttemptBinding {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  return transaction(db, () => {
    const current = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!current) throw budgetError("reservation_state_conflict");
    const binding = attemptBindingFromRow(current);
    if (input.attemptId != null && binding.attemptId !== input.attemptId) throw budgetError("reservation_state_conflict");
    if (binding.dispatchTruth === "responded") return binding;
    if (binding.dispatchTruth !== "attempted") throw budgetError("reservation_state_conflict");
    db.prepare(
      `UPDATE private_budget_attempt_bindings
          SET dispatch_truth = 'responded',
              provider_request_id = COALESCE(provider_request_id, ?),
              updated_at_ms = ?
        WHERE reservation_id = ? AND invocation_id = ? AND dispatch_truth = 'attempted'`,
    ).run(input.providerRequestId ?? null, timestamp, input.reservationId, input.invocationId);
    const updated = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!updated) throw budgetError("repair_binding_missing");
    return attemptBindingFromRow(updated);
  });
}

/** Release a bound-but-never-dispatched repair attempt with durable no-dispatch proof (child counterpart of releasePrivateReservation). */
export function releasePrivateRepairAttempt(
  db: DatabaseSync,
  input: { reservationId: string; invocationId: string; proofRef: string; nowMs?: number },
): PrivateBudgetAttemptBinding {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  requiredText(input.proofRef, "release_proof_missing");
  return transaction(db, () => {
    const current = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!current) throw budgetError("reservation_state_conflict");
    const binding = attemptBindingFromRow(current);
    if (binding.dispatchTruth !== "not_started") throw budgetError("reservation_state_conflict");
    if (binding.releaseProofRef != null) {
      if (binding.releaseProofRef === input.proofRef) return binding;
      throw budgetError("release_proof_conflict");
    }
    const result = db.prepare(
      `UPDATE private_budget_attempt_bindings
          SET release_proof_ref = ?, updated_at_ms = ?
        WHERE reservation_id = ? AND invocation_id = ? AND dispatch_truth = 'not_started' AND release_proof_ref IS NULL`,
    ).run(input.proofRef, timestamp, input.reservationId, input.invocationId);
    if (Number(result.changes ?? 0) !== 1) throw budgetError("reservation_state_conflict");
    const updated = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!updated) throw budgetError("repair_binding_missing");
    return attemptBindingFromRow(updated);
  });
}

/**
 * Mark a repair attempt unknown when dispatch was ambiguous (child counterpart of markPrivateReservationUnknown).
 * Transitions attempted -> unknown. Idempotent if already unknown.
 */
export function markPrivateRepairAttemptUnknown(
  db: DatabaseSync,
  input: { reservationId: string; invocationId: string; nowMs?: number },
): PrivateBudgetAttemptBinding {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  return transaction(db, () => {
    const current = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!current) throw budgetError("reservation_state_conflict");
    const binding = attemptBindingFromRow(current);
    if (binding.dispatchTruth === "unknown") return binding;
    if (binding.dispatchTruth !== "attempted") throw budgetError("contradictory_dispatch_truth");
    db.prepare(
      `UPDATE private_budget_attempt_bindings
          SET dispatch_truth = 'unknown', updated_at_ms = ?
        WHERE reservation_id = ? AND invocation_id = ? AND dispatch_truth = 'attempted'`,
    ).run(timestamp, input.reservationId, input.invocationId);
    const updated = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!updated) throw budgetError("repair_binding_missing");
    return attemptBindingFromRow(updated);
  });
}

/**
 * Converge a child repair attempt from durable receipt proof during recovery.
 * Transitions not_started/unknown -> attempted, or not_started/attempted/unknown -> responded.
 * Never rolls backward (responded -> attempted is rejected).
 */
export function reconcilePrivateRepairAttempt(
  db: DatabaseSync,
  input: {
    reservationId: string;
    invocationId: string;
    targetTruth: "attempted" | "responded";
    providerRequestId?: string;
    nowMs?: number;
  },
): PrivateBudgetAttemptBinding {
  const timestamp = now(input.nowMs);
  requiredText(input.reservationId, "reservation_id_required");
  requiredText(input.invocationId, "invocation_id_required");
  if (input.targetTruth !== "attempted" && input.targetTruth !== "responded") {
    throw budgetError("contradictory_dispatch_truth");
  }
  return transaction(db, () => {
    const current = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!current) throw budgetError("reservation_state_conflict");
    const binding = attemptBindingFromRow(current);
    if (binding.releaseProofRef != null) throw budgetError("reservation_state_conflict");

    if (input.targetTruth === "attempted") {
      if (binding.dispatchTruth === "attempted") return binding;
      if (binding.dispatchTruth === "responded") throw budgetError("contradictory_dispatch_truth");
      if (binding.dispatchTruth !== "not_started" && binding.dispatchTruth !== "unknown") {
        throw budgetError("reservation_state_conflict");
      }
      db.prepare(
        `UPDATE private_budget_attempt_bindings
            SET dispatch_truth = 'attempted', updated_at_ms = ?
          WHERE reservation_id = ? AND invocation_id = ? AND dispatch_truth IN ('not_started', 'unknown')`,
      ).run(timestamp, input.reservationId, input.invocationId);
    } else {
      // targetTruth === "responded"
      if (binding.dispatchTruth === "responded") {
        if (input.providerRequestId && !binding.providerRequestId) {
          db.prepare(
            `UPDATE private_budget_attempt_bindings
                SET provider_request_id = ?, updated_at_ms = ?
              WHERE reservation_id = ? AND invocation_id = ?`,
          ).run(input.providerRequestId, timestamp, input.reservationId, input.invocationId);
          const reloaded = repairBindingRow(db, input.reservationId, input.invocationId);
          return attemptBindingFromRow(reloaded!);
        }
        return binding;
      }
      if (
        binding.dispatchTruth !== "not_started" &&
        binding.dispatchTruth !== "attempted" &&
        binding.dispatchTruth !== "unknown"
      ) {
        throw budgetError("reservation_state_conflict");
      }
      db.prepare(
        `UPDATE private_budget_attempt_bindings
            SET dispatch_truth = 'responded',
                provider_request_id = COALESCE(provider_request_id, ?),
                updated_at_ms = ?
          WHERE reservation_id = ? AND invocation_id = ? AND dispatch_truth IN ('not_started', 'attempted', 'unknown')`,
      ).run(input.providerRequestId ?? null, timestamp, input.reservationId, input.invocationId);
    }

    const updated = repairBindingRow(db, input.reservationId, input.invocationId);
    if (!updated) throw budgetError("repair_binding_missing");
    return attemptBindingFromRow(updated);
  });
}

/**
 * Full attempt history for one reservation as UNION(parent AS ordinal 1,
 * children AS ordinals 2..N) ordered by ordinal. Any consumer reading only
 * one side is wrong by construction: children-alone undercounts by exactly
 * one once attempt 1 is bound.
 */
export function listPrivateAttemptHistory(db: DatabaseSync, reservationId: string): PrivateAttemptRecord[] {
  const parent = getPrivateReservation(db, requiredText(reservationId, "reservation_id_required"));
  const records: PrivateAttemptRecord[] = [];
  if (parent && parent.invocationId != null && parent.attemptId != null && parent.dispatchTruth !== "not_bound") {
    records.push({
      ordinal: 1,
      reason: "initial_dispatch",
      invocationId: parent.invocationId,
      attemptId: parent.attemptId,
      dispatchTruth: parent.dispatchTruth,
      providerRequestId: null,
      releaseProofRef: parent.releaseProofRef,
    });
  }
  const children = db.prepare(
    "SELECT * FROM private_budget_attempt_bindings WHERE reservation_id = ? ORDER BY ordinal ASC",
  ).all(reservationId) as AttemptBindingRow[];
  for (const row of children) {
    const binding = attemptBindingFromRow(row);
    records.push({
      ordinal: binding.ordinal,
      reason: binding.reason,
      invocationId: binding.invocationId,
      attemptId: binding.attemptId,
      dispatchTruth: binding.dispatchTruth,
      providerRequestId: binding.providerRequestId,
      releaseProofRef: binding.releaseProofRef,
    });
  }
  return records;
}
