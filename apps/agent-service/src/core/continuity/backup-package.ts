/**
 * Authenticated backup package (AES-256-GCM, written and read in chunks).
 *
 * Format 3 (written now): `ASHLEY1\n`, one JSON header line, then the ciphertext of a payload made of
 * entries. An entry is a JSON line `{"name":…,"size":N}` followed by N bytes. The first entry is
 * `manifest.json`; then every member the manifest lists, in order. The header line has a fixed width,
 * so the tag is written in place once the bytes are all out, and nothing is held whole in memory.
 * Format 2 (packages already on the machine, read only): three in-memory members separated by markers.
 *
 * Snapshot order: record backup_started → snapshot cohort (nuclear, continuity, sidecar in one window;
 * a torn window is retried and never packaged) → companions (home, archive, sessions, state) →
 * package → backup_completed.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { vacuumIntoFile, waitForLocks } from "../sqlite-locks.js";
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

export const BACKUP_PACKAGE_VERSION = 3;
const LEGACY_PACKAGE_VERSION = 2;

/** A single home, session or archive file above this size is left out and recorded in `skipped`. */
export const COMPANION_FILE_CAP_BYTES = 64 * 1024 * 1024;

const MAGIC = Buffer.from("ASHLEY1\n", "utf8");
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const CHUNK_BYTES = 1024 * 1024;
const MAX_HEADER_BYTES = 8192;
const MAX_ENTRY_LINE_BYTES = 4096;
const MANIFEST_ENTRY = "manifest.json";
const DB_MEMBERS = ["nuclear.db", "continuity.db", "cognitive-v021.db"] as const;
const SNAPSHOT_RETRIES = 3;

export type DbName = "nuclear" | "continuity" | "sidecar";

export type BackupMember = { name: string; size: number; sha256: string };

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
  /** Format 3: every member after the manifest, with its size and hash. */
  members?: BackupMember[];
  /** Format 3: companion files left out on purpose, with the reason (never their contents). */
  skipped?: Array<{ name: string; reason: string }>;
  /** Format 3: how many files were left out as secrets (names are not recorded). */
  excludedSecretFiles?: number;
  /**
   * Format 3: the window in which the three database snapshots were taken, and each database's
   * data_version before and after it. `quiet` is true only when no writer committed in the window.
   */
  cohort?: {
    startedAt: string;
    finishedAt: string;
    quiet: boolean;
    dataVersions: Record<DbName, [number, number]>;
  };
  /** Format 3: rows per table of each snapshot, so the manifest records sizes without copying data. */
  tableRows?: Partial<Record<DbName, Record<string, number>>>;
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

function readC1CorrectionSeq(nuclearDbPath: string): number | null {
  const db = waitForLocks(new DatabaseSync(nuclearDbPath));
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

/** A consistent copy of a live database; it waits for a writer that is committing (sqlite-locks.ts). */
export function vacuumInto(sourcePath: string, destPath: string): void {
  const db = waitForLocks(new DatabaseSync(sourcePath));
  try {
    vacuumIntoFile(db, destPath);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Header, key and cipher
// ---------------------------------------------------------------------------

type PackageHeader = {
  v: number;
  salt: string;
  nonce: string;
  tag: string;
  kid?: string;
};

/** Format 3 header. Every field has a fixed width, so the tag can be rewritten in place. */
function encodeHeader(fields: { v: number; salt: string; nonce: string; tag: string; kid: string }): Buffer {
  return Buffer.from(
    JSON.stringify({
      v: fields.v,
      salt: fields.salt,
      nonce: fields.nonce,
      tag: fields.tag,
      kid: fields.kid,
      scrypt: SCRYPT_PARAMS,
    }),
    "utf8",
  );
}

/** A short public fingerprint of the transfer key (a hash prefix, never the key). */
function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function resolveTransferKey(hexKey?: string): Buffer {
  const raw = hexKey ?? process.env.ASHLEY_BACKUP_TRANSFER_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("backup_transfer_key_invalid");
  }
  return Buffer.from(raw, "hex");
}

/** A package written under another key says so; it is not reported as tampering. */
function assertKeyMatchesHeader(header: PackageHeader, key: Buffer): void {
  if (header.kid !== undefined && header.kid !== keyIdOf(key)) {
    throw new Error("backup_wrong_key");
  }
}

function readPackageHeader(packagePath: string): { header: PackageHeader; bodyOffset: number } {
  const fd = openSync(packagePath, "r");
  try {
    const head = Buffer.alloc(MAX_HEADER_BYTES);
    const read = readSync(fd, head, 0, head.length, 0);
    const bytes = head.subarray(0, read);
    if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("backup_magic_mismatch");
    }
    const nl = bytes.indexOf(0x0a, MAGIC.length);
    if (nl < 0) throw new Error("backup_header_corrupt");
    let header: Partial<PackageHeader>;
    try {
      header = JSON.parse(bytes.subarray(MAGIC.length, nl).toString("utf8")) as Partial<PackageHeader>;
    } catch {
      throw new Error("backup_header_corrupt");
    }
    if (
      typeof header.v !== "number" ||
      typeof header.salt !== "string" ||
      typeof header.nonce !== "string" ||
      typeof header.tag !== "string" ||
      (header.kid !== undefined && typeof header.kid !== "string")
    ) {
      throw new Error("backup_header_corrupt");
    }
    return { header: header as PackageHeader, bodyOffset: nl + 1 };
  } finally {
    closeSync(fd);
  }
}

/** Calls fn with each chunk of a file, in order, without holding the whole file. */
function eachChunk(path: string, fn: (chunk: Buffer) => void, start = 0): void {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let position = start;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, position);
      if (read === 0) break;
      fn(buffer.subarray(0, read));
      position += read;
    }
  } finally {
    closeSync(fd);
  }
}

function hashFile(path: string): { size: number; sha256: string } {
  const hash = createHash("sha256");
  let size = 0;
  eachChunk(path, (chunk) => {
    hash.update(chunk);
    size += chunk.length;
  });
  return { size, sha256: hash.digest("hex") };
}

function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function entryLine(name: string, size: number): Buffer {
  return Buffer.from(`${JSON.stringify({ name, size })}\n`, "utf8");
}

/** Member names are relative, forward-slashed and never escape the extraction folder. */
export function isSafeMemberName(name: string): boolean {
  if (!name || name.startsWith("/") || name.includes("\\") || /^[a-zA-Z]:/.test(name)) return false;
  return name.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

// ---------------------------------------------------------------------------
// Reading: format 3 walks entries in chunks; format 2 is read in memory as before
// ---------------------------------------------------------------------------

type ReadResult = {
  manifest: BackupManifest;
  /** Members written under extractDir, by relative name (only when extractDir was given). */
  extracted: Map<string, string>;
  /** Members whose bytes do not match the manifest hash. */
  mismatches: string[];
  /** Members the manifest lists that the payload does not carry. */
  missing: string[];
};

class V3PayloadReader {
  private pending: Buffer = Buffer.alloc(0);
  private manifestBytes: Buffer[] = [];
  private inManifest = false;
  private current: {
    name: string;
    remaining: number;
    size: number;
    hash: ReturnType<typeof createHash> | null;
    fd: number | null;
    path: string | null;
  } | null = null;
  private members = new Map<string, BackupMember>();
  private seen = new Set<string>();
  manifest: BackupManifest | null = null;
  readonly extracted = new Map<string, string>();
  readonly mismatches: string[] = [];

  constructor(private readonly extractDir?: string) {}

  push(chunk: Buffer): void {
    const data = this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk;
    let offset = 0;
    for (;;) {
      if (this.current) {
        const take = Math.min(this.current.remaining, data.length - offset);
        if (take > 0) {
          this.writeCurrent(data.subarray(offset, offset + take));
          offset += take;
          this.current.remaining -= take;
        }
        if (this.current.remaining > 0) break;
        this.endCurrent();
        continue;
      }
      const nl = data.indexOf(0x0a, offset);
      if (nl < 0) {
        if (data.length - offset > MAX_ENTRY_LINE_BYTES) throw new Error("backup_payload_corrupt");
        break;
      }
      const line = data.subarray(offset, nl);
      offset = nl + 1;
      this.startEntry(line);
    }
    this.pending = Buffer.from(data.subarray(offset));
  }

  /** Structural errors throw; members the manifest lists but the payload lacks are returned. */
  finish(): string[] {
    if (this.current || this.pending.length > 0 || !this.manifest) {
      throw new Error("backup_payload_corrupt");
    }
    return [...this.members.keys()].filter((name) => !this.seen.has(name));
  }

  private startEntry(line: Buffer): void {
    let parsed: { name?: unknown; size?: unknown };
    try {
      parsed = JSON.parse(line.toString("utf8")) as { name?: unknown; size?: unknown };
    } catch {
      throw new Error("backup_payload_corrupt");
    }
    if (
      typeof parsed.name !== "string" ||
      typeof parsed.size !== "number" ||
      !Number.isSafeInteger(parsed.size) ||
      parsed.size < 0
    ) {
      throw new Error("backup_payload_corrupt");
    }
    const { name, size } = { name: parsed.name, size: parsed.size };
    if (this.manifest === null && !this.inManifest) {
      if (name !== MANIFEST_ENTRY) throw new Error("backup_payload_corrupt");
      this.inManifest = true;
      this.current = { name, remaining: size, size, hash: null, fd: null, path: null };
    } else if (this.manifest === null) {
      throw new Error("backup_payload_corrupt");
    } else {
      const expected = this.members.get(name);
      if (!expected || this.seen.has(name) || !isSafeMemberName(name)) {
        throw new Error("backup_payload_corrupt");
      }
      let fd: number | null = null;
      let path: string | null = null;
      if (this.extractDir) {
        path = join(this.extractDir, ...name.split("/"));
        mkdirSync(dirname(path), { recursive: true });
        fd = openSync(path, "w", 0o600);
      }
      this.current = { name, remaining: size, size, hash: createHash("sha256"), fd, path };
    }
    if (this.current && this.current.remaining === 0) this.endCurrent();
  }

  private writeCurrent(bytes: Buffer): void {
    const current = this.current!;
    if (this.inManifest && this.manifest === null) {
      this.manifestBytes.push(Buffer.from(bytes));
      return;
    }
    current.hash!.update(bytes);
    if (current.fd !== null) writeSync(current.fd, bytes);
  }

  private endCurrent(): void {
    const current = this.current!;
    this.current = null;
    if (this.manifest === null) {
      this.manifest = parseV3Manifest(Buffer.concat(this.manifestBytes));
      this.inManifest = false;
      this.manifestBytes = [];
      for (const member of this.manifest.members ?? []) this.members.set(member.name, member);
      return;
    }
    if (current.fd !== null) closeSync(current.fd);
    this.seen.add(current.name);
    if (current.path) this.extracted.set(current.name, current.path);
    const expected = this.members.get(current.name)!;
    if (current.size !== expected.size || current.hash!.digest("hex") !== expected.sha256) {
      this.mismatches.push(current.name);
    }
  }
}

function parseV3Manifest(bytes: Buffer): BackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("backup_manifest_corrupt");
  }
  const manifest = parseBackupManifest(value);
  if (
    manifest.packageVersion !== BACKUP_PACKAGE_VERSION ||
    !Array.isArray(manifest.members) ||
    !manifest.members.every(
      (member) =>
        member && typeof member.name === "string" && isSafeMemberName(member.name) &&
        Number.isSafeInteger(member.size) && member.size >= 0 && isSha256(member.sha256),
    ) ||
    !DB_MEMBERS.every((name) => manifest.members!.some((member) => member.name === name))
  ) {
    throw new Error("backup_manifest_corrupt");
  }
  return manifest;
}

function readV3Package(input: {
  packagePath: string;
  transferKeyHex?: string;
  extractDir?: string;
}): ReadResult {
  const { header, bodyOffset } = readPackageHeader(input.packagePath);
  const key = resolveTransferKey(input.transferKeyHex);
  assertKeyMatchesHeader(header, key);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    scryptSync(key, Buffer.from(header.salt, "hex"), 32, SCRYPT_PARAMS),
    Buffer.from(header.nonce, "hex"),
  );
  decipher.setAAD(Buffer.from(`ashley-backup-v${header.v}`, "utf8"));
  decipher.setAuthTag(Buffer.from(header.tag, "hex"));
  const reader = new V3PayloadReader(input.extractDir);
  // Parse errors are held back until the GCM tag has been checked, so a tampered file reports tamper.
  let parseError: unknown = null;
  eachChunk(input.packagePath, (chunk) => {
    const plain = decipher.update(chunk);
    if (plain.length === 0 || parseError !== null) return;
    try {
      reader.push(plain);
    } catch (error) {
      parseError = error;
    }
  }, bodyOffset);
  let last: Buffer;
  try {
    last = decipher.final();
  } catch {
    throw new Error("backup_tamper_detected");
  }
  if (parseError !== null) throw parseError;
  if (last.length > 0) reader.push(last);
  const missing = reader.finish();
  return {
    manifest: reader.manifest!,
    extracted: reader.extracted,
    mismatches: reader.mismatches,
    missing,
  };
}

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

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

/** Format 2 (legacy): the whole payload in memory, three members split by markers. */
function decryptLegacyPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
}): {
  manifest: BackupManifest;
  nuclear: Buffer | null;
  continuity: Buffer | null;
  sidecar: Buffer | null;
} {
  const raw = readFileSync(input.packagePath);
  if (!raw.subarray(0, 8).equals(MAGIC)) {
    throw new Error("backup_magic_mismatch");
  }
  const nl = raw.indexOf(0x0a, 8);
  if (nl < 0) throw new Error("backup_header_corrupt");
  let header: PackageHeader;
  try {
    header = JSON.parse(raw.subarray(8, nl).toString("utf8")) as PackageHeader;
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
  assertKeyMatchesHeader(header, key);
  const derived = scryptSync(key, Buffer.from(header.salt, "hex"), 32, SCRYPT_PARAMS);
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
  if (manifest.packageVersion !== LEGACY_PACKAGE_VERSION || continuityEnd < continuityStart) {
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

function hasCompleteV2Manifest(manifest: BackupManifest): boolean {
  const candidate = manifest as BackupManifest & {
    sidecarSchemaVersion?: unknown;
    sidecarHash?: unknown;
    sidecarSnapshotAt?: unknown;
    continuitySnapshotAt?: unknown;
  };
  return (
    manifest.packageVersion === LEGACY_PACKAGE_VERSION &&
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

function hasCompleteV3Manifest(manifest: BackupManifest): boolean {
  return (
    manifest.packageVersion === BACKUP_PACKAGE_VERSION &&
    Number.isSafeInteger(manifest.nuclearSchemaVersion) &&
    Number.isSafeInteger(manifest.continuitySchemaVersion) &&
    Number.isSafeInteger(manifest.sidecarSchemaVersion) &&
    isSha256(manifest.nuclearHash) &&
    isSha256(manifest.continuityHash) &&
    isSha256(manifest.sidecarHash) &&
    Array.isArray(manifest.members) &&
    manifest.cohort !== undefined
  );
}

/** Reads any supported package. With extractDir the members are written there, by relative name. */
function readBackupPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
  extractDir?: string;
}): ReadResult {
  const { header } = readPackageHeader(input.packagePath);
  if (header.v === BACKUP_PACKAGE_VERSION) return readV3Package(input);
  if (header.v !== LEGACY_PACKAGE_VERSION) throw new Error("backup_package_version_unsupported");
  const legacy = decryptLegacyPackage(input);
  const extracted = new Map<string, string>();
  const mismatches: string[] = [];
  const missing: string[] = [];
  const legacyMembers: Array<[string, Buffer | null, string]> = [
    ["nuclear.db", legacy.nuclear, legacy.manifest.nuclearHash],
    ["continuity.db", legacy.continuity, legacy.manifest.continuityHash],
    ["cognitive-v021.db", legacy.sidecar, legacy.manifest.sidecarHash ?? ""],
  ];
  for (const [name, bytes, expected] of legacyMembers) {
    if (bytes === null) {
      missing.push(name);
      continue;
    }
    if (sha256Buffer(bytes) !== expected) mismatches.push(name);
    if (input.extractDir) {
      const path = join(input.extractDir, name);
      mkdirSync(input.extractDir, { recursive: true });
      writeFileSync(path, bytes, { mode: 0o600 });
      extracted.set(name, path);
    }
  }
  return { manifest: legacy.manifest, extracted, mismatches, missing };
}

// ---------------------------------------------------------------------------
// Verify, materialize and restore-verify
// ---------------------------------------------------------------------------

export function verifyBackupPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
  expectedLineageId?: string;
}): BackupManifest {
  const { manifest, mismatches, missing } = readBackupPackage({
    packagePath: input.packagePath,
    transferKeyHex: input.transferKeyHex,
  });
  if (missing.length > 0) throw new Error("backup_package_member_missing");
  if (mismatches.length > 0) throw new Error("backup_package_hash_mismatch");
  if (
    input.expectedLineageId &&
    manifest.lineageId !== input.expectedLineageId
  ) {
    throw new Error("backup_lineage_mismatch");
  }
  return manifest;
}

/** Write the verified package members into tempDir. Does not replace live databases. */
export function materializeVerifiedBackupMembers(input: {
  packagePath: string;
  transferKeyHex?: string;
  tempDir: string;
}): {
  manifest: BackupManifest;
  nuclearDbPath: string;
  continuityDbPath: string;
  sidecarDbPath: string;
  extracted: Map<string, string>;
} {
  const verified = restoreVerifyPackage({
    packagePath: input.packagePath,
    transferKeyHex: input.transferKeyHex,
    tempDir: input.tempDir,
  });
  if (!verified.ready) {
    throw new Error(verified.note);
  }
  mkdirSync(input.tempDir, { recursive: true });
  const read = readBackupPackage({
    packagePath: input.packagePath,
    transferKeyHex: input.transferKeyHex,
    extractDir: input.tempDir,
  });
  if (read.missing.length > 0) throw new Error("backup_package_member_missing");
  if (read.mismatches.length > 0) throw new Error("backup_package_hash_mismatch");
  return {
    manifest: verified.manifest,
    nuclearDbPath: join(input.tempDir, "nuclear.db"),
    continuityDbPath: join(input.tempDir, "continuity.db"),
    sidecarDbPath: join(input.tempDir, "cognitive-v021.db"),
    extracted: read.extracted,
  };
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
  const { header } = readPackageHeader(input.packagePath);
  if (header.v === BACKUP_PACKAGE_VERSION) {
    return restoreVerifyV3(input);
  }
  const packageData = decryptLegacyPackage({
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
    sha256Buffer(packageData.nuclear) !== manifest.nuclearHash ||
    sha256Buffer(packageData.continuity) !== manifest.continuityHash ||
    sha256Buffer(packageData.sidecar) !== manifest.sidecarHash
  ) {
    return { ready: false, manifest, note: "backup_package_hash_mismatch" };
  }
  const schemaNote = schemaUnsupportedNote(manifest);
  if (schemaNote) return { ready: false, manifest, note: schemaNote };
  if (
    manifest.createdAt !== manifest.nuclearSnapshotAt ||
    manifest.createdAt !== manifest.continuitySnapshotAt ||
    manifest.createdAt !== manifest.sidecarSnapshotAt
  ) {
    return { ready: false, manifest, note: "backup_package_snapshot_cohort_mismatch" };
  }
  return lineageReady(input, manifest, "verified_v2_cohort_requires_reconciliation");
}

function restoreVerifyV3(input: {
  packagePath: string;
  transferKeyHex?: string;
  currentContinuity?: DatabaseSync;
}): { ready: boolean; manifest: BackupManifest; note: string } {
  const read = readBackupPackage({
    packagePath: input.packagePath,
    transferKeyHex: input.transferKeyHex,
  });
  const manifest = read.manifest;
  if (!hasCompleteV3Manifest(manifest)) {
    return { ready: false, manifest, note: "backup_package_cohort_invalid" };
  }
  const names = new Set((manifest.members ?? []).map((member) => member.name));
  if (!DB_MEMBERS.every((name) => names.has(name))) {
    return { ready: false, manifest, note: "backup_package_member_missing" };
  }
  if (read.missing.length > 0) {
    return { ready: false, manifest, note: "backup_package_member_missing" };
  }
  if (read.mismatches.length > 0) {
    return { ready: false, manifest, note: "backup_package_hash_mismatch" };
  }
  const schemaNote = schemaUnsupportedNote(manifest);
  if (schemaNote) return { ready: false, manifest, note: schemaNote };
  if (!snapshotCohortProven(manifest)) {
    return { ready: false, manifest, note: "backup_package_snapshot_cohort_mismatch" };
  }
  return lineageReady(input, manifest, "verified_v3_cohort_requires_reconciliation");
}

function schemaUnsupportedNote(manifest: BackupManifest): string | null {
  if (
    manifest.nuclearSchemaVersion > NUCLEAR_SUPPORTED_VERSION ||
    manifest.continuitySchemaVersion > CONTINUITY_SCHEMA_VERSION ||
    manifest.sidecarSchemaVersion > COGNITIVE_SIDECAR_SCHEMA_VERSION
  ) {
    return "backup_package_schema_unsupported";
  }
  return null;
}

/**
 * The three snapshot times must sit inside the recorded window, and the window must be quiet (no
 * writer committed while it was open). A package made by this code never fails this; a hand-edited
 * or torn one does.
 */
function snapshotCohortProven(manifest: BackupManifest): boolean {
  const cohort = manifest.cohort;
  if (!cohort || cohort.quiet !== true) return false;
  const start = Date.parse(cohort.startedAt);
  const end = Date.parse(cohort.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return false;
  return [manifest.nuclearSnapshotAt, manifest.continuitySnapshotAt, manifest.sidecarSnapshotAt].every((at) => {
    const time = Date.parse(at);
    return Number.isFinite(time) && time >= start && time <= end;
  });
}

function lineageReady(
  input: { currentContinuity?: DatabaseSync },
  manifest: BackupManifest,
  readyNote: string,
): { ready: boolean; manifest: BackupManifest; note: string } {
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
      : readyNote,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type CohortSnapshot = {
  quiet: boolean;
  startedAt: string;
  finishedAt: string;
  at: Record<DbName, string>;
  dataVersions: Record<DbName, [number, number]>;
  c1CorrectionSeq: number | null;
  tableRows: Partial<Record<DbName, Record<string, number>>>;
};

function dataVersionOf(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA data_version").get() as { data_version?: number } | undefined;
  return Number(row?.data_version ?? 0);
}

function tableRowCounts(path: string): Record<string, number> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    for (const { name } of names) {
      try {
        const row = db.prepare(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n?: number };
        counts[name] = Number(row.n ?? 0);
      } catch {
        counts[name] = -1;
      }
    }
    return counts;
  } finally {
    db.close();
  }
}

/**
 * Takes the three database snapshots inside one window. Each database is read through a connection
 * held open for the whole window: data_version on that connection changes if another connection
 * committed in between, so `quiet` is true only when no commit touched any of the three.
 */
function snapshotCohort(input: {
  nuclearDbPath: string;
  continuityDbPath: string;
  sidecarDbPath: string;
  workDir: string;
  /** Test seam: runs between the nuclear and continuity snapshots, where a tear would come from. */
  betweenSnapshots?: () => void;
}): CohortSnapshot {
  const observers: Record<DbName, DatabaseSync> = {
    nuclear: waitForLocks(new DatabaseSync(input.nuclearDbPath)),
    continuity: waitForLocks(new DatabaseSync(input.continuityDbPath)),
    sidecar: waitForLocks(new DatabaseSync(input.sidecarDbPath)),
  };
  const paths: Record<DbName, string> = {
    nuclear: join(input.workDir, "nuclear.db"),
    continuity: join(input.workDir, "continuity.db"),
    sidecar: join(input.workDir, "cognitive-v021.db"),
  };
  try {
    const before = {
      nuclear: dataVersionOf(observers.nuclear),
      continuity: dataVersionOf(observers.continuity),
      sidecar: dataVersionOf(observers.sidecar),
    };
    const startedAt = new Date().toISOString();
    const c1CorrectionSeq = readC1CorrectionSeq(input.nuclearDbPath);
    // Nuclear first, then continuity, so newer tombstones remain replayable.
    vacuumIntoFile(observers.nuclear, paths.nuclear);
    const nuclearAt = new Date().toISOString();
    input.betweenSnapshots?.();
    vacuumIntoFile(observers.continuity, paths.continuity);
    const continuityAt = new Date().toISOString();
    vacuumIntoFile(observers.sidecar, paths.sidecar);
    const sidecarAt = new Date().toISOString();
    const finishedAt = new Date().toISOString();
    const after = {
      nuclear: dataVersionOf(observers.nuclear),
      continuity: dataVersionOf(observers.continuity),
      sidecar: dataVersionOf(observers.sidecar),
    };
    const dataVersions: Record<DbName, [number, number]> = {
      nuclear: [before.nuclear, after.nuclear],
      continuity: [before.continuity, after.continuity],
      sidecar: [before.sidecar, after.sidecar],
    };
    const quiet = (Object.keys(dataVersions) as DbName[]).every(
      (db) => dataVersions[db][0] === dataVersions[db][1],
    );
    return {
      quiet,
      startedAt,
      finishedAt,
      at: { nuclear: nuclearAt, continuity: continuityAt, sidecar: sidecarAt },
      dataVersions,
      c1CorrectionSeq,
      tableRows: quiet
        ? {
            nuclear: tableRowCounts(paths.nuclear),
            continuity: tableRowCounts(paths.continuity),
            sidecar: tableRowCounts(paths.sidecar),
          }
        : {},
    };
  } finally {
    for (const db of Object.values(observers)) db.close();
  }
}

/** Companions: the home folder, the transcript archive, session files and state.json. */
type CompanionFile = { name: string; path: string };

function collectCompanionTree(
  root: string,
  prefix: string,
  out: { files: CompanionFile[]; skipped: Array<{ name: string; reason: string }>; excluded: { count: number } },
): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (isExcludedSecretName(entry.name)) {
      out.excluded.count += 1;
      continue;
    }
    const name = `${prefix}/${entry.name}`;
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      collectCompanionTree(path, name, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (statSync(path).size > COMPANION_FILE_CAP_BYTES) {
      out.skipped.push({ name, reason: "size_cap" });
      continue;
    }
    out.files.push({ name, path });
  }
}

/** The vault and environment files never leave the machine in a package. */
export function isExcludedSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "vault" || lower === ".env" || lower.startsWith(".env.") ||
    lower.endsWith(".key") || lower.endsWith(".pem");
}

function companionFiles(companionDataDir: string | undefined, workDir: string, out: {
  files: CompanionFile[];
  skipped: Array<{ name: string; reason: string }>;
  excluded: { count: number };
}): void {
  if (!companionDataDir) return;
  const archive = join(companionDataDir, "conversations", "index.db");
  if (existsSync(archive)) {
    // The archive is a live SQLite file, so it is copied by snapshot, never by byte copy.
    const dest = join(workDir, "conversations", "index.db");
    mkdirSync(dirname(dest), { recursive: true });
    const db = waitForLocks(new DatabaseSync(archive));
    try {
      vacuumIntoFile(db, dest);
    } finally {
      db.close();
    }
    out.files.push({ name: "conversations/index.db", path: dest });
  }
  collectCompanionTree(join(companionDataDir, "home"), "home", out);
  collectCompanionTree(join(companionDataDir, "conversations", "sessions"), "conversations/sessions", out);
  const state = join(companionDataDir, "state.json");
  if (existsSync(state)) out.files.push({ name: "state.json", path: state });
  // Plain files are copied into the work folder first, so the hash and the bytes come from one stable copy
  // even if a note is written while the backup runs.
  for (const file of out.files) {
    if (file.name === "conversations/index.db") continue;
    const dest = join(workDir, ...file.name.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file.path, dest);
    file.path = dest;
  }
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
  /** The data directory whose home, sessions, transcript archive and state.json join the package. */
  companionDataDir?: string;
  /** Test seam, see snapshotCohort. */
  betweenSnapshots?: () => void;
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
  const key = resolveTransferKey(input.transferKeyHex);

  let snapshot: CohortSnapshot | null = null;
  let work = "";
  for (let attempt = 1; attempt <= SNAPSHOT_RETRIES && !snapshot; attempt += 1) {
    work = join(input.outDir, `.work-${Date.now()}-${attempt}`);
    mkdirSync(work, { recursive: true });
    const taken = snapshotCohort({
      nuclearDbPath: input.nuclearDbPath,
      continuityDbPath: input.continuityDbPath,
      sidecarDbPath: input.sidecarDbPath,
      workDir: work,
      betweenSnapshots: input.betweenSnapshots,
    });
    if (taken.quiet) {
      snapshot = taken;
    } else {
      rmSync(work, { recursive: true, force: true });
    }
  }
  if (!snapshot) {
    throw new Error("backup_snapshot_cohort_torn");
  }
  try {
    const companions = { files: [] as CompanionFile[], skipped: [] as Array<{ name: string; reason: string }>, excluded: { count: 0 } };
    companionFiles(input.companionDataDir, work, companions);

    const sourceOf = new Map<string, string>([
      ["nuclear.db", join(work, "nuclear.db")],
      ["continuity.db", join(work, "continuity.db")],
      ["cognitive-v021.db", join(work, "cognitive-v021.db")],
      ...companions.files.map((file): [string, string] => [file.name, file.path]),
    ]);
    const members: BackupMember[] = [...sourceOf.keys()].map((name) => ({
      name,
      ...hashFile(sourceOf.get(name)!),
    }));
    const hashOf = (name: string): string => members.find((member) => member.name === name)!.sha256;

    const createdAt = new Date().toISOString();
    const manifest: BackupManifest = {
      packageVersion: BACKUP_PACKAGE_VERSION,
      lineageId,
      nuclearSchemaVersion: input.nuclearSchemaVersion,
      continuitySchemaVersion: input.continuitySchemaVersion,
      sidecarSchemaVersion: input.sidecarSchemaVersion,
      c1CorrectionSeq: snapshot.c1CorrectionSeq,
      nuclearHash: hashOf("nuclear.db"),
      continuityHash: hashOf("continuity.db"),
      sidecarHash: hashOf("cognitive-v021.db"),
      nuclearSnapshotAt: snapshot.at.nuclear,
      continuitySnapshotAt: snapshot.at.continuity,
      sidecarSnapshotAt: snapshot.at.sidecar,
      continuityWatermark: hashOf("continuity.db"),
      buildIdentity: input.buildIdentity ?? null,
      createdAt,
      members,
      skipped: companions.skipped,
      excludedSecretFiles: companions.excluded.count,
      cohort: {
        startedAt: snapshot.startedAt,
        finishedAt: snapshot.finishedAt,
        quiet: snapshot.quiet,
        dataVersions: snapshot.dataVersions,
      },
      tableRows: snapshot.tableRows,
    };

    const packagePath = join(input.outDir, `ashley-backup-${Date.now()}.pkg`);
    const tmp = `${packagePath}.tmp`;
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const kid = keyIdOf(key);
    const cipher = createCipheriv("aes-256-gcm", scryptSync(key, salt, 32, SCRYPT_PARAMS), nonce);
    cipher.setAAD(Buffer.from(`ashley-backup-v${BACKUP_PACKAGE_VERSION}`, "utf8"));
    const headerFields = { v: BACKUP_PACKAGE_VERSION, salt: salt.toString("hex"), nonce: nonce.toString("hex"), kid };
    const placeholder = encodeHeader({ ...headerFields, tag: "0".repeat(32) });
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, MAGIC);
      writeSync(fd, placeholder);
      writeSync(fd, Buffer.from("\n", "utf8"));
      const put = (bytes: Buffer): void => {
        const out = cipher.update(bytes);
        if (out.length > 0) writeSync(fd, out);
      };
      const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
      put(entryLine(MANIFEST_ENTRY, manifestBytes.length));
      put(manifestBytes);
      for (const member of members) {
        put(entryLine(member.name, member.size));
        eachChunk(sourceOf.get(member.name)!, put);
      }
      const last = cipher.final();
      if (last.length > 0) writeSync(fd, last);
      const real = encodeHeader({ ...headerFields, tag: cipher.getAuthTag().toString("hex") });
      if (real.length !== placeholder.length) throw new Error("backup_header_width");
      writeSync(fd, real, 0, real.length, MAGIC.length);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, packagePath);
    const packageHash = hashFile(packagePath).sha256;
    recordContinuityEvent(input.continuity, {
      kind: "backup_completed",
      lineageId,
      detail: {
        packageHash,
        nuclearHash: manifest.nuclearHash,
        continuityHash: manifest.continuityHash,
        sidecarHash: manifest.sidecarHash,
        quiet: snapshot.quiet,
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
        manifest.nuclearHash,
        manifest.continuityHash,
        packageHash,
        JSON.stringify({
          packagePath,
          c1CorrectionSeq: manifest.c1CorrectionSeq,
          sidecarHash: manifest.sidecarHash,
          sidecarSnapshotAt: manifest.sidecarSnapshotAt,
        }),
      );
    return { packagePath, manifest };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

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

/**
 * Moves each live path aside (into `previousDir`) and then moves the staged one in. A failure part-way
 * puts every moved path back. Stale -journal, -wal and -shm files belong to the replaced database: they
 * are moved aside too, so a hot journal can never roll a restored file back.
 */
function installRestoreFiles(input: {
  previousDir: string;
  files: Array<{ staged: string; live: string; name: string; sidecarsToo?: boolean }>;
}): void {
  mkdirSync(input.previousDir, { recursive: true });
  const installed: Array<{ live: string; previous: string | null; sidecars: Array<{ from: string; to: string }> }> = [];
  try {
    for (const file of input.files) {
      const sidecars: Array<{ from: string; to: string }> = [];
      if (file.sidecarsToo) {
        for (const suffix of ["-journal", "-wal", "-shm"]) {
          const from = `${file.live}${suffix}`;
          if (existsSync(from)) {
            const to = join(input.previousDir, `${file.name}${suffix}`);
            renameSync(from, to);
            sidecars.push({ from, to });
          }
        }
      }
      const previous = existsSync(file.live) ? join(input.previousDir, file.name) : null;
      if (previous) renameSync(file.live, previous);
      try {
        mkdirSync(dirname(file.live), { recursive: true });
        renameSync(file.staged, file.live);
      } catch (error) {
        if (previous && existsSync(previous)) renameSync(previous, file.live);
        for (const moved of sidecars) renameSync(moved.to, moved.from);
        throw error;
      }
      installed.push({ live: file.live, previous, sidecars });
    }
  } catch (error) {
    for (const file of installed.reverse()) {
      if (existsSync(file.live)) rmSync(file.live, { recursive: true, force: true });
      if (file.previous && existsSync(file.previous)) renameSync(file.previous, file.live);
      for (const moved of file.sidecars) renameSync(moved.to, moved.from);
    }
    throw error;
  }
}

function validateStagedDatabase(
  path: string,
  supportedVersion: number,
): void {
  const db = waitForLocks(new DatabaseSync(path));
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

/**
 * Restores a verified package in place of the three live databases (and, with dataDir, the companion
 * files). Staging happens beside the live files so each install is a same-volume rename. Live
 * journals are moved aside, the replaced files are kept in a `restore-previous-*` folder, and the
 * restore is recorded in the continuity log with the C1 assessment.
 */
export function restoreDualBackupPackage(input: {
  packagePath: string;
  transferKeyHex?: string;
  nuclearDbPath: string;
  continuityDbPath: string;
  sidecarDbPath: string;
  tempDir: string;
  derivedDbPath?: string;
  /** Data directory for the companion files (home, archive, sessions, state.json). Optional. */
  dataDir?: string;
}): {
  ready: boolean;
  manifest: BackupManifest | null;
  note: string;
  c1?: C1RestoreContinuity;
} {
  let manifest: BackupManifest | null = null;
  let currentContinuity: DatabaseSync | null = null;
  let currentSidecar: DatabaseSync | null = null;
  let stageDir: string | null = null;
  try {
    const preservedTombstones = existsSync(input.continuityDbPath)
      ? (() => {
          currentContinuity = waitForLocks(new DatabaseSync(input.continuityDbPath));
          return preserveCurrentTombstones(currentContinuity);
        })()
      : [];
    const preservedEffectReceipts = existsSync(input.sidecarDbPath)
      ? (() => {
          currentSidecar = waitForLocks(new DatabaseSync(input.sidecarDbPath));
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

    const stagingRoot = input.dataDir ?? dirname(input.continuityDbPath);
    const stamp = `${Date.now()}-${randomBytes(6).toString("hex")}`;
    stageDir = join(stagingRoot, `.restore-${stamp}`);
    const read = readBackupPackage({
      packagePath: input.packagePath,
      transferKeyHex: input.transferKeyHex,
      extractDir: stageDir,
    });
    if (read.missing.length > 0) {
      return { ready: false, manifest, note: "backup_package_member_missing" };
    }
    if (read.mismatches.length > 0) {
      return { ready: false, manifest, note: "backup_package_hash_mismatch" };
    }
    const stagedNuclear = join(stageDir, "nuclear.db");
    const stagedContinuity = join(stageDir, "continuity.db");
    const stagedSidecar = join(stageDir, "cognitive-v021.db");
    validateStagedDatabase(stagedNuclear, NUCLEAR_SUPPORTED_VERSION);
    validateStagedDatabase(stagedContinuity, CONTINUITY_SCHEMA_VERSION);
    validateStagedDatabase(stagedSidecar, COGNITIVE_SIDECAR_SCHEMA_VERSION);
    const stagedContinuityDb = waitForLocks(new DatabaseSync(stagedContinuity));
    try {
      if (getAuthoritativeLineageId(stagedContinuityDb) !== manifest.lineageId) {
        return { ready: false, manifest, note: "backup_package_lineage_mismatch" };
      }
    } finally {
      stagedContinuityDb.close();
    }

    const previousDir = join(stagingRoot, `restore-previous-${stamp}`);
    const files: Array<{ staged: string; live: string; name: string; sidecarsToo?: boolean }> = [
      { staged: stagedNuclear, live: input.nuclearDbPath, name: "nuclear.db", sidecarsToo: true },
      { staged: stagedContinuity, live: input.continuityDbPath, name: "continuity.db", sidecarsToo: true },
      { staged: stagedSidecar, live: input.sidecarDbPath, name: "cognitive-v021.db", sidecarsToo: true },
    ];
    if (input.dataDir) {
      // Companions replace whole folders (home, sessions) and whole files (archive, state.json).
      const companionNames = [...read.extracted.keys()].filter((name) => !(DB_MEMBERS as readonly string[]).includes(name));
      const units: Array<{ rel: string; dir: boolean }> = [];
      if (companionNames.some((name) => name.startsWith("home/"))) units.push({ rel: "home", dir: true });
      if (companionNames.some((name) => name.startsWith("conversations/sessions/"))) {
        units.push({ rel: "conversations/sessions", dir: true });
      }
      for (const name of ["conversations/index.db", "state.json"]) {
        if (companionNames.includes(name)) units.push({ rel: name, dir: false });
      }
      for (const unit of units) {
        files.push({
          staged: join(stageDir, ...unit.rel.split("/")),
          live: join(input.dataDir, ...unit.rel.split("/")),
          name: unit.rel.replace(/\//g, "-"),
        });
      }
    }
    installRestoreFiles({ previousDir, files });

    const restoredContinuity = waitForLocks(new DatabaseSync(input.continuityDbPath));
    const restoredNuclear = waitForLocks(new DatabaseSync(input.nuclearDbPath));
    const restoredSidecar = waitForLocks(new DatabaseSync(input.sidecarDbPath));
    let c1: C1RestoreContinuity | undefined;
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
      const restoredC1 = readC1CorrectionSeq(input.nuclearDbPath);
      c1 = assessC1RestoreContinuity({
        restoredCorrectionSeq: restoredC1,
        // No independent sidecar witness is recorded yet, so it is passed as absent (fails closed when authority exists).
        sidecarCorrectionSeq: null,
        manifestCorrectionSeq: manifest.c1CorrectionSeq,
        appliedC1AuthorityExists: restoredC1 !== null && restoredC1 > 0,
      });
      recordContinuityEvent(restoredContinuity, {
        kind: "restore",
        lineageId: manifest.lineageId,
        detail: {
          packageVersion: manifest.packageVersion,
          createdAt: manifest.createdAt,
          nuclearHash: manifest.nuclearHash,
          continuityHash: manifest.continuityHash,
          sidecarHash: manifest.sidecarHash,
          members: manifest.members?.length ?? 3,
          skippedMembers: manifest.skipped?.length ?? 0,
          previousKept: true,
          c1: { status: c1.status, influenceFailClosed: c1.influenceFailClosed, reason: c1.reason },
        },
      });
    } finally {
      restoredSidecar.close();
      restoredNuclear.close();
      restoredContinuity.close();
    }
    return { ready: true, manifest, note: "restore_ready_after_reconciliation", c1 };
  } catch (error) {
    return {
      ready: false,
      manifest,
      note: `restore_failed:${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    try { currentSidecar?.close(); } catch { /* preserve restore result */ }
    try { currentContinuity?.close(); } catch { /* preserve restore result */ }
    if (stageDir) rmSync(stageDir, { recursive: true, force: true });
  }
}
