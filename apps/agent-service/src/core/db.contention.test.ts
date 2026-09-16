import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "./db.js";

describe("nuclear SQLite contention", () => {
  it("surfaces SQLITE_BUSY immediately without losing committed work", () => {
    const directory = mkdtempSync(join(tmpdir(), "ashley-db-contention-"));
    const databasePath = join(directory, "nuclear.db");
    let first: DatabaseSync | null = null;
    let second: DatabaseSync | null = null;

    try {
      first = openNuclearDb(new DatabaseSync(databasePath));
      second = openNuclearDb(new DatabaseSync(databasePath));

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
      expect(elapsedMs).toBeLessThan(1_000);

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
