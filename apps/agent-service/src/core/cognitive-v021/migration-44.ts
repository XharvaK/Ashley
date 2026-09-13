import type { DatabaseSync } from "node:sqlite";
import { canonicalizeAuthorityVersionVector } from "./authority/version-vector.js";

export const MIGRATION_44_AUTHORITY_BARRIER_DDL = `
CREATE TABLE IF NOT EXISTS authority_transition_barrier (
  barrier_id TEXT PRIMARY KEY CHECK (barrier_id = 'global'),
  state TEXT NOT NULL CHECK (state IN ('stable','transitioning','reconciling')),
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  vector_json TEXT NOT NULL CHECK (json_valid(vector_json)),
  active_transition_id TEXT,
  reason_code TEXT,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);
CREATE TABLE IF NOT EXISTS canonical_owner_versions (
  owner_name TEXT PRIMARY KEY CHECK (owner_name IN ('nuclear','continuity','cognitive_sidecar')),
  version INTEGER NOT NULL CHECK (version >= 0),
  last_change_id TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);
CREATE TABLE IF NOT EXISTS derived_invalidation_journal (
  change_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  conversation_id TEXT,
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
  invalidation_kind TEXT NOT NULL CHECK (invalidation_kind IN ('forget','redaction','source_change')),
  canonical_owner TEXT NOT NULL CHECK (canonical_owner IN ('nuclear','continuity','cognitive_sidecar')),
  canonical_version INTEGER NOT NULL CHECK (canonical_version >= 0),
  target_generation INTEGER NOT NULL CHECK (target_generation >= 0),
  state TEXT NOT NULL CHECK (state IN ('pending','leased','applied','quarantined')),
  lease_owner TEXT, lease_expires_at_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
);
CREATE INDEX IF NOT EXISTS idx_derived_journal_pending
  ON derived_invalidation_journal(state, created_at_ms, change_id);
CREATE INDEX IF NOT EXISTS idx_derived_journal_scope
  ON derived_invalidation_journal(owner_id, conversation_id, state);
INSERT OR IGNORE INTO authority_transition_barrier
  (barrier_id, state, epoch, revision, vector_json, updated_at_ms)
VALUES ('global', 'reconciling', 0, 0, '{"nuclear":0,"continuity":0,"cognitive_sidecar":0}', 0);
INSERT OR IGNORE INTO canonical_owner_versions (owner_name, version, last_change_id, updated_at_ms)
VALUES
  ('nuclear', 0, 'migration-44', 0),
  ('continuity', 0, 'migration-44', 0),
  ('cognitive_sidecar', 0, 'migration-44', 0);
`;

const TABLE_COLUMNS = {
  authority_transition_barrier: [
    "barrier_id", "state", "epoch", "revision", "vector_json",
    "active_transition_id", "reason_code", "updated_at_ms",
  ],
  canonical_owner_versions: ["owner_name", "version", "last_change_id", "updated_at_ms"],
  derived_invalidation_journal: [
    "change_id", "owner_id", "conversation_id", "source_refs_json",
    "invalidation_kind", "canonical_owner", "canonical_version",
    "target_generation", "state", "lease_owner", "lease_expires_at_ms",
    "attempts", "last_error_code", "created_at_ms", "updated_at_ms",
  ],
} as const;

const TABLES = Object.keys(TABLE_COLUMNS) as Array<keyof typeof TABLE_COLUMNS>;

function hasObject(db: DatabaseSync, type: string, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
  ).get(type, name));
}
function requireColumns(db: DatabaseSync, table: string, columns: readonly string[], version: number): void {
  const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .map((column) => String(column.name ?? "")));
  for (const column of columns) {
    if (!actual.has(column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:${table}.${column}`);
    }
  }
}

function requireIndex(db: DatabaseSync, name: string, table: string, columns: readonly string[], version: number): void {
  if (!hasObject(db, "index", name)) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_index:${name}`);
  }
  const actual = (db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name?: unknown; seqno?: unknown }>)
    .sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
    .map((column) => String(column.name ?? ""));
  if (actual.join(",") !== columns.join(",")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:index_columns:${name}`);
  }
  const row = db.prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?").get(name) as { tbl_name?: unknown } | undefined;
  if (row?.tbl_name !== table) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:index_table:${name}`);
  }
}

/** Idempotent schema installer used by isolated migration fixtures. */
export function ensureNuclearV44Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_44_AUTHORITY_BARRIER_DDL);
}

export function validateNuclearV44Schema(db: DatabaseSync, version = 44): void {
  for (const table of TABLES) {
    if (!hasObject(db, "table", table)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_table:${table}`);
    }
    requireColumns(db, table, TABLE_COLUMNS[table], version);
  }
  requireIndex(db, "idx_derived_journal_pending", "derived_invalidation_journal", ["state", "created_at_ms", "change_id"], version);
  requireIndex(db, "idx_derived_journal_scope", "derived_invalidation_journal", ["owner_id", "conversation_id", "state"], version);

  const barrier = db.prepare(
    "SELECT state, epoch, revision, vector_json FROM authority_transition_barrier WHERE barrier_id = 'global'",
  ).get() as { state?: unknown; epoch?: unknown; revision?: unknown; vector_json?: unknown } | undefined;
  if (!barrier || !["stable", "transitioning", "reconciling"].includes(String(barrier.state))) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_barrier_singleton`);
  }
  if (!Number.isInteger(Number(barrier.epoch)) || Number(barrier.epoch) < 0 ||
      !Number.isInteger(Number(barrier.revision)) || Number(barrier.revision) < 0) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:invalid_barrier_counters`);
  }
  try {
    canonicalizeAuthorityVersionVector(JSON.parse(String(barrier.vector_json ?? "")));
  } catch {
    throw new Error(`nuclear_schema_content_invalid:v${version}:invalid_barrier_vector`);
  }

  const ownerRows = db.prepare(
    "SELECT owner_name, version, last_change_id, updated_at_ms FROM canonical_owner_versions ORDER BY owner_name",
  ).all() as Array<{ owner_name?: unknown; version?: unknown; last_change_id?: unknown; updated_at_ms?: unknown }>;
  if (ownerRows.length !== 3 || ownerRows.some((row) =>
    !["nuclear", "continuity", "cognitive_sidecar"].includes(String(row.owner_name)) ||
    !Number.isInteger(Number(row.version)) || Number(row.version) < 0 ||
    typeof row.last_change_id !== "string" || row.last_change_id.length === 0 ||
    !Number.isInteger(Number(row.updated_at_ms)) || Number(row.updated_at_ms) < 0,
  )) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:owner_version_rows_invalid`);
  }
}
