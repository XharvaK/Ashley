import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { makeSemanticSettlement } from "../test-support.js";

function parse(growth: unknown) {
  return parseThoughtSemanticOutput(makeSemanticSettlement({ speech: { mode: "none" }, commitments: {}, growth }), new Set());
}

describe("growth field in a settlement", () => {
  it("accepts an appraisal, expectations, checks, revisions, and positions in Ashley's words", () => {
    expect(parse({ appraisal: { note: "Doc's news made me glad.", valence: 0.4, energy: 0.2 } }).ok).toBe(true);
    expect(parse({ expectations: ["Doc will tell me how the interview went on Friday."] }).ok).toBe(true);
    expect(parse({ expectationChecks: [{ expectationId: "expectation:abc", outcome: "missed", lesson: "I overestimate his appetite for long takes." }] }).ok).toBe(true);
    expect(parse({ revisions: [{ layer: "opinion", topic: "dub techno at night", text: "Best at 3am.", rationale: "It keeps landing then.", evidenceRefs: ["episode:1", "self:a"] }] }).ok).toBe(true);
    expect(parse({ revisions: [{ layer: "taste", revisesEntryId: 4, text: "essays that argue", rationale: "what I reach for", evidenceRefs: ["journal:1"] }] }).ok).toBe(true);
    expect(parse({ revisionPositions: [{ revisionId: 3, position: "affirm", rationale: "This is who I am." }] }).ok).toBe(true);
  });

  it("rejects malformed growth claims", () => {
    expect(parse({}).ok).toBe(false);
    expect(parse({ appraisal: { valence: 0.2 } }).ok).toBe(false);
    expect(parse({ appraisal: { note: "too much", valence: 1.5 } }).ok).toBe(false);
    expect(parse({ appraisal: { note: "ok", joy: 0.5 } }).ok).toBe(false);
    expect(parse({ expectations: [] }).ok).toBe(false);
    expect(parse({ expectations: ["a", "b", "c", "d"] }).ok).toBe(false);
    expect(parse({ expectationChecks: [{ expectationId: "expectation:abc", outcome: "sort of", lesson: "x" }] }).ok).toBe(false);
    expect(parse({ revisions: [{ layer: "vision", topic: "x", text: "y", rationale: "z", evidenceRefs: ["a"] }] }).ok).toBe(false);
    expect(parse({ revisions: [{ layer: "opinion", topic: "x", text: "y", rationale: "z", evidenceRefs: [] }] }).ok).toBe(false);
    expect(parse({ revisions: [{ layer: "trait", text: "y", rationale: "z", evidenceRefs: ["a"], revisesEntryId: "4" }] }).ok).toBe(false);
    expect(parse({ revisionPositions: [{ revisionId: 3, position: "maybe", rationale: "x" }] }).ok).toBe(false);
    expect(parse({ mood: { valence: 1 } }).ok).toBe(false);
  });
});
