import type { DatabaseSync } from "node:sqlite";
import {
  insertMessage,
  resolveActiveThread,
} from "../memory/threads.js";
import type { DeliveryReservationRow, DeliveryTrigger } from "./types.js";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "../privacy/secrets.js";
import { assertWritebackAllowed } from "../continuity/process-guards.js";
import {
  initializePhaseLifecycle,
  parsePhaseLifecycleJson,
  recordPhaseLifecycle,
} from "./phase-lifecycle.js";
import {
  createTurnDeadlinePlan,
  type TurnDeadlinePlan,
  type TurnDeadlinePolicy,
} from "./turn-deadline-plan.js";

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapReservation(row: unknown): DeliveryReservationRow | null {
  if (!isRow(row)) return null;
  const trigger = text(row.trigger);
  const state = text(row.state);
  const lane = text(row.delivery_lane);
  const deliveryLane: DeliveryReservationRow["deliveryLane"] =
    lane === "proactive" || lane === "operational_fulfillment"
      ? lane
      : "reactive";
  if (trigger !== "reactive" && trigger !== "proactive") return null;
  return {
    id: Number(row.id),
    ownerId: text(row.owner_id),
    channel: text(row.channel),
    threadId: text(row.thread_id),
    userMessageId: num(row.user_message_id),
    decisionId: num(row.decision_id),
    trigger,
    deliveryLane,
    initiativeReservationId: num(row.initiative_reservation_id),
    state: state as DeliveryReservationRow["state"],
    errorCategory: row.error_category == null ? null : text(row.error_category),
    finalizationReason:
      row.finalization_reason == null ? null : text(row.finalization_reason),
    draftText: row.draft_text == null ? null : text(row.draft_text),
    firstBubbleDeadlineAt:
      row.first_bubble_deadline_at == null
        ? null
        : text(row.first_bubble_deadline_at),
    firstSentAt: row.first_sent_at == null ? null : text(row.first_sent_at),
    generationLeaseExpiresAt:
      row.generation_lease_expires_at == null
        ? null
        : text(row.generation_lease_expires_at),
    deliveryLeaseExpiresAt:
      row.delivery_lease_expires_at == null
        ? null
        : text(row.delivery_lease_expires_at),
    phaseLifecycle: parsePhaseLifecycleJson(
      row.phase_lifecycle_json == null ? null : text(row.phase_lifecycle_json),
    ),
    createdAt: text(row.created_at),
    finalizedAt: row.finalized_at == null ? null : text(row.finalized_at),
  };
}

export function getDeliveryReservation(
  db: DatabaseSync,
  reservationId: number,
): DeliveryReservationRow | null {
  const row = db
    .prepare(`SELECT * FROM delivery_reservations WHERE id = ?`)
    .get(reservationId);
  return mapReservation(row);
}

export function findReservationByInboundIds(
  db: DatabaseSync,
  ownerId: string,
  channel: string,
  discordMessageIds: string[],
): DeliveryReservationRow | null {
  for (const messageId of discordMessageIds) {
    const row = db
      .prepare(
        `SELECT r.*
         FROM delivery_inbound_messages i
         JOIN delivery_reservations r ON r.id = i.reservation_id
         WHERE i.owner_id = ? AND i.channel = ? AND i.discord_message_id = ?
         LIMIT 1`,
      )
      .get(ownerId, channel, messageId);
    const mapped = mapReservation(row);
    if (mapped) return mapped;
  }
  return null;
}

export type ClaimReactiveInput = {
  ownerId: string;
  channel: string;
  mergedUserText: string;
  inboundDiscordMessageIds: string[];
  finalFragmentReceivedAtMs: number;
  /** Bot-owned absolute HTTP transport cutoff for this Discord turn. */
  externalTransportHardDeadlineAtMs?: number;
  nowMs?: number;
  /** Test/qualification seam. Production uses the versioned source policy. */
  turnDeadlinePolicy?: TurnDeadlinePolicy;
  /**
   * True when the inbound IDs are local placeholders rather than real Discord
   * delivery (API/simulated path). No real first-bubble pacing exists then, so
   * no hard first-bubble deadline is imposed on the generation pipeline.
   */
  simulateDelivery?: boolean;
};

export type ClaimReactiveResult =
  | {
      kind: "claimed";
      reservation: DeliveryReservationRow;
      deadlinePlan: TurnDeadlinePlan;
      secretOmitted?: boolean;
    }
  | { kind: "duplicate"; reservation: DeliveryReservationRow };

/**
 * Atomically claim a drafted reservation + inbound IDs + user mem_messages row.
 * Duplicate inbound IDs return the existing reservation without side effects.
 */
export function claimReactiveDelivery(
  db: DatabaseSync,
  input: ClaimReactiveInput,
): ClaimReactiveResult {
  assertWritebackAllowed("delivery_claim");
  const ids = [...new Set(input.inboundDiscordMessageIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new Error("inbound_discord_message_ids_required");
  }
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const deadlinePlan = createTurnDeadlinePlan(nowMs, input.turnDeadlinePolicy, {
    externalTransportHardDeadlineAtMs:
      input.externalTransportHardDeadlineAtMs,
  });
  const deadlineIso =
    input.simulateDelivery === true
      ? null
      : new Date(
          deadlinePlan.common.firstBubbleReceiptDeadlineAtMs,
        ).toISOString();
  const generationDeadlines = Object.values(deadlinePlan.branches)
    .filter(
      (branch): branch is typeof branch & { generationDeadlineAtMs: number } =>
        branch.available && "generationDeadlineAtMs" in branch,
    )
    .map((branch) => branch.generationDeadlineAtMs);
  const leaseIso = new Date(Math.max(...generationDeadlines)).toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = findReservationByInboundIds(
      db,
      input.ownerId,
      input.channel,
      ids,
    );
    if (existing) {
      db.exec("COMMIT");
      return { kind: "duplicate", reservation: existing };
    }

    const threadId = resolveActiveThread(db, input.ownerId, input.channel);
    const insert = db
      .prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, user_message_id, decision_id, trigger,
            delivery_lane, initiative_reservation_id, state, error_category, finalization_reason,
            draft_text, first_bubble_deadline_at, first_sent_at,
            generation_lease_expires_at, delivery_lease_expires_at,
            created_at, finalized_at)
         VALUES (?, ?, ?, NULL, NULL, 'reactive', 'reactive', NULL, 'drafted', NULL, NULL,
                 NULL, ?, NULL, ?, NULL, ?, NULL)`,
      )
      .run(
        input.ownerId,
        input.channel,
        threadId,
        deadlineIso,
        leaseIso,
        nowIso,
      );
    const reservationId = Number(insert.lastInsertRowid);
    initializePhaseLifecycle(db, reservationId, deadlinePlan);

    const inboundStmt = db.prepare(
      `INSERT INTO delivery_inbound_messages
         (reservation_id, ordinal, owner_id, channel, discord_message_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    ids.forEach((discordMessageId, ordinal) => {
      inboundStmt.run(
        reservationId,
        ordinal,
        input.ownerId,
        input.channel,
        discordMessageId,
      );
    });

    const secret = detectCredentialShape(input.mergedUserText);
    const storeText = secret.hit
      ? CREDENTIAL_OMITTED_PLACEHOLDER
      : input.mergedUserText;
    const userMessageId = insertMessage(db, {
      threadId,
      ownerId: input.ownerId,
      role: "user",
      text: storeText,
      channel: input.channel,
      dataClassification: secret.hit ? "secret" : "never_public",
    });
    db.prepare(
      `UPDATE delivery_reservations SET user_message_id = ? WHERE id = ?`,
    ).run(userMessageId, reservationId);

    db.exec("COMMIT");
    const reservation = getDeliveryReservation(db, reservationId);
    if (!reservation) throw new Error("delivery_claim_lost");
    return {
      kind: "claimed",
      reservation,
      deadlinePlan,
      secretOmitted: secret.hit ? true : undefined,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function attachDecisionToReservation(
  db: DatabaseSync,
  reservationId: number,
  decisionId: number,
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT id, decision_id, state FROM delivery_reservations WHERE id = ?`,
      )
      .get(reservationId);
    if (!isRow(row)) {
      db.exec("ROLLBACK");
      throw new Error("delivery_reservation_missing");
    }
    if (row.decision_id != null) {
      db.exec("COMMIT");
      return;
    }
    db.prepare(
      `UPDATE delivery_reservations SET decision_id = ? WHERE id = ? AND decision_id IS NULL`,
    ).run(decisionId, reservationId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function attachDraftAndBubbles(
  db: DatabaseSync,
  reservationId: number,
  draftText: string,
  bubbles: Array<{ ordinal: number; text: string }>,
  options: { deliveryLeaseExpiresAt?: string | null } = {},
): DeliveryReservationRow {
  const nowIso = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = getDeliveryReservation(db, reservationId);
    if (!current || current.state !== "drafted") {
      db.exec("ROLLBACK");
      throw new Error("delivery_not_drafted");
    }
    db.prepare(
      `UPDATE delivery_reservations
       SET draft_text = ?, state = 'reserved', delivery_lease_expires_at = ?
       WHERE id = ?`,
    ).run(
      draftText,
      options.deliveryLeaseExpiresAt ?? null,
      reservationId,
    );
    db.prepare(`DELETE FROM delivery_bubbles WHERE reservation_id = ?`).run(
      reservationId,
    );
    const insertBubble = db.prepare(
      `INSERT INTO delivery_bubbles
         (reservation_id, ordinal, text, discord_message_id, sent_at)
       VALUES (?, ?, ?, NULL, NULL)`,
    );
    for (const bubble of bubbles) {
      insertBubble.run(reservationId, bubble.ordinal, bubble.text);
    }
    void nowIso;
    db.exec("COMMIT");
    const updated = getDeliveryReservation(db, reservationId);
    if (!updated) throw new Error("delivery_attach_lost");
    return updated;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listDeliveryBubbles(
  db: DatabaseSync,
  reservationId: number,
): Array<{
  ordinal: number;
  text: string;
  discordMessageId: string | null;
  sentAt: string | null;
}> {
  return db
    .prepare(
      `SELECT ordinal, text, discord_message_id, sent_at
       FROM delivery_bubbles
       WHERE reservation_id = ?
       ORDER BY ordinal ASC`,
    )
    .all(reservationId)
    .flatMap((row) => {
      if (!isRow(row)) return [];
      return [
        {
          ordinal: Number(row.ordinal),
          text: text(row.text),
          discordMessageId:
            row.discord_message_id == null ? null : text(row.discord_message_id),
          sentAt: row.sent_at == null ? null : text(row.sent_at),
        },
      ];
    });
}

export function recordBubbleReceipt(
  db: DatabaseSync,
  reservationId: number,
  ordinal: number,
  discordMessageId: string,
  sentAtMs = Date.now(),
): void {
  const sentAt = new Date(sentAtMs).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const bubble = db
      .prepare(
        `SELECT discord_message_id FROM delivery_bubbles
         WHERE reservation_id = ? AND ordinal = ?`,
      )
      .get(reservationId, ordinal);
    if (!isRow(bubble)) {
      db.exec("ROLLBACK");
      throw new Error("delivery_bubble_missing");
    }
    if (bubble.discord_message_id != null) {
      db.exec("COMMIT");
      return;
    }
    db.prepare(
      `UPDATE delivery_bubbles
       SET discord_message_id = ?, sent_at = ?
       WHERE reservation_id = ? AND ordinal = ? AND discord_message_id IS NULL`,
    ).run(discordMessageId, sentAt, reservationId, ordinal);

    const reservation = getDeliveryReservation(db, reservationId);
    if (reservation?.state === "reserved") {
      db.prepare(
        `UPDATE delivery_reservations SET state = 'sending' WHERE id = ?`,
      ).run(reservationId);
    }
    if (reservation && reservation.firstSentAt == null) {
      db.prepare(
        `UPDATE delivery_reservations SET first_sent_at = ? WHERE id = ? AND first_sent_at IS NULL`,
      ).run(sentAt, reservationId);
      if (reservation.phaseLifecycle) {
        const firstBubbleDeadlineMs = Date.parse(
          reservation.firstBubbleDeadlineAt ?? "",
        );
        const deadlineMissed =
          Number.isFinite(firstBubbleDeadlineMs) &&
          sentAtMs >= firstBubbleDeadlineMs;
        recordPhaseLifecycle(db, {
          reservationId,
          phase: "first_bubble",
          event: deadlineMissed ? "failed" : "succeeded",
          atMs: sentAtMs,
          statusCode: deadlineMissed
            ? "first_bubble_deadline_missed"
            : "first_bubble_receipted",
        });
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordAuxiliaryMessage(
  db: DatabaseSync,
  input: {
    reservationId: number;
    kind: "progress" | "delivery_error";
    text: string;
    discordMessageId: string;
    sentAtMs?: number;
  },
): void {
  db.prepare(
    `INSERT INTO delivery_auxiliary_messages
       (reservation_id, kind, text, discord_message_id, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    input.reservationId,
    input.kind,
    input.text,
    input.discordMessageId,
    new Date(input.sentAtMs ?? Date.now()).toISOString(),
  );
}

export type ClaimProactiveDeliveryInput = {
  ownerId: string;
  channel: string;
  threadId: string;
  initiativeReservationId: number;
  decisionId: number;
  draftText: string;
  bubbles: Array<{ ordinal: number; text: string }>;
  deliveryLeaseMs?: number;
  nowMs?: number;
};

/**
 * Inserts a proactive delivery reservation inside the caller's transaction.
 * The caller must already own the transaction and must roll it back on error.
 */
export function claimProactiveDeliveryInTransaction(
  db: DatabaseSync,
  input: ClaimProactiveDeliveryInput,
): DeliveryReservationRow {
  assertWritebackAllowed("delivery_claim_proactive");
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leaseIso = new Date(
    nowMs + (input.deliveryLeaseMs ?? 120_000),
  ).toISOString();
  const insert = db
    .prepare(
      `INSERT INTO delivery_reservations
         (owner_id, channel, thread_id, user_message_id, decision_id, trigger,
          delivery_lane, initiative_reservation_id, state, error_category, finalization_reason,
          draft_text, first_bubble_deadline_at, first_sent_at,
          generation_lease_expires_at, delivery_lease_expires_at,
          created_at, finalized_at)
       VALUES (?, ?, ?, NULL, ?, 'proactive', 'proactive', ?, 'reserved', NULL, NULL,
               ?, NULL, NULL, NULL, ?, ?, NULL)`,
    )
    .run(
      input.ownerId,
      input.channel,
      input.threadId,
      input.decisionId,
      input.initiativeReservationId,
      input.draftText,
      leaseIso,
      nowIso,
    );
  const reservationId = Number(insert.lastInsertRowid);
  const insertBubble = db.prepare(
    `INSERT INTO delivery_bubbles
       (reservation_id, ordinal, text, discord_message_id, sent_at)
     VALUES (?, ?, ?, NULL, NULL)`,
  );
  for (const bubble of input.bubbles) {
    insertBubble.run(reservationId, bubble.ordinal, bubble.text);
  }
  const reservation = getDeliveryReservation(db, reservationId);
  if (!reservation) throw new Error("proactive_delivery_claim_lost");
  return reservation;
}

export function claimProactiveDelivery(
  db: DatabaseSync,
  input: ClaimProactiveDeliveryInput,
): DeliveryReservationRow {
  db.exec("BEGIN IMMEDIATE");
  try {
    const reservation = claimProactiveDeliveryInTransaction(db, input);
    db.exec("COMMIT");
    return reservation;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type ClaimOperationalFulfillmentDeliveryInput = {
  ownerId: string;
  channel: string;
  threadId: string;
  draftText: string;
  bubbles: Array<{ ordinal: number; text: string }>;
  deliveryLeaseMs?: number;
  nowMs?: number;
};

/**
 * Inserts an operational fulfillment delivery reservation inside the caller's transaction.
 * The caller must already own the transaction and must roll it back on error.
 * Satisfies the trigger column constraint by using trigger = 'proactive' while setting
 * delivery_lane = 'operational_fulfillment' and decision_id = NULL / initiative_reservation_id = NULL.
 */
export function claimOperationalFulfillmentDeliveryInTransaction(
  db: DatabaseSync,
  input: ClaimOperationalFulfillmentDeliveryInput,
): DeliveryReservationRow {
  assertWritebackAllowed("delivery_claim_operational_fulfillment");
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leaseIso = new Date(
    nowMs + (input.deliveryLeaseMs ?? 120_000),
  ).toISOString();
  const insert = db
    .prepare(
      `INSERT INTO delivery_reservations
         (owner_id, channel, thread_id, user_message_id, decision_id, trigger,
          delivery_lane, initiative_reservation_id, state, error_category, finalization_reason,
          draft_text, first_bubble_deadline_at, first_sent_at,
          generation_lease_expires_at, delivery_lease_expires_at,
          created_at, finalized_at)
       VALUES (?, ?, ?, NULL, NULL, 'proactive', 'operational_fulfillment', NULL, 'reserved', NULL, NULL,
               ?, NULL, NULL, NULL, ?, ?, NULL)`,
    )
    .run(
      input.ownerId,
      input.channel,
      input.threadId,
      input.draftText,
      leaseIso,
      nowIso,
    );
  const reservationId = Number(insert.lastInsertRowid);
  const insertBubble = db.prepare(
    `INSERT INTO delivery_bubbles
       (reservation_id, ordinal, text, discord_message_id, sent_at)
     VALUES (?, ?, ?, NULL, NULL)`,
  );
  for (const bubble of input.bubbles) {
    insertBubble.run(reservationId, bubble.ordinal, bubble.text);
  }
  const reservation = getDeliveryReservation(db, reservationId);
  if (!reservation) throw new Error("operational_fulfillment_delivery_claim_lost");
  return reservation;
}

export function claimOperationalFulfillmentDelivery(
  db: DatabaseSync,
  input: ClaimOperationalFulfillmentDeliveryInput,
): DeliveryReservationRow {
  db.exec("BEGIN IMMEDIATE");
  try {
    const reservation = claimOperationalFulfillmentDeliveryInTransaction(db, input);
    db.exec("COMMIT");
    return reservation;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type { DeliveryTrigger };

