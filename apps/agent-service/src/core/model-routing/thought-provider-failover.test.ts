import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { openNuclearDb } from "../db.js";
import { completeChat, resetAdapterCache } from "../../mistral-client.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import * as mistralAdapterModule from "./adapters/mistral-adapter.js";
import type { ChatMessage } from "./types.js";
import { attachProviderHttpStatusBoundary } from "./types.js";

const MISTRAL_MODEL = "mistral-small-2603";

function providerAccountError(
  code: "rate_limited" | "credential_invalid",
  message: string,
  status: number,
): AppError {
  const error = new AppError(code, message, status, undefined, "account");
  attachProviderHttpStatusBoundary(error, status);
  return error;
}

describe("Thought same-model Mistral credential failover", () => {
  let db: DatabaseSync;
  const originalMistralKey = env.mistralApiKey;
  const originalMistralSecondaryKey = env.mistralApiKeySecondary;

  beforeEach(() => {
    resetAdapterCache();
    db = openNuclearDb(new DatabaseSync(":memory:"));
    env.mistralApiKey = "test-mistral-primary-key";
    env.mistralApiKeySecondary = "";
  });

  afterEach(() => {
    resetAdapterCache();
    db.close();
    env.mistralApiKey = originalMistralKey;
    env.mistralApiKeySecondary = originalMistralSecondaryKey;
    vi.restoreAllMocks();
  });

  const messages: ChatMessage[] = [
    { role: "system", content: "You are the Thought engine." },
    { role: "user", content: "Make a decision." },
  ];

  it("dispatches primary Mistral and makes no second attempt on success", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      text: '{"kind":"speak","reason":"mistral primary"}',
      usage: { promptTokens: 100, completionTokens: 20 },
      providerModel: MISTRAL_MODEL,
      finishReason: "stop",
    });

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });

    const result = await withOfflineAppGateDisabled(() => completeChat(messages, {
      attentionDb: db,
      purpose: "thought_observation",
      logicalRole: "thought_observation",
      model: MISTRAL_MODEL,
      maxTokens: 400,
      deadlineAtMs: Date.now() + 6000,
    }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0].credentialSeat).toBe("mistral_primary");
    expect(result.text).toBe('{"kind":"speak","reason":"mistral primary"}');
    expect(result.modelAlias).toBe(MISTRAL_MODEL);
  });

  it("uses one secondary Mistral credential hop after a definitive account failure", async () => {
    env.mistralApiKeySecondary = "test-mistral-secondary-key";
    const dispatch = vi.fn().mockImplementation(async (args: { credentialSeat?: string }) => {
      if (args.credentialSeat === "mistral_primary") {
        throw providerAccountError(
          "rate_limited",
          "Mistral account rate limited",
          429,
        );
      }
      return {
        text: '{"kind":"speak","reason":"mistral secondary"}',
        usage: { promptTokens: 100, completionTokens: 25 },
        providerModel: MISTRAL_MODEL,
        finishReason: "stop",
      };
    });

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });

    const result = await withOfflineAppGateDisabled(() => completeChat(messages, {
      attentionDb: db,
      purpose: "thought_observation",
      logicalRole: "thought_observation",
      model: MISTRAL_MODEL,
      maxTokens: 400,
      deadlineAtMs: Date.now() + 6000,
    }));

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map(([args]) => args.credentialSeat)).toEqual([
      "mistral_primary",
      "mistral_secondary",
    ]);
    expect(dispatch.mock.calls[0]?.[0].modelId).toBe(MISTRAL_MODEL);
    expect(dispatch.mock.calls[1]?.[0].modelId).toBe(MISTRAL_MODEL);
    expect(dispatch.mock.calls[0]?.[0].messages).toEqual(
      dispatch.mock.calls[1]?.[0].messages,
    );
    expect(result.text).toBe('{"kind":"speak","reason":"mistral secondary"}');
    expect(result.modelAlias).toBe(MISTRAL_MODEL);
    expect(result.modelFabric?.receipt).toMatchObject({
      receiptStage: "resolved",
      fallbackClass: "credential_failover",
    });
  });

  it("does not use another credential for a provider-wide failure", async () => {
    env.mistralApiKeySecondary = "test-mistral-secondary-key";
    const dispatch = vi.fn().mockRejectedValue(
      new AppError(
        "mistral_unavailable",
        "Mistral provider unavailable",
        503,
        undefined,
        "provider",
      ),
    );

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });

    await expect(
      withOfflineAppGateDisabled(() => completeChat(messages, {
        attentionDb: db,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        model: MISTRAL_MODEL,
        maxTokens: 400,
        deadlineAtMs: Date.now() + 6000,
      })),
    ).rejects.toMatchObject({ code: "mistral_unavailable" });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0].credentialSeat).toBe("mistral_primary");
  });

  it("fails closed without the secondary hop when the remaining deadline is below 2500ms", async () => {
    env.mistralApiKeySecondary = "test-mistral-secondary-key";
    const dispatch = vi.fn().mockRejectedValue(
      new AppError(
        "rate_limited",
        "Mistral account rate limited",
        429,
        undefined,
        "account",
      ),
    );

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });

    await expect(
      withOfflineAppGateDisabled(() => completeChat(messages, {
        attentionDb: db,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        model: MISTRAL_MODEL,
        maxTokens: 400,
        deadlineAtMs: Date.now() + 1000,
      })),
    ).rejects.toMatchObject({ code: "rate_limited" });

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not create a third attempt when both Mistral credentials fail", async () => {
    env.mistralApiKeySecondary = "test-mistral-secondary-key";
    const dispatch = vi.fn().mockImplementation(async (args: { credentialSeat?: string }) => {
      throw providerAccountError(
        "credential_invalid",
        args.credentialSeat === "mistral_primary"
          ? "Mistral primary credential rejected"
          : "Mistral secondary credential rejected",
        401,
      );
    });

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });

    await expect(
      withOfflineAppGateDisabled(() => completeChat(messages, {
        attentionDb: db,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        model: MISTRAL_MODEL,
        maxTokens: 400,
        deadlineAtMs: Date.now() + 6000,
      })),
    ).rejects.toMatchObject({ code: "credential_invalid" });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map(([args]) => args.credentialSeat)).toEqual([
      "mistral_primary",
      "mistral_secondary",
    ]);
  });

  it("does not trigger credential failover for a schema or semantic failure", async () => {
    env.mistralApiKeySecondary = "test-mistral-secondary-key";
    const dispatch = vi.fn().mockRejectedValue(
      new AppError("capability_mismatch", "schema rejected", 400),
    );

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch,
    });

    await expect(
      withOfflineAppGateDisabled(() => completeChat(messages, {
        attentionDb: db,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        model: MISTRAL_MODEL,
        maxTokens: 400,
        deadlineAtMs: Date.now() + 6000,
      })),
    ).rejects.toMatchObject({ code: "capability_mismatch" });

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
