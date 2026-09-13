import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { admitWake } from "../wake/ledger.js";
import { getCycle, updateCycleState } from "../cycle/inbox.js";
import { reconcileStartupOwnership } from "../cycle/reconcile.js";
import { putInFlight, recordEffectReceipt } from "../effect/in-flight.js";
import {
  claimNextDurableWork,
  reconcileOutcomeUnknown,
  settleDurableAttempt,
  startDurableAttempt,
} from "./ledger.js";

const AGE_MS = 15 * 60 * 1_000;

function seedThinkingOwnerWork(db: ReturnType<typeof openTestSidecar>, tag: string): {
  eventId: string;
  wakeId: string;
  cycleId: string;
  conversationId: string;
} {
  const conversationId = `conversation:${tag}`;
  const cycleId = `cycle:${tag}`;
  const eventId = `event:${tag}`;
  const admitted = admitWake(db, {
    occurrenceId: `occurrence:${tag}`,
    triggerRef: `trigger:${tag}`,
    sourceKind: "inbox",
    conversationId,
    cycleId,
    capturedAuthorityRevision: 1,
    nowMs: 1,
  });
  const wakeId = admitted.wake.wakeId;
  db.prepare(
    `INSERT INTO inbox_events
       (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
     VALUES (?, ?, 'test', ?, 1, 'pending', ?)`,
  ).run(eventId, conversationId, JSON.stringify({ cycleId, wakeId }), wakeId);
  // Occupying Thought owns this obligation through its wake.
  updateCycleState(db, cycleId, "thinking", 2);
  return { eventId, wakeId, cycleId, conversationId };
}

function counts(db: ReturnType<typeof openTestSidecar>, eventId: string): {
  attempts: number;
  settlements: number;
  outbox: number;
} {
  return {
    attempts: (db.prepare("SELECT COUNT(*) AS count FROM durable_work_attempts WHERE event_id = ?").get(eventId) as { count: number }).count,
    settlements: (db.prepare("SELECT COUNT(*) AS count FROM settlements").get() as { count: number }).count,
    outbox: (db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get() as { count: number }).count,
  };
}

describe("terminal durable-work lifecycle completes cycle occupancy", () => {
  it("quarantines Gen15-shaped age-exhausted owner work and retires the cycle to silent (production witness)", () => {
    const db = openTestSidecar();
    try {
      const { eventId, wakeId, cycleId } = seedThinkingOwnerWork(db, "gen15-age-prod");
      const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs: 1_000 });
      expect(started.ordinal).toBe(1);
      const settled = settleDurableAttempt(db, {
        eventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: {
          kind: "failed",
          failureClass: "transient_retryable",
          errorCode: "provider_unavailable",
          dispatchTruth: "not_started",
        },
        nowMs: 1_100,
      });
      expect(settled.kind).toBe("retry_wait");
      expect(getCycle(db, cycleId)?.state).toBe("thinking");

      // ~2h-old obligation is far beyond the 15-minute retry-age bound.
      // The normal consumer claim path (normalization) must lawfully apply
      // age_exhausted before creating a new durable attempt.
      const nowMs = 1_000 + AGE_MS + 120_000;
      const claimed = claimNextDurableWork(db, { workerId: "worker-2", nowMs });
      expect(claimed).toBeNull();

      expect(db.prepare("SELECT state, status, terminal_reason, quarantine_reason FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "quarantined",
        status: "failed_terminal",
        terminal_reason: "age_exhausted",
        quarantine_reason: "age_exhausted",
      });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "quarantined",
      });
      expect(getCycle(db, cycleId)?.state).toBe("silent");

      // No new durable attempt, no settlement, no speech outbox, no frontier.
      expect(counts(db, eventId)).toMatchObject({ attempts: 1, settlements: 0, outbox: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM deferred_reactive_frontiers WHERE cycle_id = ?").get(cycleId) as { count: number },
      ).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("retires the cycle on settle-time permanent failure (sibling witness)", () => {
    const db = openTestSidecar();
    try {
      const { eventId, wakeId, cycleId } = seedThinkingOwnerWork(db, "sibling-permanent");
      const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs: 1_000 });
      const settled = settleDurableAttempt(db, {
        eventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: {
          kind: "failed",
          failureClass: "permanent_terminal",
          errorCode: "invalid_request",
          dispatchTruth: "provider_responded",
        },
        nowMs: 1_100,
      });
      expect(settled).toEqual({ kind: "terminal", reason: "permanent_failure" });
      expect(db.prepare("SELECT state, terminal_reason FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "terminal",
        terminal_reason: "permanent_failure",
      });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "quarantined",
      });
      expect(getCycle(db, cycleId)?.state).toBe("silent");
      expect(counts(db, eventId)).toMatchObject({ attempts: 1, settlements: 0, outbox: 0 });
    } finally {
      db.close();
    }
  });

  it("retires the cycle on settle-time age exhaustion (sibling witness)", () => {
    const db = openTestSidecar();
    try {
      const { eventId, wakeId, cycleId } = seedThinkingOwnerWork(db, "sibling-settle-age");
      const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs: 1_000 });
      const settled = settleDurableAttempt(db, {
        eventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: {
          kind: "failed",
          failureClass: "transient_retryable",
          errorCode: "provider_unavailable",
          dispatchTruth: "not_started",
        },
        nowMs: 1_000 + AGE_MS + 1_000,
      });
      expect(settled).toEqual({ kind: "terminal", reason: "age_exhausted" });
      expect(db.prepare("SELECT state, terminal_reason, quarantine_reason FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "quarantined",
        terminal_reason: "age_exhausted",
        quarantine_reason: "age_exhausted",
      });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "quarantined",
      });
      expect(getCycle(db, cycleId)?.state).toBe("silent");
      expect(counts(db, eventId)).toMatchObject({ attempts: 1, settlements: 0, outbox: 0 });
    } finally {
      db.close();
    }
  });

  it("retires the cycle on reconcile permanent failure (sibling witness)", () => {
    const db = openTestSidecar();
    try {
      const { eventId, wakeId, cycleId } = seedThinkingOwnerWork(db, "sibling-reconcile-fail");
      const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs: 1_000 });
      settleDurableAttempt(db, {
        eventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:sibling", errorCode: "worker_crash" },
        nowMs: 1_100,
      });
      putInFlight(db, {
        effectId: "effect:sibling-fail",
        cycleId,
        generation: 1,
        wakeId,
        correlationId: "corr:sibling-fail",
        idempotencyKey: "idem:sibling-fail",
        dispatchedAtMs: 1_050,
        originEventId: eventId,
      });
      recordEffectReceipt(db, {
        receiptId: "rec:sibling-fail",
        effectId: "effect:sibling-fail",
        idempotencyKey: "idem:sibling-fail",
        outcome: "failed",
        claims: {},
        atMs: 1_200,
        dataClassification: "never_public",
        secretOmitted: false,
      });
      expect(reconcileOutcomeUnknown(db, { eventId, nowMs: 1_300 })).toEqual({
        kind: "terminal",
        reason: "permanent_failure",
        eventId,
      });
      expect(db.prepare("SELECT state, terminal_reason FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "terminal",
        terminal_reason: "permanent_failure",
      });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "quarantined",
      });
      expect(getCycle(db, cycleId)?.state).toBe("silent");
    } finally {
      db.close();
    }
  });

  it("retires the cycle on reconcile completion (sibling witness)", () => {
    const db = openTestSidecar();
    try {
      const { eventId, wakeId, cycleId } = seedThinkingOwnerWork(db, "sibling-reconcile-done");
      const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs: 1_000 });
      settleDurableAttempt(db, {
        eventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:sibling-done", errorCode: "worker_crash" },
        nowMs: 1_100,
      });
      putInFlight(db, {
        effectId: "effect:sibling-done",
        cycleId,
        generation: 1,
        wakeId,
        correlationId: "corr:sibling-done",
        idempotencyKey: "idem:sibling-done",
        dispatchedAtMs: 1_050,
        originEventId: eventId,
      });
      recordEffectReceipt(db, {
        receiptId: "rec:sibling-done",
        effectId: "effect:sibling-done",
        idempotencyKey: "idem:sibling-done",
        outcome: "succeeded",
        claims: {},
        atMs: 1_200,
        dataClassification: "never_public",
        secretOmitted: false,
      });
      expect(reconcileOutcomeUnknown(db, { eventId, nowMs: 1_300 })).toEqual({
        kind: "terminal",
        reason: "completed",
        eventId,
      });
      expect(db.prepare("SELECT state, terminal_reason FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "terminal",
        terminal_reason: "completed",
      });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "completed",
      });
      expect(getCycle(db, cycleId)?.state).toBe("silent");
    } finally {
      db.close();
    }
  });

  it("preserves deferred_to_frontier ownership transfer (negative control)", () => {
    const db = openTestSidecar();
    try {
      const { eventId, cycleId, conversationId } = seedThinkingOwnerWork(db, "deferred-control");
      const cycle = getCycle(db, cycleId);
      if (!cycle) throw new Error("cycle_missing");
      const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs: 1_000 });
      const settled = settleDurableAttempt(db, {
        eventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: {
          kind: "deferred_to_frontier",
          conversationId,
          cycleId,
          generation: cycle.generation,
          nextEligibleAtMs: 60_000,
          latestEvidenceRowId: eventId,
        },
        nowMs: 1_100,
      });
      expect(settled).toEqual({ kind: "completed" });
      expect(db.prepare("SELECT state, terminal_reason FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "terminal",
        terminal_reason: "deferred_to_frontier",
      });
      // Ownership transferred to the unresolved frontier: the cycle must
      // remain capacity_wait and must NOT be silenced by the general fix.
      expect(getCycle(db, cycleId)?.state).toBe("capacity_wait");
      expect(
        db.prepare("SELECT state FROM deferred_reactive_frontiers WHERE cycle_id = ?").get(cycleId) as { state: string },
      ).toMatchObject({ state: "waiting" });
    } finally {
      db.close();
    }
  });

  it("startup ownership reconciliation retires already-stranded thinking + terminal-quarantined residue (Gen15 residue witness)", () => {
    const db = openTestSidecar();
    try {
      const { eventId, wakeId, cycleId } = seedThinkingOwnerWork(db, "gen15-residue");
      // Historical residue as observed in production: inbox terminal/
      // quarantined age_exhausted, wake terminal/quarantined, cycle still
      // thinking, no frontier/settlement/outbox. Built with plain row state
      // (no new helper, no Gen15-specific rule) to represent the pre-fix
      // zombie that the next normal restart must repair.
      db.prepare(
        `UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal',
            terminal_reason = 'age_exhausted', quarantine_reason = 'age_exhausted',
            claim_token = NULL, worker_id = NULL, lease_expires_at_ms = NULL,
            next_eligible_at_ms = NULL WHERE id = ?`,
      ).run(eventId);
      db.prepare(
        "UPDATE wakes SET state = 'terminal', terminal_reason = 'quarantined', updated_at_ms = 3 WHERE wake_id = ?",
      ).run(wakeId);
      expect(getCycle(db, cycleId)?.state).toBe("thinking");

      const result = reconcileStartupOwnership(db, { nowMs: 4 });
      expect(result.retiredCycleIds).toContain(cycleId);
      expect(getCycle(db, cycleId)?.state).toBe("silent");
      // Terminal truth is preserved, not rewritten.
      expect(db.prepare("SELECT state, terminal_reason FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "quarantined",
        terminal_reason: "age_exhausted",
      });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "quarantined",
      });
    } finally {
      db.close();
    }
  });
});
