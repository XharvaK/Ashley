// Thought's checked expectations remain explicit semantic authorship in the graduation ledger.
import { describe, expect, it } from "vitest";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { recordExpectations, checkExpectations } from "./expectations.js";

describe("graduation Thought check integration", () => {
  it.each(["met", "mixed"] as const)("records an explicit %s Thought adjudication without copying the lesson", outcome => {
    const db = openTestSidecar();
    try {
      const first = admitTestCycle(db, { conversationId: "graduation-first", triggerKind: "owner_message", triggerRef: "first", nowMs: 1 });
      const later = admitTestCycle(db, { conversationId: "graduation-later", triggerKind: "owner_message", triggerRef: "later", nowMs: 2 });
      const [id] = recordExpectations(db, { cycleId: first.cycleId, statements: ["The outcome will be checked"], dataClassification: "ordinary", nowMs: 1 });
      checkExpectations(db, { cycleId: later.cycleId, checks: [{ expectationId: id!, outcome, lesson: "Private lesson that must not be copied" }], nowMs: 3 });
      const rows = db.prepare("SELECT * FROM graduation_adjudications WHERE expectation_id=?").all(id!);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ disposition: outcome === "met" ? "confirmed" : "partial_support", adjudication_authority: "ashley_thought_reflection", adjudicating_cycle_id: later.cycleId });
      expect(JSON.stringify(rows)).not.toContain("Private lesson");
    } finally { db.close(); }
  });
});
