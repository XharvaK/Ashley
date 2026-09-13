import type { DatabaseSync } from "node:sqlite";

export const MIGRATION_35_DELIVERY_LANE_DDL = `
ALTER TABLE delivery_reservations ADD COLUMN delivery_lane TEXT NOT NULL DEFAULT 'reactive';

CREATE INDEX IF NOT EXISTS idx_delivery_reservations_lane
  ON delivery_reservations (owner_id, delivery_lane, state, id);
`;

export function ensureNuclearV35Schema(db: DatabaseSync): void {
  const columns = db
    .prepare(`PRAGMA table_info(delivery_reservations)`)
    .all() as Array<{ name?: string }>;
  const hasDeliveryLane = columns.some((c) => c.name === "delivery_lane");
  if (!hasDeliveryLane) {
    db.exec(
      `ALTER TABLE delivery_reservations ADD COLUMN delivery_lane TEXT NOT NULL DEFAULT 'reactive';`,
    );
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_delivery_reservations_lane
       ON delivery_reservations (owner_id, delivery_lane, state, id);`,
  );

  // Deterministic historical backfill:
  // Identify operational completions that were previously routed through proactive initiative reservations
  // and update their delivery_lane to 'operational_fulfillment'.
  const hasOperationalJobDeliveries = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operational_job_deliveries'`,
    )
    .get();

  if (hasOperationalJobDeliveries) {
    db.exec(`
      UPDATE delivery_reservations
      SET delivery_lane = 'operational_fulfillment'
      WHERE id IN (
        SELECT delivery_reservation_id
        FROM operational_job_deliveries
        WHERE delivery_reservation_id > 0
      );
    `);
  }
}
