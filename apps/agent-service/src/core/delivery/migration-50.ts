import type { DatabaseSync } from "node:sqlite";

export const V50_TABLE_COLUMNS = {
  delivery_reservations: ["dispatch_started_at"],
} as const;

export const MIGRATION_50_NUCLEAR_DDL = `
ALTER TABLE delivery_reservations ADD COLUMN dispatch_started_at TEXT;
`;

type TableName = keyof typeof V50_TABLE_COLUMNS;

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .some((row) => row.name === column);
}

const COLUMN_DEFINITIONS: Record<string, string> = {
  dispatch_started_at: "TEXT",
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
export function ensureNuclearV50Schema(db: DatabaseSync): void {
  for (const [table, columns] of Object.entries(V50_TABLE_COLUMNS) as Array<[TableName, readonly string[]]>) {
    for (const column of columns) addColumnIfMissing(db, table, column);
  }
}

export function validateNuclearV50Schema(db: DatabaseSync, version = 50): void {
  for (const [table, columns] of Object.entries(V50_TABLE_COLUMNS)) {
    for (const column of columns) {
      if (!hasColumn(db, table, column)) {
        throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:${table}.${column}`);
      }
    }
  }
}
