import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { THOUGHT_OUTPUT_SCHEMA, constrainThoughtOutputSchema } from "./output-contract.js";
import { fidelityCheck } from "../speech/fidelity.js";
import { validateThoughtSettlementDraft } from "../settlement/validate.js";
import { makeThoughtDraft } from "../test-support.js";

const refs = new Set(["turn-1", "concern-1", "entity-1", "trigger-1", "subscription-1", "assertion-1"]);
const minimal = { kind: "settlement", speech: { mode: "draft", surfaceDraft: "Goodnight. Sleep well." } };
const dimensions = { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" };
const parse = (value: unknown) => parseThoughtSemanticOutput(value, refs);

describe("Sparse VNext fresh authoring", () => {
  it("preserves exact absence for ordinary speech and intentional silence", () => {
    for (const value of [minimal, { kind: "settlement", speech: { mode: "none" } }]) {
      expect(parse(value)).toEqual({ ok: true, value });
      expect(Object.keys((parse(value) as any).value)).toEqual(["kind", "speech"]);
    }
  });

  it.each(["workingContextDeltas", "concernDeltas", "occupancyDeltas", "futureTriggerDeltas", "subscriptionDeltas", "durableNominations"])("rejects empty or malformed present %s", (field) => {
    expect(parse({ ...minimal, [field]: [] })).toMatchObject({ ok: false, code: "empty_when_present", field });
    for (const value of [null, {}, "", false]) expect(parse({ ...minimal, [field]: value }).ok).toBe(false);
  });

  it.each(["interpretation", "commitments", "evidenceUse"])("requires a meaningful child in %s", (field) => {
    expect(parse({ ...minimal, [field]: {} })).toMatchObject({ ok: false, code: "empty_when_present", field });
    expect(parse({ ...minimal, [field]: null }).ok).toBe(false);
    expect(parse({ ...minimal, [field]: undefined }).ok).toBe(false);
    expect(parse({ ...minimal, [field]: { unknown: ["x"] } }).ok).toBe(false);
  });

  it("accepts partial composite acts and rejects empty present children", () => {
    for (const [domain, field, value] of [
      ["interpretation", "topics", ["rest"]],
      ["interpretation", "discourseActs", ["acknowledge"]],
      ["commitments", "conversational", ["acknowledge"]],
      ["commitments", "epistemic", [{ statement: "A past fact", dimensions }]],
      ["evidenceUse", "sourceRefsUsed", ["turn-1"]],
    ] as const) {
      const candidate = { ...minimal, [domain]: { [field]: value } };
      expect(parse(candidate)).toEqual({ ok: true, value: candidate });
      expect(parse({ ...minimal, [domain]: { [field]: [] } })).toMatchObject({ ok: false, code: "empty_when_present", field: `${domain}.${field}` });
    }
  });

  it("enforces speech branches and removed fields", () => {
    for (const speech of [{}, { mode: "draft" }, { mode: "draft", surfaceDraft: "" },
      { mode: "none", surfaceDraft: null }, { mode: "none", mustSay: [] },
      { ...minimal.speech, acceptableRealizations: ["Goodnight"] }, { ...minimal.speech, mustSay: [] }]) {
      expect(parse({ ...minimal, speech }).ok).toBe(false);
    }
    expect(parse({ kind: "settlement" })).toMatchObject({ ok: false, code: "required_field_missing" });
    expect(parse({ ...minimal, unknown: true })).toMatchObject({ ok: false, code: "unknown_field" });
  });

  it("uses opaque existing refs at the seven corrected schema surfaces", () => {
    const value = { ...minimal,
      interpretation: { referentBindings: [{ span: "it", sourceTurnRefs: ["turn-1"], concernRef: "concern-1", entityRef: "entity-1" }], corrections: [{ correctedTurnRefs: ["turn-1"], fromSpan: "a", toSpan: "b", concernRef: "concern-1" }] },
      workingContextDeltas: [{ op: "abandon", target: "entity-1" }], concernDeltas: [{ op: "resolve", target: "concern-1" }],
      futureTriggerDeltas: [{ op: "cancel", target: "trigger-1" }], subscriptionDeltas: [{ op: "cancel", target: "subscription-1" }],
      durableNominations: [{ statement: "A past fact", memoryKind: "owner_world_claim", dimensions, dataClassification: "ordinary", sourceRefs: ["turn-1"], supersedesRef: "assertion-1", concernRef: null }],
    };
    expect(parse(value)).toEqual({ ok: true, value });
    expect(parse({ ...minimal, concernDeltas: [{ op: "resolve", target: { kind: "existing", ref: "concern-1" } }] }).ok).toBe(false);
    expect(parse({ ...minimal, concernDeltas: [{ op: "resolve", target: "invented" }] }).ok).toBe(false);
  });

  it("creates triggers, subscriptions and nominations without dead aliases", () => {
    const trigger = { op: "create", concernRef: { kind: "existing", ref: "concern-1" }, dueAtMs: 100, purpose: "revisit", payload: {} };
    const subscription = { concernRef: null, source: "feed", scope: "public", topicKeys: ["topic"], match: "equality", expiresAtMs: null };
    expect(parse({ ...minimal, futureTriggerDeltas: [trigger], subscriptionDeltas: [{ op: "create", subscription }] }).ok).toBe(true);
    expect(parse({ ...minimal, futureTriggerDeltas: [{ ...trigger, identity: { kind: "local", alias: "dead" } }] }).ok).toBe(false);
    expect(parse({ ...minimal, subscriptionDeltas: [{ op: "create", subscription: { ...subscription, identity: { kind: "local", alias: "dead" } } }] }).ok).toBe(false);
  });

  it("rejects a creation alias that collides with an existing reference", () => {
    const item = {
      identity: { kind: "local", alias: "turn-1" },
      type: "topic",
      text: "same-settlement topic",
      concernRef: null,
      sourceTurnRefs: ["turn-1"],
      status: "active",
      supersedesRef: null,
    };
    expect(parse({ ...minimal, workingContextDeltas: [{ op: "upsert", item }]})).toMatchObject({
      ok: false,
      code: "alias_collides_with_existing_ref",
      field: "workingContextDeltas.identity",
    });
    expect(parse({
      ...minimal,
      occupancyDeltas: [{
        op: "set",
        concernRef: { kind: "local", alias: "concern-1" },
        status: "active",
        priority: 1,
      }],
    })).toMatchObject({
      ok: false,
      code: "alias_collides_with_existing_ref",
      field: "occupancyDeltas.concernRef",
    });
  });

  it("reserves abstain for the three responsible-inability reasons", () => {
    for (const reason of ["insufficient_evidence", "unresolved_ambiguity", "no_responsible_proposal"]) {
      expect(parse({ kind: "abstain", reason, explanation: "Insufficient basis", evidenceRefs: [] }).ok).toBe(true);
    }
    expect(parse({ kind: "abstain", reason: "no_semantic_change_warranted", explanation: "No change", evidenceRefs: [] }).ok).toBe(false);
  });

  it("keeps sparse schema law distinct from wire qualification bounds", () => {
    const canonical = THOUGHT_OUTPUT_SCHEMA as any;
    expect(canonical.oneOf[0].required).toEqual(["kind", "speech"]);
    expect(canonical.oneOf[0].properties.concernDeltas.items.oneOf[1].properties.target).toEqual({ type: "string", minLength: 1 });
    const wire = constrainThoughtOutputSchema({ allowedOperationalEffectRefs: [], fingerprint: "sha256:test" } as any).schema as any;
    expect(wire.oneOf[0].properties.speech.oneOf.find((b: any) => b.properties.mode.const === "draft").properties.surfaceDraft.maxLength).toBe(6000);
    expect(canonical.oneOf[0].properties.speech.oneOf.find((b: any) => b.properties.mode.const === "draft").properties.surfaceDraft.maxLength).toBeUndefined();
    expect(wire.oneOf[0].properties.commitments.properties.operational).toBeUndefined();
  });

  it("validates and licenses ordinary sparse speech while retaining high-risk guards", () => {
    const draft = makeThoughtDraft();
    for (const field of ["interpretation", "commitments", "workingContextDelta", "concernDeltas", "occupancyDelta", "futureTriggers", "subscriptions", "durableNominations"]) delete (draft as any)[field];
    draft.speech = { mode: "draft", surfaceDraft: minimal.speech.surfaceDraft } as any;
    expect(validateThoughtSettlementDraft(draft).ok).toBe(true);
    const input = { mode: "draft", draft: minimal.speech.surfaceDraft } as any;
    expect(fidelityCheck(input).ok).toBe(true);
    expect(fidelityCheck({ ...input, draft: "I completed it." }).ok).toBe(false);
    expect(fidelityCheck({ ...input, draft: "The latest state is ready." }).ok).toBe(false);
  });
});
