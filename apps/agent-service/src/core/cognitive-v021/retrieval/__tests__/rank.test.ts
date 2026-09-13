import { describe, it, expect } from "vitest";
import type { RetrievalHit } from "../../types.js";
import { compareTieredCandidates, rankCandidates, type TieredCandidate } from "../rank.js";

function makeHit(partial: Partial<RetrievalHit> & { ref: string }): RetrievalHit {
  return {
    kind: "lexical",
    sourceStore: "live_memory",
    snippet: "Sample snippet text",
    score: 0,
    assertionKey: partial.ref,
    memoryKind: "owner_world_claim",
    dimensions: null,
    dataClassification: "ordinary",
    live: true,
    supportRefs: [],
    ...partial,
  };
}

describe("Deterministic Tiered Ranking", () => {
  it("strictly enforces tier 1 > tier 2 > tier 3 > tier 4", () => {
    const tier1 = makeHit({ ref: "mem:tier1", kind: "key", score: 0 });
    const tier2 = makeHit({ ref: "mem:tier2", kind: "lexical", score: -5 });
    const tier3 = makeHit({ ref: "mem:tier3", kind: "lexical", score: -10 });
    const tier4 = makeHit({ ref: "log:tier4", kind: "log", sourceStore: "conversation_log", score: -20 });

    const ranked = rankCandidates({
      exactKeyHits: [tier1],
      rawTriggerFtsHits: [tier2],
      concernFtsHits: [tier3],
      logHits: [tier4],
    });

    expect(ranked.map((h) => h.ref)).toEqual([
      "mem:tier1",
      "mem:tier2",
      "mem:tier3",
      "log:tier4",
    ]);
  });

  it("breaks ties by BM25 rank (more negative first), then ref ASC", () => {
    const candidateA: TieredCandidate = {
      ...makeHit({ ref: "mem:beta", score: -2.5 }),
      tier: 2,
    };
    const candidateB: TieredCandidate = {
      ...makeHit({ ref: "mem:alpha", score: -2.5 }),
      tier: 2,
    };
    const candidateC: TieredCandidate = {
      ...makeHit({ ref: "mem:best", score: -5.0 }),
      tier: 2,
    };

    const sorted = [candidateA, candidateB, candidateC].sort(compareTieredCandidates);
    expect(sorted.map((c) => c.ref)).toEqual(["mem:best", "mem:alpha", "mem:beta"]);
  });

  it("ensures exact-key hits survive defense fuse", () => {
    const exactKeys = Array.from({ length: 10 }, (_, i) =>
      makeHit({ ref: `exact:${i}`, kind: "key", score: -100 }),
    );
    const lexicalHits = Array.from({ length: 100 }, (_, i) =>
      makeHit({ ref: `lex:${i}`, kind: "lexical", score: -1.0 }),
    );

    const ranked = rankCandidates({
      exactKeyHits: exactKeys,
      rawTriggerFtsHits: lexicalHits,
      concernFtsHits: [],
      logHits: [],
      defenseFuse: {
        maxCandidates: 15,
        maxUtf8Bytes: 50_000,
      },
    });

    // All 10 exact keys present
    for (let i = 0; i < 10; i++) {
      expect(ranked.some((h) => h.ref === `exact:${i}`)).toBe(true);
    }
    expect(ranked.length).toBe(15);
  });
});
