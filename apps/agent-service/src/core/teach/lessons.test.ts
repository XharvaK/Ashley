import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { grantPerson } from "../relationship/social-authority.js";
import { recordDiscordNames } from "../places/places.js";
import { thoughtPlaces } from "../places/thought.js";
import {
  isLearnedClaims, lessonsForThought, listTeachers, recordLessons, setTeacher, teacherForThought, LESSONS_WINDOW_MS,
} from "./lessons.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");

function world() {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  grantPerson(nuclear, { ownerId: "owner", principalId: "p1", scope: "person_wide", sourceSpan: { source: "test" }, nowMs: NOW });
  recordDiscordNames(sidecar, [{ kind: "user", id: "p1", name: "Jeff" }, { kind: "user", id: "p2", name: "Mara" }], NOW);
  return { sidecar, nuclear, close: () => { nuclear.close(); sidecar.close(); } };
}

describe("T her teachers and what she keeps", () => {
  it("knows who the Owner made her teacher, and forgets the role when it is taken away", () => {
    const { sidecar, close } = world();
    try {
      expect(teacherForThought(sidecar, "p1")).toBeUndefined();
      setTeacher(sidecar, "p1", "science", NOW);
      expect(teacherForThought(sidecar, "p1")).toEqual({ name: "Jeff", teaches: "science" });
      expect(listTeachers(sidecar)).toEqual([{ principalId: "p1", teaches: "science" }]);
      setTeacher(sidecar, "p1", null, NOW + 1);
      expect(teacherForThought(sidecar, "p1")).toBeUndefined();
    } finally { close(); }
  });

  it("keeps lessons once per turn, bound to who taught them and where, and shows the last week to her own time", () => {
    const { sidecar, nuclear, close } = world();
    try {
      setTeacher(sidecar, "p1", "science", NOW);
      recordLessons(sidecar, { cycleId: "old", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW - LESSONS_WINDOW_MS - 1,
        claims: [{ what: "an old lesson" }] });
      recordLessons(sidecar, { cycleId: "c1", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW - 60_000,
        claims: [{ what: "Autonomous agents fail most at long-horizon credit assignment", curiousAbout: "how memory changes that" }] });
      recordLessons(sidecar, { cycleId: "c1", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW, claims: [{ what: "a replay of the same turn" }] });
      recordLessons(sidecar, { cycleId: "c2", fromPrincipal: "p2", placeRef: "contact:p2", nowMs: NOW, claims: [{ what: "fractal palettes repeat" }] });
      expect(lessonsForThought(sidecar, NOW)).toEqual([
        { from: "Jeff", teaches: "science", place: "Jeff", what: "Autonomous agents fail most at long-horizon credit assignment",
          curiousAbout: "how memory changes that", atMs: NOW - 60_000 },
        { from: "Mara", place: "Mara", what: "fractal palettes repeat", atMs: NOW },
      ]);
      expect(thoughtPlaces(sidecar, nuclear, { nowMs: NOW })!.lessons).toHaveLength(2);
    } finally { close(); }
  });

  it("validates what she keeps", () => {
    expect(isLearnedClaims([{ what: "a", curiousAbout: "b" }])).toBe(true);
    expect(isLearnedClaims([])).toBe(false);
    expect(isLearnedClaims([{ what: "" }])).toBe(false);
    expect(isLearnedClaims([{ what: "a", from: "p1" }])).toBe(false);
    expect(isLearnedClaims([{ what: "a" }, { what: "b" }, { what: "c" }, { what: "d" }])).toBe(false);
  });
});
