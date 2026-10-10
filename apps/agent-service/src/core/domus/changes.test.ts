import { describe, expect, it } from "vitest";
import { compareDomusReads } from "./changes.js";

const needs = (hunger: [number, string], energy: [number, string]) => ({
  hunger: { value: hunger[0], band: hunger[1] }, energy: { value: energy[0], band: energy[1] },
});
const walker = (name: string, distance: number) => ({ name, id: name, on_lot: false, distance_m: distance, doing: "standing" });
const base = {
  time: { hour: 13, minute: 42 }, needs: needs([40, "ok"], [80, "ok"]), mood: "Calm", posture: "stand",
  zone: { lot_id: "L1", room: "3", zone_id: "Z" }, moodlets: [{ name: "Buff_A", text: "Rested" }], running: ["standing"],
  company: [walker("Passer", 80)], asked: [], self: { money: 100 }, place: { her_home: true },
};
const fridge = { object: "Fridge", object_id: "o1", acts: [{ ref: "a1", guid64: "g1", text: "Have a bite" }] };
const quietInput = { actNews: 0, perceptKinds: ["presence", "need"], urgent: false };

describe("H0.4 what changed since her last pass", () => {
  it("is quiet when only the clock, need values and people passing off the lot moved", () => {
    const now = { ...base, time: { hour: 14, minute: 5 }, needs: needs([38, "ok"], [76, "ok"]),
      company: [walker("Passer", 35), walker("Stranger", 90)] };
    expect(compareDomusReads({ portrait: base, options: [fridge] }, { portrait: now, options: [{ ...fridge, acts: [{ ...fridge.acts[0]!, ref: "a7" }] }] }, quietInput))
      .toEqual({ quiet: true, unchanged: ["needs", "mood", "posture", "room", "feelings", "doing", "people", "asked", "options", "acts"] });
  });

  it("names each change as before and now, and what stayed", () => {
    const now = {
      ...base, needs: needs([20, "low"], [80, "ok"]), mood: "Down", zone: { lot_id: "L1", room: "12", zone_id: "Z" },
      moodlets: [{ name: "Buff_B", text: "Lonely" }], running: ["sit", "chat"],
      company: [walker("Passer", 30), { ...walker("Travis", 2), on_lot: true }], asked: [{ title: "Pick a recipe" }],
    };
    const stove = { object: "Stove", object_id: "o2", acts: [{ ref: "a2", guid64: "g2", text: "Make food" }] };
    expect(compareDomusReads({ portrait: base, options: [fridge] }, { portrait: now, options: [stove] }, quietInput)).toEqual({
      needs: { hunger: "ok → low" }, mood: "Calm → Down", room: "3 → 12",
      feelings: { gained: ["Lonely"], lost: ["Rested"] }, doing: { gained: ["sit", "chat"], lost: ["standing"] },
      people: { gained: ["Travis"] }, asked: { gained: ["Pick a recipe"] }, options: { gained: ["Stove"], lost: ["Fridge"] },
      unchanged: ["posture", "acts"],
    });
  });

  it("tells two heard strangers apart by their handle, so one leaving while another comes is a change", () => {
    const heard = (handle: string) => ({ heard: true, handle, room: "4", distance_m: 6, on_lot: true });
    const was = { ...base, company: [heard("a1b2c3d4")] };
    const now = { ...base, company: [heard("e5f6a7b8")] };
    expect(compareDomusReads({ portrait: was, options: [] }, { portrait: now, options: [] }, quietInput).people)
      .toEqual({ gained: ["someone heard (#e5f6)"], lost: ["someone heard (#a1b2)"] });
    expect(compareDomusReads({ portrait: was, options: [] }, { portrait: { ...was }, options: [] }, quietInput).people).toBeUndefined();
  });

  it("counts act news, other portrait parts, a new lot, senses it does not compare and urgency", () => {
    const now = { ...base, self: { money: 80 }, zone: { lot_id: "L2", room: "3", zone_id: "Z" }, place: { her_home: false }, paused: true, more_nearby: true };
    const changes = compareDomusReads({ portrait: base, options: [] }, { portrait: now, options: [] },
      { actNews: 2, perceptKinds: ["presence", "gap", "lineage"], urgent: true });
    expect(changes).toMatchObject({ actNews: 2, other: ["place", "self", "lot", "sense:gap", "sense:lineage", "urgent"] });
    expect(changes.quiet).toBeUndefined();
  });

  it("an object with a new action counts as gained", () => {
    const more = { ...fridge, acts: [...fridge.acts, { ref: "a2", guid64: "g9", text: "Make food" }] };
    expect(compareDomusReads({ portrait: base, options: [fridge] }, { portrait: base, options: [more] }, quietInput).options)
      .toEqual({ gained: ["Fridge"] });
  });
});
