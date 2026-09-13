import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { collectMotivations } from "../agency/motivations.js";
import { motivationCurrentlyEligible, selectMotivationCandidates } from "../agency/candidate-selection.js";
import { demoteLearnedInfluence } from "./admit.js";
import { admitAndAccept, c1Assertion, evidence, OWNER_ID } from "./test-fixtures.js";

describe("C3 Agency learned-interest motivations", () => {
  it("admits learned interests only in dark apply and rechecks stale candidates", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, { text: "compiler systems", observedAt: "2026-08-01T00:00:00.000Z" });
      const second = c1Assertion(db, { text: "compiler design", observedAt: "2026-08-02T00:00:00.000Z" });
      const learned = admitAndAccept(db, [
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ]);
      const observe = collectMotivations(db, OWNER_ID, "proactive");
      expect(observe.some((item) => item.kind === "learned_interest")).toBe(false);
      const dark = collectMotivations(db, OWNER_ID, "proactive", undefined, undefined, {
        learnedAutonomyMode: "dark_apply",
      });
      const learnedMotivation = dark.find((item) => item.kind === "learned_interest");
      expect(learnedMotivation).toMatchObject({
        refType: "learned_influence",
        refId: String(learned.id),
      });
      expect(db.prepare(
        "SELECT choice_kind, learned_id FROM learned_choice_receipts WHERE choice_kind = 'motivation_admission'",
      ).get()).toMatchObject({ learned_id: learned.id });
      expect(motivationCurrentlyEligible(db, OWNER_ID, learnedMotivation!, new Date(), "dark_apply"))
        .toBe(true);

      demoteLearnedInfluence(db, learned.id, "contradiction");
      expect(motivationCurrentlyEligible(db, OWNER_ID, learnedMotivation!, new Date(), "dark_apply"))
        .toBe(false);
      expect(selectMotivationCandidates(
        db,
        OWNER_ID,
        "proactive",
        [learnedMotivation!],
        new Date(),
        { learnedAutonomyMode: "dark_apply" },
      )).toEqual([]);
    } finally {
      db.close();
    }
  });
});
