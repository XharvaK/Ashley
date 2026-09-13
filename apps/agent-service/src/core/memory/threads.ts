import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../privacy/classification.js";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { annotateHotMessage } from "./context-role.js";

export type MessageRole = "user" | "assistant" | "system";

export type MemoryMessage = {
  id: number;
  threadId: string;
  ownerId: string;
  role: MessageRole;
  text: string;
  channel: string;
  createdAt: string;
  entityUuid?: string;
  dataClassification?: DataClassification;
  memory_context_role?:
    | "current_source_evidence"
    | "historical_source_evidence"
    | "corrected_source_evidence";
  memory_assertion_ids?: number[];
  memory_correction_ids?: number[];
};

type InsertMessageInput = {
  threadId: string;
  ownerId: string;
  role: MessageRole;
  text: string;
  channel?: string;
  dataClassification?: DataClassification;
  entityUuid?: string;
};

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function mapMessage(row: unknown): MemoryMessage | null {
  if (!isRow(row)) return null;
  const role = stringValue(row.role);
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }
  return {
    id: numberValue(row.id),
    threadId: stringValue(row.thread_id),
    ownerId: stringValue(row.owner_id),
    role,
    text: stringValue(row.text),
    channel: stringValue(row.channel, "discord"),
    createdAt: stringValue(row.created_at),
  };
}

export function resolveActiveThread(
  db: DatabaseSync,
  ownerId: string,
  channel = "discord",
): string {
  const active: unknown = db
    .prepare(
      `SELECT id
       FROM mem_threads
       WHERE owner_id = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(ownerId);
  if (isRow(active) && typeof active.id === "string") {
    db.prepare(
      `UPDATE mem_threads SET channel = ?, updated_at = ? WHERE id = ?`,
    ).run(channel, new Date().toISOString(), active.id);
    return active.id;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mem_threads
       (id, owner_id, status, channel, created_at, updated_at)
     VALUES (?, ?, 'active', ?, ?, ?)`,
  ).run(id, ownerId, channel, now, now);
  return id;
}

export function insertMessage(
  db: DatabaseSync,
  input: InsertMessageInput,
): number {
  const text = input.text.trim();
  if (!text) return 0;
  const entityUuid = input.entityUuid ?? newEntityUuid();
  const classification = input.dataClassification ?? "never_public";
  const hasUuid = columnExists(db, "mem_messages", "entity_uuid");
  const result = hasUuid
    ? db
        .prepare(
          `INSERT INTO mem_messages
             (thread_id, owner_id, role, text, channel, created_at,
              entity_uuid, data_classification)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.threadId,
          input.ownerId,
          input.role,
          text,
          input.channel ?? "discord",
          new Date().toISOString(),
          entityUuid,
          classification,
        )
    : db
        .prepare(
          `INSERT INTO mem_messages
             (thread_id, owner_id, role, text, channel, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.threadId,
          input.ownerId,
          input.role,
          text,
          input.channel ?? "discord",
          new Date().toISOString(),
        );
  db.prepare("UPDATE mem_threads SET updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    input.threadId,
  );
  return Number(result.lastInsertRowid);
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).some((row) => row.name === column);
}

export function getHotMessages(
  db: DatabaseSync,
  threadId: string,
  limit = 12,
): MemoryMessage[] {
  if (limit <= 0) return [];
  const rows = db
    .prepare(
      `SELECT id, thread_id, owner_id, role, text, channel, created_at
       FROM mem_messages
       WHERE thread_id = ? AND redacted_at IS NULL
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(threadId, Math.min(100, limit))
    .map(mapMessage)
    .filter((message): message is MemoryMessage => message !== null);
  const ordered = rows.reverse();
  // Hot-window role annotations are a post-cutover C1 contract. Before the
  // marker, retain the legacy raw-message shape and behavior.
  return ordered.map((message) => annotateHotMessage(db, message));
}

export function listMessageIdsMatchingTopic(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
): number[] {
  const clean = topic.trim();
  if (!clean) return [];
  const pattern = `%${clean
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")}%`;
  return db.prepare(
    `SELECT id FROM mem_messages
     WHERE owner_id = ? AND redacted_at IS NULL
       AND text LIKE ? ESCAPE '\\'
     ORDER BY id`,
  ).all(ownerId, pattern).flatMap((value) =>
    isRow(value) && typeof value.id === "number" ? [value.id] : []);
}

export function redactMessages(
  db: DatabaseSync,
  ownerId: string,
  messageIds: number[],
  receiptId: string,
): number {
  const ids = [...new Set(messageIds)].filter(Number.isFinite);
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = db.prepare(
    `UPDATE mem_messages
     SET text = '', redacted_at = ?, redaction_receipt_id = ?
     WHERE owner_id = ? AND redacted_at IS NULL
       AND id IN (${placeholders})`,
  ).run(new Date().toISOString(), receiptId, ownerId, ...ids);
  return Number(result.changes);
}

export function archiveActiveThread(
  db: DatabaseSync,
  ownerId: string,
): string | null {
  const active: unknown = db
    .prepare(
      `SELECT id
       FROM mem_threads
       WHERE owner_id = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(ownerId);
  if (!isRow(active) || typeof active.id !== "string") return null;
  db.prepare(
    `UPDATE mem_threads SET status = 'archived', updated_at = ? WHERE id = ?`,
  ).run(new Date().toISOString(), active.id);
  return active.id;
}
