import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type DurableAttemptReceipt,
  type DurableDispatchTruth,
  type DurableFailureClass,
  type DurableWorkState,
  type HandlerResult,
} from "../types.js";
import {
  DURABLE_RETRY_POLICY,
  nextRetryAt,
} from "./policy.js";
import {
  selectFairEligibleHead,
  type FairWorkCandidate,
} from "./scheduler.js";
import {
  admitWakeInTransaction,
  authorizeWakeInTransaction,
  claimWakeInTransaction,
  finishWakeInTransaction,
  getWake,
} from "../wake/ledger.js";
import { occurrenceIdFor } from "../wake/identity.js";
import { sha256 } from "../../model-fabric/hash.js";
import { resolveCanonicalOwnerPrincipal } from "../owner-principal.js";
import { ownerCoverageHash } from "../owner-obligation.js";
import { getCycle, hasValidDurableContinuationOwner, isComposableWake, updateCycleState } from "../cycle/inbox.js";
import {
  getActiveDeferredFrontier,
  insertDeferredFrontierRecord,
  rescheduleDeferredFrontier,
} from "../frontier/ledger.js";
import {
  recordRetryC3TerminalFailure,
  type RetryC3TerminalFailureInput,
} from "../failure/c3-recorder.js";
import {
  getPrivateReservation,
  getPrivateReservationForWake,
  listPrivateAttemptHistory,
} from "../private-budget/ledger.js";

/**
 * P0 coordination-lease coverage (R7 §22): a coordination lease must outlive
 * the maximum legitimate execution interval for which it owns publication
 * authority, including the 180 s Thought execution budget and the
 * lease-checked post-Thought publication/consequence boundary, with explicit
 * margin. Gen74 (≈143 s admit→publication vs 120 s lease → `lease_expired` →
 * ROLLBACK with zero settlement/outbox) proves 120 s insufficient. 360 s is
 * the frozen V1 target, applied at BOTH covered durable-work claim defaults;
 * the coupled wake lease inherits the caller value (no separate edit).
 */
export const DURABLE_WORK_COORDINATION_LEASE_MS = 360_000 as const;

type DbRow = Record<string, unknown>;

type EventRow = {
  id: string;
  conversation_id: string;
  kind: string;
  status: string;
  state: DurableWorkState;
  claim_token: string | null;
  worker_id: string | null;
  lease_expires_at_ms: number | null;
  attempt_count: number;
  first_attempt_at_ms: number | null;
  next_eligible_at_ms: number | null;
  lane: string;
  priority: number;
  wake_id: string | null;
  created_at_ms: number;
  claimed_at_ms: number | null;
  consumed_at_ms: number | null;
  last_error: string | null;
  last_failure_class: DurableFailureClass | null;
  terminal_reason: string | null;
  quarantine_reason: string | null;
};

type AttemptRow = {
  attempt_id: string;
  event_id: string;
  wake_id: string | null;
  ordinal: number;
  worker_id: string;
  started_at_ms: number;
  finished_at_ms: number | null;
  dispatch_truth: DurableDispatchTruth;
  failure_class: DurableFailureClass | null;
  error_code: string | null;
};

export type DurableAttempt = {
  attemptId: string;
  eventId: string;
  wakeId: string | null;
  ordinal: 1 | 2 | 3 | 4 | 5;
  claimToken: string;
  dispatchTruth: DurableDispatchTruth;
  workerId: string;
  startedAtMs: number;
  lane: string;
  priority: number;
};

export type DurableSettlement = HandlerResult;

export type DurableSettlementOutcome =
  | { kind: "completed" }
  | { kind: "retry_wait"; nextEligibleAtMs: number }
  | { kind: "reconciling" }
  | { kind: "terminal"; reason: string };

export type DurableWorkRecoveryResult = {
  reclaimed: number;
  reconciling: number;
  quarantined: number;
};

export type ClaimDurableWorkInput = {
  workerId: string;
  conversationId?: string;
  eventId?: string;
  lane?: string;
  nowMs?: number;
  leaseMs?: number;
};

export type ReconcileOutcome =
  | { kind: "pending"; reason: "outcome_still_unknown" | "safe_to_retry"; eventId: string }
  | { kind: "terminal"; reason: string; eventId: string };

export type CreateRepairEventInput = {
  predecessorEventId: string;
  authorizationRef: string;
  nowMs: number;
  eventId?: string;
  payload?: unknown;
  /**
   * R1 continuity-recovery references stored on the repair payload (no new
   * store): the ledger fills repairEventId. Absent for legacy repairs, which
   * run as plain recovery triggers.
   */
  continuityRecovery?: {
    primaryPredecessorEventId: string;
    outstandingOwnerEvidenceRefs: readonly string[];
    reason: "unanswered_owner_obligation_recovery";
  };
};

export type RepairEvent = {
  id: string;
  eventId: string;
  wakeId: string;
  cycleId: string;
  predecessorEventId: string;
  authorizationRef: string;
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : number(value);
}

function nullableText(value: unknown): string | null {
  return value == null ? null : text(value);
}

function row(value: unknown): DbRow | undefined {
  return typeof value === "object" && value !== null ? value as DbRow : undefined;
}

function ordinal(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const parsed = number(value);
  if (parsed < 1 || parsed > DURABLE_RETRY_POLICY.maxAttempts || !Number.isInteger(parsed)) {
    throw new Error("durable_attempt_ordinal_invalid");
  }
  return parsed as 1 | 2 | 3 | 4 | 5;
}

function event(db: DatabaseSync, eventId: string): EventRow {
  const value = row(db.prepare(
    `SELECT id, conversation_id, kind, status, state, claim_token, worker_id,
            lease_expires_at_ms, attempt_count, first_attempt_at_ms,
            next_eligible_at_ms, lane, priority, wake_id, created_at_ms,
            claimed_at_ms, consumed_at_ms, last_error, last_failure_class,
            terminal_reason, quarantine_reason
       FROM inbox_events WHERE id = ?`,
  ).get(eventId));
  if (!value) throw new Error("durable_work_missing");
  return {
    id: text(value.id),
    conversation_id: text(value.conversation_id),
    kind: text(value.kind),
    status: text(value.status),
    state: text(value.state, "pending") as DurableWorkState,
    claim_token: nullableText(value.claim_token),
    worker_id: nullableText(value.worker_id),
    lease_expires_at_ms: nullableNumber(value.lease_expires_at_ms),
    attempt_count: number(value.attempt_count),
    first_attempt_at_ms: nullableNumber(value.first_attempt_at_ms),
    next_eligible_at_ms: nullableNumber(value.next_eligible_at_ms),
    lane: text(value.lane, "interactive"),
    priority: number(value.priority),
    wake_id: nullableText(value.wake_id),
    created_at_ms: number(value.created_at_ms),
    claimed_at_ms: nullableNumber(value.claimed_at_ms),
    consumed_at_ms: nullableNumber(value.consumed_at_ms),
    last_error: nullableText(value.last_error),
    last_failure_class: value.last_failure_class == null
      ? null
      : value.last_failure_class as DurableFailureClass,
    terminal_reason: nullableText(value.terminal_reason),
    quarantine_reason: nullableText(value.quarantine_reason),
  };
}

function attempt(db: DatabaseSync, attemptId: string, eventId?: string): AttemptRow | null {
  const suffix = eventId == null ? "" : " AND event_id = ?";
  const params = eventId == null ? [attemptId] : [attemptId, eventId];
  const value = row(db.prepare(
    `SELECT attempt_id, event_id, wake_id, ordinal, worker_id,
            started_at_ms, finished_at_ms, dispatch_truth, failure_class,
            error_code
       FROM durable_work_attempts WHERE attempt_id = ?${suffix}`,
  ).get(...params));
  if (!value) return null;
  return {
    attempt_id: text(value.attempt_id),
    event_id: text(value.event_id),
    wake_id: nullableText(value.wake_id),
    ordinal: number(value.ordinal),
    worker_id: text(value.worker_id),
    started_at_ms: number(value.started_at_ms),
    finished_at_ms: nullableNumber(value.finished_at_ms),
    dispatch_truth: text(value.dispatch_truth, "unknown") as DurableDispatchTruth,
    failure_class: value.failure_class == null ? null : value.failure_class as DurableFailureClass,
    error_code: nullableText(value.error_code),
  };
}

function latestAttempt(db: DatabaseSync, eventId: string): AttemptRow | null {
  const value = row(db.prepare(
    `SELECT attempt_id, event_id, wake_id, ordinal, worker_id,
            started_at_ms, finished_at_ms, dispatch_truth, failure_class,
            error_code
       FROM durable_work_attempts WHERE event_id = ?
       ORDER BY ordinal DESC LIMIT 1`,
  ).get(eventId));
  if (!value) return null;
  return {
    attempt_id: text(value.attempt_id),
    event_id: text(value.event_id),
    wake_id: nullableText(value.wake_id),
    ordinal: number(value.ordinal),
    worker_id: text(value.worker_id),
    started_at_ms: number(value.started_at_ms),
    finished_at_ms: nullableNumber(value.finished_at_ms),
    dispatch_truth: text(value.dispatch_truth, "unknown") as DurableDispatchTruth,
    failure_class: value.failure_class == null ? null : value.failure_class as DurableFailureClass,
    error_code: nullableText(value.error_code),
  };
}

function toDurableAttempt(current: EventRow, value: AttemptRow): DurableAttempt {
  if (!current.claim_token) throw new Error("durable_claim_missing");
  return {
    attemptId: value.attempt_id,
    eventId: value.event_id,
    wakeId: value.wake_id,
    ordinal: ordinal(value.ordinal),
    claimToken: current.claim_token,
    dispatchTruth: value.dispatch_truth,
    workerId: value.worker_id,
    startedAtMs: value.started_at_ms,
    lane: current.lane,
    priority: current.priority,
  };
}

function wakeToPending(db: DatabaseSync, wakeId: string, nowMs: number): void {
  db.prepare(
    `UPDATE wakes
        SET state = 'pending', terminal_reason = NULL, lease_owner = NULL,
            lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
      WHERE wake_id = ? AND state != 'terminal'`,
  ).run(nowMs, wakeId);
}

function wakeToReconciling(db: DatabaseSync, wakeId: string, nowMs: number): void {
  db.prepare(
    `UPDATE wakes
        SET state = 'reconciling', terminal_reason = NULL, lease_owner = NULL,
            lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
      WHERE wake_id = ? AND state != 'terminal'`,
  ).run(nowMs, wakeId);
}

function wakeToTerminal(
  db: DatabaseSync,
  wakeId: string,
  reason: "completed" | "no_action" | "refused" | "cancelled" | "expired" | "quarantined" | "superseded",
  nowMs: number,
): void {
  const current = getWake(db, wakeId);
  if (!current) throw new Error("wake_missing");
  if (current.state === "terminal") {
    if (current.terminalReason !== reason) throw new Error("wake_terminal_conflict");
    return;
  }
  db.prepare(
    `UPDATE wakes
        SET state = 'terminal', terminal_reason = ?, lease_owner = NULL,
            lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
      WHERE wake_id = ? AND state != 'terminal'`,
  ).run(reason, nowMs, wakeId);
}

function finishWakeForEvent(
  db: DatabaseSync,
  current: EventRow,
  reason: "completed" | "no_action" | "refused" | "cancelled" | "expired" | "quarantined" | "superseded",
  nowMs: number,
): void {
  if (!current.wake_id) throw new Error("wake_required");
  const wake = getWake(db, current.wake_id);
  if (!wake) throw new Error("wake_missing");
  // Exhaustion of one durable continuation must not close a wake that still
  // has another same-wake continuation eligible for ordinary claim.
  if (reason === "quarantined" && hasOtherDurableContinuationForWake(db, current.wake_id, current.id)) {
    wakeToPending(db, current.wake_id, nowMs);
    return;
  }
  // Supersession closes only the covered owner obligations. An uncovered
  // continuation keeps the old wake claimable for the remaining work.
  if (reason === "superseded" && hasOtherDurableContinuationForWake(db, current.wake_id, current.id)) {
    wakeToPending(db, current.wake_id, nowMs);
    return;
  }
  // A successful cognition must not close a wake while a same-wake sibling
  // that was not covered by that cognition remains claimable.
  if (reason === "completed" && hasOtherClaimableContinuationForWake(db, current.wake_id, current.id)) {
    wakeToPending(db, current.wake_id, nowMs);
    return;
  }
  if (wake.state === "terminal") {
    if (wake.terminalReason !== reason) throw new Error("wake_terminal_conflict");
    return;
  }
  if (wake.state === "reconciling") {
    wakeToTerminal(db, current.wake_id, reason, nowMs);
    return;
  }
  finishWakeInTransaction(db, current.wake_id, current.claim_token ?? wake.leaseToken, reason, nowMs);
}

function hasOtherDurableContinuationForWake(
  db: DatabaseSync,
  wakeId: string,
  eventId: string,
): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM inbox_events
      WHERE wake_id = ? AND id != ?
        AND state IN ('pending', 'retry_wait', 'leased', 'reconciling')
      LIMIT 1`,
  ).get(wakeId, eventId));
}

function hasOtherClaimableContinuationForWake(
  db: DatabaseSync,
  wakeId: string,
  eventId: string,
): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM inbox_events
      WHERE wake_id = ? AND id != ?
        AND state IN ('pending', 'retry_wait')
      LIMIT 1`,
  ).get(wakeId, eventId));
}

function convergeCoveredSiblingEvents(
  db: DatabaseSync,
  current: EventRow,
  coveredSiblingEventIds: readonly string[],
  nowMs: number,
): void {
  if (!current.wake_id) return;
  for (const siblingId of [...new Set(coveredSiblingEventIds)]) {
    if (!siblingId || siblingId === current.id) continue;
    db.prepare(
      `UPDATE inbox_events
          SET state = 'terminal', status = 'consumed',
              terminal_reason = 'completed', quarantine_reason = NULL,
              consumed_at_ms = ?, next_eligible_at_ms = NULL,
              claim_token = NULL, worker_id = NULL,
              lease_expires_at_ms = NULL,
              last_error = NULL, last_failure_class = NULL
        WHERE id = ? AND wake_id = ?
          AND state IN ('pending', 'retry_wait')`,
    ).run(nowMs, siblingId, current.wake_id);
  }
}

type SupersessionResult = Extract<HandlerResult, { kind: "superseded" }>;

function validateSupersession(
  db: DatabaseSync,
  current: EventRow,
  result: SupersessionResult,
): string[] {
  if (!current.wake_id) throw new Error("wake_required");
  const covered = [...result.coveredOwnerEventIds];
  const uncovered = [...result.uncoveredOwnerEventIds];
  if (result.coverageHash !== ownerCoverageHash({
    primaryEventId: current.id,
    coveredOwnerEventIds: covered,
    uncoveredOwnerEventIds: uncovered,
  })) throw new Error("supersession_coverage_hash_invalid");
  if (!covered.includes(current.id)) throw new Error("supersession_primary_not_covered");
  if (new Set(covered).size !== covered.length || new Set(uncovered).size !== uncovered.length) {
    throw new Error("supersession_coverage_duplicate");
  }
  if (covered.some((id) => uncovered.includes(id))) throw new Error("supersession_coverage_overlap");

  const wake = getWake(db, current.wake_id);
  if (!wake || wake.state === "terminal") throw new Error("supersession_old_wake_invalid");
  if (result.successorIdentity.wakeId === current.wake_id) throw new Error("supersession_successor_same_wake");
  const successor = row(db.prepare(
    `SELECT e.id, e.conversation_id, e.state, e.kind, e.wake_id,
            w.state AS wake_state
       FROM inbox_events e
       JOIN wakes w ON w.wake_id = e.wake_id
      WHERE e.id = ? AND e.wake_id = ?`,
  ).get(result.successorIdentity.eventId, result.successorIdentity.wakeId));
  if (!successor
    || text(successor.conversation_id) !== current.conversation_id
    || text(successor.kind) !== "owner_message" && text(successor.kind) !== "owner_utterance"
    || ["terminal", "quarantined"].includes(text(successor.state))
    || text(successor.wake_state) === "terminal") {
    throw new Error("supersession_successor_invalid");
  }

  const union = new Set([...covered, ...uncovered]);
  for (const id of union) {
    const candidate = id === current.id
      ? { id: current.id, wake_id: current.wake_id, kind: current.kind, state: "leased" }
      : row(db.prepare(
        "SELECT id, wake_id, kind, state FROM inbox_events WHERE id = ?",
      ).get(id));
    if (!candidate
      || text(candidate.wake_id) !== current.wake_id
      || (text(candidate.kind) !== "owner_message" && text(candidate.kind) !== "owner_utterance")
      || (id !== current.id && !["pending", "retry_wait"].includes(text(candidate.state)))) {
      throw new Error("supersession_owner_event_invalid");
    }
  }
  const expected = db.prepare(
    `SELECT id FROM inbox_events
      WHERE wake_id = ? AND kind IN ('owner_message', 'owner_utterance')
        AND (state IN ('pending', 'retry_wait') OR id = ?)` ,
  ).all(current.wake_id, current.id) as Array<{ id?: unknown }>;
  if (expected.some((item) => !union.has(text(item.id)))) throw new Error("supersession_coverage_incomplete");
  return covered;
}

function supersedeDurableAttemptInTransaction(
  db: DatabaseSync,
  current: EventRow,
  result: SupersessionResult,
  nowMs: number,
): void {
  const covered = validateSupersession(db, current, result);
  const placeholders = covered.map(() => "?").join(",");
  db.prepare(
    `UPDATE inbox_events
        SET state = 'terminal', status = 'consumed',
            terminal_reason = 'superseded', quarantine_reason = NULL,
            consumed_at_ms = ?, next_eligible_at_ms = NULL,
            claim_token = NULL, worker_id = NULL,
            lease_expires_at_ms = NULL, last_error = NULL,
            last_failure_class = NULL
      WHERE id IN (${placeholders}) AND wake_id = ?`,
  ).run(nowMs, ...covered, current.wake_id);
  finishWakeForEvent(db, current, "superseded", nowMs);
  retireOwnerlessCycleForTerminalEvent(db, current.wake_id, nowMs);
}

function quarantineEvent(db: DatabaseSync, current: EventRow, reason: string, nowMs: number): void {
  db.prepare(
    `UPDATE inbox_events
        SET state = 'quarantined', status = 'failed_terminal',
            terminal_reason = ?, quarantine_reason = ?, last_error = ?,
            claim_token = NULL, worker_id = NULL, lease_expires_at_ms = NULL,
            next_eligible_at_ms = NULL
      WHERE id = ?`,
  ).run(reason, reason, reason, current.id);
  if (
    current.wake_id
    && getWake(db, current.wake_id)
    && !hasOtherDurableContinuationForWake(db, current.wake_id, current.id)
  ) {
    wakeToTerminal(db, current.wake_id, "quarantined", nowMs);
  }
  retireOwnerlessCycleForTerminalEvent(db, current.wake_id, nowMs);
}

/**
 * Campaign-1 terminal-lifecycle completion (normal-path producer of truth).
 *
 * Frozen law: a cognitive obligation remains active until its durable owner
 * performs a terminal transition. Corollary: when the final durable
 * continuation owner terminalizes and ownership is not transferred, the
 * cycle must cease claiming active cognitive occupancy.
 *
 * This helper completes terminal durable-work lifecycle by retiring the
 * wake-bound cycle to the canonical non-occupying state (`silent`) if and
 * only if the canonical ownership predicate
 * (`hasValidDurableContinuationOwner`) reports no valid durable
 * continuation owner. Ownership transfers are preserved:
 * - `capacity_wait` + active frontier (incl. `deferred_to_frontier`) stays;
 * - `sending` + undelivered outbox stays;
 * - any normal phase with a non-terminal wake stays.
 *
 * Callers: every durable-work path that terminalizes owner work WITHOUT
 * transferring ownership (quarantineEvent + settle terminal-failure
 * branches + reconcileOutcomeUnknown terminal branches). Never called for
 * `deferred_to_frontier` (ownership moves to the unresolved frontier),
 * `completed` (ownership already moved to settlement/outbox by publish),
 * or any non-terminal (`pending`/`retry_wait`/`reconciling`) outcome.
 */
function retireOwnerlessCycleForTerminalEvent(db: DatabaseSync, wakeId: string | null, nowMs: number): void {
  if (!wakeId) return;
  const cycleRow = row(db.prepare(
    "SELECT cycle_id FROM cycle_records WHERE wake_id = ? LIMIT 1",
  ).get(wakeId));
  const cycleId = cycleRow ? text(cycleRow.cycle_id) : "";
  if (!cycleId) return;
  const cycle = getCycle(db, cycleId);
  if (!cycle || cycle.state === "silent" || cycle.state === "idle") return;
  if (hasValidDurableContinuationOwner(db, cycle)) return;
  updateCycleState(db, cycleId, "silent", nowMs);
}

function ensureWakeLineage(db: DatabaseSync, current: EventRow): string {
  if (!current.wake_id) throw new Error("wake_required");
  const wake = getWake(db, current.wake_id);
  if (!wake) throw new Error("wake_missing");
  const cycle = row(db.prepare(
    "SELECT cycle_id, wake_id FROM cycle_records WHERE cycle_id = ? LIMIT 1",
  ).get(wake.cycleId));
  if (!cycle || text(cycle.wake_id) !== current.wake_id || text(cycle.cycle_id) !== wake.cycleId) {
    throw new Error("wake_cycle_lineage_invalid");
  }
  return wake.cycleId;
}

function failureFor(result: DurableSettlement): {
  dispatchTruth: DurableDispatchTruth;
  failureClass: DurableFailureClass | null;
  errorCode: string | null;
} {
  if (result.kind === "completed" || result.kind === "deferred_to_frontier") {
    return {
      dispatchTruth: result.kind === "deferred_to_frontier" ? "not_started" : "provider_responded",
      failureClass: null,
      errorCode: null,
    };
  }
  if (result.kind === "superseded") {
    return { dispatchTruth: "not_started", failureClass: null, errorCode: null };
  }
  if (result.kind === "outcome_unknown") {
    return { dispatchTruth: "unknown", failureClass: "outcome_unknown_reconcile", errorCode: result.errorCode };
  }
  return {
    dispatchTruth: result.dispatchTruth ?? "provider_responded",
    failureClass: result.failureClass,
    errorCode: result.errorCode,
  };
}

function outcomeForSettledEvent(current: EventRow): DurableSettlementOutcome {
  if (current.state === "retry_wait" && current.next_eligible_at_ms != null) {
    return { kind: "retry_wait", nextEligibleAtMs: current.next_eligible_at_ms };
  }
  if (current.state === "reconciling") return { kind: "reconciling" };
  if (current.state === "terminal" || current.state === "quarantined") {
    return { kind: "terminal", reason: current.terminal_reason ?? current.quarantine_reason ?? "completed" };
  }
  throw new Error("durable_settlement_state_invalid");
}

function sameSettlement(attemptValue: AttemptRow, result: DurableSettlement): boolean {
  const incoming = failureFor(result);
  return attemptValue.dispatch_truth === incoming.dispatchTruth
    && attemptValue.failure_class === incoming.failureClass
    && attemptValue.error_code === incoming.errorCode;
}

function recoverExpiredDurableWorkInTransaction(
  db: DatabaseSync,
  nowMs: number,
  eventId?: string,
): DurableWorkRecoveryResult {
  const result: DurableWorkRecoveryResult = { reclaimed: 0, reconciling: 0, quarantined: 0 };
  const params = eventId == null ? [nowMs] : [nowMs, eventId];
  const suffix = eventId == null ? "" : " AND id = ?";
  const rows = db.prepare(
    `SELECT id FROM inbox_events
      WHERE state = 'leased' AND lease_expires_at_ms IS NOT NULL
        AND lease_expires_at_ms <= ?${suffix}
      ORDER BY created_at_ms ASC, id ASC`,
  ).all(...params) as Array<{ id?: unknown }>;
  for (const value of rows) {
    const id = text(value.id);
    if (!id) continue;
    const current = event(db, id);
    const latest = latestAttempt(db, id);
    const lineageValid = (() => {
      try {
        ensureWakeLineage(db, current);
        return true;
      } catch {
        return false;
      }
    })();
    if (!lineageValid || !latest || !current.wake_id) {
      quarantineEvent(db, current, !current.wake_id ? "wake_missing" : "attempt_lineage_unverifiable", nowMs);
      result.quarantined += 1;
      continue;
    }
    const ambiguous = Boolean(db.prepare(
      `SELECT 1 FROM in_flight_effects
        WHERE wake_id = ? AND state IN ('in_flight', 'unknown') LIMIT 1`,
    ).get(current.wake_id));
    if (latest.dispatch_truth === "not_started" && !ambiguous) {
      db.prepare(
        `UPDATE inbox_events SET state = 'pending', status = 'pending',
            last_error = 'recovered_before_dispatch', next_eligible_at_ms = NULL,
            claim_token = NULL, worker_id = NULL, lease_expires_at_ms = NULL
          WHERE id = ? AND state = 'leased'`,
      ).run(id);
      wakeToPending(db, current.wake_id, nowMs);
      result.reclaimed += 1;
    } else {
      db.prepare(
        `UPDATE inbox_events SET state = 'reconciling', status = 'claimed',
            last_failure_class = 'outcome_unknown_reconcile',
            last_error = 'recovered_after_possible_dispatch',
            claim_token = NULL, worker_id = NULL, lease_expires_at_ms = NULL,
            next_eligible_at_ms = NULL
          WHERE id = ? AND state = 'leased'`,
      ).run(id);
      wakeToReconciling(db, current.wake_id, nowMs);
      result.reconciling += 1;
    }
  }
  return result;
}

function normalizeEligibleRetryWait(db: DatabaseSync, nowMs: number, eventId?: string): void {
  const params = eventId == null ? [nowMs] : [nowMs, eventId];
  const suffix = eventId == null ? "" : " AND id = ?";
  db.prepare(
    `UPDATE inbox_events SET state = 'pending', status = 'pending'
      WHERE state = 'retry_wait' AND next_eligible_at_ms IS NOT NULL
        AND next_eligible_at_ms <= ?${suffix}`,
  ).run(...params);
}

function normalizeBoundedRows(db: DatabaseSync, nowMs: number, eventId?: string): void {
  const params = eventId == null ? [] : [eventId];
  const suffix = eventId == null ? "" : " AND id = ?";
  const rows = db.prepare(
    `SELECT id FROM inbox_events
      WHERE wake_id IS NOT NULL
        AND state IN ('pending', 'retry_wait')
        AND (attempt_count >= ? OR
             (first_attempt_at_ms IS NOT NULL AND first_attempt_at_ms + ? <= ?))${suffix}
      ORDER BY created_at_ms ASC, id ASC`,
  ).all(DURABLE_RETRY_POLICY.maxAttempts, DURABLE_RETRY_POLICY.maxRetryAgeMs, nowMs, ...params) as Array<{ id?: unknown }>;
  for (const value of rows) {
    const id = text(value.id);
    if (!id) continue;
    const current = event(db, id);
    const reason = current.attempt_count >= DURABLE_RETRY_POLICY.maxAttempts
      ? "attempts_exhausted"
      : "age_exhausted";
    quarantineEvent(db, current, reason, nowMs);
  }
}

function candidates(db: DatabaseSync, input: ClaimDurableWorkInput): FairWorkCandidate[] {
  const clauses = ["e.wake_id IS NOT NULL", "e.state IN ('pending', 'leased')"];
  const values: Array<string | number> = [];
  if (input.conversationId) {
    clauses.push("e.conversation_id = ?");
    values.push(input.conversationId);
  }
  if (input.eventId) {
    clauses.push("e.id = ?");
    values.push(input.eventId);
  }
  if (input.lane) {
    clauses.push("e.lane = ?");
    values.push(input.lane);
  }
  const rows = db.prepare(
    `SELECT e.id, e.lane, e.conversation_id, e.state,
            e.next_eligible_at_ms, e.created_at_ms,
            COALESCE(f.last_served_at_ms, 0) AS last_served_at_ms
       FROM inbox_events e
       LEFT JOIN retry_lane_fairness f
         ON f.lane = e.lane AND f.conversation_id = e.conversation_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY e.created_at_ms ASC, e.id ASC`,
  ).all(...values) as Array<DbRow>;
  return rows.map((value) => ({
    eventId: text(value.id),
    lane: text(value.lane, "interactive"),
    conversationId: text(value.conversation_id),
    state: text(value.state, "pending") as FairWorkCandidate["state"],
    nextEligibleAtMs: nullableNumber(value.next_eligible_at_ms),
    createdAtMs: number(value.created_at_ms),
    lastServedAtMs: number(value.last_served_at_ms),
  }));
}

function claimCandidateInTransaction(
  db: DatabaseSync,
  current: EventRow,
  input: { workerId: string; nowMs: number; leaseMs: number },
): DurableAttempt {
  if (!input.workerId.trim()) throw new Error("worker_required");
  if (current.state !== "pending") throw new Error("durable_work_not_eligible");
  if (current.next_eligible_at_ms != null && current.next_eligible_at_ms > input.nowMs) {
    throw new Error("durable_work_not_eligible");
  }
  ensureWakeLineage(db, current);
  if (!current.wake_id) throw new Error("wake_required");
  const wake = getWake(db, current.wake_id);
  if (!wake || !isComposableWake(wake)) {
    throw new Error("wake_reconciliation_required");
  }
  const nextOrdinal = current.attempt_count + 1;
  if (nextOrdinal > DURABLE_RETRY_POLICY.maxAttempts) throw new Error("durable_work_attempts_exhausted");
  const firstAttemptAtMs = current.first_attempt_at_ms ?? input.nowMs;
  if (input.nowMs >= firstAttemptAtMs + DURABLE_RETRY_POLICY.maxRetryAgeMs) {
    throw new Error("durable_work_age_exhausted");
  }
  const claimed = claimWakeInTransaction(db, current.wake_id, input.workerId, input.nowMs, input.leaseMs);
  const authorized = authorizeWakeInTransaction(db, current.wake_id, claimed.leaseToken, input.nowMs);
  if (authorized.leaseToken !== claimed.leaseToken) throw new Error("wake_authorization_lost");
  const attemptId = `attempt:${randomUUID()}`;
  const updated = db.prepare(
    `UPDATE inbox_events
        SET state = 'leased', status = 'claimed', claim_token = ?, worker_id = ?,
            lease_expires_at_ms = ?, claimed_at_ms = ?, attempt_count = ?,
            first_attempt_at_ms = ?, next_eligible_at_ms = NULL, last_error = NULL
      WHERE id = ? AND state = 'pending'`,
  ).run(
    claimed.leaseToken,
    input.workerId,
    input.nowMs + input.leaseMs,
    input.nowMs,
    nextOrdinal,
    firstAttemptAtMs,
    current.id,
  );
  if (Number(updated.changes) !== 1) throw new Error("durable_work_claim_lost");
  db.prepare(
    `INSERT INTO durable_work_attempts
       (attempt_id, event_id, wake_id, ordinal, worker_id, started_at_ms, dispatch_truth)
     VALUES (?, ?, ?, ?, ?, ?, 'not_started')`,
  ).run(attemptId, current.id, current.wake_id, nextOrdinal, input.workerId, input.nowMs);
  db.prepare(
    `INSERT INTO retry_lane_fairness (lane, conversation_id, last_served_at_ms)
     VALUES (?, ?, ?)
     ON CONFLICT(lane, conversation_id)
     DO UPDATE SET last_served_at_ms = excluded.last_served_at_ms`,
  ).run(current.lane, current.conversation_id, input.nowMs);
  return {
    attemptId,
    eventId: current.id,
    wakeId: current.wake_id,
    ordinal: nextOrdinal as 1 | 2 | 3 | 4 | 5,
    claimToken: claimed.leaseToken,
    dispatchTruth: "not_started",
    workerId: input.workerId,
    startedAtMs: input.nowMs,
    lane: current.lane,
    priority: current.priority,
  };
}

function beginAndRollbackOnError<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  }
}

export function getOpenDurableAttempt(db: DatabaseSync, eventId: string): DurableAttempt | null {
  const current = event(db, eventId);
  const value = latestAttempt(db, eventId);
  if (!value || value.finished_at_ms != null || current.state !== "leased" || !current.claim_token) return null;
  return toDurableAttempt(current, value);
}

export function getDurableAttempt(db: DatabaseSync, attemptId: string): DurableAttemptReceipt | null {
  const value = attempt(db, attemptId);
  if (!value) return null;
  return {
    attemptId: value.attempt_id,
    eventId: value.event_id,
    wakeId: value.wake_id,
    ordinal: ordinal(value.ordinal),
    workerId: value.worker_id,
    startedAtMs: value.started_at_ms,
    finishedAtMs: value.finished_at_ms,
    dispatchTruth: value.dispatch_truth,
    failureClass: value.failure_class,
    errorCode: value.error_code,
  };
}

export function listDurableAttempts(db: DatabaseSync, eventId?: string): DurableAttemptReceipt[] {
  const rows = eventId == null
    ? db.prepare("SELECT attempt_id FROM durable_work_attempts ORDER BY started_at_ms ASC, ordinal ASC").all() as Array<{ attempt_id?: unknown }>
    : db.prepare("SELECT attempt_id FROM durable_work_attempts WHERE event_id = ? ORDER BY ordinal ASC").all(eventId) as Array<{ attempt_id?: unknown }>;
  return rows.map((value) => getDurableAttempt(db, text(value.attempt_id))).filter((item): item is DurableAttemptReceipt => item !== null);
}

export function startDurableAttempt(
  db: DatabaseSync,
  input: { eventId: string; workerId: string; nowMs: number; leaseMs?: number },
): DurableAttempt {
  const leaseMs = Math.max(1, Math.min(15 * 60_000, Math.floor(input.leaseMs ?? DURABLE_WORK_COORDINATION_LEASE_MS)));
  return beginAndRollbackOnError(db, () => {
    recoverExpiredDurableWorkInTransaction(db, input.nowMs, input.eventId);
    normalizeEligibleRetryWait(db, input.nowMs, input.eventId);
    normalizeBoundedRows(db, input.nowMs, input.eventId);
    const current = event(db, input.eventId);
    if (current.state !== "pending") throw new Error("durable_work_not_eligible");
    return claimCandidateInTransaction(db, current, { workerId: input.workerId, nowMs: input.nowMs, leaseMs });
  });
}

export function claimNextDurableWork(db: DatabaseSync, input: ClaimDurableWorkInput): DurableAttempt | null {
  const nowMs = input.nowMs ?? Date.now();
  const leaseMs = Math.max(1, Math.min(15 * 60_000, Math.floor(input.leaseMs ?? DURABLE_WORK_COORDINATION_LEASE_MS)));
  return beginAndRollbackOnError(db, () => {
    recoverExpiredDurableWorkInTransaction(db, nowMs);
    normalizeEligibleRetryWait(db, nowMs);
    normalizeBoundedRows(db, nowMs);
    const selected = selectFairEligibleHead(candidates(db, input), nowMs);
    if (!selected) return null;
    return claimCandidateInTransaction(db, event(db, selected.eventId), { workerId: input.workerId, nowMs, leaseMs });
  });
}

export function recoverDurableWork(db: DatabaseSync, nowMs = Date.now()): DurableWorkRecoveryResult {
  return beginAndRollbackOnError(db, () => recoverExpiredDurableWorkInTransaction(db, nowMs));
}

export function settleDurableAttempt(
  db: DatabaseSync,
  input: {
    eventId: string;
    attemptId: string;
    claimToken: string;
    result: DurableSettlement;
    nowMs: number;
    coveredSiblingEventIds?: readonly string[];
  },
): DurableSettlementOutcome {
  let c3Terminal: RetryC3TerminalFailureInput | null = null;
  const outcome = beginAndRollbackOnError<DurableSettlementOutcome>(db, () => {
    const current = event(db, input.eventId);
    const value = attempt(db, input.attemptId, input.eventId);
    if (!value) throw new Error("durable_attempt_missing");
    if (value.finished_at_ms != null) {
      if (sameSettlement(value, input.result)) return outcomeForSettledEvent(current);
      quarantineEvent(db, current, "contradictory_result", input.nowMs);
      db.prepare("UPDATE durable_work_attempts SET error_code = COALESCE(error_code, 'contradictory_result') WHERE attempt_id = ?").run(input.attemptId);
      return { kind: "terminal", reason: "contradictory_result" };
    }
    if (current.state !== "leased" || current.claim_token !== input.claimToken) {
      throw new Error("durable_work_claim_lost");
    }
    const normalized = failureFor(input.result);
    db.prepare(
      `UPDATE durable_work_attempts
          SET finished_at_ms = ?, dispatch_truth = ?, failure_class = ?, error_code = ?
        WHERE attempt_id = ? AND event_id = ? AND finished_at_ms IS NULL`,
    ).run(input.nowMs, normalized.dispatchTruth, normalized.failureClass, normalized.errorCode, input.attemptId, input.eventId);

    if (input.result.kind === "superseded") {
      supersedeDurableAttemptInTransaction(db, current, input.result, input.nowMs);
      return { kind: "terminal", reason: "superseded" };
    }

    if (input.result.kind === "completed" || input.result.kind === "deferred_to_frontier") {
      const terminalReason = input.result.kind === "deferred_to_frontier" ? "deferred_to_frontier" : "completed";
      db.prepare(
        `UPDATE inbox_events SET state = 'terminal', status = 'consumed',
            terminal_reason = ?, quarantine_reason = NULL,
            consumed_at_ms = ?, next_eligible_at_ms = NULL,
            claim_token = NULL, worker_id = NULL, lease_expires_at_ms = NULL
          WHERE id = ? AND state = 'leased' AND claim_token = ?`,
      ).run(terminalReason, input.nowMs, input.eventId, input.claimToken);
      if (input.result.kind === "completed") {
        convergeCoveredSiblingEvents(db, current, input.coveredSiblingEventIds ?? [], input.nowMs);
        finishWakeForEvent(db, current, "completed", input.nowMs);
      } else {
        if (current.wake_id) {
          db.prepare(
            `UPDATE wakes SET state = 'pending', lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
             WHERE wake_id = ? AND state != 'terminal'`,
          ).run(input.nowMs, current.wake_id);
        }
        if (input.result.cycleId) {
          updateCycleState(db, input.result.cycleId, "capacity_wait", input.nowMs);
        }
        const existingFrontier = getActiveDeferredFrontier(db, input.result.conversationId);
        if (existingFrontier) {
          rescheduleDeferredFrontier(db, existingFrontier.frontierId, input.result.nextEligibleAtMs, input.nowMs);
        } else {
          insertDeferredFrontierRecord(db, {
            conversationId: input.result.conversationId,
            cycleId: input.result.cycleId,
            generation: input.result.generation,
            nextEligibleAtMs: input.result.nextEligibleAtMs,
            latestEvidenceRowId: input.result.latestEvidenceRowId,
            nowMs: input.nowMs,
          });
        }
      }
      return { kind: "completed" };
    }

    if (input.result.kind === "outcome_unknown") {
      db.prepare(
        `UPDATE inbox_events SET state = 'reconciling', status = 'claimed',
            last_failure_class = 'outcome_unknown_reconcile', last_error = ?,
            next_eligible_at_ms = NULL, claim_token = NULL, worker_id = NULL,
            lease_expires_at_ms = NULL
          WHERE id = ? AND state = 'leased' AND claim_token = ?`,
      ).run(input.result.errorCode, input.eventId, input.claimToken);
      if (!current.wake_id) throw new Error("wake_required");
      wakeToReconciling(db, current.wake_id, input.nowMs);
      return { kind: "reconciling" };
    }

    const decision = nextRetryAt({
      ordinal: value.ordinal,
      firstAttemptAtMs: current.first_attempt_at_ms ?? value.started_at_ms,
      nowMs: input.nowMs,
      failureClass: normalized.failureClass as DurableFailureClass,
      retryAfterMs: input.result.retryAfterMs,
    });
    if (decision.kind === "retry_wait") {
      db.prepare(
        `UPDATE inbox_events SET state = 'retry_wait', status = 'failed_retryable',
            next_eligible_at_ms = ?, last_failure_class = ?, last_error = ?,
            claim_token = NULL, worker_id = NULL, lease_expires_at_ms = NULL
          WHERE id = ? AND state = 'leased' AND claim_token = ?`,
      ).run(decision.nextEligibleAtMs, normalized.failureClass, input.result.errorCode, input.eventId, input.claimToken);
      if (!current.wake_id) throw new Error("wake_required");
      wakeToPending(db, current.wake_id, input.nowMs);
      return decision;
    }

    const terminal: {
      state: "terminal" | "quarantined";
      reason: string;
      wakeReason: "completed" | "no_action" | "refused" | "cancelled" | "expired" | "quarantined" | "superseded";
      quarantineReason: string | null;
    } = normalized.failureClass === "permanent_terminal"
      ? { state: "terminal", reason: "permanent_failure", wakeReason: "quarantined" as const, quarantineReason: null }
      : normalized.failureClass === "stale_or_cancelled"
        ? {
            state: "terminal",
            reason: input.result.errorCode === "cancelled" ? "cancelled" : "stale",
            wakeReason: input.result.errorCode === "cancelled" ? "cancelled" as const : "no_action" as const,
            quarantineReason: null,
          }
        : { state: "quarantined", reason: decision.reason, wakeReason: "quarantined" as const, quarantineReason: decision.reason };
    db.prepare(
      `UPDATE inbox_events SET state = ?, status = 'failed_terminal',
          terminal_reason = ?, quarantine_reason = ?, last_failure_class = ?,
          last_error = ?, next_eligible_at_ms = NULL,
          claim_token = NULL, worker_id = NULL, lease_expires_at_ms = NULL
        WHERE id = ? AND state = 'leased' AND claim_token = ?`,
    ).run(
      terminal.state,
      terminal.reason,
      terminal.quarantineReason,
      normalized.failureClass,
      input.result.errorCode,
      input.eventId,
      input.claimToken,
    );
    const c3FailureClass = normalized.failureClass === "permanent_terminal"
      ? "permanent_terminal"
      : terminal.reason === "age_exhausted" || terminal.reason === "attempts_exhausted"
        ? terminal.reason
        : null;
    if (c3FailureClass && current.wake_id) {
      const wake = getWake(db, current.wake_id);
      const cycle = wake ? getCycle(db, wake.cycleId) : null;
      if (cycle) {
        c3Terminal = {
          eventId: input.eventId,
          attemptId: input.attemptId,
          wakeId: current.wake_id,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          ordinal: value.ordinal,
          dispatchTruth: normalized.dispatchTruth,
          failureClass: c3FailureClass,
          errorCode: input.result.errorCode,
          occurredAtMs: input.nowMs,
        };
      }
    }
    finishWakeForEvent(db, current, terminal.wakeReason, input.nowMs);
    retireOwnerlessCycleForTerminalEvent(db, current.wake_id, input.nowMs);
    return { kind: "terminal", reason: terminal.reason };
  });
  if (c3Terminal) recordRetryC3TerminalFailure(db, c3Terminal);
  return outcome;
}

type OutcomeUnknownSpendPartition =
  | { kind: "owner_no_reservation" }
  | { kind: "private_not_spent"; reservationId: string }
  | { kind: "private_spent"; reservationId: string; signal: string }
  | { kind: "private_uncertain"; detail: string };

function explicitPrivateReservationId(db: DatabaseSync, eventId: string): string | null {
  try {
    const found = db.prepare("SELECT payload_json FROM inbox_events WHERE id = ?").get(eventId) as { payload_json?: unknown } | undefined;
    const raw = found?.payload_json;
    if (typeof raw !== "string" || !raw) return null;
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const value = payload["privateBudgetReservationId"];
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    return null;
  }
}

/**
 * P0 spend-aware outcome-unknown partition (R7 §22.2). Applies ONLY to
 * proof-PASS rows (mechanical no-external-dispatch proof already complete).
 * The distinction is mechanical (payload reservation presence + ledger
 * state/dispatch_truth), never semantic content.
 *
 * - A. Owner/non-private, no private reservation: existing safe_to_retry.
 * - B. Private/periodic, provider NOT spent (held + parent/children all
 *      undispatched): same bound lineage may become retryable — no new
 *      conversation, no new reservation. Continuation additionally requires
 *      the periodic dispatch gate (dispatch/live.ts) and held-only
 *      reservation authorization at dispatch time.
 * - C. Private/periodic, provider SPENT (committed, or attempted/responded
 *      dispatch truth on parent/child): preserve committed/spent truth. NO
 *      fresh Thought, NO second reservation, NO replay, NO promotion of
 *      attempt residue, NO replacement lineage.
 * - D. Private/periodic, dispatch/spend truth uncertain: remain fenced.
 */
function classifyOutcomeUnknownSpend(
  db: DatabaseSync,
  eventId: string,
  wakeId: string | null,
): OutcomeUnknownSpendPartition {
  const explicitId = explicitPrivateReservationId(db, eventId);
  let state: string | null = null;
  let dispatchTruth: string | null = null;
  let reservationId: string | null = null;
  try {
    const found = explicitId
      ? getPrivateReservation(db, explicitId)
      : wakeId ? getPrivateReservationForWake(db, wakeId) : null;
    if (found) {
      state = found.state;
      dispatchTruth = found.dispatchTruth;
      reservationId = found.reservationId;
    }
  } catch {
    return {
      kind: "private_uncertain",
      detail: explicitId ? `reservation_lookup_failed:${explicitId}` : "wake_reservation_ambiguous",
    };
  }
  if (!reservationId || !state) {
    // Owner ingress writes no reservationId (owner cycles carry no binding).
    if (explicitId) return { kind: "private_uncertain", detail: `reservation_missing:${explicitId}` };
    return { kind: "owner_no_reservation" };
  }
  const history = listPrivateAttemptHistory(db, reservationId);
  const parentSpent = state === "committed" || dispatchTruth === "attempted" || dispatchTruth === "responded";
  const spentChild = history.some((record) => record.ordinal >= 2
    && (record.dispatchTruth === "attempted" || record.dispatchTruth === "responded"));
  if (parentSpent || spentChild) {
    const signal = state === "committed"
      ? "committed"
      : dispatchTruth === "attempted" || dispatchTruth === "responded"
        ? `parent_${dispatchTruth}`
        : "child_dispatched";
    return { kind: "private_spent", reservationId, signal };
  }
  const parentUndispatched = dispatchTruth === "not_bound" || dispatchTruth === "not_started";
  const childrenUndispatched = history.every((record) => record.ordinal === 1 || record.dispatchTruth === "not_started");
  if (state === "held" && parentUndispatched && childrenUndispatched) {
    return { kind: "private_not_spent", reservationId };
  }
  return { kind: "private_uncertain", detail: `state_${state}_${dispatchTruth ?? "missing"}` };
}

export function reconcileOutcomeUnknown(
  db: DatabaseSync,
  input: { eventId: string; nowMs: number; noExternalDispatchProof?: boolean; proofRef?: string },
): ReconcileOutcome {
  return beginAndRollbackOnError(db, () => {
    const current = event(db, input.eventId);
    if (current.state === "terminal" || current.state === "quarantined") {
      return { kind: "terminal", reason: current.terminal_reason ?? current.quarantine_reason ?? "completed", eventId: input.eventId };
    }
    if (current.state !== "reconciling") throw new Error("outcome_not_reconciling");
    if (!current.wake_id) {
      quarantineEvent(db, current, "wake_missing", input.nowMs);
      return { kind: "terminal", reason: "wake_missing", eventId: input.eventId };
    }

    // Collect candidate event IDs: this event plus any predecessor repair lineage
    const eventIds: string[] = [input.eventId];
    let cursor: string | null = input.eventId;
    while (cursor) {
      const repairRow = db.prepare(
        "SELECT predecessor_event_id FROM durable_work_repairs WHERE repair_event_id = ?",
      ).get(cursor) as { predecessor_event_id?: string } | undefined;
      if (repairRow?.predecessor_event_id && !eventIds.includes(repairRow.predecessor_event_id)) {
        eventIds.push(repairRow.predecessor_event_id);
        cursor = repairRow.predecessor_event_id;
      } else {
        cursor = null;
      }
    }

    const placeholders = eventIds.map(() => "?").join(",");
    const boundEffects = db.prepare(
      `SELECT effect_id, state FROM in_flight_effects WHERE origin_event_id IN (${placeholders})`,
    ).all(...eventIds) as Array<{ effect_id: string; state: string }>;

    if (boundEffects.length > 0) {
      const effectReceipts = boundEffects.map((eff) => {
        const row = db.prepare("SELECT outcome FROM effect_receipts WHERE effect_id = ?").get(eff.effect_id) as { outcome?: string } | undefined;
        return { effectId: eff.effect_id, inFlightState: eff.state, outcome: row?.outcome ?? null };
      });

      const hasMissingReceipt = effectReceipts.some((r) => r.outcome === null);
      const hasUnknown = effectReceipts.some((r) => r.outcome === "outcome_unknown" || r.outcome === "unknown");
      const hasInProgress = effectReceipts.some((r) => r.outcome === "in_progress");
      const hasFailed = effectReceipts.some((r) => r.outcome === "failed");
      const allSucceeded = effectReceipts.length > 0 && effectReceipts.every((r) => r.outcome === "succeeded");

      // §6.2 Multi-effect reconciliation rule:
      // If ANY bound effect has outcome="outcome_unknown" OR has no receipt -> return pending outcome_still_unknown
      if (hasMissingReceipt || hasUnknown || hasInProgress) {
        return { kind: "pending", reason: "outcome_still_unknown", eventId: input.eventId };
      }

      // Else if ALL bound effects have outcome="succeeded" -> return completed
      if (allSucceeded) {
        db.prepare(
          `UPDATE inbox_events SET state = 'terminal', status = 'consumed',
              terminal_reason = 'completed', quarantine_reason = NULL,
              consumed_at_ms = ?
            WHERE id = ? AND state = 'reconciling'`,
        ).run(input.nowMs, input.eventId);
        wakeToTerminal(db, current.wake_id, "completed", input.nowMs);
        retireOwnerlessCycleForTerminalEvent(db, current.wake_id, input.nowMs);
        return { kind: "terminal", reason: "completed", eventId: input.eventId };
      }

      // Else if ANY bound effect has outcome="failed" -> return permanent_failure
      if (hasFailed) {
        db.prepare(
          `UPDATE inbox_events SET state = 'terminal', status = 'failed_terminal',
              terminal_reason = 'permanent_failure', quarantine_reason = NULL,
              last_error = 'effect_receipt_failed'
            WHERE id = ? AND state = 'reconciling'`,
        ).run(input.eventId);
        wakeToTerminal(db, current.wake_id, "quarantined", input.nowMs);
        retireOwnerlessCycleForTerminalEvent(db, current.wake_id, input.nowMs);
        return { kind: "terminal", reason: "permanent_failure", eventId: input.eventId };
      }

      // Else (e.g. not_attempted) -> pending outcome_still_unknown
      return { kind: "pending", reason: "outcome_still_unknown", eventId: input.eventId };
    }

    // No bound effects found: check noExternalDispatchProof
    if (input.noExternalDispatchProof === true && input.proofRef?.trim()) {
      const partition = classifyOutcomeUnknownSpend(db, input.eventId, current.wake_id);
      if (partition.kind === "private_spent") {
        // P0 case C: provider is SPENT. Preserve committed/spent truth and
        // converge through the existing terminal Failure Truth (same
        // statements as the effect-failure branch above). No fresh Thought,
        // no second reservation, no replay, no residue promotion. The
        // periodic schedule observes this terminal execution truth later
        // (P1 T4 records admitted_failure) — the schedule write is
        // observation of execution truth, never fabrication.
        db.prepare(
          `UPDATE inbox_events SET state = 'terminal', status = 'failed_terminal',
              terminal_reason = 'permanent_failure', quarantine_reason = NULL,
              last_error = ?
            WHERE id = ? AND state = 'reconciling'`,
        ).run(`private_spent_no_rethought:${partition.signal}`, input.eventId);
        wakeToTerminal(db, current.wake_id, "quarantined", input.nowMs);
        retireOwnerlessCycleForTerminalEvent(db, current.wake_id, input.nowMs);
        return { kind: "terminal", reason: "permanent_failure", eventId: input.eventId };
      }
      if (partition.kind === "private_uncertain") {
        // P0 case D: dispatch/spend truth uncertain — remain fenced, fail
        // closed. No provider redispatch.
        return { kind: "pending", reason: "outcome_still_unknown", eventId: input.eventId };
      }
      // Cases A (owner/non-private) and B (private NOT-SPENT, same-lineage
      // continuation): existing safe_to_retry behavior below. Case B
      // continuation additionally requires the periodic dispatch gate
      // (dispatch/live.ts) and mechanically valid reservation authorization
      // (held-only precondition) at dispatch time.
      db.prepare(
        `UPDATE inbox_events SET state = 'pending', status = 'pending',
            last_error = ?, next_eligible_at_ms = NULL, claim_token = NULL,
            worker_id = NULL, lease_expires_at_ms = NULL
          WHERE id = ? AND state = 'reconciling'`,
      ).run(`safe_to_retry:${input.proofRef.trim()}`, input.eventId);
      wakeToPending(db, current.wake_id, input.nowMs);
      return { kind: "pending", reason: "safe_to_retry", eventId: input.eventId };
    }

    return { kind: "pending", reason: "outcome_still_unknown", eventId: input.eventId };
  });
}

function existingRepair(db: DatabaseSync, predecessorEventId: string, authorizationRef: string): RepairEvent | null {
  const value = row(db.prepare(
    `SELECT r.repair_event_id, r.predecessor_event_id, r.authorization_ref,
            e.wake_id, w.cycle_id
       FROM durable_work_repairs r
       JOIN inbox_events e ON e.id = r.repair_event_id
       JOIN wakes w ON w.wake_id = e.wake_id
      WHERE r.predecessor_event_id = ? AND r.authorization_ref = ?`,
  ).get(predecessorEventId, authorizationRef));
  if (!value) return null;
  const eventId = text(value.repair_event_id);
  return {
    id: eventId,
    eventId,
    wakeId: text(value.wake_id),
    cycleId: text(value.cycle_id),
    predecessorEventId: text(value.predecessor_event_id),
    authorizationRef: text(value.authorization_ref),
  };
}

export function createRepairEvent(db: DatabaseSync, input: CreateRepairEventInput): RepairEvent {
  if (!input.authorizationRef.trim()) throw new Error("repair_authority_missing");
  const deterministicId = input.eventId ?? `repair:${sha256({ predecessorEventId: input.predecessorEventId, authorizationRef: input.authorizationRef })}`;
  return beginAndRollbackOnError(db, () => {
    const existing = existingRepair(db, input.predecessorEventId, input.authorizationRef);
    if (existing) return existing;
    const predecessor = event(db, input.predecessorEventId);
    const predecessorTerminalFailed = predecessor.state === "terminal" && predecessor.status === "failed_terminal";
    if (predecessor.state !== "reconciling" && predecessor.state !== "quarantined" && !predecessorTerminalFailed) {
      throw new Error("repair_predecessor_not_reconciling");
    }
    if (input.continuityRecovery) {
      const refs = input.continuityRecovery.outstandingOwnerEvidenceRefs;
      if (!Array.isArray(refs) || refs.length === 0
        || refs.some((ref) => typeof ref !== "string" || !ref.trim())
        || input.continuityRecovery.reason !== "unanswered_owner_obligation_recovery"
        || !input.continuityRecovery.primaryPredecessorEventId.trim()) {
        throw new Error("repair_continuity_recovery_invalid");
      }
    }
    const provenOwnerId = resolveCanonicalOwnerPrincipal(db, {
      predecessorEventId: input.predecessorEventId,
      continuityRecovery: input.continuityRecovery,
    });
    const admission = admitWakeInTransaction(db, {
      occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: deterministicId, conversationId: predecessor.conversation_id }),
      triggerRef: deterministicId,
      sourceKind: "inbox",
      conversationId: predecessor.conversation_id,
      capturedAuthorityRevision: 0,
      triggerKind: "recovery",
      occupantId: provenOwnerId ?? undefined,
      nowMs: input.nowMs,
    });
    if (admission.kind === "cancelled" || admission.kind === "stale") throw new Error("repair_wake_terminal");
    const wake = admission.wake;
    const payload = JSON.stringify({
      referenceOnly: true,
      repairOfEventId: input.predecessorEventId,
      authorizationRef: input.authorizationRef,
      ...(provenOwnerId ? { ownerId: provenOwnerId } : {}),
      ...(input.continuityRecovery
        ? {
            continuityRecovery: {
              repairEventId: deterministicId,
              primaryPredecessorEventId: input.continuityRecovery.primaryPredecessorEventId,
              outstandingOwnerEvidenceRefs: [...input.continuityRecovery.outstandingOwnerEvidenceRefs],
              reason: input.continuityRecovery.reason,
            },
          }
        : {}),
    });
    db.prepare(
      `INSERT INTO inbox_events
         (id, conversation_id, kind, payload_json, created_at_ms, status,
          claim_token, worker_id, lease_expires_at_ms, attempt_count,
          claimed_at_ms, consumed_at_ms, last_error, wake_id, lane, priority,
          state, payload_hash, repair_of_event_id)
       VALUES (?, ?, 'repair', ?, ?, 'pending', NULL, NULL, NULL, 0, NULL, NULL,
               NULL, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      deterministicId,
      predecessor.conversation_id,
      payload,
      input.nowMs,
      wake.wakeId,
      predecessor.lane,
      predecessor.priority,
      sha256(input.payload ?? null),
      input.predecessorEventId,
    );
    db.prepare(
      `INSERT INTO durable_work_repairs
         (repair_event_id, predecessor_event_id, authorization_ref, created_at_ms)
       VALUES (?, ?, ?, ?)`,
    ).run(deterministicId, input.predecessorEventId, input.authorizationRef, input.nowMs);
    return {
      id: deterministicId,
      eventId: deterministicId,
      wakeId: wake.wakeId,
      cycleId: wake.cycleId,
      predecessorEventId: input.predecessorEventId,
      authorizationRef: input.authorizationRef,
    };
  });
}
