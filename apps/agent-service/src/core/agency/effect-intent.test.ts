import { describe, expect, it } from "vitest";
import type { Decision } from "../types.js";
import {
  deriveEffectIntent,
  deriveEffectPurposes,
  effectIntentId,
  type EffectGrounding,
} from "./effect-intent.js";

function makeDecision(id: number, evidenceRefs: Decision["evidenceRefs"]): Decision {
  return {
    id,
    trigger: "proactive",
    kind: "share",
    motivationIds: [1],
    score: 60,
    reason: "grounded",
    evidenceRefs,
    uncertainty: 0,
    urgency: 0,
    thoughtSource: "deterministic",
    thoughtError: null,
    affectLicense: {
      permitted: false,
      valence: 0,
      activation: 0.5,
      openness: 0.5,
      tension: 0,
      reason: "neutral",
    },
    cognitiveAllocation: {
      shouldSpeak: true,
      effort: "medium",
      completion: "complete",
    },
    authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
  };
}

const grounds: EffectGrounding[] = [
  {
    entityUuid: "oci-1",
    kind: "question",
    epistemicLevel: "known",
    sourceTrust: "trusted",
  },
];

describe("agency effect-intent derivation", () => {
  it("derives the verify-build-health purpose from a grounded question OCI", () => {
    const decision = makeDecision(7, [
      { type: "open_cognitive_item", id: "oci-1" },
    ]);
    const intent = deriveEffectIntent(decision, grounds);
    expect(intent.deterministic).toBe(true);
    expect(intent.purposes).toEqual(["sandbox_verify_build_health"]);
    expect(intent.groundedRefs).toEqual([
      { type: "open_cognitive_item", id: "oci-1" },
    ]);
    expect(intent.intentId).toBe("intent-7");
    expect(deriveEffectPurposes(decision, grounds)).toEqual([
      "sandbox_verify_build_health",
    ]);
  });

  it("deduplicates purposes across multiple grounded refs", () => {
    const decision = makeDecision(8, [
      { type: "open_cognitive_item", id: "oci-1" },
      { type: "open_cognitive_item", id: "oci-2" },
    ]);
    const intent = deriveEffectIntent(decision, [
      ...grounds,
      {
        entityUuid: "oci-2",
        kind: "question",
        epistemicLevel: "remembered",
        sourceTrust: "trusted",
      },
    ]);
    expect(intent.purposes).toEqual(["sandbox_verify_build_health"]);
    expect(intent.groundedRefs).toHaveLength(2);
  });

  it("drops non-OCI refs and refs without matching grounds", () => {
    const decision = makeDecision(9, [
      { type: "message", id: "m1" },
      { type: "open_cognitive_item", id: "oci-missing" },
    ]);
    const intent = deriveEffectIntent(decision, grounds);
    expect(intent.purposes).toEqual([]);
    expect(intent.groundedRefs).toEqual([]);
  });

  it("never derives a purpose from unqualified grounds (not known/remembered)", () => {
    const decision = makeDecision(10, [
      { type: "open_cognitive_item", id: "oci-1" },
    ]);
    const intent = deriveEffectIntent(decision, [
      {
        entityUuid: "oci-1",
        kind: "question",
        epistemicLevel: "unknown",
        sourceTrust: "trusted",
      },
    ]);
    expect(intent.purposes).toEqual([]);
    expect(intent.groundedRefs).toEqual([]);
  });

  it("produces no purpose for non-question OCI kinds", () => {
    const decision = makeDecision(11, [
      { type: "open_cognitive_item", id: "oci-1" },
    ]);
    const intent = deriveEffectIntent(decision, [
      {
        entityUuid: "oci-1",
        kind: "revisit",
        epistemicLevel: "known",
        sourceTrust: "trusted",
      },
      {
        entityUuid: "oci-2",
        kind: "concern",
        epistemicLevel: "known",
        sourceTrust: "trusted",
      },
    ]);
    expect(intent.purposes).toEqual([]);
    expect(intent.groundedRefs).toEqual([]);
  });

  it("is deterministic across repeated derivations", () => {
    const decision = makeDecision(12, [
      { type: "open_cognitive_item", id: "oci-1" },
    ]);
    const a = deriveEffectIntent(decision, grounds);
    const b = deriveEffectIntent(decision, grounds);
    expect(a).toEqual(b);
    expect(effectIntentId(decision)).toBe("intent-12");
  });
});
