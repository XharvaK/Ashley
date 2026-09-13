import { SETTLEMENT_SCHEMA_VERSION } from "../types.js";
import type { PublishedCognitiveSettlement } from "../types.js";

export function continuitySettlement(
  overrides: Partial<PublishedCognitiveSettlement> = {},
): PublishedCognitiveSettlement {
  return {
    settlementId: "settlement-continuity-1",
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    cycleId: "cycle-1",
    generation: 1,
    authorityEpoch: 1,
    occupantId: "doc",
    architectureEpoch: "v0.2.1",
    triggerRef: "turn-1",
    interpretation: {
      discourseActs: ["inform"], referentBindings: [], corrections: [], unresolvedAmbiguities: [], topics: [],
    },
    commitments: {
      epistemic: [{ dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, statement: "continuity" }],
      conversational: ["answer"],
      operational: [],
      stance: { warmth: "medium", humorAllowed: false, disagreement: false, uncertaintyDisplay: true },
    },
    speech: { mode: "draft", mustSay: ["continuity"], mustNot: [], surfaceDraft: "continuity", acceptableRealizations: ["continuity"], presentationDirectives: [], finalLicensedText: "continuity" },
    workingContextDelta: [], concernDeltas: [], occupancyDelta: [], futureTriggers: [], subscriptions: [], durableNominations: [],
    operations: { observationsConsumed: [], effectsCompleted: [], intentsStillInFlight: [] },
    authority: { objectionsApplied: [], revisionCount: 0 },
    ...overrides,
  };
}

export function perturbedContinuitySettlement(
  overrides: Partial<PublishedCognitiveSettlement> = {},
): PublishedCognitiveSettlement {
  return continuitySettlement({
    settlementId: "settlement-qwen-1",
    triggerRef: "qwen-turn-1",
    ...overrides,
  });
}
