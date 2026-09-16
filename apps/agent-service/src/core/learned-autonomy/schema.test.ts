import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { validateNuclearSchemaContent } from "../cognition/schema-contract.js";
import { C3_INDEXES, C3_TABLES } from "./migration-37.js";
import { MIGRATION_30_CANDIDATE_CHANGESET_DDL } from "../sandbox/migration-30.js";

function resetCandidateTablesToV48(db: DatabaseSync): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_candidate_changesets_origin_child;
    DROP INDEX IF EXISTS idx_candidate_changesets_entity_uuid;
    DROP INDEX IF EXISTS idx_candidate_changesets_owner_status;
    DROP INDEX IF EXISTS idx_candidate_changeset_events_entity_uuid;
    DROP INDEX IF EXISTS idx_candidate_changeset_events_changeset;
    DROP TABLE IF EXISTS candidate_changeset_events;
    DROP TABLE IF EXISTS candidate_changesets;
    ${MIGRATION_30_CANDIDATE_CHANGESET_DDL}
    ALTER TABLE candidate_changesets ADD COLUMN origin_child_task_id TEXT;
    CREATE UNIQUE INDEX idx_candidate_changesets_origin_child
      ON candidate_changesets (origin_child_task_id)
      WHERE origin_child_task_id IS NOT NULL;
  `);
}

describe("C3 additive schema", () => {
  it("creates typed influence, evidence, receipt, and seed-lineage tables", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // The historical C3 packet recorded v42. Current source also includes
      // W4 migrations v43 through v47; db.ts is the live schema authority.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(49);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: NUCLEAR_SUPPORTED_VERSION,
      });
      for (const table of C3_TABLES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(table)).toEqual({ 1: 1 });
      }
      for (const index of C3_INDEXES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        ).get(index)).toEqual({ 1: 1 });
      }
      const state = db.prepare(
        "SELECT wave, highest_contract_version, live_authority_existed, state FROM cognitive_maturation_contract_state WHERE wave = 'c3'",
      ).get();
      expect(state).toEqual({
        wave: "c3",
        highest_contract_version: 1,
        live_authority_existed: 0,
        state: "observe",
      });
      const motivationSql = String(db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'motivations'",
      ).get()?.sql ?? "").toLowerCase();
      expect(motivationSql).toContain("learned_interest");
    } finally {
      db.close();
    }
  });

  it("rejects a C5 object when a v39 reader validates newer content", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      resetCandidateTablesToV48(db);
      db.exec("PRAGMA user_version = 39");
      expect(() => validateNuclearSchemaContent(db, 39, { rejectNewerContent: true }))
        .toThrow(/unexpected_v40/);
    } finally {
      db.close();
    }
  });
});
