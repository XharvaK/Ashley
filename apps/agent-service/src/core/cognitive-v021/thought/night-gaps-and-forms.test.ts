import { describe, expect, it } from "vitest";
import { isValidNightClaim } from "../growth/claim.js";
import { createThoughtStructuralFeedback, expectedFormFor, formatThoughtStructuralFeedback } from "./structural-feedback.js";

describe("night.gaps is accepted as the contract offers it (P7b)", () => {
  it("accepts weekly gaps and still rejects a malformed one", () => {
    const gaps = {
      dimensions: [{ id: "craft", score: 3, note: "an invented note", supportRefs: ["mem-1"] }],
      choose: "craft",
      edits: [{ op: "add", id: "patience", name: "Patience", question: "Do I wait well?", reason: "an invented reason" }],
    };
    expect(isValidNightClaim({ diary: "an invented day", gaps })).toBe(true);
    expect(isValidNightClaim({ gaps: { choose: "craft" } })).toBe(true);
    expect(isValidNightClaim({ gaps: {} })).toBe(false);
    expect(isValidNightClaim({ gaps: { dimensions: [{ id: "craft", score: 9, note: "n", supportRefs: ["m"] }] } })).toBe(false);
    expect(isValidNightClaim({ gaps: { edits: [{ op: "merge", reason: "r" }] } })).toBe(false);
    expect(isValidNightClaim({ gaps: { mood: 1 } })).toBe(false);
  });
});

describe("a wrong_type retry is shown the contract's own form for the field", () => {
  it("gives the schema of a small field, and the allowed keys of a large one", () => {
    expect(JSON.parse(expectedFormFor("domusSnapshot")!)).toMatchObject({ type: "object", required: ["caption"], additionalProperties: false });
    expect(JSON.parse(expectedFormFor("domusAct")!)).toMatchObject({ type: "object", required: ["option"], onlyTheseKeys: ["option", "then", "forOwner", "answer"] });
    expect(JSON.parse(expectedFormFor("durableNominations[0].sourceRefs")!)).toEqual({ type: "array", items: { type: "string" } });
    expect(JSON.parse(expectedFormFor("growth")!)).toMatchObject({ type: "object", onlyTheseKeys: expect.arrayContaining(["appraisal", "expectations"]) });
    expect(JSON.parse(expectedFormFor("night")!).onlyTheseKeys).toContain("gaps");
    expect(expectedFormFor("nothingLikeThis")).toBeNull();
    expect(expectedFormFor(undefined)).toBeNull();
  });

  it("puts the form in the feedback for wrong_type only", () => {
    const wrong = formatThoughtStructuralFeedback(createThoughtStructuralFeedback({ code: "wrong_type", field: "domusAct" }));
    expect(wrong).toContain("Expected form of domusAct (JSON Schema):");
    const other = formatThoughtStructuralFeedback(createThoughtStructuralFeedback({ code: "invalid_enum", field: "domusAct" }));
    expect(other).not.toContain("Expected form");
  });
});
