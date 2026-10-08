import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { makeSemanticSettlement } from "../test-support.js";

const refs = new Set(["turn-1", "observation-1"]);
const domusIds = new Set(["domus-obs-7", "domus-obs-8"]);
const UUID = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

function nomination(overrides: Record<string, unknown> = {}) {
  return {
    statement: "The owner prefers small tools.",
    memoryKind: "owner_preference",
    dimensions: {
      source: "owner_utterance",
      status: "asserted",
      time: "current",
      reliability: "owner_supplied",
    },
    dataClassification: "ordinary",
    sourceRefs: ["turn-1"],
    supersedesRef: null,
    concernRef: null,
    ...overrides,
  };
}

function settlementWith(durableNominations: unknown[]) {
  return { ...makeSemanticSettlement(), durableNominations };
}

function parse(durableNominations: unknown[]) {
  return parseThoughtSemanticOutput(settlementWith(durableNominations), refs, { domusObservationIds: domusIds });
}

describe("nomination sourceRefs: a bad reference costs only that reference", () => {
  it("drops one unknown sourceRef, keeps the nomination and the rest of the pass, answers on attempt 1", () => {
    const result = parse([nomination({ sourceRefs: ["turn-1", "not-shown-anywhere"] })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as { durableNominations: Array<{ sourceRefs: string[] }>; speech: unknown };
    expect(value.durableNominations).toHaveLength(1);
    expect(value.durableNominations[0]?.sourceRefs).toEqual(["turn-1"]);
    expect(value.speech).toEqual({ mode: "draft", mustSay: ["hello"], surfaceDraft: "hello" });
    expect(result.sourceRefNotes).toEqual([
      { path: "durableNominations[0].sourceRefs[1]", class: "other", action: "dropped" },
    ]);
  });

  it("keeps the other nominations of the pass when one nomination loses its only unknown ref", () => {
    const result = parse([
      nomination({ statement: "first", sourceRefs: ["turn-1"] }),
      nomination({ statement: "second", sourceRefs: ["unknown-ref"] }),
      nomination({ statement: "third", sourceRefs: ["observation-1"] }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as { durableNominations: Array<{ statement: string }> };
    expect(value.durableNominations.map((item) => item.statement)).toEqual(["first", "third"]);
    expect(result.sourceRefNotes).toEqual([
      { path: "durableNominations[1].sourceRefs[0]", class: "other", action: "dropped" },
      { path: "durableNominations[1]", class: "other", action: "nomination_dropped" },
    ]);
  });

  it("classes a UUID-shaped unknown ref as uuid without reporting its value", () => {
    const result = parse([nomination({ sourceRefs: [UUID] })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceRefNotes).toEqual([
      { path: "durableNominations[0].sourceRefs[0]", class: "uuid", action: "dropped" },
      { path: "durableNominations[0]", class: "uuid", action: "nomination_dropped" },
    ]);
    expect(JSON.stringify(result.sourceRefNotes)).not.toContain(UUID);
  });

  it("keeps a nomination whose refs were all removed when it still has a supportRef", () => {
    const result = parse([nomination({
      sourceRefs: ["unknown-ref"],
      supportRefs: [{ kind: "domus_observation", observationId: "domus-obs-8" }],
    })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as { durableNominations: Array<{ sourceRefs: string[] }> };
    expect(value.durableNominations).toHaveLength(1);
    expect(value.durableNominations[0]?.sourceRefs).toEqual([]);
    expect(result.sourceRefNotes?.map((note) => note.action)).toEqual(["dropped"]);
  });

  it("leaves a nomination that never had refs exactly as before", () => {
    const result = parse([nomination({ sourceRefs: [] })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceRefNotes).toBeUndefined();
  });
});

describe("nomination sourceRefs: a Domus observation she was shown moves to supportRefs", () => {
  it("moves a Domus observation id from sourceRefs to supportRefs as a domus_observation support", () => {
    const result = parse([nomination({ sourceRefs: ["domus-obs-7"] })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as {
      durableNominations: Array<{ sourceRefs: string[]; supportRefs: unknown[] }>;
    };
    expect(value.durableNominations[0]?.sourceRefs).toEqual([]);
    expect(value.durableNominations[0]?.supportRefs).toEqual([{ kind: "domus_observation", observationId: "domus-obs-7" }]);
    expect(result.sourceRefNotes).toEqual([
      { path: "durableNominations[0].sourceRefs[0]", class: "domus_observation", action: "moved" },
    ]);
  });

  it("appends to existing supportRefs and dedupes an id already supported", () => {
    const result = parse([nomination({
      sourceRefs: ["domus-obs-7", "domus-obs-8"],
      supportRefs: [{ kind: "domus_observation", observationId: "domus-obs-7" }],
    })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as { durableNominations: Array<{ sourceRefs: string[]; supportRefs: unknown[] }> };
    expect(value.durableNominations[0]?.sourceRefs).toEqual([]);
    expect(value.durableNominations[0]?.supportRefs).toEqual([
      { kind: "domus_observation", observationId: "domus-obs-7" },
      { kind: "domus_observation", observationId: "domus-obs-8" },
    ]);
    expect(result.sourceRefNotes?.map((note) => note.action)).toEqual(["moved", "moved"]);
  });

  it("drops a Domus-shaped id that this pass did not show her", () => {
    const result = parseThoughtSemanticOutput(
      settlementWith([nomination({ sourceRefs: ["domus-obs-99"] })]),
      refs,
      { domusObservationIds: domusIds },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceRefNotes?.[0]).toEqual({ path: "durableNominations[0].sourceRefs[0]", class: "other", action: "dropped" });
  });

  it("drops a Domus id when the pass supplied no Domus ids", () => {
    const result = parseThoughtSemanticOutput(settlementWith([nomination({ sourceRefs: ["domus-obs-7"] })]), refs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceRefNotes?.[0]?.action).toBe("dropped");
  });

  it("keeps an allowlisted ref in sourceRefs untouched", () => {
    const result = parse([nomination({ sourceRefs: ["turn-1", "domus-obs-7"] })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as unknown as { durableNominations: Array<{ sourceRefs: string[] }> };
    expect(value.durableNominations[0]?.sourceRefs).toEqual(["turn-1"]);
    expect(result.sourceRefNotes?.map((note) => note.class)).toEqual(["domus_observation"]);
  });
});

describe("nomination sourceRefs: other faults still reject", () => {
  it("still rejects sourceRefs that is not an array", () => {
    const result = parse([nomination({ sourceRefs: "turn-1" })]);
    expect(result.ok).toBe(false);
  });

  it("still rejects a bad memoryKind even when a ref was removed", () => {
    const result = parse([nomination({ memoryKind: "self_reflection", sourceRefs: ["unknown-ref"] })]);
    expect(result.ok).toBe(false);
  });

  it("diagnostic notes carry only indices, class and action", () => {
    const result = parse([nomination({ sourceRefs: ["domus-obs-7", "secret-looking-value"] })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const note of result.sourceRefNotes ?? []) {
      expect(Object.keys(note).sort()).toEqual(["action", "class", "path"]);
    }
    const text = JSON.stringify(result.sourceRefNotes);
    expect(text).not.toContain("domus-obs-7");
    expect(text).not.toContain("secret-looking-value");
  });
});
