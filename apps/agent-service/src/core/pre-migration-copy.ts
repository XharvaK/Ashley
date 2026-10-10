import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { vacuumIntoFile } from "./sqlite-locks.js";

/**
 * One consistent copy of each shared database taken before the first pending migration of a run.
 *
 * Location: `<dataDir>/backups/pre-migrate/`. File name: `<db>-v<from>-<stamp>.db`, where `<db>` is
 * `nuclear` or `cognitive-v021`, `<from>` is the schema version the copy holds (the version before the
 * migration ran), and `<stamp>` is the UTC time with `:` and `.` replaced by `-`, so names sort by time.
 * A deploy rollback finds "the copy taken before version N" by taking the newest file whose `v<N>`
 * matches (see `findPreMigrationCopyBefore`, or the same pattern in a shell). Only the newest
 * `PRE_MIGRATE_KEEP` copies of each database are kept. A copy is written under a `.partial` name and
 * renamed only when complete, so a crash never leaves a file that looks whole.
 */
export const PRE_MIGRATE_KEEP = 3;
export type PreMigrateDb = "nuclear" | "cognitive-v021";

const COPY_RE = /^(nuclear|cognitive-v021)-v(\d+)-(.+)\.db$/;

export function preMigrateDirFor(dataDir: string): string {
  return join(dataDir, "backups", "pre-migrate");
}

export type PreMigrationCopy = {
  path: string;
  db: PreMigrateDb;
  fromVersion: number;
  stamp: string;
};

/** Copies of one database in the directory, newest first. Missing directory means none. */
export function listPreMigrationCopies(dir: string, db: PreMigrateDb): PreMigrationCopy[] {
  if (!existsSync(dir)) return [];
  const copies: PreMigrationCopy[] = [];
  for (const name of readdirSync(dir)) {
    const match = COPY_RE.exec(name);
    if (!match || match[1] !== db) continue;
    copies.push({
      path: join(dir, name),
      db,
      fromVersion: Number(match[2]),
      stamp: match[3]!,
    });
  }
  return copies.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
}

/** The newest copy taken before the database was at `version`, or null. Used by the deploy rollback. */
export function findPreMigrationCopyBefore(
  dataDir: string,
  db: PreMigrateDb,
  version: number,
): string | null {
  const match = listPreMigrationCopies(preMigrateDirFor(dataDir), db).find(
    (copy) => copy.fromVersion === version,
  );
  return match?.path ?? null;
}

/** Deletes everything past the newest `keep` copies of one database, and stale partial copies. */
export function prunePreMigrationCopies(dir: string, db: PreMigrateDb, keep = PRE_MIGRATE_KEEP): string[] {
  if (!existsSync(dir)) return [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(`${db}-v`) && name.endsWith(".db.partial")) rmSync(join(dir, name), { force: true });
  }
  const removed: string[] = [];
  for (const copy of listPreMigrationCopies(dir, db).slice(Math.max(0, keep))) {
    rmSync(copy.path, { force: true });
    removed.push(copy.path);
  }
  return removed;
}

/**
 * Writes the pre-migration copy of `source` (the connection about to migrate) and returns its path.
 * Throws `pre_migration_snapshot_failed:*` when the copy cannot be made, so the migration does not run
 * without its copy.
 */
export function takePreMigrationCopy(input: {
  source: DatabaseSync;
  dataDir: string;
  db: PreMigrateDb;
  fromVersion: number;
  now?: Date;
  keep?: number;
}): string {
  const dir = preMigrateDirFor(input.dataDir);
  mkdirSync(dir, { recursive: true });
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  let name = `${input.db}-v${input.fromVersion}-${stamp}.db`;
  if (existsSync(join(dir, name))) {
    name = `${input.db}-v${input.fromVersion}-${stamp}-${randomUUID().slice(0, 8)}.db`;
  }
  const finalPath = join(dir, name);
  const partial = `${finalPath}.partial`;
  rmSync(partial, { force: true });
  try {
    vacuumIntoFile(input.source, partial);
    renameSync(partial, finalPath);
  } catch (error) {
    rmSync(partial, { force: true });
    throw new Error(
      `pre_migration_snapshot_failed:${error instanceof Error ? error.message : "vacuum_failed"}`,
    );
  }
  prunePreMigrationCopies(dir, input.db, input.keep ?? PRE_MIGRATE_KEEP);
  console.log(
    JSON.stringify({
      event: "pre_migration_copy",
      db: input.db,
      from_version: input.fromVersion,
      path: finalPath,
    }),
  );
  return finalPath;
}
