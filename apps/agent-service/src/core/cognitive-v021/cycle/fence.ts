import type { DatabaseSync } from "node:sqlite";
import {
  admitCycle,
  appendCycleLogIds,
  basisFromEvidenceRows,
  currentAttemptIs,
  getCycle,
  getCycleFreshnessState,
  getCurrentCycle,
  markCycleDispositionInTransaction,
  setCycleFreshnessStateInTransaction,
  type CycleRecordWithFreshness,
  type FreshEvidenceRow,
  type FreshnessAttemptResult,
  type CycleFreshnessState,
  hasValidDurableContinuationOwner,
} from "./inbox.js";
import type { CycleRecord, CycleTriggerKind } from "../types.js";
import type { AttemptInputBasis } from "../social/types.js";
import { sha256 } from "../../model-fabric/hash.js";
import { suppressUndeliveredOutbox } from "../speech/outbox.js";
import { cancelActiveThought } from "./active.js";
import { admitWakeInTransaction, finishWakeInTransaction, getWake, reconcileWakeInTransaction, recordWakeCancellationInTransaction } from "../wake/ledger.js";
import { occurrenceIdFor } from "../wake/identity.js";

export type ComposeOrPreemptInput = {
  conversationId: string;
  evidenceRowIds?: string[];
  triggerKind?: CycleTriggerKind;
  triggerRef?: string;
  occupantId?: string | null;
  authorityEpoch?: number;
  nowMs?: number;
};

export type ActiveThoughtCancellation = {
  conversationId: string;
  cycleId: string;
  generation: number;
  action: "compose" | "preempt";
};

export type ComposeOrPreemptResult = {
  action: "compose" | "preempt";
  cycle: CycleRecord;
  cycleId: string;
  generation: number;
  preemptedGeneration: number | null;
  activeThoughtCancellation?: ActiveThoughtCancellation | null;
};

export type FreshnessAbsorbOptions = {
  nowMs?: number;
  projectionVersion?: string;
  /** Hard invalidation is a Host fact already established by the caller. */
  hardInvalidation?: boolean | string;
};

function freshEvidenceRef(row: FreshEvidenceRow): string {
  if (typeof row === "string") return row.trim();
  return (row.evidenceRowId ?? row.rowId ?? "").trim();
}

function uniqueFreshEvidenceRows(rows: readonly FreshEvidenceRow[], existing: readonly string[]): FreshEvidenceRow[] {
  const seen = new Set(existing);
  const result: FreshEvidenceRow[] = [];
  for (const row of rows) {
    const ref = freshEvidenceRef(row);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    result.push(typeof row === "string" ? ref : { ...row, evidenceRowId: ref });
  }
  return result;
}

function nextAttemptId(cycleId: string, previous: string | null): string {
  const suffix = previous?.match(/:(\d+)$/)?.[1];
  const ordinal = suffix ? Number(suffix) + 1 : 1;
  return `attempt:${cycleId}:${Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : 1}`;
}

function appendAttemptBasis(
  db: DatabaseSync,
  current: CycleFreshnessState,
  newRows: readonly FreshEvidenceRow[],
  projectionVersion?: string,
): AttemptInputBasis {
  const incoming = basisFromEvidenceRows(db, newRows, {
    projectionVersion: projectionVersion ?? current.attemptInputBasis?.projectionVersion,
  });
  if (!current.attemptInputBasis) {
    const existingRefs = getCycle(db, current.cycleId)?.composeLogIds ?? [];
    if (existingRefs.length === 0) return incoming;
    const existing = basisFromEvidenceRows(db, existingRefs, { projectionVersion });
    return {
      schemaVersion: 1,
      orderedRefs: [...existing.orderedRefs, ...incoming.orderedRefs.filter((ref) => !existing.orderedRefs.includes(ref))],
      versions: { ...existing.versions, ...incoming.versions },
      speakerAttributionHash: sha256([existing.speakerAttributionHash, incoming.speakerAttributionHash]),
      replyEdges: [...existing.replyEdges, ...incoming.replyEdges],
      attachmentCoverage: { ...existing.attachmentCoverage, ...incoming.attachmentCoverage },
      projectionVersion: projectionVersion ?? existing.projectionVersion,
    };
  }
  const base = current.attemptInputBasis;
  const orderedRefs = [...base.orderedRefs, ...incoming.orderedRefs.filter((ref) => !base.orderedRefs.includes(ref))];
  return {
    schemaVersion: 1,
    orderedRefs,
    versions: { ...base.versions, ...incoming.versions },
    speakerAttributionHash: sha256([base.speakerAttributionHash, incoming.speakerAttributionHash]),
    replyEdges: [...base.replyEdges, ...incoming.replyEdges],
    attachmentCoverage: { ...base.attachmentCoverage, ...incoming.attachmentCoverage },
    projectionVersion: projectionVersion ?? base.projectionVersion,
  };
}

function freshnessResult(
  db: DatabaseSync,
  cycleId: string,
  kind: FreshnessAttemptResult["kind"],
  previousAttemptId: string | null,
  options: { reason?: string; diagnostic?: string; activeThoughtCancellation?: FreshnessAttemptResult["activeThoughtCancellation"] } = {},
): FreshnessAttemptResult {
  const cycle = getCycle(db, cycleId);
  if (!cycle) throw new Error("cycle_missing");
  return {
    kind,
    cycle,
    previousAttemptId,
    attemptId: cycle.attemptId,
    supersessionsUsed: cycle.supersessionsUsed,
    pendingQueue: [...cycle.pendingQueue],
    attemptInputBasis: cycle.attemptInputBasis,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.diagnostic ? { diagnostic: options.diagnostic } : {}),
    ...(options.activeThoughtCancellation === undefined ? {} : { activeThoughtCancellation: options.activeThoughtCancellation }),
  };
}

function socialCycle(cycle: CycleRecordWithFreshness): boolean {
  return cycle.conversationId.startsWith("dm:")
    || cycle.conversationId.startsWith("room:")
    || cycle.triggerKind === ("external_message" as CycleTriggerKind);
}

/** Persist the hard invalidation fence without consuming freshness budget. */
export function hardInvalidateInTransaction(
  db: DatabaseSync,
  cycleId: string,
  options: { reason?: string; nowMs?: number } = {},
): FreshnessAttemptResult {
  const cycle = getCycle(db, cycleId);
  if (!cycle) throw new Error("cycle_missing");
  const previousAttemptId = cycle.attemptId;
  if (cycle.wakeId) recordWakeCancellationInTransaction(db, { wakeId: cycle.wakeId, nowMs: options.nowMs ?? Date.now() });
  markCycleDispositionInTransaction(db, cycleId, "hard_invalidated", { state: "silent", nowMs: options.nowMs ?? Date.now() });
  return freshnessResult(db, cycleId, "hard_invalidated", previousAttemptId, {
    reason: options.reason ?? "hard_invalidated",
    activeThoughtCancellation: {
      conversationId: cycle.conversationId,
      cycleId,
      generation: cycle.generation,
      action: "preempt",
    },
  });
}

export function hardInvalidate(
  db: DatabaseSync,
  cycleId: string,
  options: { reason?: string; nowMs?: number } = {},
): FreshnessAttemptResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = hardInvalidateInTransaction(db, cycleId, options);
    db.exec("COMMIT");
    if (result.activeThoughtCancellation) cancelActiveThought(result.activeThoughtCancellation);
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

/**
 * Apply the frozen one-initial-plus-two-supersessions rule. The caller's row
 * order is authoritative; this helper never sorts conversational evidence.
 */
export function absorbFreshMessagesInTransaction(
  db: DatabaseSync,
  cycleId: string,
  newEvidenceRows: readonly FreshEvidenceRow[],
  options: FreshnessAbsorbOptions = {},
): FreshnessAttemptResult {
  const cycle = getCycle(db, cycleId);
  if (!cycle) throw new Error("cycle_missing");
  if (options.hardInvalidation) {
    return hardInvalidateInTransaction(db, cycleId, {
      reason: typeof options.hardInvalidation === "string" ? options.hardInvalidation : "hard_invalidated",
      nowMs: options.nowMs,
    });
  }
  const current = getCycleFreshnessState(db, cycleId);
  const rows = uniqueFreshEvidenceRows(newEvidenceRows, current.attemptInputBasis?.orderedRefs ?? cycle.composeLogIds);
  if (rows.length === 0) throw new Error("fresh_evidence_required");
  const refs = rows.map(freshEvidenceRef);
  const previousAttemptId = current.attemptId;

  if (current.integrity === "queue_corrupt") throw new Error("freshness_queue_corrupt");

  if (!current.attemptId) {
    const basis = appendAttemptBasis(db, current, rows, options.projectionVersion);
    setCycleFreshnessStateInTransaction(db, cycleId, {
      attemptId: `attempt:${cycleId}:1`,
      attemptInputBasis: basis,
      state: "thinking",
      disposition: null,
      nowMs: options.nowMs ?? Date.now(),
    });
    appendCycleLogIds(db, cycleId, refs, options.nowMs ?? Date.now());
    return freshnessResult(db, cycleId, "started", previousAttemptId, { activeThoughtCancellation: null });
  }

  // A current attempt without a reconstructable basis cannot safely absorb.
  // Keep the new evidence durable in the overflow queue and refuse the attempt.
  if (!current.attemptInputBasis || current.integrity === "basis_missing") {
    const queue = [...current.pendingQueue, ...refs.filter((ref) => !current.pendingQueue.includes(ref))];
    setCycleFreshnessStateInTransaction(db, cycleId, {
      pendingQueue: queue,
      allowMissingBasis: true,
      nowMs: options.nowMs ?? Date.now(),
    });
    return freshnessResult(db, cycleId, "queued", previousAttemptId, {
      reason: "basis_missing",
      diagnostic: "attempt_refused_basis_missing",
      activeThoughtCancellation: null,
    });
  }

  const corruptCounter = current.integrity === "counter_corrupt";
  const used = corruptCounter ? 2 : current.supersessionsUsed;
  if (used >= 2) {
    const queue = [...current.pendingQueue, ...refs.filter((ref) => !current.pendingQueue.includes(ref))];
    setCycleFreshnessStateInTransaction(db, cycleId, { pendingQueue: queue, nowMs: options.nowMs ?? Date.now() });
    return freshnessResult(db, cycleId, "queued", previousAttemptId, {
      reason: "supersession_budget_exhausted",
      diagnostic: corruptCounter ? "freshness_counter_corrupt_treated_as_exhausted" : undefined,
      activeThoughtCancellation: null,
    });
  }

  const basis = appendAttemptBasis(db, current, rows, options.projectionVersion);
  const nextAttemptIdValue = nextAttemptId(cycleId, current.attemptId);
  appendCycleLogIds(db, cycleId, refs, options.nowMs ?? Date.now());
  setCycleFreshnessStateInTransaction(db, cycleId, {
    attemptId: nextAttemptIdValue,
    attemptInputBasis: basis,
    supersessionsUsed: used + 1,
    state: "thinking",
    disposition: null,
    nowMs: options.nowMs ?? Date.now(),
  });
  return freshnessResult(db, cycleId, "superseded", previousAttemptId, {
    activeThoughtCancellation: {
      conversationId: cycle.conversationId,
      cycleId,
      generation: cycle.generation,
      action: "compose",
    },
  });
}

export function absorbFreshMessages(
  db: DatabaseSync,
  cycleId: string,
  newEvidenceRows: readonly FreshEvidenceRow[],
  options: FreshnessAbsorbOptions = {},
): FreshnessAttemptResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = absorbFreshMessagesInTransaction(db, cycleId, newEvidenceRows, options);
    db.exec("COMMIT");
    if (result.activeThoughtCancellation) cancelActiveThought(result.activeThoughtCancellation);
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function preemptExternalAttemptInTransaction(
  db: DatabaseSync,
  cycleId: string,
  nowMs: number,
): FreshnessAttemptResult {
  const cycle = getCycle(db, cycleId);
  if (!cycle) throw new Error("cycle_missing");
  if (!socialCycle(cycle)) throw new Error("external_cycle_required");
  if (cycle.wakeId) recordWakeCancellationInTransaction(db, { wakeId: cycle.wakeId, nowMs });
  setCycleFreshnessStateInTransaction(db, cycleId, {
    state: "silent",
    disposition: "owner_preempted",
    nowMs,
  });
  return freshnessResult(db, cycleId, "owner_preempted", cycle.attemptId, {
    reason: "owner_preempted",
    activeThoughtCancellation: {
      conversationId: cycle.conversationId,
      cycleId,
      generation: cycle.generation,
      action: "preempt",
    },
  });
}

/** Persist Owner precedence over all currently active trusted-room work. */
export function preemptExternalRoomAttemptsInTransaction(
  db: DatabaseSync,
  nowMs = Date.now(),
): ActiveThoughtCancellation[] {
  const rows = db.prepare(
    `SELECT cycle_id
       FROM cycle_records
      WHERE conversation_id LIKE 'room:%'
        AND trigger_kind = 'external_message'
        AND state IN ('admitted', 'assembling', 'thinking', 'awaiting_operation',
                      'authority_check', 'publishing', 'sending', 'capacity_wait')
      ORDER BY admitted_at_ms ASC, cycle_id ASC`,
  ).all() as Array<{ cycle_id?: unknown }>;
  const cancellations: ActiveThoughtCancellation[] = [];
  for (const row of rows) {
    if (typeof row.cycle_id !== "string" || !row.cycle_id.trim()) continue;
    const result = preemptExternalAttemptInTransaction(db, row.cycle_id, nowMs);
    if (result.activeThoughtCancellation) cancellations.push(result.activeThoughtCancellation);
  }
  return cancellations;
}

/** Suspend external work for an Owner turn while retaining basis and queue. */
export function preemptExternalAttempt(
  db: DatabaseSync,
  cycleId: string,
  options: { nowMs?: number } = {},
): FreshnessAttemptResult {
  const nowMs = options.nowMs ?? Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = preemptExternalAttemptInTransaction(db, cycleId, nowMs);
    db.exec("COMMIT");
    if (result.activeThoughtCancellation) cancelActiveThought(result.activeThoughtCancellation);
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export const suspendExternalAttempt = preemptExternalAttempt;

/** Resume on the same ordered basis without consuming freshness budget. */
export function resumeExternalAttempt(
  db: DatabaseSync,
  cycleId: string,
  options: { nowMs?: number } = {},
): FreshnessAttemptResult {
  const nowMs = options.nowMs ?? Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const cycle = getCycle(db, cycleId);
    if (!cycle) throw new Error("cycle_missing");
    if (!socialCycle(cycle)) throw new Error("external_cycle_required");
    const current = getCycleFreshnessState(db, cycleId);
    if (!current.attemptInputBasis) {
      const result = freshnessResult(db, cycleId, "queued", current.attemptId, {
        reason: "basis_missing",
        diagnostic: "attempt_refused_basis_missing",
        activeThoughtCancellation: null,
      });
      db.exec("COMMIT");
      return result;
    }
    const nextAttemptIdValue = nextAttemptId(cycleId, current.attemptId);
    setCycleFreshnessStateInTransaction(db, cycleId, {
      attemptId: nextAttemptIdValue,
      state: "thinking",
      disposition: null,
      nowMs,
    });
    const result = freshnessResult(db, cycleId, "resumed", current.attemptId, { activeThoughtCancellation: null });
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function currentFreshnessAttemptIs(
  db: DatabaseSync,
  input: Parameters<typeof currentAttemptIs>[1],
): boolean {
  return currentAttemptIs(db, input);
}

function hasPublishedOutbox(db: DatabaseSync, conversationId: string, generation: number): boolean {
  const row = db.prepare(
    `SELECT 1 FROM speech_outbox
     WHERE conversation_id = ? AND generation = ?
     LIMIT 1`,
  ).get(conversationId, generation);
  return Boolean(row);
}

function hasEffectfulInFlight(db: DatabaseSync, cycleId: string, generation: number): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM in_flight_effects
     WHERE cycle_id = ? AND generation = ?
       AND state IN ('in_flight', 'unknown')
     LIMIT 1`,
  ).get(cycleId, generation));
}

function hasLiveOwnerContinuation(db: DatabaseSync, wakeId: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM inbox_events WHERE wake_id = ? AND kind IN ('owner_message', 'owner_utterance') AND state IN ('pending', 'retry_wait', 'leased') LIMIT 1",
  ).get(wakeId));
}

function retainWakeForOwnerContinuation(db: DatabaseSync, wakeId: string, nowMs: number): void {
  db.prepare(
    "UPDATE wakes SET state = 'pending', terminal_reason = NULL, lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL, updated_at_ms = ? WHERE wake_id = ? AND state != 'terminal'",
  ).run(nowMs, wakeId);
}

export function composeOrPreemptInTransaction(
  db: DatabaseSync,
  input: ComposeOrPreemptInput,
): ComposeOrPreemptResult {
  const nowMs = input.nowMs ?? Date.now();
  const current = getCurrentCycle(db, input.conversationId, { includeIdle: false });
  const triggerKind = input.triggerKind ?? "owner_message";
  const triggerRef = input.triggerRef ?? `${triggerKind}:${nowMs}`;
  if (!current) {
    const admission = admitWakeInTransaction(db, {
      occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef, conversationId: input.conversationId }),
      triggerRef,
      sourceKind: "inbox",
      conversationId: input.conversationId,
      triggerKind,
      occupantId: input.occupantId,
      authorityEpoch: input.authorityEpoch,
      capturedAuthorityRevision: 0,
      nowMs,
    });
    if (admission.kind === "cancelled" || admission.kind === "stale") throw new Error("wake_terminal");
    const cycle = admitCycle(db, {
      conversationId: input.conversationId,
      wakeId: admission.wake.wakeId,
      triggerKind,
      triggerRef,
      occupantId: input.occupantId,
      authorityEpoch: input.authorityEpoch,
      nowMs,
    });
    if ((input.evidenceRowIds ?? []).length > 0) appendCycleLogIds(db, cycle.cycleId, input.evidenceRowIds ?? [], nowMs);
    const finalCycle = (input.evidenceRowIds ?? []).length > 0 ? getCurrentCycle(db, input.conversationId, { includeIdle: false }) ?? cycle : cycle;
    return { action: "compose", cycle: finalCycle, cycleId: finalCycle.cycleId, generation: finalCycle.generation, preemptedGeneration: null, activeThoughtCancellation: null };
  }

  const isZombie = !hasValidDurableContinuationOwner(db, current);
  const effectful = !isZombie && hasEffectfulInFlight(db, current.cycleId, current.generation);
  const published = !isZombie && hasPublishedOutbox(db, input.conversationId, current.generation);
  if (!isZombie && !effectful && !published) {
    const cycle = appendCycleLogIds(db, current.cycleId, input.evidenceRowIds ?? [], nowMs);
    if (cycle.wakeId) recordWakeCancellationInTransaction(db, { wakeId: cycle.wakeId, nowMs });
    return {
      action: "compose",
      cycle,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      preemptedGeneration: null,
      activeThoughtCancellation: {
        conversationId: input.conversationId,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        action: "compose",
      },
    };
  }

  suppressUndeliveredOutbox(db, {
    conversationId: input.conversationId,
    generation: current.generation,
    reason: isZombie ? "preempted_zombie_cycle" : "preempted_by_new_generation",
  });
  db.prepare("UPDATE cycle_records SET state = 'silent', updated_at_ms = ? WHERE cycle_id = ?").run(nowMs, current.cycleId);
  if (current.wakeId) {
    const wake = getWake(db, current.wakeId);
    if (wake && wake.state !== "terminal") {
      recordWakeCancellationInTransaction(db, { wakeId: current.wakeId, nowMs });
      if (!isZombie && effectful) {
        reconcileWakeInTransaction(db, current.wakeId, nowMs);
      } else if (
        !isZombie
        && wake.state !== "reconciling"
        && wake.state !== "consequence_pending"
        && hasLiveOwnerContinuation(db, current.wakeId)
      ) {
        // Keep the old wake claimable until the exact covered Owner
        // obligation is settled or proven superseded by its successor.
        retainWakeForOwnerContinuation(db, current.wakeId, nowMs);
      } else if (wake.state !== "reconciling" && wake.state !== "consequence_pending") {
        finishWakeInTransaction(db, current.wakeId, wake.leaseToken, "cancelled", nowMs);
      }
    }
  }
  const admission = admitWakeInTransaction(db, {
    occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef, conversationId: input.conversationId }),
    triggerRef,
    sourceKind: "inbox",
    conversationId: input.conversationId,
    generation: current.generation + 1,
    triggerKind,
    occupantId: input.occupantId ?? current.occupantId,
    authorityEpoch: input.authorityEpoch ?? current.authorityEpoch,
    capturedAuthorityRevision: 0,
    nowMs,
    preemptedGeneration: current.generation,
  });
  if (admission.kind === "cancelled" || admission.kind === "stale") throw new Error("wake_terminal");
  const cycle = admitCycle(db, {
    conversationId: input.conversationId,
    wakeId: admission.wake.wakeId,
    triggerKind,
    triggerRef,
    occupantId: input.occupantId ?? current.occupantId,
    authorityEpoch: input.authorityEpoch ?? current.authorityEpoch,
    nowMs,
    preemptedGeneration: current.generation,
  });
  const successorEvidenceRowIds = [...new Set([
    ...current.composeLogIds,
    ...(input.evidenceRowIds ?? []),
  ])];
  if (successorEvidenceRowIds.length > 0) appendCycleLogIds(db, cycle.cycleId, successorEvidenceRowIds, nowMs);
  const finalCycle = (input.evidenceRowIds ?? []).length > 0 ? getCurrentCycle(db, input.conversationId, { includeIdle: false }) ?? cycle : cycle;
  return {
    action: "preempt",
    cycle: finalCycle,
    cycleId: finalCycle.cycleId,
    generation: finalCycle.generation,
    preemptedGeneration: current.generation,
    activeThoughtCancellation: {
      conversationId: input.conversationId,
      cycleId: current.cycleId,
      generation: current.generation,
      action: "preempt",
    },
  };
}

export function composeOrPreempt(
  db: DatabaseSync,
  input: ComposeOrPreemptInput,
): ComposeOrPreemptResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = composeOrPreemptInTransaction(db, input);
    db.exec("COMMIT");
    if (result.activeThoughtCancellation) {
      cancelActiveThought(result.activeThoughtCancellation);
    }
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}

