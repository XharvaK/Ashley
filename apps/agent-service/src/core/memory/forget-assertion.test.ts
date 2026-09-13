import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { upsertFact } from "./facts.js";
import { applyForgetTargets } from "./forget.js";

const OWNER_ID = "doc";

describe("C1 forgetting and assertion linkage", () => {
  it("ends and redacts the linked assertion without treating forget as correction", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
      });
      const fact = db.prepare(
        "SELECT entity_uuid FROM mem_facts WHERE id = ?",
      ).get(factId) as { entity_uuid: string };
      db.exec(`
        CREATE TRIGGER require_assertion_before_forget
        BEFORE UPDATE OF superseded_by ON mem_facts
        WHEN NEW.superseded_by IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM memory_assertions
           WHERE legacy_fact_id = OLD.id AND termination_reason = 'forgotten'
         )
        BEGIN SELECT RAISE(ABORT, 'assertion_not_first_forget'); END;
      `);
      applyForgetTargets(db, OWNER_ID, [{
        entityType: "mem_facts",
        entityUuid: fact.entity_uuid,
        action: "redact",
      }]);

      const assertion = db.prepare(
        `SELECT termination_reason, key, value, source_message_id
         FROM memory_assertions WHERE legacy_fact_id = ?`,
      ).get(factId);
      expect(assertion).toMatchObject({
        termination_reason: "forgotten",
        key: "",
        value: "",
        source_message_id: null,
      });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM memory_corrections",
      ).get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});
