import type { DatabaseSync } from "node:sqlite";

/**
 * The live service and the break-glass backup (and its drill) share nuclear.db, continuity.db and
 * the cognitive sidecar. Every connection to them waits this long for the other side instead of
 * failing at once with SQLITE_BUSY ("database is locked"); a snapshot or a write takes well under a
 * second.
 */
export const SHARED_DB_BUSY_TIMEOUT_MS = 5000;

/**
 * Journal policy: the three shared databases run in WAL. In rollback-journal mode a reader holding a
 * shared lock (a backup's VACUUM INTO) blocks a writer's commit for the whole copy; in WAL a reader
 * sees a fixed snapshot and never blocks the commit. The switch is made once, by the process that
 * migrates the file (the opener), because changing the mode needs the file free of rollback readers.
 * Memory databases cannot be WAL (SQLite answers "memory"), so the switch is harmless there.
 */
export const SHARED_DB_JOURNAL_MODE = "wal";

export function waitForLocks<T extends DatabaseSync>(db: T, timeoutMs = SHARED_DB_BUSY_TIMEOUT_MS): T {
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(timeoutMs))}`);
  return db;
}

/**
 * Sets the journal policy on a connection that is about to migrate the file and returns the mode SQLite
 * reports. Best effort: a file that cannot switch right now stays in its current mode, which is still
 * correct (rollback mode only blocks more), and the caller records the mode it got.
 */
export function applyJournalModePolicy(db: DatabaseSync): string {
  try {
    const row = db.prepare(`PRAGMA journal_mode = ${SHARED_DB_JOURNAL_MODE}`).get() as
      | { journal_mode?: unknown }
      | undefined;
    return String(row?.journal_mode ?? "").toLowerCase();
  } catch {
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode?: unknown } | undefined;
    return String(row?.journal_mode ?? "").toLowerCase();
  }
}

/**
 * Writes a consistent copy of the database to destPath, which must not exist. A passive checkpoint
 * first moves committed WAL pages into the main file so the copy is small and quick; PASSIVE never
 * waits on a writer, so the snapshot cannot hold up a commit.
 */
export function vacuumIntoFile(db: DatabaseSync, destPath: string): void {
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}

/** SQLite's primary result code of a node:sqlite error (5 BUSY, 6 LOCKED, ...), or null. */
export function sqliteResultCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; errcode?: unknown };
  if (record.code !== "ERR_SQLITE_ERROR" || typeof record.errcode !== "number") return null;
  return record.errcode & 0xff;
}
