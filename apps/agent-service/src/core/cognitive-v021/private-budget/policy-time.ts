export type PolicyClockState = "stable" | "clock_reconciliation";

export function computePolicyTime(input: { lastPolicyNowMs: number; wallClockNowMs: number; discrepancyThresholdMs: number }): {
  policyTimeMs: number; state: PolicyClockState; discrepancyMs: number;
} {
  // F0 (periodic-autonomous-cognition R7 §15.4): NORMAL INACTIVITY IS NOT A
  // CLOCK FAILURE. The threshold is a BACKWARD tolerance only: any forward
  // gap (minutes, hours, days) advances the high-water mark and stays stable.
  // Only backward movement beyond tolerance reconciles (fail-closed posture
  // over untrustworthy timestamps; capacity itself stays safe via the
  // max(high-water, wall) policy time, with or without reconciliation).
  const policyTimeMs = Math.max(input.lastPolicyNowMs, input.wallClockNowMs);
  const backwardMs = input.lastPolicyNowMs - input.wallClockNowMs;
  const discrepancyMs = Math.abs(input.wallClockNowMs - input.lastPolicyNowMs);
  return { policyTimeMs, state: backwardMs > input.discrepancyThresholdMs ? "clock_reconciliation" : "stable", discrepancyMs };
}
