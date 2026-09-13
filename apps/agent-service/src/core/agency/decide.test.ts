import { describe, expect, it } from "vitest";
import { attachAuthorizedClaims, decide } from "./decide.js";
import type { Motivation } from "../types.js";

function motivation(
  kind: Motivation["kind"],
  score: number,
  summary: string,
): Motivation {
  return { id: score, kind, score, summary };
}

describe("nuclear agency decisions", () => {
  it("speaks by default when a user addresses Ashley", () => {
    const result = decide(
      [motivation("user_message", 100, "can you explain the retry loop?")],
      "reactive",
    );
    expect(result.kind).toBe("speak");
    expect(result.cognitiveAllocation.shouldSpeak).toBe(true);
    expect(result.authorizedClaims.readingRecordIds).toEqual([]);
  });

  it("honors a direct request for space", () => {
    const result = decide(
      [motivation("silence_signal", 100, "stop messaging me for now")],
      "reactive",
    );
    expect(result.kind).toBe("silence");
    expect(result.cognitiveAllocation.shouldSpeak).toBe(false);
  });

  it("speaks on an empty fluff ping with low effort", () => {
    const result = decide(
      [motivation("user_message", 32, "hey")],
      "reactive",
    );
    expect(result.kind).toBe("speak");
    expect(result.cognitiveAllocation.shouldSpeak).toBe(true);
    expect(result.cognitiveAllocation.effort).toBe("low");
    expect(result.urgency).toBe(0);
    expect(result.objective).toBe("acknowledge the greeting");
  });

  it("keeps ordinary substantive turns medium effort and non-urgent", () => {
    const result = decide(
      [motivation("user_message", 100, "can you explain the retry loop?")],
      "reactive",
    );
    expect(result.kind).toBe("speak");
    expect(result.cognitiveAllocation.effort).toBe("medium");
    expect(result.urgency).toBe(0);
    expect(result.objective).toBe("respond to the direct message");
  });

  it("does not raise urgency from high score alone", () => {
    const result = decide(
      [motivation("user_message", 100, "tell me about typescript generics")],
      "reactive",
    );
    expect(result.score).toBe(100);
    expect(result.urgency).toBe(0);
    expect(result.cognitiveAllocation.effort).not.toBe("high");
  });

  it("silences proactive turns below the material floor", () => {
    const result = decide(
      [motivation("take", 12, "a weak, stale take")],
      "proactive",
    );
    expect(result.kind).toBe("silence");
  });

  it("licenses reading only from a selected successful read record", () => {
    const base = decide(
      [
        {
          ...motivation("take", 80, "a feed take worth sharing"),
          refType: "take",
          refId: 1,
        },
        {
          ...motivation("take", 70, "another grounded take"),
          refType: "take",
          refId: 2,
        },
      ],
      "proactive",
    );
    expect(base.kind).toBe("share");
    const withClaims = attachAuthorizedClaims(base, [
      { id: 1, title: "One", evidenceKind: "read_record", readId: 101, provenance: "live" },
      { id: 2, title: "Two", evidenceKind: "scan_excerpt", readId: null, provenance: "live" },
      { id: 3, title: "Three", evidenceKind: "read_record", readId: 303, provenance: "live" },
    ]);
    expect(withClaims.authorizedClaims.readingRecordIds).toEqual([101]);
    expect(withClaims.authorizedClaims.readingTitles).toEqual([
      "One",
    ]);
  });
});
