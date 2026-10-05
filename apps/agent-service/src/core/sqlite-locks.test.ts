import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SHARED_DB_BUSY_TIMEOUT_MS, sqliteResultCode, waitForLocks } from "./sqlite-locks.js";
import { openNuclearDb } from "./db.js";
import { openContinuityDb } from "./continuity/db.js";
import { openTestSidecar } from "./cognitive-v021/test-support.js";
import { readUserVersion } from "../scripts/backup-lib.js";
import { vacuumInto } from "./continuity/backup-package.js";
import { backupFailureCode } from "../scripts/backup-daily.js";

// A second process holds a real lock: one process cannot block itself, and node:sqlite is synchronous.
const HOLDER = `
const { DatabaseSync } = require("node:sqlite");
const [path, mode, ms] = process.argv.slice(1);
const db = new DatabaseSync(path);
db.exec(mode === "write" ? "BEGIN EXCLUSIVE; INSERT INTO t(v) VALUES (1);" : "BEGIN; SELECT count(*) FROM t;");
if (mode === "read") db.prepare("SELECT count(*) AS n FROM t").get();
process.stdout.write("locked\\n");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms));
db.exec("COMMIT");
db.close();
`;

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function database(): string {
  const dir = mkdtempSync(join(tmpdir(), "ashley-locks-"));
  dirs.push(dir);
  const path = join(dir, "shared.db");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE t (v INTEGER); PRAGMA user_version = 7;");
  db.close();
  return path;
}

/** Resolves once the other process holds the lock; it lets go after holdMs. */
function hold(path: string, mode: "read" | "write", holdMs: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--no-warnings", "-e", HOLDER, path, mode, String(holdMs)], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes("locked")) resolve(child);
    });
    child.on("exit", (code) => { if (!out.includes("locked")) reject(new Error(`holder exited ${code}`)); });
  });
}

function caught(run: () => unknown): unknown {
  try { run(); } catch (error) { return error; }
  return null;
}

describe("shared SQLite between the live service and the backup", () => {
  it("every live opener waits on locks", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const sidecar = openTestSidecar();
    try {
      for (const db of [continuity, nuclear, sidecar]) {
        expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: SHARED_DB_BUSY_TIMEOUT_MS });
      }
    } finally {
      sidecar.close(); nuclear.close(); continuity.close();
    }
  });

  it("a live write waits for a backup reading the same file instead of failing", async () => {
    const path = database();
    await hold(path, "read", 400);
    const bare = new DatabaseSync(path);
    const error = caught(() => bare.exec("INSERT INTO t(v) VALUES (2)"));
    bare.close();
    expect(sqliteResultCode(error)).toBe(5);
    const live = waitForLocks(new DatabaseSync(path));
    live.exec("INSERT INTO t(v) VALUES (3)");
    expect(live.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 1 });
    live.close();
  });

  it("the backup's reads and snapshot wait for a live commit instead of failing", async () => {
    const path = database();
    await hold(path, "write", 400);
    const bare = new DatabaseSync(path, { readOnly: true });
    expect(sqliteResultCode(caught(() => bare.prepare("PRAGMA user_version").get()))).toBe(5);
    bare.close();
    expect(readUserVersion(path)).toBe(7);
    await hold(path, "write", 400);
    const copy = join(dirs[0]!, "copy.db");
    vacuumInto(path, copy);
    const snapshot = new DatabaseSync(copy, { readOnly: true });
    expect(snapshot.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 2 });
    snapshot.close();
  });

  it("a backup failure names the SQLite code, never the error text", () => {
    const busy = Object.assign(new Error("database is locked at /home/x/secret.db"), { code: "ERR_SQLITE_ERROR", errcode: 5 });
    const extended = Object.assign(new Error("x"), { code: "ERR_SQLITE_ERROR", errcode: 261 });
    expect(backupFailureCode(busy, "backup_failed")).toBe("backup_sqlite_5");
    expect(backupFailureCode(extended, "backup_failed")).toBe("backup_sqlite_5");
    expect(backupFailureCode(new Error("backup_tamper_detected"), "backup_failed")).toBe("backup_tamper_detected");
    expect(backupFailureCode(new Error("sidecar_meta_missing"), "backup_schema_unreadable")).toBe("sidecar_meta_missing");
    expect(backupFailureCode(new Error("ENOENT /x"), "backup_failed")).toBe("backup_failed");
    expect(backupFailureCode("nope", "backup_schema_unreadable")).toBe("backup_schema_unreadable");
  });
});
