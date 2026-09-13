import { describe, it, expect } from "vitest";
import type { EpistemicDimensions, RetrievalHit } from "../../types.js";
import { deduplicateCandidates } from "../dedup.js";

function makeHit(partial: Partial<RetrievalHit> & { ref: string }): RetrievalHit {
  return {
    kind: "lexical",
    sourceStore: "live_memory",
    snippet: "Sample statement",
    score: 0,
    assertionKey: partial.ref,
    memoryKind: "owner_world_claim",
    dimensions: {
      source: "owner_utterance",
      status: "asserted",
      time: "current",
      reliability: "owner_supplied",
    },
    dataClassification: "ordinary",
    live: true,
    supportRefs: [],
    ...partial,
  };
}

describe("Safe Narrow Deduplication", () => {
  it("removes exact same assertion ref", () => {
    const h1 = makeHit({ ref: "mem:1", snippet: "Text" });
    const h2 = makeHit({ ref: "mem:1", snippet: "Text" });

    const result = deduplicateCandidates([h1, h2]);
    expect(result.survivors.length).toBe(1);
    expect(result.omitted).toEqual([{ ref: "mem:1", reason: "duplicate:exact_ref" }]);
  });

  it("excludes conversation-log row identity already present in rawConversation", () => {
    const logHit = makeHit({
      ref: "row-123",
      sourceStore: "conversation_log",
      kind: "log",
      snippet: "Recent message",
    });

    const result = deduplicateCandidates([logHit], {
      rawConversationRowIds: new Set(["row-123", "row-456"]),
    });

    expect(result.survivors.length).toBe(0);
    expect(result.omitted).toEqual([{ ref: "row-123", reason: "duplicate:raw_row_identity" }]);
  });

  it("deduplicates identical statement when epistemic dimensions and memoryKind are identical", () => {
    const h1 = makeHit({ ref: "mem:alpha", snippet: "I love cats" });
    const h2 = makeHit({ ref: "mem:beta", snippet: "I love cats" });

    const result = deduplicateCandidates([h1, h2]);
    expect(result.survivors.length).toBe(1);
    expect(result.survivors[0].ref).toBe("mem:alpha");
    expect(result.omitted).toEqual([
      { ref: "mem:beta", reason: "duplicate:content_hash_identical_metadata" },
    ]);
  });

  it("preserves contradictions and corrections when dimensions or memoryKind differ", () => {
    const asserted: EpistemicDimensions = {
      source: "owner_utterance",
      status: "asserted",
      time: "current",
      reliability: "owner_supplied",
    };
    const contradicted: EpistemicDimensions = {
      source: "owner_utterance",
      status: "contradicted",
      time: "historical",
      reliability: "owner_supplied",
    };

    const h1 = makeHit({ ref: "mem:asserted", snippet: "I love coffee", dimensions: asserted });
    const h2 = makeHit({ ref: "mem:contradicted", snippet: "I love coffee", dimensions: contradicted });

    const result = deduplicateCandidates([h1, h2]);
    expect(result.survivors.length).toBe(2);
    expect(result.omitted.length).toBe(0);
  });
});
