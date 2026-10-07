import { describe, expect, it } from "vitest";
import {
  AFTERTHOUGHT_GUIDANCE,
  RHYTHM_GUIDANCE,
  SOFT_LAYER_GUIDANCE,
  SOFT_SETTLEMENT_FIELDS,
  constrainThoughtOutputSchema,
  thoughtContractProfile,
  thoughtOutputCompatibilityInstruction,
  type ThoughtContractProfileSource,
} from "./output-contract.js";
import { parseThoughtSemanticOutput } from "./parse.js";
import { planRhythmBubbles } from "../../delivery/bubble-plan.js";
import type { OperationalEffectNamespace } from "../effect/effect-ref.js";

const chat: ThoughtContractProfileSource = { trigger: { kind: "owner_message" } };
const pass = (kind: string): ThoughtContractProfileSource => ({ trigger: { kind: "idle_opportunity" }, innerPass: { kind } });

function schemaFor(source: ThoughtContractProfileSource) {
  const namespace = { allowedOperationalEffectRefs: [], fingerprint: "sha256:test" } as unknown as OperationalEffectNamespace;
  const schema = constrainThoughtOutputSchema(namespace, thoughtContractProfile(source)).schema as {
    oneOf: Array<{ properties: Record<string, { oneOf?: Array<{ properties: Record<string, unknown> }> }> }>;
  };
  const settlement = schema.oneOf[0]!.properties;
  const draft = settlement.speech!.oneOf!.find((form) => (form.properties.mode as { const?: string }).const === "draft")!;
  return { fields: Object.keys(settlement), speech: Object.keys(draft.properties) };
}

function settle(extra: Record<string, unknown>, speech: Record<string, unknown> = { mode: "none" }) {
  return parseThoughtSemanticOutput({ kind: "settlement", speech, durableNominations: [], ...extra }, new Set());
}

describe("UX W2: one Thought-contract change", () => {
  it("offers the soft acts only in the Owner's DM passes, never a room, the game or the night", () => {
    for (const source of [chat, pass("awake"), pass("afterglow"), { trigger: { kind: "idle_opportunity" } }]) {
      expect(schemaFor(source).fields).toEqual(expect.arrayContaining([...SOFT_SETTLEMENT_FIELDS]));
    }
    for (const source of [{ ...chat, audience: { kind: "room" } }, { ...chat, audience: { kind: "dm" } },
      { trigger: { kind: "domus_notification" } }, pass("night")]) {
      const fields = schemaFor(source).fields;
      for (const field of SOFT_SETTLEMENT_FIELDS) expect(fields).not.toContain(field);
    }
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile(chat))).toContain(SOFT_LAYER_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile({ ...chat, audience: { kind: "room" } }))).not.toContain(SOFT_LAYER_GUIDANCE);
  });

  it("every speech draft may carry a shape and bubbles; an afterthought belongs to the afterglow", () => {
    expect(schemaFor(chat).speech).toEqual(expect.arrayContaining(["shape", "bubbles"]));
    expect(schemaFor(chat).speech).not.toContain("afterthought");
    expect(schemaFor(pass("afterglow")).speech).toContain("afterthought");
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile({ ...chat, audience: { kind: "room" } }))).toContain(RHYTHM_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile(pass("afterglow")))).toContain(AFTERTHOUGHT_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile(chat))).not.toContain(AFTERTHOUGHT_GUIDANCE);
  });

  it("parses each soft act and the rhythm, and names the field that is wrong", () => {
    expect(settle({ touch: { emoji: "😂", rowId: "row-1", meaning: "landed" } }).ok).toBe(true);
    expect(settle({ correct: { rowId: "row-1", bubble: 1, text: "fixed" } }).ok).toBe(true);
    expect(settle({ callback: { memoryRef: "mem-1" } }).ok).toBe(true);
    expect(settle({ callback: { gifQuery: "otter" } }).ok).toBe(true);
    expect(settle({ pin: { rowId: "row-1", memoryRef: "mem-1" } }).ok).toBe(true);
    expect(settle({ card: { kind: "reading_note", title: "On otters", body: "They hold hands.", link: "https://example.com" } }).ok).toBe(true);
    expect(settle({ face: { wardrobeId: "weather-rain" } }).ok).toBe(true);
    expect(settle({ quiet: { forMs: 3_600_000, whose: "owner_asked" } }).ok).toBe(true);
    expect(settle({}, { mode: "draft", surfaceDraft: "a\n\nb", shape: "burst", bubbles: ["a", "b"] }).ok).toBe(true);
    expect(settle({}, { mode: "draft", surfaceDraft: "more", afterthought: true }).ok).toBe(true);

    expect(settle({ touch: { emoji: "😂", rowId: "row-1", meaning: "loved" } })).toMatchObject({ ok: false, field: "touch" });
    expect(settle({ callback: { memoryRef: "m", gifQuery: "g" } })).toMatchObject({ ok: false, field: "callback" });
    expect(settle({ quiet: { forMs: 10, whose: "her_own" } })).toMatchObject({ ok: false, field: "quiet" });
    expect(settle({}, { mode: "draft", surfaceDraft: "a", shape: "poem" })).toMatchObject({ ok: false, field: "speech.shape" });
    expect(settle({}, { mode: "draft", surfaceDraft: "a", bubbles: ["a"] })).toMatchObject({ ok: false, field: "speech.bubbles" });
    expect(settle({}, { mode: "none", shape: "single" })).toMatchObject({ ok: false });
  });

  it("the Host splits by her bubbles only when they are the text being sent; single and letter arrive whole", () => {
    expect(planRhythmBubbles("one two\n\nthree", { bubbles: ["one", "two", "three"] }).map((bubble) => bubble.text))
      .toEqual(["one", "two", "three"]);
    expect(planRhythmBubbles("one two changed", { bubbles: ["one", "two"] }).map((bubble) => bubble.text))
      .toEqual(["one two changed"]);
    expect(planRhythmBubbles("dear you\n\nyours", { shape: "letter" }).map((bubble) => bubble.text)).toEqual(["dear you\n\nyours"]);
    expect(planRhythmBubbles("a\n\nb", { shape: "burst" }).map((bubble) => bubble.text)).toEqual(["a", "b"]);
    expect(planRhythmBubbles("a\n\nb", undefined).map((bubble) => bubble.text)).toEqual(["a", "b"]);
  });
});
