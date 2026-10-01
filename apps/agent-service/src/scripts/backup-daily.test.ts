import { linkSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIsolatedDataPlane } from "../core/data-plane.js";
import {
  assertBackupTransferKey,
  backupPathsFromPlane,
  planNameRetention,
  readBackupStatus,
  writeBackupStatusAtomic,
  type BackupStatus,
} from "./backup-lib.js";

const emptyStatus = (): BackupStatus => ({
  last_ok_ms: null,
  last_error: null,
  bytes: null,
  package_sha256: null,
  versions: null,
  last_upload_ok_ms: null,
  last_upload_error: null,
  drill_ok_ms: null,
  drill_error: null,
});

describe("backup key validation", () => {
  it("accepts 64 hex characters and refuses anything else as backup_key_missing", () => {
    const good = "ab".repeat(32);
    expect(assertBackupTransferKey(good)).toBe(good);
    const secret = "not-a-key-but-sensitive";
    for (const bad of [undefined, "", "abc", "g".repeat(64), secret, `${good}ff`]) {
      expect(() => assertBackupTransferKey(bad)).toThrowError("backup_key_missing");
      try {
        assertBackupTransferKey(bad);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        expect(text).toBe("backup_key_missing");
        if (bad && bad.length > 8) expect(text.includes(bad)).toBe(false);
      }
    }
  });
});

describe("backup status file", () => {
  it("replaces status.json via temp file and rename and leaves no temp behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-backup-status-"));
    const path = join(dir, "status.json");
    const first = { ...emptyStatus(), last_ok_ms: 10, bytes: 4, package_sha256: "a".repeat(64) };
    writeBackupStatusAtomic(path, first);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(first);
    const second = { ...first, last_ok_ms: 20, bytes: 8 };
    writeBackupStatusAtomic(path, second);
    expect(readBackupStatus(path)).toEqual(second);
    expect(readFileSync(path, "utf8").includes(".tmp")).toBe(false);
  });

  it("keeps the previous status.json when the next write fails before rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-backup-status-"));
    const path = join(dir, "status.json");
    const first = { ...emptyStatus(), last_error: "earlier" };
    writeBackupStatusAtomic(path, first);
    const circular: BackupStatus = emptyStatus();
    const self = circular as BackupStatus & { self?: unknown };
    self.self = self;
    expect(() => writeBackupStatusAtomic(path, self)).toThrow();
    expect(readBackupStatus(path)).toEqual(first);
  });
});

describe("local retention", () => {
  it("keeps the newest 7 package names and never deletes the newest", () => {
    const names = Array.from({ length: 10 }, (_, i) => `2026100${i}T050000Z.ashleybak`);
    const plan = planNameRetention(names, 7);
    expect(plan.keep).toHaveLength(7);
    expect(plan.keep[0]).toBe("20261009T050000Z.ashleybak");
    expect(plan.delete).toEqual([
      "20261000T050000Z.ashleybak",
      "20261001T050000Z.ashleybak",
      "20261002T050000Z.ashleybak",
    ]);
    expect(plan.delete.includes(plan.keep[0]!)).toBe(false);
  });
});

describe("remote retention planning", () => {
  it("keeps 30 dailies and 12 monthlies and never deletes the newest", () => {
    const dailies = Array.from({ length: 35 }, (_, i) =>
      `2026${String(i).padStart(4, "0")}T050000Z.ashleybak`);
    const daily = planNameRetention(dailies, 30);
    expect(daily.keep).toHaveLength(30);
    expect(daily.keep[0]).toBe(dailies[34]);
    expect(daily.delete).toHaveLength(5);
    expect(daily.delete.includes(dailies[34]!)).toBe(false);

    const monthlies = Array.from({ length: 14 }, (_, i) =>
      `2025${String(i).padStart(2, "0")}01T050000Z.ashleybak`);
    const monthly = planNameRetention(monthlies, 12);
    expect(monthly.keep).toHaveLength(12);
    expect(monthly.delete).toHaveLength(2);
    expect(monthly.keep[0]).toBe(monthlies[13]);
    expect(planNameRetention(["only.ashleybak"], 0).delete).toEqual([]);
    expect(planNameRetention(["only.ashleybak"], 0).keep).toEqual(["only.ashleybak"]);
  });
});

describe("data-plane backup paths", () => {
  it("selects the data-plane sidecar and never conversations/cognitive-v021.db", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-backup-plane-"));
    mkdirSync(join(dir, "conversations"), { recursive: true });
    writeFileSync(join(dir, "conversations", "cognitive-v021.db"), "");
    const plane = createIsolatedDataPlane(dir);
    const paths = backupPathsFromPlane(plane);
    expect(paths.nuclearDbPath).toBe(plane.nuclearDbPath);
    expect(paths.continuityDbPath).toBe(plane.continuityDbPath);
    expect(paths.sidecarDbPath).toBe(plane.cognitiveSidecarDbPath);
    expect(paths.sidecarDbPath.endsWith("/cognitive-v021.db")).toBe(true);
    expect(paths.sidecarDbPath.includes("/conversations/")).toBe(false);
    expect(paths.sidecarDbPath).not.toBe(join(plane.conversationsDir, "cognitive-v021.db"));
  });
});


vi.mock("../core/continuity/backup-package.js", () => ({
  createDualBackupPackage: ({ outDir }: { outDir: string }) => {
    mkdirSync(outDir, { recursive: true });
    const packagePath = join(outDir, "created.ashleybak");
    writeFileSync(packagePath, "fixture");
    return { packagePath };
  },
  verifyBackupPackage: () => ({}),
}));

it("checks only the uploaded member when older local packages are absent remotely", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { runDailyBackup } = await import("./backup-daily.js");
  const dir = mkdtempSync(join(tmpdir(), "ashley-upload-scope-"));
  try {
    const paths = backupPathsFromPlane(createIsolatedDataPlane(dir));
    mkdirSync(join(dir, "conversations"), { recursive: true });
    for (const path of [paths.nuclearDbPath, paths.continuityDbPath, paths.sidecarDbPath]) {
      const db = new DatabaseSync(path);
      if (path === paths.sidecarDbPath) {
        db.exec("CREATE TABLE cognitive_sidecar_meta (id INTEGER, schema_version INTEGER); INSERT INTO cognitive_sidecar_meta VALUES (1, 1)");
      }
      db.close();
    }
    mkdirSync(paths.packageDir, { recursive: true });
    writeFileSync(join(paths.packageDir, "20260930T050000Z.ashleybak"), "older");
    const newest = "20261002T050000Z.ashleybak";
    const calls: string[][] = [];
    const rc = runDailyBackup({ dataDir: dir, loadEnv: false, now: new Date("2026-10-02T05:00:00Z"),
      env: { ASHLEY_BACKUP_TRANSFER_KEY: "ab".repeat(32), ASHLEY_BACKUP_RCLONE_REMOTE: "fixture:backups" },
      log: () => {}, execRclone: (_file, args) => {
        calls.push([...args]);
        if (args[0] === "check" && !args.includes(newest)) throw new Error("older local package missing remotely");
        return args[0] === "lsf" ? newest : "";
      } });
    expect(rc).toBe(0);
    expect(calls.find((args) => args[0] === "check")).toEqual([
      "check", "--one-way", "--include", newest, paths.packageDir, "fixture:backups/daily/",
    ]);
    expect(readBackupStatus(paths.statusPath)).toMatchObject({ last_upload_error: null,
      last_upload_ok_ms: new Date("2026-10-02T05:00:00Z").getTime() });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


it("records env_unreadable and preserves the previous daily success", async () => {
  const { runDailyBackup } = await import("./backup-daily.js");
  const dir = mkdtempSync(join(tmpdir(), "ashley-daily-env-"));
  try {
    const statusPath = join(dir, "backups", "status.json");
    mkdirSync(join(dir, ".env")); // Reading a directory fails even when tests run as root.
    writeBackupStatusAtomic(statusPath, { ...emptyStatus(), last_ok_ms: 123 });
    const log = vi.fn();
    expect(runDailyBackup({ dataDir: dir, log })).toBe(1);
    expect(readBackupStatus(statusPath)).toMatchObject({ last_ok_ms: 123, last_error: "env_unreadable" });
    expect(log).toHaveBeenCalledWith("env_unreadable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("fails with package_exists without replacing an existing stamped package", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { runDailyBackup } = await import("./backup-daily.js");
  const dir = mkdtempSync(join(tmpdir(), "ashley-package-exists-"));
  try {
    const paths = backupPathsFromPlane(createIsolatedDataPlane(dir));
    mkdirSync(join(dir, "conversations"), { recursive: true });
    for (const path of [paths.nuclearDbPath, paths.continuityDbPath, paths.sidecarDbPath]) {
      const db = new DatabaseSync(path);
      if (path === paths.sidecarDbPath) db.exec("CREATE TABLE cognitive_sidecar_meta (id INTEGER, schema_version INTEGER); INSERT INTO cognitive_sidecar_meta VALUES (1, 1)");
      db.close();
    }
    mkdirSync(paths.packageDir, { recursive: true });
    const stamped = join(paths.packageDir, "20261002T050000Z.ashleybak");
    writeFileSync(stamped, "original package");
    writeBackupStatusAtomic(paths.statusPath, { ...emptyStatus(), last_ok_ms: 123 });
    const log = vi.fn();
    expect(runDailyBackup({ dataDir: dir, loadEnv: false, now: new Date("2026-10-02T05:00:00Z"),
      env: { ASHLEY_BACKUP_TRANSFER_KEY: "ab".repeat(32) }, log })).toBe(1);
    expect(readFileSync(stamped, "utf8")).toBe("original package");
    expect(readBackupStatus(paths.statusPath)).toMatchObject({ last_ok_ms: 123, last_error: "package_exists" });
    expect(log).toHaveBeenCalledWith("package_exists");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Keep filesystem behavior real except for the explicitly injected publication failure.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, linkSync: vi.fn(actual.linkSync) };
});

async function dailyFixture(prefix: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const paths = backupPathsFromPlane(createIsolatedDataPlane(dir));
  mkdirSync(join(dir, "conversations"), { recursive: true });
  for (const path of [paths.nuclearDbPath, paths.continuityDbPath, paths.sidecarDbPath]) {
    const db = new DatabaseSync(path);
    if (path === paths.sidecarDbPath) db.exec("CREATE TABLE cognitive_sidecar_meta (id INTEGER, schema_version INTEGER); INSERT INTO cognitive_sidecar_meta VALUES (1, 1)");
    db.close();
  }
  return { dir, paths };
}

it.each(["daily", "monthly", "identical"])("remote no-clobber: %s same-name object", async (collision) => {
  const { runDailyBackup } = await import("./backup-daily.js");
  const { dir, paths } = await dailyFixture("ashley-remote-immutable-");
  try {
    const name = "20261001T050000Z.ashleybak";
    const daily = "fixture:backups/daily/";
    const monthly = "fixture:backups/monthly/";
    const objects = new Map<string, string>();
    if (collision === "identical") {
      objects.set(daily + name, "fixture");
      objects.set(monthly + name, "fixture");
    } else {
      objects.set((collision === "daily" ? daily : monthly) + name, "original remote object");
    }
    writeBackupStatusAtomic(paths.statusPath, { ...emptyStatus(), last_upload_ok_ms: 123 });
    const calls: string[][] = [];
    const log = vi.fn();
    const rc = runDailyBackup({ dataDir: dir, loadEnv: false, now: new Date("2026-10-01T05:00:00Z"),
      env: { ASHLEY_BACKUP_TRANSFER_KEY: "ab".repeat(32), ASHLEY_BACKUP_RCLONE_REMOTE: "fixture:backups" },
      log, execRclone: (_file, args) => {
        calls.push([...args]);
        if (args[0] === "copy") {
          const positional = args.slice(1).filter((arg) => !arg.startsWith("--"));
          const bytes = readFileSync(positional[0]!, "utf8");
          const key = positional[1]! + name;
          if (args.includes("--immutable") && objects.has(key) && objects.get(key) !== bytes) {
            throw new Error("different remote bytes");
          }
          objects.set(key, bytes);
        }
        return args[0] === "lsf" ? name : "";
      } });
    const copies = calls.filter((args) => args[0] === "copy");
    expect(copies).toHaveLength(collision === "daily" ? 1 : 2);
    for (const args of copies) expect(args).toContain("--immutable");
    expect(copies[0]).toContain(daily);
    if (collision !== "daily") expect(copies[1]).toContain(monthly);
    expect(readFileSync(join(paths.packageDir, name), "utf8")).toBe("fixture");
    if (collision === "identical") {
      expect(rc).toBe(0);
      expect(objects.get(daily + name)).toBe("fixture");
      expect(objects.get(monthly + name)).toBe("fixture");
      expect(readBackupStatus(paths.statusPath)).toMatchObject({ last_upload_error: null,
        last_upload_ok_ms: new Date("2026-10-01T05:00:00Z").getTime() });
    } else {
      expect(rc).toBe(1);
      expect(objects.get((collision === "daily" ? daily : monthly) + name)).toBe("original remote object");
      expect(readBackupStatus(paths.statusPath)).toMatchObject({ last_upload_error: "rclone_failed", last_upload_ok_ms: 123 });
      expect(log).toHaveBeenCalledWith("rclone_failed");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("removes the generated source and records package_publish_failed on link EPERM", async () => {
  const { runDailyBackup } = await import("./backup-daily.js");
  const { dir, paths } = await dailyFixture("ashley-link-eperm-");
  try {
    writeBackupStatusAtomic(paths.statusPath, { ...emptyStatus(), last_ok_ms: 123 });
    vi.mocked(linkSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("simulated publication denial"), { code: "EPERM" });
    });
    const log = vi.fn();
    const execRclone = vi.fn();
    expect(runDailyBackup({ dataDir: dir, loadEnv: false, now: new Date("2026-10-01T05:00:00Z"),
      env: { ASHLEY_BACKUP_TRANSFER_KEY: "ab".repeat(32), ASHLEY_BACKUP_RCLONE_REMOTE: "fixture:backups" },
      log, execRclone })).toBe(1);
    expect(readBackupStatus(paths.statusPath)).toMatchObject({ last_error: "package_publish_failed", last_ok_ms: 123 });
    expect(existsSync(join(paths.packageDir, "created.ashleybak"))).toBe(false);
    expect(existsSync(join(paths.packageDir, "20261001T050000Z.ashleybak"))).toBe(false);
    expect(log).toHaveBeenCalledWith("package_publish_failed");
    expect(execRclone).not.toHaveBeenCalled();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
