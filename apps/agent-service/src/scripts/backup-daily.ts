// Her continuity must survive the loss of this machine: snapshot, seal, verify, and keep a copy off it.
import { linkSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqliteResultCode, waitForLocks } from "../core/sqlite-locks.js";
import { createProductionDataPlane } from "../core/data-plane.js";
import { loadEnvFile } from "../env.js";
import {
  createDualBackupPackage,
  verifyBackupPackage,
} from "../core/continuity/backup-package.js";
import {
  assertBackupTransferKey,
  backupPathsFromPlane,
  defaultRcloneExec,
  emptyBackupStatus,
  fileBytes,
  packageStamp,
  parseRcloneNames,
  planNameRetention,
  readBackupStatus,
  readSidecarSchemaVersion,
  readUserVersion,
  remoteJoin,
  removeLocalPackages,
  rcloneCheckArgs,
  rcloneCopyArgs,
  rcloneDeleteFileArgs,
  rcloneLsfArgs,
  rcloneMkdirArgs,
  runRclone,
  sha256File,
  sweepStaleBackupWork,
  writeBackupStatusAtomic,
  type BackupStatus,
  type RcloneExec,
} from "./backup-lib.js";

const LOCAL_KEEP = 7;
const DAILY_KEEP = 30;
const MONTHLY_KEEP = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyBackupOptions = {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  dataDir?: string;
  loadEnv?: boolean;
  execRclone?: RcloneExec;
  log?: (line: string) => void;
};

function fail(statusPath: string | null, code: string, log: (line: string) => void): number {
  log(code);
  if (statusPath) {
    const prev = readBackupStatus(statusPath);
    writeBackupStatusAtomic(statusPath, { ...prev, last_error: code });
  }
  return 1;
}

/**
 * The status code for a failed step: the package's own backup_* codes as they are, an SQLite
 * error as backup_sqlite_<primary result code> (5 busy, 6 locked, 11 corrupt, ...), anything
 * else as the step's fallback. Never the error text (it may carry paths).
 */
export function backupFailureCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("backup_") || message === "sidecar_meta_missing") return message;
  const sqlite = sqliteResultCode(error);
  return sqlite === null ? fallback : `backup_sqlite_${sqlite}`;
}

export function runDailyBackup(options: DailyBackupOptions = {}): number {
  const log = options.log ?? ((line) => console.error(line));
  const now = options.now ?? new Date();
  const plane = createProductionDataPlane(options.dataDir ? { dataDir: options.dataDir } : undefined);
  const paths = backupPathsFromPlane(plane);
  if (options.loadEnv !== false) {
    try {
      loadEnvFile(plane.envPath);
    } catch {
      return fail(paths.statusPath, "env_unreadable", log);
    }
  }
  let key: string;
  try {
    const fromEnv = options.env ? options.env.ASHLEY_BACKUP_TRANSFER_KEY : process.env.ASHLEY_BACKUP_TRANSFER_KEY;
    key = assertBackupTransferKey(fromEnv);
  } catch (error) {
    const code = error instanceof Error ? error.message : "backup_key_missing";
    return fail(paths.statusPath, code === "backup_key_missing" ? code : "backup_key_missing", log);
  }

  let versions;
  try {
    versions = {
      nuclear: readUserVersion(paths.nuclearDbPath),
      continuity: readUserVersion(paths.continuityDbPath),
      sidecar: readSidecarSchemaVersion(paths.sidecarDbPath),
    };
  } catch (error) {
    return fail(paths.statusPath, backupFailureCode(error, "backup_schema_unreadable"), log);
  }

  try {
    // A run killed earlier leaves work folders and partial packages; they never take a retention slot.
    sweepStaleBackupWork(paths.packageDir, DAY_MS, now.getTime());
  } catch {
    /* a stale file that cannot be removed does not stop today's backup */
  }

  const continuity = waitForLocks(new DatabaseSync(paths.continuityDbPath));
  let packagePath: string;
  try {
    const created = createDualBackupPackage({
      nuclearDbPath: paths.nuclearDbPath,
      continuityDbPath: paths.continuityDbPath,
      sidecarDbPath: paths.sidecarDbPath,
      continuity,
      outDir: paths.packageDir,
      transferKeyHex: key,
      nuclearSchemaVersion: versions.nuclear,
      continuitySchemaVersion: versions.continuity,
      sidecarSchemaVersion: versions.sidecar,
      companionDataDir: paths.companionDataDir,
    });
    // Verify the unpublished package first: one that does not verify never takes a retention slot.
    try {
      verifyBackupPackage({ packagePath: created.packagePath, transferKeyHex: key });
    } catch (error) {
      unlinkSync(created.packagePath);
      throw error;
    }
    const stamped = join(paths.packageDir, `${packageStamp(now)}.ashleybak`);
    // Atomic publication: link fails with EEXIST even if another run wins the race.
    try {
      linkSync(created.packagePath, stamped);
    } catch (error) {
      unlinkSync(created.packagePath);
      const code = (error as NodeJS.ErrnoException).code === "EEXIST"
        ? "package_exists"
        : "package_publish_failed";
      return fail(paths.statusPath, code, log);
    }
    unlinkSync(created.packagePath);
    packagePath = stamped;
  } catch (error) {
    return fail(paths.statusPath, backupFailureCode(error, "backup_failed"), log);
  } finally {
    continuity.close();
  }

  const status: BackupStatus = {
    ...emptyBackupStatus(),
    ...readBackupStatus(paths.statusPath),
    last_ok_ms: now.getTime(),
    last_error: null,
    bytes: fileBytes(packagePath),
    package_sha256: sha256File(packagePath),
    versions,
  };

  const remote = (options.env ? options.env.ASHLEY_BACKUP_RCLONE_REMOTE : process.env.ASHLEY_BACKUP_RCLONE_REMOTE)?.trim();
  // Names confirmed on the remote daily folder after this run; only these may leave the machine.
  let confirmedOnRemote: Set<string> | null = null;
  if (remote) {
    const exec = options.execRclone ?? defaultRcloneExec;
    try {
      const dailyDir = remoteJoin(remote, "daily");
      const monthlyDir = remoteJoin(remote, "monthly");
      runRclone(rcloneMkdirArgs(dailyDir), exec);
      runRclone(rcloneMkdirArgs(monthlyDir), exec);
      runRclone(rcloneCopyArgs(packagePath, dailyDir), exec);
      runRclone(rcloneCheckArgs(packagePath, dailyDir), exec);
      // The first package of a UTC month goes to monthly/ (not only the 1st), so one failed run never loses the month.
      const monthKey = packageStamp(now).slice(0, 6);
      const monthlyBefore = parseRcloneNames(runRclone(rcloneLsfArgs(monthlyDir), exec));
      if (!monthlyBefore.some((name) => name.startsWith(monthKey))) {
        runRclone(rcloneCopyArgs(packagePath, monthlyDir), exec);
      }
      const dailyNames = parseRcloneNames(runRclone(rcloneLsfArgs(dailyDir), exec));
      const dailyDelete = planNameRetention(dailyNames, DAILY_KEEP).delete;
      for (const name of dailyDelete) {
        runRclone(rcloneDeleteFileArgs(remoteJoin(remote, "daily", name)), exec);
      }
      const monthlyNames = parseRcloneNames(runRclone(rcloneLsfArgs(monthlyDir), exec));
      for (const name of planNameRetention(monthlyNames, MONTHLY_KEEP).delete) {
        runRclone(rcloneDeleteFileArgs(remoteJoin(remote, "monthly", name)), exec);
      }
      const removedRemote = new Set(dailyDelete);
      confirmedOnRemote = new Set(dailyNames.filter((name) => !removedRemote.has(name)));
      status.last_upload_ok_ms = now.getTime();
      status.last_upload_error = null;
    } catch {
      status.last_upload_error = "rclone_failed";
      writeBackupStatusAtomic(paths.statusPath, status);
      log("rclone_failed");
      return 1;
    }
  }

  // Local prune. With a remote configured, a local package is removed only once the remote holds it.
  const names = readdirSync(paths.packageDir).filter((name) => name.endsWith(".ashleybak"));
  const localPlan = planNameRetention(names, LOCAL_KEEP);
  // With a remote configured only confirmed names may go (a failed upload already returned above).
  const removable = remote
    ? localPlan.delete.filter((name) => confirmedOnRemote?.has(name) === true)
    : localPlan.delete;
  removeLocalPackages(paths.packageDir, removable);

  writeBackupStatusAtomic(paths.statusPath, status);
  log("backup_ok");
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("backup-daily.js") || process.argv[1]?.endsWith("backup-daily.ts");
if (invokedDirectly) {
  process.exit(runDailyBackup({ env: process.env }));
}
