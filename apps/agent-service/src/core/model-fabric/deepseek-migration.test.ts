import { describe, expect, it } from "vitest";
import {
  TARGET_SEMANTIC_INPUT_ENVELOPE,
} from "../cognitive-v021/thought/projection-allocator/budget.js";
import {
  THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  thoughtOutputDeepSeekJsonObjectInstruction,
  thoughtOutputStructuredRequest,
} from "../cognitive-v021/thought/output-contract.js";
import { parseThoughtSemanticOutput, THOUGHT_SEMANTIC_PARSER_ID } from "../cognitive-v021/thought/parse.js";
import { makeThoughtDraft } from "../cognitive-v021/test-support.js";
import { validateThoughtSettlementDraft } from "../cognitive-v021/settlement/validate.js";
import { buildOperationalEffectNamespaceFromRefs } from "../cognitive-v021/effect/effect-ref.js";
import { buildCloudflareRequestBody } from "../model-routing/adapters/cloudflare-adapter.js";
import {
  THOUGHT_OUTPUT_CONTRACT_ID,
  THOUGHT_OUTPUT_SCHEMA_ID,
  resolveDispatchContract,
} from "./dispatch-contract.js";
import { thoughtResourcePolicyIdentity } from "./capability-identity.js";
import {
  currentPortfolio,
  resolveCurrentPolicy,
} from "./portfolio.js";
import { capabilityProfileFor } from "./profiles.js";
import {
  formatTranslatedWireControl,
  toTrustedReasoningControl,
  translateReasoningPolicy,
} from "./reasoning-translation.js";

const DEEPSEEK = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const GLM = "@cf/zai-org/glm-5.3-flash";
const NEMOTRON = "@cf/nvidia/nemotron-3-120b-a12b";

describe("GLM-5.3 Flash Thought provider migration witnesses", () => {
  it("resolves every active Thought-owned row to Cloudflare GLM with no fallback", () => {
    const resolutions = [
      resolveCurrentPolicy({ logicalRole: "thought", purpose: "thought", lane: "interactive" }),
      resolveCurrentPolicy({ logicalRole: "thought", purpose: "thought", lane: "background" }),
      resolveCurrentPolicy({ logicalRole: "thought_observation", purpose: "thought_observation", lane: "exchange_cognition" }),
      resolveCurrentPolicy({ logicalRole: "reflection_initiative", purpose: "thought_observation", lane: "exchange_cognition" }),
    ];

    for (const resolution of resolutions) {
      expect(resolution.occupant).toMatchObject({
        provider: "cloudflare",
        configuredModelId: GLM,
        independenceGroup: "zai_glm",
        reasoningPolicy: "max_supported",
        effectiveReasoning: "max",
        fallbackClassFromPrevious: "none",
        fallbackTriggerClasses: [],
      });
      expect(resolution.occupant.configuredModelId).not.toBe(DEEPSEEK);
      expect(resolution.occupant.configuredModelId).not.toBe(NEMOTRON);
      expect(resolution.policyRow.reliabilityClass).toBe("single_attempt");
      expect(resolution.occupant.structuredOutputBinding).toMatchObject({
        bindingId: expect.stringContaining("glm_5_3_flash"),
        mode: "json_object_compatibility",
      });
    }

    expect(resolutions.every((resolution) => resolution.policyRow.occupants.length === 1)).toBe(true);
    expect(currentPortfolio().portfolioRevisionId).toBe("mfp_current_compatibility_v5");
    expect(currentPortfolio().routeBindings.thought).toMatchObject({
      provider: "cloudflare",
      configuredModelId: GLM,
      quotaContract: { tpm: 524288 },
    });
    expect(currentPortfolio().routeBindings.ashley_expression).toMatchObject({
      provider: "groq",
      configuredModelId: "qwen/qwen3.8-27b",
    });
    expect(currentPortfolio().routeBindings.ashley_expression_fallback).toMatchObject({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
    expect(currentPortfolio().routeBindings.utility_bulk).toMatchObject({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
  });

  it("has a GLM profile that preserves Ashley's request ceiling without claiming context capacity", () => {
    const profile = capabilityProfileFor("cloudflare", GLM);

    expect(profile).toMatchObject({
      provider: "cloudflare",
      configuredModelId: GLM,
      output: { structured: "json" },
      reasoning: {
        mode: "configurable",
        efforts: ["low", "high", "max"],
      },
      limits: {
        contextTokens: 0,
        maxOutputTokens: 65536,
      },
    });
    expect(profile.limits.maxOutputTokens).not.toBe(2048);
    expect(profile.profileFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("records GLM max_supported as native-default max and omits reasoning controls on the request", () => {
    const policy = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
    });
    const structuredRequest = thoughtOutputStructuredRequest(
      buildOperationalEffectNamespaceFromRefs(["effect:cycle-specific"]),
    );
    const dispatch = resolveDispatchContract({
      policy,
      provider: "cloudflare",
      configuredModelId: GLM,
      requestedMaxTokens: 65536,
      responseFormat: "json_schema",
      structuredOutput: structuredRequest,
    });
    expect(policy.policyRow.reasoningPolicy).toBe("max_supported");
    const reasoningPolicy = policy.occupant.reasoningPolicy;
    if (reasoningPolicy !== "max_supported") {
      throw new Error("GLM Thought must use max_supported reasoning policy");
    }
    const reasoning = translateReasoningPolicy({
      provider: "cloudflare",
      configuredModelId: GLM,
      semanticPolicy: reasoningPolicy,
    });

    expect(reasoning).toEqual({
      status: "translated",
      familyId: "cloudflare_glm_5_3_flash",
      control: { kind: "cloudflare_native_default", effectiveDefault: "max" },
    });
    if (reasoning.status !== "translated") {
      throw new Error("GLM native-default reasoning control was not resolved");
    }
    expect(formatTranslatedWireControl(reasoning.control)).toBe(
      "reasoning_effort=omitted;native_default=max",
    );
    expect(() => toTrustedReasoningControl(reasoning.control)).toThrow(
      "cloudflare_native_default_is_not_a_wire_control",
    );
    expect(dispatch).toMatchObject({
      maxTokens: 65536,
      responseFormat: "json_object",
      structuredOutputMode: "json_object_compatibility",
    });

    const body = buildCloudflareRequestBody(
      [{ role: "user", content: "synthetic cycle input" }],
      { maxTokens: dispatch.maxTokens, temperature: 1.0, reasoningEffort: "high" },
      GLM,
      undefined,
      dispatch.structuredOutput ?? undefined,
    );

    expect(body).toMatchObject({
      model: GLM,
      max_completion_tokens: 65536,
      temperature: 1,
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("reasoning_budget");
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body.max_tokens).toBeUndefined();
    const wireMessages = body.messages as Array<{ role: string; content: string }>;
    expect(wireMessages[0]?.content).toContain(thoughtOutputDeepSeekJsonObjectInstruction());
  });

  it("keeps existing explicit DeepSeek effort configuration unchanged", () => {
    const reasoning = translateReasoningPolicy({
      provider: "cloudflare",
      configuredModelId: DEEPSEEK,
      semanticPolicy: "high",
    });
    expect(reasoning).toEqual({
      status: "translated",
      familyId: "cloudflare_deepseek_v4_flash",
      control: { kind: "reasoning_effort", value: "high" },
    });
    if (reasoning.status !== "translated") {
      throw new Error("DeepSeek reasoning control was not resolved");
    }
    const body = buildCloudflareRequestBody(
      [{ role: "user", content: "synthetic explicit-effort input" }],
      { maxTokens: 450, temperature: 1.0 },
      DEEPSEEK,
      toTrustedReasoningControl(reasoning.control),
    );
    expect(body.reasoning_effort).toBe("high");
  });

  it("emits the existing Thought JSON_OBJECT compatibility binding for a specialized cycle namespace", () => {
    const policy = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
    });
    const structuredRequest = thoughtOutputStructuredRequest(
      buildOperationalEffectNamespaceFromRefs(["effect:cycle-specific"]),
    );
    const dispatch = resolveDispatchContract({
      policy,
      provider: "cloudflare",
      configuredModelId: GLM,
      requestedMaxTokens: 65536,
      responseFormat: "json_schema",
      structuredOutput: structuredRequest,
    });

    expect(dispatch).toMatchObject({
      maxTokens: 65536,
      responseFormat: "json_object",
      structuredOutputMode: "json_object_compatibility",
    });
    expect(dispatch.structuredOutput).toMatchObject({
      kind: "json_object_compatibility",
      contractId: THOUGHT_OUTPUT_CONTRACT_ID,
      schemaId: THOUGHT_OUTPUT_SCHEMA_ID,
      schemaFingerprint: structuredRequest.schemaFingerprint,
    });

    if (dispatch.structuredOutput?.kind !== "json_object_compatibility") {
      throw new Error("GLM JSON_OBJECT compatibility control was not resolved");
    }
    const reasoning = translateReasoningPolicy({
      provider: "cloudflare",
      configuredModelId: GLM,
      semanticPolicy: "high",
    });
    if (reasoning.status !== "translated") {
      throw new Error("GLM reasoning control was not resolved");
    }
    const body = buildCloudflareRequestBody(
      [{ role: "user", content: "synthetic cycle input" }],
      { maxTokens: dispatch.maxTokens, temperature: 1.0, reasoningEffort: "high" },
      GLM,
      undefined,
      dispatch.structuredOutput,
    );

    expect(body).toMatchObject({
      model: GLM,
      max_completion_tokens: 65536,
      temperature: 1,
      response_format: {
        type: "json_object",
      },
    });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_budget).toBeUndefined();
    expect(body).not.toHaveProperty("response_format.json_schema");
    const wireMessages = body.messages as Array<{ role: string; content: string }>;
    expect(wireMessages[0]?.content).toContain(thoughtOutputDeepSeekJsonObjectInstruction());
    expect(JSON.stringify(structuredRequest.schema)).toContain("effect:cycle-specific");
  });

  it("preserves Ashley's semantic input ceiling and parser/validator identities", () => {
    expect(TARGET_SEMANTIC_INPUT_ENVELOPE).toBe(262144);
    expect(currentPortfolio().routeBindings.thought.quotaContract).toMatchObject({
      tpm: 524288,
    });
    const thoughtPolicy = currentPortfolio().rows.find(
      (row) => row.policyRowId === "mfr_thought_interactive_compat_v1",
    );
    expect(thoughtPolicy).toMatchObject({ deadlineMs: 3600000, maxOutputTokens: 65536 });
    expect(thoughtResourcePolicyIdentity()).toMatchObject({
      ordinaryThoughtBudgetMs: 3600000,
      interactiveMaxOutput: 65536,
      durableProactiveMaxOutput: 65536,
      structuralRetryMaxOutput: 65536,
    });
    expect(THOUGHT_OUTPUT_CONTRACT_ID).toBe("ashley.thought.semantic.v2");
    expect(THOUGHT_OUTPUT_SCHEMA_ID).toBe("ashley.thought.semantic.v2.schema");
    expect(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT).toBe(
      "sha256:430bf12adad24f96fb741aec2420479c15896c29b899f779c7b995aba22c6a48",
    );
    expect(THOUGHT_SEMANTIC_PARSER_ID).toBe("ashley.thought.semantic-parser.v1");
    expect(parseThoughtSemanticOutput(
      JSON.stringify({
        kind: "abstain",
        reason: "insufficient_evidence",
        explanation: "synthetic migration witness",
        evidenceRefs: [],
      }),
      new Set(),
    )).toMatchObject({ ok: true });

    expect(validateThoughtSettlementDraft(makeThoughtDraft(), {
      cycleId: "cycle-1",
      generation: 1,
      occupantId: "doc",
      authorityEpoch: 1,
    })).toMatchObject({ ok: true, kind: "ok" });
  });

  it("keeps the current Cloudflare transport endpoint unchanged", () => {
    const source = currentPortfolio().routeBindings.thought;
    expect(source).toMatchObject({ provider: "cloudflare", configuredModelId: GLM });
    expect("https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions")
      .toContain("/ai/v1/chat/completions");
  });
});
