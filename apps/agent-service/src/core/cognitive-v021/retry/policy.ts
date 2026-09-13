import type { DurableDispatchTruth, DurableFailureClass } from "../types.js";
export type { DurableDispatchTruth, DurableFailureClass } from "../types.js";

export type RetryDecision =
  | { kind: "retry_wait"; nextEligibleAtMs: number }
  | { kind: "terminal"; reason: "attempts_exhausted" | "age_exhausted" | "not_retryable" };

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000] as const;
const MAX_ATTEMPTS = 5;
const MAX_RETRY_AGE_MS = 15 * 60 * 1_000;

export function classifyDurableFailure(input: {
  errorCode: string;
  dispatchTruth: DurableDispatchTruth;
}): DurableFailureClass {
  if (input.dispatchTruth === "unknown") return "outcome_unknown_reconcile";
  if (input.errorCode === "stale" || input.errorCode === "cancelled") return "stale_or_cancelled";
  if (["rate_limited", "quota_exhausted", "429"].includes(input.errorCode)) return "rate_limited_retryable";
  if (["provider_unavailable", "timeout", "network_error", "5xx"].includes(input.errorCode)) {
    return "transient_retryable";
  }
  if (["invalid_request", "not_authorized", "policy_denied", "unsupported"].includes(input.errorCode)) {
    return "permanent_terminal";
  }
  return "unclassified_internal";
}

export function nextRetryAt(input: {
  ordinal: number;
  firstAttemptAtMs: number;
  nowMs: number;
  failureClass: DurableFailureClass;
  retryAfterMs?: number;
}): RetryDecision {
  if (!["transient_retryable", "rate_limited_retryable", "unclassified_internal"].includes(input.failureClass)) {
    return { kind: "terminal", reason: "not_retryable" };
  }
  if (input.ordinal >= MAX_ATTEMPTS) return { kind: "terminal", reason: "attempts_exhausted" };

  const ageDeadline = input.firstAttemptAtMs + MAX_RETRY_AGE_MS;
  if (input.nowMs >= ageDeadline) return { kind: "terminal", reason: "age_exhausted" };

  const retryAfterMs = Number.isFinite(input.retryAfterMs) && (input.retryAfterMs ?? 0) >= 0
    ? input.retryAfterMs ?? 0
    : 0;
  const delay = Math.max(
    RETRY_DELAYS_MS[input.ordinal - 1] ?? RETRY_DELAYS_MS.at(-1)!,
    retryAfterMs,
  );
  // Retry-After is a scheduling hint. It cannot move work beyond the
  // first-attempt age boundary established by the packet.
  const nextEligibleAtMs = Math.min(input.nowMs + delay, ageDeadline);
  return { kind: "retry_wait", nextEligibleAtMs };
}

export const DURABLE_RETRY_POLICY = Object.freeze({
  delaysMs: RETRY_DELAYS_MS,
  maxAttempts: MAX_ATTEMPTS,
  maxRetryAgeMs: MAX_RETRY_AGE_MS,
});
