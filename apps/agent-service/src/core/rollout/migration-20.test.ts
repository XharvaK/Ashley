/**
 * Regression coverage for the v20 capability_events CHECK extension
 * (capability rollout Wave 1). Guards that the table rebuild preserves
 * existing evidence rows and admits the `operator_promote` kind that
 * explicit, authorized promotion records.
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { MIGRATION_20_CAPABILITY_EVENT_KINDS_DDL } from "./migration-20.js";

function openMigratedDb(): DatabaseSync {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  return openNuclearDb(new DatabaseSync(":memory:"), { continuity });
}

describe("migration-20 capability event kinds", () => {
  it("migrates a fresh database to nuclear schema v21 (v20 + provenance)", () => {
    const db = openMigratedDb();
    const row = db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    expect(row.user_version).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(
      (
        db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version,
    ).toBe(NUCLEAR_SUPPORTED_VERSION);
    db.close();
  });

  it("accepts operator_promote through the runtime event path on a migrated db", () => {
    const db = openMigratedDb();
    db.prepare(
      `INSERT INTO capability_releases
         (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
       VALUES ('recall', 'release-1', 'observe', '2026-08-08T00:00:00.000Z', 'ashley-capability-v3', 'build', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO capability_events
         (capability, release_id, kind, source_key, detail_json, occurred_at)
       VALUES ('recall', 'release-1', 'operator_promote', 'promote:2026-08-08T00:00:00.000Z',
               '{"authorizedBy":"owner-1"}', '2026-08-08T00:00:00.000Z')`,
    ).run();
    const row = db.prepare(
      `SELECT kind, detail_json FROM capability_events WHERE kind = 'operator_promote'`,
    ).get() as { kind?: string; detail_json?: string };
    expect(row.kind).toBe("operator_promote");
    expect(JSON.parse(row.detail_json ?? "{}")).toMatchObject({
      authorizedBy: "owner-1",
    });
    db.close();
  });

  it("rebuild preserves existing evidence rows and rejects unknown kinds", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE capability_releases (
        capability  TEXT NOT NULL,
        release_id  TEXT NOT NULL,
        state       TEXT NOT NULL DEFAULT 'observe',
        updated_at  TEXT NOT NULL,
        contract_id TEXT,
        build_identity TEXT,
        model_epoch INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (capability, release_id)
      );
      INSERT INTO capability_releases VALUES ('recall', 'r1', 'observe', 'now', NULL, NULL, 0);
      CREATE TABLE capability_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        capability  TEXT NOT NULL,
        release_id  TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN (
                      'isolated_eval', 'live_shadow', 'behavioral_breach',
                      'critical_failure'
                    )),
        source_key  TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL,
        contract_id TEXT,
        build_identity TEXT,
        model_epoch INTEGER NOT NULL DEFAULT 0,
        UNIQUE(capability, release_id, kind, source_key),
        FOREIGN KEY (capability, release_id)
          REFERENCES capability_releases(capability, release_id)
      );
      INSERT INTO capability_events
        (capability, release_id, kind, source_key, detail_json, occurred_at)
      VALUES ('recall', 'r1', 'live_shadow', 'shadow-1', '{}', 'now');
    `);
    db.exec(MIGRATION_20_CAPABILITY_EVENT_KINDS_DDL);

    const preserved = db.prepare(
      `SELECT capability, release_id, kind, source_key FROM capability_events`,
    ).all();
    expect(preserved).toEqual([
      { capability: "recall", release_id: "r1", kind: "live_shadow", source_key: "shadow-1" },
    ]);

    db.prepare(
      `INSERT INTO capability_events
         (capability, release_id, kind, source_key, detail_json, occurred_at)
       VALUES ('recall', 'r1', 'operator_promote', 'promote:1', '{}', 'now')`,
    ).run();

    expect(() =>
      db.prepare(
        `INSERT INTO capability_events
           (capability, release_id, kind, source_key, detail_json, occurred_at)
         VALUES ('recall', 'r1', 'operator_nope', 'bad:1', '{}', 'now')`,
      ).run(),
    ).toThrow(/CHECK constraint/);
    db.close();
  });

  it("the DDL CHECK admits exactly the five canonical kinds", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE capability_releases (
        capability  TEXT NOT NULL,
        release_id  TEXT NOT NULL,
        state       TEXT NOT NULL DEFAULT 'observe',
        updated_at  TEXT NOT NULL,
        contract_id TEXT,
        build_identity TEXT,
        model_epoch INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (capability, release_id)
      );
      INSERT INTO capability_releases VALUES ('recall', 'r1', 'observe', 'now', NULL, NULL, 0);
      CREATE TABLE capability_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        capability  TEXT NOT NULL,
        release_id  TEXT NOT NULL,
        kind        TEXT NOT NULL,
        source_key  TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL,
        contract_id TEXT,
        build_identity TEXT,
        model_epoch INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.exec(MIGRATION_20_CAPABILITY_EVENT_KINDS_DDL);
    const sql = (
      db.prepare(
        "SELECT sql FROM sqlite_master WHERE name = 'capability_events' AND type = 'table'",
      ).get() as { sql: string }
    ).sql;
    expect(sql).toMatch(
      /isolated_eval.*live_shadow.*behavioral_breach.*critical_failure.*operator_promote/s,
    );
    db.close();
  });
});
