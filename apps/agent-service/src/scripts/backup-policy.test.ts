import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openNuclearDb } from "../core/db.js";
import { openContinuityDb } from "../core/continuity/db.js";
import { openCognitiveSidecarDb } from "../core/cognitive-v021/sidecar/db.js";
import { createProductionDataPlane } from "../core/data-plane.js";
import { backupPathsFromPlane, readBackupStatus, type RcloneExec } from "./backup-lib.js";
import { runDailyBackup } from "./backup-daily.js";
import { runBackupDrill } from "./backup-drill.js";

const KEY = "ab".repeat(32);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real, openable data directory: the three databases from their own openers, plus a companion file. */
function realDataDir(prefix: string): { dir: string; paths: ReturnType<typeof backupPathsFromPlane> } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  mkdirSync(join(dir, "conversations"), { recursive: true });
  const plane = createProductionDataPlane({ dataDir: dir });
  const paths = backupPathsFromPlane(plane);
  const continuity = openContinuityDb(new DatabaseSync(paths.continuityDbPath));
  const nuclear = openNuclearDb(new DatabaseSync(paths.nuclearDbPath), { continuity });
  const sidecar = openCognitiveSidecarDb(new DatabaseSync(paths.sidecarDbPath), { dataPlane: { kind: "isolated" } });
  sidecar.close();
  nuclear.close();
  continuity.close();
  mkdirSync(join(dir, "home"), { recursive: true });
  writeFileSync(join(dir, "home", "note.txt"), "kept in the package");
  return { dir, paths };
}

const DAY = 24 * 60 * 60 * 1000;

describe("backup policy on real packages", () => {
  it("sweeps orphan work and partial files left by a killed run, and keeps fresh ones", () => {
    const { dir, paths } = realDataDir("ashley-policy-sweep-");
    mkdirSync(paths.packageDir, { recursive: true });
    const staleWork = join(paths.packageDir, ".work-1-1");
    const stalePkg = join(paths.packageDir, "ashley-backup-1.pkg");
    const freshPkg = join(paths.packageDir, "ashley-backup-2.pkg.tmp");
    mkdirSync(staleWork);
    writeFileSync(stalePkg, "orphan");
    writeFileSync(freshPkg, "in progress");
    const old = new Date(Date.now() - 3 * DAY);
    utimesSync(staleWork, old, old);
    utimesSync(stalePkg, old, old);
    const rc = runDailyBackup({ dataDir: dir, loadEnv: false, env: { ASHLEY_BACKUP_TRANSFER_KEY: KEY }, log: () => {} });
    expect(rc).toBe(0);
    expect(existsSync(staleWork)).toBe(false);
    expect(existsSync(stalePkg)).toBe(false);
    expect(existsSync(freshPkg)).toBe(true);
    const published = readdirSync(paths.packageDir).filter((name) => name.endsWith(".ashleybak"));
    expect(published).toHaveLength(1);
  });

  it("puts the first package of a month into monthly/, not only the package on the 1st", () => {
    const { dir } = realDataDir("ashley-policy-monthly-");
    const copies: string[] = [];
    const exec = (_file: string, args: readonly string[]): string => {
      if (args[0] === "copy") copies.push(String(args.at(-1)));
      if (args[0] === "lsf") return "";
      return "";
    };
    const rc = runDailyBackup({
      dataDir: dir, loadEnv: false, now: new Date("2026-10-05T05:00:00Z"),
      env: { ASHLEY_BACKUP_TRANSFER_KEY: KEY, ASHLEY_BACKUP_RCLONE_REMOTE: "fixture:backups" },
      log: () => {}, execRclone: exec as RcloneExec,
    });
    expect(rc).toBe(0);
    expect(copies.some((target) => target.includes("/monthly"))).toBe(true);
  });

  it("does not repeat the monthly copy when the month already has one on the remote", () => {
    const { dir } = realDataDir("ashley-policy-monthly-skip-");
    const copies: string[] = [];
    const exec = (_file: string, args: readonly string[]): string => {
      if (args[0] === "copy") copies.push(String(args.at(-1)));
      if (args[0] === "lsf" && String(args[1]).includes("/monthly/")) return "20261002T050000Z.ashleybak";
      return "";
    };
    expect(runDailyBackup({
      dataDir: dir, loadEnv: false, now: new Date("2026-10-05T05:00:00Z"),
      env: { ASHLEY_BACKUP_TRANSFER_KEY: KEY, ASHLEY_BACKUP_RCLONE_REMOTE: "fixture:backups" },
      log: () => {}, execRclone: exec as RcloneExec,
    })).toBe(0);
    expect(copies.filter((target) => target.includes("/monthly"))).toHaveLength(0);
  });

  it("removes a local package only after the remote confirms it", () => {
    const { dir, paths } = realDataDir("ashley-policy-prune-");
    mkdirSync(paths.packageDir, { recursive: true });
    const older = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `2026100${i + 1}T050000Z.ashleybak`);
    for (const name of older) writeFileSync(join(paths.packageDir, name), "older package");
    const today = "20261010T050000Z.ashleybak";
    const remoteNames = [today, ...older.slice(1)]; // the oldest local package never reached the remote
    const exec = (_file: string, args: readonly string[]): string => {
      if (args[0] === "lsf" && String(args[1]).includes("/daily/")) return remoteNames.join("\n");
      return "";
    };
    expect(runDailyBackup({
      dataDir: dir, loadEnv: false, now: new Date("2026-10-10T05:00:00Z"),
      env: { ASHLEY_BACKUP_TRANSFER_KEY: KEY, ASHLEY_BACKUP_RCLONE_REMOTE: "fixture:backups" },
      log: () => {}, execRclone: exec as RcloneExec,
    })).toBe(0);
    expect(existsSync(join(paths.packageDir, older[0]!))).toBe(true);
    expect(existsSync(join(paths.packageDir, older[1]!))).toBe(false);
  });

  it("drill restores the newest package into a throwaway folder, checks it and records success", () => {
    const { dir, paths } = realDataDir("ashley-policy-drill-");
    expect(runDailyBackup({ dataDir: dir, loadEnv: false, env: { ASHLEY_BACKUP_TRANSFER_KEY: KEY }, log: () => {} })).toBe(0);
    const logs: string[] = [];
    const rc = runBackupDrill({ dataDir: dir, loadEnv: false, env: { ASHLEY_BACKUP_TRANSFER_KEY: KEY }, log: (line) => logs.push(line) });
    expect(rc).toBe(0);
    expect(logs).toContain("drill_ok");
    expect(readBackupStatus(paths.statusPath)).toMatchObject({ drill_error: null });
    expect(existsSync(join(dir, "home", "note.txt"))).toBe(true);
  });
});
