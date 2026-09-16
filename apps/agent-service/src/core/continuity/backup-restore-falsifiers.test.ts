import {
  createCipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../cognitive-v021/types.js";
import { openCognitiveSidecarDb } from "../cognitive-v021/sidecar/db.js";
import {
  CONTINUITY_SCHEMA_VERSION,
  openContinuityDb,
} from "./db.js";
import {
  BACKUP_PACKAGE_VERSION,
  createDualBackupPackage,
  restoreVerifyPackage,
  type BackupManifest,
} from "./backup-package.js";

function closeAll(...dbs: DatabaseSync[]): void {
  for (const db of dbs) db.close();
}

function encryptPackage(manifest: BackupManifest, nuclear: Buffer, continuity: Buffer, sidecar: Buffer, keyHex: string): Buffer {
  const payload = Buffer.concat([
    Buffer.from(JSON.stringify(manifest), "utf8"),
    Buffer.from("\n--\n", "utf8"),
    nuclear,
    Buffer.from("\n--NUCLEAR--\n", "utf8"),
    continuity,
    Buffer.from("\n--CONTINUITY--\n", "utf8"),
    sidecar,
  ]);
  const salt = randomBytes(16);
  const derived = scryptSync(Buffer.from(keyHex, "hex"), salt, 32, { N: 16384, r: 8, p: 1 });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived, nonce);
  cipher.setAAD(Buffer.from(`ashley-backup-v${BACKUP_PACKAGE_VERSION}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const header = Buffer.from(JSON.stringify({
    v: BACKUP_PACKAGE_VERSION,
    salt: salt.toString("hex"),
    nonce: nonce.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    scrypt: { N: 16384, r: 8, p: 1 },
  }), "utf8");
  return Buffer.concat([Buffer.from("ASHLEY1\n", "utf8"), header, Buffer.from("\n", "utf8"), encrypted]);
}

describe("P18 restore incompatibility falsifiers", () => {
  it("refuses future nuclear, sidecar, and continuity schema ordinals", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-backup-future-"));
    const nuclearPath = join(dir, "nuclear.db");
    const continuityPath = join(dir, "continuity.db");
    const sidecarPath = join(dir, "sidecar.db");
    const key = "d".repeat(64);
    const continuity = openContinuityDb(new DatabaseSync(continuityPath));
    const nuclear = openNuclearDb(new DatabaseSync(nuclearPath), { continuity });
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
    try {
      const futureNuclear = createDualBackupPackage({
        nuclearDbPath: nuclearPath,
        continuityDbPath: continuityPath,
        sidecarDbPath: sidecarPath,
        continuity,
        outDir: join(dir, "future-nuclear"),
        transferKeyHex: key,
        nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION + 1,
        continuitySchemaVersion: CONTINUITY_SCHEMA_VERSION,
        sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
      });
      expect(restoreVerifyPackage({
        packagePath: futureNuclear.packagePath,
        transferKeyHex: key,
        currentContinuity: continuity,
        tempDir: join(dir, "restore-future-nuclear"),
      })).toMatchObject({ ready: false, note: "backup_package_schema_unsupported" });

      const futureSidecar = createDualBackupPackage({
        nuclearDbPath: nuclearPath,
        continuityDbPath: continuityPath,
        sidecarDbPath: sidecarPath,
        continuity,
        outDir: join(dir, "future-sidecar"),
        transferKeyHex: key,
        nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION,
        continuitySchemaVersion: CONTINUITY_SCHEMA_VERSION,
        sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION + 1,
      });
      expect(restoreVerifyPackage({
        packagePath: futureSidecar.packagePath,
        transferKeyHex: key,
        currentContinuity: continuity,
        tempDir: join(dir, "restore-future-sidecar"),
      })).toMatchObject({ ready: false, note: "backup_package_schema_unsupported" });

      const futureContinuity = createDualBackupPackage({
        nuclearDbPath: nuclearPath,
        continuityDbPath: continuityPath,
        sidecarDbPath: sidecarPath,
        continuity,
        outDir: join(dir, "future-continuity"),
        transferKeyHex: key,
        nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION,
        continuitySchemaVersion: CONTINUITY_SCHEMA_VERSION + 1,
        sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
      });
      expect(restoreVerifyPackage({
        packagePath: futureContinuity.packagePath,
        transferKeyHex: key,
        currentContinuity: continuity,
        tempDir: join(dir, "restore-future-continuity"),
      })).toMatchObject({ ready: false, note: "backup_package_schema_unsupported" });
    } finally {
      closeAll(sidecar, nuclear, continuity);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses mixed-age timestamps, hash mismatch, and keeps restore not-ready", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-backup-mismatch-"));
    const nuclearPath = join(dir, "nuclear.db");
    const continuityPath = join(dir, "continuity.db");
    const sidecarPath = join(dir, "sidecar.db");
    const key = "e".repeat(64);
    const continuity = openContinuityDb(new DatabaseSync(continuityPath));
    const nuclear = openNuclearDb(new DatabaseSync(nuclearPath), { continuity });
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
    try {
      const valid = createDualBackupPackage({
        nuclearDbPath: nuclearPath,
        continuityDbPath: continuityPath,
        sidecarDbPath: sidecarPath,
        continuity,
        outDir: join(dir, "valid"),
        transferKeyHex: key,
        nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION,
        continuitySchemaVersion: CONTINUITY_SCHEMA_VERSION,
        sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
      });
      const nuclearBytes = readFileSync(nuclearPath);
      const continuityBytes = readFileSync(continuityPath);
      const sidecarBytes = readFileSync(sidecarPath);
      const createdAt = "2026-09-17T00:00:00.000Z";
      const baseManifest: BackupManifest = {
        ...valid.manifest,
        nuclearSchemaVersion: NUCLEAR_SUPPORTED_VERSION,
        nuclearHash: createHash("sha256").update(nuclearBytes).digest("hex"),
        continuityHash: createHash("sha256").update(continuityBytes).digest("hex"),
        sidecarHash: createHash("sha256").update(sidecarBytes).digest("hex"),
        createdAt,
        nuclearSnapshotAt: createdAt,
        continuitySnapshotAt: createdAt,
        sidecarSnapshotAt: createdAt,
      };

      const mixedPath = join(dir, "mixed.pkg");
      writeFileSync(mixedPath, encryptPackage({
        ...baseManifest,
        sidecarSnapshotAt: "2026-09-17T00:00:01.000Z",
      }, nuclearBytes, continuityBytes, sidecarBytes, key));
      expect(restoreVerifyPackage({
        packagePath: mixedPath,
        transferKeyHex: key,
        currentContinuity: continuity,
        tempDir: join(dir, "restore-mixed"),
      })).toMatchObject({ ready: false, note: "backup_package_snapshot_cohort_mismatch" });

      const hashPath = join(dir, "hash.pkg");
      writeFileSync(hashPath, encryptPackage({
        ...baseManifest,
        nuclearHash: "0".repeat(64),
      }, nuclearBytes, continuityBytes, sidecarBytes, key));
      expect(restoreVerifyPackage({
        packagePath: hashPath,
        transferKeyHex: key,
        currentContinuity: continuity,
        tempDir: join(dir, "restore-hash"),
      })).toMatchObject({ ready: false, note: "backup_package_hash_mismatch" });
    } finally {
      closeAll(sidecar, nuclear, continuity);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
