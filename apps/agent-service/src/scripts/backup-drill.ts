import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createProductionDataPlane } from "../core/data-plane.js";
import { loadEnvFile } from "../env.js";
import { materializeVerifiedBackupMembers, restoreVerifyPackage } from "../core/continuity/backup-package.js";
import {
  assertBackupTransferKey,
  backupPathsFromPlane,
  compareDrillCounts,
  countTable,
  defaultRcloneExec,
  DRILL_TABLES,
  parseRcloneNames,
  planNameRetention,
  readBackupStatus,
  readSidecarSchemaVersion,
  readUserVersion,
  remoteJoin,
  rcloneCopyToArgs,
  rcloneLsfArgs,
  runRclone,
  writeBackupStatusAtomic,
  type DrillCountRow,
  type RcloneExec,
} from "./backup-lib.js";

export type DrillOptions = {
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  loadEnv?: boolean;
  execRclone?: RcloneExec;
  now?: Date;
  log?: (line: string) => void;
};

function finish(statusPath: string, patch: { drill_ok_ms?: number | null; drill_error: string | null }, log: (line: string) => void, code: string | null): number {
  const prev = readBackupStatus(statusPath);
  writeBackupStatusAtomic(statusPath, {
    ...prev,
    drill_ok_ms: patch.drill_ok_ms === undefined ? prev.drill_ok_ms : patch.drill_ok_ms,
    drill_error: patch.drill_error,
  });
  if (code) log(code);
  else log("drill_ok");
  return code ? 1 : 0;
}

export function runBackupDrill(options: DrillOptions = {}): number {
  const log = options.log ?? ((line) => console.error(line));
  const now = options.now ?? new Date();
  const plane = createProductionDataPlane(options.dataDir ? { dataDir: options.dataDir } : undefined);
  if (options.loadEnv !== false) {
    try {
      loadEnvFile(plane.envPath);
    } catch {
      log("backup_env_unreadable");
      return 1;
    }
  }
  const paths = backupPathsFromPlane(plane);
  let key: string;
  try {
    const fromEnv = options.env ? options.env.ASHLEY_BACKUP_TRANSFER_KEY : process.env.ASHLEY_BACKUP_TRANSFER_KEY;
    key = assertBackupTransferKey(fromEnv);
  } catch {
    return finish(paths.statusPath, { drill_error: "backup_key_missing" }, log, "backup_key_missing");
  }

  const temp = mkdtempSync(join(tmpdir(), "ashley-backup-drill-"));
  try {
    const remote = (options.env ? options.env.ASHLEY_BACKUP_RCLONE_REMOTE : process.env.ASHLEY_BACKUP_RCLONE_REMOTE)?.trim();
    let packagePath: string;
    if (remote) {
      const exec = options.execRclone ?? defaultRcloneExec;
      let names: string[];
      try {
        names = parseRcloneNames(runRclone(rcloneLsfArgs(remoteJoin(remote, "daily")), exec));
      } catch {
        return finish(paths.statusPath, { drill_error: "rclone_failed" }, log, "rclone_failed");
      }
      const newest = planNameRetention(names, 1).keep[0];
      if (!newest) {
        return finish(paths.statusPath, { drill_error: "drill_package_missing" }, log, "drill_package_missing");
      }
      try {
        runRclone(rcloneCopyToArgs(remoteJoin(remote, "daily", newest), temp), exec);
      } catch {
        return finish(paths.statusPath, { drill_error: "rclone_failed" }, log, "rclone_failed");
      }
      packagePath = join(temp, newest);
    } else {
      let names: string[] = [];
      try {
        names = readdirSync(paths.packageDir).filter((name) => name.endsWith(".ashleybak"));
      } catch {
        names = [];
      }
      const newest = planNameRetention(names, 1).keep[0];
      if (!newest) {
        return finish(paths.statusPath, { drill_error: "drill_package_missing" }, log, "drill_package_missing");
      }
      packagePath = join(paths.packageDir, newest);
    }

    const verified = restoreVerifyPackage({
      packagePath,
      transferKeyHex: key,
      tempDir: temp,
    });
    if (!verified.ready) {
      return finish(paths.statusPath, { drill_error: verified.note }, log, verified.note);
    }
    const members = materializeVerifiedBackupMembers({
      packagePath,
      transferKeyHex: key,
      tempDir: join(temp, "members"),
    });

    let liveVersions;
    let restoredVersions;
    try {
      liveVersions = {
        nuclear: readUserVersion(paths.nuclearDbPath),
        continuity: readUserVersion(paths.continuityDbPath),
        sidecar: readSidecarSchemaVersion(paths.sidecarDbPath),
      };
      restoredVersions = {
        nuclear: readUserVersion(members.nuclearDbPath),
        continuity: readUserVersion(members.continuityDbPath),
        sidecar: readSidecarSchemaVersion(members.sidecarDbPath),
      };
    } catch (error) {
      const code = error instanceof Error && error.message === "sidecar_meta_missing"
        ? "sidecar_meta_missing"
        : "drill_schema_unreadable";
      return finish(paths.statusPath, { drill_error: code }, log, code);
    }
    if (
      restoredVersions.nuclear > liveVersions.nuclear ||
      restoredVersions.continuity > liveVersions.continuity ||
      restoredVersions.sidecar > liveVersions.sidecar
    ) {
      return finish(paths.statusPath, { drill_error: "drill_schema_ahead_of_live" }, log, "drill_schema_ahead_of_live");
    }

    const liveDb = {
      nuclear: new DatabaseSync(paths.nuclearDbPath, { readOnly: true }),
      continuity: new DatabaseSync(paths.continuityDbPath, { readOnly: true }),
      sidecar: new DatabaseSync(paths.sidecarDbPath, { readOnly: true }),
    };
    const restoredDb = {
      nuclear: new DatabaseSync(members.nuclearDbPath, { readOnly: true }),
      continuity: new DatabaseSync(members.continuityDbPath, { readOnly: true }),
      sidecar: new DatabaseSync(members.sidecarDbPath, { readOnly: true }),
    };
    try {
      const rows: DrillCountRow[] = DRILL_TABLES.map((spec) => ({
        table: spec.table,
        appendOnly: spec.appendOnly,
        restored: countTable(restoredDb[spec.db], spec.table),
        live: countTable(liveDb[spec.db], spec.table),
      }));
      const compared = compareDrillCounts(rows);
      if (!compared.ok) {
        return finish(paths.statusPath, { drill_error: compared.error }, log, compared.error);
      }
    } finally {
      for (const db of [...Object.values(liveDb), ...Object.values(restoredDb)]) db.close();
    }

    return finish(paths.statusPath, { drill_ok_ms: now.getTime(), drill_error: null }, log, null);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1]?.endsWith("backup-drill.js") || process.argv[1]?.endsWith("backup-drill.ts");
if (invokedDirectly) {
  process.exit(runBackupDrill({ env: process.env }));
}
