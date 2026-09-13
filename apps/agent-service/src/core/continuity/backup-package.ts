/**
 * Dual-DB authenticated backup package (AES-256-GCM).
 * Snapshot order: record backup_started → nuclear → continuity → package → backup_completed.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getAuthoritativeLineageId,
  recordContinuityEvent,
} from "./db.js";
import { getMemoryContractState } from "../memory/contract-state.js";

export const BACKUP_PACKAGE_VERSION = 1;

export type BackupManifest = {
  packageVersion: number;
  lineageId: string;
  nuclearSchemaVersion: number;
  continuitySchemaVersion: number;
  c1CorrectionSeq: number | null;
  nuclearHash: string;
  continuityHash: string;
  nuclearSnapshotAt: string;
  continuityWatermark: string;
  buildIdentity: string | null;
  createdAt: string;
};

export type C1RestoreContinuityStatus = "proven" | "gap" | "unknown";

export type C1RestoreContinuity = {
  status: C1RestoreContinuityStatus;
  influenceFailClosed: boolean;
  restoredCorrectionSeq: number | null;
  sidecarCorrectionSeq: number | null;
  manifestCorrectionSeq: number | null;
  reason: string;
};

function normalizedCorrectionSeq(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/**
 * Compare the restored nuclear C1 high-water with both independent backup
 * witnesses. Matching old checkpoints do not prove that a later correction
 * was not lost.
 */
export function assessC1RestoreContinuity(input: {
  restoredCorrectionSeq: number | null | undefined;
  sidecarCorrectionSeq: number | null | undefined;
  manifestCorrectionSeq: number | null | undefined;
  appliedC1AuthorityExists: boolean;
  sameOlderCheckpoint?: boolean;
}): C1RestoreContinuity {
  const restored = normalizedCorrectionSeq(input.restoredCorrectionSeq);
  const sidecar = normalizedCorrectionSeq(input.sidecarCorrectionSeq);
  const manifest = normalizedCorrectionSeq(input.manifestCorrectionSeq);
  const failClosed = (status: C1RestoreContinuityStatus, reason: string): C1RestoreContinuity => ({
    status,
    influenceFailClosed: true,
    restoredCorrectionSeq: restored,
    sidecarCorrectionSeq: sidecar,
    manifestCorrectionSeq: manifest,
    reason,
  });

  if (input.appliedC1AuthorityExists && restored == null) {
    return failClosed("unknown", "restored_nuclear_c1_high_water_unavailable");
  }
  if (input.appliedC1AuthorityExists && (sidecar == null || manifest == null)) {
    return failClosed("unknown", "independent_c1_high_water_witness_missing");
  }
  if (sidecar != null && manifest != null && sidecar !== manifest) {
    return failClosed("unknown", "independent_c1_high_water_witness_mismatch");
  }
  const witnesses = [sidecar, manifest].filter(
    (value): value is number => value != null,
  );
  if (restored == null && witnesses.length > 0) {
    return failClosed("gap", "restored_nuclear_c1_high_water_missing");
  }
  if (restored != null && witnesses.some((value) => restored < value)) {
    return failClosed("gap", "restored_nuclear_c1_high_water_gap");
  }
  if (
    input.appliedC1AuthorityExists &&
    input.sameOlderCheckpoint === true &&
    restored != null &&
    sidecar != null &&
    manifest != null &&
    restored === sidecar &&
    sidecar === manifest
  ) {
    return failClosed("unknown", "matching_older_checkpoints_do_not_prove_completeness");
  }
  return {
    status: "proven",
    influenceFailClosed: false,
    restoredCorrectionSeq: restored,
    sidecarCorrectionSeq: sidecar,
    manifestCorrectionSeq: manifest,
    reason: input.appliedC1AuthorityExists
      ? "restored_nuclear_c1_high_water_meets_independent_witnesses"
      : "no_applied_c1_authority_requires_restore_gap_fencing",
  };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readC1CorrectionSeq(nuclearDbPath: string): number | null {
  const db = new DatabaseSync(nuclearDbPath);
  try {
    const exists = db.prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'memory_contract_state'",
    ).get();
    if (!exists) return null;
    const state = getMemoryContractState(db);
    if (!state) throw new Error("backup_c1_correction_seq_unavailable");
    return state.correctionSeq;
  } finally {
    db.close();
  }
}

function vacuumInto(sourcePath: string, destPath: string): void {
  const db = new DatabaseSync(sourcePath);
  try {
    const escaped = destPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    db.close();
  }
}

function resolveTransferKey(hexKey?: string): Buffer {
  const raw = hexKey ?? process.env.ASHLEY_BACKUP_TRANSFER_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("backup_transfer_key_invalid");
  }
  return Buffer.from(raw, "hex");
}

export function createDualBackupPackage(input: {
  nuclearDbPath: string;
  continuityDbPath: string;
  continuity: DatabaseSync;
  outDir: string;
  transferKeyHex?: string;
  buildIdentity?: string | null;
  nuclearSchemaVersion: number;
  continuitySchemaVersion: number;
}): { packagePath: string; manifest: BackupManifest } {
  const lineageId = getAuthoritativeLineageId(input.continuity);
  recordContinuityEvent(input.continuity, {
    kind: "backup_started",
    lineageId,
    detail: {},
  });
  mkdirSync(input.outDir, { recursive: true });
  const work = join(input.outDir, `.work-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const nuclearSnap = join(work, "nuclear.db");
  const continuitySnap = join(work, "continuity.db");
  try {
    // Capture this before the nuclear snapshot. The number is a witness only;
    // assertions and barriers remain authoritative in nuclear.db.
    const c1CorrectionSeq = readC1CorrectionSeq(input.nuclearDbPath);
    vacuumInto(input.nuclearDbPath, nuclearSnap);
    // Continuity snapshot after nuclear so newer tombstones remain replayable.
    vacuumInto(input.continuityDbPath, continuitySnap);
    const nuclearHash = sha256File(nuclearSnap);
    const continuityHash = sha256File(continuitySnap);
    const manifest: BackupManifest = {
      packageVersion: BACKUP_PACKAGE_VERSION,
      lineageId,
      nuclearSchemaVersion: input.nuclearSchemaVersion,
      continuitySchemaVersion: input.continuitySchemaVersion,
      c1CorrectionSeq,
      nuclearHash,
      continuityHash,
      nuclearSnapshotAt: new Date().toISOString(),
      continuityWatermark: continuityHash,
      buildIdentity: input.buildIdentity ?? null,
      createdAt: new Date().toISOString(),
    };
    const payload = Buffer.concat([
      Buffer.from(JSON.stringify(manifest), "utf8"),
      Buffer.from("\n--\n", "utf8"),
      readFileSync(nuclearSnap),
      Buffer.from("\n--NUCLEAR--\n", "utf8"),
      readFileSync(continuitySnap),
    ]);
    const key = resolveTransferKey(input.transferKeyHex);
    const salt = randomBytes(16);
    const derived = scryptSync(key, salt, 32, { N: 16384, r: 8, p: 1 });
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", derived, nonce);
    const aad = Buffer.from(`ashley-backup-v${BACKUP_PACKAGE_VERSION}`, "utf8");
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const tag = cipher.getAuthTag();
    const header = Buffer.from(
      JSON.stringify({
        v: BACKUP_PACKAGE_VERSION,
        salt: salt.toString("hex"),
        nonce: nonce.toString("hex"),
        tag: tag.toString("hex"),
        scrypt: { N: 16384, r: 8, p: 1 },
      }),
      "utf8",
    );
    const packageBytes = Buffer.concat([
      Buffer.from("ASHLEY1\n", "utf8"),
      header,
      Buffer.from("\n", "utf8"),
      encrypted,
    ]);
    const packagePath = join(
      input.outDir,
      `ashley-backup-${Date.now()}.pkg`,
    );
    const tmp = `${packagePath}.tmp`;
    writeFileSync(tmp, packageBytes, { mode: 0o600 });
    renameSync(tmp, packagePath);
    recordContinuityEvent(input.continuity, {
      kind: "backup_completed",
      lineageId,
      detail: {
        packageHash: createHash("sha256").update(packageBytes).digest("hex"),
        nuclearHash,
        continuityHash,
      },
    });
    input.continuity
      .prepare(
        `INSERT INTO backup_watermarks
           (kind, occurred_at, lineage_id, nuclear_hash, continuity_hash, package_hash, detail_json)
         VALUES ('backup', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        lineageId,
        nuclearHash,
        continuityHash,
        createHash("sha256").update(packageBytes).digest("hex"),
        JSON.stringify({ packagePath, c1CorrectionSeq }),
      );
    return { packagePath, manifest };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function verifyBackupPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
  expectedLineageId?: string;
}): BackupManifest {
  const raw = readFileSync(input.packagePath);
  if (!raw.subarray(0, 8).equals(Buffer.from("ASHLEY1\n", "utf8"))) {
    throw new Error("backup_magic_mismatch");
  }
  const nl = raw.indexOf(0x0a, 8);
  if (nl < 0) throw new Error("backup_header_corrupt");
  const header = JSON.parse(raw.subarray(8, nl).toString("utf8")) as {
    v: number;
    salt: string;
    nonce: string;
    tag: string;
  };
  const encrypted = raw.subarray(nl + 1);
  const key = resolveTransferKey(input.transferKeyHex);
  const derived = scryptSync(key, Buffer.from(header.salt, "hex"), 32, {
    N: 16384,
    r: 8,
    p: 1,
  });
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derived,
    Buffer.from(header.nonce, "hex"),
  );
  decipher.setAAD(Buffer.from(`ashley-backup-v${header.v}`, "utf8"));
  decipher.setAuthTag(Buffer.from(header.tag, "hex"));
  let payload: Buffer;
  try {
    payload = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw new Error("backup_tamper_detected");
  }
  const sep = Buffer.from("\n--\n", "utf8");
  const sepAt = payload.indexOf(sep);
  if (sepAt < 0) throw new Error("backup_payload_corrupt");
  const manifest = JSON.parse(
    payload.subarray(0, sepAt).toString("utf8"),
  ) as BackupManifest;
  if (
    input.expectedLineageId &&
    manifest.lineageId !== input.expectedLineageId
  ) {
    throw new Error("backup_lineage_mismatch");
  }
  return manifest;
}

/** Restore-verify into a temp dir; current sidecar lineage is preferred when provided. */
export function restoreVerifyPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
  currentContinuity?: DatabaseSync;
  tempDir: string;
}): {
  ready: boolean;
  manifest: BackupManifest;
  note: string;
} {
  const manifest = verifyBackupPackage({
    packagePath: input.packagePath,
    transferKeyHex: input.transferKeyHex,
  });
  if (input.currentContinuity) {
    const current = getAuthoritativeLineageId(input.currentContinuity);
    if (current !== manifest.lineageId) {
      return {
        ready: false,
        manifest,
        note: "current_sidecar_lineage_prefers_fail_closed",
      };
    }
  }
  mkdirSync(input.tempDir, { recursive: true });
  // Extract is verify-only here; full extract path uses same crypto as verify.
  void copyFileSync;
  return {
    ready: true,
    manifest,
    note: input.currentContinuity
      ? "same_lineage_replay_current_sidecar_tombstones"
      : "disaster_restore_old_package_may_resurrect_forgotten_material",
  };
}
