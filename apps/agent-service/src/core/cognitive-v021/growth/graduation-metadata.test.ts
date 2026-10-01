// Predictions retain the facts Ashley supplied; the Host does not author their meaning.
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { getExpectation, recordExpectations } from "../growth/expectations.js";
import { isValidGrowthClaim } from "../growth/claim.js";

describe("graduation prediction metadata", () => {
  it("stores bounded prediction metadata alongside an existing expectation", () => {
    const db = openTestSidecar();
    try {
      const claim = { statement: "A reply will arrive", basisRefs: [], judgmentClass: "reply", observable: "reply admitted", horizonHours: 24, check: "owner_reply" as const };
      const [id] = recordExpectations(db, { cycleId: "metadata-pass", statements: [claim], dataClassification: "ordinary", nowMs: 1 });
      expect(getExpectation(db, id!)).toMatchObject({ judgmentClass: "reply", observable: "reply admitted", horizonHours: 24, check: "owner_reply" });
    } finally { db.close(); }
  });
  it("accepts prediction fields without requiring basisRefs and retains legacy strings", () => {
    expect(isValidGrowthClaim({ expectations: [{ statement: "A delivery will arrive", judgmentClass: "delivery", observable: "receipt", horizonHours: 1, check: "delivered" }] })).toBe(true);
    expect(isValidGrowthClaim({ expectations: ["An ordinary expectation"] })).toBe(true);
    expect(isValidGrowthClaim({ expectations: [{ statement: "x", horizonHours: 721 }] })).toBe(false);
    expect(isValidGrowthClaim({ expectations: [{ statement: "x", judgmentClass: "x".repeat(41) }] })).toBe(false);
    expect(isValidGrowthClaim({ expectations: [{ statement: "x", check: "other" }] })).toBe(false);
  });
});
