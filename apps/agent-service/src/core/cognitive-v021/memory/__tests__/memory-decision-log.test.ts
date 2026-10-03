import { describe, expect, it, vi } from "vitest";
import { logMemoryAdmission, logMemorySettlement } from "../decision-log.js";

describe("memory decision logs", () => {
  it("logs an absent, empty, or present nomination decision and the admission summary", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logMemorySettlement("settlement-absent", "turn", undefined);
      logMemorySettlement("settlement-empty", "afterglow", []);
      logMemorySettlement("settlement-two", "awake", [{ nominationId: "a" }, { nominationId: "b" }]);
      logMemoryAdmission({
        considered: 3,
        admitted: 1,
        skippedSuperseded: 0,
        skippedSecret: 0,
        skippedUnpublished: 0,
        skippedGeneration: 0,
        skippedRetracted: 0,
        skippedProvenance: 2,
      });
      expect(spy.mock.calls.map((call) => call[0])).toEqual([
        "[memory] settlement=settlement-absent pass=turn nominations=-1",
        "[memory] settlement=settlement-empty pass=afterglow nominations=0",
        "[memory] settlement=settlement-two pass=awake nominations=2",
        "[memory] admission considered=3 admitted=1 skipped=provenance:2",
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});
