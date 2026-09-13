import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEMANTIC_PROJECTION_ENVELOPE,
  CURRENT_SOURCE_DEFAULT_SEMANTIC_ENVELOPE,
  INTERACTIVE_THOUGHT_MAX_OUTPUT,
  MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
  MAX_SUPPORTED_COMPOSITION_BYTES,
  MAX_SUPPORTED_COMPOSITION_ESTIMATED_INPUT_TOKENS,
  OWNER_APPROVED_TARGET_SEMANTIC_ENVELOPE,
  STRUCTURAL_RETRY_MAX_OUTPUT,
  TARGET_SEMANTIC_INPUT_ENVELOPE,
  TEMPORARY_QUALIFICATION_CEILING_TOKENS,
  checkThoughtAdmission,
  deriveThoughtBudget,
} from "../budget.js";

describe("Thought semantic projection budget", () => {
  it("uses a provider-independent logical envelope and preserves the output ceilings", () => {
    const nim = deriveThoughtBudget({ quotaBucket: "nim:openai/gpt-oss-20b" });
    const groq = deriveThoughtBudget({ quotaBucket: "groq:openai/gpt-oss-20b" });

    expect(DEFAULT_SEMANTIC_PROJECTION_ENVELOPE.maxInputTokens).toBe(
      TARGET_SEMANTIC_INPUT_ENVELOPE,
    );
    expect(nim.semanticProjectionEnvelope).toEqual(groq.semanticProjectionEnvelope);
    expect(CURRENT_SOURCE_DEFAULT_SEMANTIC_ENVELOPE).toBe(9_500);
    expect(TEMPORARY_QUALIFICATION_CEILING_TOKENS)
      .toBe(CURRENT_SOURCE_DEFAULT_SEMANTIC_ENVELOPE);
    expect(OWNER_APPROVED_TARGET_SEMANTIC_ENVELOPE).toBe(32_768);
    expect(nim.semanticProjectionEnvelope.maxInputTokens)
      .toBe(OWNER_APPROVED_TARGET_SEMANTIC_ENVELOPE);
    expect(MAX_LOGICAL_SERIALIZED_INPUT_BYTES).toBe(65_408);
    expect(MAX_SUPPORTED_COMPOSITION_BYTES).toBe(65_356);
    expect(MAX_SUPPORTED_COMPOSITION_ESTIMATED_INPUT_TOKENS).toBe(32_742);
    expect(nim.maxOutputTokens).toBe(INTERACTIVE_THOUGHT_MAX_OUTPUT);
    expect(deriveThoughtBudget({ maxOutputTokens: STRUCTURAL_RETRY_MAX_OUTPUT }).maxOutputTokens)
      .toBe(STRUCTURAL_RETRY_MAX_OUTPUT);
    // P2 16K era: ordinary and structural-retry output share one ceiling.
    expect(INTERACTIVE_THOUGHT_MAX_OUTPUT).toBe(16_384);
    expect(STRUCTURAL_RETRY_MAX_OUTPUT).toBe(16_384);
  });

  it("admits against logical input capacity, independently of provider TPM metadata", () => {    const budget = deriveThoughtBudget({
      quotaBucket: "groq:openai/gpt-oss-20b",
      semanticProjectionEnvelope: {
        id: "test-envelope",
        version: 1,
        maxInputTokens: 100,
      },
    });

    const admission = checkThoughtAdmission(
      [{ role: "user", content: "x".repeat(400) }],
      budget,
    );

    expect(admission.admitted).toBe(false);
    expect(admission.semanticBudgetTokens).toBe(100);
    expect(admission.headroom).toBeLessThan(0);
    expect(admission.hardTpm).toBe(8000);
  });

  it("admits the full 32K input envelope with the 16K output reserve (no input starvation)", () => {
    const budget = deriveThoughtBudget({});
    expect(budget.semanticBudgetTokens).toBe(32_768);
    expect(budget.maxOutputTokens).toBe(16_384);
    // Worst-case demand: full envelope input + 16K reserve admits; the
    // governor (tpm 65536, worst case ≈32742 + 16384 = 49126) paces.
    const admission = checkThoughtAdmission(
      [{ role: "user", content: "x".repeat(60_000) }],
      budget,
    );
    expect(admission.estimate.estimatedInputTokens).toBeLessThanOrEqual(32_768);
    expect(admission.admitted).toBe(true);
  });
});
