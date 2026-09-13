import type { DatabaseSync } from "node:sqlite";
import { stableJson } from "../../model-fabric/hash.js";
import type {
  AuthorityVersionVector,
  CanonicalOwner,
} from "../types.js";

export const CANONICAL_AUTHORITY_OWNERS = [
  "nuclear",
  "continuity",
  "cognitive_sidecar",
] as const satisfies readonly CanonicalOwner[];

export function emptyAuthorityVersionVector(): AuthorityVersionVector {
  return { nuclear: 0, continuity: 0, cognitive_sidecar: 0 };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Canonicalize and validate the vector before it is persisted or compared. */
export function canonicalizeAuthorityVersionVector(
  value: unknown,
): AuthorityVersionVector {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("authority_version_vector_invalid");
  }
  const input = value as Record<string, unknown>;
  const result: Record<CanonicalOwner, number> = { nuclear: 0, continuity: 0, cognitive_sidecar: 0 };
  for (const owner of CANONICAL_AUTHORITY_OWNERS) {
    if (!isNonNegativeInteger(input[owner])) {
      throw new Error(`authority_version_vector_invalid:${owner}`);
    }
    result[owner] = input[owner] as number;
  }
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== [...CANONICAL_AUTHORITY_OWNERS].sort().join(",")) {
    throw new Error("authority_version_vector_keys_invalid");
  }
  return result;
}

export function authorityVersionVectorsEqual(
  left: AuthorityVersionVector,
  right: AuthorityVersionVector,
): boolean {
  return stableJson(canonicalizeAuthorityVersionVector(left))
    === stableJson(canonicalizeAuthorityVersionVector(right));
}

export function hasAuthorityBarrier(db: DatabaseSync): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'authority_transition_barrier'",
  ).get());
}

export function readAuthorityVersionVector(db: DatabaseSync): AuthorityVersionVector {
  const rows = db.prepare(
    "SELECT owner_name, version FROM canonical_owner_versions ORDER BY owner_name ASC",
  ).all() as Array<{ owner_name?: unknown; version?: unknown }>;
  if (rows.length !== CANONICAL_AUTHORITY_OWNERS.length) {
    throw new Error("authority_version_vector_incomplete");
  }
  const value: Record<string, unknown> = {};
  for (const row of rows) {
    const owner = String(row.owner_name ?? "");
    if (owner in value || !CANONICAL_AUTHORITY_OWNERS.includes(owner as CanonicalOwner)) {
      throw new Error("authority_version_vector_owner_invalid");
    }
    value[owner] = Number(row.version);
  }
  return canonicalizeAuthorityVersionVector(value);
}

export function readCanonicalOwnerVersion(
  db: DatabaseSync,
  owner: CanonicalOwner,
): number {
  const row = db.prepare(
    "SELECT version FROM canonical_owner_versions WHERE owner_name = ?",
  ).get(owner) as { version?: unknown } | undefined;
  const version = Number(row?.version);
  if (!isNonNegativeInteger(version)) {
    throw new Error(`authority_owner_version_invalid:${owner}`);
  }
  return version;
}

/**
 * Advance one canonical owner while the coordinator is already in a
 * transition transaction. The same change id is idempotent.
 */
export function advanceCanonicalOwnerVersionInTransaction(
  db: DatabaseSync,
  owner: CanonicalOwner,
  changeId: string,
  nowMs: number,
): number {
  if (!changeId.trim()) throw new Error("authority_change_id_required");
  if (!Number.isFinite(nowMs)) throw new Error("authority_version_time_invalid");
  const barrier = db.prepare(
    "SELECT state FROM authority_transition_barrier WHERE barrier_id = 'global'",
  ).get() as { state?: unknown } | undefined;
  if (barrier?.state !== "transitioning" && barrier?.state !== "reconciling") {
    throw new Error("authority_transition_required");
  }
  const existing = db.prepare(
    "SELECT version, last_change_id FROM canonical_owner_versions WHERE owner_name = ?",
  ).get(owner) as { version?: unknown; last_change_id?: unknown } | undefined;
  if (!existing) throw new Error(`authority_owner_missing:${owner}`);
  const currentVersion = Number(existing.version);
  if (!isNonNegativeInteger(currentVersion)) throw new Error(`authority_owner_version_invalid:${owner}`);
  if (existing.last_change_id === changeId) return currentVersion;

  const nextVersion = currentVersion + 1;
  const result = db.prepare(
    `UPDATE canonical_owner_versions
        SET version = ?, last_change_id = ?, updated_at_ms = ?
      WHERE owner_name = ? AND version = ?`,
  ).run(nextVersion, changeId, nowMs, owner, currentVersion);
  if (Number(result.changes) !== 1) throw new Error("authority_owner_version_race");

  const vector = readAuthorityVersionVector(db);
  db.prepare(
    `UPDATE authority_transition_barrier
        SET vector_json = ?, updated_at_ms = ?
      WHERE barrier_id = 'global'`,
  ).run(stableJson(vector), nowMs);
  return nextVersion;
}
