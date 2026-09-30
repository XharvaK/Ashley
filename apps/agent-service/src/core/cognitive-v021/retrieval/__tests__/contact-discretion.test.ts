import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { upsertMemoryAssertion } from "../../memory/assertions.js";
import { openDerivedStore } from "../derived-store.js";
import { retrieveCandidates } from "../discover.js";

describe("A3 discretion between contacts", () => {
  it("shows what contact A told her in A's DM and to the Owner, never in contact B's DM", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      upsertMemoryAssertion(sidecar, {
        assertionKey: "said:mara-lisbon",
        statement: "Mara told me she is moving to Lisbon next spring.",
        memoryKind: "shared_episode",
        dimensions: { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" },
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
        audienceScope: { kind: "dm", principalId: "contact-mara" },
        sourcePrincipal: "contact-mara",
        protectionBasisRefs: ["row-mara-1"],
        protectionStatus: "admitted",
        licenseRefs: [],
      });
      derived.reconcileIfNeeded(sidecar);
      const hits = (conversationId: string) => {
        const result = retrieveCandidates(sidecar, {
          conversationId,
          request: { triggerTerms: ["Lisbon"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        }, derived);
        return result.hits.filter((hit) => hit.assertionKey === "said:mara-lisbon").length;
      };
      expect(hits("dm:contact-mara")).toBeGreaterThan(0);
      expect(hits("owner-thread")).toBeGreaterThan(0);
      expect(hits("dm:contact-bo")).toBe(0);
    } finally {
      derived.close();
      sidecar.close();
    }
  });
});
