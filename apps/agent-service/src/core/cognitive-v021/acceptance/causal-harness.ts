import type {
  CausalBundle as FrozenCausalBundle,
  PublishedCognitiveSettlement,
} from "../types.js";
import { renderForTransport } from "../../conversation/rendering.js";

export type CausalBundle = FrozenCausalBundle;

function fail(code: string): never {
  throw new Error(`cognitive_causal_invariant:${code}`);
}

function speech(settlement: PublishedCognitiveSettlement) {
  return settlement.speech;
}

/**
 * Assert the causal links that make a v0.2.1 acceptance result meaningful.
 * This function is deliberately deterministic and has no model or database
 * dependency so the same evidence can be checked offline and in Q1.
 */
export function assertCausalInvariants(bundle: CausalBundle): void {
  if (bundle.deliveredText !== null && bundle.settlement === null) {
    fail("delivered_text_requires_settlement");
  }

  if (bundle.expressionInput !== null) {
    const expression = bundle.expressionInput.toLowerCase();
    const forbiddenMarkers = [
      "hotmessages",
      "transcript",
      "memory",
      "perception",
      "## capability self-model",
    ];
    if (forbiddenMarkers.some((marker) => expression.includes(marker))) {
      fail("expression_input_contains_forbidden_evidence");
    }
  }

  const settlement = bundle.settlement;
  if (settlement === null) {
    const candidate = bundle as CausalBundle & {
      triggerKind?: string;
    };
    if (
      candidate.triggerKind === "idle_opportunity" &&
      bundle.evidenceShownToThought.length === 0 &&
      bundle.thoughtModelAttempts !== 0
    ) {
      fail("empty_house_idle_called_model");
    }
    return;
  }

  const currentSpeech = speech(settlement);

  if (
    bundle.acceptedSettlements === 0 &&
    (bundle.outboxText !== null || bundle.deliveredText !== null)
  ) {
    fail("speech_requires_accepted_settlement");
  }

  if (
    bundle.acceptedGeneration !== null &&
    bundle.acceptedGeneration !== settlement.generation
  ) {
    fail("accepted_generation_mismatch");
  }

  if (
    bundle.outboxGeneration !== undefined &&
    bundle.outboxGeneration !== null &&
    bundle.outboxGeneration !== settlement.generation
  ) {
    fail("stale_generation_outbox");
  }

  if (currentSpeech.mode === "draft") {
    if (bundle.expressionInput === null) {
      if (bundle.outboxText !== renderForTransport(currentSpeech.surfaceDraft ?? "")) {
        fail("outbox_text_does_not_match_licensed_draft");
      }
    } else {
      if (bundle.outboxText !== currentSpeech.finalLicensedText) {
        fail("outbox_text_does_not_match_final_licensed_text");
      }
      const mustNot = currentSpeech.mustNot ?? [];
      if (
        bundle.outboxText !== null &&
        mustNot.some((forbidden) => forbidden.length > 0 && bundle.outboxText!.includes(forbidden))
      ) {
        fail("expression_introduces_must_not_violation");
      }
    }
  }
}
