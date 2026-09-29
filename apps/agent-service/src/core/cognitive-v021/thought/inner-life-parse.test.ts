import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { makeSemanticSettlement } from "../test-support.js";

function parse(fields: Record<string, unknown>) {
  return parseThoughtSemanticOutput(makeSemanticSettlement({ speech: { mode: "none" }, commitments: {}, ...fields }), new Set());
}

describe("inner-life fields in a settlement", () => {
  it("accepts a journal entry and lived interests in Ashley's words", () => {
    expect(parse({ journal: { activity: "think", entry: "Turned over Alex's question about free will." } }).ok).toBe(true);
    expect(parse({ interests: [{ root: "Philosophy", branch: "compatibilism", note: "Alex's question stuck with me." }] }).ok).toBe(true);
    expect(parse({ interests: [{ root: "Electronic music", branch: "dub techno" }] }).ok).toBe(true);
  });

  it("rejects malformed journal entries and interests", () => {
    expect(parse({ journal: { activity: "dreamt", entry: "Not an activity." } }).ok).toBe(false);
    expect(parse({ journal: { activity: "rest" } }).ok).toBe(false);
    expect(parse({ journal: { activity: "rest", entry: "x".repeat(1001) } }).ok).toBe(false);
    expect(parse({ journal: { activity: "rest", entry: "ok", mood: "calm" } }).ok).toBe(false);
    expect(parse({ interests: [] }).ok).toBe(false);
    expect(parse({ interests: [{ root: "Knitting", branch: "cables" }] }).ok).toBe(false);
    expect(parse({ interests: [{ root: "Philosophy", branch: "" }] }).ok).toBe(false);
    expect(parse({ interests: Array.from({ length: 6 }, (_, index) => ({ root: "History", branch: `era ${index}` })) }).ok).toBe(false);
  });
});
