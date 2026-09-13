import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { openNuclearDb } from "../db.js";
import { completeChat, resetAdapterCache } from "../../mistral-client.js";
import * as mistralAdapterModule from "../model-routing/adapters/mistral-adapter.js";
import * as groqAdapterModule from "../model-routing/adapters/groq-adapter.js";
import * as nimAdapterModule from "../model-routing/adapters/nim-adapter.js";
import { attachProviderHttpStatusBoundary } from "../model-routing/types.js";
import { createGroqAdapter } from "../model-routing/adapters/groq-adapter.js";
import { createNimAdapter } from "../model-routing/adapters/nim-adapter.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import type { ModelFabricDispatchMetadata } from "./index.js";

type ResolvedFabricMetadata = ModelFabricDispatchMetadata & {
  receipt: Extract<
    ModelFabricDispatchMetadata["receipt"],
    { receiptStage: "resolved" }
  >;
};

const savedKeys = {
  mistral: env.mistralApiKey,
  mistralSecondary: env.mistralApiKeySecondary,
  groq: env.groqApiKey,
  nim: env.nimApiKey,
};

afterEach(() => {
  env.mistralApiKey = savedKeys.mistral;
  env.mistralApiKeySecondary = savedKeys.mistralSecondary;
  env.groqApiKey = savedKeys.groq;
  env.nimApiKey = savedKeys.nim;
  resetAdapterCache();
  vi.restoreAllMocks();
});

function db(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function metadata(value: unknown): ModelFabricDispatchMetadata {
  const result = (value as { modelFabric?: unknown }).modelFabric;
  if (!result) throw new Error("missing_model_fabric_metadata");
  return result as ModelFabricDispatchMetadata;
}

function resolvedMetadata(value: unknown): ResolvedFabricMetadata {
  const result = metadata(value);
  if (result.receipt.receiptStage !== "resolved") {
    throw new Error("expected_resolved_model_fabric_receipt");
  }
  return result as ResolvedFabricMetadata;
}

describe("SLICE 0 receipt truth", () => {
  it("keeps credential_failover on a failed two-attempt Thought invocation", async () => {
    env.mistralApiKey = "test-primary";
    env.mistralApiKeySecondary = "test-secondary";
    const providerError = new AppError(
      "credential_invalid",
      "Mistral credential rejected",
      401,
      undefined,
      "account",
    );
    attachProviderHttpStatusBoundary(providerError, 401);
    const dispatch = vi.fn().mockRejectedValue(providerError);
    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });
    const database = db();
    let thrown: unknown;

    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
        attentionDb: database,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        model: "mistral-small-2603",
        maxTokens: 400,
        deadlineAtMs: Date.now() + 10_000,
      }));
    } catch (error) {
      thrown = error;
    }

    const fabric = resolvedMetadata(thrown);
    expect(fabric.receipt.receiptStage).toBe("resolved");
    expect(fabric.receipt.fallbackClass).toBe("credential_failover");
    expect(fabric.receipt.attempts).toHaveLength(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    database.close();
  });

  it("does not classify an ineligible Thought abort as credential failover", async () => {
    env.mistralApiKey = "test-primary";
    env.mistralApiKeySecondary = "test-secondary";
    const dispatch = vi.fn().mockImplementation(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });
    const database = db();
    let thrown: unknown;

    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
        attentionDb: database,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        model: "mistral-small-2603",
        maxTokens: 400,
        deadlineAtMs: Date.now() + 10_000,
      }));
    } catch (error) {
      thrown = error;
    }

    const fabric = resolvedMetadata(thrown);
    expect(fabric.receipt.fallbackClass).toBe("none");
    expect(fabric.receipt.attempts).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    database.close();
  });

  it("does not classify a deadline-blocked Thought credential hop as credential failover", async () => {
    env.mistralApiKey = "test-primary";
    env.mistralApiKeySecondary = "test-secondary";
    const providerError = new AppError(
      "rate_limited",
      "Mistral account rate limited",
      429,
      undefined,
      "account",
    );
    attachProviderHttpStatusBoundary(providerError, 429);
    const dispatch = vi.fn().mockRejectedValue(providerError);
    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });
    const database = db();
    let thrown: unknown;

    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
        attentionDb: database,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        model: "mistral-small-2603",
        maxTokens: 400,
        deadlineAtMs: Date.now() + 1_000,
      }));
    } catch (error) {
      thrown = error;
    }

    const fabric = resolvedMetadata(thrown);
    expect(fabric.receipt.fallbackClass).toBe("none");
    expect(fabric.receipt.attempts).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    database.close();
  });

  it("does not classify Expression failure as Thought credential failover", async () => {
    env.nimApiKey = "test-nim";
    const providerError = new AppError("rate_limited", "NIM rate limited", 429);
    attachProviderHttpStatusBoundary(providerError, 429);
    const dispatch = vi.fn().mockRejectedValue(providerError);
    vi.spyOn(nimAdapterModule, "createNimAdapter").mockReturnValue({
      provider: "nim",
      dispatch,
    });
    const database = db();
    let thrown: unknown;

    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "speak" }], {
        attentionDb: database,
        purpose: "expression",
        route: "ashley_expression",
      }));
    } catch (error) {
      thrown = error;
    }

    expect(resolvedMetadata(thrown).receipt.fallbackClass).toBe("none");
    expect(dispatch).toHaveBeenCalledTimes(1);
    database.close();
  });

  it("does not treat an SDK-shaped HTTP status as response_received", async () => {
    env.nimApiKey = "test-nim";
    const sdkError = Object.assign(new Error("429 from SDK"), { status: 429 });
    vi.spyOn(nimAdapterModule, "createNimAdapter").mockReturnValue({
      provider: "nim",
      dispatch: vi.fn().mockRejectedValue(sdkError),
    });
    const database = db();
    let thrown: unknown;

    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "speak" }], {
        attentionDb: database,
        purpose: "expression",
        route: "ashley_expression",
      }));
    } catch (error) {
      thrown = error;
    }

    expect(metadata(thrown).receipt.attempts[0]).toMatchObject({
      receiptStage: "dispatch_attempted",
      dispatchTruth: "sent_outcome_unknown",
      providerRequestCount: 1,
    });
    expect(metadata(thrown).receipt.attempts[0]).not.toHaveProperty("providerHttpStatus");
    database.close();
  });

  it.each([
    ["groq", createGroqAdapter, "ashley_expression_fallback", "expression"],
    ["nim", createNimAdapter, "utility_bulk", "exchange_cognition"],
  ] as const)(
    "keeps %s connection failure as sent_outcome_unknown",
    async (provider, createAdapter, route, purpose) => {
      if (provider === "groq") env.groqApiKey = "test";
      else env.nimApiKey = "test";
      const adapter = createAdapter(async () => {
        throw new TypeError("ECONNRESET");
      });
      if (provider === "groq") {
        vi.spyOn(groqAdapterModule, "createGroqAdapter").mockReturnValue(adapter);
      } else {
        vi.spyOn(nimAdapterModule, "createNimAdapter").mockReturnValue(adapter);
      }
      const database = db();
      let thrown: unknown;

      try {
        await withOfflineAppGateDisabled(() =>
          completeChat([{ role: "user", content: "utility" }], {
            attentionDb: database,
            purpose,
            route,
            deadlineAtMs: Date.now() + 10_000,
          }),
        );
      } catch (error) {
        thrown = error;
      }

      expect(metadata(thrown).receipt.attempts[0]).toMatchObject({
        receiptStage: "dispatch_attempted",
        dispatchTruth: "sent_outcome_unknown",
        providerRequestCount: 1,
      });
      database.close();
    },
  );
});
