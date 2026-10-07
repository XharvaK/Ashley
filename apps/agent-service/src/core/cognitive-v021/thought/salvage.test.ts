import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { salvageSettlement } from "./salvage.js";
import { makeSemanticSettlement } from "../test-support.js";

const SECRET = "SECRETWORD";
const allow = new Set(["ref-a"]);

function reparse(text: string) {
  return parseThoughtSemanticOutput(text, allow);
}

function nomination(statement: string, patch: Record<string, unknown> = {}) {
  return {
    statement,
    memoryKind: "owner_preference",
    dimensions: {
      source: "owner_utterance",
      status: "asserted",
      time: "historical",
      reliability: "owner_supplied",
    },
    dataClassification: "ordinary",
    sourceRefs: [] as string[],
    supersedesRef: null,
    concernRef: null,
    ...patch,
  };
}

function settlement(overrides: Record<string, unknown> = {}) {
  return makeSemanticSettlement({ speech: { mode: "none" }, ...overrides });
}

function salvage(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const first = reparse(text);
  if (first.ok) throw new Error(`fixture parsed: ${text.slice(0, 200)}`);
  return salvageSettlement(text, first, reparse);
}

describe("salvageSettlement", () => {
  const good = nomination("kept fact");
  const bad = nomination(SECRET, { memoryKind: "not-a-kind" });

  const droppable: [string, unknown][] = [
    ["journal", { activity: "nope", entry: SECRET }],
    ["reflection", { episode: { summary: SECRET } }],
    ["webPlaces", [{ origin: SECRET }]],
    ["growth", { mood: SECRET }],
    ["interests", [{ root: SECRET, branch: SECRET }]],
    ["learned", [{ lesson: SECRET }]],
    ["pursuits", [{ name: SECRET }]],
    ["nextOwnTime", { when: SECRET }],
    ["attention", { wakeWorth: SECRET }],
    ["senses", { decline: [{ sense: SECRET, rationale: SECRET }] }],
    ["home", [{ op: SECRET }]],
    ["intents", [{ place: SECRET }]],
    ["domusAct", { option: "bad ref" }],
  ];
  it.each(droppable)("removes only a faulty %s", (key, value) => {
    const result = salvage(settlement({ [key]: value, durableNominations: [good] }));
    expect(result).toMatchObject({ ok: true, dropped: [key] });
    if (!result.ok) return;
    const parsed = JSON.parse(result.text) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty(key);
    expect(parsed.durableNominations).toEqual([good]);
    expect(result.dropped.join(",")).not.toContain(SECRET);
  });

  it("removes one bad nomination entry and keeps the key when none remain", () => {
    const one = salvage(settlement({ durableNominations: [bad] }));
    expect(one).toMatchObject({ ok: true, dropped: ["durableNominations[0]"] });
    if (one.ok) expect(JSON.parse(one.text).durableNominations).toEqual([]);

    const kept = salvage(settlement({ durableNominations: [good, bad] }));
    expect(kept).toMatchObject({ ok: true, dropped: ["durableNominations[1]"] });
    if (kept.ok) expect(JSON.parse(kept.text).durableNominations).toEqual([good]);
  });

  it("removes a second fault after the first removal, including a shifted index", () => {
    const shifted = salvage(settlement({
      durableNominations: [bad, nomination(SECRET, { sourceRefs: [SECRET] }), good],
    }));
    expect(shifted).toMatchObject({
      ok: true,
      dropped: ["durableNominations[0]", "durableNominations[0]"],
    });
    if (shifted.ok) expect(JSON.parse(shifted.text).durableNominations).toEqual([good]);

    const both = salvage(settlement({
      durableNominations: [good, bad],
      journal: { activity: "nope", entry: SECRET },
    }));
    expect(both).toMatchObject({ ok: true, dropped: ["durableNominations[1]", "journal"] });
    if (!both.ok) return;
    const parsed = JSON.parse(both.text) as Record<string, unknown>;
    expect(parsed.durableNominations).toEqual([good]);
    expect(parsed).not.toHaveProperty("journal");
    expect(both.dropped.join(",")).not.toContain(SECRET);
  });

  it("removes a top-level unknown field and stops at six removals", () => {
    const unknown = salvage({ ...settlement(), then: SECRET });
    expect(unknown).toMatchObject({ ok: true, dropped: ["then"] });
    if (unknown.ok) {
      expect(JSON.parse(unknown.text)).not.toHaveProperty("then");
      expect(unknown.dropped.join(",")).not.toContain(SECRET);
    }

    const six = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`extra${index}`, SECRET]));
    const withinCap = salvage({ ...settlement(), ...six });
    expect(withinCap.ok).toBe(true);
    if (withinCap.ok) expect(withinCap.dropped).toHaveLength(6);

    const seven = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`extra${index}`, SECRET]));
    expect(salvage({ ...settlement(), ...seven })).toEqual({ ok: false });
    expect(salvage(settlement({
      durableNominations: Array.from({ length: 7 }, () => bad),
    }))).toEqual({ ok: false });
  });

  it("does not salvage a reply whose only fault is speech", () => {
    expect(salvage(settlement({ speech: { mode: "draft", surfaceDraft: "" } }))).toEqual({ ok: false });
    expect(salvage(settlement({ speech: { mode: "none", hostDefault: true } }))).toEqual({ ok: false });
    expect(salvage(settlement({ speech: SECRET }))).toEqual({ ok: false });
  });

  it.each([
    ["text that is not a JSON object", "{"],
    ["a JSON array", "[]"],
    ["a JSON string", JSON.stringify(SECRET)],
    ["a non-settlement", { kind: "abstain", reason: "nope", explanation: SECRET, evidenceRefs: [] }],
    ["an observation reply", {
      kind: "observation_intent",
      operationKind: "web.search",
      request: { query: SECRET },
      purpose: SECRET,
      evidenceNeed: SECRET,
      existingRefs: [SECRET],
    }],
    ["interactionIntent", settlement({ interactionIntent: SECRET })],
    ["initiativePreference", settlement({
      interactionIntent: "initiate",
      speech: { mode: "draft", surfaceDraft: "kept line", mustSay: ["kept line"] },
      initiativePreference: { stance: SECRET, reason: SECRET },
    })],
    ["interpretation", { ...settlement(), interpretation: { discourseActs: ["not-an-act"] } }],
    ["commitments", settlement({
      commitments: { stance: { warmth: SECRET, humorAllowed: false, disagreement: false, uncertaintyDisplay: true } },
    })],
    ["workingContextDeltas", { ...settlement(), workingContextDeltas: [] }],
    ["deskDeltas", { ...settlement(), deskDeltas: [] }],
    ["concernDeltas", { ...settlement(), concernDeltas: [] }],
    ["occupancyDeltas", { ...settlement(), occupancyDeltas: [] }],
    ["futureTriggerDeltas", { ...settlement(), futureTriggerDeltas: [] }],
    ["subscriptionDeltas", { ...settlement(), subscriptionDeltas: [] }],
    ["placeRules", settlement({ placeRules: SECRET })],
    ["contactStop", settlement({ contactStop: SECRET })],
    ["forget", settlement({ forget: SECRET })],
    ["night", settlement({ night: SECRET })],
    ["evidenceUse", settlement({ evidenceUse: { sourceRefsUsed: [SECRET] } })],
    ["durableNominations as a whole", settlement({ durableNominations: SECRET })],
    ["an epistemic fault", settlement({
      commitments: {
        epistemic: [{
          statement: SECRET,
          dimensions: { source: SECRET, status: "asserted", time: "historical", reliability: "owner_supplied" },
        }],
      },
    })],
    ["a reference that is not allowlisted", settlement({
      commitments: {
        epistemic: [{
          statement: SECRET,
          observationRefs: [SECRET],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        }],
      },
    })],
    ["an alias collision", settlement({
      durableNominations: [nomination(SECRET, { concernRef: { kind: "local", alias: "ref-a" } })],
    })],
  ])("does not salvage %s", (_label, value) => {
    const result = salvage(value);
    expect(result).toEqual({ ok: false });
  });

  it("does not salvage an alias fault", () => {
    const text = JSON.stringify(settlement());
    expect(salvageSettlement(text, {
      ok: false,
      code: "alias_invalid",
      field: "durableNominations[0].concernRef",
    }, reparse)).toEqual({ ok: false });
  });
});
