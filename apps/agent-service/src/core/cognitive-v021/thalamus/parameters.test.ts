// The parameter contract records bounded defaults without activating attention behavior.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

// An absent contract is an assertion failure, not a module-collection error at the parent.
const modulePath = "./parameters.js";
const loaded = existsSync(new URL("./parameters.ts", import.meta.url))
  ? await import(/* @vite-ignore */ modulePath) : undefined;
const parameters = loaded?.THALAMUS_PARAMETERS;
const rules = loaded?.THALAMUS_RULES;

describe("thalamus parameter contract", () => {
  it("preserves mandatory routing and excludes a sleep time floor", () => {
    expect(rules, "the mandatory-routing contract must exist").toMatchObject({
      ownerMessageRoute: "existing_ingress", ownerMessageUsesArbiter: false,
      coverageEdgeClass: "ALWAYS_THROUGH", dueCommitmentClass: "ALWAYS_THROUGH",
      sleepCeilingClass: "ALWAYS_THROUGH", sleepTimeFloorMs: null,
      budgetOwner: "private_budget_policy", calibrationStatus: "PROVISIONAL",
    });
  });

  it("attenuates ambient repetition within five observations without recovery", () => {
    expect(parameters, "the numeric contract must exist").toBeDefined();
    const alpha = parameters.ambientHabituationAlpha.default;
    expect(alpha).toBe(0.3);
    expect((1 - alpha) ** parameters.ambientRepetitionAcceptanceCount.default)
      .toBeLessThanOrEqual(parameters.ambientResponseAcceptanceCeiling.default);
  });

  it("keeps modulation and learned gain within the binding limits", () => {
    expect(parameters, "the numeric contract must exist").toBeDefined();
    expect(parameters.moodAmplitude.default).toBe(0.15);
    expect(parameters.nucleusGain.learningBound).toEqual({ min: 0.5, max: 2 });
    expect(parameters.familyGain.learningBound).toEqual({ min: 0.5, max: 2 });
    expect(parameters.watchPerSettlement.default).toBe(4);
    expect(parameters.watchLive.default).toBe(16);
    expect(parameters.decisionRetentionMs.default).toBe(30 * 86_400_000);
    expect(parameters.reflectionWindowRows.default).toBe(40);
  });

  it("declares units, provenance and bounds for every numeric default", () => {
    expect(parameters, "the numeric contract must exist").toBeDefined();
    for (const entry of Object.values(parameters) as { units: string; source: string; default: number; learningBound: { min: number; max: number }; status: string }[]) {
      expect(entry.units.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(Number.isFinite(entry.default)).toBe(true);
      expect(entry.default).toBeGreaterThanOrEqual(entry.learningBound.min);
      expect(entry.default).toBeLessThanOrEqual(entry.learningBound.max);
      if (entry.source === "architect default") expect(entry.status).toBe("PROVISIONAL");
      if (entry.status === "FIXED") {
        expect(entry.learningBound.min).toBe(entry.default);
        expect(entry.learningBound.max).toBe(entry.default);
      }
    }
    expect(parameters.theta0.status).toBe("PROVISIONAL");
    expect(parameters.calibrationTolerance.default).toBe(0.2);
  });
});
