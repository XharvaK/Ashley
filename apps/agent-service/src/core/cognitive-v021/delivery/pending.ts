import type { DatabaseSync } from "node:sqlite";
import type { SpeechOutboxRow } from "../types.js";
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
import { emitDeliveryExhaustedNotice } from "../speech/infrastructure-notice.js";
import { isAuthorizedOwnerId } from "../../../owner-auth.js";
import { speechSupersessionReason } from "../settlement/publish.js";

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

    // Proof 5: semantic currentness permits delivery (not stale). This uses
    // the canonical speech supersession rule — the same definition of "stale
    // speech" as the publication recheck — never raw generation equality, so
    // a non-preempting later generation cannot strand a wrong-principal row
    // that is otherwise legitimately deliverable.
    const supersession = speechSupersessionReason(sidecar, speech);

    if (supersession) {
      // Stale: suppress truthfully and leave continuity to recover.
      // Update sidecar FIRST so that if crash occurs before Nuclear update,
      // Nuclear remains reserved/suspicious and discoverable on next pass.
      updateOutboxStatus(sidecar, speech.outboxId, "suppressed", {
        finalizationReason: supersession,
        nuclearReservationId: id,
      });
      db.prepare(
        `UPDATE delivery_reservations
            SET state = 'aborted', finalization_reason = ?, finalized_at = ?
          WHERE id = ? AND state = 'reserved'`,
      ).run(supersession, nowIso, id);
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

/**
 * Record the terminal delivery-failure notice for an exhausted or ambiguous
 * speech delivery. Idempotent per speech row (stable notice key): repeated
 * sweeps return the existing notice without duplicating Owner-visible
 * output. Never throws: notice persistence must not break the owning sweep.
 */
function ensureExhaustedDeliveryNotice(
  sidecar: DatabaseSync,
  speech: Pick<SpeechOutboxRow, "outboxId" | "cycleId" | "conversationId" | "deliveryIntent">,
  reservationId: number,
  dispatchAmbiguous: boolean,
): void {
  try {
    const intent = (speech.deliveryIntent ?? {}) as Record<string, unknown>;
    const ownerId = typeof intent.ownerId === "string" ? intent.ownerId.trim() : "";
    if (!ownerId || !isAuthorizedOwnerId(ownerId)) return;
    const channel = typeof intent.channel === "string" && intent.channel.trim() ? intent.channel.trim() : "discord";
    const threadId = typeof intent.threadId === "string" && intent.threadId.trim()
      ? intent.threadId.trim()
      : speech.conversationId;
    const lane = typeof intent.deliveryLane === "string" ? intent.deliveryLane : "reactive";
    emitDeliveryExhaustedNotice(sidecar, {
      ownerId,
      channel,
      threadId,
      conversationId: speech.conversationId,
      cycleId: speech.cycleId,
      speechOutboxId: speech.outboxId,
      reservationId,
      dispatchAmbiguous,
      deliveryLane: lane === "proactive" ? "proactive" : "reactive",
    });
  } catch {
    // Notice persistence is best-effort visibility; the durable send_failure
    // row itself remains the authoritative unfulfilled-obligation truth.
  }
}

export const UNFULFILLED_FAILED_SPEECH_RECONCILE_LIMIT = 50 as const;

/**
 * Reconcile unfulfilled speech delivery reservations that were aborted due to
 * send_failure before any external dispatch occurred.
 *
 * Requirements:
 * 1. Idempotency proof: first_sent_at is NULL and ZERO delivery bubbles were receipted/sent.
 * 2. Draft content is non-empty, destination is not 'invalid'.
 * 3. Bounded recovery: maximum 1 automatic recovery attempt per reservation (prevents hot-looping).
 * 4. Source speech outbox row exists in cognitive sidecar with origin = 'live' and 0 delivered message IDs.
 * 5. Semantic validity proof: speech is NOT superseded (no newer Owner dialogue input, not preempted, no newer speech).
 * 6. Cross-DB crash convergence: handles Crash Point A (sidecar projected, nuclear aborted) and Crash Point B.
 */
export function reconcileUnfulfilledFailedSpeechReservations(
  db: DatabaseSync,
  sidecar: DatabaseSync,
  ownerId?: string,
  nowMs = Date.now(),
  limit: number = UNFULFILLED_FAILED_SPEECH_RECONCILE_LIMIT,
): { recovered: number; suppressedStale: number } {
  let recovered = 0;
  let suppressedStale = 0;

  const ownerClause = ownerId && isAuthorizedOwnerId(ownerId) ? "AND owner_id = ?" : "";
  const params: Array<string | number> = ownerId && isAuthorizedOwnerId(ownerId) ? [ownerId, limit] : [limit];

  const candidates = db.prepare(
    `SELECT id, owner_id, thread_id, draft_text, destination_json, cognitive_v021_projection_key, speech_outbox_id, error_category, finalization_reason, first_sent_at, dispatch_started_at
       FROM delivery_reservations
      WHERE channel = 'discord'
        AND delivery_lane IN ('reactive', 'proactive')
        AND state = 'aborted'
        AND (error_category = 'send_failure' OR finalization_reason = 'send_failure')
        AND (cognitive_v021_projection_key LIKE 'speech:%' OR speech_outbox_id IS NOT NULL)
        AND first_sent_at IS NULL
        ${ownerClause}
      ORDER BY id ASC
      LIMIT ?`,
  ).all(...params) as Array<{
    id?: unknown;
    owner_id?: unknown;
    thread_id?: unknown;
    draft_text?: unknown;
    destination_json?: unknown;
    cognitive_v021_projection_key?: unknown;
    speech_outbox_id?: unknown;
    error_category?: unknown;
    finalization_reason?: unknown;
    first_sent_at?: unknown;
    dispatch_started_at?: unknown;
  }>;

  for (const row of candidates) {
    const id = reservationId(row);
    if (id === null) continue;

    // Proof 1: IDEMPOTENCY - ZERO dispatch boundary and ZERO bubbles delivered/sent
    if (row.first_sent_at !== null && row.first_sent_at !== undefined) continue;
    const bubbles = listDeliveryBubbles(db, id);
    const hasAnyReceipt = bubbles.some(
      (b) => Boolean(b.discordMessageId?.trim()) || Boolean(b.sentAt?.trim()),
    );
    if (hasAnyReceipt) {
      continue;
    }

    // Proof 2: Content non-empty
    const draftText = typeof row.draft_text === "string" ? row.draft_text.trim() : "";
    if (!draftText) continue;

    // Proof 3: Target validity
    if (row.destination_json) {
      let destinationObj: Record<string, unknown> = {};
      if (typeof row.destination_json === "string" && row.destination_json.trim()) {
        try {
          const parsed = JSON.parse(row.destination_json);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            destinationObj = parsed as Record<string, unknown>;
          }
        } catch {
          // ignore
        }
      } else if (typeof row.destination_json === "object" && !Array.isArray(row.destination_json)) {
        destinationObj = { ...(row.destination_json as Record<string, unknown>) };
      }
      if (destinationObj.kind === "invalid") continue;
    }

    // Proof 4: Source speech outbox identity mechanically known
    let speechOutboxId = Number(row.speech_outbox_id);
    if (!Number.isSafeInteger(speechOutboxId) || speechOutboxId <= 0) {
      const key = typeof row.cognitive_v021_projection_key === "string" ? row.cognitive_v021_projection_key : "";
      if (key.startsWith("speech:")) {
        speechOutboxId = Number(key.slice("speech:".length));
      }
    }
    if (!Number.isSafeInteger(speechOutboxId) || speechOutboxId <= 0) continue;

    const speech = getSpeechOutbox(sidecar, speechOutboxId);
    if (!speech || speech.origin !== "live") continue;
    if (speech.sendStatus !== "send_failure" && speech.sendStatus !== "projected") continue;
    if (speech.discordMessageIds.length > 0) continue;
    if (!speech.licensedText || !speech.licensedText.trim()) continue;

    // Proof 4b: Bounded retry limit on speech outbox - prevents unbounded hot-loop
    const deliveryIntent = (speech.deliveryIntent ?? {}) as Record<string, unknown>;
    const recoveryCount = typeof deliveryIntent.recoveryAttempts === "number"
      ? deliveryIntent.recoveryAttempts
      : (typeof deliveryIntent.recovery_attempts === "number" ? deliveryIntent.recovery_attempts : 0);
    if (recoveryCount >= 1 && speech.sendStatus !== "projected") {
      // Exhausted does NOT mean fulfilled: the one-shot bound forbids another
      // automatic Discord retry, but the Owner obligation must not disappear
      // quietly. Record exactly one idempotent terminal delivery-failure
      // notice (keyed per speech row) so the failure stays durably visible
      // instead of becoming silent loss. Never replays, never fabricates.
      ensureExhaustedDeliveryNotice(sidecar, speech, id, false);
      continue;
    }

    // Proof 4c: Positive dispatch-boundary proof. A set marker means a pump
    // began external dispatch for this reservation (the marker is written
    // after the pre-dispatch recheck and before the first transport call),
    // so a receiptless terminal row is ambiguous post-dispatch and must
    // never be resurrected. Record the idempotent unconfirmed notice and
    // leave the row terminal. Supersession transfer is checked first: a
    // genuinely replaced obligation needs no notice.
    const dispatchMarker = typeof row.dispatch_started_at === "string" && row.dispatch_started_at.trim()
      ? row.dispatch_started_at.trim()
      : null;

    // Proof 5: Semantic validity - not superseded
    const supersession = speechSupersessionReason(sidecar, speech);
    if (supersession) {
      if (row.finalization_reason !== supersession) {
        db.prepare(
          `UPDATE delivery_reservations SET finalization_reason = ? WHERE id = ? AND state = 'aborted'`,
        ).run(supersession, id);
      }
      updateOutboxStatus(sidecar, speech.outboxId, "suppressed", {
        finalizationReason: supersession,
        nuclearReservationId: id,
      });
      suppressedStale += 1;
      continue;
    }

    if (dispatchMarker !== null) {
      // Ambiguous post-dispatch terminal: never resurrect. One idempotent
      // notice keeps the unconfirmed send visible.
      ensureExhaustedDeliveryNotice(sidecar, speech, id, true);
      continue;
    }

    // Proof 6: Cross-DB state restoration & crash convergence (Crash Point A / B handling)
    let sidecarUpdated = false;
    if (speech.sendStatus === "send_failure") {
      try {
        const updatedIntent = JSON.stringify({
          ...deliveryIntent,
          recoveryAttempts: recoveryCount + 1,
        });
        sidecar.prepare(
          `UPDATE speech_outbox
              SET send_status = 'projected',
                  delivery_intent_json = ?,
                  nuclear_finalization_reason = NULL
            WHERE outbox_id = ? AND send_status = 'send_failure'`,
        ).run(updatedIntent, speech.outboxId);
        sidecarUpdated = true;
      } catch {
        // Leave nuclear untouched
      }
    } else {
      // Sidecar was already 'projected' (Crash Point A convergence)
      sidecarUpdated = true;
    }
    if (!sidecarUpdated) continue;

    db.prepare(
      `UPDATE delivery_reservations
          SET state = 'reserved',
              error_category = NULL,
              finalization_reason = NULL,
              finalized_at = NULL,
              delivery_lease_expires_at = NULL
        WHERE id = ? AND state = 'aborted'`,
    ).run(id);
    recovered += 1;
  }

  return { recovered, suppressedStale };
}

export const ORPHANED_SENDING_RECONCILE_LIMIT = 50 as const;

/**
 * Own every stranded `sending` cognitive speech reservation whose delivery
 * lease has expired. ALL such rows fail closed: terminalize as `expired`
 * (`delivery_lease_expired`) without replay, plus exactly one idempotent
 * unconfirmed-delivery notice so the obligation stays visible.
 *
 * Why no redelivery here even when the dispatch marker is NULL: a stranded
 * crash row with no marker and zero receipts is byte-identical to an
 * ambiguous row stranded by an unmarked (pre-marker-regime) pump after a
 * receiptless dispatch. Zero receipts never prove zero dispatch, so replay
 * would risk duplicating an Owner-visible send. The marker's positive proof
 * is used the other way: resurrection paths require marker NULL (see the
 * failed-row reconciler), and the pump marks every dispatch, so
 * provably-dispatched rows can never be resurrected.
 *
 * Rows with receipts or `first_sent_at` set belong to the existing
 * lease-expiry finalizer and are left to it. Rows with a live lease belong
 * to a running pump and are untouched.
 */
export function reconcileOrphanedSendingDeliveries(
  db: DatabaseSync,
  sidecar: DatabaseSync,
  ownerId?: string,
  nowMs = Date.now(),
  limit: number = ORPHANED_SENDING_RECONCILE_LIMIT,
): { expired: number } {
  let expired = 0;
  const nowIso = new Date(nowMs).toISOString();

  const ownerClause = ownerId && isAuthorizedOwnerId(ownerId) ? "AND owner_id = ?" : "";
  const params: Array<string | number> = ownerId && isAuthorizedOwnerId(ownerId) ? [nowIso, ownerId, limit] : [nowIso, limit];

  const candidates = db.prepare(
    `SELECT id, owner_id, first_sent_at, dispatch_started_at, speech_outbox_id, cognitive_v021_projection_key
       FROM delivery_reservations
      WHERE channel = 'discord'
        AND delivery_lane IN ('reactive', 'proactive')
        AND state = 'sending'
        AND delivery_lease_expires_at IS NOT NULL
        AND delivery_lease_expires_at <= ?
        AND (cognitive_v021_projection_key LIKE 'speech:%' OR speech_outbox_id IS NOT NULL)
        ${ownerClause}
      ORDER BY id ASC
      LIMIT ?`,
  ).all(...params) as Array<{
    id?: unknown;
    owner_id?: unknown;
    first_sent_at?: unknown;
    dispatch_started_at?: unknown;
    speech_outbox_id?: unknown;
    cognitive_v021_projection_key?: unknown;
  }>;

  for (const row of candidates) {
    const id = reservationId(row);
    if (id === null) continue;
    // Receipt-backed rows (or rows the receipt path already timestamped) are
    // owned by the existing lease-expiry finalizer.
    if (row.first_sent_at !== null && row.first_sent_at !== undefined) continue;
    const bubbles = listDeliveryBubbles(db, id);
    const hasAnyReceipt = bubbles.some(
      (b) => Boolean(b.discordMessageId?.trim()) || Boolean(b.sentAt?.trim()),
    );
    if (hasAnyReceipt) continue;

    let speechOutboxId = Number(row.speech_outbox_id);
    if (!Number.isSafeInteger(speechOutboxId) || speechOutboxId <= 0) {
      const key = typeof row.cognitive_v021_projection_key === "string" ? row.cognitive_v021_projection_key : "";
      if (key.startsWith("speech:")) {
        speechOutboxId = Number(key.slice("speech:".length));
      }
    }
    if (!Number.isSafeInteger(speechOutboxId) || speechOutboxId <= 0) continue;
    const speech = getSpeechOutbox(sidecar, speechOutboxId);
    if (!speech || speech.origin !== "live") continue;

    // Fail closed without replay: a stranded crash row (no marker, zero
    // receipts) is indistinguishable from an ambiguous row stranded by an
    // unmarked pump after a receiptless dispatch. Terminalize as
    // lease-expired and record exactly one idempotent unconfirmed-delivery
    // notice so the obligation stays durably visible.
    const owner = typeof row.owner_id === "string" ? row.owner_id : "";
    if (!owner) continue;
    try {
      finalizeDelivery(db, {
        reservationId: id,
        ownerId: owner,
        cause: "delivery_lease",
      });
      expired += 1;
      ensureExhaustedDeliveryNotice(sidecar, speech, id, true);
    } catch {
      // Leave for the next bounded pass.
    }
  }

  return { expired };
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
    reconcileUnfulfilledFailedSpeechReservations(db, sidecar, input.ownerId, nowMs);
    reconcileOrphanedSendingDeliveries(db, sidecar, input.ownerId, nowMs);
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
