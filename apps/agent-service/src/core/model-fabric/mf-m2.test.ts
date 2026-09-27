import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { completeChat, resetAdapterCache, MISTRAL_RETRY_CONFIG } from "../../mistral-client.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import * as nimAdapterModule from "../model-routing/adapters/nim-adapter.js";
import * as mistralAdapterModule from "../model-routing/adapters/mistral-adapter.js";
import * as cloudflareAdapterModule from "../model-routing/adapters/cloudflare-adapter.js";
import * as commandCodeAdapterModule from "../model-routing/adapters/command-code-adapter.js";
import { commandCodeRequestWireAdditionalBytes } from "../model-routing/adapters/command-code-adapter.js";
import type { ProviderCompletion, ProviderDispatchArgs } from "../model-routing/types.js";
import { routingStatus } from "../model-routing/status.js";
import { thoughtOutputStructuredRequest } from "../cognitive-v021/thought/output-contract.js";
import {
  currentPortfolio,
  resetCurrentPortfolioForTests,
  resolveCurrentPolicy,
  routeRecordsFromCurrentPortfolio,
} from "./portfolio.js";
import {
  resolveDispatchContract,
  THOUGHT_OUTPUT_CONTRACT_ID,
  THOUGHT_OUTPUT_SCHEMA_ID,
} from "./dispatch-contract.js";
import { capabilityProfileFor } from "./profiles.js";

const originalNimKey = env.nimApiKey;
const originalMistralKey = env.mistralApiKey;
const originalCloudflareToken = env.cloudflareApiToken;
const originalCloudflareAccount = env.cloudflareAccountId;
const originalCommandCodeKey = env.commandCodeApiKey;
const THOUGHT_MODEL = "meta/muse-spark-1.3-contributor";
const THOUGHT_EFFORT = "xhigh";

function responseHash(text: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

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
    absoluteDeadlineAtMs: Date.now() + 30_000,
  };
}

function mockCommandCodeDispatch(
  text = "{}",
): ReturnType<typeof vi.fn> {
  const dispatch = vi.fn(async (args: ProviderDispatchArgs): Promise<ProviderCompletion> => ({
    text,
    providerModel: args.modelId,
    providerRequestId: "cc-mf-m2",
    providerHttpStatus: 200,
    providerRequestHash: "sha256:request",
    providerResponseHash: responseHash(text),
    usage: { promptTokens: 1, completionTokens: 1 },
    finishReason: "stop",
  }));
  vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
    provider: "command_code",
    dispatch,
  } as never);
  return dispatch;
}

afterEach(() => {
  env.nimApiKey = originalNimKey;
  env.mistralApiKey = originalMistralKey;
  env.cloudflareApiToken = originalCloudflareToken;
  env.cloudflareAccountId = originalCloudflareAccount;
  env.commandCodeApiKey = originalCommandCodeKey;
  resetAdapterCache();
  resetCurrentPortfolioForTests();
  vi.restoreAllMocks();
});

describe("MF-M2 CURRENT portfolio", () => {
  it("loads a complete hashed CURRENT snapshot without incomplete-fixture state", () => {
    const portfolio = currentPortfolio();
    expect(portfolio.kind).toBe("current_compatibility");
    expect(portfolio.incompleteFixture).not.toBe(true);
    expect(portfolio.registryVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(portfolio.rows).toHaveLength(9);
    expect(portfolio.rows.map((row) => `${row.logicalRole}:${row.occupancyKey}`)).toEqual(
      expect.arrayContaining([
        "thought:interactive",
        "thought:durable_proactive",
        "thought_observation:default",
        "expression:default",
        "reflection_initiative:default",
        "exchange_cognition:default",
        "curiosity_consolidation:default",
        "engineering:direct_cognition",
        "maintenance:default",
      ]),
    );
  });

  it("keeps both CURRENT Thought occupants on the Command Code Muse xhigh control", () => {
    const interactive = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
    });
    const durable = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "exchange_cognition",
    });

    expect(interactive.policyRow.reasoningPolicy).toBe("max_supported");
    expect(interactive.occupant.reasoningPolicy).toBe("max_supported");
    expect(interactive.occupant.effectiveReasoning).toBe("xhigh");
    expect(durable.policyRow.occupancyKey).toBe("durable_proactive");
    expect(durable.occupant.effectiveReasoning).toBe("xhigh");
    expect(interactive.registryVersion).toBe(currentPortfolio().registryVersion);
  });

  it("preserves configured-versus-dispatched observation and reflection scars", () => {
    const observation = resolveCurrentPolicy({
      logicalRole: "thought_observation",
      purpose: "thought_observation",
      lane: "exchange_cognition",
      routeId: "thought",
    });
    const reflection = resolveCurrentPolicy({
      logicalRole: "reflection_initiative",
      purpose: "thought_observation",
      lane: "exchange_cognition",
      routeId: "thought",
      model: env.mistralModel,
    });

    expect(observation.configuredRouteId).toBe("utility_bulk");
    expect(observation.dispatchedRouteId).toBe("thought");
    expect(reflection.configuredRouteId).toBe("utility_bulk");
    expect(reflection.dispatchedRouteId).toBe("thought");
    expect(reflection.modelOverride).toBe(env.mistralModel);
  });

  it("records engineering specialist requirements without selecting a specialist row", () => {
    const engineering = resolveCurrentPolicy({
      logicalRole: "engineering",
      purpose: "expression",
      lane: "interactive",
      specialistRequirement: { seat: "complex_orchestration" },
    });

    expect(engineering.policyRow.occupancyKey).toBe("direct_cognition");
    expect(engineering.dispatchedRouteId).toBe("ashley_expression");
    expect(engineering.occupant.provider).toBe("nim");
    expect(engineering.specialistRequirement).toEqual({ seat: "complex_orchestration" });
  });

  it("projects route enablement and quota contracts from CURRENT rather than models.json", () => {
    const records = routeRecordsFromCurrentPortfolio();
    expect(records.find((record) => record.route === "thought")).toMatchObject({
      provider: "command_code",
      configuredModelId: "meta/muse-spark-1.3-contributor",
      enabled: true,
      quotaContract: {
        tpm: 524288,
      },
    });
    expect(records.find((record) => record.route === "sandbox_operator_light")).toMatchObject({
      enabled: false,
    });
  });

  it("uses the CURRENT resolver in completeChat and records the snapshot identity", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = mockCommandCodeDispatch("{\"kind\":\"speak\"}");
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    const policy = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
    });
    const result = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: database,
      purpose: "thought",
      route: "thought",
      lane: "interactive",
      directCommandCodeThought: true,
      structuredOutput: thoughtOutputStructuredRequest(),
      thoughtInvocationContext: thoughtContext("mf-m2-snapshot"),
    } as never));
    expect(policy).toMatchObject({
      portfolioRevisionId: "mfp_current_compatibility_v6",
      policyRow: { policyRowId: "mfr_thought_interactive_compat_v1" },
      occupant: {
        occupantId: "mfo_command_code_muse_spark_1_3_contributor_xhigh",
        provider: "command_code",
        configuredModelId: THOUGHT_MODEL,
      },
    });
    expect(policy.registryVersion).toBe(currentPortfolio().registryVersion);
    expect(result.modelFabric).toBeUndefined();
    expect(result.commandCodeEvidence).toMatchObject({
      backend: "command_code_api",
      requestedModelId: THOUGHT_MODEL,
      providerModel: THOUGHT_MODEL,
      reasoningEffort: THOUGHT_EFFORT,
      providerAttempts: 1,
      alternateProviderAttempts: 0,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const row = database.prepare(
      `SELECT provider_id, model_alias, quota_bucket, outcome
         FROM attention_requests ORDER BY id DESC LIMIT 1`,
    ).get() as Record<string, unknown>;
    expect(row).toMatchObject({
      provider_id: "command_code",
      model_alias: THOUGHT_MODEL,
      quota_bucket: `command_code:${THOUGHT_MODEL}`,
      outcome: "completed",
    });
    database.close();
  });

  it("uses the CURRENT Thought policy ceiling when the caller omits maxTokens", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = mockCommandCodeDispatch();
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: database,
      purpose: "thought",
      route: "thought",
      lane: "interactive",
      directCommandCodeThought: true,
      structuredOutput: thoughtOutputStructuredRequest(),
      thoughtInvocationContext: thoughtContext("mf-m2-ceiling"),
    } as never));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      modelId: THOUGHT_MODEL,
      options: expect.objectContaining({ maxTokens: 65536, reasoningEffort: THOUGHT_EFFORT }),
    }));
    database.close();
  });

  it("uses the resolved Thought ceiling for structured-output admission and provider dispatch", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = mockCommandCodeDispatch();
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    const structuredOutput = thoughtOutputStructuredRequest();
    const schemaFingerprint = structuredOutput.schemaFingerprint;
    const result = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: database,
      purpose: "thought",
      route: "thought",
      lane: "interactive",
      directCommandCodeThought: true,
      responseFormat: "json_schema",
      structuredOutput,
      thoughtInvocationContext: thoughtContext("mf-m2-structured"),
    } as never));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        maxTokens: 65536,
        responseFormat: "json_schema",
        structuredOutput,
      }),
    }));
    const dispatched = dispatch.mock.calls[0]?.[0] as ProviderDispatchArgs;
    expect(commandCodeRequestWireAdditionalBytes(dispatched)).toBeGreaterThan(0);
    expect(schemaFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.modelFabric).toBeUndefined();
    expect(result.commandCodeEvidence).toMatchObject({
      requestedModelId: THOUGHT_MODEL,
      reasoningEffort: THOUGHT_EFFORT,
    });
    expect(result.capturedAttemptIdentity).toMatchObject({
      provider: "command_code",
      semanticSchemaFingerprint: schemaFingerprint,
      schemaEnforcementMode: "json_object_compatibility",
      actualWireBindingId: `${THOUGHT_OUTPUT_CONTRACT_ID}:${THOUGHT_OUTPUT_SCHEMA_ID}`,
    });
    expect(database.prepare(
      "SELECT estimated_output_tokens AS estimatedOutputTokens FROM attention_requests ORDER BY id DESC LIMIT 1",
    ).get()).toMatchObject({ estimatedOutputTokens: 65536 });
    database.close();
  });

  it("keeps the durable Thought ceiling separate from interactive policy", () => {
    const durable = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "background",
    });
    const interactive = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
    });

    expect(interactive.policyRow.maxOutputTokens).toBe(65536);
    expect(interactive.policyRow.deadlineMs).toBe(3600000);
    expect(durable.policyRow.maxOutputTokens).toBe(65536);
    expect(durable.policyRow.deadlineMs).toBeNull();
  });

  it("rejects a Thought caller ceiling above policy before attention/provider dispatch", async () => {
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-account";
    const dispatch = vi.fn();
    vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter").mockReturnValue({
      provider: "cloudflare",
      dispatch,
    });
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    await expect(
      completeChat([{ role: "user", content: "think" }], {
        attentionDb: database,
        purpose: "thought",
        lane: "interactive",
        responseFormat: "json_object",
        maxTokens: 65537,
      }),
    ).rejects.toMatchObject({ code: "model_fabric_output_budget_exceeded" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(database.prepare("SELECT COUNT(*) AS count FROM attention_requests").get()).toMatchObject({ count: 0 });
    database.close();
  });

  it("reconciles Thought policy with provider capability ceilings without widening unrelated routes", () => {
    expect(capabilityProfileFor("nim", "openai/gpt-oss-20b").limits.maxOutputTokens).toBeGreaterThanOrEqual(4096);
    expect(capabilityProfileFor("groq", "openai/gpt-oss-20b").limits.maxOutputTokens).toBeGreaterThanOrEqual(4096);
    expect(capabilityProfileFor("mistral", "mistral-medium-latest").limits.maxOutputTokens).toBe(2048);

    const interactive = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
    });
    expect(resolveDispatchContract({
      policy: interactive,
      provider: "cloudflare",
      configuredModelId: "@cf/zai-org/glm-5.3-flash",
    }).maxTokens).toBe(65536);

    const policyAboveProfile = {
      ...interactive,
      policyRow: { ...interactive.policyRow, maxOutputTokens: 8192 },
    };
    expect(() => resolveDispatchContract({
      policy: policyAboveProfile,
      provider: "mistral",
      configuredModelId: "mistral-medium-latest",
    })).toThrow("model_fabric_capability_output_budget_exceeded");
  });

  it("pins Mistral SDK retries off", () => {
    expect(MISTRAL_RETRY_CONFIG).toEqual({ strategy: "none" });
  });

  it("projects CURRENT identity and compatibility predicates through routing status", () => {
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    const thought = routingStatus(database).find((route) => route.route === "thought");
    expect(thought?.fabric).toMatchObject({
      portfolioRevisionId: "mfp_current_compatibility_v6",
      registryVersion: currentPortfolio().registryVersion,
    });
    expect(thought?.fabric.policyRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyRowId: "mfr_thought_interactive_compat_v1",
          occupantId: "mfo_command_code_muse_spark_1_3_contributor_xhigh",
          admissionBasis: expect.objectContaining({ kind: "existing_compatibility" }),
          activeActivationRefId: "compatibility_default",
          health: expect.objectContaining({
            qualified: true,
            ownerApproved: "not_required",
            active: true,
          }),
        }),
      ]),
    );
    database.close();
  });
});
