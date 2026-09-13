import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { listActiveLearnedInfluences, refreshLearnedInfluenceEligibility } from "./eligibility.js";
import { demoteLearnedInfluence } from "./admit.js";
import {
  OWNER_ID,
  admitAndAccept,
  c1Assertion,
  evidence,
} from "./test-fixtures.js";

describe("C3 derived learned-influence eligibility", () => {
  it("ends influence when a C1 assertion is corrected or barrier-covered", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, {
        text: "compilers",
        observedAt: "2026-08-01T00:00:00.000Z",
      });
      const second = c1Assertion(db, {
        text: "compiler tooling",
        observedAt: "2026-08-02T00:00:00.000Z",
      });
      const learned = admitAndAccept(db, [
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ]);
      expect(listActiveLearnedInfluences(db, OWNER_ID, { mode: "dark_apply" }))
        .toEqual([expect.objectContaining({ id: learned.id })]);

      db.prepare(
        "UPDATE memory_assertions SET termination_reason = 'invalidated', updated_at = ? WHERE id = ?",
      ).run("2026-08-03T00:00:00.000Z", first);
      refreshLearnedInfluenceEligibility(db, learned.id);
      expect(listActiveLearnedInfluences(db, OWNER_ID, { mode: "dark_apply" })).toEqual([]);
      expect(db.prepare(
        "SELECT contradiction_state FROM learned_influences WHERE id = ?",
      ).get(learned.id)).toEqual({ contradiction_state: "owner_corrected" });
    } finally {
      db.close();
    }
  });

  it("does not revive a demoted influence and keeps apply-to-observe rollback semantic-neutral", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, {
        text: "compilers",
        observedAt: "2026-08-01T00:00:00.000Z",
      });
      const second = c1Assertion(db, {
        text: "toolchains",
        observedAt: "2026-08-02T00:00:00.000Z",
      });
      const learned = admitAndAccept(db, [
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ]);
      demoteLearnedInfluence(db, learned.id, "contradictory evidence");
      expect(listActiveLearnedInfluences(db, OWNER_ID, { mode: "dark_apply" })).toEqual([]);
      expect(db.prepare(
        "SELECT contradiction_state, adjudication_state FROM learned_influences WHERE id = ?",
      ).get(learned.id)).toEqual({ contradiction_state: "demoted", adjudication_state: "accepted" });
      expect(listActiveLearnedInfluences(db, OWNER_ID, { mode: "observe" })).toEqual([]);
    } finally {
      db.close();
    }
  });
});
