/**
 * Authenticated three-store backup package (AES-256-GCM).
 * Snapshot order: record backup_started → nuclear → continuity → sidecar → package → backup_completed.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import {
  COGNITIVE_SIDECAR_SCHEMA_VERSION,
} from "../cognitive-v021/types.js";
import type { V021ForgetTarget } from "../cognitive-v021/types.js";
import { applyV021ForgetTargets } from "../cognitive-v021/memory/forget.js";
import { reconcileProjectedDeliverySweep } from "../cognitive-v021/delivery/outbox-projector.js";
import { openDerivedStore } from "../cognitive-v021/retrieval/derived-store.js";
import {
  getAuthoritativeLineageId,
  CONTINUITY_SCHEMA_VERSION,
  recordContinuityEvent,
} from "./db.js";
import {
  listPendingOrAppliedTombstones,
  listTombstoneTargets,
  type ForgetTarget,
} from "./forget-preview.js";
import { applyForgetTargets } from "../memory/forget.js";
import { getMemoryContractState } from "../memory/contract-state.js";

export const BACKUP_PACKAGE_VERSION = 2;

export type BackupManifest = {
  packageVersion: number;
  lineageId: string;
  nuclearSchemaVersion: number;
  continuitySchemaVersion: number;
  c1CorrectionSeq: number | null;
  nuclearHash: string;
  continuityHash: string;
  continuitySnapshotAt: string;
  sidecarSchemaVersion: number;
  sidecarHash: string;
  sidecarSnapshotAt: string;
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

type AuthenticatedBackup = {
  manifest: BackupManifest;
  nuclear: Buffer | null;
  continuity: Buffer | null;
  sidecar: Buffer | null;
};

function parseBackupManifest(value: unknown): BackupManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("backup_manifest_corrupt");
  }
  const manifest = value as Partial<BackupManifest>;
  if (
    typeof manifest.packageVersion !== "number" ||
    typeof manifest.lineageId !== "string" ||
    typeof manifest.nuclearSchemaVersion !== "number" ||
    typeof manifest.continuitySchemaVersion !== "number" ||
    typeof manifest.nuclearHash !== "string" ||
    typeof manifest.continuityHash !== "string" ||
    typeof manifest.nuclearSnapshotAt !== "string" ||
    typeof manifest.continuityWatermark !== "string" ||
    typeof manifest.buildIdentity !== "string" && manifest.buildIdentity !== null ||
    typeof manifest.createdAt !== "string"
  ) {
    throw new Error("backup_manifest_corrupt");
  }
  return manifest as BackupManifest;
}

function decryptBackupPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
}): AuthenticatedBackup {
  const raw = readFileSync(input.packagePath);
  if (!raw.subarray(0, 8).equals(Buffer.from("ASHLEY1\n", "utf8"))) {
    throw new Error("backup_magic_mismatch");
  }
  const nl = raw.indexOf(0x0a, 8);
  if (nl < 0) throw new Error("backup_header_corrupt");
  let header: {
    v?: number;
    salt?: string;
    nonce?: string;
    tag?: string;
  };
  try {
    header = JSON.parse(raw.subarray(8, nl).toString("utf8")) as typeof header;
  } catch {
    throw new Error("backup_header_corrupt");
  }
  if (
    typeof header.v !== "number" ||
    typeof header.salt !== "string" ||
    typeof header.nonce !== "string" ||
    typeof header.tag !== "string"
  ) {
    throw new Error("backup_header_corrupt");
  }
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

  const manifestSep = Buffer.from("\n--\n", "utf8");
  const nuclearSep = Buffer.from("\n--NUCLEAR--\n", "utf8");
  const continuitySep = Buffer.from("\n--CONTINUITY--\n", "utf8");
  const manifestEnd = payload.indexOf(manifestSep);
  if (manifestEnd < 0) throw new Error("backup_payload_corrupt");
  let manifest: BackupManifest;
  try {
    manifest = parseBackupManifest(JSON.parse(payload.subarray(0, manifestEnd).toString("utf8")));
  } catch (error) {
    if (error instanceof Error && error.message === "backup_manifest_corrupt") throw error;
    throw new Error("backup_payload_corrupt");
  }
  const nuclearStart = manifestEnd + manifestSep.length;
  const nuclearEnd = payload.indexOf(nuclearSep, nuclearStart);
  if (nuclearEnd < nuclearStart) {
    return { manifest, nuclear: null, continuity: null, sidecar: null };
  }
  const continuityStart = nuclearEnd + nuclearSep.length;
  const continuityEnd = payload.indexOf(continuitySep, continuityStart);
  if (manifest.packageVersion !== 2 || continuityEnd < continuityStart) {
    return {
      manifest,
      nuclear: payload.subarray(nuclearStart, nuclearEnd),
      continuity: continuityEnd < continuityStart ? null : payload.subarray(continuityStart, continuityEnd),
      sidecar: null,
    };
  }
  const sidecarStart = continuityEnd + continuitySep.length;
  return {
    manifest,
    nuclear: payload.subarray(nuclearStart, nuclearEnd),
    continuity: payload.subarray(continuityStart, continuityEnd),
    sidecar: sidecarStart < payload.length ? payload.subarray(sidecarStart) : null,
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function hasCompleteV2Manifest(manifest: BackupManifest): boolean {
  const candidate = manifest as BackupManifest & {
    sidecarSchemaVersion?: unknown;
    sidecarHash?: unknown;
    sidecarSnapshotAt?: unknown;
    continuitySnapshotAt?: unknown;
  };
  return (
    manifest.packageVersion === 2 &&
    Number.isSafeInteger(manifest.nuclearSchemaVersion) &&
    Number.isSafeInteger(manifest.continuitySchemaVersion) &&
    Number.isSafeInteger(candidate.sidecarSchemaVersion) &&
    isSha256(manifest.nuclearHash) &&
    isSha256(manifest.continuityHash) &&
    isSha256(candidate.sidecarHash) &&
    typeof manifest.createdAt === "string" && manifest.createdAt.length > 0 &&
    typeof manifest.nuclearSnapshotAt === "string" && manifest.nuclearSnapshotAt.length > 0 &&
    typeof candidate.continuitySnapshotAt === "string" && candidate.continuitySnapshotAt.length > 0 &&
    typeof candidate.sidecarSnapshotAt === "string" && candidate.sidecarSnapshotAt.length > 0
  );
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
  sidecarDbPath: string;
  continuity: DatabaseSync;
  outDir: string;
  transferKeyHex?: string;
  buildIdentity?: string | null;
  nuclearSchemaVersion: number;
  continuitySchemaVersion: number;
  sidecarSchemaVersion: number;
}): { packagePath: string; manifest: BackupManifest } {
  if (!existsSync(input.nuclearDbPath)) throw new Error("backup_nuclear_missing");
  if (!existsSync(input.continuityDbPath)) throw new Error("backup_continuity_missing");
  if (!existsSync(input.sidecarDbPath)) throw new Error("backup_sidecar_missing");
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
  const sidecarSnap = join(work, "cognitive-v021.db");
  try {
    // Capture this before the nuclear snapshot. The number is a witness only;
    // assertions and barriers remain authoritative in nuclear.db.
    const c1CorrectionSeq = readC1CorrectionSeq(input.nuclearDbPath);
    vacuumInto(input.nuclearDbPath, nuclearSnap);
    // Continuity snapshot after nuclear so newer tombstones remain replayable.
    vacuumInto(input.continuityDbPath, continuitySnap);
    vacuumInto(input.sidecarDbPath, sidecarSnap);
    const nuclearHash = sha256File(nuclearSnap);
    const continuityHash = sha256File(continuitySnap);
    const sidecarHash = sha256File(sidecarSnap);
    const createdAt = new Date().toISOString();
    const manifest: BackupManifest = {
      packageVersion: BACKUP_PACKAGE_VERSION,
      lineageId,
      nuclearSchemaVersion: input.nuclearSchemaVersion,
      continuitySchemaVersion: input.continuitySchemaVersion,
      sidecarSchemaVersion: input.sidecarSchemaVersion,
      c1CorrectionSeq,
      nuclearHash,
      continuityHash,
      sidecarHash,
      nuclearSnapshotAt: createdAt,
      continuitySnapshotAt: createdAt,
      sidecarSnapshotAt: createdAt,
      continuityWatermark: continuityHash,
      buildIdentity: input.buildIdentity ?? null,
      createdAt,
    };
    const payload = Buffer.concat([
      Buffer.from(JSON.stringify(manifest), "utf8"),
      Buffer.from("\n--\n", "utf8"),
      readFileSync(nuclearSnap),
      Buffer.from("\n--NUCLEAR--\n", "utf8"),
      readFileSync(continuitySnap),
      Buffer.from("\n--CONTINUITY--\n", "utf8"),
      readFileSync(sidecarSnap),
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
        sidecarHash,
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
        JSON.stringify({ packagePath, c1CorrectionSeq, sidecarHash, sidecarSnapshotAt: createdAt }),
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
  const { manifest } = decryptBackupPackage(input);
  if (
    input.expectedLineageId &&
    manifest.lineageId !== input.expectedLineageId
  ) {
    throw new Error("backup_lineage_mismatch");
  }
  return manifest;
}

/** Restore-verify only. This function never extracts or replaces a database. */
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
  const packageData = decryptBackupPackage({
    packagePath: input.packagePath,
    transferKeyHex: input.transferKeyHex,
  });
  const manifest = packageData.manifest;
  if (!hasCompleteV2Manifest(manifest)) {
    return { ready: false, manifest, note: "backup_package_cohort_invalid" };
  }
  if (packageData.nuclear == null || packageData.continuity == null || packageData.sidecar == null) {
    return { ready: false, manifest, note: "backup_package_member_missing" };
  }
  if (
    createHash("sha256").update(packageData.nuclear).digest("hex") !== manifest.nuclearHash ||
    createHash("sha256").update(packageData.continuity).digest("hex") !== manifest.continuityHash ||
    createHash("sha256").update(packageData.sidecar).digest("hex") !== manifest.sidecarHash
  ) {
    return { ready: false, manifest, note: "backup_package_hash_mismatch" };
  }
  if (
    manifest.nuclearSchemaVersion > NUCLEAR_SUPPORTED_VERSION ||
    manifest.continuitySchemaVersion > CONTINUITY_SCHEMA_VERSION ||
    manifest.sidecarSchemaVersion > COGNITIVE_SIDECAR_SCHEMA_VERSION
  ) {
    return { ready: false, manifest, note: "backup_package_schema_unsupported" };
  }
  if (
    manifest.createdAt !== manifest.nuclearSnapshotAt ||
    manifest.createdAt !== manifest.continuitySnapshotAt ||
    manifest.createdAt !== manifest.sidecarSnapshotAt
  ) {
    return { ready: false, manifest, note: "backup_package_snapshot_cohort_mismatch" };
  }
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
  return {
    ready: true,
    manifest,
    note: input.currentContinuity
      ? "same_lineage_replay_current_sidecar_tombstones"
      : "verified_v2_cohort_requires_reconciliation",
  };
}

type PreservedTombstone = {
  row: {
    tombstone_id: string;
    owner_id: string;
    lineage_id: string;
    preview_id: string | null;
    receipt_id: string | null;
    status: string;
    created_at: string;
    applied_at: string | null;
    category_counts_json: string;
    external_non_erasure_json: string;
  };
  targets: ForgetTarget[];
};

type PreservedEffectReceipt = {
  receipt_id: string;
  effect_id: string;
  idempotency_key: string;
  outcome: string;
  claims_json: string;
  at_ms: number;
  data_classification: string;
  secret_omitted: number;
};

function preserveCurrentTombstones(
  continuity: DatabaseSync,
): PreservedTombstone[] {
  const lineageId = getAuthoritativeLineageId(continuity);
  return listPendingOrAppliedTombstones(continuity, lineageId).flatMap((stone) => {
    const row = continuity.prepare(
      `SELECT tombstone_id, owner_id, lineage_id, preview_id, receipt_id,
              status, created_at, applied_at, category_counts_json,
              external_non_erasure_json
         FROM forget_tombstones WHERE tombstone_id = ?`,
    ).get(stone.tombstoneId) as PreservedTombstone["row"] | undefined;
    return row
      ? [{ row, targets: listTombstoneTargets(continuity, row.tombstone_id) }]
      : [];
  });
}

function preserveCurrentEffectReceipts(
  sidecar: DatabaseSync,
): PreservedEffectReceipt[] {
  return sidecar.prepare(
    `SELECT receipt_id, effect_id, idempotency_key, outcome, claims_json,
            at_ms, data_classification, secret_omitted
       FROM effect_receipts
      ORDER BY at_ms ASC, effect_id ASC`,
  ).all() as PreservedEffectReceipt[];
}

function installRestoreFiles(input: {
  stageDir: string;
  files: Array<{ staged: string; live: string; name: string }>;
}): void {
  const previousDir = join(input.stageDir, "previous");
  mkdirSync(previousDir, { recursive: true });
  const installed: Array<{ live: string; previous: string | null }> = [];
  try {
    for (const file of input.files) {
      const previous = existsSync(file.live)
        ? join(previousDir, file.name)
        : null;
      if (previous) renameSync(file.live, previous);
      try {
        renameSync(file.staged, file.live);
      } catch (error) {
        if (previous && existsSync(previous)) renameSync(previous, file.live);
        throw error;
      }
      installed.push({ live: file.live, previous });
    }
  } catch (error) {
    for (const file of installed.reverse()) {
      if (existsSync(file.live)) rmSync(file.live, { force: true });
      if (file.previous && existsSync(file.previous)) renameSync(file.previous, file.live);
    }
    throw error;
  }
}

function validateStagedDatabase(
  path: string,
  supportedVersion: number,
): void {
  const db = new DatabaseSync(path);
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown };
    if (integrity.integrity_check !== "ok") throw new Error("backup_database_integrity_failed");
    const version = db.prepare("PRAGMA user_version").get() as { user_version?: unknown };
    if (Number(version.user_version ?? 0) > supportedVersion) {
      throw new Error("backup_database_schema_unsupported");
    }
  } finally {
    db.close();
  }
}

function ensureRestoredTombstone(
  continuity: DatabaseSync,
  preserved: PreservedTombstone,
): void {
  const current = continuity.prepare(
    `SELECT tombstone_id, created_at FROM forget_tombstones WHERE tombstone_id = ?`,
  ).get(preserved.row.tombstone_id) as { tombstone_id?: string; created_at?: string } | undefined;
  if (!current) {
    continuity.prepare(
      `INSERT INTO forget_tombstones
       (tombstone_id, owner_id, lineage_id, preview_id, receipt_id, status,
        created_at, applied_at, category_counts_json, external_non_erasure_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      preserved.row.tombstone_id,
      preserved.row.owner_id,
      preserved.row.lineage_id,
      preserved.row.preview_id,
      preserved.row.receipt_id,
      preserved.row.status,
      preserved.row.created_at,
      preserved.row.applied_at,
      preserved.row.category_counts_json,
      preserved.row.external_non_erasure_json,
    );
  } else if (
    Date.parse(preserved.row.created_at) > Date.parse(current.created_at ?? "")
  ) {
    continuity.prepare(
      `UPDATE forget_tombstones
          SET owner_id = ?, lineage_id = ?, preview_id = ?, receipt_id = ?,
              status = ?, created_at = ?, applied_at = ?,
              category_counts_json = ?, external_non_erasure_json = ?
        WHERE tombstone_id = ?`,
    ).run(
      preserved.row.owner_id,
      preserved.row.lineage_id,
      preserved.row.preview_id,
      preserved.row.receipt_id,
      preserved.row.status,
      preserved.row.created_at,
      preserved.row.applied_at,
      preserved.row.category_counts_json,
      preserved.row.external_non_erasure_json,
      preserved.row.tombstone_id,
    );
  }
  const insertTarget = continuity.prepare(
    `INSERT OR IGNORE INTO forget_tombstone_targets
       (tombstone_id, entity_type, entity_uuid, action)
     VALUES (?, ?, ?, ?)`,
  );
  for (const target of preserved.targets) {
    insertTarget.run(
      preserved.row.tombstone_id,
      target.entityType,
      target.entityUuid,
      target.action,
    );
  }
}

function replayPreservedTombstone(
  continuity: DatabaseSync,
  nuclear: DatabaseSync,
  sidecar: DatabaseSync,
  preserved: PreservedTombstone,
): void {
  ensureRestoredTombstone(continuity, preserved);
  const compatibilityTargets = preserved.targets.filter(
    (target) => !target.entityType.startsWith("v021_"),
  );
  if (compatibilityTargets.length > 0) {
    applyForgetTargets(nuclear, preserved.row.owner_id, compatibilityTargets, {
      tombstoneId: preserved.row.tombstone_id,
    });
  }
  const sidecarTargets = preserved.targets.filter(
    (target) => target.entityType.startsWith("v021_"),
  ) as V021ForgetTarget[];
  if (sidecarTargets.length > 0) {
    applyV021ForgetTargets(sidecar, sidecarTargets);
  }
}

function replayPreservedEffectReceipts(
  sidecar: DatabaseSync,
  receipts: PreservedEffectReceipt[],
): void {
  const insert = sidecar.prepare(
    `INSERT INTO effect_receipts
       (receipt_id, effect_id, idempotency_key, outcome, claims_json, at_ms,
        data_classification, secret_omitted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const replace = sidecar.prepare(
    `UPDATE effect_receipts
        SET receipt_id = ?, idempotency_key = ?, outcome = ?, claims_json = ?,
            at_ms = ?, data_classification = ?, secret_omitted = ?
      WHERE effect_id = ?`,
  );
  for (const receipt of receipts) {
    const existing = sidecar.prepare(
      `SELECT effect_id, at_ms FROM effect_receipts WHERE effect_id = ?`,
    ).get(receipt.effect_id) as { effect_id?: string; at_ms?: unknown } | undefined;
    if (!existing) {
      insert.run(
        receipt.receipt_id,
        receipt.effect_id,
        receipt.idempotency_key,
        receipt.outcome,
        receipt.claims_json,
        receipt.at_ms,
        receipt.data_classification,
        receipt.secret_omitted,
      );
    } else if (Number(existing.at_ms ?? 0) < receipt.at_ms) {
      replace.run(
        receipt.receipt_id,
        receipt.idempotency_key,
        receipt.outcome,
        receipt.claims_json,
        receipt.at_ms,
        receipt.data_classification,
        receipt.secret_omitted,
        receipt.effect_id,
      );
    }
  }
}

export function restoreDualBackupPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
  nuclearDbPath: string;
  continuityDbPath: string;
  sidecarDbPath: string;
  tempDir: string;
  derivedDbPath?: string;
}): {
  ready: boolean;
  manifest: BackupManifest | null;
  note: string;
} {
  let manifest: BackupManifest | null = null;
  let currentContinuity: DatabaseSync | null = null;
  let currentSidecar: DatabaseSync | null = null;
  try {
    const preservedTombstones = existsSync(input.continuityDbPath)
      ? (() => {
          currentContinuity = new DatabaseSync(input.continuityDbPath);
          return preserveCurrentTombstones(currentContinuity);
        })()
      : [];
    const preservedEffectReceipts = existsSync(input.sidecarDbPath)
      ? (() => {
          currentSidecar = new DatabaseSync(input.sidecarDbPath);
          return preserveCurrentEffectReceipts(currentSidecar);
        })()
      : [];

    const verified = restoreVerifyPackage({
      packagePath: input.packagePath,
      transferKeyHex: input.transferKeyHex,
      currentContinuity: currentContinuity ?? undefined,
      tempDir: input.tempDir,
    });
    manifest = verified.manifest;
    if (!verified.ready) {
      return verified;
    }
    currentContinuity?.close();
    currentContinuity = null;
    currentSidecar?.close();
    currentSidecar = null;

    const packageData = decryptBackupPackage({
      packagePath: input.packagePath,
      transferKeyHex: input.transferKeyHex,
    });
    if (packageData.nuclear == null || packageData.continuity == null || packageData.sidecar == null) {
      return { ready: false, manifest, note: "backup_package_member_missing" };
    }

    const stageDir = join(input.tempDir, `cohort-${Date.now()}-${randomBytes(6).toString("hex")}`);
    mkdirSync(stageDir, { recursive: true });
    const stagedNuclear = join(stageDir, "nuclear.db");
    const stagedContinuity = join(stageDir, "continuity.db");
    const stagedSidecar = join(stageDir, "cognitive-v021.db");
    writeFileSync(stagedNuclear, packageData.nuclear, { mode: 0o600 });
    writeFileSync(stagedContinuity, packageData.continuity, { mode: 0o600 });
    writeFileSync(stagedSidecar, packageData.sidecar, { mode: 0o600 });
    validateStagedDatabase(stagedNuclear, NUCLEAR_SUPPORTED_VERSION);
    validateStagedDatabase(stagedContinuity, CONTINUITY_SCHEMA_VERSION);
    validateStagedDatabase(stagedSidecar, COGNITIVE_SIDECAR_SCHEMA_VERSION);
    const stagedContinuityDb = new DatabaseSync(stagedContinuity);
    try {
      if (getAuthoritativeLineageId(stagedContinuityDb) !== manifest.lineageId) {
        return { ready: false, manifest, note: "backup_package_lineage_mismatch" };
      }
    } finally {
      stagedContinuityDb.close();
    }

    installRestoreFiles({
      stageDir,
      files: [
        { staged: stagedNuclear, live: input.nuclearDbPath, name: "nuclear.db.previous" },
        { staged: stagedContinuity, live: input.continuityDbPath, name: "continuity.db.previous" },
        { staged: stagedSidecar, live: input.sidecarDbPath, name: "cognitive-v021.db.previous" },
      ],
    });

    const restoredContinuity = new DatabaseSync(input.continuityDbPath);
    const restoredNuclear = new DatabaseSync(input.nuclearDbPath);
    const restoredSidecar = new DatabaseSync(input.sidecarDbPath);
    try {
      restoredContinuity.exec("PRAGMA foreign_keys = ON");
      restoredSidecar.exec("PRAGMA foreign_keys = ON");
      for (const preserved of preservedTombstones) {
        replayPreservedTombstone(restoredContinuity, restoredNuclear, restoredSidecar, preserved);
      }
      replayPreservedEffectReceipts(restoredSidecar, preservedEffectReceipts);
      reconcileProjectedDeliverySweep(restoredSidecar, restoredNuclear, { limit: 50 });
      const derived = openDerivedStore(input.derivedDbPath ?? ":memory:");
      try {
        if (!derived.reconcileAtStartup(restoredSidecar)) {
          throw new Error("restore_derived_rebuild_failed");
        }
      } finally {
        derived.close();
      }
    } finally {
      restoredSidecar.close();
      restoredNuclear.close();
      restoredContinuity.close();
    }
    return { ready: true, manifest, note: "restore_ready_after_reconciliation" };
  } catch (error) {
    return {
      ready: false,
      manifest,
      note: `restore_failed:${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    try { currentSidecar?.close(); } catch { /* preserve restore result */ }
    try { currentContinuity?.close(); } catch { /* preserve restore result */ }
  }
}
