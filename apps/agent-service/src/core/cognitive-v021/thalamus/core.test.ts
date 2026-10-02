// Deterministic timing tests do not grant execution authority or author meaning.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Candidate, ThalamusState, ThalamusContext } from "./core.js";
const modulePath = "./core.js";
const loaded = existsSync(new URL("./core.ts", import.meta.url))
  ? await import(/* @vite-ignore */ modulePath) : undefined;
function run(candidates: Candidate[], now = 0, state?: ThalamusState, context: Partial<ThalamusContext> = {}) {
  expect(loaded?.arbitrate, "pure arbiter must exist").toBeTypeOf("function");
  return loaded.arbitrate(state ?? { lastNowMs: 0, families: {}, lastSelectedAtMs: {} }, candidates, now, {
    budgetAvailable: true, conversationClaimHeld: false, spentFraction: 0, energy: 0.5,
    tension: 0, circadianPhase: 0, ...context,
  });
}
function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { eventId: "event-1", observedAtMs: 0, source: "external", salience: 0.5,
    class: "PRESSURE", coalesceKey: "feed", passType: "own_time", refs: ["observation:1"], ...overrides };
}
describe("pure attention arbitration", () => {
  it("selects at the exact threshold but not below it", () => {
    expect(run([candidate()]).decision.kind).toBe("fire");
    expect(run([candidate({ salience: 0.499 })]).decision.kind).toBe("none");
  });
  it("holds ordinary pressure during conversation but keeps mandatory work", () => {
    expect(run([candidate()], 0, undefined, { conversationClaimHeld: true }).decision.kind).toBe("none");
    expect(run([candidate({ class: "ALWAYS_THROUGH", salience: 0 })], 0, undefined,
      { conversationClaimHeld: true }).decision.kind).toBe("fire");
  });
  it("makes a commitment mandatory exactly at due time", () => {
    const due = candidate({ source: "prospective", salience: 0, deadlineMs: 100 });
    expect(run([due], 99).decision.kind).toBe("none");
    expect(run([due], 100).decision.kind).toBe("fire");
  });
  it("preserves zero-salience coverage edges ahead of NIGHT", () => {
    const reflective = candidate({ source: "reflective", passType: "afterglow", class: "ALWAYS_THROUGH", salience: 0 });
    const sleep = candidate({ source: "sleep", passType: "night", eventId: "night", class: "ALWAYS_THROUGH", salience: 1 });
    expect(run([sleep, reflective]).decision.passType).toBe("afterglow");
    expect(run([sleep, reflective]).decision.pending.map((c: Candidate) => c.eventId)).toContain("night");
  });
  it("keeps mandatory obligations when budget refuses execution", () => {
    const result = run([candidate({ class: "ALWAYS_THROUGH" })], 0, undefined, { budgetAvailable: false });
    expect(result.decision.kind).toBe("none");
    expect(result.decision.reason).toBe("budget");
    expect(result.decision.pending).toHaveLength(1);
    expect(result.state.lastSelectedAtMs.external).toBeUndefined();
  });
  it("coalesces compatible passes and retains incompatible candidates", () => {
    const a = candidate({ eventId: "a", salience: 0.8 });
    const b = candidate({ eventId: "b", coalesceKey: "other", refs: ["observation:2"] });
    const c = candidate({ eventId: "c", source: "sleep", passType: "night", salience: 0.7 });
    const result = run([c,b,a]);
    expect(result.decision.bundle.map((v: Candidate) => v.eventId)).toEqual(["a", "b"]);
    expect(result.decision.pending.map((v: Candidate) => v.eventId)).toEqual(["c"]);
  });
  it("does not let opportunistic context create a wake", () => {
    expect(run([candidate({ class: "OPPORTUNISTIC", salience: 1 })]).decision.kind).toBe("none");
    const result = run([candidate({ class: "OPPORTUNISTIC", eventId: "opportunistic", coalesceKey: "extra" }), candidate()]);
    expect(result.decision.bundle).toHaveLength(2);
  });
  it("leaves inputs unchanged and makes ties independent of arrival order", () => {
    const a = candidate({ eventId: "a", coalesceKey: "a" });
    const b = candidate({ eventId: "b", coalesceKey: "b" });
    const inputs = [a,b];
    const before = JSON.stringify(inputs);
    expect(run(inputs)).toEqual(run([b,a]));
    expect(JSON.stringify(inputs)).toBe(before);
  });
  it("rejects Owner routing through the arbiter", () => {
    expect(() => run([candidate({ source: "owner" as Candidate["source"] })])).toThrow("thalamus_owner_ingress_required");
  });
});
