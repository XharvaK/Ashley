import { describe, expect, it } from "vitest";
import { computePolicyTime } from "./policy-time.js";

describe("private budget policy time (F0 repaired semantics)", () => {
  it("treats any forward gap as normal inactivity, never reconciliation", () => {
    for (const wallClockNowMs of [1_060_000, 4_600_000, 22_600_000, 87_400_000, 1_000_000_000_000]) {
      expect(computePolicyTime({ lastPolicyNowMs: 1_000_000, wallClockNowMs, discrepancyThresholdMs: 300_000 })).toEqual({
        policyTimeMs: wallClockNowMs,
        state: "stable",
        discrepancyMs: wallClockNowMs - 1_000_000,
      });
    }
  });

  it("clamps small backward movement to the high-water mark and stays stable", () => {
    expect(computePolicyTime({ lastPolicyNowMs: 1_000_000, wallClockNowMs: 940_000, discrepancyThresholdMs: 300_000 })).toEqual({
      policyTimeMs: 1_000_000,
      state: "stable",
      discrepancyMs: 60_000,
    });
    expect(computePolicyTime({ lastPolicyNowMs: 1_000_000, wallClockNowMs: 700_000, discrepancyThresholdMs: 300_000 })).toEqual({
      policyTimeMs: 1_000_000,
      state: "stable",
      discrepancyMs: 300_000,
    });
  });

  it("reconciles backward movement beyond tolerance without lowering policy time", () => {
    expect(computePolicyTime({ lastPolicyNowMs: 10_000_000, wallClockNowMs: 9_699_999, discrepancyThresholdMs: 300_000 })).toEqual({
      policyTimeMs: 10_000_000,
      state: "clock_reconciliation",
      discrepancyMs: 300_001,
    });
  });
});
