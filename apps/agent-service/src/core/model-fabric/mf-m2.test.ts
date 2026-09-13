import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { completeChat, resetAdapterCache, MISTRAL_RETRY_CONFIG } from "../../mistral-client.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import * as nimAdapterModule from "../model-routing/adapters/nim-adapter.js";
import * as mistralAdapterModule from "../model-routing/adapters/mistral-adapter.js";
import * as cloudflareAdapterModule from "../model-routing/adapters/cloudflare-adapter.js";
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

afterEach(() => {
  env.nimApiKey = originalNimKey;
  env.mistralApiKey = originalMistralKey;
  env.cloudflareApiToken = originalCloudflareToken;
  env.cloudflareAccountId = originalCloudflareAccount;
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

  it("keeps both CURRENT Thought occupants on high Cloudflare reasoning", () => {
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

    expect(interactive.policyRow.reasoningPolicy).toBe("high");
    expect(interactive.occupant.reasoningPolicy).toBe("high");
    expect(interactive.occupant.effectiveReasoning).toBe("high");
    expect(durable.policyRow.occupancyKey).toBe("durable_proactive");
    expect(durable.occupant.effectiveReasoning).toBe("high");
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
      provider: "cloudflare",
      configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      enabled: true,
      quotaContract: {
        tpm: 65536,
      },
    });
    expect(records.find((record) => record.route === "sandbox_operator_light")).toMatchObject({
      enabled: false,
    });
  });

  it("uses the CURRENT resolver in completeChat and records the snapshot identity", async () => {
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-account";
    vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter").mockReturnValue({
      provider: "cloudflare",
      dispatch: vi.fn().mockResolvedValue({
        text: "{\"kind\":\"speak\"}",
        providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
        usage: { promptTokens: 1, completionTokens: 1 },
        finishReason: "stop",
      }),
    });
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    const result = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: database,
      purpose: "thought",
      lane: "interactive",
      responseFormat: "json_object",
    }));
    expect(result.modelFabric?.resolvedRoute).toMatchObject({
      registryVersion: currentPortfolio().registryVersion,
      policyRowId: "mfr_thought_interactive_compat_v1",
      occupantId: "mfo_cloudflare_deepseek_v4_flash_high",
      provider: "cloudflare",
      configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    });
    database.close();
  });

  it("uses the CURRENT Thought policy ceiling when the caller omits maxTokens", async () => {
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-account";
    const dispatch = vi.fn().mockResolvedValue({
      text: "{}",
      providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: "stop",
    });
    vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter").mockReturnValue({
      provider: "cloudflare",
      dispatch,
    });
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: database,
      purpose: "thought",
      lane: "interactive",
      responseFormat: "json_object",
    }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ maxTokens: 16384 }),
    }));
    database.close();
  });

  it("uses the resolved Thought ceiling for structured-output admission and provider dispatch", async () => {
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-account";
    const dispatch = vi.fn().mockResolvedValue({
      text: "{}",
      providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: "stop",
    });
    vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter").mockReturnValue({
      provider: "cloudflare",
      dispatch,
    });
    const database = openNuclearDb(new DatabaseSync(":memory:"));
    const structuredOutput = thoughtOutputStructuredRequest();
    const schemaFingerprint = (structuredOutput as unknown as { schemaFingerprint?: string }).schemaFingerprint;
    const result = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: database,
      purpose: "thought",
      lane: "interactive",
      responseFormat: "json_schema",
      structuredOutput,
    }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        maxTokens: 16384,
        responseFormat: "json_object",
        structuredOutput,
      }),
      fabricStructuredOutput: expect.objectContaining({
        kind: "json_object_compatibility",
        contractId: THOUGHT_OUTPUT_CONTRACT_ID,
        schemaId: THOUGHT_OUTPUT_SCHEMA_ID,
        schemaFingerprint,
      }),
    }));
    expect(schemaFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.modelFabric?.receipt.attempts[0]).toMatchObject({
      structuredOutputSchemaFingerprint: schemaFingerprint,
    });
    expect(database.prepare(
      "SELECT estimated_output_tokens AS estimatedOutputTokens FROM attention_requests ORDER BY id DESC LIMIT 1",
    ).get()).toMatchObject({ estimatedOutputTokens: 16384 });
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

    expect(interactive.policyRow.maxOutputTokens).toBe(16384);
    expect(interactive.policyRow.deadlineMs).toBe(60000);
    expect(durable.policyRow.maxOutputTokens).toBe(16384);
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
        maxTokens: 17000,
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
      configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    }).maxTokens).toBe(16384);

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
      portfolioRevisionId: "mfp_current_compatibility_v4",
      registryVersion: currentPortfolio().registryVersion,
    });
    expect(thought?.fabric.policyRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyRowId: "mfr_thought_interactive_compat_v1",
          occupantId: "mfo_cloudflare_deepseek_v4_flash_high",
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
