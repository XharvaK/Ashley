import type { DatabaseSync } from "node:sqlite";
import { setDecisionOutcome } from "../agency/log.js";
import { applyRelationshipDeliveryOutcome } from "../relationship/delivery-outcomes.js";
import { insertMessage } from "../memory/threads.js";
import { patchState } from "../state/store.js";
import {
  getDeliveryReservation,
  listDeliveryBubbles,
} from "./store.js";
import {
  isTerminalDeliveryState,
  type DeliveryFinalizationReason,
  type DeliveryState,
} from "./types.js";
import { recordPhaseLifecycle } from "./phase-lifecycle.js";

export type FinalizeCause =
  | "complete"
  | "cancel"
  | "generation_error"
  | "empty_draft"
  | "send_failure"
  | "first_bubble_deadline"
  | "generation_lease"
  | "delivery_lease";

export type FinalizeDeliveryInput = {
  reservationId: number;
  ownerId: string;
  cause: FinalizeCause;
  errorCategory?: string | null;
  /** When true, keep availability quiet if own-time session is open (caller decides). */
  ownTimeOpen?: boolean;
  /** Optional archival logger callback for receipt-backed assistant text only. */
  onArchivalAssistant?: (text: string) => void;
};

export type FinalizeDeliveryResult = {
  state: DeliveryState;
  finalizationReason: DeliveryFinalizationReason;
  deliveredText: string;
  receiptCount: number;
  plannedCount: number;
};

function reasonFor(
  cause: FinalizeCause,
  receiptCount: number,
  plannedCount: number,
): { state: DeliveryState; reason: DeliveryFinalizationReason } {
  if (receiptCount > 0 && plannedCount > 0 && receiptCount >= plannedCount) {
    return { state: "committed", reason: "all_bubbles_delivered" };
  }
  if (receiptCount > 0) {
    switch (cause) {
      case "cancel":
        return {
          state: "partially_delivered",
          reason: "cancelled_after_partial",
        };
      case "send_failure":
        return {
          state: "partially_delivered",
          reason: "send_failure_after_partial",
        };
      case "delivery_lease":
        return {
          state: "partially_delivered",
          reason: "delivery_lease_expired_after_partial",
        };
      case "complete":
      case "generation_error":
      case "empty_draft":
      case "first_bubble_deadline":
      case "generation_lease":
        return {
          state: "partially_delivered",
          reason: "send_failure_after_partial",
        };
      default: {
        const _exhaustive: never = cause;
        return _exhaustive;
      }
    }
  }

  switch (cause) {
    case "cancel":
      return { state: "cancelled", reason: "cancelled" };
    case "generation_error":
      return { state: "aborted", reason: "generation_error" };
    case "empty_draft":
      return { state: "aborted", reason: "empty_draft" };
    case "send_failure":
      return { state: "aborted", reason: "send_failure" };
    case "first_bubble_deadline":
      return { state: "expired", reason: "first_bubble_deadline_expired" };
    case "generation_lease":
      return { state: "expired", reason: "generation_lease_expired" };
    case "delivery_lease":
      return { state: "expired", reason: "delivery_lease_expired" };
    case "complete":
      if (plannedCount > 0) {
        return { state: "expired", reason: "delivery_lease_expired" };
      }
      return { state: "aborted", reason: "empty_draft" };
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

/**
 * Centralized delivery finalizer. Persists only receipt-backed prefix text.
 * Zero receipts → cancelled | aborted | expired. Partial → partially_delivered.
 */
export function finalizeDelivery(
  db: DatabaseSync,
  input: FinalizeDeliveryInput,
): FinalizeDeliveryResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const reservation = getDeliveryReservation(db, input.reservationId);
    if (!reservation || reservation.ownerId !== input.ownerId) {
      db.exec("ROLLBACK");
      throw new Error("delivery_reservation_missing");
    }
    if (isTerminalDeliveryState(reservation.state)) {
      const bubbles = listDeliveryBubbles(db, input.reservationId);
      const receiptCount = bubbles.filter((b) => b.discordMessageId).length;
      const deliveredText = bubbles
        .filter((b) => b.discordMessageId)
        .map((b) => b.text)
        .join("\n\n");
      db.exec("COMMIT");
      return {
        state: reservation.state,
        finalizationReason: (reservation.finalizationReason ??
          "all_bubbles_delivered") as DeliveryFinalizationReason,
        deliveredText,
        receiptCount,
        plannedCount: bubbles.length,
      };
    }

    const bubbles = listDeliveryBubbles(db, input.reservationId);
    const receipted = bubbles.filter((b) => b.discordMessageId);
    const receiptCount = receipted.length;
    const plannedCount = bubbles.length;
    const { state, reason } = reasonFor(
      input.cause,
      receiptCount,
      plannedCount,
    );
    const deliveredText = receipted.map((b) => b.text).join("\n\n").trim();
    const nowIso = new Date().toISOString();

    db.prepare(
      `UPDATE delivery_reservations
       SET state = ?, error_category = ?, finalization_reason = ?, finalized_at = ?
       WHERE id = ?`,
    ).run(
      state,
      input.errorCategory ?? input.cause,
      reason,
      nowIso,
      input.reservationId,
    );

    if (deliveredText && reservation.threadId) {
      // Ensure thread exists for archival: weekly placeholder 'dm' may not be a real mem_threads row.
      const existingThread = db
        .prepare(`SELECT id FROM mem_threads WHERE id = ?`)
        .get(reservation.threadId) as { id?: unknown } | undefined;
      if (!existingThread) {
        const nowIsoThread = new Date().toISOString();
        db.prepare(
          `INSERT OR IGNORE INTO mem_threads (id, owner_id, status, channel, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)`,
        ).run(
          reservation.threadId,
          input.ownerId,
          reservation.channel === "discord" ? "discord" : "discord",
          nowIsoThread,
          nowIsoThread,
        );
      }
      const assistantMessageId = insertMessage(db, {
        threadId: reservation.threadId,
        ownerId: input.ownerId,
        role: "assistant",
        text: deliveredText,
        channel: reservation.channel === "discord" ? "discord" : "discord",
      });
    }

    if (reservation.decisionId != null) {
      setDecisionOutcome(db, reservation.decisionId, deliveredText);
      applyRelationshipDeliveryOutcome(db, {
        ownerId: input.ownerId,
        decisionId: reservation.decisionId,
        cause: input.cause,
        state,
        receiptCount,
        deliveryReceiptId: receipted[0]?.discordMessageId ?? null,
      });
    }

    if (reservation.deliveryLane === "proactive" && receiptCount > 0) {
      const initiativeId = reservation.initiativeReservationId;
      if (initiativeId != null) {
        const firstDiscordId = receipted[0]?.discordMessageId ?? null;
        db.prepare(
          `UPDATE initiative_reservations
           SET discord_message_id = COALESCE(discord_message_id, ?),
               committed_at = COALESCE(committed_at, ?)
           WHERE id = ? AND owner_id = ? AND committed_at IS NULL`,
        ).run(firstDiscordId, nowIso, initiativeId, input.ownerId);
      }
    }

    if (reservation.deliveryLane === "proactive" && receiptCount === 0) {
      const initiativeId = reservation.initiativeReservationId;
      if (initiativeId != null) {
        db.prepare(
          `DELETE FROM initiative_reservations
           WHERE id = ? AND owner_id = ? AND committed_at IS NULL`,
        ).run(initiativeId, input.ownerId);
      }
    }

    if (reservation.phaseLifecycle) {
      recordPhaseLifecycle(db, {
        reservationId: input.reservationId,
        phase: "delivery",
        event: state === "committed" ? "succeeded" : "failed",
        atMs: Date.now(),
        statusCode: reason,
      });
    }

    db.exec("COMMIT");

    if (!input.ownTimeOpen && receiptCount > 0) {
      patchState(db, input.ownerId, { availability: "available" });
    }

    if (deliveredText && input.onArchivalAssistant) {
      input.onArchivalAssistant(deliveredText);
    }

    return {
      state,
      finalizationReason: reason,
      deliveredText,
      receiptCount,
      plannedCount,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw error;
  }
}

export function expireStaleDraftedReservations(
  db: DatabaseSync,
  nowMs = Date.now(),
): number {
  const nowIso = new Date(nowMs).toISOString();
  const rows = db
    .prepare(
      `SELECT id, owner_id, generation_lease_expires_at, first_bubble_deadline_at
       FROM delivery_reservations
       WHERE state = 'drafted'`,
    )
    .all();
  let count = 0;
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const lease = r.generation_lease_expires_at;
    const deadline = r.first_bubble_deadline_at;
    const leaseExpired =
      typeof lease === "string" && lease <= nowIso;
    const deadlineExpired =
      typeof deadline === "string" && deadline <= nowIso;
    if (!leaseExpired && !deadlineExpired) continue;
    finalizeDelivery(db, {
      reservationId: Number(r.id),
      ownerId: String(r.owner_id),
      cause: deadlineExpired ? "first_bubble_deadline" : "generation_lease",
    });
    count += 1;
  }
  return count;
}
