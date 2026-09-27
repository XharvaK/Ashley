import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { openNuclearDb } from "../db.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import {
  completeChat,
  resetAdapterCache,
} from "../../mistral-client.js";
import * as mistralAdapterModule from "../model-routing/adapters/mistral-adapter.js";
import * as groqAdapterModule from "../model-routing/adapters/groq-adapter.js";
import * as nimAdapterModule from "../model-routing/adapters/nim-adapter.js";
import * as cloudflareAdapterModule from "../model-routing/adapters/cloudflare-adapter.js";
import * as commandCodeAdapterModule from "../model-routing/adapters/command-code-adapter.js";
import { COMMAND_CODE_POLICY } from "../command-code/policy.js";
import { resolveCurrentPolicy } from "./portfolio.js";
import { attachProviderHttpStatusBoundary } from "../model-routing/types.js";
import {
  capabilityProfileFor,
  createContextProjection,
  createInferencePolicyFingerprint,
  createModelFallbackChain,
  normalizeReasoningPolicy,
  type ModelFabricDispatchMetadata,
  type ModelProviderResponseReceipt,
} from "./index.js";
import { thoughtOutputStructuredRequest } from "../cognitive-v021/thought/output-contract.js";

const savedKeys = {
  mistral: env.mistralApiKey,
  groq: env.groqApiKey,
  nim: env.nimApiKey,
  cloudflareToken: env.cloudflareApiToken,
  cloudflareAccount: env.cloudflareAccountId,
  commandCode: env.commandCodeApiKey,
};

afterEach(() => {
  env.mistralApiKey = savedKeys.mistral;
  env.groqApiKey = savedKeys.groq;
  env.nimApiKey = savedKeys.nim;
  env.cloudflareApiToken = savedKeys.cloudflareToken;
  env.cloudflareAccountId = savedKeys.cloudflareAccount;
  resetAdapterCache();
  vi.restoreAllMocks();
});

function thoughtContext(invocationId: string) {
  return {
    invocationId,
    cycleId: `cycle:${invocationId}`,
    generation: 1,
    semanticPass: 1,
    structuralAttemptOrdinal: 0,
    authorityEpoch: 1,
    authorityVersionVector: { nuclear: 1 },
    triggerRef: `trigger:${invocationId}`,
    semanticProjectionHash: "sha256:semantic",
    dispatchMessagesHash: "sha256:messages",
    allowlistFingerprint: "sha256:allowlist",
    absoluteDeadlineAtMs: Date.now() + 60_000,
  };
}

function db(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function fabricMetadata(
  value: unknown,
): ModelFabricDispatchMetadata & {
  receipt: Extract<ModelFabricDispatchMetadata["receipt"], { receiptStage: "resolved" }>;
} {
  const metadata = (value as { modelFabric?: unknown }).modelFabric;
  if (!metadata) throw new Error("missing_model_fabric_metadata");
  return metadata as ModelFabricDispatchMetadata & {
    receipt: Extract<ModelFabricDispatchMetadata["receipt"], { receiptStage: "resolved" }>;
  };
}

describe("MF-M1 pure contract seam", () => {
  it("creates stable mechanical capability identity without qualification meaning", () => {
    const first = capabilityProfileFor("groq", "openai/gpt-oss-20b");
    const second = capabilityProfileFor("groq", "openai/gpt-oss-20b");

    expect(first).toEqual(second);
    expect(first.profileFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.provider).toBe("groq");
    expect(first.configuredModelId).toBe("openai/gpt-oss-20b");
    expect("qualification" in first).toBe(false);
    expect("promotion" in first).toBe(false);
  });

  it("normalizes current wire reasoning without changing the requested policy", () => {
    expect(normalizeReasoningPolicy("none")).toBe("disabled");
    expect(normalizeReasoningPolicy("low")).toBe("economical");
    expect(normalizeReasoningPolicy("medium")).toBe("standard");
    expect(normalizeReasoningPolicy("high")).toBe("high");
    expect(normalizeReasoningPolicy(undefined)).toBe("standard");
  });

  it("fingerprints material inference settings and excludes prompt content", () => {
    const baseline = createInferencePolicyFingerprint({
      provider: "mistral",
      configuredModelId: "mistral-medium-latest",
      reasoningEffort: "medium",
      temperature: 0.2,
      maxTokens: 900,
      responseFormat: "json_object",
    });
    const changed = createInferencePolicyFingerprint({
      provider: "mistral",
      configuredModelId: "mistral-medium-latest",
      reasoningEffort: "high",
      temperature: 0.2,
      maxTokens: 900,
      responseFormat: "json_object",
    });

    expect(baseline).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(changed).not.toBe(baseline);
  });

  it("binds structured schema content to the inference-policy fingerprint", () => {
    const request = thoughtOutputStructuredRequest() as unknown as Record<string, unknown>;
    expect(request.schemaFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    const base = {
      provider: "nim",
      configuredModelId: "openai/gpt-oss-20b",
      reasoningEffort: "low",
      maxTokens: 4096,
      responseFormat: "json_object",
      structuredOutputContractId: "ashley.thought.step.v1",
      structuredOutputMode: "json_object_compatibility",
      structuredOutputBindingId: "compat_thought_nim_gpt_oss_20b_json_object_v1",
      structuredOutputSchemaFingerprint: request.schemaFingerprint,
    } as Parameters<typeof createInferencePolicyFingerprint>[0];
    const mutated = {
      ...base,
      structuredOutputSchemaFingerprint: `sha256:${"f".repeat(64)}`,
    } as Parameters<typeof createInferencePolicyFingerprint>[0];
    expect(createInferencePolicyFingerprint(mutated)).not.toBe(
      createInferencePolicyFingerprint(base),
    );
  });

  it("builds a frozen bounded projection with separate content and telemetry bindings", () => {
    const projection = createContextProjection({
      purpose: "expression",
      contextPolicyId: "full_expression",
      messages: [
        { role: "system", content: "system instruction" },
        { role: "user", content: "secret user content" },
      ],
    });

    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.parts)).toBe(true);
    expect(projection.parts).toHaveLength(2);
    expect(projection.parts.filter((part) => part.kind === "text")).toHaveLength(2);
    expect(projection.contentBinding.value).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(projection.telemetryFingerprint).toMatch(
      /^projection_structure_v1:[0-9a-f]{64}$/,
    );
    expect(projection.telemetryFingerprint).not.toContain("secret");
  });

  it("requires explicit caller-owned fallback-chain ordinals", () => {
    const primary = createModelFallbackChain({
      chainId: "expression-chain-1",
      invocationOrdinal: 1,
      fallbackFromInvocationId: null,
      fallbackClass: "none",
    });
    const fallback = createModelFallbackChain({
      chainId: primary.chainId,
      invocationOrdinal: 2,
      fallbackFromInvocationId: "invocation-1",
      fallbackClass: "model_substitution",
    });

    expect(primary).toMatchObject({
      chainId: "expression-chain-1",
      invocationOrdinal: 1,
      fallbackFromInvocationId: null,
      fallbackClass: "none",
    });
    expect(fallback).toMatchObject({
      chainId: "expression-chain-1",
      invocationOrdinal: 2,
      fallbackFromInvocationId: "invocation-1",
      fallbackClass: "model_substitution",
    });
  });
});

describe("MF-M1 completeChat receipts", () => {
  it("records the live Expression route as an existing-compatibility Groq invocation", async () => {
    env.groqApiKey = "test";
    const dispatch = vi.fn(async () => ({
      text: "hello",
      providerModel: "qwen/qwen3.8-27b",
      usage: { promptTokens: 3, completionTokens: 2 },
      finishReason: "stop",
    }));
    vi.spyOn(groqAdapterModule, "createGroqAdapter").mockReturnValue({
      provider: "groq",
      dispatch,
    });
    const database = db();

    const result = await withOfflineAppGateDisabled(() => completeChat(
      [{ role: "user", content: "hello" }],
      {
        attentionDb: database,
        purpose: "expression",
        route: "ashley_expression",
        logicalRole: "expression",
        reasoningEffort: "none",
      },
    ));
    const metadata = fabricMetadata(result);
    const receipt = metadata.receipt;

    expect(receipt.receiptStage).toBe("resolved");
    expect(receipt.logicalRole).toBe("expression");
    expect(receipt.requestedPurpose).toBe("expression");
    expect(receipt.configuredRouteId).toBe("ashley_expression");
    expect(receipt.finalDispatchedRouteId).toBe("ashley_expression");
    expect(receipt.fallbackChain).toBeNull();
    expect(receipt.attempts).toHaveLength(1);
    expect(receipt.attempts[0]).toMatchObject({
      receiptStage: "provider_response",
      dispatchTruth: "response_received",
      providerRequestCount: 1,
      provider: "groq",
      backend: "groq",
      configuredModelId: "qwen/qwen3.8-27b",
      requestedReasoningPolicy: "standard",
      effectiveReasoningSent: "reasoning_effort=medium;reasoning_format=hidden",
      translatedWireControl: "reasoning_effort=medium;reasoning_format=hidden",
      fallbackClass: "none",
      admissionBasis: { kind: "existing_compatibility" },
    });
    expect((receipt.attempts[0] as ModelProviderResponseReceipt).usage).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
      providerReported: true,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    database.close();
  });

  it("records the current Thought route as a single Command Code attempt", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatchText = "thought";
    const dispatch = vi.fn(async (args: { modelId: string }) => ({
      text: dispatchText,
      providerModel: args.modelId,
      providerRequestId: "mf-m1-thought-1",
      providerHttpStatus: 200,
      providerRequestHash: "sha256:request",
      providerResponseHash: `sha256:${createHash("sha256").update(dispatchText, "utf8").digest("hex")}`,
      usage: { promptTokens: 4, completionTokens: 5 },
      finishReason: "stop",
    }));
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch,
    } as never);
    const database = db();

    const result = await withOfflineAppGateDisabled(() => completeChat(
      [{ role: "user", content: "think" }],
      {
        attentionDb: database,
        purpose: "thought",
        route: "thought",
        directCommandCodeThought: true,
        logicalRole: "thought",
        structuredOutput: thoughtOutputStructuredRequest(),
        deadlineAtMs: Date.now() + 60_000,
        thoughtInvocationContext: thoughtContext("mf-m1-thought"),
      } as never,
    ));

    // CURRENT release truth: production Thought no longer routes through the
    // Model Fabric dispatch path, so no fabric receipt is emitted. The
    // single-attempt and no-fallback invariants are carried by the direct
    // Command Code boundary evidence instead.
    expect(result.modelFabric).toBeUndefined();
    expect(result.commandCodeEvidence).toMatchObject({
      backend: "command_code_api",
      providerModel: COMMAND_CODE_POLICY.modelId,
      requestedModelId: COMMAND_CODE_POLICY.modelId,
      reasoningEffort: COMMAND_CODE_POLICY.effort,
      providerAttempts: 1,
      alternateProviderAttempts: 0,
    });
    expect(result.providerBoundaryControls).toMatchObject({
      maxTokens: expect.any(Number),
      reasoningConfiguration: COMMAND_CODE_POLICY.effort,
      deadlineAtMs: expect.any(Number),
    });
    expect(result.providerBoundaryTiming).toMatchObject({
      requestStartedAtMs: expect.any(Number),
      responseAtMs: expect.any(Number),
      elapsedMs: expect.any(Number),
      outcome: "response_received",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    database.close();
  });

  it("keeps the configured utility scar on observation and fails Thought-owned non-Thought dispatch closed", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const commandCodeDispatch = vi.fn();
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch: commandCodeDispatch,
    } as never);
    const database = db();

    // The configured scar is still declared utility_bulk in CURRENT while the
    // dispatched Thought owner is Command Code. That distinction is a live
    // resolution fact and stays asserted.
    const configured = resolveCurrentPolicy({
      logicalRole: "thought_observation",
      purpose: "thought_observation",
      lane: "exchange_cognition",
    });
    expect(configured.configuredRouteId).toBe("utility_bulk");
    expect(configured.dispatchedRouteId).toBe("thought");
    expect(configured.occupant).toMatchObject({
      provider: "command_code",
      configuredModelId: COMMAND_CODE_POLICY.modelId,
      effectiveReasoning: COMMAND_CODE_POLICY.effort,
    });

    // CURRENT release truth: the Command Code adapter serves the Thought output
    // contract only. A Thought-owned purpose that is not a Thought turn cannot
    // reach the provider, and the refusal happens before transport.
    await expect(withOfflineAppGateDisabled(() => completeChat(
      [{ role: "user", content: "observe" }],
      {
        attentionDb: database,
        purpose: "thought_observation",
        route: "thought",
        logicalRole: "thought_observation",
        maxTokens: 450,
      },
    ))).rejects.toMatchObject({
      code: "capability_mismatch",
      message: "command_code_thought_contract_required",
    });
    expect(commandCodeDispatch).not.toHaveBeenCalled();
    database.close();
  });

  it("attaches a resolved-not-sent receipt when local provider readiness fails", async () => {
    env.groqApiKey = "";
    const database = db();
    let thrown: unknown;

    try {
      await withOfflineAppGateDisabled(() =>
        completeChat(
          [{ role: "user", content: "hello" }],
          {
            attentionDb: database,
            purpose: "expression",
            route: "ashley_expression",
            logicalRole: "expression",
          },
        ),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "agent_not_ready" });
    const metadata = fabricMetadata(thrown);
    expect(metadata.receipt.receiptStage).toBe("resolved");
    expect(metadata.receipt.attempts).toHaveLength(1);
    expect(metadata.receipt.attempts[0]).toMatchObject({
      receiptStage: "resolved_not_sent",
      dispatchTruth: "not_sent",
      providerRequestCount: 0,
      provider: "groq",
    });
    expect(metadata.failure).toMatchObject({
      dispatchTruth: "not_sent",
      code: "configuration_error",
    });
    database.close();
  });

  it("records a definitive provider HTTP failure as response_received", async () => {
    env.groqApiKey = "test";
    const providerError = new AppError("rate_limited", "Groq rate limited", 429, 30);
    attachProviderHttpStatusBoundary(providerError, 429);
    const dispatch = vi.fn(async () => {
      throw providerError;
    });
    vi.spyOn(groqAdapterModule, "createGroqAdapter").mockReturnValue({
      provider: "groq",
      dispatch,
    });
    const database = db();
    let thrown: unknown;

    try {
      await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "hello" }],
        {
          attentionDb: database,
          purpose: "expression",
          route: "ashley_expression",
          logicalRole: "expression",
        },
      ));
    } catch (error) {
      thrown = error;
    }

    const metadata = fabricMetadata(thrown);
    expect(metadata.receipt.attempts[0]).toMatchObject({
      receiptStage: "provider_response",
      dispatchTruth: "response_received",
      providerRequestCount: 1,
      errorClass: "rate_limited",
    });
    expect(metadata.failure).toMatchObject({
      code: "provider_quota",
      dispatchTruth: "response_received",
    });
    expect(metadata.providerBoundaryControls).toMatchObject({
      maxTokens: expect.any(Number),
    });
    expect(metadata.providerBoundaryTiming).toMatchObject({
      requestStartedAtMs: expect.any(Number),
      responseAtMs: expect.any(Number),
      elapsedMs: expect.any(Number),
      outcome: "error",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    database.close();
  });
});
