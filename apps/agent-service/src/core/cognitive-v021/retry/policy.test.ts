import { describe, expect, it } from "vitest";
import { classifyDurableFailure, nextRetryAt } from "./policy.js";

describe("durable retry policy", () => {
  it("uses typed failure classes and never retries an ambiguous dispatch", () => {
    expect(classifyDurableFailure({ errorCode: "rate_limited", dispatchTruth: "not_started" })).toBe("rate_limited_retryable");
    expect(classifyDurableFailure({ errorCode: "provider_unavailable", dispatchTruth: "attempted" })).toBe("transient_retryable");
    expect(classifyDurableFailure({ errorCode: "timeout", dispatchTruth: "unknown" })).toBe("outcome_unknown_reconcile");
    expect(classifyDurableFailure({ errorCode: "invalid_request", dispatchTruth: "provider_responded" })).toBe("permanent_terminal");
  });

  it("keeps the six failure classes explicit", () => {
    expect(classifyDurableFailure({ errorCode: "provider_unavailable", dispatchTruth: "not_started" })).toBe("transient_retryable");
    expect(classifyDurableFailure({ errorCode: "rate_limited", dispatchTruth: "provider_responded" })).toBe("rate_limited_retryable");
    expect(classifyDurableFailure({ errorCode: "invalid_request", dispatchTruth: "provider_responded" })).toBe("permanent_terminal");
    expect(classifyDurableFailure({ errorCode: "internal_error", dispatchTruth: "attempted" })).toBe("unclassified_internal");
    expect(classifyDurableFailure({ errorCode: "stale", dispatchTruth: "not_started" })).toBe("stale_or_cancelled");
    expect(classifyDurableFailure({ errorCode: "timeout", dispatchTruth: "unknown" })).toBe("outcome_unknown_reconcile");
  });

  it("applies 1/5/30/120 second delays and a five-attempt fifteen-minute cap", () => {
    expect(nextRetryAt({ ordinal: 1, firstAttemptAtMs: 1_000, nowMs: 1_000, failureClass: "transient_retryable" })).toEqual({ kind: "retry_wait", nextEligibleAtMs: 2_000 });
    expect(nextRetryAt({ ordinal: 2, firstAttemptAtMs: 1_000, nowMs: 2_000, failureClass: "transient_retryable" })).toEqual({ kind: "retry_wait", nextEligibleAtMs: 7_000 });
    // Source evidence: docs/audits/ashley-mri-phase5-573393c/85_W6_R4_FAILURE_RETRY_AUTHORITY_MECHANICAL_PLAN.md §C: "Trusted `Retry-After` is capped by remaining age."
    expect(nextRetryAt({ ordinal: 4, firstAttemptAtMs: 1_000, nowMs: 3_000, failureClass: "rate_limited_retryable", retryAfterMs: 2_000_000 })).toEqual({ kind: "retry_wait", nextEligibleAtMs: 901_000 });
    expect(nextRetryAt({ ordinal: 5, firstAttemptAtMs: 1_000, nowMs: 2_000, failureClass: "transient_retryable" })).toEqual({ kind: "terminal", reason: "attempts_exhausted" });
    expect(nextRetryAt({ ordinal: 1, firstAttemptAtMs: 1_000, nowMs: 901_000, failureClass: "transient_retryable" })).toEqual({ kind: "terminal", reason: "age_exhausted" });
  });
});
