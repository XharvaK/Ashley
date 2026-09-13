import type { DatabaseSync } from "node:sqlite";
import { planContentBubbles } from "../../delivery/bubble-plan.js";
import { getSpeechOutbox, updateOutboxStatus } from "./outbox.js";
import { getSystemNotice, updateSystemNoticeStatus } from "./infrastructure-notice.js";
import type { DeliveryIntent } from "../types.js";

export type OutboxTransport = (input: {
  reservationId: number;
  text: string;
  bubbles: Array<{ ordinal: number; text: string }>;
  deliveryIntent: DeliveryIntent;
}) => Promise<string[]>;

export async function sendOutbox(
  db: DatabaseSync,
  outboxId: number,
  transport: OutboxTransport,
): Promise<string[]> {
  const row = getSpeechOutbox(db, outboxId);
  if (!row) throw new Error("speech_outbox_missing");
  if (row.suppressed || row.sendStatus === "suppressed" || row.sendStatus === "suppressed_shadow") {
    throw new Error("speech_outbox_suppressed");
  }
  if (row.discordMessageIds.length > 0 || row.sendStatus === "delivered") return row.discordMessageIds;
  if (row.nuclearReservationId == null) throw new Error("speech_outbox_not_projected");
  updateOutboxStatus(db, outboxId, "sending");
  const ids = await transport({
    reservationId: row.nuclearReservationId,
    text: row.licensedText,
    bubbles: planContentBubbles(row.licensedText),
    deliveryIntent: row.deliveryIntent,
  });
  const normalized = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (normalized.length === 0) throw new Error("speech_delivery_receipt_missing");
  updateOutboxStatus(db, outboxId, "delivered", { discordMessageIds: normalized });
  return normalized;
}

export async function sendSystemOutbox(
  db: DatabaseSync,
  noticeId: number,
  transport: OutboxTransport,
): Promise<string> {
  const notice = getSystemNotice(db, noticeId);
  if (!notice) throw new Error("system_notice_missing");
  if (notice.sendStatus === "suppressed" || notice.sendStatus === "suppressed_shadow") {
    throw new Error("system_notice_suppressed");
  }
  if (notice.discordMessageId) return notice.discordMessageId;
  if (notice.nuclearReservationId == null) throw new Error("system_notice_not_projected");
  updateSystemNoticeStatus(db, noticeId, "sending");
  const ids = await transport({
    reservationId: notice.nuclearReservationId,
    text: notice.noticeText,
    bubbles: planContentBubbles(notice.noticeText),
    deliveryIntent: notice.deliveryIntent,
  });
  const id = ids.find((value) => typeof value === "string" && value.length > 0);
  if (!id) throw new Error("system_notice_receipt_missing");
  updateSystemNoticeStatus(db, noticeId, "delivered", { discordMessageId: id });
  return id;
}
