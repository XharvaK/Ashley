import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  DeliveryIntent,
  Generation,
  OutboxOrigin,
  OutboxSendStatus,
  ReservationId,
  SpeechOutboxRow,
} from "../types.js";

export type InsertOutboxPendingInput = {
  settlementId: string;
  cycleId: string;
  generation: Generation;
  conversationId: string;
  licensedText: string;
  origin?: OutboxOrigin;
  deliveryIntent?: DeliveryIntent;
  nuclearReservationId?: ReservationId | null;
};

type DbRow = Record<string, unknown>;

function stringValue(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function numberValue(value: unknown, fallback = 0): number { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : fallback; }
function jsonArray(value: unknown): string[] {
  try { const parsed = JSON.parse(stringValue(value, "[]")); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}
function defaultIntent(input: InsertOutboxPendingInput): DeliveryIntent {
  return input.deliveryIntent ?? {
    ownerId: "unknown",
    channel: "discord",
    threadId: input.conversationId,
    conversationId: input.conversationId,
    trigger: "owner_message_reactive",
    deliveryLane: "reactive",
    purpose: "licensed_speech",
  };
}
function mapOutbox(row: unknown): SpeechOutboxRow | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as DbRow;
  let intent: DeliveryIntent;
  try { intent = JSON.parse(stringValue(value.delivery_intent_json, "{}")) as DeliveryIntent; } catch { return null; }
  const origin = stringValue(value.origin) as OutboxOrigin;
  const status = stringValue(value.send_status) as OutboxSendStatus;
  return {
    outboxId: numberValue(value.outbox_id),
    settlementId: stringValue(value.settlement_id),
    projectionKey: stringValue(value.projection_key),
    cycleId: stringValue(value.cycle_id),
    generation: numberValue(value.generation),
    conversationId: stringValue(value.conversation_id),
    nuclearReservationId: value.nuclear_reservation_id == null ? null : numberValue(value.nuclear_reservation_id),
    licensedText: stringValue(value.licensed_text),
    sendStatus: status,
    discordMessageIds: jsonArray(value.discord_message_ids_json),
    suppressed: numberValue(value.suppressed) === 1,
    origin,
    deliveryIntent: intent,
    nuclearFinalizationReason: value.nuclear_finalization_reason == null ? null : stringValue(value.nuclear_finalization_reason),
  };
}

export function getSpeechOutbox(db: DatabaseSync, outboxId: number): SpeechOutboxRow | null {
  return mapOutbox(db.prepare("SELECT * FROM speech_outbox WHERE outbox_id = ?").get(outboxId));
}

export function getSpeechOutboxBySettlement(db: DatabaseSync, settlementId: string): SpeechOutboxRow | null {
  return mapOutbox(db.prepare("SELECT * FROM speech_outbox WHERE settlement_id = ?").get(settlementId));
}

export function insertOutboxPending(db: DatabaseSync, input: InsertOutboxPendingInput): SpeechOutboxRow {
  const existing = getSpeechOutboxBySettlement(db, input.settlementId);
  if (existing) return existing;
  const origin = input.origin ?? "live";
  const shadow = origin === "shadow";
  const provisionalKey = `speech:pending:${randomUUID()}`;
  const result = db.prepare(
    `INSERT INTO speech_outbox
       (settlement_id, projection_key, cycle_id, generation, conversation_id,
        licensed_text, send_status, nuclear_reservation_id, discord_message_ids_json,
        suppressed, origin, delivery_intent_json, nuclear_finalization_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, NULL)`,
  ).run(
    input.settlementId,
    provisionalKey,
    input.cycleId,
    input.generation,
    input.conversationId,
    input.licensedText,
    shadow ? "suppressed_shadow" : "pending",
    input.nuclearReservationId ?? null,
    shadow ? 1 : 0,
    origin,
    JSON.stringify(defaultIntent(input)),
  );
  const outboxId = numberValue(result.lastInsertRowid);
  db.prepare("UPDATE speech_outbox SET projection_key = ? WHERE outbox_id = ?").run(`speech:${outboxId}`, outboxId);
  const row = getSpeechOutbox(db, outboxId);
  if (!row) throw new Error("speech_outbox_insert_lost");
  return row;
}

export function listSpeechOutbox(
  db: DatabaseSync,
  options: { conversationId?: string; generation?: number; statuses?: OutboxSendStatus[]; limit?: number } = {},
): SpeechOutboxRow[] {
  const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
  const conditions: string[] = [];
  const args: Array<string | number> = [];
  if (options.conversationId) { conditions.push("conversation_id = ?"); args.push(options.conversationId); }
  if (options.generation != null) { conditions.push("generation = ?"); args.push(options.generation); }
  if (options.statuses && options.statuses.length > 0) {
    conditions.push(`send_status IN (${options.statuses.map(() => "?").join(",")})`);
    args.push(...options.statuses);
  }
  args.push(limit);
  const rows = db.prepare(`SELECT * FROM speech_outbox ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY outbox_id ASC LIMIT ?`).all(...args);
  return rows.map(mapOutbox).filter((row): row is SpeechOutboxRow => row !== null);
}

/**
 * Return live speech rows whose durable projection has not started yet.
 *
 * A pending row is the committed semantic speech itself. Recovery may
 * reconsider it through the existing projector, but must never revive shadow,
 * suppressed, terminal, or already-reserved rows.
 */
export function listEligiblePendingSpeechOutbox(
  db: DatabaseSync,
  options: { limit?: number } = {},
): SpeechOutboxRow[] {
  return listSpeechOutbox(db, { statuses: ["pending"], limit: options.limit ?? 1000 })
    .filter((row) => row.origin === "live" && !row.suppressed && row.nuclearReservationId === null);
}

export function updateOutboxStatus(
  db: DatabaseSync,
  outboxId: number,
  status: OutboxSendStatus,
  options: {
    discordMessageIds?: string[];
    finalizationReason?: string | null;
    nuclearReservationId?: number | null;
  } = {},
): SpeechOutboxRow {
  db.prepare(
    `UPDATE speech_outbox
     SET send_status = ?, suppressed = CASE WHEN ? IN ('suppressed', 'suppressed_shadow') THEN 1 ELSE suppressed END,
         discord_message_ids_json = COALESCE(?, discord_message_ids_json),
         nuclear_reservation_id = COALESCE(?, nuclear_reservation_id),
         nuclear_finalization_reason = COALESCE(?, nuclear_finalization_reason)
     WHERE outbox_id = ?`,
  ).run(
    status,
    status,
    options.discordMessageIds ? JSON.stringify(options.discordMessageIds) : null,
    options.nuclearReservationId ?? null,
    options.finalizationReason ?? null,
    outboxId,
  );
  const row = getSpeechOutbox(db, outboxId);
  if (!row) throw new Error("speech_outbox_missing");
  return row;
}

export function suppressUndeliveredOutbox(
  db: DatabaseSync,
  criteria: { conversationId?: string; generation?: number; outboxId?: number; reason?: string } = {},
): number {
  const conditions = ["send_status NOT IN ('delivered', 'suppressed', 'suppressed_shadow')"];
  const args: Array<string | number> = [];
  if (criteria.conversationId) { conditions.push("conversation_id = ?"); args.push(criteria.conversationId); }
  if (criteria.generation != null) { conditions.push("generation = ?"); args.push(criteria.generation); }
  if (criteria.outboxId != null) { conditions.push("outbox_id = ?"); args.push(criteria.outboxId); }
  const result = db.prepare(
    `UPDATE speech_outbox SET send_status = 'suppressed', suppressed = 1,
       nuclear_finalization_reason = ? WHERE ${conditions.join(" AND ")}`,
  ).run(criteria.reason ?? "preempted_by_new_generation", ...args);
  return numberValue(result.changes);
}
