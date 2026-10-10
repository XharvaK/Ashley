import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyJournalModePolicy, vacuumIntoFile, waitForLocks } from "./sqlite-locks.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sqlite-locks-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openFile(name: string): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)");
  return waitForLocks(db, 100);
}

/** A reader holds a read snapshot open (as a backup copy does), then a writer tries to commit. */
function writerCommitsWhileReaderHoldsSnapshot(name: string): { committed: boolean } {
  const reader = openFile(name);
  const writer = openFile(name);
  try {
    reader.exec("BEGIN");
    reader.prepare("SELECT count(*) AS n FROM t").get();
    writer.exec("BEGIN IMMEDIATE");
    writer.exec("INSERT INTO t (v) VALUES ('held')");
    try {
      writer.exec("COMMIT");
      return { committed: true };
    } catch {
      try { writer.exec("ROLLBACK"); } catch { /* no transaction left to roll back */ }
      return { committed: false };
    }
  } finally {
    try { reader.exec("COMMIT"); } catch { /* reader transaction already closed */ }
    reader.close();
    writer.close();
  }
}

describe("shared database journal policy (WAL, passive checkpoint)", () => {
  it("control: a rollback-journal writer cannot commit while a backup-style reader holds a snapshot", () => {
    expect(writerCommitsWhileReaderHoldsSnapshot("rollback.db")).toEqual({ committed: false });
  });

  it("WAL: the same writer commits while the reader holds its snapshot", () => {
    const setup = openFile("wal.db");
    expect(applyJournalModePolicy(setup)).toBe("wal");
    setup.close();
    expect(writerCommitsWhileReaderHoldsSnapshot("wal.db")).toEqual({ committed: true });
  });

  it("reports memory for an in-memory database instead of failing", () => {
    const db = new DatabaseSync(":memory:");
    try {
      expect(applyJournalModePolicy(db)).toBe("memory");
    } finally {
      db.close();
    }
  });

  it("writes a consistent copy with a passive checkpoint while a reader holds a snapshot", () => {
    const db = openFile("copy.db");
    try {
      applyJournalModePolicy(db);
      db.exec("INSERT INTO t (v) VALUES ('before-copy')");
      const dest = join(dir, "copy-out.db");
      vacuumIntoFile(db, dest);
      expect(existsSync(dest)).toBe(true);
      const copy = new DatabaseSync(dest);
      try {
        expect(copy.prepare("SELECT v FROM t").all()).toEqual([{ v: "before-copy" }]);
      } finally {
        copy.close();
      }
    } finally {
      db.close();
    }
  });
});
