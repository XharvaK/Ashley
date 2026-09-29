import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { makeSemanticSettlement } from "../test-support.js";

function parse(reflection: unknown) {
  return parseThoughtSemanticOutput(makeSemanticSettlement({ speech: { mode: "none" }, commitments: {}, reflection }), new Set());
}

describe("afterglow reflection in a settlement", () => {
  it("accepts an episode and a thread story in Ashley's words", () => {
    expect(parse({
      episode: { summary: "We planned Kyoto.", salience: 0.7, tone: "warm", unresolvedThreads: ["which month"], takeaway: "Travel lights him up." },
      threadStory: "Alex and I are planning a spring trip.",
    }).ok).toBe(true);
    expect(parse({ threadStory: "Only the story changed." }).ok).toBe(true);
  });

  it("rejects malformed reflections", () => {
    expect(parse({}).ok).toBe(false);
    expect(parse({ episode: { summary: "No salience." } }).ok).toBe(false);
    expect(parse({ episode: { summary: "Too sure.", salience: 1.5 } }).ok).toBe(false);
    expect(parse({ episode: { summary: "x", salience: 0.5, mood: "extra" } }).ok).toBe(false);
    expect(parse({ episode: { summary: "x", salience: 0.5, unresolvedThreads: [] } }).ok).toBe(false);
    expect(parse({ threadStory: "x".repeat(6001) }).ok).toBe(false);
    expect(parse({ diary: "not a reflection field" }).ok).toBe(false);
  });
});
