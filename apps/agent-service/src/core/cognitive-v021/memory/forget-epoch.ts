import type { DatabaseSync } from "node:sqlite";

/**
 * R2 forget epoch (sidecar schema v41). Every erase bumps it inside its own
 * transaction. A Thought captures it with its source witness; publication
 * refuses a settlement whose epoch is stale, so work already in flight can
 * never republish what a forget removed (Stewardship Compact SC-FGT-03).
 */

export function readForgetEpoch(db: DatabaseSync): number {
  const row = db.prepare("SELECT epoch FROM forget_epoch WHERE id = 1").get() as { epoch?: number } | undefined;
  return Number(row?.epoch ?? 0);
}

/** Call only inside the transaction that performs the erase. */
export function bumpForgetEpoch(db: DatabaseSync, nowMs: number): void {
  db.prepare(
    `INSERT INTO forget_epoch (id, epoch, updated_at_ms) VALUES (1, 1, ?)
     ON CONFLICT(id) DO UPDATE SET epoch = epoch + 1, updated_at_ms = excluded.updated_at_ms`,
  ).run(nowMs);
}
