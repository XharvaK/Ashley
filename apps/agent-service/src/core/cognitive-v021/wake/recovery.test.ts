import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { putInFlight, markInFlightUnknown } from "../effect/in-flight.js";
import { admitWake, authorizeWake, beginConsequence, claimWake, finishWake, recoverWakes } from "./ledger.js";

describe("durable wake recovery", () => {
  it("reclaims a safe expired claim without minting a new identity", () => {
    const db = openTestSidecar();
    try {
      const admitted = admitWake(db, {
        occurrenceId: "wake-occurrence:lease",
        triggerRef: "turn-lease",
        sourceKind: "inbox",
        conversationId: "conversation-lease",
        cycleId: "cycle-lease",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      const first = claimWake(db, admitted.wake.wakeId, "crashed", 2, 5);
      const result = recoverWakes(db, 10);
      expect(result.reclaimed).toBe(1);
      const second = claimWake(db, admitted.wake.wakeId, "restarted", 11, 5);
      expect(second.wake.wakeId).toBe(admitted.wake.wakeId);
      expect(second.leaseToken).not.toBe(first.leaseToken);
    } finally {
      db.close();
    }
  });

  it("moves an ambiguous consequence to reconciliation and never replays it", () => {
    const db = openTestSidecar();
    try {
      const admitted = admitWake(db, {
        occurrenceId: "wake-occurrence:unknown",
        triggerRef: "turn-unknown",
        sourceKind: "inbox",
        conversationId: "conversation-unknown",
        cycleId: "cycle-unknown",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      db.prepare(`
        INSERT INTO inbox_events (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
        VALUES ('event-unknown', 'conversation-unknown', 'test', '{}', 1, 'claimed', ?)
      `).run(admitted.wake.wakeId);
      const claim = claimWake(db, admitted.wake.wakeId, "worker", 2, 100);
      authorizeWake(db, admitted.wake.wakeId, claim.leaseToken, 3);
      beginConsequence(db, admitted.wake.wakeId, claim.leaseToken, 1, 4);
      const effect = putInFlight(db, {
        effectId: "effect-unknown",
        cycleId: admitted.wake.cycleId,
        generation: 1,
        wakeId: admitted.wake.wakeId,
        correlationId: "correlation-unknown",
        idempotencyKey: "idempotency-unknown",
        payload: { referenceOnly: true },
        dispatchedAtMs: 5,
        originEventId: "event-unknown",
      });
      markInFlightUnknown(db, effect.effectId, 6);

      const result = recoverWakes(db, 7);
      expect(result.reconciling).toBe(1);
      expect(db.prepare("SELECT state FROM wakes WHERE wake_id = ?").get(admitted.wake.wakeId)).toMatchObject({ state: "reconciling" });
      expect(() => finishWake(db, admitted.wake.wakeId, claim.leaseToken, "completed", 8)).toThrow("wake_reconciliation_required");
    } finally {
      db.close();
    }
  });

  it("does not reopen a terminal wake during recovery", () => {
    const db = openTestSidecar();
    try {
      const admitted = admitWake(db, {
        occurrenceId: "wake-occurrence:terminal",
        triggerRef: "turn-terminal",
        sourceKind: "inbox",
        conversationId: "conversation-terminal",
        cycleId: "cycle-terminal",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      const claim = claimWake(db, admitted.wake.wakeId, "worker", 2, 100);
      finishWake(db, admitted.wake.wakeId, claim.leaseToken, "cancelled", 3);
      expect(recoverWakes(db, 100)).toMatchObject({ reclaimed: 0, reconciling: 0 });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(admitted.wake.wakeId)).toMatchObject({ state: "terminal", terminal_reason: "cancelled" });
    } finally {
      db.close();
    }
  });

  it("quarantines a nonterminal wake whose cycle lineage is missing", () => {
    const db = openTestSidecar();
    try {
      const admitted = admitWake(db, {
        occurrenceId: "wake-occurrence:lineage-corrupt",
        triggerRef: "turn-lineage-corrupt",
        sourceKind: "inbox",
        conversationId: "conversation-lineage-corrupt",
        cycleId: "cycle-lineage-corrupt",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      db.prepare("DELETE FROM cycle_records WHERE cycle_id = ?").run(admitted.wake.cycleId);

      expect(recoverWakes(db, 2)).toMatchObject({ quarantined: 1, reclaimed: 0, reconciling: 0 });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(admitted.wake.wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "quarantined",
      });
    } finally {
      db.close();
    }
  });
});
