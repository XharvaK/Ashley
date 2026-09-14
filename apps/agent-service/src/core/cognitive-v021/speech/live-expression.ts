import type { DatabaseSync } from "node:sqlite";
import { env } from "../../../env.js";
import {
  completeChat as productionCompleteChat,
  type CognitiveDispatchOptions,
} from "../../../mistral-client.js";
import type { KernelDeps } from "../types.js";
import {
  createModelFallbackChain,
  metadataFromError,
  newCorrelationId,
  resolveCurrentPolicy,
} from "../../model-fabric/index.js";
import { isEligibleMistralFailure } from "../../conversation/expression-fallback.js";
import type { ChatMessage } from "../../model-routing/types.js";
import {
  adaptExpression,
  type ExpressionAdapterInput,
} from "./expression-adapter.js";

export type LiveExpressionComplete = (
  messages: ChatMessage[],
  options: CognitiveDispatchOptions,
) => Promise<{ text: string }>;

export type LiveExpressionBindingOptions = {
  attentionDb: DatabaseSync;
  completeChat?: LiveExpressionComplete;
  nowMs?: () => number;
};

type ExpressionEnvelope = {
  maxTokens: number;
  deadlineMs: number;
};

function expressionEnvelope(): ExpressionEnvelope {
  const policy = resolveCurrentPolicy({
    logicalRole: "expression",
    purpose: "expression",
    lane: "interactive",
    routeId: "ashley_expression",
  });
  const maxTokens = policy.policyRow.maxOutputTokens;
  const deadlineMs = policy.policyRow.deadlineMs;
  if (maxTokens === null || !Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error("expression_output_budget_missing");
  }
  if (deadlineMs === null || !Number.isInteger(deadlineMs) || deadlineMs < 1) {
    throw new Error("expression_deadline_missing");
  }
  return { maxTokens, deadlineMs };
}

function fallbackAllowed(
  error: unknown,
  deadlineAtMs: number,
  nowMs: () => number,
): boolean {
  return (
    env.expressionFallbackEnabled &&
    nowMs() < deadlineAtMs &&
    isEligibleMistralFailure(error)
  );
}

function dispatchOptions(input: {
  attentionDb: DatabaseSync;
  route: "ashley_expression" | "ashley_expression_fallback";
  maxTokens: number;
  deadlineAtMs: number;
  modelFallbackChain: CognitiveDispatchOptions["modelFallbackChain"];
}): CognitiveDispatchOptions {
  return {
    attentionDb: input.attentionDb,
    route: input.route,
    maxTokens: input.maxTokens,
    lane: "interactive",
    purpose: "expression",
    logicalRole: "expression",
    deadlineAtMs: input.deadlineAtMs,
    modelFallbackChain: input.modelFallbackChain,
  };
}

export type LiveExpressionAdapter = NonNullable<KernelDeps["adaptExpression"]>;

export function createLiveExpressionAdapter(
  options: LiveExpressionBindingOptions,
): LiveExpressionAdapter {
  const complete = options.completeChat ?? productionCompleteChat;
  const nowMs = options.nowMs ?? (() => Date.now());

  return async (input: ExpressionAdapterInput): Promise<string> => {
    const envelope = expressionEnvelope();
    const deadlineAtMs = nowMs() + envelope.deadlineMs;
    const chainId = newCorrelationId();
    const promptCompletion = async (prompt: string): Promise<string> => {
      const primary = createModelFallbackChain({
        chainId,
        invocationOrdinal: 1,
        fallbackFromInvocationId: null,
        fallbackClass: "none",
      });
      try {
        const result = await complete(
          [{ role: "user", content: prompt }],
          dispatchOptions({
            attentionDb: options.attentionDb,
            route: "ashley_expression",
            maxTokens: envelope.maxTokens,
            deadlineAtMs,
            modelFallbackChain: primary,
          }),
        );
        return result.text;
      } catch (error) {
        if (!fallbackAllowed(error, deadlineAtMs, nowMs)) throw error;
        const primaryInvocationId =
          metadataFromError(error)?.receipt.invocationId ??
          `unresolved:${chainId}:primary`;
        const fallback = createModelFallbackChain({
          chainId,
          invocationOrdinal: 2,
          fallbackFromInvocationId: primaryInvocationId,
          fallbackClass: "model_substitution",
        });
        const result = await complete(
          [{ role: "user", content: prompt }],
          dispatchOptions({
            attentionDb: options.attentionDb,
            route: "ashley_expression_fallback",
            maxTokens: envelope.maxTokens,
            deadlineAtMs,
            modelFallbackChain: fallback,
          }),
        );
        return result.text;
      }
    };

    return adaptExpression(input, { complete: promptCompletion });
  };
}

export function createLiveExpressionBinding(
  options: LiveExpressionBindingOptions,
): Pick<KernelDeps, "expressionEnabled" | "adaptExpression"> {
  return {
    expressionEnabled: true,
    adaptExpression: createLiveExpressionAdapter(options),
  };
}
