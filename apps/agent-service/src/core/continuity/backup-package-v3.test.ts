import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../cognitive-v021/types.js";
import { openCognitiveSidecarDb } from "../cognitive-v021/sidecar/db.js";
import {
  CONTINUITY_SCHEMA_VERSION,
  getAuthoritativeLineageId,
  openContinuityDb,
} from "./db.js";
import { sweepStaleBackupWork } from "../../scripts/backup-lib.js";
import {
  createDualBackupPackage,
  restoreDualBackupPackage,
  restoreVerifyPackage,
  verifyBackupPackage,
  type BackupManifest,
} from "./backup-package.js";

const KEY = "d".repeat(64);
const dirs: string[] = [];

beforeEach(() => {
  dirs.length = 0;
});

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ashley-backup-v3-"));
  dirs.push(dir);
  return dir;
}

/** Three live databases in dir/live, plus companion files in dir/live (home, sessions, archive, state, secrets). */
function fixture(dir: string) {
  const live = join(dir, "live");
  mkdirSync(join(live, "conversations"), { recursive: true });
  const nuclearPath = join(live, "conversations", "nuclear.db");
  const continuityPath = join(live, "continuity.db");
  const sidecarPath = join(live, "cognitive-v021.db");
  const continuity = openContinuityDb(new DatabaseSync(continuityPath));
  const nuclear = openNuclearDb(new DatabaseSync(nuclearPath), { continuity });
  const sidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
  mkdirSync(join(live, "home", ".trash"), { recursive: true });
  mkdirSync(join(live, "conversations", "sessions"), { recursive: true });
  mkdirSync(join(live, "vault"), { recursive: true });
  mkdirSync(join(live, "home", "vault"), { recursive: true });
  writeFileSync(join(live, "home", "vault", "key.txt"), "a vault inside home never leaves");
  writeFileSync(join(live, "home", ".env.local"), "ASHLEY_BACKUP_TRANSFER_KEY=never-in-a-package");
  writeFileSync(join(live, "home", "notes.txt"), "a note she wrote");
  writeFileSync(join(live, "home", ".trash", "old.txt"), "thrown away, kept");
  writeFileSync(join(live, "conversations", "sessions", "s1.json"), "{\"turns\":2}");
  writeFileSync(join(live, "state.json"), "{\"mode\":\"awake\"}");
  writeFileSync(join(live, ".env"), "ASHLEY_BACKUP_TRANSFER_KEY=never-in-a-package");
  writeFileSync(join(live, "vault", "secret.txt"), "vault never leaves");
  const index = new DatabaseSync(join(live, "conversations", "index.db"));
  index.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT); INSERT INTO messages (text) VALUES ('archived line')");
  index.close();
  return {
    live,
    nuclearPath,
    continuityPath,
    sidecarPath,
    continuity,
    nuclear,
    sidecar,
    close() {
      sidecar.close();
      nuclear.close();
      continuity.close();
    },
  };
}

function packageFixture(dir: string) {
  const f = fixture(dir);
  const created = createDualBackupPackage({
    nuclearDbPath: f.nuclearPath,
    continuityDbPath: f.continuityPath,
    sidecarDbPath: f.sidecarPath,
    continuity: f.continuity,
    outDir: join(dir, "out"),
    transferKeyHex: KEY,
    nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION,
    continuitySchemaVersion: CONTINUITY_SCHEMA_VERSION,
    sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
    companionDataDir: f.live,
    buildIdentity: "backup-v3-test",
  });
  return { f, created, lineageId: getAuthoritativeLineageId(f.continuity) };
}

/** Builds a format-3 package by hand, so a test can give it a manifest the packager would never write. */
function packV3(path: string, manifest: Record<string, unknown>, files: Array<{ name: string; bytes: Buffer }>): void {
  const keyBytes = Buffer.from(KEY, "hex");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(keyBytes, salt, 32, { N: 16384, r: 8, p: 1 }), nonce);
  cipher.setAAD(Buffer.from("ashley-backup-v3", "utf8"));
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  const parts: Buffer[] = [
    Buffer.from(`${JSON.stringify({ name: "manifest.json", size: manifestBytes.length })}\n`),
    manifestBytes,
  ];
  for (const file of files) {
    parts.push(Buffer.from(`${JSON.stringify({ name: file.name, size: file.bytes.length })}\n`), file.bytes);
  }
  const encrypted = Buffer.concat([cipher.update(Buffer.concat(parts)), cipher.final()]);
  const header = JSON.stringify({
    v: 3,
    salt: salt.toString("hex"),
    nonce: nonce.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    kid: createHash("sha256").update(keyBytes).digest("hex").slice(0, 16),
    scrypt: { N: 16384, r: 8, p: 1 },
  });
  writeFileSync(path, Buffer.concat([Buffer.from("ASHLEY1\n"), Buffer.from(`${header}\n`), encrypted]));
}

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("backup package format 3", () => {
  it("carries home, sessions, archive and state with sizes, and never the vault or .env", () => {
    const dir = tempDir();
    const { f, created } = packageFixture(dir);
    try {
      const names = (created.manifest.members ?? []).map((member) => member.name);
      expect(names).toEqual(expect.arrayContaining([
        "nuclear.db",
        "continuity.db",
        "cognitive-v021.db",
        "conversations/index.db",
        "conversations/sessions/s1.json",
        "home/notes.txt",
        "home/.trash/old.txt",
        "state.json",
      ]));
      expect(names.some((name) => /(^|\/)(\.env[^/]*|vault)(\/|$)/.test(name))).toBe(false);
      // Inside home: .env.local and the vault folder (its file is not counted separately).
      expect(created.manifest.excludedSecretFiles).toBe(2);
      const notes = created.manifest.members!.find((member) => member.name === "home/notes.txt")!;
      expect(notes.size).toBe(Buffer.byteLength("a note she wrote"));
      expect(created.manifest.tableRows?.nuclear).toEqual(expect.any(Object));
      expect(created.manifest.cohort).toMatchObject({ quiet: true });
      expect(verifyBackupPackage({ packagePath: created.packagePath, transferKeyHex: KEY }).packageVersion).toBe(3);
    } finally {
      f.close();
    }
  });

  it("writes a key id in the header and reports a wrong key as wrong_key, not tamper", () => {
    const dir = tempDir();
    const { f, created } = packageFixture(dir);
    try {
      const head = readFileSync(created.packagePath).subarray(0, 400).toString("utf8");
      const header = JSON.parse(head.slice("ASHLEY1\n".length, head.indexOf("\n", 8))) as { kid?: string };
      expect(header.kid).toMatch(/^[0-9a-f]{16}$/);
      expect(head).not.toContain(KEY);
      expect(() => verifyBackupPackage({ packagePath: created.packagePath, transferKeyHex: "e".repeat(64) }))
        .toThrow("backup_wrong_key");
      expect(() => verifyBackupPackage({ packagePath: created.packagePath, transferKeyHex: KEY })).not.toThrow();
    } finally {
      f.close();
    }
  });

  it("refuses to package a torn snapshot window and leaves no package behind", () => {
    const dir = tempDir();
    const f = fixture(dir);
    const outDir = join(dir, "out");
    try {
      expect(() => createDualBackupPackage({
        nuclearDbPath: f.nuclearPath,
        continuityDbPath: f.continuityPath,
        sidecarDbPath: f.sidecarPath,
        continuity: f.continuity,
        outDir,
        transferKeyHex: KEY,
        nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION,
        continuitySchemaVersion: CONTINUITY_SCHEMA_VERSION,
        sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
        betweenSnapshots: () => {
          // A writer on the sidecar commits inside the window, as a live cycle would.
          const writer = new DatabaseSync(f.sidecarPath);
          writer.exec("CREATE TABLE IF NOT EXISTS tear_probe (id INTEGER PRIMARY KEY); INSERT INTO tear_probe DEFAULT VALUES");
          writer.close();
        },
      })).toThrow("backup_snapshot_cohort_torn");
      expect(readdirSync(outDir).filter((name) => name.endsWith(".pkg") || name.startsWith(".work-"))).toEqual([]);
    } finally {
      f.close();
    }
  });

  it("restores a package made by the packager into an empty folder, and the result opens and passes integrity", () => {
    const dir = tempDir();
    const { f, created } = packageFixture(dir);
    f.close();
    const target = join(dir, "target");
    mkdirSync(join(target, "conversations"), { recursive: true });
    const restored = restoreDualBackupPackage({
      packagePath: created.packagePath,
      transferKeyHex: KEY,
      nuclearDbPath: join(target, "conversations", "nuclear.db"),
      continuityDbPath: join(target, "continuity.db"),
      sidecarDbPath: join(target, "cognitive-v021.db"),
      tempDir: join(dir, "restore-verify"),
      dataDir: target,
    });
    expect(restored).toMatchObject({ ready: true, note: "restore_ready_after_reconciliation" });
    expect(restored.c1).toMatchObject({ influenceFailClosed: expect.any(Boolean) });
    for (const path of [join(target, "conversations", "nuclear.db"), join(target, "continuity.db"), join(target, "cognitive-v021.db")]) {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      } finally {
        db.close();
      }
    }
    expect(readFileSync(join(target, "home", "notes.txt"), "utf8")).toBe("a note she wrote");
    expect(readFileSync(join(target, "state.json"), "utf8")).toBe("{\"mode\":\"awake\"}");
    expect(existsSync(join(target, "home", ".env.local"))).toBe(false);
    expect(existsSync(join(target, "home", "vault"))).toBe(false);
    const continuity = new DatabaseSync(join(target, "continuity.db"), { readOnly: true });
    try {
      expect(continuity.prepare("SELECT count(*) AS n FROM continuity_events WHERE kind = 'restore'").get())
        .toEqual({ n: 1 });
    } finally {
      continuity.close();
    }
  });

  it("moves a stale hot journal aside so it cannot roll the restored database back", () => {
    const dir = tempDir();
    const { f, created } = packageFixture(dir);
    f.close();
    const target = join(dir, "target");
    mkdirSync(join(target, "conversations"), { recursive: true });
    writeFileSync(join(target, "conversations", "nuclear.db"), "stale live bytes");
    writeFileSync(join(target, "conversations", "nuclear.db-journal"), "garbage hot journal");
    writeFileSync(join(target, "conversations", "nuclear.db-wal"), "garbage wal");
    const restored = restoreDualBackupPackage({
      packagePath: created.packagePath,
      transferKeyHex: KEY,
      nuclearDbPath: join(target, "conversations", "nuclear.db"),
      continuityDbPath: join(target, "continuity.db"),
      sidecarDbPath: join(target, "cognitive-v021.db"),
      tempDir: join(dir, "restore-verify"),
      dataDir: target,
    });
    expect(restored.ready).toBe(true);
    expect(existsSync(join(target, "conversations", "nuclear.db-journal"))).toBe(false);
    expect(existsSync(join(target, "conversations", "nuclear.db-wal"))).toBe(false);
    const previous = readdirSync(target).find((name) => name.startsWith("restore-previous-"))!;
    expect(readdirSync(join(target, previous))).toEqual(expect.arrayContaining([
      "nuclear.db-journal",
      "nuclear.db-wal",
      "nuclear.db",
    ]));
    const db = new DatabaseSync(join(target, "conversations", "nuclear.db"), { readOnly: true });
    try {
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  });

  it("fails the cohort check for a manifest whose window was not quiet, and the hash check for a changed member", () => {
    const dir = tempDir();
    const f = fixture(dir);
    try {
      const nuclearBytes = readFileSync(f.nuclearPath);
      const continuityBytes = readFileSync(f.continuityPath);
      const sidecarBytes = readFileSync(f.sidecarPath);
      const files = [
        { name: "nuclear.db", bytes: nuclearBytes },
        { name: "continuity.db", bytes: continuityBytes },
        { name: "cognitive-v021.db", bytes: sidecarBytes },
      ];
      const startedAt = "2026-10-10T10:00:00.000Z";
      const finishedAt = "2026-10-10T10:00:01.000Z";
      const base = {
        packageVersion: 3,
        lineageId: getAuthoritativeLineageId(f.continuity),
        nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION,
        continuitySchemaVersion: CONTINUITY_SCHEMA_VERSION,
        sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
        c1CorrectionSeq: 0,
        nuclearHash: sha(nuclearBytes),
        continuityHash: sha(continuityBytes),
        sidecarHash: sha(sidecarBytes),
        nuclearSnapshotAt: "2026-10-10T10:00:00.200Z",
        continuitySnapshotAt: "2026-10-10T10:00:00.400Z",
        sidecarSnapshotAt: "2026-10-10T10:00:00.600Z",
        continuityWatermark: sha(continuityBytes),
        buildIdentity: null,
        createdAt: finishedAt,
        members: files.map((file) => ({ name: file.name, size: file.bytes.length, sha256: sha(file.bytes) })),
        cohort: { startedAt, finishedAt, quiet: true, dataVersions: { nuclear: [1, 1], continuity: [1, 1], sidecar: [1, 1] } },
      };
      const verify = (name: string, manifest: Record<string, unknown>, members = files) => {
        const path = join(dir, `${name}.pkg`);
        packV3(path, manifest, members);
        return restoreVerifyPackage({ packagePath: path, transferKeyHex: KEY, tempDir: join(dir, `${name}-verify`) });
      };

      expect(verify("good", base)).toMatchObject({ ready: true });
      expect(verify("torn", { ...base, cohort: { ...base.cohort, quiet: false } }))
        .toMatchObject({ ready: false, note: "backup_package_snapshot_cohort_mismatch" });
      expect(verify("outside", { ...base, sidecarSnapshotAt: "2026-10-10T10:05:00.000Z" }))
        .toMatchObject({ ready: false, note: "backup_package_snapshot_cohort_mismatch" });
      expect(verify("missing", base, files.slice(0, 2)))
        .toMatchObject({ ready: false, note: "backup_package_member_missing" });
      expect(verify("changed", base, [files[0]!, files[1]!, { name: "cognitive-v021.db", bytes: Buffer.from("changed") }]))
        .toMatchObject({ ready: false, note: "backup_package_hash_mismatch" });
    } finally {
      f.close();
    }
  });

  it("sweeps stale work folders and leaves fresh ones alone", () => {
    const dir = tempDir();
    const stale = join(dir, ".work-1-1");
    const fresh = join(dir, ".work-2-1");
    mkdirSync(stale);
    mkdirSync(fresh);
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    const removed = sweepStaleBackupWork(dir, 24 * 60 * 60 * 1000);
    expect(removed).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

export type { BackupManifest };
