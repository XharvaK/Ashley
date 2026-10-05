import type { DatabaseSync } from "node:sqlite";

/**
 * The live service and the break-glass backup (and its drill) share nuclear.db, continuity.db and
 * the cognitive sidecar. They run in rollback-journal mode, where a reader holding a shared lock
 * (a backup's VACUUM INTO) and a writer committing (a delivery claim) block each other. Every
 * connection to them waits this long for the other side instead of failing at once with
 * SQLITE_BUSY ("database is locked"); a snapshot or a write takes well under a second.
 */
export const SHARED_DB_BUSY_TIMEOUT_MS = 5000;

export function waitForLocks<T extends DatabaseSync>(db: T, timeoutMs = SHARED_DB_BUSY_TIMEOUT_MS): T {
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(timeoutMs))}`);
  return db;
}

/** SQLite's primary result code of a node:sqlite error (5 BUSY, 6 LOCKED, ...), or null. */
export function sqliteResultCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; errcode?: unknown };
  if (record.code !== "ERR_SQLITE_ERROR" || typeof record.errcode !== "number") return null;
  return record.errcode & 0xff;
}
