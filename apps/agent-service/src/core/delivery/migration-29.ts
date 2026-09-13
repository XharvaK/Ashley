import type { DatabaseSync } from "node:sqlite";

/** Nuclear schema v29 — delivery-owned bounded cross-phase lifecycle summary. */
export const MIGRATION_29_PHASE_LIFECYCLE_DDL = `
ALTER TABLE delivery_reservations
  ADD COLUMN phase_lifecycle_json TEXT;
`;

/** Recovery-safe form used when a fixture or interrupted migration already has the column. */
export function ensureNuclearV29Schema(db: DatabaseSync): void {
  const columns = db
    .prepare("PRAGMA table_info(delivery_reservations)")
    .all() as Array<{ name?: string }>;
  if (!columns.some((column) => column.name === "phase_lifecycle_json")) {
    db.exec(MIGRATION_29_PHASE_LIFECYCLE_DDL);
  }
}
