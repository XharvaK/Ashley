import { configurePrivateBudgetFixture } from "./core/cognitive-v021/private-budget/__tests__/configured-policy.js";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env.js";
import { AppError } from "./errors.js";
import {
  completeChat,
  isEligibleMistralCredentialFailover,
  mapMistralError,
  resetAdapterCache,
} from "./mistral-client.js";
import { openNuclearDb } from "./core/db.js";
import { withOfflineAppGateDisabled } from "./core/qualification/offline-test-helpers.js";
import { openCognitiveSidecarDb } from "./core/cognitive-v021/sidecar/db.js";
import { admitWake } from "./core/cognitive-v021/wake/ledger.js";
import { reconcilePolicyClock } from "./core/cognitive-v021/private-budget/policy-time-ledger.js";
import { reservePrivateThought } from "./core/cognitive-v021/private-budget/ledger.js";
import * as nimAdapterModule from "./core/model-routing/adapters/nim-adapter.js";
import * as commandCodeAdapterModule from "./core/model-routing/adapters/command-code-adapter.js";
import { commandCodeThoughtEvidenceFromError } from "./core/command-code/evidence.js";
import * as mistralAdapterModule from "./core/model-routing/adapters/mistral-adapter.js";
import { thoughtOutputStructuredRequest } from "./core/cognitive-v021/thought/output-contract.js";
import type {
  ProviderCompletion,
  ProviderDispatchArgs,
} from "./core/model-routing/types.js";
import { attachProviderHttpStatusBoundary } from "./core/model-routing/types.js";
import {
  attachProviderBoundaryTransport,
  providerBoundaryTransportFromError,
} from "./core/model-routing/types.js";

const originalApiKey = env.mistralApiKey;
const originalSecondaryApiKey = env.mistralApiKeySecondary;
const originalGroqKey = env.groqApiKey;
const originalNimKey = env.nimApiKey;
const originalCloudflareToken = env.cloudflareApiToken;
const originalCloudflareAccount = env.cloudflareAccountId;
const originalMistralRps = env.mistralRequestsPerSecond;
const originalMistralTpm = env.mistralTokensPerMinute;
const originalCommandCodeKey = env.commandCodeApiKey;
const THOUGHT_MODEL = "meta/muse-spark-1.3-contributor";

function hashedResponse(text: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function thoughtContext(invocationId: string, structuralAttemptOrdinal = 0) {
  return {
    invocationId,
    cycleId: `cycle:${invocationId}`,
    generation: 1,
    semanticPass: 1,
    structuralAttemptOrdinal,
    authorityEpoch: 1,
    authorityVersionVector: { authorityEpoch: 1 },
    triggerRef: `trigger:${invocationId}`,
    semanticProjectionHash: "sha256:test",
    dispatchMessagesHash: "sha256:test",
    allowlistFingerprint: "sha256:test",
    absoluteDeadlineAtMs: Date.now() + 30_000,
  };
}

function commandCodeCompletion(
  text: string,
  extra: Partial<ProviderCompletion> = {},
): ProviderCompletion {
  return {
    text,
    providerModel: THOUGHT_MODEL,
    providerRequestId: "cc-request",
    providerHttpStatus: 200,
    providerRequestHash: "sha256:request",
    providerResponseHash: hashedResponse(text),
    usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
    finishReason: "stop",
    ...extra,
  };
}

function mockCommandCodeDispatch(
  implementation: (args: ProviderDispatchArgs) => Promise<ProviderCompletion>,
) {
  env.commandCodeApiKey = "test-command-code-key";
  const dispatch = vi.fn(implementation);
  vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
    provider: "command_code",
    dispatch,
  } as never);
  return dispatch;
}

function directThoughtOptions(
  attentionDb: DatabaseSync,
  extra: Record<string, unknown> = {},
) {
  return {
    attentionDb,
    purpose: "thought" as const,
    logicalRole: "thought" as const,
    route: "thought" as const,
    responseFormat: "json_schema" as const,
    structuredOutput: thoughtOutputStructuredRequest(),
    directCommandCodeThought: true,
    deadlineAtMs: Date.now() + 30_000,
    thoughtInvocationContext: thoughtContext("direct-thought"),
    ...extra,
  };
}

afterEach(() => {
  env.mistralApiKey = originalApiKey;
  env.mistralApiKeySecondary = originalSecondaryApiKey;
  env.groqApiKey = originalGroqKey;
  env.nimApiKey = originalNimKey;
  env.cloudflareApiToken = originalCloudflareToken;
  env.cloudflareAccountId = originalCloudflareAccount;
  env.commandCodeApiKey = originalCommandCodeKey;
  env.mistralRequestsPerSecond = originalMistralRps;
  env.mistralTokensPerMinute = originalMistralTpm;
  resetAdapterCache();
  vi.restoreAllMocks();
});

describe("mapMistralError", () => {
  it("maps statusCode 429 to rate_limited", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("Request failed"), { statusCode: 429 });
    const mapped = mapMistralError(err);
    expect(mapped.code).toBe("rate_limited");
    expect(mapped.httpStatus).toBe(429);
  });

  it("maps statusCode 503 to mistral_unavailable", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("boom"), { statusCode: 503 });
    const mapped = mapMistralError(err);
    expect(mapped.code).toBe("mistral_unavailable");
    expect(mapped.httpStatus).toBe(503);
  });

  it("maps 503 queue-full to mistral_unavailable and relays Retry-After", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(
      new Error("Streaming response failed: [503] The request queue is full."),
      {
        statusCode: 503,
        headers: new Headers({ "retry-after": "17" }),
      },
    );
    const mapped = mapMistralError(err);
    expect(mapped.code).toBe("mistral_unavailable");
    expect(mapped.httpStatus).toBe(503);
    expect(mapped.retryAfterSec).toBe(17);
  });

  it("keeps Retry-After undefined on a 503 without the header", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("boom"), { statusCode: 503 });
    const mapped = mapMistralError(err);
    expect(mapped.retryAfterSec).toBeUndefined();
  });

  it("keeps 400 as internal_error but logs the status", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(
      new Error("Assistant message must have either content or tool_calls"),
      { statusCode: 400 },
    );
    const mapped = mapMistralError(err);
    expect(mapped.code).toBe("internal_error");
    expect(log).toHaveBeenCalledWith(
      "[mistral]",
      400,
      expect.stringContaining("Assistant message"),
    );
  });

  it("re-throws AbortError without remapping", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(() => mapMistralError(err)).toThrow(err);
  });

  it("re-throws deadline TimeoutError without remapping", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(() => mapMistralError(err)).toThrow(err);
  });

  it("classifies account credential failures separately from provider-wide failures", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const invalid = mapMistralError(
      Object.assign(new Error("invalid api key"), { statusCode: 401 }),
    );
    const accountQuota = mapMistralError(
      Object.assign(new Error("quota exhausted"), { statusCode: 402 }),
    );
    const providerUnavailable = mapMistralError(
      Object.assign(new Error("service unavailable"), { statusCode: 503 }),
    );

    expect(invalid).toMatchObject({
      code: "credential_invalid",
      credentialFailureDomain: "account",
    });
    expect(accountQuota).toMatchObject({
      code: "quota_exhausted",
      credentialFailureDomain: "account",
    });
    expect(providerUnavailable).toMatchObject({
      code: "mistral_unavailable",
      credentialFailureDomain: "provider",
    });
  });

  it("permits one credential hop only after a definitive account-scoped response", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const accountFailure = mapMistralError(
      Object.assign(new Error("invalid api key"), { statusCode: 401 }),
    );
    const providerFailure = mapMistralError(
      Object.assign(new Error("service unavailable"), { statusCode: 503 }),
    );

    expect(
      isEligibleMistralCredentialFailover(accountFailure, "response_received"),
    ).toBe(true);
    expect(
      isEligibleMistralCredentialFailover(accountFailure, "sent_outcome_unknown"),
    ).toBe(false);
    expect(
      isEligibleMistralCredentialFailover(accountFailure, "not_sent"),
    ).toBe(false);
    expect(
      isEligibleMistralCredentialFailover(providerFailure, "response_received"),
    ).toBe(false);
    expect(
      isEligibleMistralCredentialFailover(
        new Error("schema validation failed"),
        "response_received",
      ),
    ).toBe(false);
  });

  it("creates no attention reservation when API key is missing", async () => {
    env.mistralApiKey = "";
    env.groqApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    await expect(
      withOfflineAppGateDisabled(() =>
        completeChat([{ role: "user", content: "hello" }], { attentionDb: db }),
      ),
    ).rejects.toMatchObject({ code: "agent_not_ready" });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM attention_requests`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("dispatches the current Thought route once through Command Code without NIM fallback", async () => {
    env.nimApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockCommandCodeDispatch(async (args) => commandCodeCompletion("{}", {
      providerModel: args.modelId,
      providerRequestId: "command-code-request-1",
    }));
    const createNim = vi.spyOn(nimAdapterModule, "createNimAdapter");
    try {
      const result = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "synthetic current Thought" }],
        directThoughtOptions(db),
      ));
      expect(createNim).not.toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        modelId: THOUGHT_MODEL,
        options: { reasoningEffort: "high" },
      });
      expect(result.modelFabric).toBeUndefined();
      expect(result).toMatchObject({
        providerModel: THOUGHT_MODEL,
        providerRequestId: "command-code-request-1",
        commandCodeEvidence: {
          backend: "command_code_api",
          requestedModelId: THOUGHT_MODEL,
          reasoningEffort: "high",
          providerAttempts: 1,
          alternateProviderAttempts: 0,
        },
        providerBoundaryControls: {
          maxTokens: 65_536,
        },
      });
    } finally {
      db.close();
    }
  });

  it("preserves adapter-observed affinity transport on Thought success", async () => {
    env.nimApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const transport = {
      sessionAffinityApplied: true,
      affinityPolicy: "cloudflare_thought_route_affinity_v1" as const,
    };
    mockCommandCodeDispatch(async () => commandCodeCompletion("{}", {
      providerRequestId: "command-code-request-2",
      providerBoundaryTransport: transport,
    }));
    try {
      const result = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "synthetic current Thought" }],
        directThoughtOptions(db, { thoughtInvocationContext: thoughtContext("affinity-success") }),
      ));
      expect(result.providerBoundaryTransport).toEqual(transport);
      expect(result.modelFabric).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("preserves adapter-observed affinity transport on Thought failure without reclassification", async () => {
    env.nimApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const transport = {
      sessionAffinityApplied: true,
      affinityPolicy: "cloudflare_thought_route_affinity_v1" as const,
    };
    const failure = new AppError("provider_unavailable", "Command Code Provider unavailable", 503);
    attachProviderHttpStatusBoundary(failure, 503);
    attachProviderBoundaryTransport(failure, transport);
    mockCommandCodeDispatch(async () => {
      throw failure;
    });
    try {
      let error: unknown;
      try {
        await withOfflineAppGateDisabled(() => completeChat(
          [{ role: "user", content: "synthetic current Thought" }],
          directThoughtOptions(db, { thoughtInvocationContext: thoughtContext("affinity-failure") }),
        ));
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "provider_unavailable" });
      expect(providerBoundaryTransportFromError(error)).toEqual(transport);
    } finally {
      db.close();
    }
  });

  it("binds and commits the durable private reservation at the exact W0 attempt boundary", async () => {
    env.mistralApiKey = "test-mistral-key";
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-cloudflare-account";
    const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    const nowMs = 4_000_000;
    configurePrivateBudgetFixture(sidecar);
    reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: nowMs, authorizationRef: "owner:w7-test-epoch" });
    const wake = admitWake(sidecar, {
      occurrenceId: "occurrence:w7-client",
      triggerRef: "trigger:w7-client",
      sourceKind: "idle",
      conversationId: "conversation:w7-client",
      cycleId: "cycle:w7-client",
      capturedAuthorityRevision: 1,
      nowMs,
    });
    const reserved = reservePrivateThought(sidecar, {
      admissionId: "admission:w7-client",
      wakeId: wake.wake.wakeId,
      conversationId: "conversation:w7-client",
      policyId: "private-v1",
      wallClockNowMs: nowMs,
    });
    if (reserved.kind !== "reserved") throw new Error("w7_test_reservation_missing");
    const dispatch = mockCommandCodeDispatch(async () => commandCodeCompletion("{}"));

    try {
      const result = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "private thought" }], directThoughtOptions(attentionDb, {
        deadlineAtMs: Date.now() + 6_000,
        thoughtInvocationContext: thoughtContext("w7-client"),
        privateBudgetBinding: { sidecar, reservationId: reserved.reservation.reservationId },
      })));
      const row = sidecar.prepare("SELECT state, dispatch_truth, invocation_id, attempt_id FROM private_budget_reservations WHERE reservation_id = ?").get(reserved.reservation.reservationId) as Record<string, unknown>;
      const capturedAttempt = result.capturedAttemptIdentity;
      expect(capturedAttempt && "providerInvocationId" in capturedAttempt ? capturedAttempt.providerInvocationId : undefined).toBe(row.invocation_id);
      expect(capturedAttempt && "providerAttemptId" in capturedAttempt ? capturedAttempt.providerAttemptId : undefined).toBe(row.attempt_id);
      expect(row).toMatchObject({ state: "committed", dispatch_truth: "responded" });
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      attentionDb.close();
      sidecar.close();
    }
  });

  it("persists provider_request_id on child repair attempt response where supplied by provider", async () => {
    env.mistralApiKey = "test-mistral-key";
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-cloudflare-account";
    const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    const nowMs = 4_000_000;
    configurePrivateBudgetFixture(sidecar);
    reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: nowMs, authorizationRef: "owner:child-provider-req-test" });
    const wake = admitWake(sidecar, {
      occurrenceId: "occurrence:child-req",
      triggerRef: "trigger:child-req",
      sourceKind: "idle",
      conversationId: "conversation:child-req",
      cycleId: "cycle:child-req",
      capturedAuthorityRevision: 1,
      nowMs,
    });
    const reserved = reservePrivateThought(sidecar, {
      admissionId: "admission:child-req",
      wakeId: wake.wake.wakeId,
      conversationId: "conversation:child-req",
      policyId: "private-v1",
      wallClockNowMs: nowMs,
    });
    if (reserved.kind !== "reserved") throw new Error("test_reservation_missing");

    const dispatch1 = mockCommandCodeDispatch(async () => commandCodeCompletion("{}"));

    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "attempt 1" }], directThoughtOptions(attentionDb, {
        deadlineAtMs: Date.now() + 6_000,
        thoughtInvocationContext: thoughtContext("child-req-1"),
        privateBudgetBinding: {
          sidecar,
          reservationId: reserved.reservation.reservationId,
          wakeId: wake.wake.wakeId,
          conversationId: "conversation:child-req",
        },
      })));

      const parentRow = sidecar.prepare("SELECT state, dispatch_truth FROM private_budget_reservations WHERE reservation_id = ?").get(reserved.reservation.reservationId) as Record<string, unknown>;
      expect(parentRow).toMatchObject({ state: "committed", dispatch_truth: "responded" });

      resetAdapterCache();
      const expectedProviderRequestId = "provider-req-child-xyz-987";
      const dispatch2 = mockCommandCodeDispatch(async () => commandCodeCompletion("{}", {
        providerRequestId: expectedProviderRequestId,
      }));

      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "attempt 2 repair" }], directThoughtOptions(attentionDb, {
        deadlineAtMs: Date.now() + 6_000,
        thoughtInvocationContext: thoughtContext("inv-child-2", 1),
        privateBudgetBinding: {
          sidecar,
          reservationId: reserved.reservation.reservationId,
          wakeId: wake.wake.wakeId,
          conversationId: "conversation:child-req",
        },
      })));
      expect(dispatch2).toHaveBeenCalledTimes(1);

      // Child binding row exists in private_budget_attempt_bindings with provider_request_id persisted!
      const childRow = sidecar.prepare("SELECT reservation_id, ordinal, reason, dispatch_truth, provider_request_id FROM private_budget_attempt_bindings WHERE reservation_id = ? AND ordinal = 2").get(reserved.reservation.reservationId) as Record<string, unknown>;
      expect(childRow).toMatchObject({
        reservation_id: reserved.reservation.reservationId,
        ordinal: 2,
        reason: "structural_repair",
        dispatch_truth: "responded",
        provider_request_id: expectedProviderRequestId,
      });
    } finally {
      attentionDb.close();
      sidecar.close();
    }
  });

  it("fails closed before a child bind when a second call lacks thoughtInvocationContext", async () => {
    env.mistralApiKey = "test-mistral-key";
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-cloudflare-account";
    const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    const nowMs = 5_000_000;
    configurePrivateBudgetFixture(sidecar);
    reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: nowMs, authorizationRef: "owner:fail-closed-test" });
    const wake = admitWake(sidecar, {
      occurrenceId: "occurrence:fail-closed",
      triggerRef: "trigger:fail-closed",
      sourceKind: "idle",
      conversationId: "conversation:fail-closed",
      cycleId: "cycle:fail-closed",
      capturedAuthorityRevision: 1,
      nowMs,
    });
    const reserved = reservePrivateThought(sidecar, {
      admissionId: "admission:fail-closed",
      wakeId: wake.wake.wakeId,
      conversationId: "conversation:fail-closed",
      policyId: "private-v1",
      wallClockNowMs: nowMs,
    });
    if (reserved.kind !== "reserved") throw new Error("test_reservation_missing");

    mockCommandCodeDispatch(async () => commandCodeCompletion("{}"));

    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "attempt 1" }], directThoughtOptions(attentionDb, {
        deadlineAtMs: Date.now() + 6_000,
        thoughtInvocationContext: thoughtContext("fail-closed-1"),
        privateBudgetBinding: {
          sidecar,
          reservationId: reserved.reservation.reservationId,
          wakeId: wake.wake.wakeId,
          conversationId: "conversation:fail-closed",
        },
      })));

      const parentRow = sidecar.prepare("SELECT state, dispatch_truth FROM private_budget_reservations WHERE reservation_id = ?").get(reserved.reservation.reservationId) as Record<string, unknown>;
      expect(parentRow).toMatchObject({ state: "committed", dispatch_truth: "responded" });

      resetAdapterCache();
      const dispatch2 = mockCommandCodeDispatch(async () => commandCodeCompletion("{}"));

      await expect(
        withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "attempt 2 generic" }], {
          attentionDb,
          purpose: "thought",
          route: "thought",
          logicalRole: "thought",
          directCommandCodeThought: true,
          structuredOutput: thoughtOutputStructuredRequest(),
          deadlineAtMs: Date.now() + 6_000,
          privateBudgetBinding: {
            sidecar,
            reservationId: reserved.reservation.reservationId,
            wakeId: wake.wake.wakeId,
            conversationId: "conversation:fail-closed",
          },
        })),
      ).rejects.toThrow("direct_command_code_thought_context_required");
      expect(dispatch2).not.toHaveBeenCalled();

      // No child attempt was bound
      const childCount = (sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_attempt_bindings WHERE reservation_id = ?").get(reserved.reservation.reservationId) as { count: number }).count;
      expect(childCount).toBe(0);

      // Parent reservation remains committed and untouched (NOT released)
      const parentAfter = sidecar.prepare("SELECT state, dispatch_truth FROM private_budget_reservations WHERE reservation_id = ?").get(reserved.reservation.reservationId) as Record<string, unknown>;
      expect(parentAfter).toMatchObject({ state: "committed", dispatch_truth: "responded" });
    } finally {
      attentionDb.close();
      sidecar.close();
    }
  });
});

const MISTRAL_SMALL = "mistral-small-2603";

function providerAccountError(
  code: "quota_exhausted" | "credential_invalid",
  message: string,
  status: number,
): AppError {
  const error = new AppError(code, message, status, undefined, "account");
  attachProviderHttpStatusBoundary(error, status);
  return error;
}

function thoughtDispatchOptions(attentionDb: DatabaseSync) {
  // The compatibility tests use an isolated in-memory Attention database.
  // Give that fixture a non-zero local Mistral quota so it exercises
  // credential failover rather than the provider-capacity guard.
  env.mistralRequestsPerSecond = Math.max(env.mistralRequestsPerSecond, 100);
  env.mistralTokensPerMinute = Math.max(env.mistralTokensPerMinute, 100_000);
  return {
    attentionDb,
    purpose: "thought_observation" as const,
    logicalRole: "thought_observation" as const,
    model: MISTRAL_SMALL,
    lane: "interactive" as const,
    responseFormat: "json_schema" as const,
    structuredOutput: thoughtOutputStructuredRequest(),
    deadlineAtMs: Date.now() + 30_000,
  };
}

function mockMistralDispatch(
  implementation: (args: ProviderDispatchArgs) => Promise<ProviderCompletion>,
) {
  const dispatch = vi.fn(implementation);
  vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
    provider: "mistral",
    dispatch,
  });
  return dispatch;
}

describe("Mistral credential failover", () => {
  it("uses only the primary seat when the primary succeeds", async () => {
    env.mistralApiKey = "primary-secret";
    env.mistralApiKeySecondary = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockMistralDispatch(async (args) => ({
      text: "{}",
      providerModel: args.modelId,
      usage: { promptTokens: 2, completionTokens: 1 },
      finishReason: "stop",
    }));
    try {
      const result = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "primary only" }],
        thoughtDispatchOptions(db),
      ));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        modelId: MISTRAL_SMALL,
        credentialSeat: "mistral_primary",
      });
      expect(
        result.modelFabric?.receipt.receiptStage === "resolved"
          ? result.modelFabric.receipt.fallbackClass
          : null,
      ).toBe("none");
      expect(result.modelFabric?.receipt.attempts).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("allows an explicit Mistral compatibility model on the observation path", async () => {
    env.mistralApiKey = "primary-secret";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockMistralDispatch(async (args) => ({
      text: "{}",
      providerModel: args.modelId,
      usage: { promptTokens: 2, completionTokens: 1 },
      finishReason: "stop",
    }));
    try {
      const result = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "compatibility model selection" }],
        {
          ...thoughtDispatchOptions(db),
          model: "mistral-medium-latest",
        },
      ));
      expect(result.modelAlias).toBe("mistral-medium-latest");
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0].modelId).toBe("mistral-medium-latest");
    } finally {
      db.close();
    }
  });

  it("records the provider-resolved compatibility model without credential failover", async () => {
    env.mistralApiKey = "primary-secret";
    env.mistralApiKeySecondary = "secondary-secret";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockMistralDispatch(async () => ({
      text: "{}",
      providerModel: "mistral-small-latest",
      usage: { promptTokens: 2, completionTokens: 1 },
      finishReason: "stop",
      }));
    try {
      const result = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "returned compatibility identity" }],
        thoughtDispatchOptions(db),
      ));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0].credentialSeat).toBe("mistral_primary");
      expect(result.providerModel).toBe("mistral-small-latest");
      expect(result.resolvedModelId).toBe("mistral-small-latest");
    } finally {
      db.close();
    }
  });

  it("uses exactly one secondary credential hop after a definitive account failure", async () => {
    env.mistralApiKey = "primary-secret";
    env.mistralApiKeySecondary = "secondary-secret";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockMistralDispatch(async (args) => {
      if (args.credentialSeat === "mistral_primary") {
        throw providerAccountError(
          "quota_exhausted",
          "Mistral quota exhausted",
          402,
        );
      }
      return {
        text: "{}",
        providerModel: args.modelId,
        usage: { promptTokens: 2, completionTokens: 1 },
        finishReason: "stop",
      };
    });
    try {
      const result = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "credential hop" }],
        thoughtDispatchOptions(db),
      ));
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(dispatch.mock.calls.map(([args]) => ({
        modelId: args.modelId,
        credentialSeat: args.credentialSeat,
      }))).toEqual([
        { modelId: MISTRAL_SMALL, credentialSeat: "mistral_primary" },
        { modelId: MISTRAL_SMALL, credentialSeat: "mistral_secondary" },
      ]);
      expect(result.modelAlias).toBe(MISTRAL_SMALL);
      expect(
        result.modelFabric?.receipt.receiptStage === "resolved"
          ? result.modelFabric.receipt.fallbackClass
          : null,
      ).toBe("credential_failover");
      expect(result.modelFabric?.receipt.attempts.map((attempt) => ({
        fallbackClass: attempt.fallbackClass,
        credentialSeat: attempt.credentialSeat,
        configuredModelId: attempt.configuredModelId,
      }))).toEqual([
        {
          fallbackClass: "none",
          credentialSeat: "mistral_primary",
          configuredModelId: MISTRAL_SMALL,
        },
        {
          fallbackClass: "credential_failover",
          credentialSeat: "mistral_secondary",
          configuredModelId: MISTRAL_SMALL,
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("preserves an eligible primary failure when no secondary credential exists", async () => {
    env.mistralApiKey = "primary-secret";
    env.mistralApiKeySecondary = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockMistralDispatch(async () => {
      throw providerAccountError(
        "credential_invalid",
        "Mistral credential rejected",
        401,
      );
    });
    try {
      const error = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "no secondary" }],
        thoughtDispatchOptions(db),
      )).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "credential_invalid" });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect((error as { modelFabric?: { failoverSuppressed?: string } }).modelFabric?.failoverSuppressed)
        .toBe("mistral_secondary_credential_unavailable");
    } finally {
      db.close();
    }
  });

  it.each([
    {
      name: "provider-wide failure",
      error: new AppError("mistral_unavailable", "Mistral unavailable", 503, undefined, "provider"),
    },
    {
      name: "ambiguous dispatch",
      error: new Error("network lost after send"),
    },
    {
      name: "schema or capability rejection",
      error: new AppError("capability_mismatch", "schema rejected", 400),
    },
  ])("does not hop credentials for $name", async ({ error }) => {
    env.mistralApiKey = "primary-secret";
    env.mistralApiKeySecondary = "secondary-secret";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockMistralDispatch(async () => {
      throw error;
    });
    try {
      if (error instanceof AppError) {
        await expect(
          withOfflineAppGateDisabled(() => completeChat(
            [{ role: "user", content: "no hop" }],
            thoughtDispatchOptions(db),
          )),
        ).rejects.toBe(error);
      } else {
        await expect(
          withOfflineAppGateDisabled(() => completeChat(
            [{ role: "user", content: "no hop" }],
            thoughtDispatchOptions(db),
          )),
        ).rejects.toMatchObject({ code: "internal_error" });
      }
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0].credentialSeat).toBe("mistral_primary");
    } finally {
      db.close();
    }
  });

  it("does not retry a secondary failure and never changes the model identity", async () => {
    env.mistralApiKey = "primary-secret";
    env.mistralApiKeySecondary = "secondary-secret";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const secondaryError = new AppError(
      "credential_invalid", "Mistral credential rejected", 401, undefined, "account",
    );
    attachProviderHttpStatusBoundary(secondaryError, 401);
    const dispatch = mockMistralDispatch(async (args) => {
      if (args.credentialSeat === "mistral_primary") {
        throw providerAccountError(
          "quota_exhausted",
          "Mistral quota exhausted",
          402,
        );
      }
      throw secondaryError;
    });
    try {
      await expect(
        withOfflineAppGateDisabled(() => completeChat(
          [{ role: "user", content: "secondary failure" }],
          thoughtDispatchOptions(db),
        )),
      ).rejects.toBe(secondaryError);
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(dispatch.mock.calls.every(([args]) => args.modelId === MISTRAL_SMALL)).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("Thought deadline TimeoutError truth", () => {
  it("maps a deadline-generated TimeoutError to timeout, never provider_unavailable", async () => {
    env.nimApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const controller = new AbortController();
    const dispatch = mockCommandCodeDispatch(async () => {
      const reason = new Error("The operation was aborted due to timeout");
      reason.name = "TimeoutError";
      controller.abort(reason);
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });
    try {
      const error = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "synthetic deadline thought" }],
        directThoughtOptions(db, {
          deadlineAtMs: Date.now() + 30_000,
          signal: controller.signal,
          thoughtInvocationContext: thoughtContext("deadline-timeout"),
        }),
      )).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "timeout", httpStatus: 408 });
      expect(commandCodeThoughtEvidenceFromError(error)).toMatchObject({
        providerAttempts: 1,
        alternateProviderAttempts: 0,
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("keeps external AbortError cancellation behavior unchanged", async () => {
    env.nimApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const abort = new Error("aborted by caller");
    abort.name = "AbortError";
    const dispatch = mockCommandCodeDispatch(async () => {
      throw abort;
    });
    try {
      const error = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "synthetic cancelled thought" }],
        directThoughtOptions(db, {
          deadlineAtMs: Date.now() + 30_000,
          thoughtInvocationContext: thoughtContext("deadline-abort"),
        }),
      )).catch((value: unknown) => value);
      expect(error).toBe(abort);
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("keeps fetch-failed network classification while the deadline remains", async () => {
    env.nimApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const dispatch = mockCommandCodeDispatch(async () => {
      throw new TypeError("fetch failed");
    });
    try {
      const error = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "synthetic network failure thought" }],
        directThoughtOptions(db, {
          deadlineAtMs: Date.now() + 30_000,
          thoughtInvocationContext: thoughtContext("deadline-network"),
        }),
      )).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: "provider_unavailable" });
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });
});
