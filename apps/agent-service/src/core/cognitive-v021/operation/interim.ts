import type { DatabaseSync } from "node:sqlite";
import { getDeliveryReservation } from "../../delivery/store.js";
import { getCurrentCycle } from "../cycle/inbox.js";
import type {
  DeliveryIntent,
  OperationInterimOutbox,
  OutboxOrigin,
  OutboxSendStatus,
} from "../types.js";
import { getDetachedOperation } from "./detached.js";

export type AuthorizeInterimSpeechInput = {
  operationId: string;
  surfaceDraft: string;
  presentationDirectives?: readonly string[];
  deliveryIntent: DeliveryIntent;
  origin?: OutboxOrigin;
  nowMs?: number;
};

export type InterimResult =
  | { ok: true; interim: OperationInterimOutbox; created: boolean }
  | { ok: false; reason: string };

const INTERIM_SEND_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "projecting",
  "projected",
  "sending",
  "delivered",
  "partially_delivered",
  "send_failure",
  "suppressed",
  "suppressed_shadow",
]);

type InterimRow = Record<string, unknown>;

function parseDirectives(value: unknown): readonly string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseDeliveryIntent(value: unknown): DeliveryIntent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const intent = value as DeliveryIntent;
    if (typeof intent.ownerId !== "string" || typeof intent.channel !== "string") return null;
    JSON.stringify(intent);
    return intent;
  } catch {
    return null;
  }
}

function mapRow(row: InterimRow): OperationInterimOutbox | null {
  let deliveryIntent: DeliveryIntent | null = null;
  try {
    deliveryIntent = parseDeliveryIntent(
      typeof row.delivery_intent_json === "string" ? JSON.parse(row.delivery_intent_json) : null,
    );
  } catch {
    deliveryIntent = null;
  }
  if (deliveryIntent === null) return null;
  const sendStatus = typeof row.send_status === "string" ? row.send_status : "";
  if (!INTERIM_SEND_STATUSES.has(sendStatus)) return null;
  return {
    interimId: Number(row.interim_id),
    operationId: String(row.operation_id),
    projectionKey: String(row.projection_key),
    conversationId: String(row.conversation_id),
    cycleId: String(row.cycle_id),
    generation: Number(row.generation),
    surfaceDraft: String(row.surface_draft),
    presentationDirectives: parseDirectives(row.presentation_directives_json),
    sendStatus: sendStatus as OutboxSendStatus,
    suppressed: Number(row.suppressed) === 1,
    deliveryIntent,
    nuclearReservationId:
      typeof row.nuclear_reservation_id === "number" && Number.isSafeInteger(row.nuclear_reservation_id)
        ? row.nuclear_reservation_id
        : null,
    discordMessageId: typeof row.discord_message_id === "string" ? row.discord_message_id : null,
    origin: (row.origin === "shadow" ? "shadow" : "live") as OutboxOrigin,
  };
}

export function getInterimOutbox(
  sidecar: DatabaseSync,
  interimId: number,
): OperationInterimOutbox | null {
  if (!Number.isSafeInteger(interimId) || interimId < 1) return null;
  const row = sidecar
    .prepare("SELECT * FROM operation_interim_outbox WHERE interim_id = ?")
    .get(interimId) as InterimRow | undefined;
  return row ? mapRow(row) : null;
}

export function getInterimOutboxByOperation(
  sidecar: DatabaseSync,
  operationId: string,
): OperationInterimOutbox | null {
  if (!operationId) return null;
  const row = sidecar
    .prepare("SELECT * FROM operation_interim_outbox WHERE operation_id = ?")
    .get(operationId) as InterimRow | undefined;
  return row ? mapRow(row) : null;
}

export function listInterimOutboxByStatus(
  sidecar: DatabaseSync,
  statuses: readonly OutboxSendStatus[],
  limit = 50,
): OperationInterimOutbox[] {
  if (statuses.length === 0) return [];
  const rows = sidecar
    .prepare(
      `SELECT * FROM operation_interim_outbox
        WHERE send_status IN (${statuses.map(() => "?").join(", ")})
        ORDER BY interim_id ASC LIMIT ?`,
    )
    .all(...statuses, limit) as InterimRow[];
  const result: OperationInterimOutbox[] = [];
  for (const row of rows) {
    const mapped = mapRow(row);
    if (mapped) result.push(mapped);
  }
  return result;
}

/**
 * Durably authorize interim publication ownership for a detached operation.
 * Ownership exists only for admitted or started work: no admission, no
 * promissory text. Idempotent per operation. Authorization never sends;
 * projection/delivery is an independent Host activity.
 */
export function authorizeInterimSpeech(
  sidecar: DatabaseSync,
  input: AuthorizeInterimSpeechInput,
): InterimResult {
  const nowMs = input.nowMs ?? Date.now();
  if (
    typeof input.operationId !== "string"
    || input.operationId.length === 0
    || typeof input.surfaceDraft !== "string"
    || input.surfaceDraft.length === 0
    || input.surfaceDraft.length > 600
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
  ) {
    return { ok: false, reason: "invalid_interim" };
  }
  const directives = input.presentationDirectives ?? [];
  if (
    !Array.isArray(directives)
    || directives.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    return { ok: false, reason: "invalid_interim" };
  }

  const operation = getDetachedOperation(sidecar, input.operationId);
  if (!operation) return { ok: false, reason: "detached_operation_missing" };
  if (operation.state !== "admitted" && operation.state !== "started") {
    return { ok: false, reason: "detached_operation_not_admittable" };
  }

  const existing = getInterimOutboxByOperation(sidecar, input.operationId);
  if (existing) return { ok: true, interim: existing, created: false };

  const origin = input.origin ?? "live";
  try {
    const inserted = sidecar
      .prepare(
        `INSERT INTO operation_interim_outbox
           (operation_id, projection_key, conversation_id, cycle_id, generation,
            surface_draft, presentation_directives_json, send_status, suppressed,
            delivery_intent_json, origin, authorized_at_ms, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.operationId,
        `interim:pending:${input.operationId}`,
        operation.conversationId,
        operation.originCycleId,
        operation.originGeneration,
        input.surfaceDraft,
        JSON.stringify([...directives]),
        JSON.stringify(input.deliveryIntent),
        origin,
        nowMs,
        nowMs,
        nowMs,
      );
    const interimId = Number(inserted.lastInsertRowid);
    sidecar
      .prepare("UPDATE operation_interim_outbox SET projection_key = ? WHERE interim_id = ?")
      .run(`interim:${interimId}`, interimId);
    sidecar
      .prepare("UPDATE detached_operations SET interim_outbox_ref = ?, updated_at_ms = ? WHERE operation_id = ?")
      .run(`interim:${interimId}`, nowMs, input.operationId);
  } catch {
    const winner = getInterimOutboxByOperation(sidecar, input.operationId);
    if (winner) return { ok: true, interim: winner, created: false };
    return { ok: false, reason: "interim_authorization_failed" };
  }
  const created = getInterimOutboxByOperation(sidecar, input.operationId);
  if (!created) return { ok: false, reason: "interim_authorization_failed" };
  return { ok: true, interim: created, created: true };
}

export function updateInterimStatus(
  sidecar: DatabaseSync,
  interimId: number,
  status: OutboxSendStatus,
  options: { nuclearReservationId?: number | null; discordMessageId?: string | null } = {},
): OperationInterimOutbox | null {
  if (!Number.isSafeInteger(interimId) || interimId < 1 || !INTERIM_SEND_STATUSES.has(status)) {
    return null;
  }
  const current = getInterimOutbox(sidecar, interimId);
  if (!current) return null;
  sidecar
    .prepare(
      `UPDATE operation_interim_outbox
          SET send_status = ?,
              nuclear_reservation_id = COALESCE(?, nuclear_reservation_id),
              discord_message_id = COALESCE(?, discord_message_id),
              updated_at_ms = ?
        WHERE interim_id = ?`,
    )
    .run(
      status,
      options.nuclearReservationId ?? null,
      options.discordMessageId ?? null,
      Date.now(),
      interimId,
    );
  return getInterimOutbox(sidecar, interimId);
}

export type InterimRecheckOptions = {
  cognitiveSidecar?: DatabaseSync;
};

function isOwnerDmDestination(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "owner" && Object.keys(candidate).length === 1;
}

/**
 * Recheck an interim-hold publication reservation against the current
 * cognitive sidecar. Interim speech is Ashley speech owned by a detached
 * operation (`interim:<id>`); it must never route through settlement speech
 * ownership or Host system-notice truth. A failed interim delivery never
 * cancels or mutates the operation itself.
 */
export function recheckInterimPublicationReservation(
  db: DatabaseSync,
  reservationId: number,
  _nowMs = Date.now(),
  options: InterimRecheckOptions = {},
): { ok: true } | { ok: false; reason: string } {
  const reservation = getDeliveryReservation(db, reservationId);
  if (!reservation) return { ok: false, reason: "delivery_reservation_missing" };
  if (!isOwnerDmDestination(reservation.destination)) {
    return { ok: false, reason: "owner_dm_destination_invalid" };
  }
  if (reservation.state !== "reserved" && reservation.state !== "sending") {
    return { ok: false, reason: "delivery_not_sendable" };
  }
  const cognitiveSidecar = options.cognitiveSidecar;
  if (!cognitiveSidecar) return { ok: false, reason: "cognitive_sidecar_unavailable" };

  let interimId: number | null = null;
  {
    const row = db.prepare(
      "SELECT cognitive_v021_projection_key FROM delivery_reservations WHERE id = ?",
    ).get(reservationId) as Record<string, unknown> | undefined;
    const key = typeof row?.cognitive_v021_projection_key === "string"
      ? row.cognitive_v021_projection_key.trim()
      : "";
    const match = /^interim:(\d+)$/.exec(key);
    interimId = match ? Number(match[1]) : null;
  }
  if (interimId == null || !Number.isSafeInteger(interimId) || interimId < 1) {
    return { ok: false, reason: "interim_missing" };
  }

  const interim = getInterimOutbox(cognitiveSidecar, interimId);
  if (!interim) return { ok: false, reason: "interim_missing" };
  if (interim.sendStatus === "suppressed" || interim.sendStatus === "suppressed_shadow") {
    return { ok: false, reason: "interim_suppressed" };
  }
  if (
    interim.sendStatus === "delivered"
    || interim.sendStatus === "partially_delivered"
    || interim.sendStatus === "send_failure"
  ) {
    return { ok: false, reason: "interim_not_sendable" };
  }
  const current = getCurrentCycle(cognitiveSidecar, interim.conversationId, { includeIdle: true });
  if (!current || current.cycleId !== interim.cycleId) {
    return { ok: false, reason: "stale_generation" };
  }
  return { ok: true };
}
