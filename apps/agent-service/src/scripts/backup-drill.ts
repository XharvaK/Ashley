import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { waitForLocks } from "../core/sqlite-locks.js";
import { createProductionDataPlane } from "../core/data-plane.js";
import { loadEnvFile } from "../env.js";
import { restoreDualBackupPackage, restoreVerifyPackage } from "../core/continuity/backup-package.js";
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

/** Regular files under a folder, recursively. A missing folder holds none. */
function countFiles(dir: string): number {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(path);
    else if (entry.isFile() && statSync(path).isFile()) count += 1;
  }
  return count;
}

function integrityOk(path: string): boolean {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return (db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string }).integrity_check === "ok";
  } finally {
    db.close();
  }
}

export function runBackupDrill(options: DrillOptions = {}): number {
  const log = options.log ?? ((line) => console.error(line));
  const now = options.now ?? new Date();
  const plane = createProductionDataPlane(options.dataDir ? { dataDir: options.dataDir } : undefined);
  const paths = backupPathsFromPlane(plane);
  if (options.loadEnv !== false) {
    try {
      loadEnvFile(plane.envPath);
    } catch {
      return finish(paths.statusPath, { drill_error: "env_unreadable" }, log, "env_unreadable");
    }
  }
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

    // The restore runs into a throwaway data directory, never the live one.
    const throwaway = join(temp, "restored-data");
    mkdirSync(join(throwaway, "conversations"), { recursive: true });
    const restored = restoreDualBackupPackage({
      packagePath,
      transferKeyHex: key,
      nuclearDbPath: join(throwaway, "conversations", "nuclear.db"),
      continuityDbPath: join(throwaway, "continuity.db"),
      sidecarDbPath: join(throwaway, "cognitive-v021.db"),
      tempDir: join(temp, "verify"),
      dataDir: throwaway,
    });
    if (!restored.ready) {
      return finish(paths.statusPath, { drill_error: restored.note }, log, restored.note);
    }
    const restoredPaths = {
      nuclear: join(throwaway, "conversations", "nuclear.db"),
      continuity: join(throwaway, "continuity.db"),
      sidecar: join(throwaway, "cognitive-v021.db"),
    };

    let liveVersions;
    let restoredVersions;
    try {
      liveVersions = {
        nuclear: readUserVersion(paths.nuclearDbPath),
        continuity: readUserVersion(paths.continuityDbPath),
        sidecar: readSidecarSchemaVersion(paths.sidecarDbPath),
      };
      restoredVersions = {
        nuclear: readUserVersion(restoredPaths.nuclear),
        continuity: readUserVersion(restoredPaths.continuity),
        sidecar: readSidecarSchemaVersion(restoredPaths.sidecar),
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

    for (const path of Object.values(restoredPaths)) {
      if (!integrityOk(path)) {
        return finish(paths.statusPath, { drill_error: "drill_integrity_failed" }, log, "drill_integrity_failed");
      }
    }

    // Companion files: the restored home and session folders must hold the file count the manifest recorded.
    const members = restored.manifest?.members ?? [];
    const expectedHome = members.filter((member) => member.name.startsWith("home/")).length;
    const expectedSessions = members.filter((member) => member.name.startsWith("conversations/sessions/")).length;
    if (
      countFiles(join(throwaway, "home")) !== expectedHome ||
      countFiles(join(throwaway, "conversations", "sessions")) !== expectedSessions
    ) {
      return finish(paths.statusPath, { drill_error: "drill_companion_count_mismatch" }, log, "drill_companion_count_mismatch");
    }

    const liveDb = {
      nuclear: waitForLocks(new DatabaseSync(paths.nuclearDbPath, { readOnly: true })),
      continuity: waitForLocks(new DatabaseSync(paths.continuityDbPath, { readOnly: true })),
      sidecar: waitForLocks(new DatabaseSync(paths.sidecarDbPath, { readOnly: true })),
    };
    const restoredDb = {
      nuclear: new DatabaseSync(restoredPaths.nuclear, { readOnly: true }),
      continuity: new DatabaseSync(restoredPaths.continuity, { readOnly: true }),
      sidecar: new DatabaseSync(restoredPaths.sidecar, { readOnly: true }),
    };
    try {
      const rows: DrillCountRow[] = DRILL_TABLES.map((spec) => ({
        table: spec.table,
        appendOnly: spec.appendOnly,
        restored: countTable(restoredDb[spec.db], spec.table),
        live: countTable(liveDb[spec.db], spec.table),
      }));
      const compared = compareDrillCounts(rows);
      if (compared.ok) {
        for (const note of compared.notes) log(note);
      }
      if (!compared.ok) {
        return finish(paths.statusPath, { drill_error: compared.error }, log, compared.error);
      }
    } finally {
      for (const db of [...Object.values(liveDb), ...Object.values(restoredDb)]) db.close();
    }

    return finish(paths.statusPath, { drill_ok_ms: now.getTime(), drill_error: null }, log, null);
  } catch {
    return finish(paths.statusPath, { drill_error: "drill_failed" }, log, "drill_failed");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1]?.endsWith("backup-drill.js") || process.argv[1]?.endsWith("backup-drill.ts");
if (invokedDirectly) {
  process.exit(runBackupDrill({ env: process.env }));
}
