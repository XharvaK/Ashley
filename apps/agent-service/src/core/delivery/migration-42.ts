import type { DatabaseSync } from "node:sqlite";

/** Additive nuclear bridge identity for Cognitive Architecture v0.2.1. */
export const MIGRATION_42_COGNITIVE_PROJECTION_KEY_DDL = `
ALTER TABLE delivery_reservations ADD COLUMN cognitive_v021_projection_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_reservations_v021_projection_key
  ON delivery_reservations(cognitive_v021_projection_key)
  WHERE cognitive_v021_projection_key IS NOT NULL;
`;

function hasColumn(db: DatabaseSync, name: string): boolean {
  return (db.prepare("PRAGMA table_info(delivery_reservations)").all() as Array<{ name?: string }>)
    .some((row) => row.name === name);
}

export function ensureNuclearV42Schema(db: DatabaseSync): void {
  if (!hasColumn(db, "cognitive_v021_projection_key")) {
    db.exec("ALTER TABLE delivery_reservations ADD COLUMN cognitive_v021_projection_key TEXT");
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS delivery_reservations_v021_projection_key
      ON delivery_reservations(cognitive_v021_projection_key)
      WHERE cognitive_v021_projection_key IS NOT NULL;
  `);
}

export function validateNuclearV42Schema(db: DatabaseSync, version = 42): void {
  if (!hasColumn(db, "cognitive_v021_projection_key")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:delivery_reservations.cognitive_v021_projection_key`);
  }
  const index = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'delivery_reservations_v021_projection_key'",
  ).get();
  if (!index) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_index:delivery_reservations_v021_projection_key`);
  }
}
