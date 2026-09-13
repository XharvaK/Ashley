import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { getMemoryAssertion, listMemoryAssertions, upsertMemoryAssertion } from "./assertions.js";

const dimensions = {
  source: "owner_utterance" as const,
  status: "asserted" as const,
  time: "current" as const,
  reliability: "owner_supplied" as const,
};

describe("v0.2.1 sidecar Memory assertions", () => {
  it("keeps native assertions live only with a real admission generation", () => {
    const db = openTestSidecar();
    try {
      const assertion = upsertMemoryAssertion(db, {
        assertionKey: "owner:preference",
        statement: "The owner prefers small tools.",
        memoryKind: "owner_preference",
        dimensions,
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 4,
        live: true,
      });
      expect(assertion).toMatchObject({ live: true, admittedGeneration: 4 });
      expect(getMemoryAssertion(db, "owner:preference")).toEqual(assertion);
      expect(listMemoryAssertions(db, { live: false })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects secret assertions and never downgrades a stronger classification", () => {
    const db = openTestSidecar();
    try {
      expect(() => upsertMemoryAssertion(db, {
        assertionKey: "secret:key",
        statement: "sk-test-secret",
        memoryKind: "owner_world_claim",
        dimensions,
        dataClassification: "secret",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      })).toThrow("secret_memory_assertion_forbidden");
      upsertMemoryAssertion(db, {
        assertionKey: "owner:classification",
        statement: "Sensitive statement",
        memoryKind: "owner_world_claim",
        dimensions,
        dataClassification: "sensitive",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      const retained = upsertMemoryAssertion(db, {
        assertionKey: "owner:classification",
        statement: "Same statement, weaker requested class",
        memoryKind: "owner_world_claim",
        dimensions,
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 2,
        live: true,
      });
      expect(retained.dataClassification).toBe("sensitive");
    } finally {
      db.close();
    }
  });
});
