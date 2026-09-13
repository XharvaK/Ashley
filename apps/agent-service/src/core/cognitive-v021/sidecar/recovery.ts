import type { DatabaseSync } from "node:sqlite";
import { appendInboxEventInTransaction } from "../cycle/inbox.js";
import { recoverInFlight } from "../effect/recovery.js";
import { recoverDurableWork } from "../retry/ledger.js";
import { recoverWakes } from "../wake/ledger.js";
import { recoverPrivateBudget } from "../private-budget/recovery.js";
import { listEligiblePendingSpeechOutbox } from "../speech/outbox.js";

export type CognitiveSidecarRecoveryResult = {
  inboxClaimsRecovered: number;
  speechProjectionsRequeued: number;
  noticeProjectionsRequeued: number;
};

export type PendingSpeechOutboxRecoveryResult = {
  reconsidered: number;
  failures: number;
};

export type SpeechOutboxRecoveryProjector = (outboxId: number) => Promise<void> | void;

/**
 * Reconsider committed live speech that was still pending when a process
 * stopped between publication commit and its projectOutbox callback.
 *
 * This function only dispatches durable outbox IDs to the existing projector.
 * It never runs Thought again, manufactures a new settlement, or bypasses
 * projector gates. A projector failure leaves the source row recoverable for
 * the next bounded startup pass (pending rows remain pending; orphaned
 * projecting rows are requeued by recoverCognitiveSidecar).
 */
export async function reconsiderPendingSpeechOutbox(
  db: DatabaseSync,
  project: SpeechOutboxRecoveryProjector,
  options: { limit?: number } = {},
): Promise<PendingSpeechOutboxRecoveryResult> {
  const rows = listEligiblePendingSpeechOutbox(db, options);
  let failures = 0;
  for (const row of rows) {
    try {
      await project(row.outboxId);
    } catch {
      failures += 1;
    }
  }
  return { reconsidered: rows.length, failures };
}

/** Reopen-time recovery preserves dispatch truth before any work can be claimed again. */
export function recoverCognitiveSidecar(
  db: DatabaseSync,
  nowMs = Date.now(),
): CognitiveSidecarRecoveryResult {
  const result: CognitiveSidecarRecoveryResult = {
    inboxClaimsRecovered: 0,
    speechProjectionsRequeued: 0,
    noticeProjectionsRequeued: 0,
  };
  const recoveredEffects = recoverInFlight(db, nowMs);
  // Recover wake state before the transaction that emits reference-only
  // recovery inbox events. Each wake recovery is its own immediate CAS.
  recoverWakes(db, nowMs);
  const recoveredDurableWork = recoverDurableWork(db, nowMs);
  recoverPrivateBudget(db, { wallClockNowMs: nowMs });
  result.inboxClaimsRecovered = recoveredDurableWork.reclaimed
    + recoveredDurableWork.reconciling
    + recoveredDurableWork.quarantined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const speech = db.prepare(
      `UPDATE speech_outbox
          SET send_status = 'pending', suppressed = 0
        WHERE send_status = 'projecting' AND origin = 'live'
          AND nuclear_reservation_id IS NULL`,
    ).run();
    result.speechProjectionsRequeued = Number(speech.changes);

    const notices = db.prepare(
      `UPDATE system_notice_outbox
          SET send_status = 'pending'
        WHERE send_status = 'projecting' AND origin = 'live'
          AND nuclear_reservation_id IS NULL`,
    ).run();
    result.noticeProjectionsRequeued = Number(notices.changes);

    // An external effect may have crossed its process boundary before the
    // crash. Mark it unknown and leave a durable, reference-only recovery
    // event for Thought. The deterministic event id makes reopen idempotent;
    // the effect is never redispatched merely because the process restarted.
    for (const effect of recoveredEffects) {
      if (effect.status !== "unknown") continue;
      const cycle = db.prepare(
        "SELECT conversation_id FROM cycle_records WHERE cycle_id = ? LIMIT 1",
      ).get(effect.cycleId) as { conversation_id?: unknown } | undefined;
      if (typeof cycle?.conversation_id !== "string" || !cycle.conversation_id) continue;
      appendInboxEventInTransaction(db, {
        id: `recovery:${effect.effectId}`,
        conversationId: cycle.conversation_id,
        kind: "recovery",
        payload: {
          cycleId: effect.cycleId,
          generation: effect.generation,
          triggerRef: effect.effectId,
          effectId: effect.effectId,
          recoveryEffectId: effect.effectId,
          correlationId: effect.correlationId,
          idempotencyKey: effect.idempotencyKey,
        },
        createdAtMs: nowMs,
      }, `recovery:${effect.effectId}`);
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}
