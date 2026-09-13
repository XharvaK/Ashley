import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { putInFlight, recordEffectReceipt } from "../effect/in-flight.js";
import { loadAuthorityPacks } from "../authority/packs.js";

describe("v0.2.1 Authority scenarios", () => {
  it("reconstructs receipt authority after restart from the sidecar", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-1",
        conversationId: "thread-1",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "authority-restart",
        occupantId: "doc",
        nowMs: 1,
      });
      putInFlight(db, { effectId: "effect-1", cycleId: "cycle-1", generation: 1, correlationId: "corr-1", idempotencyKey: "idem-1", dispatchedAtMs: 1, originEventId: "authority-restart" });
      recordEffectReceipt(db, { receiptId: "receipt-1", effectId: "effect-1", idempotencyKey: "idem-1", outcome: "outcome_unknown", claims: {}, atMs: 2, dataClassification: "ordinary", secretOmitted: false });
      expect(loadAuthorityPacks(db).receipt.receiptsByEffectId["effect-1"]?.outcome).toBe("outcome_unknown");
      expect(db.prepare("SELECT COUNT(*) AS count FROM effect_receipts").get()).toMatchObject({ count: 1 });
    } finally { db.close(); }
  });
});
