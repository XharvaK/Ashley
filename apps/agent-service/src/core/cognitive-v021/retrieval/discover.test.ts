import { describe, expect, it } from "vitest";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { openTestSidecar } from "../test-support.js";
import { retrieveCandidates, tokenizeForDiscovery } from "./discover.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { appendMemorySupport } from "../memory/supports.js";
import { openDerivedStore } from "./derived-store.js";

describe("v0.2.1 lexical discovery fallback", () => {
  it("keeps short trigger terms used by continuity corrections", () => {
    expect(tokenizeForDiscovery("Have you heard about HY3?")).toContain("hy3");
    expect(tokenizeForDiscovery("it's an LLM")).toContain("llm");
    expect(tokenizeForDiscovery("Qwen")).toContain("qwen");
  });

  it("searches the conversation log when assertion keys miss", () => {
    const db = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      appendOwnerUtterance(db, { conversationId: "thread-1", text: "I meant HY3", discordMessageIds: ["d1"], nowMs: 1 });
      derived.reconcile(db);
      const result = retrieveCandidates(
        db,
        {
          conversationId: "thread-1",
          request: {
            triggerTerms: ["meant", "hy3"],
            workingContextTopics: [],
            assertionKeys: ["hy4"],
            includeLogSearch: true,
          },
        },
        derived,
      );
      expect(result.request.includeLogSearch).toBe(true);
      expect(result.hits.some((hit) => hit.kind === "lexical" || hit.kind === "log")).toBe(true);
      expect(result.hits.every((hit) => ["conversation_log", "live_memory", "quarantined_memory"].includes(hit.sourceStore))).toBe(true);
    } finally {
      derived.close();
      db.close();
    }
  });

  it("discovers live and quarantined Memory from current trigger terms", () => {
    const db = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      const dimensions = { source: "owner_utterance" as const, status: "asserted" as const, time: "current" as const, reliability: "owner_supplied" as const };
      upsertMemoryAssertion(db, { assertionKey: "live:hy3", statement: "The owner said HY3 is useful.", memoryKind: "owner_world_claim", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      upsertMemoryAssertion(db, { assertionKey: "old:qwen", statement: "Qwen was mentioned in an imported record.", memoryKind: "owner_world_claim", dimensions, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: null, live: false });
      appendMemorySupport(db, { supportId: "support:old-qwen", assertionKey: "old:qwen", source: "owner_utterance", provenance: "legacy_import", sourceArchitectureEpoch: "legacy", sourceRef: "legacy-1", settlementId: null, evidenceLineageId: null, observationId: null, receiptId: null, dimensions, dataClassification: "never_public", createdAtMs: 1 });
      derived.reconcile(db);
      const relevant = retrieveCandidates(
        db,
        { conversationId: "thread-1", request: { triggerTerms: ["qwen"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true } },
        derived,
      );
      expect(relevant.hits).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceStore: "quarantined_memory", assertionKey: "old:qwen", dimensions, supportRefs: ["legacy-1"] }),
      ]));
      expect(relevant.hits.some((hit) => hit.assertionKey === "live:hy3")).toBe(false);
      const unrelated = retrieveCandidates(
        db,
        { conversationId: "thread-1", request: { triggerTerms: ["unrelated"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true } },
        derived,
      );
      expect(unrelated.hits).toEqual([]);
    } finally {
      derived.close();
      db.close();
    }
  });
});
