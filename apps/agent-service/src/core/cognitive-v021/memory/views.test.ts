import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { upsertMemoryAssertion } from "./assertions.js";
import { buildOwnerKnowledgeView, buildRelationalConstraintView } from "./views.js";

const dimensions = { source: "owner_utterance" as const, status: "asserted" as const, time: "current" as const, reliability: "owner_supplied" as const };

describe("v0.2.1 deterministic Memory views", () => {
  it("exposes only live owner knowledge and excludes quarantine", () => {
    const db = openTestSidecar();
    try {
      upsertMemoryAssertion(db, { assertionKey: "live:owner", statement: "The owner likes careful systems.", memoryKind: "owner_self_description", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      upsertMemoryAssertion(db, { assertionKey: "quarantine:owner", statement: "Old imported statement.", memoryKind: "owner_world_claim", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: null, live: false });
      upsertMemoryAssertion(db, { assertionKey: "live:episode", statement: "Shared episode.", memoryKind: "shared_episode", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      expect(buildOwnerKnowledgeView(db)).toEqual([expect.objectContaining({ assertionKey: "live:owner" })]);
      expect(buildOwnerKnowledgeView(db).some((row) => row.assertionKey.startsWith("quarantine"))).toBe(false);
    } finally {
      db.close();
    }
  });

  it("returns relational boundaries as structured authority input, not narrator prose", () => {
    const db = openTestSidecar();
    try {
      upsertMemoryAssertion(db, { assertionKey: "boundary:one", statement: "Never mention the private project.", memoryKind: "relational_boundary", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      const view = buildRelationalConstraintView(db);
      expect(view.assertions).toHaveLength(1);
      expect(view.neverMention).toContain("Never mention the private project.");
      expect(view).not.toHaveProperty("narrator");
    } finally {
      db.close();
    }
  });
});
