import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { admitWake } from "../wake/ledger.js";
import { cancelActiveThoughtDurable, registerActiveThought } from "./active.js";

describe("durable active Thought cancellation", () => {
  it("persists cancellation before aborting the in-memory provider call", () => {
    const db = openTestSidecar();
    try {
      const admitted = admitWake(db, {
        occurrenceId: "wake-occurrence:cancel",
        triggerRef: "turn-cancel",
        sourceKind: "inbox",
        conversationId: "conversation-cancel",
        cycleId: "cycle-cancel",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      const active = registerActiveThought("conversation-cancel", admitted.wake.cycleId, 1);
      expect(cancelActiveThoughtDurable(db, {
        conversationId: "conversation-cancel",
        cycleId: admitted.wake.cycleId,
        generation: 1,
        wakeId: admitted.wake.wakeId,
        action: "preempt",
        nowMs: 2,
      })).toBe(true);
      expect(active.signal.aborted).toBe(true);
      expect(db.prepare("SELECT cancellation_id FROM wakes WHERE wake_id = ?").get(admitted.wake.wakeId)).toMatchObject({ cancellation_id: expect.stringMatching(/^cancellation:/) });
      active.unregister();
    } finally {
      db.close();
    }
  });
});
