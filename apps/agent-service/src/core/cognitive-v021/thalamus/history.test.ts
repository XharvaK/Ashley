// Observation history changes attention mechanics, never the meaning of an event.
import { describe, expect, it } from "vitest";
import { arbitrate, type Candidate, type ThalamusState, type ThalamusContext } from "./core.js";
import { THALAMUS_PARAMETERS as P } from "./parameters.js";
const context: ThalamusContext = { budgetAvailable: false, conversationClaimHeld: false,
  spentFraction: 0, energy: 0.5, tension: 0, circadianPhase: 0 };
const initial = (): ThalamusState => ({ lastNowMs: 0, families: {}, lastSelectedAtMs: {} });
const event = (eventId: string, overrides: Partial<Candidate> = {}): Candidate => ({
  eventId, observedAtMs: 0, source: "external", salience: 1, class: "PRESSURE",
  coalesceKey: "feed", passType: "own_time", refs: [eventId], ...overrides,
});
function habituated(): ThalamusState {
  let state = arbitrate(initial(), [event("initial")], 0, context).state;
  for (let n = 1; n <= 5; n++) state = arbitrate(state, [event(`repeat-${n}`)], 0, context).state;
  return state;
}
describe("attention observation history", () => {
  it("keeps repeat attenuation bounded under duplicate poll permutations", () => {
    for (let repeats = 0; repeats <= 20; repeats++) {
      let state = arbitrate(initial(), [event("initial")], 0, context).state;
      expect(state.families["external:feed"]).toBeDefined();
      for (let n = 1; n <= repeats; n++) {
        const input = event(`repeat-${String(n).padStart(2, "0")}`);
        state = arbitrate(state, [input, input], 0, context).state;
        const checkpoint = JSON.stringify(state);
        state = arbitrate(state, [input], 0, context).state;
        expect(JSON.stringify(state)).toBe(checkpoint);
      }
      expect(state.families["external:feed"].response).toBeCloseTo(0.7 ** repeats, 12);
      expect(state.families["external:feed"].response).toBeGreaterThanOrEqual(0);
      expect(state.families["external:feed"].response).toBeLessThanOrEqual(1);
    }
  });

  it("attenuates five genuine repeats without elapsed recovery", () => {
    const state = habituated();
    expect(state.families["external:feed"]).toBeDefined();
    expect(state.families["external:feed"].response).toBeCloseTo(0.7 ** 5, 12);
    expect(state.families["external:feed"].response).toBeLessThanOrEqual(0.2);
  });
  it("does not habituate or accumulate arousal twice for a duplicate", () => {
    const first = arbitrate(initial(), [event("initial")], 0, context).state;
    expect(first.families["external:feed"]).toBeDefined();
    const repeated = arbitrate(first, [event("initial")], 0, context).state;
    expect(repeated).toEqual(first);
  });
  it("ignores an out-of-order observation without rewinding its watermark", () => {
    const first = arbitrate(initial(), [event("new", { observedAtMs: 100, salience: 0.1 })], 100, context).state;
    const result = arbitrate(first, [event("old", { observedAtMs: 99 })], 100, { ...context, budgetAvailable: true });
    expect(result.decision.kind).toBe("none");
    expect(result.state.families["external:feed"].lastEventId).toBe("new");
  });
  it("recovers responsiveness and leaks arousal only over forward elapsed time", () => {
    const state = habituated();
    expect(state.families["external:feed"]).toBeDefined();
    const recovered = arbitrate(state, [event("repeat-5")], P.habituationRecoveryMs.default, context).state;
    expect(recovered.families["external:feed"].response).toBeCloseTo(1 - (1 - 0.7 ** 5) * Math.exp(-1), 12);
    const rolledBack = arbitrate(recovered, [event("repeat-5")], 0, context).state;
    expect(rolledBack).toEqual(recovered);
    expect(recovered.families["external:feed"].arousal).toBeLessThan(state.families["external:feed"].arousal);
  });
  it("partially restores another nucleus after a new strong observation once", () => {
    const state = habituated();
    expect(state.families["external:feed"]).toBeDefined();
    const different = event("social-new", { source: "social", coalesceKey: "room", passType: "conversation" });
    const restored = arbitrate(state, [different], 0, context).state;
    expect(restored.families["external:feed"].response).toBeCloseTo(0.7 ** 5 + (1 - 0.7 ** 5) * 0.5, 12);
    expect(arbitrate(restored, [different], 0, context).state).toEqual(restored);
  });
  it("does not share mutable family state with the input checkpoint", () => {
    const state = habituated();
    expect(state.families["external:feed"]).toBeDefined();
    const before = JSON.stringify(state);
    const result = arbitrate(state, [event("repeat-6")], 0, context);
    expect(JSON.stringify(state)).toBe(before);
    expect(result.state.families["external:feed"]).not.toBe(state.families["external:feed"]);
  });
});
