import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { MIGRATION_30_CANDIDATE_CHANGESET_DDL } from "./migration-30.js";
import {
  ensureNuclearV49Schema,
  validateNuclearV49Schema,
} from "./migration-49.js";

function schemaVersion(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0);
}

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
    PRAGMA user_version = 48;
  `);
}

function seedHistoricalAbandonedRow(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO candidate_changesets (
       entity_uuid, owner_id, changeset_id, project_id, workspace_id,
       source_snapshot_id, objective, rationale, risk_class, status,
       review_status, created_at, updated_at, origin_child_task_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'abandoned', NULL, ?, ?, NULL)`,
  ).run(
    "entity-historical",
    "owner-1",
    "cs-historical",
    "project-ashley",
    "workspace-1",
    "snapshot-1",
    "historical candidate",
    "historical reason",
    "low",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO candidate_changeset_events (
       entity_uuid, owner_id, changeset_id, event_type, metadata_json, recorded_at
     ) VALUES (?, ?, ?, 'created', '{}', ?)`,
  ).run("event-historical", "owner-1", "cs-historical", "2026-01-01T00:00:00.000Z");
}

describe("Nuclear schema v49 verification failure", () => {
  it("supports v49 and its verification_failed checks", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(50);
      expect(schemaVersion(db)).toBe(50);
      validateNuclearV49Schema(db);
      ensureNuclearV49Schema(db);
      expect(schemaVersion(db)).toBe(50);

      db.prepare(
        `INSERT INTO candidate_changesets (
           entity_uuid, owner_id, changeset_id, project_id, workspace_id,
           source_snapshot_id, objective, rationale, risk_class, status,
           review_status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verification_failed', NULL, ?, ?)`,
      ).run(
        "entity-v49",
        "owner-1",
        "cs-v49",
        "project-ashley",
        "workspace-v49",
        "snapshot-v49",
        "candidate",
        "verification witness",
        "low",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
      db.prepare(
        `INSERT INTO candidate_changeset_events (
           entity_uuid, owner_id, changeset_id, event_type, recorded_at
         ) VALUES (?, ?, ?, 'verification_failed', ?)`,
      ).run("event-v49", "owner-1", "cs-v49", "2026-01-01T00:00:00.000Z");
    } finally {
      db.close();
    }
  });

  it("migrates v48 rows, preserves abandoned history, double-opens, and rejects v51", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = new DatabaseSync(":memory:");
    try {
      openNuclearDb(db, { continuity, migrate: true });
      resetCandidateTablesToV48(db);
      continuity
        .prepare("UPDATE lineage_state SET nuclear_schema_version = 48 WHERE id = 1")
        .run();
      seedHistoricalAbandonedRow(db);

      openNuclearDb(db, { continuity, migrate: true });
      expect(schemaVersion(db)).toBe(50);
      expect(db.prepare("SELECT status FROM candidate_changesets WHERE changeset_id = 'cs-historical'").get())
        .toEqual({ status: "abandoned" });

      openNuclearDb(db, { continuity, migrate: true });
      expect(schemaVersion(db)).toBe(50);

      db.exec("PRAGMA user_version = 51");
      expect(() => openNuclearDb(db, { continuity, migrate: true }))
        .toThrow("unsupported_nuclear_schema:51>50");
      expect(schemaVersion(db)).toBe(51);
    } finally {
      db.close();
      continuity.close();
    }
  });
});
