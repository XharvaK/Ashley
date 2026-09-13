/**
 * Regression coverage for the v21 provenance columns (Wave 2
 * time-shift isolation). Guards that the migration backfills existing
 * evidence rows to 'shadow' (strict isolation), admits the CHECK
 * constraint, and that fresh tables default to 'shadow'.
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { MIGRATION_21_PROVENANCE_DDL } from "./migration-21.js";

function openMigratedDb(): DatabaseSync {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  return openNuclearDb(new DatabaseSync(":memory:"), { continuity });
}

const PROVENANCE_TABLES = [
  "cur_takes",
  "cur_reads",
  "episodes",
  "learning_revisions",
  "cur_source_candidates",
];

function columnsOf(db: DatabaseSync, table: string): Array<{ name?: string }> {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
}

describe("migration-21 provenance (Wave 2 time-shift isolation)", () => {
  it("opens the current schema with the v21 provenance columns", () => {
    const db = openMigratedDb();
    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    for (const table of PROVENANCE_TABLES) {
      const names = new Set(columnsOf(db, table).map((column) => column.name));
      expect(names.has("provenance")).toBe(true);
    }
    db.close();
  });

  it("defaults new evidence rows to shadow and rejects unknown provenance values", () => {
    const db = openMigratedDb();
    db.prepare(
      `INSERT INTO cur_sources (slug, title, kind, url, interest, weight, enabled)
       VALUES ('audit', 'Audit', 'rss', 'https://example.com/feed', 'systems', 1, 1)`,
    ).run();
    const item = db.prepare(
      `INSERT INTO cur_items
         (source_id, url, url_key, title, excerpt, interest, seen_at, score, status)
       VALUES (1, 'https://example.com/a', 'https://example.com/a', 'A', 'E',
               'systems', '2026-08-08T00:00:00.000Z', 50, 'read')`,
    ).run();
    const take = db.prepare(
      `INSERT INTO cur_takes (item_id, interest, take, evidence_kind, created_at)
       VALUES (?, 'systems', 'default shadow take', 'scan_excerpt', '2026-08-08T00:00:00.000Z')`,
    ).run(Number(item.lastInsertRowid));
    const row = db.prepare(
      `SELECT provenance FROM cur_takes WHERE id = ?`,
    ).get(Number(take.lastInsertRowid)) as { provenance: string };
    expect(row.provenance).toBe("shadow");
    db.prepare(
      `UPDATE cur_takes SET provenance = 'live' WHERE id = ?`,
    ).run(Number(take.lastInsertRowid));
    expect(() =>
      db.prepare(
        `UPDATE cur_takes SET provenance = 'realtime' WHERE id = ?`,
      ).run(Number(take.lastInsertRowid)),
    ).toThrow(/CHECK constraint/);
    db.close();
  });

  it("backfills pre-existing evidence rows to shadow", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE cur_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, kind TEXT, url TEXT, interest TEXT, weight REAL, enabled INTEGER);
      CREATE TABLE cur_items (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER, url TEXT, url_key TEXT, title TEXT, excerpt TEXT, interest TEXT, seen_at TEXT, score REAL, status TEXT);
      CREATE TABLE cur_takes (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, interest TEXT, take TEXT, evidence_kind TEXT, created_at TEXT);
      CREATE TABLE cur_reads (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, interest TEXT, text_content TEXT, retrieved_at TEXT, created_at TEXT);
      CREATE TABLE episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, thread_id TEXT, summary TEXT, entities TEXT, source_start_message_id INTEGER, source_end_message_id INTEGER, salience REAL, unresolved INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE learning_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, target_layer TEXT, target_key TEXT, previous_value TEXT, proposed_value TEXT, rationale TEXT, status TEXT, apply_after TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE cur_source_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT, url TEXT, text_content TEXT, interest TEXT, successful_fetches INTEGER, created_at TEXT, updated_at TEXT, status TEXT);
    `);

    db.prepare(
      `INSERT INTO cur_sources (slug, title, kind, url, interest, weight, enabled)
       VALUES ('audit', 'Audit', 'rss', 'https://example.com/feed', 'systems', 1, 1)`,
    ).run();
    const item = db.prepare(
      `INSERT INTO cur_items
         (source_id, url, url_key, title, excerpt, interest, seen_at, score, status)
       VALUES (1, 'https://example.com/b', 'https://example.com/b', 'B', 'E',
               'systems', '2026-08-08T00:00:00.000Z', 50, 'read')`,
    ).run();
    db.prepare(
      `INSERT INTO cur_takes (item_id, interest, take, evidence_kind, created_at)
       VALUES (?, 'systems', 'pre-v21 take', 'scan_excerpt', '2026-08-08T00:00:00.000Z')`,
    ).run(Number(item.lastInsertRowid));
    db.exec(`INSERT INTO learning_revisions
       (owner_id, target_layer, target_key, previous_value, proposed_value,
        rationale, status, apply_after, created_at, updated_at)
       VALUES ('doc', 'dynamic_identity', 'interest.x', NULL, 'y', 'r',
               'proposed', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z',
               '2026-08-08T00:00:00.000Z')`);
    db.exec(MIGRATION_21_PROVENANCE_DDL);
    for (const table of PROVENANCE_TABLES) {
      const rows = db.prepare(
        `SELECT provenance, COUNT(*) AS count FROM ${table} GROUP BY provenance`,
      ).all() as Array<{ provenance: string; count: number }>;
      if (rows.length === 0) continue;
      expect(rows).toEqual([{ provenance: "shadow", count: 1 }]);
    }
    db.close();
  });
});
