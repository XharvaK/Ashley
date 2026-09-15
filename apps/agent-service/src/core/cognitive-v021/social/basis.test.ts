import { describe, expect, it } from "vitest";
import { hashAttemptBasis } from "./basis.js";
import type { AttemptInputBasis } from "./types.js";

function makeBasis(
  overrides: Partial<AttemptInputBasis> = {},
): AttemptInputBasis {
  return {
    schemaVersion: 1,
    orderedRefs: ["row-a", "row-b"],
    versions: { "row-a": 1, "row-b": 2 },
    speakerAttributionHash: "speaker:v1",
    replyEdges: [["row-b", "row-a"]],
    attachmentCoverage: {
      "row-a": "complete",
      "row-b": "failed",
    },
    projectionVersion: "projection:v1",
    ...overrides,
  };
}

describe("hashAttemptBasis", () => {
  it("is stable for the same exact ordered basis", () => {
    expect(hashAttemptBasis(makeBasis())).toBe(hashAttemptBasis(makeBasis()));
  });

  it("preserves conversational order", () => {
    const first = makeBasis();
    const swapped = makeBasis({ orderedRefs: ["row-b", "row-a"] });

    expect(hashAttemptBasis(first)).not.toBe(hashAttemptBasis(swapped));
  });

  it("changes when relevant speaker identity material changes", () => {
    expect(hashAttemptBasis(makeBasis())).not.toBe(
      hashAttemptBasis(makeBasis({ speakerAttributionHash: "speaker:v2" })),
    );
  });

  it("rejects an empty ordered basis", () => {
    expect(() => hashAttemptBasis(makeBasis({ orderedRefs: [] }))).toThrow(
      /orderedRefs/i,
    );
  });
});
