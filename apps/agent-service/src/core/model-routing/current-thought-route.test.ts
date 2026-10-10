import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { completeChat, resetAdapterCache } from "../../mistral-client.js";
import { openNuclearDb } from "../db.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import { currentPortfolio } from "../model-fabric/portfolio.js";
import { resolveRoute } from "./router.js";
import { COMMAND_CODE_POLICY } from "../command-code/policy.js";
import * as commandCodeAdapterModule from "./adapters/command-code-adapter.js";
import * as cloudflareAdapterModule from "./adapters/cloudflare-adapter.js";
import { thoughtOutputStructuredRequest } from "../cognitive-v021/thought/output-contract.js";
import type { ProviderCompletion, ProviderDispatchArgs } from "./types.js";

const originalCommandCodeKey = env.commandCodeApiKey;
const responseHash = `sha256:${createHash("sha256").update("{}", "utf8").digest("hex")}` as `sha256:${string}`;

const CURRENT_PORTFOLIO = "mfp_current_compatibility_v6";
const THOUGHT_MODEL = "meta/muse-spark-1.3-contributor";
const THOUGHT_EFFORT = "high";

afterEach(() => {
  env.commandCodeApiKey = originalCommandCodeKey;
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
    absoluteDeadlineAtMs: Date.now() + 30_000,
  };
}

describe("deterministic CURRENT Thought route chain", () => {
  it("resolves purpose=thought to the v6 Command Code Muse high occupant", () => {
    const portfolio = currentPortfolio();
    expect(portfolio.portfolioRevisionId).toBe(CURRENT_PORTFOLIO);

    const route = resolveRoute("thought");
    expect(route).toMatchObject({
      route: "thought",
      provider: "command_code",
      configuredModelId: THOUGHT_MODEL,
    });

    const interactive = portfolio.rows.find(
      (row) => row.logicalRole === "thought" && row.occupancyKey === "interactive",
    );
    expect(interactive).toBeDefined();
    expect(interactive?.occupants[0]).toMatchObject({
      provider: "command_code",
      configuredModelId: THOUGHT_MODEL,
      reasoningPolicy: "max_supported",
      effectiveReasoning: THOUGHT_EFFORT,
    });
    expect(COMMAND_CODE_POLICY.modelId).toBe(THOUGHT_MODEL);
    expect(COMMAND_CODE_POLICY.effort).toBe(THOUGHT_EFFORT);
  });

  it("carries the v6 occupant identity through completeChat to the dispatched provider call", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = vi.fn(async (args: ProviderDispatchArgs): Promise<ProviderCompletion> => ({
      text: "{}",
      providerModel: args.modelId,
      providerRequestId: "cc-route-chain-1",
      providerHttpStatus: 200,
      providerRequestHash: "sha256:request",
      providerResponseHash: responseHash,
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
    }));
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch,
    } as never);
    const createCloudflare = vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter");

    try {
      const completion = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "route chain" }],
        {
          attentionDb: db,
          purpose: "thought",
          route: "thought",
          directCommandCodeThought: true,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtInvocationContext: thoughtContext("route-chain"),
        } as never,
      ));

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        modelId: THOUGHT_MODEL,
        options: { reasoningEffort: THOUGHT_EFFORT },
      });
      expect(createCloudflare).not.toHaveBeenCalled();

      expect(completion).toMatchObject({
        provider: "command_code",
        providerModel: THOUGHT_MODEL,
        providerRequestId: "cc-route-chain-1",
        commandCodeEvidence: {
          backend: "command_code_api",
          requestedModelId: THOUGHT_MODEL,
          providerModel: THOUGHT_MODEL,
          reasoningEffort: THOUGHT_EFFORT,
          providerAttempts: 1,
          alternateProviderAttempts: 0,
        },
      });

      const row = db.prepare(
        `SELECT provider_id, actual_provider, model_alias, quota_bucket, outcome
           FROM attention_requests WHERE id = ?`,
      ).get(completion.attentionRequestId!) as Record<string, unknown>;
      expect(row).toMatchObject({
        provider_id: "command_code",
        model_alias: THOUGHT_MODEL,
        quota_bucket: `command_code:${THOUGHT_MODEL}`,
        outcome: "completed",
      });
      expect(row.actual_provider).toBe("command_code");
    } finally {
      db.close();
    }
  });
});
