import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { completeChat, resetAdapterCache } from "../../mistral-client.js";
import { openNuclearDb } from "../db.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import {
  attachCommandCodeBoundaryEvidence,
  commandCodeThoughtEvidenceFromError,
} from "../command-code/evidence.js";
import { COMMAND_CODE_POLICY } from "../command-code/policy.js";
import * as commandCodeAdapterModule from "./adapters/command-code-adapter.js";
import * as mistralAdapterModule from "./adapters/mistral-adapter.js";
import * as cloudflareAdapterModule from "./adapters/cloudflare-adapter.js";
import * as nimAdapterModule from "./adapters/nim-adapter.js";
import { thoughtOutputStructuredRequest } from "../cognitive-v021/thought/output-contract.js";
import type { ProviderCompletion, ProviderDispatchArgs } from "./types.js";

const originalCommandCodeKey = env.commandCodeApiKey;
const responseHash = `sha256:${createHash("sha256").update("{}", "utf8").digest("hex")}` as `sha256:${string}`;

afterEach(() => {
  env.commandCodeApiKey = originalCommandCodeKey;
  resetAdapterCache();
  vi.restoreAllMocks();
});

function thoughtContext(invocationId: string) {
  return {
    invocationId,
    cycleId: `cycle:${invocationId}`,
    generation: 3,
    semanticPass: 1,
    structuralAttemptOrdinal: 0,
    authorityEpoch: 7,
    authorityVersionVector: { nuclear: 2 },
    triggerRef: `trigger:${invocationId}`,
    semanticProjectionHash: "sha256:semantic",
    dispatchMessagesHash: "sha256:messages",
    allowlistFingerprint: "sha256:allowlist",
    absoluteDeadlineAtMs: Date.now() + 30_000,
  };
}

describe("direct Command Code Thought dispatch", () => {
  it("ignores conflicting Model Fabric route hints and returns direct attempt evidence", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = vi.fn(async (args: ProviderDispatchArgs): Promise<ProviderCompletion> => ({
      text: "{}",
      providerModel: args.modelId,
      providerRequestId: "cc-request-1",
      providerHttpStatus: 200,
      providerRequestHash: "sha256:request",
      providerResponseHash: responseHash,
      usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
    }));
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch,
    });
    const createMistral = vi.spyOn(mistralAdapterModule, "createMistralAdapter");
    const createCloudflare = vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter");
    const createNim = vi.spyOn(nimAdapterModule, "createNimAdapter");
    const context = thoughtContext("thought-direct-1");
    try {
      const completion = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "direct Thought" }],
        {
          attentionDb: db,
          purpose: "thought",
          route: "thought",
          directCommandCodeThought: true,
          model: "nim/conflicting-model",
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtInvocationContext: context,
          modelFabricControlDir: "C:\\invalid\\model-fabric-control",
        } as never,
      ));

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        modelId: COMMAND_CODE_POLICY.modelId,
        options: { reasoningEffort: COMMAND_CODE_POLICY.effort },
      });
      expect(createMistral).not.toHaveBeenCalled();
      expect(createCloudflare).not.toHaveBeenCalled();
      expect(createNim).not.toHaveBeenCalled();
      expect(completion.modelFabric).toBeUndefined();
      expect(completion).toMatchObject({
        provider: "command_code",
        providerModel: COMMAND_CODE_POLICY.modelId,
        providerRequestId: "cc-request-1",
        commandCodeEvidence: {
          backend: "command_code_api",
          requestedModelId: COMMAND_CODE_POLICY.modelId,
          providerModel: COMMAND_CODE_POLICY.modelId,
          reasoningEffort: COMMAND_CODE_POLICY.effort,
          requestHash: "sha256:request",
          responseHash,
          providerAttempts: 1,
          alternateProviderAttempts: 0,
          thoughtInvocationId: context.invocationId,
          cycleId: context.cycleId,
          generation: context.generation,
        },
        capturedAttemptIdentity: {
          backend: "command_code_api",
          provider: "command_code",
          providerInvocationId: expect.any(String),
          providerAttemptId: expect.any(String),
        },
      });
      const attempt = completion.capturedAttemptIdentity as { providerInvocationId: string; providerAttemptId: string };
      expect(completion.attentionRequestId).toBeTypeOf("number");
      const row = db.prepare(
        "SELECT provider_invocation_id, provider_attempt_id FROM attention_requests WHERE id = ?",
      ).get(completion.attentionRequestId!) as Record<string, unknown>;
      expect(row).toEqual({
        provider_invocation_id: attempt.providerInvocationId,
        provider_attempt_id: attempt.providerAttemptId,
      });
    } finally {
      db.close();
    }
  });

  it("returns a direct truthful failure without alternate provider dispatch", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const failure = new AppError("provider_unavailable", "command_code_transport_unavailable", 503);
    const dispatch = vi.fn(async (): Promise<ProviderCompletion> => { throw failure; });
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch,
    });
    const createMistral = vi.spyOn(mistralAdapterModule, "createMistralAdapter");
    const createCloudflare = vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter");
    const createNim = vi.spyOn(nimAdapterModule, "createNimAdapter");
    try {
      await expect(withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "direct Thought failure" }],
        {
          attentionDb: db,
          purpose: "thought",
          route: "thought",
          directCommandCodeThought: true,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtInvocationContext: thoughtContext("thought-direct-fail"),
        } as never,
      ))).rejects.toBe(failure);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(createMistral).not.toHaveBeenCalled();
      expect(createCloudflare).not.toHaveBeenCalled();
      expect(createNim).not.toHaveBeenCalled();
      const evidence = commandCodeThoughtEvidenceFromError(failure);
      expect(evidence).toMatchObject({
        backend: "command_code_api",
        requestedModelId: COMMAND_CODE_POLICY.modelId,
        reasoningEffort: COMMAND_CODE_POLICY.effort,
        providerAttempts: 1,
        alternateProviderAttempts: 0,
        transportOutcome: "sent_outcome_unknown",
      });
    } finally {
      db.close();
    }
  });

  it("preserves direct provider boundary evidence when mapping a deadline timeout", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    let mockedNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => mockedNow);
    const deadlineAtMs = mockedNow + 30_000;
    const requestHash = `sha256:${"a".repeat(64)}` as `sha256:${string}`;
    const failure = new Error("deadline elapsed");
    failure.name = "TimeoutError";
    attachCommandCodeBoundaryEvidence(failure, {
      backend: "command_code_api",
      requestedModelId: COMMAND_CODE_POLICY.modelId,
      reasoningEffort: COMMAND_CODE_POLICY.effort,
      requestHash,
      transportOutcome: "sent_outcome_unknown",
    });
    const dispatch = vi.fn(async (): Promise<ProviderCompletion> => {
      mockedNow = deadlineAtMs + 1;
      throw failure;
    });
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch,
    });

    let caught: unknown;
    try {
      await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "direct Thought timeout" }],
        {
          attentionDb: db,
          purpose: "thought",
          route: "thought",
          directCommandCodeThought: true,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtInvocationContext: thoughtContext("thought-direct-timeout"),
          deadlineAtMs,
        } as never,
      ));
    } catch (error) {
      caught = error;
    } finally {
      db.close();
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("timeout");
    expect(commandCodeThoughtEvidenceFromError(caught)).toMatchObject({
      backend: "command_code_api",
      requestedModelId: COMMAND_CODE_POLICY.modelId,
      reasoningEffort: COMMAND_CODE_POLICY.effort,
      requestHash,
      providerAttempts: 1,
      alternateProviderAttempts: 0,
      transportOutcome: "sent_outcome_unknown",
    });
  });
});
