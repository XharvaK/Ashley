import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { admitWake, authorizeWake, beginConsequence, claimWake, finishWake } from "./ledger.js";

describe("durable wake consequence identity", () => {
  it("admits one consequence chain and keeps terminal wakes immutable", () => {
    const db = openTestSidecar();
    try {
      const admitted = admitWake(db, {
        occurrenceId: "wake-occurrence:consequence",
        triggerRef: "turn-consequence",
        sourceKind: "inbox",
        conversationId: "conversation-consequence",
        cycleId: "cycle-consequence",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      const claim = claimWake(db, admitted.wake.wakeId, "worker", 2, 100);
      authorizeWake(db, admitted.wake.wakeId, claim.leaseToken, 3);

      const first = beginConsequence(db, admitted.wake.wakeId, claim.leaseToken, 1, 4);
      const duplicate = beginConsequence(db, admitted.wake.wakeId, claim.leaseToken, 1, 5);
      expect(duplicate.chainId).toBe(first.chainId);
      expect(duplicate.wake.state).toBe("consequence_pending");

      const terminal = finishWake(db, admitted.wake.wakeId, claim.leaseToken, "completed", 6);
      expect(terminal.state).toBe("terminal");
      expect(finishWake(db, admitted.wake.wakeId, claim.leaseToken, "completed", 7)).toMatchObject({
        state: "terminal",
        terminalReason: "completed",
      });
      expect(() => finishWake(db, admitted.wake.wakeId, claim.leaseToken, "cancelled", 8)).toThrow("terminal_immutable");
      expect(() => beginConsequence(db, admitted.wake.wakeId, claim.leaseToken, 2, 9)).toThrow("wake_terminal");
    } finally {
      db.close();
    }
  });
});
