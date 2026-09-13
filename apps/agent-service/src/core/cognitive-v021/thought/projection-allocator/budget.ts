import { quotaContractFor } from "../../../model-routing/router.js";
import {
  BYTES_PER_TOKEN,
  FRAMING_TOKEN_OVERHEAD,
  estimateRequestTokens,
  estimateRequestInputBytes,
  type EstimateMessage,
  type RequestEstimateOptions,
  type TokenEstimate,
} from "../../../attention/estimate.js";

export {
  BYTES_PER_TOKEN,
  FRAMING_TOKEN_OVERHEAD,
  estimateRequestTokens,
  estimateRequestInputBytes,
  type EstimateMessage,
  type RequestEstimateOptions,
  type TokenEstimate,
};

export type Budget = {
  /** Provider-independent logical input envelope owned by the allocator. */
  semanticProjectionEnvelope: SemanticProjectionEnvelope;
  /** Convenient scalar view of semanticProjectionEnvelope.maxInputTokens. */
  semanticBudgetTokens: number;
  /**
   * Legacy provider metadata retained for existing forensic consumers only.
   * The allocator never uses either field to select or omit semantic input.
   * Attention remains the owner of provider capacity admission.
   */
  quotaBucket: string;
  hardTpm: number;
  maxOutputTokens: number;
  stableReserveTokens: number;
};

export type SemanticProjectionEnvelope = Readonly<{
  id: string;
  version: number;
  /** Maximum logical input tokens. Output reservation is a separate ceiling. */
  maxInputTokens: number;
}>;

export const ORDINARY_THOUGHT_BUDGET_MS = 180_000;
export const INTERACTIVE_THOUGHT_MAX_OUTPUT = 16_384;
export const STRUCTURAL_RETRY_MAX_OUTPUT = 16_384;
export const STABLE_RESERVE_TOKENS = 0;
/** Exact source-baseline default at 440cc0. It is retained for comparison. */
export const CURRENT_SOURCE_DEFAULT_SEMANTIC_ENVELOPE = 9_500;
/** Owner-approved restoration target. It is provider-independent. */
export const OWNER_APPROVED_TARGET_SEMANTIC_ENVELOPE = 32_768;
export const TARGET_SEMANTIC_INPUT_ENVELOPE = OWNER_APPROVED_TARGET_SEMANTIC_ENVELOPE;
/** Historical source name retained so baseline readers remain exact. */
export const TEMPORARY_QUALIFICATION_CEILING_TOKENS =
  CURRENT_SOURCE_DEFAULT_SEMANTIC_ENVELOPE;
/** Maximum logical serialized input bytes under the frozen estimator. */
export const MAX_LOGICAL_SERIALIZED_INPUT_BYTES =
  (TARGET_SEMANTIC_INPUT_ENVELOPE - FRAMING_TOKEN_OVERHEAD) * BYTES_PER_TOKEN;
/** Current maximal supported composition, including one structural retry. */
export const MAX_SUPPORTED_COMPOSITION_BYTES = 65_356;
export const MAX_SUPPORTED_COMPOSITION_ESTIMATED_INPUT_TOKENS = 32_742;
export const COMPOSITION_UNALLOCATED_BYTES =
  MAX_LOGICAL_SERIALIZED_INPUT_BYTES - MAX_SUPPORTED_COMPOSITION_BYTES;
export const DEFAULT_SEMANTIC_PROJECTION_ENVELOPE: SemanticProjectionEnvelope = Object.freeze({
  id: "thought-semantic-projection",
  version: 1,
  maxInputTokens: TARGET_SEMANTIC_INPUT_ENVELOPE,
});

/** Alias used by qualification readers; the value remains the same contract. */
export const SEMANTIC_PROJECTION_ENVELOPE = DEFAULT_SEMANTIC_PROJECTION_ENVELOPE;

function normalizeSemanticProjectionEnvelope(
  envelope: SemanticProjectionEnvelope,
): SemanticProjectionEnvelope {
  if (
    typeof envelope.id !== "string" ||
    envelope.id.length === 0 ||
    !Number.isInteger(envelope.version) ||
    envelope.version < 1 ||
    !Number.isInteger(envelope.maxInputTokens) ||
    envelope.maxInputTokens < 1
  ) {
    throw new Error("semantic_projection_envelope_invalid");
  }
  return Object.freeze({
    id: envelope.id,
    version: envelope.version,
    maxInputTokens: envelope.maxInputTokens,
  });
}

export function deriveThoughtBudget(opts: {
  quotaBucket?: string;
  maxOutputTokens?: number;
  semanticProjectionEnvelope?: SemanticProjectionEnvelope;
  /** Short alias for callers that already hold the named envelope. */
  semanticEnvelope?: SemanticProjectionEnvelope;
  /** Qualification/test shorthand; it still creates a logical input envelope. */
  semanticBudgetTokens?: number;
} = {}): Budget {
  const semanticProjectionEnvelope = normalizeSemanticProjectionEnvelope(
    opts.semanticProjectionEnvelope
      ?? opts.semanticEnvelope
      ?? (typeof opts.semanticBudgetTokens === "number"
        ? {
            id: "caller-semantic-projection",
            version: 1,
            maxInputTokens: opts.semanticBudgetTokens,
          }
        : DEFAULT_SEMANTIC_PROJECTION_ENVELOPE),
  );

  // This is compatibility metadata for historical receipt readers. It is
  // intentionally absent from the default allocator path and never governs
  // semantic projection selection. Attention re-evaluates the active route's
  // quota immediately before physical dispatch.
  const quotaBucket = opts.quotaBucket ?? "attention-owned";
  const hardTpm = opts.quotaBucket ? quotaContractFor(opts.quotaBucket).tpm : 0;
  const maxOutputTokens = opts.maxOutputTokens ?? INTERACTIVE_THOUGHT_MAX_OUTPUT;
  return {
    semanticProjectionEnvelope,
    semanticBudgetTokens: semanticProjectionEnvelope.maxInputTokens,
    quotaBucket,
    hardTpm,
    maxOutputTokens,
    stableReserveTokens: STABLE_RESERVE_TOKENS,
  };
}

export function checkThoughtAdmission(
  messages: EstimateMessage[],
  budget: Budget,
  options: Pick<RequestEstimateOptions, "toolsJson" | "wireAdditionalBytes"> = {},
): {
  admitted: boolean;
  estimate: TokenEstimate;
  totalDemand: number;
  hardTpm: number;
  semanticBudgetTokens: number;
  headroom: number;
} {
  const estimate = estimateRequestTokens(messages, {
    maxTokens: budget.maxOutputTokens,
    toolsJson: options.toolsJson,
    wireAdditionalBytes: options.wireAdditionalBytes,
  });
  const totalDemand = estimate.estimatedInputTokens + estimate.estimatedOutputTokens;
  return {
    admitted: estimate.estimatedInputTokens <= budget.semanticBudgetTokens,
    estimate,
    totalDemand,
    hardTpm: budget.hardTpm,
    semanticBudgetTokens: budget.semanticBudgetTokens,
    headroom: budget.semanticBudgetTokens - estimate.estimatedInputTokens,
  };
}
