import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "./db.js";
import { SHARED_DB_BUSY_TIMEOUT_MS } from "./sqlite-locks.js";

// HARD-P34 witnessed SQLITE_BUSY surfacing immediately and left busy_timeout out until contention
// handling was proven incorrect. Production 2026-10-05 proved it: the deploy's backup failed twice on
// locks and a live delivery claim threw "database is locked" while a backup read nuclear.db. Nuclear
// now waits SHARED_DB_BUSY_TIMEOUT_MS (sqlite-locks.test.ts shows the cross-process wait succeeding);
// a lock that is not released in time still surfaces as SQLITE_BUSY, and no committed work is lost.
describe("nuclear SQLite contention", () => {
  it("waits for the busy timeout, then surfaces SQLITE_BUSY without losing committed work", () => {
    const directory = mkdtempSync(join(tmpdir(), "ashley-db-contention-"));
    const databasePath = join(directory, "nuclear.db");
    let first: DatabaseSync | null = null;
    let second: DatabaseSync | null = null;

    try {
      first = openNuclearDb(new DatabaseSync(databasePath));
      second = openNuclearDb(new DatabaseSync(databasePath));
      expect(second.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: SHARED_DB_BUSY_TIMEOUT_MS });
      // Same process: the holder cannot let go while this connection waits, so keep the wait short here.
      second.exec("PRAGMA busy_timeout = 300");

      first.exec(`
        CREATE TABLE contention_witness (
          id TEXT PRIMARY KEY,
          writer TEXT NOT NULL
        )
      `);

      first.exec("BEGIN IMMEDIATE");
      first
        .prepare("INSERT INTO contention_witness (id, writer) VALUES (?, ?)")
        .run("first-row", "first");

      const startedAt = Date.now();
      let contentionError: unknown;
      try {
        second.exec("BEGIN IMMEDIATE");
      } catch (error) {
        contentionError = error;
      }
      const elapsedMs = Date.now() - startedAt;

      expect(contentionError).toBeDefined();
      expect(String(contentionError)).toMatch(/SQLITE_BUSY|database is locked/i);
      expect(elapsedMs).toBeGreaterThanOrEqual(250);
      expect(elapsedMs).toBeLessThan(3_000);

      first.exec("COMMIT");
      second.exec("BEGIN IMMEDIATE");
      second
        .prepare("INSERT INTO contention_witness (id, writer) VALUES (?, ?)")
        .run("second-row", "second");
      second.exec("COMMIT");

      const rows = first
        .prepare("SELECT id, writer FROM contention_witness ORDER BY id")
        .all() as Array<{ id: string; writer: string }>;
      expect(rows).toEqual([
        { id: "first-row", writer: "first" },
        { id: "second-row", writer: "second" },
      ]);
    } finally {
      try {
        second?.close();
      } finally {
        first?.close();
      }
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        /* Windows may retain SQLite locks briefly. */
      }
    }
  });
});
