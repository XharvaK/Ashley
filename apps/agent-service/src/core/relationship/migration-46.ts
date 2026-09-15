import type { DatabaseSync } from "node:sqlite";

export const SOCIAL_AUTHORITY_TABLES = [
  "social_permits",
  "owner_prohibitions",
  "trusted_rooms",
  "recipient_restrictions",
  "ashley_boundaries",
  "disclosure_licenses",
  "control_settlements",
] as const;

export const SOCIAL_AUTHORITY_INDEXES = [
  "idx_social_permits_live",
  "idx_social_permits_principal",
  "idx_owner_prohibitions_principal",
  "idx_owner_prohibitions_room",
  "idx_trusted_rooms_lookup",
  "idx_recipient_restrictions_live",
  "idx_recipient_restrictions_principal",
  "idx_ashley_boundaries_target",
  "idx_disclosure_licenses_source",
] as const;

export const MIGRATION_46_SOCIAL_AUTHORITY_DDL = `
CREATE TABLE IF NOT EXISTS social_permits (
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('person_wide','dm_only','room_only')),
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  source_span_json TEXT NOT NULL CHECK(json_valid(source_span_json)),
  proposal_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_permits_live
  ON social_permits(principal_id, scope)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_permits_principal
  ON social_permits(principal_id, revoked_at);

CREATE TABLE IF NOT EXISTS owner_prohibitions (
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  target_principal_id TEXT,
  target_room_id TEXT,
  scope TEXT NOT NULL,
  hard_stop INTEGER NOT NULL DEFAULT 0 CHECK(hard_stop IN (0, 1)),
  created_at TEXT NOT NULL,
  source_span_json TEXT NOT NULL CHECK(json_valid(source_span_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  cleared_at TEXT,
  CHECK(target_principal_id IS NOT NULL OR target_room_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_owner_prohibitions_principal
  ON owner_prohibitions(target_principal_id, cleared_at);
CREATE INDEX IF NOT EXISTS idx_owner_prohibitions_room
  ON owner_prohibitions(target_room_id, cleared_at);

CREATE TABLE IF NOT EXISTS trusted_rooms (
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('trusted_social','observe_only','disengaged')),
  provenance TEXT NOT NULL CHECK(provenance IN ('seeded_from_owner_config','owner_grant_nl','explicit_config')),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  source_span_json TEXT CHECK(source_span_json IS NULL OR json_valid(source_span_json)),
  UNIQUE(guild_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_trusted_rooms_lookup
  ON trusted_rooms(guild_id, channel_id, mode);

CREATE TABLE IF NOT EXISTS recipient_restrictions (
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('no_dm','no_initiation','room_only','do_not_contact')),
  set_at TEXT NOT NULL,
  source_message_ref TEXT NOT NULL,
  cleared_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipient_restrictions_live
  ON recipient_restrictions(principal_id, kind)
  WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recipient_restrictions_principal
  ON recipient_restrictions(principal_id, cleared_at);

CREATE TABLE IF NOT EXISTS ashley_boundaries (
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  target_principal_id TEXT,
  scope TEXT NOT NULL CHECK(scope IN ('no_initiation','no_dm','no_direct','no_contact')),
  decision_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  supersedes_ref TEXT,
  superseded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ashley_boundaries_target
  ON ashley_boundaries(target_principal_id, superseded_at);

CREATE TABLE IF NOT EXISTS disclosure_licenses (
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  material_hash TEXT NOT NULL,
  source_principal TEXT NOT NULL,
  controlled_protections_json TEXT NOT NULL CHECK(json_valid(controlled_protections_json)),
  grantee_audience_json TEXT NOT NULL CHECK(json_valid(grantee_audience_json)),
  uses_allowed INTEGER NOT NULL CHECK(uses_allowed >= 1),
  uses_consumed INTEGER NOT NULL DEFAULT 0 CHECK(uses_consumed >= 0),
  expires_at TEXT,
  grant_ref TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  revoked_at TEXT,
  CHECK(uses_consumed <= uses_allowed)
);
CREATE INDEX IF NOT EXISTS idx_disclosure_licenses_source
  ON disclosure_licenses(source_principal, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS control_settlements (
  proposal_id TEXT PRIMARY KEY,
  source_ref TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
  result_json TEXT CHECK(json_valid(result_json) OR result_json IS NULL),
  created_at_ms INTEGER NOT NULL,
  settled_at_ms INTEGER,
  CHECK((result_json IS NULL AND settled_at_ms IS NULL) OR
        (result_json IS NOT NULL AND settled_at_ms IS NOT NULL)),
  UNIQUE(source_ref, ordinal)
);
`;

const TABLE_COLUMNS: Record<string, readonly string[]> = {
  social_permits: [
    "entity_uuid", "owner_id", "principal_id", "scope", "granted_at", "expires_at",
    "source_span_json", "proposal_ref", "version", "revoked_at",
  ],
  owner_prohibitions: [
    "entity_uuid", "owner_id", "target_principal_id", "target_room_id", "scope",
    "hard_stop", "created_at", "source_span_json", "version", "cleared_at",
  ],
  trusted_rooms: [
    "entity_uuid", "owner_id", "guild_id", "channel_id", "mode", "provenance",
    "added_by", "added_at", "source_span_json",
  ],
  recipient_restrictions: [
    "entity_uuid", "owner_id", "principal_id", "kind", "set_at", "source_message_ref",
    "cleared_at",
  ],
  ashley_boundaries: [
    "entity_uuid", "owner_id", "target_principal_id", "scope", "decision_ref",
    "created_at", "supersedes_ref", "superseded_at",
  ],
  disclosure_licenses: [
    "entity_uuid", "owner_id", "material_hash", "source_principal", "controlled_protections_json",
    "grantee_audience_json", "uses_allowed", "uses_consumed", "expires_at", "grant_ref",
    "version", "revoked_at",
  ],
  control_settlements: [
    "proposal_id", "source_ref", "ordinal", "proposal_json", "result_json", "created_at_ms",
    "settled_at_ms",
  ],
};

function hasObject(db: DatabaseSync, type: "table" | "index", name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
  ).get(type, name));
}

function requireColumns(db: DatabaseSync, table: string, version: number): void {
  const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .map((column) => String(column.name ?? "")));
  for (const column of TABLE_COLUMNS[table] ?? []) {
    if (!actual.has(column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:${table}.${column}`);
    }
  }
}

function requireIndex(
  db: DatabaseSync,
  name: string,
  table: string,
  columns: readonly string[],
  version: number,
  sqlFragment?: string,
): void {
  if (!hasObject(db, "index", name)) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_index:${name}`);
  }
  const actual = (db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name?: unknown; seqno?: unknown }>)
    .sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
    .map((column) => String(column.name ?? ""));
  if (actual.join(",") !== columns.join(",")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:index_columns:${name}`);
  }
  const row = db.prepare(
    "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(name) as { tbl_name?: unknown; sql?: unknown } | undefined;
  if (row?.tbl_name !== table) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:index_table:${name}`);
  }
  if (sqlFragment && !String(row.sql ?? "").toLowerCase().includes(sqlFragment.toLowerCase())) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:index_predicate:${name}`);
  }
}

/** Idempotent schema installer used by the nuclear migration protocol and fixtures. */
export function ensureNuclearV46Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_46_SOCIAL_AUTHORITY_DDL);
}

export function validateNuclearV46Schema(db: DatabaseSync, version = 46): void {
  for (const table of SOCIAL_AUTHORITY_TABLES) {
    if (!hasObject(db, "table", table)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_table:${table}`);
    }
    requireColumns(db, table, version);
  }
  requireIndex(db, "idx_social_permits_live", "social_permits", ["principal_id", "scope"], version, "where revoked_at is null");
  requireIndex(db, "idx_social_permits_principal", "social_permits", ["principal_id", "revoked_at"], version);
  requireIndex(db, "idx_owner_prohibitions_principal", "owner_prohibitions", ["target_principal_id", "cleared_at"], version);
  requireIndex(db, "idx_owner_prohibitions_room", "owner_prohibitions", ["target_room_id", "cleared_at"], version);
  requireIndex(db, "idx_trusted_rooms_lookup", "trusted_rooms", ["guild_id", "channel_id", "mode"], version);
  requireIndex(db, "idx_recipient_restrictions_live", "recipient_restrictions", ["principal_id", "kind"], version, "where cleared_at is null");
  requireIndex(db, "idx_recipient_restrictions_principal", "recipient_restrictions", ["principal_id", "cleared_at"], version);
  requireIndex(db, "idx_ashley_boundaries_target", "ashley_boundaries", ["target_principal_id", "superseded_at"], version);
  requireIndex(db, "idx_disclosure_licenses_source", "disclosure_licenses", ["source_principal", "revoked_at", "expires_at"], version);
}
