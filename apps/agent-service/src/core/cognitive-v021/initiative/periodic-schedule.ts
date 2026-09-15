import type { DatabaseSync } from "node:sqlite";
import { sha256 } from "../../model-fabric/hash.js";
import { admitWakeInTransaction, getWake, type WakeAdmissionResult } from "../wake/ledger.js";
import { occurrenceIdFor } from "../wake/identity.js";
import { getCycle } from "../cycle/inbox.js";
import { getActiveDeferredFrontier } from "../frontier/ledger.js";
import {
  PRIVATE_THOUGHT_POLICY_ID,
  getPrivateBudgetProjection,
  getPrivateReservationForWake,
  listPrivateAttemptHistory,
  reservePrivateThought,
} from "../private-budget/ledger.js";
import { isPeriodicCognitionEnabled } from "../dispatch/live.js";
import {
  collectSubscriptionObservations,
  pollObservationSubscriptions,
  type ExternalSubscriptionPollOptions,
  type SubscriptionItem,
} from "../observation/subscriptions.js";
import {
  persistOrVerifyObservations,
  recoverObservationBindingForCycle,
} from "../observation/persistence.js";
import { listOccupancy } from "../concerns/occupancy.js";
import type { MindOccupancy, WakeRecord } from "../types.js";
import type { IdleObservationDraft } from "./idle.js";

/**
 * P1 periodic scheduling ledger + poll evaluation (R7 §§5–14, frozen).
 *
 * Singleton scope + 60 m cheap loop + 4 h opportunity + 4/hour policy budget
 * (S1 + S1b, both in P1). No new lifecycle, no new owner: the schedule is
 * durable state evaluated by the existing idle tick; Thought execution stays
 * on the existing kernel path; spend stays on the F1 budget ledger.
 */

export const PERIODIC_SCHEDULE_ID = "ashley-periodic-v1" as const;
/** Nominal opportunity cadence: 4 h (CHEAP_SERVICE_POLL=60 m drives the loop). */
export const PERIODIC_CADENCE_MS = 14_400_000 as const;
/** Due window: 1 period. Unbound-only expiry (bound occurrences never expire). */
export const PERIODIC_DUE_WINDOW_MS = 14_400_000 as const;
/** Live-only curiosity acquisition cap on the unbound due path (mirrors idle). */
export const PERIODIC_CURIOSITY_MAX_ITEMS = 12 as const;

export type PeriodicDisposition =
  | "admitted"
  | "admitted_failure"
  | "skipped_empty"
  | "expired"
  | "admitted_stale_suppressed"
  | "authority_epoch_abandoned";

export type PeriodicScheduleRow = {
  id: string;
  authorityEpoch: number;
  nextEligibleAtMs: number;
  pendingOccurrenceId: string | null;
  pendingWakeId: string | null;
  pendingDueAtMs: number | null;
  pendingExpiresAtMs: number | null;
  updatedAtMs: number;
};

export type PeriodicOccurrenceReceipt = {
  scheduleOccurrenceId: string;
  disposition: PeriodicDisposition;
  wakeId: string | null;
  authorityEpoch: number;
  eligibleAtMs: number;
  closedAtMs: number;
  detail: string | null;
};

function scheduleError(code: string): Error {
  return new Error(code);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rowToSchedule(value: Record<string, unknown>): PeriodicScheduleRow {
  return {
    id: text(value.id),
    authorityEpoch: Number(value.authority_epoch ?? 0),
    nextEligibleAtMs: Number(value.next_eligible_at_ms ?? 0),
    pendingOccurrenceId: value.pending_occurrence_id == null ? null : text(value.pending_occurrence_id),
    pendingWakeId: value.pending_wake_id == null ? null : text(value.pending_wake_id),
    pendingDueAtMs: value.pending_due_at_ms == null ? null : Number(value.pending_due_at_ms),
    pendingExpiresAtMs: value.pending_expires_at_ms == null ? null : Number(value.pending_expires_at_ms),
    updatedAtMs: Number(value.updated_at_ms ?? 0),
  };
}

function rowToReceipt(value: Record<string, unknown>): PeriodicOccurrenceReceipt {
  return {
    scheduleOccurrenceId: text(value.schedule_occurrence_id),
    disposition: text(value.disposition) as PeriodicDisposition,
    wakeId: value.wake_id == null ? null : text(value.wake_id),
    authorityEpoch: Number(value.authority_epoch ?? 0),
    eligibleAtMs: Number(value.eligible_at_ms ?? 0),
    closedAtMs: Number(value.closed_at_ms ?? 0),
    detail: value.detail == null ? null : text(value.detail),
  };
}

/**
 * Occurrence identity (R7 §6): conversation-free, epoch-bound, coalesced.
 * The epoch is part of the hash, so the same eligible time under a new
 * authority epoch is a different occurrence (EPOCH_IDENTITY_DIFFERS test).
 */
export function periodicScheduleOccurrenceId(input: { authorityEpoch: number; effectiveEligibleAtMs: number }): string {
  return `periodic-occurrence:${sha256({ scope: PERIODIC_SCHEDULE_ID, authorityEpoch: input.authorityEpoch, effectiveEligibleAtMs: input.effectiveEligibleAtMs })}`;
}

/**
 * Canonical periodic trigger_ref identity. Opaque to all consumers —
 * hashed/stored/prefix-filtered, never parsed. Embedding the schedule id
 * buys exact-trigger_ref recovery joins plus `LIKE 'periodic:%'` filtering
 * (P0 gate, P3 joins).
 */
export function periodicTriggerRef(scheduleOccurrenceId: string, effectiveEligibleAtMs: number): string {
  return `periodic:${scheduleOccurrenceId}:${effectiveEligibleAtMs}`;
}

/** Deterministic inbox-event identity per occurrence (exactly-once Thought). */
export function periodicEventId(scheduleOccurrenceId: string): string {
  return `periodic:${scheduleOccurrenceId}`;
}

export function readSchedule(db: DatabaseSync): PeriodicScheduleRow | null {
  const found = db.prepare("SELECT * FROM periodic_cognition_schedule WHERE id = ?").get(PERIODIC_SCHEDULE_ID) as Record<string, unknown> | undefined;
  return found ? rowToSchedule(found) : null;
}

/**
 * First activation only: creates the singleton row with next = now + 4 h.
 * Idempotent (returns the existing row). Creates NO pending occurrence and
 * authorizes NO Thought — schedule now+4h only, zero immediate paid Thought.
 */
export function createSchedule(db: DatabaseSync, input: { authorityEpoch: number; nowMs: number }): PeriodicScheduleRow {
  db.prepare(
    `INSERT OR IGNORE INTO periodic_cognition_schedule
       (id, authority_epoch, next_eligible_at_ms, pending_occurrence_id,
        pending_wake_id, pending_due_at_ms, pending_expires_at_ms, updated_at_ms)
     VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(PERIODIC_SCHEDULE_ID, input.authorityEpoch, input.nowMs + PERIODIC_CADENCE_MS, input.nowMs);
  const row = readSchedule(db);
  if (!row) throw scheduleError("periodic_schedule_missing");
  return row;
}

export function readReceipt(db: DatabaseSync, scheduleOccurrenceId: string): PeriodicOccurrenceReceipt | null {
  const found = db.prepare("SELECT * FROM periodic_cognition_occurrence_receipts WHERE schedule_occurrence_id = ?").get(scheduleOccurrenceId) as Record<string, unknown> | undefined;
  return found ? rowToReceipt(found) : null;
}

export function listReceipts(db: DatabaseSync): PeriodicOccurrenceReceipt[] {
  return (db.prepare("SELECT * FROM periodic_cognition_occurrence_receipts ORDER BY closed_at_ms ASC, schedule_occurrence_id ASC").all() as Array<Record<string, unknown>>).map(rowToReceipt);
}

export type MintPendingOccurrenceResult = {
  schedule: PeriodicScheduleRow;
  occurrenceId: string;
  effectiveEligibleAtMs: number;
  dueAtMs: number;
  expiresAtMs: number;
  reused: boolean;
};

/**
 * T1 — mint pending occurrence. Coalescing: a missed full period or more
 * collapses to the current time (no debt, no backlog, no synthetic
 * receipts); a now still inside the due window keeps the original eligible
 * time. Duplicate polls reuse the pending occurrence deterministically.
 */
export function mintPendingOccurrence(db: DatabaseSync, input: { nowMs: number }): MintPendingOccurrenceResult {
  const schedule = readSchedule(db);
  if (!schedule) throw scheduleError("periodic_schedule_missing");
  if (schedule.pendingOccurrenceId) {
    return {
      schedule,
      occurrenceId: schedule.pendingOccurrenceId,
      effectiveEligibleAtMs: schedule.pendingDueAtMs ?? schedule.nextEligibleAtMs,
      dueAtMs: schedule.pendingDueAtMs ?? schedule.nextEligibleAtMs,
      expiresAtMs: schedule.pendingExpiresAtMs ?? schedule.nextEligibleAtMs + PERIODIC_DUE_WINDOW_MS,
      reused: true,
    };
  }
  if (input.nowMs < schedule.nextEligibleAtMs) throw scheduleError("periodic_not_due");
  const effectiveEligibleAtMs = input.nowMs - schedule.nextEligibleAtMs >= PERIODIC_DUE_WINDOW_MS
    ? input.nowMs
    : schedule.nextEligibleAtMs;
  const occurrenceId = periodicScheduleOccurrenceId({
    authorityEpoch: schedule.authorityEpoch,
    effectiveEligibleAtMs,
  });
  const dueAtMs = effectiveEligibleAtMs;
  const expiresAtMs = effectiveEligibleAtMs + PERIODIC_DUE_WINDOW_MS;
  const updated = db.prepare(
    `UPDATE periodic_cognition_schedule
        SET pending_occurrence_id = ?, pending_due_at_ms = ?, pending_expires_at_ms = ?, updated_at_ms = ?
      WHERE id = ? AND pending_occurrence_id IS NULL`,
  ).run(occurrenceId, dueAtMs, expiresAtMs, input.nowMs, PERIODIC_SCHEDULE_ID);
  const current = readSchedule(db);
  if (!current) throw scheduleError("periodic_schedule_missing");
  if (Number(updated.changes ?? 0) !== 1) {
    // Lost a same-tick race: reuse whatever is pending now (idempotent).
    if (!current.pendingOccurrenceId) throw scheduleError("periodic_mint_conflict");
    return {
      schedule: current,
      occurrenceId: current.pendingOccurrenceId,
      effectiveEligibleAtMs: current.pendingDueAtMs ?? current.nextEligibleAtMs,
      dueAtMs: current.pendingDueAtMs ?? current.nextEligibleAtMs,
      expiresAtMs: current.pendingExpiresAtMs ?? current.nextEligibleAtMs + PERIODIC_DUE_WINDOW_MS,
      reused: true,
    };
  }
  return { schedule: current, occurrenceId, effectiveEligibleAtMs, dueAtMs, expiresAtMs, reused: false };
}

export type FreezeBindingResult =
  | { kind: "bound"; wake: WakeRecord; alreadyBound: boolean }
  | { kind: "cancelled" | "stale"; wake: WakeRecord };

/**
 * T2a freeze — same-transaction wake admission + schedule binding freeze.
 * admitWakeInTransaction and the pending_wake_id write share ONE BEGIN
 * IMMEDIATE: no admitted-but-unbound durable state can ever exist.
 * Pre-commit-crash twins re-resolve to the same wake (existing admission);
 * post-commit twins find pending_wake_id already set (same lineage adopted).
 */
export function freezeBinding(
  db: DatabaseSync,
  input: {
    occurrenceId: string;
    triggerRef: string;
    conversationId: string;
    occupantId?: string;
    authorityEpoch?: number;
    capturedAuthorityRevision?: number;
    nowMs: number;
    observations?: readonly IdleObservationDraft[];
  },
): FreezeBindingResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const admission: WakeAdmissionResult = admitWakeInTransaction(db, {
      occurrenceId: occurrenceIdFor({ sourceKind: "idle", triggerRef: input.triggerRef, conversationId: input.conversationId }),
      triggerRef: input.triggerRef,
      sourceKind: "idle",
      conversationId: input.conversationId,
      triggerKind: "idle_opportunity",
      occupantId: input.occupantId ?? "private",
      authorityEpoch: input.authorityEpoch ?? 1,
      capturedAuthorityRevision: input.capturedAuthorityRevision ?? 0,
      nowMs: input.nowMs,
    });
    if (admission.kind === "cancelled" || admission.kind === "stale") {
      db.exec("ROLLBACK");
      return { kind: admission.kind, wake: admission.wake };
    }
    const wake = admission.wake;
    const updated = db.prepare(
      `UPDATE periodic_cognition_schedule
          SET pending_wake_id = ?, updated_at_ms = ?
        WHERE id = ? AND pending_occurrence_id = ?
          AND (pending_wake_id IS NULL OR pending_wake_id = ?)`,
    ).run(wake.wakeId, input.nowMs, PERIODIC_SCHEDULE_ID, input.occurrenceId, wake.wakeId);
    if (Number(updated.changes ?? 0) !== 1) {
      db.exec("ROLLBACK");
      throw scheduleError("periodic_binding_conflict");
    }
    if (input.observations !== undefined) {
      const cycle = getCycle(db, wake.cycleId);
      if (!cycle || cycle.wakeId !== wake.wakeId) throw scheduleError("periodic_cycle_missing");
      persistOrVerifyObservations(
        db,
        input.observations.map((observation) => ({
          ...observation,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
        })),
        input.nowMs,
      );
    }
    db.exec("COMMIT");
    return { kind: "bound", wake, alreadyBound: admission.kind === "existing" };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the binding error */ }
    throw error;
  }
}

/**
 * Terminal schedule transition: receipt + pending-clear + next-advance in
 * ONE sidecar transaction. PK replay is idempotent and never double-advances
 * (returns the existing receipt without touching the schedule).
 * Advancement is disposition-relative: max(eventMs, prevNext) + 4 h.
 */
export function clearPendingAndAdvance(
  db: DatabaseSync,
  input: {
    occurrenceId: string;
    disposition: PeriodicDisposition;
    wakeId: string | null;
    eventMs: number;
    nowMs: number;
    detail?: string;
  },
): PeriodicOccurrenceReceipt {
  const existing = readReceipt(db, input.occurrenceId);
  if (existing) return existing;
  db.exec("BEGIN IMMEDIATE");
  try {
    const replay = readReceipt(db, input.occurrenceId);
    if (replay) {
      db.exec("ROLLBACK");
      return replay;
    }
    const schedule = readSchedule(db);
    if (!schedule) {
      db.exec("ROLLBACK");
      throw scheduleError("periodic_schedule_missing");
    }
    if (schedule.pendingOccurrenceId !== input.occurrenceId) {
      db.exec("ROLLBACK");
      throw scheduleError("periodic_occurrence_mismatch");
    }
    db.prepare(
      `INSERT INTO periodic_cognition_occurrence_receipts
         (schedule_occurrence_id, disposition, wake_id, authority_epoch,
          eligible_at_ms, closed_at_ms, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.occurrenceId,
      input.disposition,
      input.wakeId,
      schedule.authorityEpoch,
      schedule.pendingDueAtMs ?? schedule.nextEligibleAtMs,
      input.nowMs,
      input.detail ?? null,
    );
    const nextEligibleAtMs = Math.max(input.eventMs, schedule.nextEligibleAtMs) + PERIODIC_CADENCE_MS;
    db.prepare(
      `UPDATE periodic_cognition_schedule
          SET pending_occurrence_id = NULL, pending_wake_id = NULL,
              pending_due_at_ms = NULL, pending_expires_at_ms = NULL,
              next_eligible_at_ms = ?, updated_at_ms = ?
        WHERE id = ?`,
    ).run(nextEligibleAtMs, input.nowMs, PERIODIC_SCHEDULE_ID);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the terminal error */ }
    throw error;
  }
  const receipt = readReceipt(db, input.occurrenceId);
  if (!receipt) throw scheduleError("periodic_receipt_missing");
  return receipt;
}

export function adoptAuthorityEpoch(db: DatabaseSync, input: { authorityEpoch: number; nowMs: number }): PeriodicScheduleRow {
  db.prepare(
    "UPDATE periodic_cognition_schedule SET authority_epoch = ?, updated_at_ms = ? WHERE id = ?",
  ).run(input.authorityEpoch, input.nowMs, PERIODIC_SCHEDULE_ID);
  const row = readSchedule(db);
  if (!row) throw scheduleError("periodic_schedule_missing");
  return row;
}

/**
 * NULL-scope existing-wake recovery adoption (S2): when the schedule holds
 * an UNBOUND pending occurrence, exactly one already-admitted wake under
 * the exact periodic trigger_ref is adopted instead of minting a second wake.
 * NON-NULL missing/mismatch never reaches here (fail-closed in evaluation).
 */
export function findUnboundWake(db: DatabaseSync, occurrenceId: string, dueAtMs: number): WakeRecord | null {
  const rows = db.prepare("SELECT * FROM wakes WHERE trigger_ref = ? ORDER BY created_at_ms ASC, wake_id ASC").all(
    periodicTriggerRef(occurrenceId, dueAtMs),
  ) as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  if (rows.length > 1) throw scheduleError("periodic_wake_ambiguous");
  const wake = getWake(db, text((rows[0] as Record<string, unknown>).wake_id));
  if (!wake) throw scheduleError("periodic_wake_missing");
  return wake;
}

export type EpochTransition =
  | { kind: "current"; schedule: PeriodicScheduleRow }
  | { kind: "adopted"; schedule: PeriodicScheduleRow }
  | { kind: "committed_terminal_closed"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt }
  | { kind: "bound_retained"; schedule: PeriodicScheduleRow; epochCase: "c3a" | "c3b" }
  | { kind: "bound_safe_closed"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt }
  | { kind: "unbound_abandoned"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt };

function terminalDispositionForWake(wake: WakeRecord): PeriodicDisposition {
  return wake.terminalReason === "completed" || wake.terminalReason === "no_action"
    ? "admitted"
    : "admitted_failure";
}

/**
 * Durable no-dispatch proof for a bound pre-dispatch occurrence: the
 * reservation was released with proof and no attempt anywhere (parent or
 * child) ever crossed W0. Anything else is not safe to close.
 */
export function hasDurableNoDispatchProof(db: DatabaseSync, reservationId: string): boolean {
  let reservation: { state: string; dispatchTruth: string; releaseProofRef: string | null } | null = null;
  try {
    const found = db.prepare("SELECT state, dispatch_truth, release_proof_ref FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as
      { state?: unknown; dispatch_truth?: unknown; release_proof_ref?: unknown } | undefined;
    if (!found) return false;
    reservation = {
      state: text(found.state),
      dispatchTruth: text(found.dispatch_truth),
      releaseProofRef: found.release_proof_ref == null ? null : text(found.release_proof_ref),
    };
  } catch {
    return false;
  }
  if (reservation.state !== "released" || !reservation.releaseProofRef || reservation.dispatchTruth !== "not_started") return false;
  try {
    const history = listPrivateAttemptHistory(db, reservationId);
    return history.every((record) => record.dispatchTruth === "not_started");
  } catch {
    return false;
  }
}

/**
 * T10 — execution-aware authority-epoch transition (C1–C5 incl. C3a/C3b).
 * Epoch identity is part of the occurrence hash, so a mismatched epoch can
 * never continue the old occurrence: bound execution retains its binding and
 * defers the epoch write (C3a/C3b, blocking T1/T2a while mismatched);
 * terminal bound truth closes under the old epoch first (C2); unbound
 * pending is abandoned with a receipt (C4); empty schedules adopt (C5).
 */
export function evaluateAuthorityEpochTransition(
  db: DatabaseSync,
  input: { schedule: PeriodicScheduleRow; currentEpoch: number; nowMs: number },
): EpochTransition {
  const { schedule, currentEpoch, nowMs } = input;
  if (schedule.authorityEpoch === currentEpoch) return { kind: "current", schedule };
  const occurrenceId = schedule.pendingOccurrenceId;
  if (!occurrenceId) {
    // C5: nothing pending under the old epoch — adopt, keep next_eligible.
    // No receipt (nothing abandoned); minting under the new epoch still
    // requires due + enabled + gates (no spurious admission on epoch change).
    return { kind: "adopted", schedule: adoptAuthorityEpoch(db, { authorityEpoch: currentEpoch, nowMs }) };
  }
  if (!schedule.pendingWakeId) {
    // C4: unbound pending under a dead epoch — abandon with receipt so the
    // history stays reconstructable, advance, adopt.
    const receipt = clearPendingAndAdvance(db, {
      occurrenceId,
      disposition: "authority_epoch_abandoned",
      wakeId: null,
      eventMs: nowMs,
      nowMs,
      detail: `epoch:${schedule.authorityEpoch}->${currentEpoch}`,
    });
    return { kind: "unbound_abandoned", schedule: adoptAuthorityEpoch(db, { authorityEpoch: currentEpoch, nowMs }), receipt };
  }
  const wake = schedule.pendingWakeId ? getWake(db, schedule.pendingWakeId) : null;
  if (!wake || wake.state === "terminal") {
    if (wake?.state === "terminal") {
      // C2: bound execution already terminal — close under the old epoch
      // first (admitted truth), advance, adopt. Never replaced.
      const receipt = clearPendingAndAdvance(db, {
        occurrenceId,
        disposition: terminalDispositionForWake(wake),
        wakeId: wake.wakeId,
        eventMs: nowMs,
        nowMs,
        detail: `terminal:${wake.terminalReason ?? "unknown"}`,
      });
      return { kind: "committed_terminal_closed", schedule: adoptAuthorityEpoch(db, { authorityEpoch: currentEpoch, nowMs }), receipt };
    }
    // Missing wake under mismatch: retain conservatively (binding branch
    // fail-closes); the epoch write stays deferred.
    return { kind: "bound_retained", schedule, epochCase: "c3b" };
  }
  let committed = false;
  try {
    committed = getPrivateReservationForWake(db, wake.wakeId)?.state === "committed";
  } catch {
    return { kind: "bound_retained", schedule, epochCase: "c3b" };
  }
  if (committed) {
    // C3a: committed/running execution retains its binding; the epoch write
    // is deferred and T1/T2a stay blocked while mismatched. No replacement.
    return { kind: "bound_retained", schedule, epochCase: "c3a" };
  }
  // C3b: bound pre-dispatch. Retain + defer, except a durable no-dispatch
  // proof safely closes (same truthful close as T11) and adopts.
  try {
    const reservation = getPrivateReservationForWake(db, wake.wakeId);
    if (reservation && hasDurableNoDispatchProof(db, reservation.reservationId)) {
      const receipt = clearPendingAndAdvance(db, {
        occurrenceId,
        disposition: "admitted_stale_suppressed",
        wakeId: wake.wakeId,
        eventMs: nowMs,
        nowMs,
        detail: "no-dispatch-proof",
      });
      return { kind: "bound_safe_closed", schedule: adoptAuthorityEpoch(db, { authorityEpoch: currentEpoch, nowMs }), receipt };
    }
  } catch {
    return { kind: "bound_retained", schedule, epochCase: "c3b" };
  }
  return { kind: "bound_retained", schedule, epochCase: "c3b" };
}

const GROUNDED_OCCUPANCY_STATUSES = ["active", "investigating", "waiting_for_evidence"];

function groundedOccupancy(db: DatabaseSync, conversationId: string): MindOccupancy[] {
  try {
    const rows = db.prepare("SELECT * FROM mind_occupancy WHERE conversation_id = ?").all(conversationId) as Array<Record<string, unknown>>;
    return rows
      .filter((row) => GROUNDED_OCCUPANCY_STATUSES.includes(text(row.status)))
      .map((row) => ({
        conversationId: text(row.conversation_id),
        concernId: text(row.concern_id),
        status: text(row.status) as MindOccupancy["status"],
        priority: Number(row.priority ?? 0),
        updatedCycle: text(row.updated_cycle),
        updatedGeneration: Number(row.updated_generation ?? 0),
      }));
  } catch {
    return [];
  }
}

function asObservationDraft(observation: import("../types.js").Observation): IdleObservationDraft {
  const { cycleId: _cycleId, generation: _generation, ...draft } = observation;
  return draft;
}

function occupancyConversations(db: DatabaseSync): string[] {
  try {
    const rows = db.prepare(
      "SELECT DISTINCT conversation_id FROM mind_occupancy WHERE status IN ('active', 'investigating', 'waiting_for_evidence') ORDER BY conversation_id ASC",
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => text(row.conversation_id)).filter(Boolean);
  } catch {
    return [];
  }
}

export type PeriodicRunnable = {
  occurrenceId: string;
  wakeId: string;
  conversationId: string;
  reservationId: string;
  triggerRef: string;
  observations: IdleObservationDraft[];
};

export type PeriodicPollDecision =
  | { kind: "no_schedule_disabled" }
  | { kind: "schedule_created"; schedule: PeriodicScheduleRow }
  | { kind: "not_due"; schedule: PeriodicScheduleRow }
  | { kind: "disabled_retained"; schedule: PeriodicScheduleRow }
  | { kind: "trigger_deferred"; schedule: PeriodicScheduleRow }
  | { kind: "epoch_blocked"; schedule: PeriodicScheduleRow; epochCase: "c3a" | "c3b" }
  | { kind: "pending_retained"; schedule: PeriodicScheduleRow; occurrenceId: string; reason: string }
  | { kind: "bound_runnable"; schedule: PeriodicScheduleRow; runnable: PeriodicRunnable }
  | { kind: "admit_runnable"; schedule: PeriodicScheduleRow; runnable: PeriodicRunnable }
  | { kind: "admission_unavailable"; schedule: PeriodicScheduleRow; occurrenceId: string; reason: "wake_cancelled" | "wake_stale" }
  | { kind: "terminal_observed"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt }
  | { kind: "stale_closed"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt }
  | { kind: "skipped_empty"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt }
  | { kind: "expired"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt }
  | { kind: "epoch_abandoned"; schedule: PeriodicScheduleRow; receipt: PeriodicOccurrenceReceipt };

export type PeriodicPollInput = {
  scopeConversationId?: string;
  occupantId?: string;
  authorityEpoch?: number;
  nowMs?: number;
  /** Explicit enablement (agent passes env resolution); absent ⇒ env read. */
  enabled?: boolean;
  policyId?: string;
  subscriptionItems?: Array<SubscriptionItem | string>;
  /** When supplied, the existing scheduler polls admitted watches before matching. */
  externalWatchPoll?: Omit<ExternalSubscriptionPollOptions, "nowMs">;
  /** Lets the idle owner use the same poll result for its ordinary match path. */
  onExternalWatchItems?: (items: SubscriptionItem[]) => void;
  /** T8 precedence: any authored trigger fired this poll defers new periodic work. */
  dueTriggerFired?: boolean;
  acquireObservations?: (input: {
    conversationId: string;
    nowMs: number;
    occupancy: MindOccupancy[];
  }) => Promise<IdleObservationDraft[]> | IdleObservationDraft[];
};

function resolveEnabled(explicit: boolean | undefined): boolean {
  return explicit ?? isPeriodicCognitionEnabled();
}

function liveEventExists(db: DatabaseSync, occurrenceId: string): boolean {
  try {
    const found = db.prepare("SELECT id FROM inbox_events WHERE id = ?").get(periodicEventId(occurrenceId)) as { id?: unknown } | undefined;
    if (!found) return false;
    const state = (db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(periodicEventId(occurrenceId)) as { state?: unknown } | undefined)?.state;
    return state !== "terminal" && state !== "quarantined";
  } catch {
    return true;
  }
}

function deferCheck(
  db: DatabaseSync,
  input: { conversationId: string; policyId: string; nowMs: number; needsCapacity: boolean },
): { ok: true } | { ok: false; reason: string } {
  if (input.needsCapacity) {
    let projection: { clockState: string; remaining: number };
    try {
      projection = getPrivateBudgetProjection(db, { policyId: input.policyId, wallClockNowMs: input.nowMs });
    } catch {
      return { ok: false, reason: "budget_unreadable" };
    }
    // clock_reconciliation (rows without a clock) fails closed. The
    // migration_epoch_required state is bootstrap-eligible by construction
    // (it occurs only with zero reservations) and passes through so the
    // atomic bootstrap-and-admit reserve path can run (FRESH_SIDECAR test).
    if (projection.clockState === "clock_reconciliation") return { ok: false, reason: "clock_reconciliation" };
    if (projection.clockState !== "stable" && projection.clockState !== "migration_epoch_required") {
      return { ok: false, reason: "clock_reconciliation" };
    }
    if (projection.remaining <= 0) return { ok: false, reason: "budget_exhausted" };
  }
  try {
    if (getActiveDeferredFrontier(db, input.conversationId)) return { ok: false, reason: "active_frontier" };
  } catch {
    return { ok: false, reason: "frontier_unreadable" };
  }
  return { ok: true };
}

function evaluateBoundOccurrence(
  db: DatabaseSync,
  input: {
    schedule: PeriodicScheduleRow;
    occurrenceId: string;
    wakeId: string;
    nowMs: number;
    dispatchAllowed: boolean;
    policyId: string;
  },
): PeriodicPollDecision {
  const { schedule, occurrenceId, wakeId, nowMs } = input;
  const wake = getWake(db, wakeId);
  if (!wake) return { kind: "pending_retained", schedule, occurrenceId, reason: "bound_wake_missing" };
  const cycle = getCycle(db, wake.cycleId);
  if (!cycle || cycle.wakeId !== wake.wakeId || cycle.conversationId !== wake.conversationId) {
    // Lineage-integrity fail-closed (never T2a). Thread (scope) changes are
    // fine — adoption ignores them — but wake/cycle divergence is not.
    return { kind: "pending_retained", schedule, occurrenceId, reason: "bound_wake_conversation_mismatch" };
  }
  if (wake.state === "terminal") {
    // T4: bound truth-first recovery observes terminal execution truth.
    // Unblockable by fresh gates (budget/frontier never consulted here).
    const receipt = clearPendingAndAdvance(db, {
      occurrenceId,
      disposition: terminalDispositionForWake(wake),
      wakeId: wake.wakeId,
      eventMs: nowMs,
      nowMs,
      detail: `terminal:${wake.terminalReason ?? "unknown"}`,
    });
    return { kind: "terminal_observed", schedule: readSchedule(db) ?? schedule, receipt };
  }
  // T11: deterministic close on durable no-dispatch proof (truthful
  // bookkeeping — allowed disabled or enabled, never a fabrication).
  if (!liveEventExists(db, occurrenceId)) {
    try {
      const reservation = getPrivateReservationForWake(db, wake.wakeId);
      if (reservation && hasDurableNoDispatchProof(db, reservation.reservationId)) {
        const receipt = clearPendingAndAdvance(db, {
          occurrenceId,
          disposition: "admitted_stale_suppressed",
          wakeId: wake.wakeId,
          eventMs: nowMs,
          nowMs,
          detail: "no-dispatch-proof",
        });
        return { kind: "stale_closed", schedule: readSchedule(db) ?? schedule, receipt };
      }
    } catch {
      return { kind: "pending_retained", schedule, occurrenceId, reason: "reservation_ambiguous" };
    }
  }
  let reservation: { reservationId: string; state: string } | null = null;
  try {
    reservation = getPrivateReservationForWake(db, wake.wakeId);
  } catch {
    return { kind: "pending_retained", schedule, occurrenceId, reason: "reservation_ambiguous" };
  }
  if (reservation?.state === "committed") {
    // Committed recovery never re-enters budget admission and authorizes no
    // replacement dispatch; existing execution truth finishes on its own.
    return { kind: "pending_retained", schedule, occurrenceId, reason: "committed_recovery" };
  }
  if (liveEventExists(db, occurrenceId)) {
    // The occurrence already has live durable work; the consumer owns it.
    return { kind: "pending_retained", schedule, occurrenceId, reason: "event_live" };
  }
  if (!input.dispatchAllowed) {
    return { kind: "pending_retained", schedule, occurrenceId, reason: "dispatch_deferred" };
  }
  const recoveredBinding = recoverObservationBindingForCycle(db, cycle);
  if (recoveredBinding.kind === "unknown") {
    // A bound occurrence without a durable non-empty binding cannot be
    // interpreted as an empty capture. Retain it for explicit repair or
    // later durable evidence; never dispatch Thought on fabricated NONE.
    return { kind: "pending_retained", schedule, occurrenceId, reason: "periodic_observation_binding_conflict" };
  }
  // A held reservation is valid continuation of the same lineage — it never
  // self-refuses (existing-reserve path bypasses capacity/clock projection).
  // Only a missing reservation needs capacity proof first.
  const check = deferCheck(db, {
    conversationId: wake.conversationId,
    policyId: input.policyId,
    nowMs,
    needsCapacity: !reservation,
  });
  if (!check.ok) return { kind: "pending_retained", schedule, occurrenceId, reason: check.reason };
  const admissionId = `private-thought:${wake.wakeId}`;
  const admitted = reservePrivateThought(db, {
    admissionId,
    wakeId: wake.wakeId,
    conversationId: wake.conversationId,
    policyId: input.policyId,
    wallClockNowMs: nowMs,
  });
  if (admitted.kind === "refused" || admitted.reservation.state !== "held") {
    return { kind: "pending_retained", schedule, occurrenceId, reason: "reserve_refused" };
  }
  return {
    kind: "bound_runnable",
    schedule,
    runnable: {
      occurrenceId,
      wakeId: wake.wakeId,
      conversationId: wake.conversationId,
      reservationId: admitted.reservation.reservationId,
      triggerRef: wake.triggerRef,
      observations: recoveredBinding.observations.map(asObservationDraft),
    },
  };
}

async function evaluateUnboundOccurrence(
  db: DatabaseSync,
  input: {
    schedule: PeriodicScheduleRow;
    occurrenceId: string;
    dueAtMs: number;
    scopeConversationId?: string;
    occupantId: string;
    authorityEpoch: number;
    nowMs: number;
    dispatchAllowed: boolean;
    policyId: string;
    subscriptionItems: Array<SubscriptionItem | string>;
    acquireObservations?: PeriodicPollInput["acquireObservations"];
  },
): Promise<PeriodicPollDecision> {
  const { schedule, occurrenceId, dueAtMs, nowMs } = input;
  // NULL-scope recovery adoption: exactly one already-admitted wake under
  // the exact trigger_ref binds instead of minting a second wake (S2).
  const orphan = findUnboundWake(db, occurrenceId, dueAtMs);
  if (orphan) {
    const frozen = freezeBinding(db, {
      occurrenceId,
      triggerRef: orphan.triggerRef,
      conversationId: orphan.conversationId,
      occupantId: input.occupantId,
      authorityEpoch: input.authorityEpoch,
      nowMs,
    });
    if (frozen.kind !== "bound") {
      return { kind: "admission_unavailable", schedule, occurrenceId, reason: frozen.kind === "cancelled" ? "wake_cancelled" : "wake_stale" };
    }
    return evaluateBoundOccurrence(db, {
      schedule: readSchedule(db) ?? schedule,
      occurrenceId,
      wakeId: frozen.wake.wakeId,
      nowMs,
      dispatchAllowed: input.dispatchAllowed,
      policyId: input.policyId,
    });
  }
  // Selectable-until-bound: scope-if-occupied first, then occupied
  // conversations in order, then scope for acquisition-only.
  const occupied = occupancyConversations(db);
  const candidates: string[] = [];
  if (input.scopeConversationId) candidates.push(input.scopeConversationId);
  for (const conversationId of occupied) {
    if (!candidates.includes(conversationId)) candidates.push(conversationId);
  }
  const occupancyOf = (conversationId: string): MindOccupancy[] => groundedOccupancy(db, conversationId);
  let candidate: string | null = null;
  let candidateOccupancy: MindOccupancy[] = [];
  for (const conversationId of candidates) {
    const occupancy = occupancyOf(conversationId);
    if (occupancy.length > 0) {
      candidate = conversationId;
      candidateOccupancy = occupancy;
      break;
    }
  }
  if (!candidate && input.scopeConversationId) {
    candidate = input.scopeConversationId;
    candidateOccupancy = [];
  }
  if (!candidate) {
    // No selectable conversation anywhere: no provider call (zero network),
    // material fails by construction → T6 skip-empty, advance, no debt.
    const receipt = clearPendingAndAdvance(db, {
      occurrenceId,
      disposition: "skipped_empty",
      wakeId: null,
      eventMs: nowMs,
      nowMs,
      detail: "no-candidate",
    });
    return { kind: "skipped_empty", schedule: readSchedule(db) ?? schedule, receipt };
  }
  if (!input.dispatchAllowed) {
    return { kind: "pending_retained", schedule, occurrenceId, reason: "dispatch_deferred" };
  }
  // T9 defer-check BEFORE curiosity: budget/frontier deferral retains the
  // pending occurrence with no receipt, no debt, still selectable.
  const check = deferCheck(db, {
    conversationId: candidate,
    policyId: input.policyId,
    nowMs,
    needsCapacity: true,
  });
  if (!check.ok) return { kind: "pending_retained", schedule, occurrenceId, reason: check.reason };
  // UNBOUND-only curiosity-before-materiality: live-only, ≤12, swallowed.
  // Acquisition errors degrade to best-effort empty (never force admission).
  let acquired: IdleObservationDraft[] = [];
  if (input.acquireObservations) {
    try {
      const result = await input.acquireObservations({ conversationId: candidate, nowMs, occupancy: candidateOccupancy });
      acquired = (Array.isArray(result) ? result : []).slice(0, PERIODIC_CURIOSITY_MAX_ITEMS);
    } catch {
      acquired = [];
    }
  }
  let matched: IdleObservationDraft[] = [];
  try {
    matched = collectSubscriptionObservations(db, candidate, input.subscriptionItems, { nowMs })
      .map(asObservationDraft);
  } catch {
    matched = [];
  }
  if (candidateOccupancy.length === 0 && matched.length === 0 && acquired.length === 0) {
    // T6: due + empty (no occupancy, no subs, empty acquisition) may skip.
    const receipt = clearPendingAndAdvance(db, {
      occurrenceId,
      disposition: "skipped_empty",
      wakeId: null,
      eventMs: nowMs,
      nowMs,
      detail: "empty",
    });
    return { kind: "skipped_empty", schedule: readSchedule(db) ?? schedule, receipt };
  }
  // T2a: admit + reserve + freeze (admission and binding share one txn;
  // the observation binding is persisted in the same transaction; the
  // reservation commits spend only at dispatch, per F1).
  const triggerRef = periodicTriggerRef(occurrenceId, dueAtMs);
  let frozen: FreezeBindingResult;
  try {
    frozen = freezeBinding(db, {
      occurrenceId,
      triggerRef,
      conversationId: candidate,
      occupantId: input.occupantId,
      authorityEpoch: input.authorityEpoch,
      nowMs,
      observations: [...matched, ...acquired],
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("observation_")) {
      return { kind: "pending_retained", schedule, occurrenceId, reason: "periodic_observation_binding_conflict" };
    }
    throw error;
  }
  if (frozen.kind !== "bound") {
    return { kind: "admission_unavailable", schedule, occurrenceId, reason: frozen.kind === "cancelled" ? "wake_cancelled" : "wake_stale" };
  }
  const admitted = reservePrivateThought(db, {
    admissionId: `private-thought:${frozen.wake.wakeId}`,
    wakeId: frozen.wake.wakeId,
    conversationId: candidate,
    policyId: input.policyId,
    wallClockNowMs: nowMs,
  });
  if (admitted.kind === "refused" || admitted.reservation.state !== "held") {
    // Bound pre-reservation: same lineage continues next poll (no orphan —
    // the binding is frozen, the reservation simply wasn't acquired).
    return { kind: "pending_retained", schedule: readSchedule(db) ?? schedule, occurrenceId, reason: "reserve_refused" };
  }
  return {
    kind: "admit_runnable",
    schedule: readSchedule(db) ?? schedule,
    runnable: {
      occurrenceId,
      wakeId: frozen.wake.wakeId,
      conversationId: candidate,
      reservationId: admitted.reservation.reservationId,
      triggerRef,
      observations: [...matched, ...acquired],
    },
  };
}

/**
 * One poll evaluation. Order (frozen §7.3): schedule read (+ first
 * activation) → kill-switch A–F → T10 → NOT_DUE/PENDING/expiry →
 * binding branch. Non-due polls and bound-recovery polls perform zero
 * network I/O (acquisition runs only on the unbound due path).
 */
export async function evaluatePeriodicPoll(
  db: DatabaseSync,
  input: PeriodicPollInput,
): Promise<PeriodicPollDecision> {
  const nowMs = input.nowMs ?? Date.now();
  const enabled = resolveEnabled(input.enabled);
  const authorityEpoch = input.authorityEpoch ?? 1;
  const policyId = input.policyId ?? PRIVATE_THOUGHT_POLICY_ID;
  let subscriptionItems = input.subscriptionItems ?? [];
  if (input.externalWatchPoll !== undefined) {
    try {
      const polled = await pollObservationSubscriptions(db, {
        ...input.externalWatchPoll,
        nowMs,
      });
      if (polled.items.length > 0) {
        subscriptionItems = [...subscriptionItems, ...polled.items];
        input.onExternalWatchItems?.(polled.items);
      }
    } catch {
      // External watch failure is represented per watch by the poll owner;
      // a transport exception must not block the existing scheduler.
    }
  }

  let schedule = readSchedule(db);
  if (!schedule) {
    // First activation is schedule creation only (now+4h, no Thought).
    // While disabled no row is even created (kill-switch A).
    if (!enabled) return { kind: "no_schedule_disabled" };
    return { kind: "schedule_created", schedule: createSchedule(db, { authorityEpoch, nowMs }) };
  }

  if (!enabled) {
    // PERIODIC_DISABLED_POLICY A–F: unbound pending is kept durable with no
    // T2a/curiosity/wake/reservation/dispatch and no expiry/C4 churn (B);
    // bound lineages still observe terminal/no-dispatch truth (C/D/E) but
    // never cross into new provider dispatch.
    if (!schedule.pendingOccurrenceId || !schedule.pendingWakeId) {
      return { kind: "disabled_retained", schedule };
    }
    return evaluateBoundOccurrence(db, {
      schedule,
      occurrenceId: schedule.pendingOccurrenceId,
      wakeId: schedule.pendingWakeId,
      nowMs,
      dispatchAllowed: false,
      policyId,
    });
  }

  const transition = evaluateAuthorityEpochTransition(db, { schedule, currentEpoch: authorityEpoch, nowMs });
  if (transition.kind === "committed_terminal_closed") {
    return { kind: "terminal_observed", schedule: transition.schedule, receipt: transition.receipt };
  }
  if (transition.kind === "bound_safe_closed") {
    return { kind: "stale_closed", schedule: transition.schedule, receipt: transition.receipt };
  }
  if (transition.kind === "unbound_abandoned") {
    return { kind: "epoch_abandoned", schedule: transition.schedule, receipt: transition.receipt };
  }
  if (transition.kind === "bound_retained") {
    return { kind: "epoch_blocked", schedule: transition.schedule, epochCase: transition.epochCase };
  }
  schedule = transition.schedule;
  const dispatchAllowed = !input.dueTriggerFired;

  if (!schedule.pendingOccurrenceId) {
    if (nowMs < schedule.nextEligibleAtMs) return { kind: "not_due", schedule };
    const minted = mintPendingOccurrence(db, { nowMs });
    schedule = minted.schedule;
    if (!schedule.pendingOccurrenceId) return { kind: "not_due", schedule };
  }

  const occurrenceId = schedule.pendingOccurrenceId;
  const dueAtMs = schedule.pendingDueAtMs ?? schedule.nextEligibleAtMs;
  const expiresAtMs = schedule.pendingExpiresAtMs ?? dueAtMs + PERIODIC_DUE_WINDOW_MS;

  if (!schedule.pendingWakeId) {
    if (nowMs > expiresAtMs) {
      // T7: unbound-only expiry (bound occurrences never expire through T7).
      const receipt = clearPendingAndAdvance(db, {
        occurrenceId,
        disposition: "expired",
        wakeId: null,
        eventMs: nowMs,
        nowMs,
        detail: "window-expiry",
      });
      return { kind: "expired", schedule: readSchedule(db) ?? schedule, receipt };
    }
    return evaluateUnboundOccurrence(db, {
      schedule,
      occurrenceId,
      dueAtMs,
      scopeConversationId: input.scopeConversationId,
      occupantId: input.occupantId ?? "private",
      authorityEpoch,
      nowMs,
      dispatchAllowed,
      policyId,
      subscriptionItems,
      acquireObservations: input.acquireObservations,
    });
  }

  return evaluateBoundOccurrence(db, {
    schedule,
    occurrenceId,
    wakeId: schedule.pendingWakeId,
    nowMs,
    dispatchAllowed,
    policyId,
  });
}
