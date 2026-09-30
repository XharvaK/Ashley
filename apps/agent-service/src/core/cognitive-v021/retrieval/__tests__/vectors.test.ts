import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../../test-support.js";
import { upsertMemoryAssertion } from "../../memory/assertions.js";
import { openDerivedStore } from "../derived-store.js";
import { retrieveCandidates } from "../discover.js";
import { refreshMemoryVectors, type Embedder } from "../vectors.js";

/** A stand-in for the local model: words map onto concept dimensions. */
const CONCEPTS: Record<string, number> = {
  sister: 0, sibling: 0, brother: 0, family: 0,
  pasta: 1, cilantro: 1, food: 1, dinner: 1,
  lisbon: 2, travel: 2, flight: 2, moving: 2,
};
const fake: Embedder = {
  model: "fake-concepts",
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Float32Array(4);
      vector[3] = 0.05;
      for (const word of text.toLowerCase().split(/[^a-z]+/)) {
        const dim = CONCEPTS[word];
        if (dim !== undefined) vector[dim] += 1;
      }
      return vector;
    });
  },
};

function remember(db: DatabaseSync, key: string, statement: string, extra: Record<string, unknown> = {}): void {
  upsertMemoryAssertion(db, {
    assertionKey: key,
    statement,
    memoryKind: "owner_world_claim",
    dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
    dataClassification: "ordinary",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
    ...extra,
  } as never);
}

describe("A5 local vector recall", () => {
  it("finds a memory by meaning when the words differ, fenced by audience", async () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      remember(sidecar, "owner:sister", "Alex's sister Mara lives in Porto.");
      remember(sidecar, "owner:food", "Alex hates cilantro.");
      remember(sidecar, "said:bo", "Bo told me about his brother.", {
        memoryKind: "shared_episode",
        dimensions: { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" },
        audienceScope: { kind: "dm", principalId: "contact-bo" },
        sourcePrincipal: "contact-bo",
        protectionBasisRefs: ["row-bo"],
        protectionStatus: "admitted",
        licenseRefs: [],
      });
      derived.reconcileIfNeeded(sidecar);
      expect(await refreshMemoryVectors(derived, sidecar, fake, { nowMs: 1 })).toEqual({ embedded: 3, removed: 0 });

      const [queryVector] = await fake.embed(["how is my sibling doing"]);
      const recall = (conversationId: string, withVector: boolean) => retrieveCandidates(sidecar, {
        conversationId,
        request: { triggerTerms: ["sibling"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
      }, derived, withVector ? { queryVector: { model: fake.model, vector: queryVector! } } : {}).hits
        .filter((hit) => hit.assertionKey).map((hit) => `${hit.kind}:${hit.assertionKey}`);

      // Lexical alone cannot see it: "sibling" is not in the memory.
      expect(recall("owner-thread", false)).not.toContain("vector:owner:sister");
      expect(recall("owner-thread", true)).toContain("vector:owner:sister");
      expect(recall("owner-thread", true)).not.toContain("vector:owner:food");
      // A contact's DM sees only its own scoped memory, never the Owner's.
      expect(recall("dm:contact-bo", true)).toEqual(["vector:said:bo"]);
      expect(recall("dm:contact-other", true)).toEqual([]);
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("re-embeds a changed memory and drops one that is no longer live", async () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      remember(sidecar, "owner:a", "Alex is flying to Lisbon.");
      expect(await refreshMemoryVectors(derived, sidecar, fake, { nowMs: 1 })).toEqual({ embedded: 1, removed: 0 });
      expect(await refreshMemoryVectors(derived, sidecar, fake, { nowMs: 2 })).toEqual({ embedded: 0, removed: 0 });
      remember(sidecar, "owner:a", "Alex moved the Lisbon flight to May.");
      expect(await refreshMemoryVectors(derived, sidecar, fake, { nowMs: 3 })).toEqual({ embedded: 1, removed: 0 });
      sidecar.prepare("UPDATE sidecar_memory_assertions SET live = 0 WHERE assertion_key = 'owner:a'").run();
      expect(await refreshMemoryVectors(derived, sidecar, fake, { nowMs: 4 })).toEqual({ embedded: 0, removed: 1 });
    } finally {
      derived.close();
      sidecar.close();
    }
  });
});
