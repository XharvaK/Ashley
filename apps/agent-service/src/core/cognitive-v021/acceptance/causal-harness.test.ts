import { describe, expect, it } from "vitest";
import {
  assertCausalInvariants,
  type CausalBundle,
} from "./causal-harness.js";
import { SETTLEMENT_SCHEMA_VERSION } from "../types.js";

function bundle(overrides: Partial<CausalBundle> = {}): CausalBundle {
  return {
    evidenceShownToThought: [],
    thoughtInputHash: "input-hash",
    settlement: null,
    workingContext: [],
    occupancy: [],
    authorityCodes: [],
    nominations: [],
    expressionInput: null,
    outboxText: null,
    deliveredText: null,
    thoughtModelAttempts: 1,
    acceptedSettlements: 0,
    acceptedGeneration: null,
    ...overrides,
  };
}

function draftSettlement(): NonNullable<CausalBundle["settlement"]> {
  return {
    settlementId: "settlement-1",
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    cycleId: "cycle-1",
    generation: 1,
    authorityEpoch: 1,
    occupantId: "occupant-1",
    architectureEpoch: "v0.2.1",
    triggerRef: "evidence-1",
    interpretation: {
      discourseActs: ["inform"],
      referentBindings: [],
      corrections: [],
      unresolvedAmbiguities: [],
      topics: ["greeting"],
    },
    commitments: {
      epistemic: [
        {
          dimensions: {
            source: "owner_utterance",
            status: "asserted",
            time: "current",
            reliability: "owner_supplied",
          },
          statement: "The source says hello.",
        },
      ],
      conversational: ["answer"],
      operational: [],
      stance: {
        warmth: "medium",
        humorAllowed: false,
        disagreement: false,
        uncertaintyDisplay: true,
      },
    },
    speech: {
      mode: "draft",
      mustSay: [],
      mustNot: [],
      surfaceDraft: "hello",
      acceptableRealizations: ["hello"],
      presentationDirectives: [],
      finalLicensedText: "hello",
    },
    workingContextDelta: [],
    concernDeltas: [],
    occupancyDelta: [],
    futureTriggers: [],
    subscriptions: [],
    durableNominations: [],
    operations: {
      observationsConsumed: [],
      effectsCompleted: [],
      intentsStillInFlight: [],
    },
    authority: { objectionsApplied: [], revisionCount: 0 },
  };
}

describe("cognitive v0.2.1 causal acceptance harness", () => {
  it("rejects delivered Ashley text without a published settlement", () => {
    expect(() =>
      assertCausalInvariants(bundle({ deliveredText: "unlicensed" })),
    ).toThrow(/delivered_text_requires_settlement/);
  });

  it("accepts ordinary sparse draft speech without structured commitments", () => {
    const settlement = {
      ...draftSettlement(),
      commitments: undefined,
      speech: {
        ...draftSettlement().speech,
        surfaceDraft: "unsupported draft",
      },
    } as unknown as CausalBundle["settlement"];
    expect(() =>
      assertCausalInvariants(
        bundle({ settlement, acceptedSettlements: 1, outboxText: "unsupported draft" }),
      ),
    ).not.toThrow();
  });

  it("rejects transcript, memory, and capability markers in expression input", () => {
    for (const marker of ["hotMessages", "## Capability self-model"]) {
      expect(() =>
        assertCausalInvariants(bundle({ expressionInput: `draft ${marker}` })),
      ).toThrow(/expression_input_contains_forbidden_evidence/);
    }
  });

  it("accepts a settlement whose outbox text matches the licensed draft", () => {
    expect(() =>
      assertCausalInvariants(
        bundle({
          settlement: draftSettlement(),
          outboxText: "hello",
          thoughtModelAttempts: 1,
          acceptedSettlements: 1,
          acceptedGeneration: 1,
        }),
      ),
    ).not.toThrow();
  });
});
