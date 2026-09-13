import { describe, expect, it, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, unlinkSync } from "node:fs";
import { migrate, openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { MIGRATION_22_RECALL_AUTHORITY_DDL } from "./migration-22.js";

const TEST_DB = "migration-22-test.db";

describe("wave10c migration-22 (recall authority hardening)", () => {
  afterEach(() => {
    try {
      unlinkSync(TEST_DB);
    } catch {}
  });

  it("builds v22 schema on a fresh database and preserves FTS/UUID", () => {
    try { unlinkSync(TEST_DB); } catch {}
    const db = new DatabaseSync(TEST_DB);
    db.exec(`
      CREATE TABLE mem_threads (id TEXT PRIMARY KEY);
      CREATE TABLE mem_messages (id INTEGER PRIMARY KEY);
      CREATE TABLE episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        entities TEXT NOT NULL DEFAULT '',
        source_start_message_id INTEGER NOT NULL,
        source_end_message_id INTEGER NOT NULL,
        salience REAL NOT NULL DEFAULT 0.5,
        unresolved INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        entity_uuid TEXT,
        data_classification TEXT,
        provenance TEXT NOT NULL DEFAULT 'shadow'
      );
      CREATE VIRTUAL TABLE episodes_fts USING fts5(summary, entities, content='');
      CREATE TABLE capability_releases (capability TEXT, release_id TEXT, PRIMARY KEY(capability, release_id));
      CREATE TABLE capability_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        capability TEXT NOT NULL,
        release_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_key TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL,
        contract_id TEXT,
        build_identity TEXT,
        model_epoch INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO capability_releases (capability, release_id) VALUES ('recall', 'r1');
      INSERT INTO mem_threads (id) VALUES ('t1');
      INSERT INTO mem_messages (id) VALUES (1), (2);
      INSERT INTO episodes (owner_id, thread_id, summary, source_start_message_id, source_end_message_id, created_at, updated_at, entity_uuid, provenance)
      VALUES ('doc', 't1', 'old shadow', 1, 2, '2026', '2026', 'uuid1', 'shadow');
      INSERT INTO episodes_fts (rowid, summary, entities) VALUES (1, 'old shadow', '');
      INSERT INTO capability_events (capability, release_id, kind, source_key, occurred_at)
      VALUES ('recall', 'r1', 'operator_promote', 'k1', '2026');
      PRAGMA user_version = 21;
    `);
    db.close();

    const db2 = new DatabaseSync(TEST_DB);
    db2.exec("PRAGMA foreign_keys = OFF");
    db2.exec("BEGIN IMMEDIATE");
    db2.exec(MIGRATION_22_RECALL_AUTHORITY_DDL);
    db2.exec("PRAGMA user_version = 22");
    db2.exec("COMMIT");
    db2.exec("PRAGMA foreign_keys = ON");

    const v = db2.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(v.user_version).toBe(22);

    const fk = db2.prepare("PRAGMA foreign_key_check").all();
    expect(fk).toEqual([]);

    const qc = db2.prepare("PRAGMA quick_check").get() as { quick_check: string };
    expect(qc.quick_check).toBe("ok");

    // Verify preservation
    const eps = db2.prepare("SELECT * FROM episodes").all() as any[];
    expect(eps.length).toBe(1);
    expect(eps[0].entity_uuid).toBe("uuid1");

    const fts = db2.prepare("SELECT * FROM episodes_fts WHERE episodes_fts MATCH 'shadow'").all() as any[];
    expect(fts.length).toBe(1);

    const evs = db2.prepare("SELECT * FROM capability_events").all() as any[];
    expect(evs.length).toBe(1);
    expect(evs[0].kind).toBe("operator_promote");

    // Reopen verification
    db2.close();
    const db3 = new DatabaseSync(TEST_DB);
    const eps3 = db3.prepare("SELECT * FROM episodes").all() as any[];
    expect(eps3.length).toBe(1);
    expect(eps3[0].entity_uuid).toBe("uuid1");
    db3.close();
  });

  it("records a failed migration and leaves foreign keys enabled when OFF cannot be applied", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    try {
      db.exec("PRAGMA user_version = 21; DROP TABLE recall_live_cutovers;");
      continuity.prepare(
        "UPDATE lineage_state SET nuclear_schema_version = 21 WHERE id = 1",
      ).run();
      db.exec("BEGIN");

      expect(() => migrate(db, { continuity })).toThrow("nuclear_fk_disable_failed");
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 21 });

      const failure = continuity.prepare(
        `SELECT detail_json FROM continuity_events
         WHERE kind = 'migration' ORDER BY id DESC LIMIT 1`,
      ).get() as { detail_json: string };
      expect(JSON.parse(failure.detail_json)).toMatchObject({
        phase: "failure",
        from: 21,
        to: 22,
      });
      expect(
        continuity.prepare(
          "SELECT nuclear_schema_version FROM lineage_state WHERE id = 1",
        ).get(),
      ).toEqual({ nuclear_schema_version: 21 });
      db.exec("ROLLBACK");
    } finally {
      try {
        db.close();
      } finally {
        continuity.close();
      }
    }
  });
});
