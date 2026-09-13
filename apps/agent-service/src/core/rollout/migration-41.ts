import type { DatabaseSync } from "node:sqlite";

export const C1_QUALIFICATION_TABLES = [
  "memory_evidence_qualification_epochs",
  "memory_evidence_qualification_events",
] as const;

export const C1_QUALIFICATION_INDEXES = [
  "memory_evidence_one_current_epoch",
  "memory_evidence_events_by_epoch_kind_time",
] as const;

export const MIGRATION_41_C1_QUALIFICATION_DDL = `
CREATE TABLE IF NOT EXISTS memory_evidence_qualification_epochs (
  epoch_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('current', 'retired')),
  start_request_key TEXT NOT NULL UNIQUE,
  predecessor_epoch_id TEXT REFERENCES memory_evidence_qualification_epochs(epoch_id),
  owner_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  started_build_identity TEXT NOT NULL,
  created_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  retired_at TEXT,
  eval_seed_count INTEGER NOT NULL DEFAULT 0,
  qualified_at TEXT,
  sealed_at TEXT,
  sealed_release_id TEXT,
  blocked_at TEXT,
  block_code TEXT,
  block_source_key TEXT,
  CHECK (
    (sealed_at IS NULL AND sealed_release_id IS NULL)
    OR (sealed_at IS NOT NULL AND sealed_release_id IS NOT NULL)
  ),
  CHECK (
    (blocked_at IS NULL AND block_code IS NULL)
    OR (blocked_at IS NOT NULL AND block_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_evidence_one_current_epoch
ON memory_evidence_qualification_epochs(status)
WHERE status = 'current';

CREATE TABLE IF NOT EXISTS memory_evidence_qualification_events (
  epoch_id TEXT NOT NULL REFERENCES memory_evidence_qualification_epochs(epoch_id),
  kind TEXT NOT NULL CHECK (kind IN ('isolated_eval', 'live_shadow')),
  source_key TEXT NOT NULL,
  decision_class TEXT CHECK (
    decision_class IS NULL OR decision_class IN (
      'no_c1_material',
      'same_current',
      'would_relabel',
      'would_filter',
      'would_narrow',
      'mixed_change',
      'unmapped_fail_closed',
      'evaluation_error'
    )
  ),
  qualifies INTEGER NOT NULL CHECK (qualifies IN (0, 1)),
  trigger TEXT CHECK (trigger IS NULL OR trigger IN ('reactive', 'proactive')),
  source_count INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  build_identity TEXT NOT NULL,
  PRIMARY KEY (epoch_id, kind, source_key)
);

CREATE INDEX IF NOT EXISTS memory_evidence_events_by_epoch_kind_time
ON memory_evidence_qualification_events(epoch_id, kind, qualifies, occurred_at);
`;

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}
function fail(version: number, detail: string): never {
  throw new Error(`nuclear_schema_content_invalid:v${version}:${detail}`);
}

function requireColumns(db: DatabaseSync, version: number, table: string, names: string[]): void {
  const present = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
      .map((row) => row.name),
  );
  for (const name of names) {
    if (!present.has(name)) fail(version, `missing_column:${table}.${name}`);
  }
}

function requireSqlFragments(
  db: DatabaseSync,
  version: number,
  table: string,
  fragments: string[],
): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: string | null } | undefined;
  const sql = String(row?.sql ?? "").toLowerCase().replace(/\s+/g, " ");
  for (const fragment of fragments) {
    if (!sql.includes(fragment.toLowerCase().replace(/\s+/g, " "))) {
      fail(version, `missing_constraint:${table}:${fragment}`);
    }
  }
}

function requireIndex(db: DatabaseSync, version: number, name: string): void {
  if (!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(name)) {
    fail(version, `missing_index:${name}`);
  }
}

export function ensureNuclearV41Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_41_C1_QUALIFICATION_DDL);
}

export function validateNuclearV41Schema(db: DatabaseSync, version = 41): void {
  const required: Record<string, string[]> = {
    memory_evidence_qualification_epochs: [
      "epoch_id", "status", "start_request_key", "predecessor_epoch_id", "owner_id",
      "contract_id", "started_build_identity", "created_by", "started_at", "retired_at",
      "eval_seed_count", "qualified_at", "sealed_at", "sealed_release_id", "blocked_at",
      "block_code", "block_source_key",
    ],
    memory_evidence_qualification_events: [
      "epoch_id", "kind", "source_key", "decision_class", "qualifies", "trigger",
      "source_count", "detail_json", "occurred_at", "contract_id", "build_identity",
    ],
  };
  for (const table of C1_QUALIFICATION_TABLES) {
    if (!tableExists(db, table)) fail(version, `missing_table:${table}`);
    requireColumns(db, version, table, required[table] ?? []);
  }
  requireSqlFragments(db, version, "memory_evidence_qualification_epochs", [
    "status IN ('current', 'retired')",
    "sealed_at IS NULL AND sealed_release_id IS NULL",
    "blocked_at IS NULL AND block_code IS NULL",
  ]);
  requireSqlFragments(db, version, "memory_evidence_qualification_events", [
    "kind IN ('isolated_eval', 'live_shadow')",
    "qualifies IN (0, 1)",
    "decision_class IS NULL OR decision_class IN",
    "trigger IS NULL OR trigger IN ('reactive', 'proactive')",
  ]);
  for (const index of C1_QUALIFICATION_INDEXES) requireIndex(db, version, index);
}
