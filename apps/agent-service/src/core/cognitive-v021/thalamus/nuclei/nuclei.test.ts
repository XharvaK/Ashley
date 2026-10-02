// Nuclei convert existing mechanical facts to candidates, without clocks or semantic choices.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
const names = ["reflective", "sleep", "prospective", "external", "boredom", "interoceptive", "social"];
const modules: Record<string, any> = {};
for (const name of names) {
  const path = `./${name}.js`;
  modules[name] = existsSync(new URL(`./${name}.ts`, import.meta.url)) ? await import(/* @vite-ignore */ path) : undefined;
}
function fn(name: string) {
  expect(modules[name]?.[name], `${name} adapter must exist`).toBeTypeOf("function");
  return modules[name][name];
}
const fact = { eventId: "fixture:event", observedAtMs: 0, refs: ["fixture:fact"] };
describe("deterministic nuclei", () => {
  it("makes the authoritative40-row coverage edge mandatory despite zero quiet time", () => {
    expect(fn("reflective")({ ...fact, unreflectedRows: 40, lastMessageAtMs: 0, appraisalMagnitude: 0 }, 0))
      .toMatchObject({ source: "reflective", class: "ALWAYS_THROUGH", passType: "afterglow" });
    expect(fn("reflective")({ ...fact, unreflectedRows: 0, lastMessageAtMs: 0, appraisalMagnitude: 0 }, 0)).toBeNull();
  });
  it("raises reflection pressure with quiet and supplied appraisal without reading text", () => {
    const input = { ...fact, unreflectedRows: 10, lastMessageAtMs: 0, appraisalMagnitude: 0 };
    expect(fn("reflective")(input, 3_600_000).salience).toBeGreaterThan(fn("reflective")(input, 1_800_000).salience);
    expect(fn("reflective")({ ...input, appraisalMagnitude: 1 }, 1_800_000).salience).toBeGreaterThan(fn("reflective")(input, 1_800_000).salience);
  });
  it("never creates sleep pressure from elapsed time alone", () => {
    const input = { ...fact, episodes: 0, memories: 0, rows: 0, openRevisions: 0, expectations: 0, quietHour: 4, currentLocalHour: 4 };
    expect(fn("sleep")(input)).toBeNull();
    expect(fn("sleep")({ ...input, rows: 101 })).toMatchObject({ class: "ALWAYS_THROUGH", passType: "night" });
    expect(fn("sleep")({ ...input, rows: 100 }).class).toBe("PRESSURE");
  });
  it("uses learned local quiet preference only to shape actual work pressure", () => {
    const input = { ...fact, episodes: 1, memories: 1, rows: 10, openRevisions: 0, expectations: 0, quietHour: 4, currentLocalHour: 4 };
    expect(fn("sleep")(input).salience).toBeGreaterThan(fn("sleep")({ ...input, currentLocalHour: 16 }).salience);
  });
  it("keeps authored deadlines and excludes unmatched/suppress watches", () => {
    const items = [{ ...fact, kind: "commitment", dueAtMs: 100 }, { ...fact, eventId: "watch", kind: "watch", matched: false, action: "wake" }];
    expect(fn("prospective")(items, 99)).toHaveLength(1);
    expect(fn("prospective")(items, 99)[0]).toMatchObject({ deadlineMs: 100, class: "PRESSURE" });
    expect(fn("prospective")(items, 100)[0].class).toBe("ALWAYS_THROUGH");
    expect(fn("prospective")([{ ...fact, kind: "watch", matched: true, action: "suppress" }], 100)).toEqual([]);
  });
  it("uses curiosity influence only with an eligible apply-mode binding", () => {
    const input = { ...fact, subscriptionId: "feed", subscriptionCurrent: true, novelty: 0.5, interestMatch: 0.5, influenceEligible: true };
    const observe = fn("external")(input, "observe");
    expect(observe.salience).toBe(0.25);
    expect(fn("external")(input, "dark_apply").salience).toBe(observe.salience);
    expect(fn("external")(input, "apply").salience).toBeGreaterThan(observe.salience);
    expect(fn("external")({ ...input, influenceEligible: false }, "apply").salience).toBe(observe.salience);
    expect(fn("external")({ ...input, subscriptionCurrent: false }, "apply")).toBeNull();
  });
  it("slows boredom after resting and never creates idle time during rollback", () => {
    const input = { ...fact, idleSinceMs: 0, energy: 0.5, openness: 0.5, agendaPressure: 0, resting: false };
    expect(fn("boredom")(input, 10_800_000).salience).toBe(0.5);
    expect(fn("boredom")({ ...input, resting: true }, 10_800_000).salience).toBeLessThan(0.5);
    expect(fn("boredom")(input, -1)).toBeNull();
  });
  it("reacts only to changed known bands not covered by an active decline", () => {
    const reading = { ...fact, sense: "backup", band: "stale", previousBand: "aging", declinedBand: "stale", declineUntilMs: 100 };
    expect(fn("interoceptive")([reading], 99)).toEqual([]);
    expect(fn("interoceptive")([reading], 100)).toHaveLength(1);
    expect(fn("interoceptive")([{ ...reading, band: "unknown" }], 100)).toEqual([]);
    expect(fn("interoceptive")([{ ...reading, previousBand: "stale" }], 100)).toEqual([]);
  });
  it("keeps Owner out and preserves existing contact eligibility and fuse gates", () => {
    const input = { ...fact, coalesceKey: "fixture:room", isOwner: false, eligible: true, fuseAvailable: true, relationshipBasis: 1, addressedToHer: 1, novelty: 1 };
    expect(fn("social")({ ...input, isOwner: true })).toBeNull();
    expect(fn("social")({ ...input, eligible: false })).toBeNull();
    expect(fn("social")({ ...input, fuseAvailable: false })).toBeNull();
    expect(fn("social")(input)).toMatchObject({ source: "social", salience: 1, passType: "conversation" });
  });
});
