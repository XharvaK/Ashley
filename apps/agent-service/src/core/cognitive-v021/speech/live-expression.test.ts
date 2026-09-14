import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.js";
import { completeChat, resetAdapterCache, type CognitiveDispatchOptions } from "../../../mistral-client.js";
import { openNuclearDb } from "../../db.js";
import * as nimAdapterModule from "../../model-routing/adapters/nim-adapter.js";
import type { ChatMessage, ProviderCompletion } from "../../model-routing/types.js";
import { withOfflineAppGateDisabled } from "../../qualification/offline-test-helpers.js";
import { currentPortfolio, resolveCurrentPolicy } from "../../model-fabric/portfolio.js";
import {
  createLiveExpressionBinding,
  type LiveExpressionComplete,
} from "./live-expression.js";
import type { ExpressionAdapterInput } from "./expression-adapter.js";

const QWEN_3_8 = "qwen/qwen3.8-27b";
const LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";
const input = {
  draft: "hello",
  commitments: undefined,
  profile: "default",
  medium: "discord",
} satisfies ExpressionAdapterInput;

afterEach(() => {
  env.groqApiKey = "";
  env.nimApiKey = "";
  resetAdapterCache();
  vi.restoreAllMocks();
});

describe("live Expression binding", () => {
  it("binds enabled Expression to the current policy envelope without widening input", async () => {
    const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
    const calls: Array<{ messages: ChatMessage[]; options: CognitiveDispatchOptions }> = [];
    const complete: LiveExpressionComplete = vi.fn(async (messages, options) => {
      calls.push({ messages, options });
      return { text: "synthetic hello" };
    });
    const binding = createLiveExpressionBinding({
      attentionDb,
      completeChat: complete,
      nowMs: () => 1_000,
    });

    const primaryPolicy = resolveCurrentPolicy({
      logicalRole: "expression",
      purpose: "expression",
      lane: "interactive",
      routeId: "ashley_expression",
    });
    expect(primaryPolicy).toMatchObject({
      configuredModelId: QWEN_3_8,
      policyRow: {
        reasoningPolicy: "standard",
        maxOutputTokens: 4096,
        deadlineMs: 20000,
      },
      occupant: {
        provider: "groq",
        reasoningPolicy: "standard",
        effectiveReasoning: "medium",
      },
    });
    expect(binding.expressionEnabled).toBe(true);
    expect(binding.adaptExpression).toBeTypeOf("function");
    await expect(binding.adaptExpression!(input)).resolves.toBe("synthetic hello");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.messages).toHaveLength(1);
    expect(calls[0]?.messages[0]).toMatchObject({ role: "user" });
    expect(calls[0]?.messages[0]?.content).toContain('"draft":"hello"');
    expect(calls[0]?.messages[0]?.content).not.toMatch(/hotmessages|mem_facts|transcript/i);
    expect(calls[0]?.options).toMatchObject({
      route: "ashley_expression",
      purpose: "expression",
      logicalRole: "expression",
      lane: "interactive",
      maxTokens: 4096,
      deadlineAtMs: 21_000,
      modelFallbackChain: {
        invocationOrdinal: 1,
        fallbackFromInvocationId: null,
        fallbackClass: "none",
      },
    });
    expect(calls[0]?.options.model).toBeUndefined();
    attentionDb.close();
  });

  it("uses one eligible fallback hop with the same envelope and deadline", async () => {
    const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
    const calls: CognitiveDispatchOptions[] = [];
    const complete: LiveExpressionComplete = vi.fn(async (_messages, options) => {
      calls.push(options);
      if (options.route === "ashley_expression") {
        throw new Error("primary unavailable");
      }
      return { text: "fallback hello" };
    });
    const binding = createLiveExpressionBinding({
      attentionDb,
      completeChat: complete,
      nowMs: () => 1_000,
    });

    await expect(binding.adaptExpression!(input)).resolves.toBe("fallback hello");
    expect(calls.map((options) => options.route)).toEqual([
      "ashley_expression",
      "ashley_expression_fallback",
    ]);
    expect(calls[1]).toMatchObject({
      maxTokens: 4096,
      deadlineAtMs: 21_000,
      modelFallbackChain: {
        invocationOrdinal: 2,
        fallbackClass: "model_substitution",
      },
    });
    expect(calls[1]?.model).toBeUndefined();
    attentionDb.close();
  });

  it("resolves the Lightning fallback through Model Fabric with truthful wire evidence", async () => {
    env.nimApiKey = "test";
    const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = vi.fn(async (args: {
      modelId: string;
      fabricReasoning?: unknown;
    }): Promise<ProviderCompletion> => ({
      text: "fallback hello",
      usage: { promptTokens: 2, completionTokens: 2, reasoningTokens: 1 },
      providerModel: args.modelId,
    }));
    vi.spyOn(nimAdapterModule, "createNimAdapter").mockReturnValue({
      provider: "nim",
      dispatch,
    });

    const result = await withOfflineAppGateDisabled(() => completeChat(
      [{ role: "user", content: "bounded expression prompt" }],
      {
        attentionDb,
        route: "ashley_expression_fallback",
        purpose: "expression",
        logicalRole: "expression",
        lane: "interactive",
      },
    ));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      modelId: LIGHTNING,
      fabricReasoning: {
        kind: "chat_template_thinking",
        enableThinking: true,
        reasoningBudgetTokens: 512,
      },
    }));
    expect(result.modelAlias).toBe(LIGHTNING);
    expect(result.modelFabric?.resolvedRoute).toMatchObject({
      dispatchedRouteId: "ashley_expression_fallback",
      configuredModelId: LIGHTNING,
      reasoningPolicy: "standard",
      effectiveReasoning: "chat_template_kwargs.enable_thinking=true;reasoning_budget=512",
    });
    expect(result.modelFabric?.receipt.attempts[0]).toMatchObject({
      requestedReasoningPolicy: "standard",
      effectiveReasoningSent: "chat_template_kwargs.enable_thinking=true;reasoning_budget=512",
      translatedWireControl: "chat_template_kwargs.enable_thinking=true;reasoning_budget=512",
      dispatchTruth: "response_received",
      observedReasoning: { status: "tokens", reasoningTokens: 1 },
    });
    attentionDb.close();
  });

  it("keeps the current utility route enabled while its Lightning reasoning stays disabled", () => {
    const current = currentPortfolio();
    expect(current.routeBindings.utility_bulk.enabled).toBe(true);
    const utility = resolveCurrentPolicy({
      logicalRole: "exchange_cognition",
      purpose: "exchange_cognition",
      lane: "background",
    });
    expect(utility.occupant).toMatchObject({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
      reasoningPolicy: "disabled",
      effectiveReasoning: "none",
    });
  });
});
