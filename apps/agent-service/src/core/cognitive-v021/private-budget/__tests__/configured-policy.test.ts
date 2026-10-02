// Consumer fixtures require explicit configuration; unknown runtime policies still refuse.
import { describe, it, expect } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { getPrivateBudgetProjection, reservePrivateThought } from "../ledger.js";
import { reconcilePolicyClock } from "../policy-time-ledger.js";
import { admitWake } from "../../wake/ledger.js";
const fixture = await import("./" + "configured-policy.js").catch(() => null);
describe("L1 explicit consumer fixtures", () => {
  it("supports clock and pure projection for the legacy fixture ID without enabling arbitrary IDs", () => {
    const db = openTestSidecar(); try {
      fixture?.configurePrivateBudgetFixture(db);
      expect(() => reconcilePolicyClock(db, { policyId: "private-v1", wallClockNowMs: 1000, authorizationRef: "fixture" })).not.toThrow();
      expect(getPrivateBudgetProjection(db, { policyId: "private-v1", wallClockNowMs: 1000 }).remaining).toBe(12);
      expect(() => getPrivateBudgetProjection(db, { policyId: "undeclared", wallClockNowMs: 1000 })).toThrow("private_budget_policy_unconfigured");
    } finally { db.close(); }
  });
  it("admits and fingerprints a legacy fixture reservation without changing the actual default", () => {
    const db = openTestSidecar(); try {
      fixture?.configurePrivateBudgetFixture(db);
      const wake = admitWake(db, { occurrenceId: "fixture", triggerRef: "fixture", sourceKind: "idle", conversationId: "fixture", cycleId: "fixture", capturedAuthorityRevision: 1, nowMs: 1000 });
      expect(() => {
        const result = reservePrivateThought(db, { admissionId: "fixture", wakeId: wake.wake.wakeId, conversationId: "fixture", policyId: "private-v1", wallClockNowMs: 1000 });
        expect(result.kind).toBe("reserved");
      }).not.toThrow();
      expect(db.prepare("SELECT policy_fingerprint FROM private_budget_reservations").get()?.policy_fingerprint).toEqual(expect.stringMatching(/^sha256:/));
      expect(getPrivateBudgetProjection(db, { policyId: "ashley.private_thought.v1", wallClockNowMs: 1000 }).remaining).toBe(12);
    } finally { db.close(); }
  });
});
