import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { listActiveLearnedInfluences } from "./eligibility.js";
import { admitAndAccept, c1Assertion, evidence, OWNER_ID } from "./test-fixtures.js";

describe("C3 local settlement witnesses", () => {
  it("proves qualified dark-apply influence and an honest capability rollback", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, { text: "compilers", observedAt: "2026-08-01T00:00:00.000Z" });
      const second = c1Assertion(db, { text: "toolchains", observedAt: "2026-08-02T00:00:00.000Z" });
      const learned = admitAndAccept(db, [
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ]);
      expect(listActiveLearnedInfluences(db, OWNER_ID, { mode: "dark_apply" }))
        .toEqual([expect.objectContaining({ id: learned.id })]);
      expect(listActiveLearnedInfluences(db, OWNER_ID, { mode: "observe" })).toEqual([]);
      expect(db.prepare(
        "SELECT contradiction_state, proposal_lifecycle FROM learned_influences WHERE id = ?",
      ).get(learned.id)).toEqual({ contradiction_state: "none", proposal_lifecycle: "admitted_to_review" });
    } finally {
      db.close();
    }
  });

  it("fails closed when the persisted C3 contract is newer than the candidate", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.prepare(
        "UPDATE cognitive_maturation_contract_state SET highest_contract_version = 99 WHERE wave = 'c3'",
      ).run();
      expect(() => listActiveLearnedInfluences(db, OWNER_ID, { mode: "dark_apply" }))
        .toThrow("learned_autonomy_contract_unsupported");
    } finally {
      db.close();
    }
  });
});
