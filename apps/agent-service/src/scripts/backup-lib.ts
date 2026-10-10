import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { waitForLocks } from "../core/sqlite-locks.js";
import type { DataPlaneContext } from "../core/data-plane.js";

export type BackupVersions = {
  nuclear: number;
  continuity: number;
  sidecar: number;
};

export type BackupStatus = {
  last_ok_ms: number | null;
  last_error: string | null;
  bytes: number | null;
  package_sha256: string | null;
  versions: BackupVersions | null;
  last_upload_ok_ms: number | null;
  last_upload_error: string | null;
  drill_ok_ms: number | null;
  drill_error: string | null;
};

export type RetentionPlan = {
  keep: string[];
  delete: string[];
};

export type DrillCountRow = {
  table: string;
  restored: number;
  live: number;
  appendOnly: boolean;
};

export type RcloneExec = (file: string, args: readonly string[]) => string;

const KEY_RE = /^[0-9a-fA-F]{64}$/;

export function emptyBackupStatus(): BackupStatus {
  return {
    last_ok_ms: null,
    last_error: null,
    bytes: null,
    package_sha256: null,
    versions: null,
    last_upload_ok_ms: null,
    last_upload_error: null,
    drill_ok_ms: null,
    drill_error: null,
  };
}

/** Missing or non-64-hex keys fail closed. The error text is only the code. */
export function assertBackupTransferKey(raw: string | undefined | null): string {
  if (typeof raw !== "string" || !KEY_RE.test(raw)) {
    throw new Error("backup_key_missing");
  }
  return raw;
}

export function backupPathsFromPlane(plane: DataPlaneContext): {
  nuclearDbPath: string;
  continuityDbPath: string;
  sidecarDbPath: string;
  packageDir: string;
  statusPath: string;
  /** The data directory whose home, sessions, transcript archive and state.json join the package. */
  companionDataDir: string;
} {
  const stray = join(plane.conversationsDir, "cognitive-v021.db");
  if (plane.cognitiveSidecarDbPath === stray) {
    throw new Error("stray_sidecar_selected");
  }
  return {
    nuclearDbPath: plane.nuclearDbPath,
    continuityDbPath: plane.continuityDbPath,
    sidecarDbPath: plane.cognitiveSidecarDbPath,
    packageDir: join(plane.dataDir, "backups", "pkg"),
    statusPath: join(plane.dataDir, "backups", "status.json"),
    companionDataDir: plane.dataDir,
  };
}

export function packageStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function readUserVersion(dbPath: string): number {
  const db = waitForLocks(new DatabaseSync(dbPath, { readOnly: true }));
  try {
    const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
    const value = Number(row?.user_version ?? 0);
    if (!Number.isSafeInteger(value)) throw new Error("schema_version_unreadable");
    return value;
  } finally {
    db.close();
  }
}

export function readSidecarSchemaVersion(dbPath: string): number {
  const db = waitForLocks(new DatabaseSync(dbPath, { readOnly: true }));
  try {
    const row = db.prepare(
      "SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1",
    ).get() as { schema_version?: number } | undefined;
    if (!row || !Number.isSafeInteger(Number(row.schema_version))) {
      throw new Error("sidecar_meta_missing");
    }
    return Number(row.schema_version);
  } finally {
    db.close();
  }
}

export function readBackupStatus(path: string): BackupStatus {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BackupStatus>;
    return { ...emptyBackupStatus(), ...parsed };
  } catch {
    return emptyBackupStatus();
  }
}

export function writeBackupStatusAtomic(path: string, status: BackupStatus): void {
  const body = JSON.stringify(status);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.status-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Newest names sort last under the UTC stamp format. Always retain the newest
 * name when the list is non-empty, even if keep is 0.
 */
export function planNameRetention(names: readonly string[], keep: number): RetentionPlan {
  const sorted = [...names].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const retain = names.length === 0 ? 0 : Math.max(keep, 1);
  return {
    keep: sorted.slice(0, retain),
    delete: sorted.slice(retain).reverse(),
  };
}

/** Hashes the file in fixed-size chunks; a whole package is never read into memory. */
export function sha256File(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Removes what a killed run left in the package folder: `.work-*` folders, `*.pkg` and `*.pkg.tmp`
 * package files and `.status-*.tmp` files, when older than olderThanMs. Published `.ashleybak` files
 * are never touched here.
 */
export function sweepStaleBackupWork(packageDir: string, olderThanMs: number, nowMs = Date.now()): string[] {
  if (!existsSync(packageDir)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(packageDir)) {
    const orphan = name.startsWith(".work-") ||
      name.endsWith(".pkg") || name.endsWith(".pkg.tmp") ||
      (name.startsWith(".status-") && name.endsWith(".tmp"));
    if (!orphan) continue;
    const path = join(packageDir, name);
    if (nowMs - statSync(path).mtimeMs < olderThanMs) continue;
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  return removed;
}

export function fileBytes(path: string): number {
  return statSync(path).size;
}

export function remoteJoin(remote: string, ...parts: string[]): string {
  const base = remote.replace(/\/+$/, "");
  return [base, ...parts].join("/");
}

export function rcloneMkdirArgs(destinationDir: string): string[] {
  return ["mkdir", destinationDir.replace(/\/+$/, "")];
}

export function rcloneCopyArgs(pkgPath: string, destinationDir: string): string[] {
  return ["copy", pkgPath, "--immutable", destinationDir.endsWith("/") ? destinationDir : `${destinationDir}/`];
}

export function rcloneCheckArgs(pkgPath: string, destinationDir: string): string[] {
  return ["check", "--one-way", "--include", basename(pkgPath), dirname(pkgPath), destinationDir.endsWith("/") ? destinationDir : `${destinationDir}/`];
}

export function rcloneLsfArgs(destinationDir: string): string[] {
  return ["lsf", destinationDir.endsWith("/") ? destinationDir : `${destinationDir}/`];
}

export function rcloneDeleteFileArgs(remoteFile: string): string[] {
  return ["deletefile", remoteFile];
}

export function rcloneCopyToArgs(remoteFile: string, localDir: string): string[] {
  return ["copy", remoteFile, localDir.endsWith("/") ? localDir : `${localDir}/`];
}

export function defaultRcloneExec(file: string, args: readonly string[]): string {
  return execFileSync(file, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Runs rclone with a fixed argv. Failures never include child output. */
export function runRclone(args: readonly string[], exec: RcloneExec = defaultRcloneExec): string {
  if (args.some((arg) => typeof arg !== "string")) {
    throw new Error("rclone_failed");
  }
  try {
    return exec("rclone", args);
  } catch {
    throw new Error("rclone_failed");
  }
}

export function parseRcloneNames(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".ashleybak"))
    .map((line) => line.split("/").pop() ?? line);
}

export const DRILL_TABLES: ReadonlyArray<{
  db: "nuclear" | "continuity" | "sidecar";
  table: string;
  appendOnly: boolean;
}> = [
  { db: "nuclear", table: "mem_messages", appendOnly: false },
  { db: "nuclear", table: "mem_facts", appendOnly: false },
  { db: "continuity", table: "continuity_events", appendOnly: true },
  { db: "sidecar", table: "conversation_evidence_log", appendOnly: true },
  { db: "sidecar", table: "diary_entries", appendOnly: false },
];

export function compareDrillCounts(rows: readonly DrillCountRow[]): { ok: true; notes: string[] } | { ok: false; error: string } {
  const notes: string[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.restored) || !Number.isFinite(row.live)) {
      return { ok: false, error: `drill_count_unreadable:${row.table}` };
    }
    if (row.restored > row.live) {
      notes.push(`drill_count_exceeds_live:${row.table}`);
    }
    if (row.live > 0 && row.restored === 0) {
      return { ok: false, error: `drill_count_empty:${row.table}` };
    }
    if (row.appendOnly && row.restored < row.live * 0.9) {
      return { ok: false, error: `drill_count_below_tolerance:${row.table}` };
    }
  }
  return { ok: true, notes };
}

export function countTable(db: DatabaseSync, table: string): number {
  if (!/^[a-z_]+$/.test(table)) throw new Error("drill_table_name");
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

export function removeLocalPackages(dir: string, names: readonly string[]): void {
  for (const name of names) {
    if (!name.endsWith(".ashleybak") || name.includes("/") || name.includes("..")) continue;
    rmSync(join(dir, name), { force: true });
  }
}
