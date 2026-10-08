import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { grantPerson } from "../relationship/social-authority.js";
import { recordDiscordNames } from "../places/places.js";
import { thoughtPlaces } from "../places/thought.js";
import {
  isLearnedClaims, lessonExists, lessonsForThought, lessonsToBringHome, listTeachers, markLessonBroughtHome, recordLessons,
  setTeacher, teacherForThought, LESSONS_WINDOW_MS,
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
      setTeacher(sidecar, "p1", true, NOW);
      setTeacher(sidecar, "p1", true, NOW + 1);
      expect(teacherForThought(sidecar, "p1")).toEqual({ name: "Jeff" });
      expect(listTeachers(sidecar)).toEqual(["p1"]);
      setTeacher(sidecar, "p1", false, NOW + 1);
      expect(teacherForThought(sidecar, "p1")).toBeUndefined();
    } finally { close(); }
  });

  it("keeps lessons once per turn, bound to who taught them and where, and shows the last week to her own time", () => {
    const { sidecar, nuclear, close } = world();
    try {
      setTeacher(sidecar, "p1", true, NOW);
      recordLessons(sidecar, { cycleId: "old", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW - LESSONS_WINDOW_MS - 1,
        claims: [{ what: "an old lesson" }] });
      recordLessons(sidecar, { cycleId: "c1", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW - 60_000,
        claims: [{ what: "Autonomous agents fail most at long-horizon credit assignment", curiousAbout: "how memory changes that" }] });
      recordLessons(sidecar, { cycleId: "c1", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW, claims: [{ what: "a replay of the same turn" }] });
      recordLessons(sidecar, { cycleId: "c2", fromPrincipal: "p2", placeRef: "contact:p2", nowMs: NOW, claims: [{ what: "fractal palettes repeat" }] });
      expect(lessonsForThought(sidecar, NOW)).toEqual([
        { lessonId: "lesson:c1:0", from: "Jeff", fromTeacher: true, place: "Jeff", what: "Autonomous agents fail most at long-horizon credit assignment",
          curiousAbout: "how memory changes that", atMs: NOW - 60_000 },
        { lessonId: "lesson:c2:0", from: "Mara", place: "Mara", what: "fractal palettes repeat", atMs: NOW },
      ]);
      expect(thoughtPlaces(sidecar, nuclear, { nowMs: NOW })!.lessons).toHaveLength(2);
    } finally { close(); }
  });

  it("offers lessons to take home oldest first, for the window, until one comes home once", () => {
    const { sidecar, close } = world();
    try {
      setTeacher(sidecar, "p1", true, NOW);
      recordLessons(sidecar, { cycleId: "stale", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW - LESSONS_WINDOW_MS - 1,
        claims: [{ what: "out of the window" }] });
      recordLessons(sidecar, { cycleId: "c1", fromPrincipal: "p1", placeRef: "contact:p1", nowMs: NOW - 2_000,
        claims: [{ what: "first lesson" }, { what: "second lesson" }] });
      recordLessons(sidecar, { cycleId: "c2", fromPrincipal: "p2", placeRef: "contact:p2", nowMs: NOW, claims: [{ what: "newest lesson" }] });
      expect(lessonsToBringHome(sidecar, NOW, 2).map((item) => item.lessonId)).toEqual(["lesson:c1:0", "lesson:c1:1"]);
      expect(lessonsToBringHome(sidecar, NOW, 10).map((item) => item.what))
        .toEqual(["first lesson", "second lesson", "newest lesson"]);
      expect(lessonExists(sidecar, "lesson:c1:0")?.fromPrincipal).toBe("p1");
      expect(lessonExists(sidecar, "lesson:nowhere:0")).toBeNull();

      expect(markLessonBroughtHome(sidecar, "lesson:c1:0", NOW + 1)).toBe(true);
      expect(markLessonBroughtHome(sidecar, "lesson:c1:0", NOW + 2)).toBe(false);
      expect(lessonsToBringHome(sidecar, NOW + 3, 10).map((item) => item.lessonId)).toEqual(["lesson:c1:1", "lesson:c2:0"]);
      // Taken home or not, what she kept still shows her own time.
      expect(lessonsForThought(sidecar, NOW + 3).map((item) => item.what)).toEqual(["first lesson", "second lesson", "newest lesson"]);
      // Once the window has passed, an untaken lesson is no longer offered.
      expect(lessonsToBringHome(sidecar, NOW + LESSONS_WINDOW_MS - 3_000, 10).map((item) => item.lessonId)).toEqual(["lesson:c1:1", "lesson:c2:0"]);
      expect(lessonsToBringHome(sidecar, NOW + LESSONS_WINDOW_MS - 1_000, 10).map((item) => item.lessonId)).toEqual(["lesson:c2:0"]);
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
