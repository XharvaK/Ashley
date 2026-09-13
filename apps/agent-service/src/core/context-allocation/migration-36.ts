import type { DatabaseSync } from "node:sqlite";

export const C2_CONTRACT_VERSION = 1;

export const C2_TABLES = [
  "context_budget_policies",
  "context_allocation_receipts",
  "context_summary_projections",
  "cognitive_maturation_contract_state",
] as const;

export const C2_INDEXES = [
  "idx_context_allocation_receipts_owner_created",
  "idx_context_allocation_receipts_request",
  "idx_context_allocation_receipts_policy",
  "idx_context_summary_projections_owner",
  "idx_cognitive_maturation_contract_state_wave",
] as const;

/** Additive C2 schema. It stores allocation metadata, never remote prompt bodies. */
export const MIGRATION_37_CONTEXT_BUDGET_DDL = `
CREATE TABLE IF NOT EXISTS context_budget_policies (
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  total_utf8_bytes INTEGER NOT NULL CHECK (total_utf8_bytes > 0),
  section_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(section_json)),
  token_estimate_divisor INTEGER NOT NULL DEFAULT 4
    CHECK (token_estimate_divisor >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, version)
);

CREATE TABLE IF NOT EXISTS context_allocation_receipts (
  receipt_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  route_policy_snapshot_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version >= 1),
  profile_fingerprint TEXT NOT NULL,
  provider_adapter_class TEXT NOT NULL,
  egress_approval_ref TEXT,
  route_class TEXT NOT NULL CHECK (route_class IN (
    'remote_companion', 'local', 'public_surface', 'unknown'
  )),
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  projection_id TEXT NOT NULL UNIQUE,
  content_binding TEXT NOT NULL,
  included_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(included_json)),
  omitted_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(omitted_json)),
  truncated_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(truncated_json)),
  compressed_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(compressed_json)),
  degradation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(degradation_json)),
  same_snapshot_id TEXT,
  capability_mode TEXT NOT NULL CHECK (capability_mode IN (
    'observe', 'dark_apply', 'apply'
  )),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_summary_projections (
  summary_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  mechanism TEXT NOT NULL CHECK (mechanism IN (
    'deterministic_extract', 'utility_model'
  )),
  created_at TEXT NOT NULL,
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
  source_content_binding TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN (
    'ordinary', 'sensitive', 'never_public'
  )),
  text_utf8 TEXT NOT NULL,
  limitations_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(limitations_json)),
  invalidated_at TEXT,
  invalidation_reason TEXT
);

CREATE TABLE IF NOT EXISTS cognitive_maturation_contract_state (
  wave TEXT PRIMARY KEY CHECK (wave IN ('c1', 'c2', 'c3', 'c4', 'c5')),
  highest_contract_version INTEGER NOT NULL CHECK (highest_contract_version >= 1),
  live_authority_existed INTEGER NOT NULL DEFAULT 0
    CHECK (live_authority_existed IN (0, 1)),
  event_highwater INTEGER NOT NULL DEFAULT 0 CHECK (event_highwater >= 0),
  cutover_or_activation_state TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_allocation_receipts_owner_created
  ON context_allocation_receipts (owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_context_allocation_receipts_request
  ON context_allocation_receipts (request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_context_allocation_receipts_policy
  ON context_allocation_receipts (policy_id, policy_version, created_at);
CREATE INDEX IF NOT EXISTS idx_context_summary_projections_owner
  ON context_summary_projections (owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cognitive_maturation_contract_state_wave
  ON cognitive_maturation_contract_state (wave);
`;

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function fail(detail: string): never {
  throw new Error(`nuclear_schema_content_invalid:v37:${detail}`);
}

function requireColumns(db: DatabaseSync, table: string, columns: string[]): void {
  const present = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
      .map((row) => row.name),
  );
  for (const column of columns) {
    if (!present.has(column)) fail(`missing_column:${table}.${column}`);
  }
}

function requireSqlFragments(db: DatabaseSync, table: string, fragments: string[]): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: string | null } | undefined;
  const sql = String(row?.sql ?? "").toLowerCase().replace(/\s+/g, " ");
  for (const fragment of fragments) {
    if (!sql.includes(fragment.toLowerCase())) {
      fail(`missing_constraint:${table}:${fragment}`);
    }
  }
}

export function ensureNuclearV37Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_37_CONTEXT_BUDGET_DDL);
  db.prepare(
    `INSERT OR IGNORE INTO cognitive_maturation_contract_state
       (wave, highest_contract_version, live_authority_existed,
        event_highwater, cutover_or_activation_state)
     VALUES ('c2', ?, 0, 0, 'observe')`,
  ).run(C2_CONTRACT_VERSION);
}

export function validateNuclearV37Schema(db: DatabaseSync, _version = 37): void {
  const required: Record<string, string[]> = {
    context_budget_policies: [
      "policy_id", "version", "total_utf8_bytes", "section_json",
      "token_estimate_divisor", "created_at",
    ],
    context_allocation_receipts: [
      "receipt_id", "request_id", "owner_id", "purpose",
      "route_policy_snapshot_id", "route_id", "profile_id", "profile_version",
      "profile_fingerprint", "provider_adapter_class", "egress_approval_ref",
      "route_class", "policy_id", "policy_version", "projection_id",
      "content_binding", "included_json", "omitted_json", "truncated_json",
      "compressed_json", "degradation_json", "same_snapshot_id",
      "capability_mode", "created_at",
    ],
    context_summary_projections: [
      "summary_id", "owner_id", "policy_id", "mechanism", "created_at",
      "source_refs_json", "source_content_binding", "classification", "text_utf8",
      "limitations_json", "invalidated_at", "invalidation_reason",
    ],
    cognitive_maturation_contract_state: [
      "wave", "highest_contract_version", "live_authority_existed",
      "event_highwater", "cutover_or_activation_state",
    ],
  };
  for (const table of C2_TABLES) {
    if (!tableExists(db, table)) fail(`missing_table:${table}`);
    requireColumns(db, table, required[table] ?? []);
  }
  requireSqlFragments(db, "context_allocation_receipts", [
    "remote_companion", "dark_apply", "json_valid",
  ]);
  requireSqlFragments(db, "context_summary_projections", [
    "deterministic_extract", "never_public", "json_valid",
  ]);
  const marker = db.prepare(
    `SELECT highest_contract_version, live_authority_existed,
            event_highwater, cutover_or_activation_state
     FROM cognitive_maturation_contract_state WHERE wave = 'c2'`,
  ).get() as {
    highest_contract_version?: number;
    live_authority_existed?: number;
    event_highwater?: number;
    cutover_or_activation_state?: string;
  } | undefined;
  if (!marker) fail("missing_c2_marker_row");
  if (Number(marker.highest_contract_version ?? 0) < C2_CONTRACT_VERSION) {
    fail("c2_contract_version_too_old");
  }
}
