// Credential-shaped Thought text never enters growth records.
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { recordExpectations, checkExpectations, getExpectation } from "./expectations.js";
const credential = `ghp_${"a".repeat(36)}`;
describe("graduation authored text privacy", () => {
  it.each(["statement", "judgmentClass", "observable"])("refuses credential-shaped %s", field => {
    const db = openTestSidecar();
    try {
      const ids = recordExpectations(db, { cycleId: "private", statements: [{ statement: "A bounded expectation", [field]: credential }], dataClassification: "ordinary", nowMs: 1 });
      expect(ids).toEqual([]);
      expect(db.prepare("SELECT count(*) AS n FROM expectations").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });
  it("refuses a credential-shaped lesson without closing the expectation", () => {
    const db = openTestSidecar();
    try {
      const [id] = recordExpectations(db, { cycleId: "first", statements: ["A prediction"], dataClassification: "ordinary", nowMs: 1 });
      expect(checkExpectations(db, { cycleId: "later", checks: [{ expectationId: id!, outcome: "met", lesson: credential }], nowMs: 2 })).toEqual([]);
      expect(getExpectation(db, id!)?.status).toBe("open");
    } finally { db.close(); }
  });
});
