import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import type { EstimateMessage } from "./estimate.js";
import {
  applyModelContinuity,
  resolveProviderModelId,
} from "./continuity.js";
import { estimateRequestTokens } from "./estimate.js";
import {
  completeRequest,
  contractMismatch,
  currentTpmUsage,
  earliestLegalDispatchMs,
  ensureBootstrapContract,
  getRequest,
  insertQueuedRequest,
  markRunning,
  setRequestModelEpoch,
  tryAdmitRequest,
  bindThoughtAttempt,
  type ThoughtAttemptBinding,
} from "./ledger.js";
import { monthlyUsageSummary } from "./daily.js";
import { quotaContractFor } from "../model-routing/router.js";
import type {
  AcceptedDispatchIdentity,
  AttentionClock,
  AttentionLane,
  AttentionPurpose,
} from "./types.js";
import type { TokenUsage } from "../model-routing/types.js";
import { mapPurposeToLane, realClock } from "./types.js";
import {
  DECLARED_CONTRACT_ID,
  MODEL_SENSITIVE_SET_FOR_CONTRACT,
} from "./contract-material.js";
import { currentBuildIdentity, currentContractId } from "../rollout/capabilities.js";
import { currentModelEpoch } from "./continuity.js";

export type AttentionDispatchInput = {
  messages: EstimateMessage[];
  purpose: AttentionPurpose;
  lane?: AttentionLane;
  modelAlias?: string;
  /** @deprecated Prefer quotaBucket. */
  providerId?: string;
  routeAlias?: string | null;
  quotaBucket?: string;
  maxTokens?: number;
  toolsJson?: string;
  /** Provider-wire bytes not represented by the logical messages. */
  wireAdditionalBytes?: number;
  signal?: AbortSignal;
  deadlineAtMs?: number | null;
  ageOriginAtMs?: number;
  deliveryReservationId?: number | null;
  decisionId?: number | null;
  cognitiveJobId?: number | null;
  ownerId?: string | null;
  /** Injected provider call — no SQLite txn held across this. */
  dispatch: (args: {
    modelAlias: string;
    signal?: AbortSignal;
  }) => Promise<{
    providerModel?: string | null;
    providerRequestId?: string | null;
    cfRay?: string | null;
    usage?: TokenUsage;
    result: unknown;
  }>;
  demoteActiveSensitive?: (db: DatabaseSync) => void;
  /** Persist exact Thought/MF attempt facts before the provider adapter call. */
  thoughtAttemptBinding?: Omit<ThoughtAttemptBinding, "allocationId">;
};

export type AttentionDispatchResult<T> = {
  requestId: number;
  modelAlias: string;
  resolvedModelId: string | null;
  acceptedDispatchIdentity: AcceptedDispatchIdentity;
  result: T;
  providerRequestId?: string | null;
  cfRay?: string | null;
  usage?: TokenUsage;
};

function defaultDemote(db: DatabaseSync): void {
  const now = new Date().toISOString();
  for (const capability of MODEL_SENSITIVE_SET_FOR_CONTRACT) {
    db.prepare(
      `UPDATE capability_releases
       SET state = 'observe', updated_at = ?
       WHERE capability = ? AND release_id = ? AND state = 'active'`,
    ).run(now, capability, DECLARED_CONTRACT_ID);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Durable admission + in-memory wait for dispatch. Callbacks are not persisted.
 */
export async function runAttentiveDispatch<T>(
  db: DatabaseSync,
  input: AttentionDispatchInput,
  clock: AttentionClock = realClock,
): Promise<AttentionDispatchResult<T>> {
  ensureBootstrapContract(db);
  // Crash recovery runs once at process/core start — never here (would kill peers).

  const providerId = input.providerId ?? "mistral";
  const modelAlias =
    input.modelAlias ??
    (providerId === "mistral"
      ? env.mistralModel
      : providerId === "nim"
        ? "openai/gpt-oss-20b"
        : providerId === "opencode_zen"
          ? "minimax/minimax-m2"
          : env.groqDefaultModel);
  const quotaBucket = input.quotaBucket ?? `${providerId}:${modelAlias}`;
  // Provider-specific key gate — no attention reservation / no limiter consumption.
  if (providerId === "mistral" && !env.mistralApiKey) {
    throw new AppError(
      "agent_not_ready",
      "Mistral API key not configured",
      503,
    );
  }
  if (providerId === "groq" && !env.groqApiKey) {
    throw new AppError("agent_not_ready", "Groq API key not configured", 503);
  }
  if (providerId === "nim" && !env.nimApiKey) {
    throw new AppError("agent_not_ready", "NVIDIA NIM API key not configured", 503);
  }
  if (providerId === "opencode_zen" && !env.opencodeZenApiKey) {
    throw new AppError("agent_not_ready", "OpenCode Zen API key not configured", 503);
  }
  const estimate = estimateRequestTokens(input.messages, {
    maxTokens: input.maxTokens,
    toolsJson: input.toolsJson,
    wireAdditionalBytes: input.wireAdditionalBytes,
  });
  const totalDemand =
    estimate.estimatedInputTokens + estimate.estimatedOutputTokens;
  if (totalDemand > quotaContractFor(quotaBucket).tpm) {
    throw Object.assign(new Error("request_exceeds_tpm_budget"), {
      code: "request_exceeds_tpm_budget",
    });
  }

  const lane = input.lane ?? mapPurposeToLane(input.purpose);
  const requestId = insertQueuedRequest(
    db,
    {
      lane,
      purpose: input.purpose,
      modelAlias,
      providerId,
      quotaBucket,
      routeAlias: input.routeAlias ?? null,
      estimatedInputTokens: estimate.estimatedInputTokens,
      estimatedOutputTokens: estimate.estimatedOutputTokens,
      deadlineAtMs: input.deadlineAtMs,
      ageOriginAtMs: input.ageOriginAtMs,
      deliveryReservationId: input.deliveryReservationId,
      decisionId: input.decisionId,
      cognitiveJobId: input.cognitiveJobId,
      ownerId: input.ownerId,
    },
    clock,
  );

  // Wait for admission without holding a write txn.
  for (let attempt = 0; attempt < 120; attempt++) {
    if (input.signal?.aborted) {
      completeRequest(
        db,
        requestId,
        { outcome: "cancelled", errorClass: "aborted" },
        clock,
      );
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    const now = clock.nowMs();
    if (input.deadlineAtMs != null && now >= input.deadlineAtMs) {
      completeRequest(
        db,
        requestId,
        { outcome: "timeout", errorClass: "deadline_before_dispatch" },
        clock,
      );
      throw Object.assign(new Error("attention_deadline"), {
        code: "attention_deadline",
      });
    }

    try {
      const admit = tryAdmitRequest(db, requestId, clock);
      if (admit.admitted) {
        const dispatchContractId = currentContractId();
        const dispatchBuildIdentity = currentBuildIdentity();
        markRunning(db, requestId, clock, {
          contractId: dispatchContractId,
          buildIdentity: dispatchBuildIdentity,
        });
        const row = getRequest(db, requestId);
        const dispatchSequence = Number(row?.dispatch_sequence ?? 0);
        const deadlineSignal =
          input.deadlineAtMs != null
            ? AbortSignal.any(
                [
                  input.signal,
                  AbortSignal.timeout(
                    Math.max(1, input.deadlineAtMs - clock.nowMs()),
                  ),
                ].filter(Boolean) as AbortSignal[],
              )
            : input.signal;

        try {
          if (input.thoughtAttemptBinding) {
            bindThoughtAttempt(db, {
              ...input.thoughtAttemptBinding,
              allocationId: requestId,
            });
          }
          const dispatched = await input.dispatch({
            modelAlias,
            signal: deadlineSignal,
          });
          const afterDeadline =
            input.deadlineAtMs != null && clock.nowMs() >= input.deadlineAtMs;
          const resolved = resolveProviderModelId(
            modelAlias,
            dispatched.providerModel,
          );
          if (afterDeadline) {
            completeRequest(
              db,
              requestId,
              {
                outcome: "timeout",
                errorClass: "late_result_after_deadline",
                resolvedModelId: resolved.resolvedModelId,
                actualInput: dispatched.usage?.promptTokens ?? null,
                actualOutput: dispatched.usage?.completionTokens ?? null,
                retainUnknownBudget: !dispatched.usage,
              },
              clock,
            );
            throw Object.assign(new Error("attention_deadline"), {
              code: "attention_deadline",
            });
          }
          const continuity = applyModelContinuity(
            db,
            {
              alias: modelAlias,
              resolvedModelId: resolved.resolvedModelId,
              unresolvedAlias: resolved.unresolvedAlias,
              dispatchSequence,
            },
            input.demoteActiveSensitive ?? defaultDemote,
            clock,
          );
          if (continuity.kind === "stale") {
            completeRequest(
              db,
              requestId,
              {
                outcome: "error",
                errorClass: "stale_model_continuity",
                resolvedModelId: resolved.resolvedModelId,
                actualInput: dispatched.usage?.promptTokens ?? null,
                actualOutput: dispatched.usage?.completionTokens ?? null,
                retainUnknownBudget: !dispatched.usage,
              },
              clock,
            );
            throw Object.assign(new Error("stale_model_continuity"), {
              code: "stale_model_continuity",
            });
          }
          const modelEpoch = resolved.resolvedModelId == null
            ? 0
            : continuity.epoch;
          completeRequest(
            db,
            requestId,
            {
              outcome: "completed",
              resolvedModelId: resolved.resolvedModelId,
              actualInput: dispatched.usage?.promptTokens ?? null,
              actualOutput: dispatched.usage?.completionTokens ?? null,
              retainUnknownBudget: !dispatched.usage,
            },
            clock,
          );
          setRequestModelEpoch(db, requestId, modelEpoch);
          const acceptedDispatchIdentity: AcceptedDispatchIdentity = {
            requestId,
            dispatchSequence,
            routeAlias: input.routeAlias ?? null,
            modelAlias,
            resolvedModelId: resolved.resolvedModelId,
            modelEpoch,
            modelIdentity: resolved.resolvedModelId == null
              ? null
              : `model-continuity-v1:${modelAlias}|${resolved.resolvedModelId}`,
            contractId: dispatchContractId,
            buildIdentity: dispatchBuildIdentity,
            ownerId: input.ownerId ?? null,
            cognitiveJobId: input.cognitiveJobId ?? null,
          };
          return {
            requestId,
            modelAlias,
            resolvedModelId: resolved.resolvedModelId,
            acceptedDispatchIdentity,
            result: dispatched.result as T,
            providerRequestId: dispatched.providerRequestId,
            cfRay: dispatched.cfRay ?? null,
            usage: dispatched.usage,
          };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            completeRequest(
              db,
              requestId,
              {
                outcome: "timeout",
                errorClass: "aborted_in_flight",
                retainUnknownBudget: true,
              },
              clock,
            );
            throw error;
          }
          const code =
            error instanceof AppError
              ? error.code
              : error instanceof Error && "code" in error
                ? String((error as { code?: string }).code)
                : "error";
          completeRequest(
            db,
            requestId,
            {
              outcome:
                code === "rate_limited"
                  ? "rate_limited"
                  : code === "attention_deadline" || code === "timeout"
                    ? "timeout"
                    : "error",
              errorClass: code,
              retainUnknownBudget: true,
            },
            clock,
          );
          throw error;
        }
      }
      if (admit.reason === "deadline") {
        throw Object.assign(new Error("attention_deadline"), {
          code: "attention_deadline",
          nextEligibleAtMs: admit.nextEligibleAtMs,
        });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "request_exceeds_tpm_budget"
      ) {
        completeRequest(
          db,
          requestId,
          { outcome: "aborted", errorClass: "request_exceeds_tpm_budget" },
          clock,
        );
        throw error;
      }
      throw error;
    }

    let waitMs = 50;
    try {
      const earliest = earliestLegalDispatchMs(
        db,
        totalDemand,
        clock,
        quotaBucket,
      );
      waitMs = Math.max(25, Math.min(250, earliest - clock.nowMs()));
    } catch {
      waitMs = 50;
    }
    await sleep(waitMs, input.signal);
  }

  completeRequest(
    db,
    requestId,
    { outcome: "timeout", errorClass: "admission_wait_exhausted" },
    clock,
  );
  throw Object.assign(new Error("attention_deadline"), {
    code: "attention_deadline",
  });
}

export function attentionObservability(db: DatabaseSync) {
  ensureBootstrapContract(db);
  const queued = db
    .prepare(
      `SELECT lane, COUNT(*) AS c,
              MIN(queued_at) AS oldest
       FROM attention_requests WHERE state = 'queued'
       GROUP BY lane`,
    )
    .all();
  const continuity = db
    .prepare(`SELECT * FROM model_continuity_state`)
    .all();
  const recent = db
    .prepare(
      `SELECT outcome, COUNT(*) AS c FROM attention_requests
       WHERE state = 'terminal' AND ended_at IS NOT NULL
         AND ended_at >= ?
       GROUP BY outcome`,
    )
    .all(new Date(Date.now() - 3_600_000).toISOString());
  const timeouts = db
    .prepare(
      `SELECT COUNT(*) AS c FROM attention_requests
       WHERE state = 'terminal' AND outcome = 'timeout'`,
    )
    .get() as { c?: number } | undefined;
  const rateLimited = db
    .prepare(
      `SELECT COUNT(*) AS c FROM attention_requests
       WHERE state = 'terminal' AND outcome = 'rate_limited'`,
    )
    .get() as { c?: number } | undefined;
  return {
    contractId: DECLARED_CONTRACT_ID,
    buildIdentity: currentBuildIdentity(),
    contractMismatch: contractMismatch(db),
    modelEpoch: currentModelEpoch(db, env.mistralModel),
    queuedByLane: queued,
    continuity,
    recentOutcomes: recent,
    reservedTpm: currentTpmUsage(db),
    timeouts: Number(timeouts?.c ?? 0),
    rateLimited: Number(rateLimited?.c ?? 0),
    monthly: monthlyUsageSummary(db),
    rpsLimit: env.mistralRequestsPerSecond,
    tpmLimit: env.mistralTokensPerMinute,
  };
}
