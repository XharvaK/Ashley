import type { DatabaseSync } from "node:sqlite";
import { finalizeDelivery } from "../../delivery/finalize.js";
import {
  getDeliveryReservation,
  listDeliveryBubbles,
} from "../../delivery/store.js";
import {
  getRegisteredCognitiveSidecar,
  getSpeechOutbox,
  updateOutboxStatus,
} from "../speech/outbox.js";
import { isAuthorizedOwnerId } from "../../../owner-auth.js";
import { getCurrentCycle } from "../cycle/inbox.js";

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
type ProjectionKind = "speech" | "system" | "interim";

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
  if (key.startsWith("interim:")) return "interim";
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
    if (!key.startsWith("speech:") && !key.startsWith("interim:")) return null;
  } else if (kind === "system") {
    if (!key.startsWith("system:")) return null;
  } else if (!key.startsWith("interim:")) {
    return null;
  }
  const table = kind === "speech"
    ? (key.startsWith("interim:") ? "operation_interim_outbox" : "speech_outbox")
    : kind === "system"
      ? "system_notice_outbox"
      : "operation_interim_outbox";
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
  const rowKind = projectionKind(row);
  // The cognitive Owner-DM lane carries both settlement speech and detached
  // interim holds: both are Ashley speech to the Owner, typed apart by key.
  if (kind === "speech") {
    if (rowKind !== "speech" && rowKind !== "interim") return false;
  } else if (rowKind !== kind) {
    return false;
  }
  const status = projectionStatus(sidecar, row, rowKind ?? kind);
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

function isOwnerDmDestinationJson(destinationJson: unknown): boolean {
  if (destinationJson === null || destinationJson === undefined) return true;
  if (typeof destinationJson === "string") {
    try {
      const parsed = JSON.parse(destinationJson) as Record<string, unknown>;
      return parsed.kind === "owner" || parsed.kind === "owner_private";
    } catch {
      return false;
    }
  }
  if (typeof destinationJson === "object") {
    const d = destinationJson as Record<string, unknown>;
    return d.kind === "owner" || d.kind === "owner_private";
  }
  return false;
}

export const LEGACY_WRONG_PRINCIPAL_RECONCILE_LIMIT = 50 as const;

/**
 * Reconcile legacy wrong-principal final speech reservations where owner_id
 * was written as the conversation/thread UUID instead of the canonical Owner snowflake (exact defect: owner_id = thread_id).
 * Requires 5 proofs before correcting; if stale, truthfully suppresses.
 * Cross-DB ordering updates sidecar first so crash retry remains idempotent.
 * Bounded by limit (default 50). Selects exact defect class in SQL before LIMIT. Sidecar correction failure leaves Nuclear untouched/discoverable for retry.
 */
export function reconcileLegacyWrongPrincipalSpeechReservations(
  db: DatabaseSync,
  sidecar: DatabaseSync,
  canonicalOwnerId?: string,
  nowMs = Date.now(),
  limit: number = LEGACY_WRONG_PRINCIPAL_RECONCILE_LIMIT,
): { corrected: number; suppressedStale: number } {
  let corrected = 0;
  let suppressedStale = 0;
  const nowIso = new Date(nowMs).toISOString();

  const candidates = db.prepare(
    `SELECT id, owner_id, thread_id, destination_json, cognitive_v021_projection_key, speech_outbox_id
       FROM delivery_reservations
      WHERE channel = 'discord'
        AND delivery_lane IN ('reactive', 'proactive')
        AND state = 'reserved'
        AND (cognitive_v021_projection_key LIKE 'speech:%' OR speech_outbox_id IS NOT NULL)
        AND owner_id = thread_id
      ORDER BY id ASC
      LIMIT ?`,
  ).all(limit) as Array<{
    id?: unknown;
    owner_id?: unknown;
    thread_id?: unknown;
    destination_json?: unknown;
    cognitive_v021_projection_key?: unknown;
    speech_outbox_id?: unknown;
  }>;

  for (const row of candidates) {
    const id = reservationId(row);
    if (id === null) continue;
    const ownerIdStr = typeof row.owner_id === "string" ? row.owner_id.trim() : "";
    const threadIdStr = typeof row.thread_id === "string" ? row.thread_id.trim() : "";
    const isExactLegacyDefect = Boolean(ownerIdStr && threadIdStr && ownerIdStr === threadIdStr);
    if (!isExactLegacyDefect) continue;

    if (!isOwnerDmDestinationJson(row.destination_json)) continue;

    // Proof 1: state = 'reserved' (not externally dispatched)
    const reservation = getDeliveryReservation(db, id);
    if (!reservation || reservation.state !== "reserved") continue;

    // Proof 2: no delivery receipt exists
    const bubbles = listDeliveryBubbles(db, id);
    const hasReceipt = bubbles.some((b) => Boolean(b.discordMessageId?.trim()) || Boolean(b.sentAt?.trim()));
    if (hasReceipt) continue;

    // Proof 3: source speech/outbox identity mechanically known
    let speechOutboxId = Number(row.speech_outbox_id);
    if (!Number.isSafeInteger(speechOutboxId) || speechOutboxId <= 0) {
      const key = typeof row.cognitive_v021_projection_key === "string" ? row.cognitive_v021_projection_key : "";
      if (key.startsWith("speech:")) {
        speechOutboxId = Number(key.slice("speech:".length));
      }
    }
    if (!Number.isSafeInteger(speechOutboxId) || speechOutboxId <= 0) continue;

    const speech = getSpeechOutbox(sidecar, speechOutboxId);
    if (!speech) continue;

    // Proof 4: canonical Owner principal derives from original durable lineage
    let targetOwnerId: string | null = null;
    if (canonicalOwnerId && isAuthorizedOwnerId(canonicalOwnerId)) {
      targetOwnerId = canonicalOwnerId;
    } else {
      const cycleRow = sidecar.prepare(
        "SELECT occupant_id, origin_owner_event_id FROM cycle_records WHERE cycle_id = ? LIMIT 1",
      ).get(speech.cycleId) as { occupant_id?: unknown; origin_owner_event_id?: unknown } | undefined;
      const occId = typeof cycleRow?.occupant_id === "string" ? cycleRow.occupant_id.trim() : "";
      if (occId && isAuthorizedOwnerId(occId)) {
        targetOwnerId = occId;
      } else {
        const originEvId = typeof cycleRow?.origin_owner_event_id === "string" ? cycleRow.origin_owner_event_id.trim() : "";
        if (originEvId) {
          const evRow = sidecar.prepare(
            "SELECT payload_json FROM inbox_events WHERE id = ? LIMIT 1",
          ).get(originEvId) as { payload_json?: unknown } | undefined;
          try {
            const p = JSON.parse(typeof evRow?.payload_json === "string" ? evRow.payload_json : "{}") as Record<string, unknown>;
            if (typeof p.ownerId === "string" && isAuthorizedOwnerId(p.ownerId.trim())) {
              targetOwnerId = p.ownerId.trim();
            }
          } catch {
            // ignore
          }
        }
      }
    }

    if (!targetOwnerId) continue;

    // Proof 5: currentness permits delivery (not stale)
    const current = getCurrentCycle(sidecar, speech.conversationId, { includeIdle: true });
    const isCurrent = Boolean(
      current &&
      current.cycleId === speech.cycleId &&
      current.generation === speech.generation,
    );

    if (!isCurrent) {
      // Stale: suppress truthfully and leave continuity to recover.
      // Update sidecar FIRST so that if crash occurs before Nuclear update,
      // Nuclear remains reserved/suspicious and discoverable on next pass.
      updateOutboxStatus(sidecar, speech.outboxId, "suppressed", {
        finalizationReason: "stale_generation",
        nuclearReservationId: id,
      });
      db.prepare(
        `UPDATE delivery_reservations
            SET state = 'aborted', finalization_reason = 'stale_generation', finalized_at = ?
          WHERE id = ? AND state = 'reserved'`,
      ).run(nowIso, id);
      suppressedStale += 1;
    } else {
      // Current: correct owner_id to canonical Owner principal.
      // Update sidecar FIRST so that if the sidecar correction fails, Nuclear
      // is left untouched with the legacy owner_id: the row remains
      // discoverable as owner_id = thread_id and retries on a future pass.
      let sidecarCorrected = false;
      try {
        const intent = typeof speech.deliveryIntent === "object" && speech.deliveryIntent !== null
          ? { ...speech.deliveryIntent, ownerId: targetOwnerId }
          : { ownerId: targetOwnerId };
        sidecar.prepare(
          "UPDATE speech_outbox SET delivery_intent_json = ? WHERE outbox_id = ?",
        ).run(JSON.stringify(intent), speech.outboxId);
        sidecarCorrected = true;
      } catch {
        // Leave Nuclear untouched with legacy owner_id; retry on future pass.
      }
      if (!sidecarCorrected) continue;
      db.prepare(
        `UPDATE delivery_reservations
            SET owner_id = ?
          WHERE id = ? AND state = 'reserved'`,
      ).run(targetOwnerId, id);
      corrected += 1;
    }
  }

  return { corrected, suppressedStale };
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
  if (lane === "cognitive_v021" && sidecar) {
    reconcileLegacyWrongPrincipalSpeechReservations(db, sidecar, input.ownerId, nowMs);
  }

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
