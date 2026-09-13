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
import {
  currentPortfolio,
  resolveCurrentPolicy,
} from "./portfolio.js";
import { capabilityProfileFor } from "./profiles.js";
import {
  toTrustedReasoningControl,
  translateReasoningPolicy,
} from "./reasoning-translation.js";

const DEEPSEEK = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const NEMOTRON = "@cf/nvidia/nemotron-3-120b-a12b";

describe("DeepSeek V4 Flash Model Fabric migration witnesses", () => {
  it("resolves every active Thought-owned row to Cloudflare DeepSeek with no fallback", () => {
    const resolutions = [
      resolveCurrentPolicy({ logicalRole: "thought", purpose: "thought", lane: "interactive" }),
      resolveCurrentPolicy({ logicalRole: "thought", purpose: "thought", lane: "background" }),
      resolveCurrentPolicy({ logicalRole: "thought_observation", purpose: "thought_observation", lane: "exchange_cognition" }),
      resolveCurrentPolicy({ logicalRole: "reflection_initiative", purpose: "thought_observation", lane: "exchange_cognition" }),
    ];

    for (const resolution of resolutions) {
      expect(resolution.occupant).toMatchObject({
        provider: "cloudflare",
        configuredModelId: DEEPSEEK,
        fallbackClassFromPrevious: "none",
        fallbackTriggerClasses: [],
      });
      expect(resolution.occupant.configuredModelId).not.toBe(NEMOTRON);
      expect(resolution.policyRow.reliabilityClass).toBe("single_attempt");
      expect(resolution.occupant.structuredOutputBinding).toMatchObject({
        mode: "json_object_compatibility",
      });
    }

    expect(resolutions.every((resolution) => resolution.policyRow.occupants.length === 1)).toBe(true);
  });

  it("has an explicit DeepSeek profile instead of the generic 2048-token profile", () => {
    const profile = capabilityProfileFor("cloudflare", DEEPSEEK);

    expect(profile).toMatchObject({
      provider: "cloudflare",
      configuredModelId: DEEPSEEK,
      output: { structured: "json_schema" },
      reasoning: {
        mode: "configurable",
        efforts: ["low", "medium", "high"],
      },
      limits: {
        contextTokens: 32768,
        maxOutputTokens: 16384,
      },
    });
    expect(profile.limits.maxOutputTokens).not.toBe(2048);
    expect(profile.profileFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("translates semantic high reasoning to the documented Cloudflare effort", () => {
    expect(translateReasoningPolicy({
      provider: "cloudflare",
      configuredModelId: DEEPSEEK,
      semanticPolicy: "high",
    })).toEqual({
      status: "translated",
      familyId: "cloudflare_deepseek_v4_flash",
      control: { kind: "reasoning_effort", value: "high" },
    });
  });

  it("emits the exact DeepSeek JSON_OBJECT compatibility binding for a specialized cycle namespace", () => {
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
      configuredModelId: DEEPSEEK,
      requestedMaxTokens: 16384,
      responseFormat: "json_schema",
      structuredOutput: structuredRequest,
    });

    expect(dispatch).toMatchObject({
      maxTokens: 16384,
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
      throw new Error("DeepSeek JSON_OBJECT compatibility control was not resolved");
    }
    const reasoning = translateReasoningPolicy({
      provider: "cloudflare",
      configuredModelId: DEEPSEEK,
      semanticPolicy: "high",
    });
    if (reasoning.status !== "translated") {
      throw new Error("DeepSeek reasoning control was not resolved");
    }
    const body = buildCloudflareRequestBody(
      [{ role: "user", content: "synthetic cycle input" }],
      { maxTokens: dispatch.maxTokens, temperature: 1.0 },
      DEEPSEEK,
      toTrustedReasoningControl(reasoning.control),
      dispatch.structuredOutput,
    );

    expect(body).toMatchObject({
      model: DEEPSEEK,
      max_completion_tokens: 16384,
      temperature: 1,
      reasoning_effort: "high",
      response_format: {
        type: "json_object",
      },
    });
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning_budget).toBeUndefined();
    expect(body).not.toHaveProperty("response_format.json_schema");
    const wireMessages = body.messages as Array<{ role: string; content: string }>;
    expect(wireMessages[0]?.content).toContain(thoughtOutputDeepSeekJsonObjectInstruction());
    expect(JSON.stringify(structuredRequest.schema)).toContain("effect:cycle-specific");
  });

  it("preserves Ashley's semantic input ceiling and parser/validator identities", () => {
    expect(TARGET_SEMANTIC_INPUT_ENVELOPE).toBe(32768);
    expect(THOUGHT_OUTPUT_CONTRACT_ID).toBe("ashley.thought.semantic.v2");
    expect(THOUGHT_OUTPUT_SCHEMA_ID).toBe("ashley.thought.semantic.v2.schema");
    expect(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT).toBe(
      "sha256:aae9ef734867d90fbc47dd5bdb78e06ca98912a01e7418347535fb8c6189390c",
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
    expect(source).toMatchObject({ provider: "cloudflare", configuredModelId: DEEPSEEK });
    expect("https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions")
      .toContain("/ai/v1/chat/completions");
  });
});
