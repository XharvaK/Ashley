// Hand-calculated shared vectors specify mechanical conformance, not lived cognition.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arbitrate, type Candidate, type ThalamusState, type ThalamusContext } from "./core.js";
import { THALAMUS_PARAMETERS as P } from "./parameters.js";
const names = ["exact-threshold", "duplicate-out-of-order", "habituation-recovery", "dishabituation",
  "refractory", "clock-rollback", "exhausted-budget", "coalescing", "due-deadline", "opportunistic-no-pressure"];
describe("central attention vectors v1", () => {
  for (const name of names) it(name, () => {
    const path = new URL(`./vectors/${name}.json`, import.meta.url);
    expect(existsSync(path), "shared vector must exist").toBe(true);
    const vector = JSON.parse(readFileSync(path, "utf8"));
    expect(vector.schemaVersion).toBe(1);
    expect(vector.parameterRevision).toBe(P.parameterContractVersion.default);
    let state: ThalamusState = vector.initialState;
    for (const step of vector.steps) {
      const context: ThalamusContext = { budgetAvailable: true, conversationClaimHeld: false,
        spentFraction: 0, energy: 0.5, tension: 0, circadianPhase: 0, ...step.context };
      const result = arbitrate(state, step.candidates as Candidate[], step.nowMs, context);
      expect(result.decision).toMatchObject(step.expectedDecision);
      if (step.expectedLastNowMs !== undefined) expect(result.state.lastNowMs).toBe(step.expectedLastNowMs);
      for (const [key, fields] of Object.entries(step.expectedFamilies ?? {})) {
        const actual = result.state.families[key] as unknown as Record<string, unknown>;
        expect(actual).toBeDefined();
        for (const [field, expected] of Object.entries(fields as Record<string, unknown>)) {
          if (typeof expected === "number") expect(Math.abs(Number(actual[field]) - expected)).toBeLessThan(1e-9);
          else expect(actual[field]).toBe(expected);
        }
      }
      state = result.state;
    }
  });
});
