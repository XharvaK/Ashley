import { describe, expect, it } from "vitest";
import { endingOf } from "./endings.js";

const COMPLETED = ["NATURAL", "SI_FINISHED", "CONDITIONAL_EXIT", "AUTO_EXIT"];

const CUT_SHORT: Array<[string, string]> = [
  ["INTERACTION_INCOMPATIBILITY", "something the game had to do first took its place"],
  ["DISPLACED", "another action replaced it"],
  ["PRIORITY", "something more urgent took its place"],
  ["USER_CANCEL", "it was cancelled (by you or at the controls)"],
  ["FAILED_TESTS", "the game decided it could not happen now"],
  ["TRANSITION_FAILURE", "she could not get there or into position"],
  ["OBJECT_CHANGED", "the object changed"],
  ["RESET", "the game stopped it"],
  ["KILLED", "the game stopped it"],
  ["SOCIALS", "the conversation ended it"],
  ["INTERACTION_QUEUE", "it waited in the queue and was dropped"],
  ["WAIT_IN_LINE", "it waited in the queue and was dropped"],
  ["SITUATIONS", "an event in the game ended it"],
];

const EARLY = { ended: "cut_short", why: "the game ended it early" };

function spellings(name: string): string[] {
  return [name, `FinishingType.${name}`];
}

describe("a finished act, read plainly", () => {
  it("reads a full run as completed, either spelling, with no why", () => {
    for (const name of COMPLETED) {
      for (const spelling of spellings(name)) {
        expect(endingOf(spelling)).toEqual({ ended: "completed" });
      }
    }
  });

  it("reads a question the game opened, and an answer to one, either spelling", () => {
    const asked = { ended: "asked", why: "it opened the game's question; answering it is what starts the action" };
    for (const spelling of spellings("ASKED")) expect(endingOf(spelling)).toEqual(asked);
    for (const spelling of spellings("ANSWERED")) expect(endingOf(spelling)).toEqual({ ended: "answered" });
    expect(asked.why.length).toBeLessThan(80);
  });

  it("reads an act the game cut short in plain words, either spelling", () => {
    for (const [name, why] of CUT_SHORT) {
      expect(why.length).toBeLessThan(80);
      for (const spelling of spellings(name)) expect(endingOf(spelling)).toEqual({ ended: "cut_short", why });
    }
  });

  it("reads an unknown or missing ending as cut short, never completed", () => {
    for (const name of ["LIABILITY", "CRAFTING", "DIALOG", "NO_SUCH"]) {
      for (const spelling of spellings(name)) expect(endingOf(spelling)).toEqual(EARLY);
    }
    for (const missing of [undefined, null, "", 0]) expect(endingOf(missing)).toEqual(EARLY);
    expect(EARLY.why.length).toBeLessThan(80);
  });
});

describe("an act the game ended before it began (probe 2.24.0 started:false)", () => {
  it("says it never began, with the game's no-way reading for incompatibility", () => {
    expect(endingOf("FinishingType.INTERACTION_INCOMPATIBILITY", false)).toEqual({
      ended: "cut_short", why: "it never began: the game found no way for her to do it from where she was" });
    expect(endingOf("DISPLACED", false)).toEqual({ ended: "cut_short", why: "it never began: another action replaced it" });
    expect(endingOf("SOMETHING_NEW", false)).toEqual({ ended: "cut_short", why: "it never began: the game ended it early" });
  });

  it("leaves a started or unreported act as before, and a completion is still a completion", () => {
    expect(endingOf("INTERACTION_INCOMPATIBILITY", true)).toEqual({ ended: "cut_short", why: "something the game had to do first took its place" });
    expect(endingOf("INTERACTION_INCOMPATIBILITY")).toEqual({ ended: "cut_short", why: "something the game had to do first took its place" });
    expect(endingOf("NATURAL", false)).toEqual({ ended: "completed" });
  });
});
