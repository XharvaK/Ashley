import type { DatabaseSync } from "node:sqlite";
import { finalizeDelivery } from "../../delivery/finalize.js";
import {
  getDeliveryReservation,
  listDeliveryBubbles,
} from "../../delivery/store.js";
import { getRegisteredCognitiveSidecar } from "../speech/outbox.js";

export type PendingCognitiveDelivery = {
  reservationId: number;
  draftText: string;
  bubbles: ReturnType<typeof listDeliveryBubbles>;
  statusUrl: string;
  /** Destination binding is absent for legacy Owner-private rows. */
  destination?: unknown;
};

export const COGNITIVE_DELIVERY_LEASE_MS = 120_000;

function clampLeaseMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return COGNITIVE_DELIVERY_LEASE_MS;
  }
  if (value < 30_000) return 30_000;
  if (value > 600_000) return 600_000;
  return value;
}

function reservationId(row: unknown): number | null {
  if (typeof row !== "object" || row === null) return null;
  const value = Number((row as { id?: unknown }).id);
  return Number.isFinite(value) ? value : null;
}

function deliveryForState(
  db: DatabaseSync,
  id: number,
  expectedState: "reserved" | "sending",
): PendingCognitiveDelivery | null {
  const reservation = getDeliveryReservation(db, id);
  if (!reservation || reservation.state !== expectedState) return null;
  return {
    reservationId: id,
    draftText: reservation.draftText ?? "",
    bubbles: listDeliveryBubbles(db, id),
    statusUrl: `/delivery/${id}`,
    ...(reservation.destination === undefined ? {} : { destination: reservation.destination }),
  };
}

function speechOutboxStatus(
  sidecar: DatabaseSync,
  row: unknown,
): string | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as { speech_outbox_id?: unknown; cognitive_v021_projection_key?: unknown };
  const outboxId = Number(value.speech_outbox_id);
  if (Number.isSafeInteger(outboxId) && outboxId > 0) {
    const byId = sidecar.prepare(
      "SELECT send_status FROM speech_outbox WHERE outbox_id = ? LIMIT 1",
    ).get(outboxId) as { send_status?: unknown } | undefined;
    if (byId) return typeof byId.send_status === "string" ? byId.send_status : null;
  }
  const key = typeof value.cognitive_v021_projection_key === "string"
    ? value.cognitive_v021_projection_key
    : "";
  if (!key.startsWith("speech:")) return null;
  const byKey = sidecar.prepare(
    "SELECT send_status FROM speech_outbox WHERE projection_key = ? LIMIT 1",
  ).get(key) as { send_status?: unknown } | undefined;
  return byKey && typeof byKey.send_status === "string" ? byKey.send_status : null;
}

function speechClaimable(
  sidecar: DatabaseSync,
  row: unknown,
): boolean {
  const status = speechOutboxStatus(sidecar, row);
  return status !== null && status !== "suppressed" && status !== "suppressed_shadow";
}

function listPendingByLane(
  db: DatabaseSync,
  ownerId: string,
  lane: "cognitive_v021" | "social_notify",
): PendingCognitiveDelivery[] {
  const laneClause = lane === "social_notify"
    ? "delivery_lane = 'social_notify'"
    : "delivery_lane IN ('reactive', 'proactive')";
  // Zero-receipt sending rows have no proof of no dispatch. They remain
  // sending until receipt, cancellation, or an explicit no-dispatch proof.
  const sidecar = lane === "cognitive_v021" ? getRegisteredCognitiveSidecar(db) : undefined;
  if (lane === "cognitive_v021" && !sidecar) return [];
  const rows = db.prepare(
    `SELECT id
          , cognitive_v021_projection_key
          , speech_outbox_id
       FROM delivery_reservations
      WHERE owner_id = ?
        AND channel = 'discord'
        AND cognitive_v021_projection_key IS NOT NULL
        AND ${laneClause}
        AND state = 'reserved'
      ORDER BY id ASC`,
  ).all(ownerId);
  return rows.flatMap((row) => {
    const id = reservationId(row);
    if (id === null || (sidecar && !speechClaimable(sidecar, row))) return [];
    const pending = deliveryForState(db, id, "reserved");
    return pending ? [pending] : [];
  });
}

/** Read-only listing of projected v0.2.1 Discord deliveries awaiting transport. */
export function listPendingCognitiveDeliveries(
  db: DatabaseSync,
  ownerId: string,
): PendingCognitiveDelivery[] {
  return listPendingByLane(db, ownerId, "cognitive_v021");
}

/** Read-only listing of bounded Owner social-notification deliveries. */
export function listPendingSocialNotifications(
  db: DatabaseSync,
  ownerId: string,
): PendingCognitiveDelivery[] {
  return listPendingByLane(db, ownerId, "social_notify");
}

function reconcileExpiredSending(
  db: DatabaseSync,
  ownerId: string,
  nowIso: string,
  lane: "cognitive_v021" | "social_notify",
): void {
  const laneClause = lane === "social_notify"
    ? "delivery_lane = 'social_notify'"
    : "delivery_lane IN ('reactive', 'proactive')";
  const rows = db.prepare(
    `SELECT id
       FROM delivery_reservations
      WHERE owner_id = ?
        AND channel = 'discord'
        AND cognitive_v021_projection_key IS NOT NULL
        AND ${laneClause}
        AND state = 'sending'
        AND first_sent_at IS NOT NULL
        AND delivery_lease_expires_at IS NOT NULL
        AND delivery_lease_expires_at <= ?
      ORDER BY id ASC`,
  ).all(ownerId, nowIso);
  for (const row of rows) {
    const id = reservationId(row);
    if (id === null) continue;
    try {
      finalizeDelivery(db, {
        reservationId: id,
        ownerId,
        cause: "delivery_lease",
      });
    } catch {
      // Leave an unresolvable row for the next bounded reconciliation pass.
    }
  }
}

function claimPendingByLane(
  db: DatabaseSync,
  input: {
    ownerId: string;
    leaseMs?: number;
    nowMs?: number;
  },
  lane: "cognitive_v021" | "social_notify",
): PendingCognitiveDelivery[] {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leaseExpiresAt = new Date(
    nowMs + clampLeaseMs(input.leaseMs),
  ).toISOString();

  reconcileExpiredSending(db, input.ownerId, nowIso, lane);

  const laneClause = lane === "social_notify"
    ? "delivery_lane = 'social_notify'"
    : "delivery_lane IN ('reactive', 'proactive')";
  const sidecar = lane === "cognitive_v021" ? getRegisteredCognitiveSidecar(db) : undefined;
  if (lane === "cognitive_v021" && !sidecar) return [];

  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      `SELECT id, cognitive_v021_projection_key, speech_outbox_id
         FROM delivery_reservations
        WHERE owner_id = ?
          AND channel = 'discord'
          AND cognitive_v021_projection_key IS NOT NULL
          AND ${laneClause}
          AND state = 'reserved'
        ORDER BY id ASC
        LIMIT 1`,
    ).get(input.ownerId);
    const id = reservationId(row);
    const claimed: PendingCognitiveDelivery[] = [];
    if (id !== null && (sidecar === undefined || speechClaimable(sidecar, row))) {
      const updated = db.prepare(
        `UPDATE delivery_reservations
            SET state = 'sending', delivery_lease_expires_at = ?
          WHERE id = ? AND state = 'reserved'`,
      ).run(leaseExpiresAt, id);
      if (updated.changes === 1) {
        const delivery = deliveryForState(db, id, "sending");
        if (!delivery) throw new Error("cognitive_delivery_claim_lost");
        claimed.push(delivery);
      }
    }
    db.exec("COMMIT");
    return claimed;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original claim error.
    }
    throw error;
  }
}

/** Atomically checks out one projected cognitive delivery for the Discord pump. */
export function claimPendingCognitiveDeliveries(
  db: DatabaseSync,
  input: {
    ownerId: string;
    leaseMs?: number;
    nowMs?: number;
  },
): PendingCognitiveDelivery[] {
  return claimPendingByLane(db, input, "cognitive_v021");
}

/** Atomically checks out one projected social notification for the Owner pump. */
export function claimPendingSocialNotifications(
  db: DatabaseSync,
  input: {
    ownerId: string;
    leaseMs?: number;
    nowMs?: number;
  },
): PendingCognitiveDelivery[] {
  return claimPendingByLane(db, input, "social_notify");
}
