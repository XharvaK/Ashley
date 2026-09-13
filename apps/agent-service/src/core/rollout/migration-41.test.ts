import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";

const EPOCH_TABLE = "memory_evidence_qualification_epochs";
const EVENT_TABLE = "memory_evidence_qualification_events";

type MigrationFixture = {
  db: DatabaseSync;
  continuity: DatabaseSync;
};

function databaseAtVersion40(): MigrationFixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  db.exec(`
    DROP INDEX IF EXISTS delivery_reservations_v021_projection_key;
    ALTER TABLE delivery_reservations DROP COLUMN cognitive_v021_projection_key;
    DROP INDEX IF EXISTS memory_evidence_events_by_epoch_kind_time;
    DROP INDEX IF EXISTS memory_evidence_one_current_epoch;
    DROP TABLE IF EXISTS ${EVENT_TABLE};
    DROP TABLE IF EXISTS ${EPOCH_TABLE};
    PRAGMA user_version = 40;
  `);
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 40 WHERE id = 1")
    .run();
  return { db, continuity };
}

function migrateToVersion41(): MigrationFixture {
  const fixture = databaseAtVersion40();
  openNuclearDb(fixture.db, { continuity: fixture.continuity, migrate: true });
  // Keep this helper at the historical v41 waypoint even though the current
  // opener continues through the additive v42 migration.
  fixture.db.exec(`
    DROP INDEX IF EXISTS delivery_reservations_v021_projection_key;
    ALTER TABLE delivery_reservations DROP COLUMN cognitive_v021_projection_key;
    PRAGMA user_version = 41;
  `);
  fixture.continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 41 WHERE id = 1")
    .run();
  return fixture;
}

function closeFixture(fixture: MigrationFixture): void {
  try {
    fixture.db.close();
  } finally {
    fixture.continuity.close();
  }
}

function nuclearUserVersion(db: DatabaseSync): number {
  return (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
}

function sidecarNuclearVersion(continuity: DatabaseSync): number {
  return (
    continuity
      .prepare("SELECT nuclear_schema_version FROM lineage_state WHERE id = 1")
      .get() as { nuclear_schema_version: number }
  ).nuclear_schema_version;
}

function setPendingNuclearMigration(continuity: DatabaseSync, value: string): void {
  continuity
    .prepare(
      `INSERT INTO continuity_meta (key, value) VALUES ('pending_nuclear_migration', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(value);
}

function insertEpoch(db: DatabaseSync, epochId = "epoch-1", status = "current"): void {
  db.prepare(
    `INSERT INTO ${EPOCH_TABLE}
       (epoch_id, status, start_request_key, owner_id, contract_id,
        started_build_identity, created_by, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    epochId,
    status,
    `request-${epochId}`,
    "doc",
    "contract-1",
    "build-1",
    "doc",
    "2026-08-27T00:00:00.000Z",
  );
}

function insertEvent(db: DatabaseSync, sourceKey = "source-1"): void {
  db.prepare(
    `INSERT INTO ${EVENT_TABLE}
       (epoch_id, kind, source_key, qualifies, detail_json, occurred_at,
        contract_id, build_identity)
     VALUES (?, 'live_shadow', ?, 1, '{}', ?, ?, ?)`,
  ).run(
    "epoch-1",
    sourceKey,
    "2026-08-27T00:00:00.000Z",
    "contract-1",
    "build-1",
  );
}

describe("nuclear schema v41 C1 qualification bootstrap", () => {
  it("migrates v40 to v41 with both control-plane tables and indexes", () => {
    const { db, continuity } = migrateToVersion41();
    try {
      // The historical W1 qualification packet recorded v42. Current source
      // also includes W4 migrations v43 and v44; db.ts is authoritative.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(44);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 41 });
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(EPOCH_TABLE)).toEqual({ 1: 1 });
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(EVENT_TABLE)).toEqual({ 1: 1 });
      for (const index of [
        "memory_evidence_one_current_epoch",
        "memory_evidence_events_by_epoch_kind_time",
      ]) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        ).get(index)).toEqual({ 1: 1 });
      }
    } finally {
      try {
        db.close();
      } finally {
        continuity.close();
      }
    }
  });

  it("reopening version 41 is idempotent", () => {
    const { db, continuity } = migrateToVersion41();
    try {
      insertEpoch(db);
      insertEvent(db);
      const before = db.prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name IN (?, ?, ?, ?) ORDER BY type, name",
      ).all(
        EPOCH_TABLE,
        EVENT_TABLE,
        "memory_evidence_one_current_epoch",
        "memory_evidence_events_by_epoch_kind_time",
      );
      openNuclearDb(db, { continuity, migrate: true });
      const after = db.prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name IN (?, ?, ?, ?) ORDER BY type, name",
      ).all(
        EPOCH_TABLE,
        EVENT_TABLE,
        "memory_evidence_one_current_epoch",
        "memory_evidence_events_by_epoch_kind_time",
      );
      expect(after).toEqual(before);
      expect(db.prepare(`SELECT COUNT(*) AS c FROM ${EVENT_TABLE}`).get()).toEqual({ c: 1 });
    } finally {
      try {
        db.close();
      } finally {
        continuity.close();
      }
    }
  });

  it("rejects two current epochs through the unique current-epoch index", () => {
    const { db, continuity } = migrateToVersion41();
    try {
      insertEpoch(db, "epoch-1", "current");
      expect(() => insertEpoch(db, "epoch-2", "current")).toThrow();
    } finally {
      try {
        db.close();
      } finally {
        continuity.close();
      }
    }
  });

  it("enforces epoch-scoped event idempotency through the event primary key", () => {
    const { db, continuity } = migrateToVersion41();
    try {
      insertEpoch(db);
      insertEvent(db);
      expect(() => insertEvent(db)).toThrow();
    } finally {
      try {
        db.close();
      } finally {
        continuity.close();
      }
    }
  });

  it("rejects invalid epoch and event enum values", () => {
    const { db, continuity } = migrateToVersion41();
    try {
      expect(() => insertEpoch(db, "invalid", "invalid")).toThrow();
      insertEpoch(db);
      expect(() => db.prepare(
        `INSERT INTO ${EVENT_TABLE}
           (epoch_id, kind, source_key, qualifies, detail_json, occurred_at,
            contract_id, build_identity)
         VALUES ('epoch-1', 'invalid', 'kind', 1, '{}', ?, 'contract-1', 'build-1')`,
      ).run("2026-08-27T00:00:00.000Z")).toThrow();
      expect(() => db.prepare(
        `INSERT INTO ${EVENT_TABLE}
           (epoch_id, kind, source_key, qualifies, detail_json, occurred_at,
            contract_id, build_identity)
         VALUES ('epoch-1', 'live_shadow', 'qualifies', 2, '{}', ?, 'contract-1', 'build-1')`,
      ).run("2026-08-27T00:00:00.000Z")).toThrow();
      expect(() => db.prepare(
        `INSERT INTO ${EVENT_TABLE}
           (epoch_id, kind, source_key, qualifies, trigger, detail_json, occurred_at,
            contract_id, build_identity)
         VALUES ('epoch-1', 'live_shadow', 'trigger', 1, 'invalid', '{}', ?, 'contract-1', 'build-1')`,
      ).run("2026-08-27T00:00:00.000Z")).toThrow();
    } finally {
      try {
        db.close();
      } finally {
        continuity.close();
      }
    }
  });

  it("enforces blocker null consistency and preserves evidence when sealing an epoch", () => {
    const { db, continuity } = migrateToVersion41();
    try {
      insertEpoch(db);
      insertEvent(db);
      const evidenceBefore = db.prepare(
        `SELECT * FROM ${EVENT_TABLE}`,
      ).get();
      expect(() => db.prepare(
        `UPDATE ${EPOCH_TABLE} SET blocked_at = ? WHERE epoch_id = 'epoch-1'`,
      ).run("2026-08-27T00:00:00.000Z")).toThrow();
      db.prepare(
        `UPDATE ${EPOCH_TABLE}
         SET sealed_at = ?, sealed_release_id = ? WHERE epoch_id = 'epoch-1'`,
      ).run("2026-08-27T01:00:00.000Z", "release-1");
      expect(db.prepare(
        `SELECT sealed_at, sealed_release_id FROM ${EPOCH_TABLE} WHERE epoch_id = 'epoch-1'`,
      ).get()).toEqual({
        sealed_at: "2026-08-27T01:00:00.000Z",
        sealed_release_id: "release-1",
      });
      expect(db.prepare(`SELECT * FROM ${EVENT_TABLE}`).get()).toEqual(evidenceBefore);
    } finally {
      try {
        db.close();
      } finally {
        continuity.close();
      }
    }
  });
});

describe("nuclear schema v41 pending migration recovery", () => {
  it("reconciles pending 40→41 when nuclear remains at schema 40", () => {
    const fixture = databaseAtVersion40();
    try {
      expect(() => openNuclearDb(fixture.db, {
        continuity: fixture.continuity,
        migrate: true,
        testMigrationFault: "during_ddl",
      })).toThrow("test_fault_during_ddl");
      expect(nuclearUserVersion(fixture.db)).toBe(40);
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 40,
        to: 41,
        phase: "pending",
      });
      expect(sidecarNuclearVersion(fixture.continuity)).toBe(40);

      openNuclearDb(fixture.db, { continuity: fixture.continuity, migrate: true });
      expect(nuclearUserVersion(fixture.db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
      expect(sidecarNuclearVersion(fixture.continuity)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(fixture.db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(EPOCH_TABLE)).toEqual({ 1: 1 });
      expect(fixture.db.prepare(`SELECT COUNT(*) AS c FROM ${EPOCH_TABLE}`).get())
        .toEqual({ c: 0 });
    } finally {
      closeFixture(fixture);
    }
  });

  it("finalizes pending 40→41 when nuclear already committed schema 41", () => {
    const fixture = databaseAtVersion40();
    try {
      expect(() => openNuclearDb(fixture.db, {
        continuity: fixture.continuity,
        migrate: true,
        testMigrationFault: "after_nuclear_commit",
      })).toThrow("test_fault_after_nuclear_commit");
      expect(nuclearUserVersion(fixture.db)).toBe(41);
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 40,
        to: 41,
        phase: "pending",
      });
      expect(sidecarNuclearVersion(fixture.continuity)).toBe(40);

      openNuclearDb(fixture.db, { continuity: fixture.continuity, migrate: true });
      expect(nuclearUserVersion(fixture.db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
      expect(sidecarNuclearVersion(fixture.continuity)).toBe(NUCLEAR_SUPPORTED_VERSION);
    } finally {
      closeFixture(fixture);
    }
  });

  it("fails closed on malformed pending 40→41 metadata", () => {
    const fixture = databaseAtVersion40();
    try {
      setPendingNuclearMigration(fixture.continuity, "{not-json");
      expect(() => openNuclearDb(fixture.db, {
        continuity: fixture.continuity,
        migrate: true,
      })).toThrow("continuity_pending_migration_invalid");
      expect(nuclearUserVersion(fixture.db)).toBe(40);
      expect(
        (
          fixture.continuity
            .prepare(
              "SELECT value FROM continuity_meta WHERE key = 'pending_nuclear_migration'",
            )
            .get() as { value: string }
        ).value,
      ).toBe("{not-json");
    } finally {
      closeFixture(fixture);
    }
  });

  it("fails closed when nuclear version does not match pending 40→41", () => {
    const fixture = databaseAtVersion40();
    try {
      expect(() => openNuclearDb(fixture.db, {
        continuity: fixture.continuity,
        migrate: true,
        testMigrationFault: "after_pending",
      })).toThrow("test_fault_after_pending");
      fixture.db.exec("PRAGMA user_version = 39");
      expect(() => openNuclearDb(fixture.db, {
        continuity: fixture.continuity,
        migrate: true,
      })).toThrow("continuity_pending_migration_version_mismatch:39");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 40,
        to: 41,
        phase: "pending",
      });
      expect(nuclearUserVersion(fixture.db)).toBe(39);
      expect(sidecarNuclearVersion(fixture.continuity)).toBe(40);
    } finally {
      closeFixture(fixture);
    }
  });

  it("fails closed when nuclear schema is newer than supported", () => {
    const fixture = migrateToVersion41();
    try {
      const newerVersion = NUCLEAR_SUPPORTED_VERSION + 1;
      fixture.db.exec(`PRAGMA user_version = ${newerVersion}`);
      expect(() => openNuclearDb(fixture.db, {
        continuity: fixture.continuity,
        migrate: true,
      })).toThrow(`unsupported_nuclear_schema:${newerVersion}>${NUCLEAR_SUPPORTED_VERSION}`);
      expect(nuclearUserVersion(fixture.db)).toBe(newerVersion);
    } finally {
      closeFixture(fixture);
    }
  });
});
