import type { DatabaseSync } from "node:sqlite";

export const SOCIAL_OPERATION_DELEGATION_CLASSES = [
  "public_search",
  "public_fetch",
  "supplied_attachment",
  "bounded_followup",
] as const;

export type SocialOperationDelegationClass = typeof SOCIAL_OPERATION_DELEGATION_CLASSES[number];

export const SOCIAL_OPERATION_DELEGATION_TABLES = [
  "social_operation_delegations",
] as const;

export const SOCIAL_OPERATION_DELEGATION_INDEXES = [
  "idx_social_operation_delegations_live",
  "idx_social_operation_delegations_lookup",
] as const;

export const MIGRATION_53_SOCIAL_OPERATION_DELEGATION_DDL = `
CREATE TABLE IF NOT EXISTS social_operation_delegations (
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  operation_class TEXT NOT NULL CHECK(operation_class IN ('public_search','public_fetch','supplied_attachment','bounded_followup')),
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  source_span_json TEXT NOT NULL CHECK(json_valid(source_span_json))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_operation_delegations_live
  ON social_operation_delegations(principal_id, conversation_id, operation_class)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_operation_delegations_lookup
  ON social_operation_delegations(principal_id, conversation_id, revoked_at, expires_at);
`;

const TABLE_COLUMNS = [
  "entity_uuid",
  "owner_id",
  "principal_id",
  "conversation_id",
  "operation_class",
  "granted_at",
  "expires_at",
  "revoked_at",
  "version",
  "source_span_json",
] as const;

type MasterRow = { type?: unknown; name?: unknown; sql?: unknown };

function masterRow(db: DatabaseSync, type: string, name: string): MasterRow | undefined {
  return db.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE type = ? AND name = ?",
  ).get(type, name) as MasterRow | undefined;
}

function tableColumns(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("PRAGMA table_info(social_operation_delegations)").all() as Array<{ name?: unknown }>)
    .map((row) => String(row.name ?? "")));
}

function validateIndex(
  db: DatabaseSync,
  name: string,
  columns: readonly string[],
  version: number,
  predicate?: string,
): void {
  if (!masterRow(db, "index", name)) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_index:${name}`);
  }
  const actual = (db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name?: unknown; seqno?: unknown }>)
    .sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
    .map((row) => String(row.name ?? ""));
  if (actual.join(",") !== columns.join(",")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:index_columns:${name}`);
  }
  const sql = String(masterRow(db, "index", name)?.sql ?? "").toLowerCase();
  if (predicate && !sql.includes(predicate.toLowerCase())) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:index_predicate:${name}`);
  }
}

export function ensureNuclearV53Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_53_SOCIAL_OPERATION_DELEGATION_DDL);
}

export function validateNuclearV53Schema(db: DatabaseSync, version = 53): void {
  if (!masterRow(db, "table", "social_operation_delegations")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_table:social_operation_delegations`);
  }
  const columns = tableColumns(db);
  for (const column of TABLE_COLUMNS) {
    if (!columns.has(column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:social_operation_delegations.${column}`);
    }
  }
  const tableSql = String(masterRow(db, "table", "social_operation_delegations")?.sql ?? "").toLowerCase();
  for (const value of SOCIAL_OPERATION_DELEGATION_CLASSES) {
    if (!tableSql.includes(`'${value}'`)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:operation_class_value:${value}`);
    }
  }
  if (!tableSql.includes("check(json_valid(source_span_json))")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:source_span_contract`);
  }
  validateIndex(
    db,
    "idx_social_operation_delegations_live",
    ["principal_id", "conversation_id", "operation_class"],
    version,
    "where revoked_at is null",
  );
  validateIndex(
    db,
    "idx_social_operation_delegations_lookup",
    ["principal_id", "conversation_id", "revoked_at", "expires_at"],
    version,
  );
}

export function requireNoNuclearV53Content(db: DatabaseSync, version = 52): void {
  if (masterRow(db, "table", "social_operation_delegations")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:unexpected_table:social_operation_delegations`);
  }
  for (const index of SOCIAL_OPERATION_DELEGATION_INDEXES) {
    if (masterRow(db, "index", index)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:unexpected_index:${index}`);
    }
  }
}
