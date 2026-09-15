import { describe, expect, it } from "vitest";
import {
  absorbFreshMessages,
  currentFreshnessAttemptIs,
  preemptExternalAttempt,
  resumeExternalAttempt,
} from "./fence.js";
import {
  appendPendingQueue,
  basisFromEvidenceRows,
  getCycle,
  getCycleFreshnessState,
  initializeAttemptInputBasis,
  markIntentionalSilenceInTransaction,
  markTechnicalFailureInTransaction,
} from "./inbox.js";
import { reconcileStartupOwnership } from "./reconcile.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";

describe("v0.2.1 social freshness state machine", () => {
  it("reproduces the frozen §10.3 worked example and queues after exhaustion", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle:freshness-example",
        conversationId: "room:guild:channel",
        triggerKind: "owner_message",
        triggerRef: "M1",
        nowMs: 1,
      });

      // M1 → A([1]), used=0. M2 arrives → supersession #1 → A([1,2]), used=1. M3 arrives →
      // supersession #2 → A([1,2,3]), used=2. M4 arrives → budget exhausted → Q=[4]; candidate on
      // [1,2,3] may publish iff hard checks pass; M4 (+ later M5, M6, coalesced) goes to next
      // lifecycle. A hard revoke arriving with M4 blocks publication of [1,2,3] regardless of budget.
      expect(absorbFreshMessages(db, cycle.cycleId, ["1"], { nowMs: 2 }).kind).toBe("started");
      const first = absorbFreshMessages(db, cycle.cycleId, ["2"], { nowMs: 3 });
      expect(first.kind).toBe("superseded");
      expect(first.supersessionsUsed).toBe(1);
      const oldAttemptId = first.previousAttemptId;
      const oldBasis = first.attemptInputBasis;
      const second = absorbFreshMessages(db, cycle.cycleId, ["3"], { nowMs: 4 });
      expect(second.kind).toBe("superseded");
      expect(second.supersessionsUsed).toBe(2);
      expect(second.attemptInputBasis?.orderedRefs).toEqual(["1", "2", "3"]);
      expect(oldAttemptId).toBeTruthy();
      expect(oldBasis).toBeTruthy();
      expect(currentFreshnessAttemptIs(db, {
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        attemptId: oldAttemptId!,
        attemptInputBasis: oldBasis,
      })).toBe(false);
      expect(currentFreshnessAttemptIs(db, {
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        attemptId: second.attemptId!,
        attemptInputBasis: second.attemptInputBasis,
      })).toBe(true);

      const queued = absorbFreshMessages(db, cycle.cycleId, ["4", "5", "6"], { nowMs: 5 });
      expect(queued.kind).toBe("queued");
      expect(queued.pendingQueue).toEqual(["4", "5", "6"]);
      expect(getCycleFreshnessState(db, cycle.cycleId).supersessionsUsed).toBe(2);

      const nextRefs = queued.pendingQueue;
      const nextCycle = admitTestCycle(db, {
        cycleId: "cycle:freshness-next",
        conversationId: "room:guild:channel:next",
        triggerKind: "owner_message",
        triggerRef: "next-lifecycle",
        generation: 1,
        nowMs: 6,
      });
      const nextBasis = basisFromEvidenceRows(db, nextRefs);
      const next = initializeAttemptInputBasis(db, {
        cycleId: nextCycle.cycleId,
        basis: nextBasis,
        nowMs: 7,
      });
      expect(next.attemptInputBasis?.orderedRefs).toEqual(["4", "5", "6"]);
      expect(next.supersessionsUsed).toBe(0);
    } finally {
      db.close();
    }
  });

  it("hard-invalidates after exhaustion without consuming another supersession", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "room:hard-revoke",
        triggerKind: "owner_message",
        triggerRef: "M1",
        nowMs: 1,
      });
      absorbFreshMessages(db, cycle.cycleId, ["1"], { nowMs: 2 });
      absorbFreshMessages(db, cycle.cycleId, ["2"], { nowMs: 3 });
      absorbFreshMessages(db, cycle.cycleId, ["3"], { nowMs: 4 });
      const result = absorbFreshMessages(db, cycle.cycleId, ["4"], {
        hardInvalidation: "owner_revoke",
        nowMs: 5,
      });
      expect(result.kind).toBe("hard_invalidated");
      expect(result.supersessionsUsed).toBe(2);
      expect(getCycle(db, cycle.cycleId)).toMatchObject({ state: "silent", disposition: "hard_invalidated" });
    } finally {
      db.close();
    }
  });

  it("suspends and resumes external work while retaining B, Q, and the budget", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "dm:ashley:person",
        triggerKind: "owner_message",
        triggerRef: "M1",
        nowMs: 1,
      });
      absorbFreshMessages(db, cycle.cycleId, ["1"], { nowMs: 2 });
      absorbFreshMessages(db, cycle.cycleId, ["2"], { nowMs: 3 });
      appendPendingQueue(db, cycle.cycleId, ["queued"], 4);
      const before = getCycleFreshnessState(db, cycle.cycleId);
      const suspended = preemptExternalAttempt(db, cycle.cycleId, { nowMs: 5 });
      expect(suspended.kind).toBe("owner_preempted");
      expect(getCycle(db, cycle.cycleId)).toMatchObject({ state: "silent", disposition: "owner_preempted" });
      const resumed = resumeExternalAttempt(db, cycle.cycleId, { nowMs: 6 });
      expect(resumed.kind).toBe("resumed");
      expect(resumed.supersessionsUsed).toBe(before.supersessionsUsed);
      expect(resumed.pendingQueue).toEqual(before.pendingQueue);
      expect(resumed.attemptInputBasis?.orderedRefs).toEqual(before.attemptInputBasis?.orderedRefs);
      expect(resumed.attemptId).not.toBe(before.attemptId);
      expect(getCycle(db, cycle.cycleId)?.state).toBe("thinking");
    } finally {
      db.close();
    }
  });

  it("retains the ordered basis, counter, and queue across reconciliation", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "room:restart",
        triggerKind: "owner_message",
        triggerRef: "M1",
        nowMs: 1,
      });
      absorbFreshMessages(db, cycle.cycleId, ["1"], { nowMs: 2 });
      absorbFreshMessages(db, cycle.cycleId, ["2"], { nowMs: 3 });
      appendPendingQueue(db, cycle.cycleId, ["4"], 4);
      const before = getCycleFreshnessState(db, cycle.cycleId);
      const result = reconcileStartupOwnership(db, { nowMs: 5 });
      expect(result.retiredCycleIds).not.toContain(cycle.cycleId);
      const after = getCycleFreshnessState(db, cycle.cycleId);
      expect(after.attemptInputBasis?.orderedRefs).toEqual(before.attemptInputBasis?.orderedRefs);
      expect(after.supersessionsUsed).toBe(before.supersessionsUsed);
      expect(after.pendingQueue).toEqual(before.pendingQueue);
    } finally {
      db.close();
    }
  });

  it("retires an orphan without terminalizing its social input", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "room:orphan",
        triggerKind: "owner_message",
        triggerRef: "orphan-seed",
        nowMs: 1,
      });
      initializeAttemptInputBasis(db, {
        cycleId: cycle.cycleId,
        basis: basisFromEvidenceRows(db, ["orphan-evidence"]),
        nowMs: 2,
      });
      const event = db.prepare(
        `INSERT INTO inbox_events
           (id, conversation_id, kind, payload_json, created_at_ms, status, state, wake_id)
         VALUES ('external-orphan', ?, 'external_utterance', ?, 3, 'pending', 'pending', ?)`,
      );
      event.run(cycle.conversationId, JSON.stringify({ cycleId: cycle.cycleId, evidenceRowId: "orphan-evidence" }), cycle.wakeId);
      db.prepare("UPDATE cycle_records SET state = 'thinking' WHERE cycle_id = ?").run(cycle.cycleId);
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'cancelled' WHERE wake_id = ?").run(cycle.wakeId);

      const result = reconcileStartupOwnership(db, { nowMs: 4 });
      expect(result.unresolvedDeferredCycleIds).toContain(cycle.cycleId);
      expect(getCycle(db, cycle.cycleId)).toMatchObject({ state: "silent", disposition: "unresolved_deferred" });
      expect(db.prepare("SELECT state, status, terminal_reason FROM inbox_events WHERE id = 'external-orphan'").get()).toMatchObject({
        state: "pending",
        status: "pending",
        terminal_reason: null,
      });
    } finally {
      db.close();
    }
  });

  it("excludes intentional silence and does not spend freshness budget for technical failure", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "dm:silence",
        triggerKind: "owner_message",
        triggerRef: "silence",
        nowMs: 1,
      });
      absorbFreshMessages(db, cycle.cycleId, ["1"], { nowMs: 2 });
      const before = getCycleFreshnessState(db, cycle.cycleId);
      db.exec("BEGIN IMMEDIATE");
      markIntentionalSilenceInTransaction(db, cycle.cycleId, 3);
      db.exec("COMMIT");
      const result = reconcileStartupOwnership(db, { nowMs: 4 });
      expect(result.retiredCycleIds).not.toContain(cycle.cycleId);
      expect(getCycleFreshnessState(db, cycle.cycleId)).toMatchObject({
        disposition: "intentional_silence",
        supersessionsUsed: before.supersessionsUsed,
      });

      const technicalCycle = admitTestCycle(db, {
        conversationId: "dm:technical-failure",
        triggerKind: "owner_message",
        triggerRef: "technical-failure",
        nowMs: 5,
      });
      absorbFreshMessages(db, technicalCycle.cycleId, ["technical-evidence"], { nowMs: 6 });
      const technicalBefore = getCycleFreshnessState(db, technicalCycle.cycleId);
      db.exec("BEGIN IMMEDIATE");
      markTechnicalFailureInTransaction(db, technicalCycle.cycleId, 7);
      db.exec("COMMIT");
      const technicalResult = reconcileStartupOwnership(db, { nowMs: 8 });
      expect(technicalResult.retiredCycleIds).not.toContain(technicalCycle.cycleId);
      expect(getCycleFreshnessState(db, technicalCycle.cycleId)).toMatchObject({
        disposition: "technical_failure",
        supersessionsUsed: technicalBefore.supersessionsUsed,
      });
    } finally {
      db.close();
    }
  });
});
