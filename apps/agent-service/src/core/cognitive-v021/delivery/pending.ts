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

type PendingLane = "cognitive_v021" | "system_notice" | "social_notify";
type ProjectionKind = "speech" | "system";

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

function projectionKind(row: unknown): ProjectionKind | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as { speech_outbox_id?: unknown; cognitive_v021_projection_key?: unknown };
  const key = typeof value.cognitive_v021_projection_key === "string"
    ? value.cognitive_v021_projection_key
    : "";
  if (key.startsWith("speech:")) return "speech";
  if (key.startsWith("system:")) return "system";
  const outboxId = Number(value.speech_outbox_id);
  return Number.isSafeInteger(outboxId) && outboxId > 0 ? "speech" : null;
}

function projectionStatus(
  sidecar: DatabaseSync,
  row: unknown,
  kind: ProjectionKind,
): string | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as { speech_outbox_id?: unknown; cognitive_v021_projection_key?: unknown };
  const key = typeof value.cognitive_v021_projection_key === "string"
    ? value.cognitive_v021_projection_key
    : "";
  if (kind === "speech") {
    const outboxId = Number(value.speech_outbox_id);
    if (Number.isSafeInteger(outboxId) && outboxId > 0) {
      const byId = sidecar.prepare(
        "SELECT send_status FROM speech_outbox WHERE outbox_id = ? LIMIT 1",
      ).get(outboxId) as { send_status?: unknown } | undefined;
      if (byId) return typeof byId.send_status === "string" ? byId.send_status : null;
    }
    if (!key.startsWith("speech:")) return null;
  } else if (!key.startsWith("system:")) {
    return null;
  }
  const table = kind === "speech" ? "speech_outbox" : "system_notice_outbox";
  const byKey = sidecar.prepare(
    `SELECT send_status FROM ${table} WHERE projection_key = ? LIMIT 1`,
  ).get(key) as { send_status?: unknown } | undefined;
  return byKey && typeof byKey.send_status === "string" ? byKey.send_status : null;
}

function projectionClaimable(
  sidecar: DatabaseSync,
  row: unknown,
  kind: ProjectionKind,
): boolean {
  if (projectionKind(row) !== kind) return false;
  const status = projectionStatus(sidecar, row, kind);
  return status !== null && status !== "suppressed" && status !== "suppressed_shadow";
}

function laneClause(lane: PendingLane): string {
  return lane === "social_notify"
    ? "delivery_lane = 'social_notify'"
    : "delivery_lane IN ('reactive', 'proactive')";
}

function laneProjectionKind(lane: PendingLane): ProjectionKind | null {
  if (lane === "cognitive_v021") return "speech";
  if (lane === "system_notice") return "system";
  return null;
}

function listPendingByLane(
  db: DatabaseSync,
  ownerId: string,
  lane: PendingLane,
): PendingCognitiveDelivery[] {
  // Zero-receipt sending rows have no proof of no dispatch. They remain
  // sending until receipt, cancellation, or an explicit no-dispatch proof.
  const kind = laneProjectionKind(lane);
  const sidecar = kind ? getRegisteredCognitiveSidecar(db) : undefined;
  if (kind && !sidecar) return [];
  const rows = db.prepare(
    `SELECT id
          , cognitive_v021_projection_key
          , speech_outbox_id
       FROM delivery_reservations
      WHERE owner_id = ?
        AND channel = 'discord'
        AND cognitive_v021_projection_key IS NOT NULL
        AND ${laneClause(lane)}
        AND state = 'reserved'
      ORDER BY id ASC`,
  ).all(ownerId);
  return rows.flatMap((row) => {
    const id = reservationId(row);
    if (id === null || (kind && sidecar && !projectionClaimable(sidecar, row, kind))) return [];
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

/** Read-only listing of reactive/proactive Host system notices awaiting transport. */
export function listPendingSystemNotifications(
  db: DatabaseSync,
  ownerId: string,
): PendingCognitiveDelivery[] {
  return listPendingByLane(db, ownerId, "system_notice");
}

function reconcileExpiredSending(
  db: DatabaseSync,
  ownerId: string,
  nowIso: string,
  lane: PendingLane,
): void {
  const rows = db.prepare(
    `SELECT id
       FROM delivery_reservations
      WHERE owner_id = ?
        AND channel = 'discord'
        AND cognitive_v021_projection_key IS NOT NULL
        AND ${laneClause(lane)}
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
  lane: PendingLane,
): PendingCognitiveDelivery[] {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leaseExpiresAt = new Date(
    nowMs + clampLeaseMs(input.leaseMs),
  ).toISOString();

  reconcileExpiredSending(db, input.ownerId, nowIso, lane);

  const kind = laneProjectionKind(lane);
  const sidecar = kind ? getRegisteredCognitiveSidecar(db) : undefined;
  if (kind && !sidecar) return [];

  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(
      `SELECT id, cognitive_v021_projection_key, speech_outbox_id
         FROM delivery_reservations
        WHERE owner_id = ?
          AND channel = 'discord'
          AND cognitive_v021_projection_key IS NOT NULL
          AND ${laneClause(lane)}
          AND state = 'reserved'
        ORDER BY id ASC`,
    ).all(input.ownerId);
    const row = rows.find((candidate) => {
      const id = reservationId(candidate);
      return id !== null && (!kind || (sidecar && projectionClaimable(sidecar, candidate, kind)));
    });
    const id = reservationId(row);
    const claimed: PendingCognitiveDelivery[] = [];
    if (id !== null && (!kind || (sidecar && projectionClaimable(sidecar, row, kind)))) {
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

/** Atomically checks out one projected reactive/proactive system notice. */
export function claimPendingSystemNotifications(
  db: DatabaseSync,
  input: {
    ownerId: string;
    leaseMs?: number;
    nowMs?: number;
  },
): PendingCognitiveDelivery[] {
  return claimPendingByLane(db, input, "system_notice");
}
