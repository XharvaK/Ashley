// Her continuity must survive the loss of this machine: snapshot, seal, verify, and keep a copy off it.
import { linkSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  writeBackupStatusAtomic,
  type BackupStatus,
  type RcloneExec,
} from "./backup-lib.js";

const LOCAL_KEEP = 7;
const DAILY_KEEP = 30;
const MONTHLY_KEEP = 12;

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
    const code = error instanceof Error && error.message === "sidecar_meta_missing"
      ? "sidecar_meta_missing"
      : "backup_schema_unreadable";
    return fail(paths.statusPath, code, log);
  }

  const continuity = new DatabaseSync(paths.continuityDbPath);
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
    });
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
    verifyBackupPackage({ packagePath, transferKeyHex: key });
  } catch (error) {
    const code = error instanceof Error ? error.message : "backup_failed";
    const safe = code.startsWith("backup_") || code === "sidecar_meta_missing" ? code : "backup_failed";
    return fail(paths.statusPath, safe, log);
  } finally {
    continuity.close();
  }

  const names = readdirSync(paths.packageDir).filter((name) => name.endsWith(".ashleybak"));
  const localPlan = planNameRetention(names, LOCAL_KEEP);
  removeLocalPackages(paths.packageDir, localPlan.delete);

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
  if (remote) {
    const exec = options.execRclone ?? defaultRcloneExec;
    try {
      const dailyDir = remoteJoin(remote, "daily");
      const monthlyDir = remoteJoin(remote, "monthly");
      runRclone(rcloneMkdirArgs(dailyDir), exec);
      runRclone(rcloneMkdirArgs(monthlyDir), exec);
      runRclone(rcloneCopyArgs(packagePath, dailyDir), exec);
      runRclone(rcloneCheckArgs(packagePath, dailyDir), exec);
      if (now.getUTCDate() === 1) {
        runRclone(rcloneCopyArgs(packagePath, monthlyDir), exec);
      }
      const dailyNames = parseRcloneNames(runRclone(rcloneLsfArgs(dailyDir), exec));
      for (const name of planNameRetention(dailyNames, DAILY_KEEP).delete) {
        runRclone(rcloneDeleteFileArgs(remoteJoin(remote, "daily", name)), exec);
      }
      const monthlyNames = parseRcloneNames(runRclone(rcloneLsfArgs(monthlyDir), exec));
      for (const name of planNameRetention(monthlyNames, MONTHLY_KEEP).delete) {
        runRclone(rcloneDeleteFileArgs(remoteJoin(remote, "monthly", name)), exec);
      }
      status.last_upload_ok_ms = now.getTime();
      status.last_upload_error = null;
    } catch {
      status.last_upload_error = "rclone_failed";
      writeBackupStatusAtomic(paths.statusPath, status);
      log("rclone_failed");
      return 1;
    }
  }

  writeBackupStatusAtomic(paths.statusPath, status);
  log("backup_ok");
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("backup-daily.js") || process.argv[1]?.endsWith("backup-daily.ts");
if (invokedDirectly) {
  process.exit(runDailyBackup({ env: process.env }));
}
