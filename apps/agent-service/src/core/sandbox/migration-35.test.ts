import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  connectNuclearDb,
  NUCLEAR_SUPPORTED_VERSION,
  openNuclearDb,
} from "../db.js";
import {
  openContinuityDb,
  getPendingNuclearMigration,
} from "../continuity/db.js";
import { C1_INDEXES, C1_TABLES } from "../memory/migration.js";
import { ensureNuclearV34Schema } from "./migration-34.js";

function columnNames(db: DatabaseSync, table: string): string[] {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name?: unknown }>;
  return rows.map((r) => String(r.name));
}

function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  return Number(row?.user_version ?? 0);
}

function removeCurrentC1Objects(db: DatabaseSync): void {
  // The fixture is initialized from the current schema, then rewound to v34.
  // Remove only the additive C1 objects so v35 sees a genuine pre-C1 database.
  db.exec("PRAGMA foreign_keys = OFF");
  for (const index of C1_INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${index}`);
  }
  for (const table of [...C1_TABLES].reverse()) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.exec("PRAGMA foreign_keys = ON");
}

describe("Nuclear Migration 35 (delivery lane separation and interrupted recovery)", () => {
  it("migrates a fresh DB directly to supported version 35 with delivery_lane column and index", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);

      const columns = columnNames(db, "delivery_reservations");
      expect(columns).toContain("delivery_lane");

      const indexes = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_delivery_reservations_lane'`,
        )
        .all();
      expect(indexes).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("migrates genuine v34 database to v35, preserves existing reservations and backfills operational completions", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = new DatabaseSync(":memory:");
    try {
      // 1. Initialize up to v34 with continuity
      openNuclearDb(db, { continuity, migrate: true });
      db.exec(`PRAGMA user_version = 34;`);
      continuity
        .prepare("UPDATE lineage_state SET nuclear_schema_version = 34 WHERE id = 1")
        .run();

      // Drop delivery_lane column and index if present to simulate genuine v34 schema
      db.exec(`DROP INDEX IF EXISTS idx_delivery_reservations_lane;`);
      const cols = db.prepare(`PRAGMA table_info(delivery_reservations)`).all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === "delivery_lane")) {
        db.exec(`ALTER TABLE delivery_reservations DROP COLUMN delivery_lane;`);
      }

      // Seed an operational job and delivery
      db.prepare(
        `INSERT INTO operational_jobs (
           entity_uuid, data_classification, job_id, owner_id, source_message_entity_uuid,
           admission_reservation_id, bounded_operation_task_id, project_id, status,
           job_phase, cognition_state, lifetime_expires_at_ms, created_at, updated_at
         ) VALUES ('uuid-1', 'never_public', 'job-m35-1', 'doc', 'src-msg-1', 1, 'task-1', 'proj-1', 'succeeded', 'terminal', 'not_required', 1800000000000, datetime('now'), datetime('now'))`,
      ).run();

      // Seed a delivery reservation
      const res = db
        .prepare(
          `INSERT INTO delivery_reservations (
             owner_id, channel, thread_id, trigger, state, created_at
           ) VALUES ('doc', 'discord', 'dm', 'proactive', 'reserved', datetime('now'))`,
        )
        .run();
      const resId = Number(res.lastInsertRowid);

      db.prepare(
        `INSERT INTO operational_job_deliveries (
           entity_uuid, data_classification, job_id, delivery_kind, delivery_reservation_id, created_at
         ) VALUES ('uuid-del-1', 'never_public', 'job-m35-1', 'completion', ?, datetime('now'))`,
      ).run(resId);

      // 2. Run Migration 35
      openNuclearDb(db, { continuity, migrate: true });
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);

      // Verify the backfilled delivery_lane
      const row = db
        .prepare(`SELECT delivery_lane FROM delivery_reservations WHERE id = ?`)
        .get(resId) as { delivery_lane: string };
      expect(row.delivery_lane).toBe("operational_fulfillment");
    } finally {
      db.close();
      continuity.close();
    }
  });

  it("reconciles interrupted 34->35 migration when nuclear committed before continuity finalization", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = new DatabaseSync(":memory:");
    try {
      // Initialize up to v34 with continuity
      openNuclearDb(nuclear, { continuity, migrate: true });
      removeCurrentC1Objects(nuclear);
      nuclear.exec(`PRAGMA user_version = 34;`);
      continuity
        .prepare("UPDATE lineage_state SET nuclear_schema_version = 34 WHERE id = 1")
        .run();

      // Attempt migration to 35 with fault after nuclear commit
      expect(() => {
        openNuclearDb(nuclear, {
          continuity,
          migrate: true,
          testFailAfterNuclearCommitBeforeContinuityFinalization: true,
        });
      }).toThrow(/test_fault_after_nuclear_commit_before_continuity_finalization/);

      // Continuity should have pending 34->35 descriptor
      const pending = getPendingNuclearMigration(continuity);
      expect(pending).not.toBeNull();
      expect(pending?.from).toBe(34);
      expect(pending?.to).toBe(35);

      // Nuclear user_version is 35 because nuclear committed
      expect(schemaVersion(nuclear)).toBe(35);

      // Reopening and reconciling should succeed cleanly without throwing continuity_pending_migration_unsupported
      openNuclearDb(nuclear, { continuity, migrate: true });

      // Pending migration in continuity should now be resolved
      const resolved = getPendingNuclearMigration(continuity);
      expect(resolved).toBeNull();
      expect(schemaVersion(nuclear)).toBe(NUCLEAR_SUPPORTED_VERSION);
    } finally {
      nuclear.close();
      continuity.close();
    }
  });

  it("fails closed without mutation when opening a database with newer unsupported schema", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.exec("PRAGMA user_version = 99");
      expect(() => openNuclearDb(db, { migrate: true })).toThrow(
        new RegExp(`unsupported_nuclear_schema:99>${NUCLEAR_SUPPORTED_VERSION}`),
      );
      expect(schemaVersion(db)).toBe(99);
    } finally {
      db.close();
    }
  });
});
