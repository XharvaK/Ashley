import type { DatabaseSync } from "node:sqlite";
import { admitCycle, appendCycleLogIds, getCurrentCycle, hasValidDurableContinuationOwner } from "./inbox.js";
import type { CycleRecord, CycleTriggerKind } from "../types.js";
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

