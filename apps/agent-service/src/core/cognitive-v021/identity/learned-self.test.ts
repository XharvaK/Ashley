import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { buildLearnedSelfSlice, validateLearnedSelfEntry } from "./learned-self.js";

const dimensions = { source: "ashley_interpretation" as const, status: "interpreted" as const, time: "current" as const, reliability: "inferred" as const };

describe("v0.2.1 LearnedSelf Option B", () => {
  it("rejects world claims and has no candidate writer", () => {
    expect(() => validateLearnedSelfEntry({ memoryKind: "owner_world_claim", statement: "HY3 is an LLM" })).toThrow("learned_self_world_claim_forbidden");
    expect(validateLearnedSelfEntry({ memoryKind: "learned_self_evidence", statement: "I favor careful explanations." })).toBe(true);
  });

  it("reads only already-admitted learned-self evidence", () => {
    const db = openTestSidecar();
    try {
      upsertMemoryAssertion(db, { assertionKey: "self:live", statement: "I favor careful explanations.", memoryKind: "learned_self_evidence", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      upsertMemoryAssertion(db, { assertionKey: "self:old", statement: "Old self observation.", memoryKind: "learned_self_evidence", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: null, live: false });
      upsertMemoryAssertion(db, { assertionKey: "world:live", statement: "HY3 is an LLM.", memoryKind: "owner_world_claim", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      expect(buildLearnedSelfSlice(db)).toEqual({ dispositions: ["I favor careful explanations."], interests: [] });
    } finally {
      db.close();
    }
  });
});
