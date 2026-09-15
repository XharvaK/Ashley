import type { DatabaseSync } from "node:sqlite";

export const V47_TABLE_COLUMNS = {
  memory_assertions: [
    "speaker_principal",
    "audience_scope",
    "source_evidence_ref",
    "protection_subjects_json",
    "protection_basis_refs_json",
    "protection_status",
  ],
  delivery_reservations: [
    "destination_json",
    "attempt_input_basis_json",
    "hard_dependency_bundle_json",
    "license_refs_json",
  ],
  doc_reminders: [
    "beneficiary_principal",
    "destination_json",
    "fire_at_ms",
    "lease_token",
    "lease_expires_at_ms",
    "attempt_count",
    "commitment_state",
  ],
  ashley_self_commitments: [
    "beneficiary_principal",
    "destination_json",
    "fire_at_ms",
    "lease_token",
    "lease_expires_at_ms",
    "attempt_count",
    "commitment_state",
  ],
  mutual_commitments: [
    "beneficiary_principal",
    "destination_json",
    "fire_at_ms",
    "lease_token",
    "lease_expires_at_ms",
    "attempt_count",
    "commitment_state",
  ],
} as const;

export const V47_TABLES = [
  "memory_assertions",
  "delivery_reservations",
  "doc_reminders",
  "ashley_self_commitments",
  "mutual_commitments",
  "commitment_settlements",
] as const;

export const MIGRATION_47_NUCLEAR_DDL = `
ALTER TABLE memory_assertions ADD COLUMN speaker_principal TEXT;
ALTER TABLE memory_assertions ADD COLUMN audience_scope TEXT;
ALTER TABLE memory_assertions ADD COLUMN source_evidence_ref TEXT;
ALTER TABLE memory_assertions ADD COLUMN protection_subjects_json TEXT CHECK(protection_subjects_json IS NULL OR json_valid(protection_subjects_json));
ALTER TABLE memory_assertions ADD COLUMN protection_basis_refs_json TEXT CHECK(protection_basis_refs_json IS NULL OR json_valid(protection_basis_refs_json));
ALTER TABLE memory_assertions ADD COLUMN protection_status TEXT CHECK(protection_status IS NULL OR protection_status IN ('admitted','unresolved'));

ALTER TABLE delivery_reservations ADD COLUMN destination_json TEXT CHECK(destination_json IS NULL OR json_valid(destination_json));
ALTER TABLE delivery_reservations ADD COLUMN attempt_input_basis_json TEXT CHECK(attempt_input_basis_json IS NULL OR json_valid(attempt_input_basis_json));
ALTER TABLE delivery_reservations ADD COLUMN hard_dependency_bundle_json TEXT CHECK(hard_dependency_bundle_json IS NULL OR json_valid(hard_dependency_bundle_json));
ALTER TABLE delivery_reservations ADD COLUMN license_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(license_refs_json));

ALTER TABLE doc_reminders ADD COLUMN beneficiary_principal TEXT;
ALTER TABLE doc_reminders ADD COLUMN destination_json TEXT CHECK(destination_json IS NULL OR json_valid(destination_json));
ALTER TABLE doc_reminders ADD COLUMN fire_at_ms INTEGER;
ALTER TABLE doc_reminders ADD COLUMN lease_token TEXT;
ALTER TABLE doc_reminders ADD COLUMN lease_expires_at_ms INTEGER;
ALTER TABLE doc_reminders ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doc_reminders ADD COLUMN commitment_state TEXT;

ALTER TABLE ashley_self_commitments ADD COLUMN beneficiary_principal TEXT;
ALTER TABLE ashley_self_commitments ADD COLUMN destination_json TEXT CHECK(destination_json IS NULL OR json_valid(destination_json));
ALTER TABLE ashley_self_commitments ADD COLUMN fire_at_ms INTEGER;
ALTER TABLE ashley_self_commitments ADD COLUMN lease_token TEXT;
ALTER TABLE ashley_self_commitments ADD COLUMN lease_expires_at_ms INTEGER;
ALTER TABLE ashley_self_commitments ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ashley_self_commitments ADD COLUMN commitment_state TEXT;

ALTER TABLE mutual_commitments ADD COLUMN beneficiary_principal TEXT;
ALTER TABLE mutual_commitments ADD COLUMN destination_json TEXT CHECK(destination_json IS NULL OR json_valid(destination_json));
ALTER TABLE mutual_commitments ADD COLUMN fire_at_ms INTEGER;
ALTER TABLE mutual_commitments ADD COLUMN lease_token TEXT;
ALTER TABLE mutual_commitments ADD COLUMN lease_expires_at_ms INTEGER;
ALTER TABLE mutual_commitments ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mutual_commitments ADD COLUMN commitment_state TEXT;

CREATE TABLE IF NOT EXISTS commitment_settlements (
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

type TableName = keyof typeof V47_TABLE_COLUMNS;

function hasTable(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .some((row) => row.name === column);
}

function addColumnIfMissing(
  db: DatabaseSync,
  table: TableName,
  column: string,
  definition: string,
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const COLUMN_DEFINITIONS: Record<string, string> = {
  speaker_principal: "TEXT",
  audience_scope: "TEXT",
  source_evidence_ref: "TEXT",
  protection_subjects_json: "TEXT CHECK(protection_subjects_json IS NULL OR json_valid(protection_subjects_json))",
  protection_basis_refs_json: "TEXT CHECK(protection_basis_refs_json IS NULL OR json_valid(protection_basis_refs_json))",
  protection_status: "TEXT CHECK(protection_status IS NULL OR protection_status IN ('admitted','unresolved'))",
  destination_json: "TEXT CHECK(destination_json IS NULL OR json_valid(destination_json))",
  attempt_input_basis_json: "TEXT CHECK(attempt_input_basis_json IS NULL OR json_valid(attempt_input_basis_json))",
  hard_dependency_bundle_json: "TEXT CHECK(hard_dependency_bundle_json IS NULL OR json_valid(hard_dependency_bundle_json))",
  license_refs_json: "TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(license_refs_json))",
  beneficiary_principal: "TEXT",
  fire_at_ms: "INTEGER",
  lease_token: "TEXT",
  lease_expires_at_ms: "INTEGER",
  attempt_count: "INTEGER NOT NULL DEFAULT 0",
  commitment_state: "TEXT",
};

/** Idempotent additive installer used by the nuclear migration protocol and fixtures. */
export function ensureNuclearV47Schema(db: DatabaseSync): void {
  for (const [table, columns] of Object.entries(V47_TABLE_COLUMNS) as Array<[TableName, readonly string[]]>) {
    for (const column of columns) {
      addColumnIfMissing(db, table, column, COLUMN_DEFINITIONS[column]);
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS commitment_settlements (
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
  `);
}

function requireColumns(db: DatabaseSync, table: string, columns: readonly string[], version: number): void {
  if (!hasTable(db, table)) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_table:${table}`);
  }
  const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .map((row) => String(row.name ?? "")));
  for (const column of columns) {
    if (!actual.has(column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:${table}.${column}`);
    }
  }
}

function requireSqlFragment(db: DatabaseSync, table: string, fragment: string, version: number): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: unknown } | undefined;
  if (!String(row?.sql ?? "").toLowerCase().replace(/\s+/g, "").includes(fragment.toLowerCase().replace(/\s+/g, ""))) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:table_constraint:${table}`);
  }
}

function requireColumnDefault(
  db: DatabaseSync,
  table: string,
  column: string,
  version: number,
  expectedNotNull: number,
  expectedDefault: string,
): void {
  const row = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name?: unknown;
    notnull?: unknown;
    dflt_value?: unknown;
  }>;
  const columnRow = row.find((item) => item.name === column);
  if (!columnRow || Number(columnRow.notnull) !== expectedNotNull || String(columnRow.dflt_value) !== expectedDefault) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:column_default:${table}.${column}`);
  }
}

export function validateNuclearV47Schema(db: DatabaseSync, version = 47): void {
  for (const [table, columns] of Object.entries(V47_TABLE_COLUMNS)) {
    requireColumns(db, table, columns, version);
  }
  requireColumns(db, "commitment_settlements", [
    "proposal_id", "source_ref", "ordinal", "proposal_json", "result_json",
    "created_at_ms", "settled_at_ms",
  ], version);
  requireSqlFragment(db, "memory_assertions", "protection_status IS NULL OR protection_status IN ('admitted','unresolved')", version);
  requireSqlFragment(db, "commitment_settlements", "UNIQUE(source_ref, ordinal)", version);
  requireColumnDefault(db, "delivery_reservations", "license_refs_json", version, 1, "'[]'");
  for (const table of ["doc_reminders", "ashley_self_commitments", "mutual_commitments"]) {
    requireColumnDefault(db, table, "attempt_count", version, 1, "0");
  }
}
