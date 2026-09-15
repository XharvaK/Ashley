import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";

export type IntegrityProof = {
  sha256: string;
  byteSize: number;
  storedAtMs: number;
};

export type ArtifactTextPage = {
  artifactRef: string;
  text: string;
  offsetChars: number;
  limitChars: number;
  totalChars: number;
  contentHash: string;
};

export type ArtifactSweepResult = {
  rowsVisited: number;
  rowsExpired: number;
  filesRemoved: number;
};

const ARTIFACT_BYTE_STORE_ENV = "ASHLEY_ARTIFACT_BYTE_STORE_DIR";
const HASH_PATTERN = /^[a-f0-9]{64}$/;
let lastArtifactDatabase: DatabaseSync | null = null;

type ArtifactRow = {
  owner_id?: unknown;
  status?: unknown;
  content_hash?: unknown;
  byte_size?: unknown;
  mime_declared?: unknown;
  mime_detected?: unknown;
  preserved?: unknown;
  integrity_proof_json?: unknown;
  provenance_json?: unknown;
  retention_until?: unknown;
};

function databaseMainFile(db: DatabaseSync): string | null {
  const rows = db.prepare("PRAGMA database_list").all() as Array<{
    name?: string;
    file?: string;
  }>;
  const main = rows.find((row) => row.name === "main");
  const file = main?.file?.trim() ?? "";
  return file.length > 0 ? file : null;
}

/** Resolve the P0-selected byte-store home without reading or logging live values. */
export function artifactByteStoreDir(db: DatabaseSync): string {
  const override = process.env[ARTIFACT_BYTE_STORE_ENV]?.trim();
  if (override) return resolve(override);
  const mainFile = databaseMainFile(db);
  if (!mainFile) throw new Error("artifact_store_path_unavailable");
  return join(dirname(resolve(mainFile)), "artifact-bytes");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function rowForArtifact(
  db: DatabaseSync,
  entityUuid: string,
  ownerId?: string,
): ArtifactRow {
  const row = db.prepare(
    `SELECT owner_id, status, content_hash, byte_size, mime_declared,
            mime_detected, preserved, integrity_proof_json, provenance_json,
            retention_until
       FROM perception_artifacts
      WHERE entity_uuid = ?`,
  ).get(entityUuid) as ArtifactRow | undefined;
  if (!row) throw new Error("artifact_not_found");
  if (ownerId !== undefined && String(row.owner_id ?? "") !== ownerId) {
    throw new Error("artifact_owner_mismatch");
  }
  return row;
}

function parseIntegrityProof(value: unknown): IntegrityProof {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("artifact_corrupt");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("artifact_corrupt");
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.sha256 !== "string" ||
    !HASH_PATTERN.test(candidate.sha256) ||
    !Number.isInteger(candidate.byteSize) ||
    Number(candidate.byteSize) < 0 ||
    !Number.isInteger(candidate.storedAtMs) ||
    Number(candidate.storedAtMs) < 0
  ) {
    throw new Error("artifact_corrupt");
  }
  return {
    sha256: candidate.sha256,
    byteSize: Number(candidate.byteSize),
    storedAtMs: Number(candidate.storedAtMs),
  };
}

function verifyStoredFile(path: string, proof: IntegrityProof): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    throw new Error("artifact_corrupt");
  }
  if (
    bytes.byteLength !== proof.byteSize ||
    sha256(bytes) !== proof.sha256
  ) {
    throw new Error("artifact_corrupt");
  }
  return bytes;
}

function atomicallyWriteBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      const existing = new Uint8Array(readFileSync(path));
      if (existing.byteLength === bytes.byteLength && sha256(existing) === sha256(bytes)) return;
    } catch {
      // Replace an unreadable or corrupt shared file below.
    }
  }

  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes);
    const descriptor = openSync(temporary, "r+");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      renameSync(temporary, path);
    } catch {
      // Windows does not replace an existing path with rename. The target is
      // content-addressed, so replacing a failed verification is safe.
      if (existsSync(path)) unlinkSync(path);
      renameSync(temporary, path);
    }
  } finally {
    if (existsSync(temporary)) {
      try { unlinkSync(temporary); } catch { /* best effort after a failed write */ }
    }
  }
}

function normalizedMime(mime: string): string {
  return mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/**
 * Persist and verify one whole artifact. The database update is deliberately
 * last: only a verified file can set preserved=1.
 */
export function storeArtifactBytes(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  bytes: Uint8Array,
  mime: string,
): IntegrityProof {
  const row = rowForArtifact(db, entityUuid, ownerId);
  if (row.status === "redacted" || row.status === "expired") {
    throw new Error("artifact_not_preservable");
  }
  const digest = sha256(bytes);
  const expectedHash = String(row.content_hash ?? "").trim().toLowerCase();
  if (!expectedHash || expectedHash !== digest) {
    throw new Error("artifact_integrity_mismatch");
  }
  const expectedSize = Number(row.byte_size ?? bytes.byteLength);
  if (expectedSize > 0 && expectedSize !== bytes.byteLength) {
    throw new Error("artifact_integrity_mismatch");
  }

  const storedAtMs = Date.now();
  const proof: IntegrityProof = {
    sha256: digest,
    byteSize: bytes.byteLength,
    storedAtMs,
  };
  const path = join(artifactByteStoreDir(db), digest);
  atomicallyWriteBytes(path, bytes);
  verifyStoredFile(path, proof);

  const provenance = JSON.stringify({
    ownerId,
    entityUuid,
    mime: normalizedMime(mime),
  });
  const changes = db.prepare(
    `UPDATE perception_artifacts
        SET integrity_proof_json = ?,
            provenance_json = ?,
            preserved = 1,
            updated_at = ?
      WHERE entity_uuid = ? AND owner_id = ? AND content_hash = ?`,
  ).run(
    JSON.stringify(proof),
    provenance,
    new Date(storedAtMs).toISOString(),
    entityUuid,
    ownerId,
    digest,
  ).changes;
  if (Number(changes) !== 1) throw new Error("artifact_preservation_update_failed");
  lastArtifactDatabase = db;
  return proof;
}

function resolveReadContext(
  first: DatabaseSync | string,
  second?: string,
): { db: DatabaseSync; entityUuid: string; ownerId?: string } {
  if (typeof first === "string") {
    if (!lastArtifactDatabase) throw new Error("artifact_database_context_required");
    return { db: lastArtifactDatabase, entityUuid: first };
  }
  return { db: first, entityUuid: second ?? "" };
}

export function readArtifactBytes(entityUuid: string): Uint8Array;
export function readArtifactBytes(
  db: DatabaseSync,
  entityUuid: string,
  ownerId?: string,
): Uint8Array;
export function readArtifactBytes(
  first: DatabaseSync | string,
  second?: string,
  third?: string,
): Uint8Array {
  const context = typeof first === "string"
    ? resolveReadContext(first)
    : resolveReadContext(first, second);
  const row = rowForArtifact(context.db, context.entityUuid, third);
  if (Number(row.preserved ?? 0) !== 1 || row.integrity_proof_json == null) {
    throw new Error("artifact_not_preserved");
  }
  const proof = parseIntegrityProof(row.integrity_proof_json);
  const bytes = verifyStoredFile(
    join(artifactByteStoreDir(context.db), proof.sha256),
    proof,
  );
  if (String(row.content_hash ?? "").trim().toLowerCase() !== proof.sha256) {
    throw new Error("artifact_corrupt");
  }
  return bytes;
}

function validatePage(offsetChars: number, limitChars: number): void {
  if (!Number.isInteger(offsetChars) || offsetChars < 0) {
    throw new Error("artifact_page_offset_invalid");
  }
  if (!Number.isInteger(limitChars) || limitChars <= 0) {
    throw new Error("artifact_page_limit_invalid");
  }
}

export function readArtifactTextPage(
  entityUuid: string,
  offsetChars: number,
  limitChars: number,
): ArtifactTextPage;
export function readArtifactTextPage(
  db: DatabaseSync,
  entityUuid: string,
  offsetChars: number,
  limitChars: number,
  ownerId?: string,
): ArtifactTextPage;
export function readArtifactTextPage(
  first: DatabaseSync | string,
  second: string | number,
  third: number,
  fourth?: number,
  fifth?: string,
): ArtifactTextPage {
  const db = typeof first === "string" ? lastArtifactDatabase : first;
  const entityUuid = typeof first === "string" ? first : second as string;
  const offsetChars = typeof first === "string" ? second as number : third;
  const limitChars = typeof first === "string" ? third : fourth as number;
  const ownerId = typeof first === "string" ? undefined : fifth;
  if (!db) throw new Error("artifact_database_context_required");
  validatePage(offsetChars, limitChars);
  const row = rowForArtifact(db, entityUuid, ownerId);
  const bytes = readArtifactBytes(db, entityUuid, ownerId);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return {
    artifactRef: entityUuid,
    text: text.slice(offsetChars, offsetChars + limitChars),
    offsetChars,
    limitChars,
    totalChars: text.length,
    contentHash: String(row.content_hash ?? ""),
  };
}

function proofHash(value: unknown): string | null {
  try {
    return parseIntegrityProof(value).sha256;
  } catch {
    return null;
  }
}

function removeIfUnreferenced(
  db: DatabaseSync,
  entityUuid: string,
  digest: string,
  dir: string,
): number {
  const active = Number((db.prepare(
    `SELECT COUNT(*) AS count
       FROM perception_artifacts
      WHERE entity_uuid <> ? AND preserved = 1
        AND json_extract(integrity_proof_json, '$.sha256') = ?`,
  ).get(entityUuid, digest) as { count?: number } | undefined)?.count ?? 0);
  if (active > 0) return 0;
  const path = join(dir, digest);
  if (!existsSync(path)) return 0;
  try {
    unlinkSync(path);
    return 1;
  } catch {
    return 0;
  }
}

function removeUnreferencedFiles(db: DatabaseSync, dir: string): number {
  if (!existsSync(dir)) return 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!HASH_PATTERN.test(name)) continue;
    const active = Number((db.prepare(
      `SELECT COUNT(*) AS count
         FROM perception_artifacts
        WHERE preserved = 1
          AND json_extract(integrity_proof_json, '$.sha256') = ?`,
    ).get(name) as { count?: number } | undefined)?.count ?? 0);
    if (active > 0) continue;
    try {
      unlinkSync(join(dir, name));
      removed += 1;
    } catch {
      // A later bounded sweep can retry a file that could not be removed.
    }
  }
  return removed;
}

/** Existing bounded reconciliation maintenance owner for perception retention. */
export function sweepExpiredArtifacts(
  db: DatabaseSync,
  options: { nowMs?: number; limit?: number } = {},
): ArtifactSweepResult {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const nowIso = new Date(nowMs).toISOString();
  const rows = db.prepare(
    `SELECT entity_uuid, status, preserved, integrity_proof_json, retention_until
       FROM perception_artifacts
      WHERE status IN ('redacted', 'expired') OR retention_until <= ?
      ORDER BY updated_at ASC, id ASC
      LIMIT ?`,
  ).all(nowIso, limit) as Array<{
    entity_uuid?: string;
    status?: string;
    preserved?: number;
    integrity_proof_json?: string | null;
    retention_until?: string;
  }>;
  const dir = artifactByteStoreDir(db);
  let rowsExpired = 0;
  let filesRemoved = 0;
  for (const row of rows) {
    const entityUuid = String(row.entity_uuid ?? "");
    if (!entityUuid) continue;
    const digest = Number(row.preserved ?? 0) === 1
      ? proofHash(row.integrity_proof_json)
      : null;
    if (digest) filesRemoved += removeIfUnreferenced(db, entityUuid, digest, dir);
    const nextStatus = row.status === "redacted" ? "redacted" : "expired";
    const changes = db.prepare(
      `UPDATE perception_artifacts
          SET status = ?, preserved = 0, integrity_proof_json = NULL,
              provenance_json = NULL, content_hash = NULL, excerpt = NULL,
              model_parts_json = '[]', model_representation = 'none',
              updated_at = ?
        WHERE entity_uuid = ?`,
    ).run(nextStatus, nowIso, entityUuid).changes;
    if (Number(changes) === 1 && nextStatus === "expired") rowsExpired += 1;
  }
  filesRemoved += removeUnreferencedFiles(db, dir);
  return { rowsVisited: rows.length, rowsExpired, filesRemoved };
}
