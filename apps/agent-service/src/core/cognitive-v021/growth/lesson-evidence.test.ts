import { describe, expect, it } from "vitest";
import { recordLessons } from "../../teach/lessons.js";
import { openTestSidecar } from "../test-support.js";
import { LESSON_ORIGIN_WINDOW_MS, proposeRevisions, resolveRevisionEvidence, revisionEvidenceStats } from "./revisions.js";

const DAY = 24 * 60 * 60_000;
const T0 = Date.UTC(2026, 9, 1, 12, 0);

function propose(db: ReturnType<typeof openTestSidecar>, cycleId: string, layer: "opinion" | "value" | "taste", evidenceRefs: string[], nowMs: number, topic = "dub techno") {
  return proposeRevisions(db, {
    cycleId,
    proposals: [{ layer, topic, text: "Dub techno sounds best late.", rationale: "a teacher said so", evidenceRefs }],
    identity: null,
    nowMs,
  })[0]!;
}

describe("T-growth: a lesson is evidence for opinion, practice and taste, once per teacher per window", () => {
  it("resolves a lesson however old it is, because the teaching window never ages evidence out", () => {
    const db = openTestSidecar();
    try {
      recordLessons(db, { cycleId: "old", fromPrincipal: "p-teacher", placeRef: "contact:p-teacher", nowMs: T0 - 60 * DAY, claims: [{ what: "old lesson" }] });
      expect(resolveRevisionEvidence(db, "lesson:old:0")).toEqual({ ref: "lesson:old:0", atMs: T0 - 60 * DAY, dataClassification: "ordinary" });
      expect(resolveRevisionEvidence(db, "lesson:missing:0")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("is evidence for an opinion, but never for a value", () => {
    const db = openTestSidecar();
    try {
      recordLessons(db, { cycleId: "t1", fromPrincipal: "p-teacher", placeRef: "contact:p-teacher", nowMs: T0, claims: [{ what: "dub techno is late-night music" }] });
      expect(propose(db, "c-value", "value", ["lesson:t1:0"], T0)).toEqual({ outcome: "no_evidence" });
      const opinion = propose(db, "c-opinion", "opinion", ["lesson:t1:0"], T0);
      expect(opinion).toMatchObject({ outcome: "proposed" });
    } finally {
      db.close();
    }
  });

  it("counts one origin per teacher inside the window, and a second once the window has passed", () => {
    const db = openTestSidecar();
    try {
      recordLessons(db, { cycleId: "a", fromPrincipal: "p-teacher", placeRef: "contact:p-teacher", nowMs: T0, claims: [{ what: "first" }] });
      recordLessons(db, { cycleId: "b", fromPrincipal: "p-teacher", placeRef: "contact:p-teacher", nowMs: T0 + 2 * DAY, claims: [{ what: "second" }] });
      recordLessons(db, { cycleId: "c", fromPrincipal: "p-teacher", placeRef: "contact:p-teacher", nowMs: T0 + LESSON_ORIGIN_WINDOW_MS + DAY, claims: [{ what: "later" }] });
      const { revisionId } = propose(db, "c-a", "opinion", ["lesson:a:0", "lesson:b:0"], T0) as { revisionId: number };
      expect(revisionEvidenceStats(db, revisionId).count).toBe(1);
      propose(db, "c-c", "opinion", ["lesson:c:0"], T0 + LESSON_ORIGIN_WINDOW_MS + DAY);
      expect(revisionEvidenceStats(db, revisionId).count).toBe(2);
    } finally {
      db.close();
    }
  });

  it("counts lessons from two teachers as two origins", () => {
    const db = openTestSidecar();
    try {
      recordLessons(db, { cycleId: "a", fromPrincipal: "p-one", placeRef: "contact:p-one", nowMs: T0, claims: [{ what: "one" }] });
      recordLessons(db, { cycleId: "b", fromPrincipal: "p-two", placeRef: "contact:p-two", nowMs: T0 + DAY, claims: [{ what: "two" }] });
      const { revisionId } = propose(db, "c-a", "taste", ["lesson:a:0", "lesson:b:0"], T0 + DAY) as { revisionId: number };
      expect(revisionEvidenceStats(db, revisionId).count).toBe(2);
    } finally {
      db.close();
    }
  });
});
