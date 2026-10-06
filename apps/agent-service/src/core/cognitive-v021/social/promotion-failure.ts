// AG0 (live 2026-10-06: one room marker whose promotion kept failing stopped every inner-life pass
// for as long as it stayed pending): a marker that fails to promote is retried a few times, then
// quarantined with its error. It never holds up anything else.
import type { DatabaseSync } from "node:sqlite";

/** Failed promotions before a marker is quarantined. */
export const PROMOTION_ATTEMPTS = 3;

/** Count one failed promotion of a pending marker; quarantine it once it has failed PROMOTION_ATTEMPTS times. */
export function recordPromotionFailure(sidecar: DatabaseSync, markerId: string, error: unknown, nowMs: number): "retry" | "quarantined" {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 300) || "promotion_failed";
  sidecar.prepare(
    `UPDATE inbox_events SET attempt_count = attempt_count + 1, last_error = ?
      WHERE id = ? AND kind = 'external_eligible_pending' AND state = 'pending' AND status = 'pending'`,
  ).run(message, markerId);
  const quarantined = Number(sidecar.prepare(
    `UPDATE inbox_events
        SET state = 'quarantined', status = 'failed_terminal', terminal_reason = 'permanent_failure',
            quarantine_reason = 'promotion_failed', consumed_at_ms = ?, claim_token = NULL, worker_id = NULL,
            lease_expires_at_ms = NULL, next_eligible_at_ms = NULL
      WHERE id = ? AND kind = 'external_eligible_pending' AND state = 'pending' AND status = 'pending' AND attempt_count >= ?`,
  ).run(nowMs, markerId, PROMOTION_ATTEMPTS).changes ?? 0);
  if (quarantined > 0) console.warn(`[cognitive-v021] social marker quarantined after ${PROMOTION_ATTEMPTS} failed promotions: ${message}`);
  return quarantined > 0 ? "quarantined" : "retry";
}
