import { describe, expect, it } from "vitest";
import { makeSemanticSettlement } from "../test-support.js";
import { parseThoughtSemanticOutput } from "./parse.js";

const allowlist = new Set<string>();

function homeOp(index: number) {
  return { op: "append", path: `notes/entry-${index}.md`, content: `line ${index}\n` };
}

describe("A5-12 an over-long optional list is cut, and an empty one is absent; the speech is kept", () => {
  it("cuts nine home ops to the limit and keeps the settlement", () => {
    const raw = JSON.stringify({ ...makeSemanticSettlement(), home: Array.from({ length: 9 }, (_, index) => homeOp(index)) });
    const parsed = parseThoughtSemanticOutput(raw, allowlist);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect((parsed.value as { home?: unknown[] }).home).toHaveLength(8);
    expect(parsed.hostNotes).toEqual(["home_capped"]);
  });

  it("treats an empty webPlaces list as absent rather than a failure", () => {
    const raw = JSON.stringify({ ...makeSemanticSettlement(), webPlaces: [] });
    const parsed = parseThoughtSemanticOutput(raw, allowlist);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("webPlaces" in (parsed.value as object)).toBe(false);
  });
});
