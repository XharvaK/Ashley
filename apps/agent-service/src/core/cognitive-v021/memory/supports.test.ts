import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { appendMemorySupport, listMemorySupports } from "./supports.js";

describe("v0.2.1 Memory support lineage", () => {
  it("accumulates support rows without overwriting epistemic provenance", () => {
    const db = openTestSidecar();
    try {
      const base = {
        assertionKey: "owner:model",
        source: "owner_utterance" as const,
        provenance: "native" as const,
        sourceArchitectureEpoch: "v0.2.1" as const,
        sourceRef: "evidence-1",
        settlementId: "settlement-1",
        evidenceLineageId: "lineage-1",
        observationId: null,
        receiptId: null,
        dimensions: { source: "owner_utterance" as const, status: "asserted" as const, time: "current" as const, reliability: "owner_supplied" as const },
        dataClassification: "never_public" as const,
      };
      appendMemorySupport(db, { ...base, supportId: "support-1", createdAtMs: 1 });
      appendMemorySupport(db, { ...base, supportId: "support-2", source: "tool", sourceRef: "observation-1", observationId: "observation-1", dimensions: { ...base.dimensions, source: "tool", reliability: "fallible_observation" }, createdAtMs: 2 });
      expect(listMemorySupports(db, "owner:model")).toHaveLength(2);
      expect(listMemorySupports(db, "owner:model")[1]).toMatchObject({ source: "tool", observationId: "observation-1" });
    } finally {
      db.close();
    }
  });
});
