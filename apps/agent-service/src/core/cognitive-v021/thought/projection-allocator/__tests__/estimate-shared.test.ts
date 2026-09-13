import { describe, it, expect } from "vitest";
import {
  BYTES_PER_TOKEN as ATTENTION_BYTES_PER_TOKEN,
  FRAMING_TOKEN_OVERHEAD as ATTENTION_FRAMING_OVERHEAD,
  estimateRequestTokens as attentionEstimate,
} from "../../../../attention/estimate.js";
import {
  BYTES_PER_TOKEN,
  FRAMING_TOKEN_OVERHEAD,
  STABLE_RESERVE_TOKENS,
  INTERACTIVE_THOUGHT_MAX_OUTPUT,
  STRUCTURAL_RETRY_MAX_OUTPUT,
  ORDINARY_THOUGHT_BUDGET_MS,
  deriveThoughtBudget,
  checkThoughtAdmission,
  estimateRequestTokens as budgetEstimate,
} from "../budget.js";
import { ORDINARY_THOUGHT_BUDGET_MS as KERNEL_ORDINARY_THOUGHT_BUDGET_MS } from "../../../types.js";

describe("Shared Estimator Authority", () => {
  it("proves single source of truth for constants", () => {
    expect(BYTES_PER_TOKEN).toBe(ATTENTION_BYTES_PER_TOKEN);
    expect(BYTES_PER_TOKEN).toBe(2);
    expect(FRAMING_TOKEN_OVERHEAD).toBe(ATTENTION_FRAMING_OVERHEAD);
    expect(FRAMING_TOKEN_OVERHEAD).toBe(64);
    expect(STABLE_RESERVE_TOKENS).toBe(0);
    expect(INTERACTIVE_THOUGHT_MAX_OUTPUT).toBe(16384);
    expect(STRUCTURAL_RETRY_MAX_OUTPUT).toBe(16384);
    expect(ORDINARY_THOUGHT_BUDGET_MS).toBe(180000);
    expect(ORDINARY_THOUGHT_BUDGET_MS).toBe(KERNEL_ORDINARY_THOUGHT_BUDGET_MS);
  });

  it("proves identical calculation between allocator and attention estimator", () => {
    const messages = [
      { role: "system", content: "You are Ashley." },
      { role: "user", content: JSON.stringify({ trigger: "hello", data: "x".repeat(500) }) },
    ];

    const attEst = attentionEstimate(messages, { maxTokens: INTERACTIVE_THOUGHT_MAX_OUTPUT });
    const budEst = budgetEstimate(messages, { maxTokens: INTERACTIVE_THOUGHT_MAX_OUTPUT });

    expect(budEst.estimatedInputTokens).toBe(attEst.estimatedInputTokens);
    expect(budEst.estimatedOutputTokens).toBe(attEst.estimatedOutputTokens);

    const budget = deriveThoughtBudget({ quotaBucket: "nim:openai/gpt-oss-20b" });
    const admission = checkThoughtAdmission(messages, budget);

    expect(admission.estimate.estimatedInputTokens).toBe(attEst.estimatedInputTokens);
    expect(admission.estimate.estimatedOutputTokens).toBe(INTERACTIVE_THOUGHT_MAX_OUTPUT);
    expect(admission.totalDemand).toBe(attEst.estimatedInputTokens + INTERACTIVE_THOUGHT_MAX_OUTPUT);
    expect(admission.hardTpm).toBe(16000);
    // P2: input-only admission — worst-case demand (input + 16K reserve)
    // admits even above bucket TPM metadata (no request_exceeds_tpm_budget;
    // the governor paces, the allocator never starves input).
    expect(admission.totalDemand).toBeGreaterThan(16000);
    expect(admission.admitted).toBe(true);
  });

  it("keeps the full estimator authoritative for odd UTF-8 byte totals", () => {
    const messages = [
      { role: "s", content: "é" },
      { role: "u", content: "a" },
    ];

    const expected = {
      estimatedInputTokens: 67,
      estimatedOutputTokens: 7,
    };
    expect(attentionEstimate(messages, { maxTokens: 7 })).toEqual(expected);
    expect(budgetEstimate(messages, { maxTokens: 7 })).toEqual(expected);
  });
});
