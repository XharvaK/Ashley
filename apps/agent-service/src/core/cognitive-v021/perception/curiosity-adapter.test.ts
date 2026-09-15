import { describe, expect, it } from "vitest";
import {
  nuclearTakeToObservationDraft,
  readRecordToObservationDraft,
} from "./adapter.js";

describe("curiosity evidence perception adapter", () => {
  it("projects a live read with bounded provenance and keeps shadow reads out", () => {
    const live = readRecordToObservationDraft({
      id: 7,
      itemId: 11,
      finalUrl: "https://public.test/article",
      contentHash: "a".repeat(64),
      retrievedAt: "2026-09-15T00:00:00.000Z",
      model: "deterministic-html-extractor-v1",
      modelMetadata: {},
      evidenceExcerpts: ["Untrusted source evidence."],
      cleanedChars: 128,
      title: "A source",
      interest: "systems",
      provenance: "live",
    });

    expect(live?.modality).toBe("page");
    expect(live?.payload).toMatchObject({
      inputTrust: "untrusted_evidence",
      provenance: {
        evidenceIdentity: `sha256:${"a".repeat(64)}`,
        completeness: "complete",
        citationRefs: ["curiosity:read:7"],
      },
    });
    expect(readRecordToObservationDraft({
      id: 8,
      itemId: 12,
      finalUrl: "https://public.test/shadow",
      contentHash: "b".repeat(64),
      retrievedAt: "2026-09-15T00:00:00.000Z",
      model: "deterministic-html-extractor-v1",
      modelMetadata: {},
      evidenceExcerpts: ["Shadow evidence."],
      cleanedChars: 64,
      title: "Shadow",
      interest: "systems",
      provenance: "shadow",
    })).toBeNull();
  });

  it("admits only live takes and preserves the non-authoritative class", () => {
    const take = nuclearTakeToObservationDraft({
      id: 21,
      itemId: 31,
      interest: "systems",
      take: "A bounded source-derived take.",
      createdAt: "2026-09-15T00:01:00.000Z",
      title: "Source title",
      url: "https://public.test/take",
      evidenceKind: "scan_excerpt",
      readId: null,
      provenance: "live",
      authorityClass: "NON_AUTHORITATIVE_BOOKKEEPING",
    });

    expect(take?.modality).toBe("subscription");
    expect(take?.payload).toMatchObject({
      take: "A bounded source-derived take.",
      authorityClass: "NON_AUTHORITATIVE_BOOKKEEPING",
      inputTrust: "untrusted_evidence",
      provenance: {
        citationRefs: ["curiosity:take:21"],
        completeness: "complete",
      },
    });
    expect(nuclearTakeToObservationDraft({
      ...({
        id: 22,
        itemId: 32,
        interest: "systems",
        take: "Shadow take.",
        createdAt: "2026-09-15T00:01:00.000Z",
        title: "Shadow title",
        url: "https://public.test/shadow-take",
        evidenceKind: "scan_excerpt",
        readId: null,
        provenance: "shadow",
        authorityClass: "NON_AUTHORITATIVE_BOOKKEEPING",
      }),
    })).toBeNull();
    expect(nuclearTakeToObservationDraft({
      ...({
        id: 23,
        itemId: 33,
        interest: "systems",
        take: "Read take with stale provenance.",
        createdAt: "2026-09-15T00:01:00.000Z",
        title: "Stale read",
        url: "https://public.test/stale",
        evidenceKind: "read_record",
        readId: 99,
        provenance: "live",
        readProvenance: "shadow",
        authorityClass: "NON_AUTHORITATIVE_DERIVED_CONTENT",
      }),
    })).toBeNull();
  });
});
