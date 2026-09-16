import type { DatabaseSync } from "node:sqlite";

export const V48_TABLE_COLUMNS = {
  delivery_reservations: [
    "commitment_id",
    "commitment_occurrence_id",
    "commitment_attempt_id",
    "speech_outbox_id",
  ],
} as const;

export const MIGRATION_48_NUCLEAR_DDL = `
ALTER TABLE delivery_reservations ADD COLUMN commitment_id TEXT;
ALTER TABLE delivery_reservations ADD COLUMN commitment_occurrence_id TEXT;
ALTER TABLE delivery_reservations ADD COLUMN commitment_attempt_id TEXT;
ALTER TABLE delivery_reservations ADD COLUMN speech_outbox_id INTEGER;
`;

type TableName = keyof typeof V48_TABLE_COLUMNS;

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .some((row) => row.name === column);
}

const COLUMN_DEFINITIONS: Record<string, string> = {
  commitment_id: "TEXT",
  commitment_occurrence_id: "TEXT",
  commitment_attempt_id: "TEXT",
  speech_outbox_id: "INTEGER",
};

function addColumnIfMissing(
  db: DatabaseSync,
  table: TableName,
  column: string,
): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${COLUMN_DEFINITIONS[column]}`);
  }
}

/** Idempotent additive installer used by the nuclear migration protocol and fixtures. */
export function ensureNuclearV48Schema(db: DatabaseSync): void {
  for (const [table, columns] of Object.entries(V48_TABLE_COLUMNS) as Array<[TableName, readonly string[]]>) {
    for (const column of columns) addColumnIfMissing(db, table, column);
  }
}

export function validateNuclearV48Schema(db: DatabaseSync, version = 48): void {
  for (const [table, columns] of Object.entries(V48_TABLE_COLUMNS)) {
    for (const column of columns) {
      if (!hasColumn(db, table, column)) {
        throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:${table}.${column}`);
      }
    }
  }
}
