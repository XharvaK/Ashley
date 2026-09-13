import type { DatabaseSync } from "node:sqlite";
import { insertMessage, resolveActiveThread } from "../../memory/threads.js";
import {
  listConversationEvidence,
} from "./conversation-log.js";
import type { ConversationEvidenceRecord } from "../types.js";

export type EvidenceCompatibilityProjectionInput = {
  ownerId: string;
  conversationId: string;
  /** The compatibility bridge is unreachable until configuration-only cutover. */
  cutover?: boolean;
  limit?: number;
};

export type EvidenceCompatibilityProjectionResult = {
  projected: number;
  replayed: number;
  skippedDrafts: number;
  messageIds: number[];
  reason?: "cutover_not_active";
};

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
    .some((row) => row.name === column);
}

function entityUuid(row: ConversationEvidenceRecord): string {
  return `cognitive-v021:evidence:${row.rowId}`;
}

function role(row: ConversationEvidenceRecord): "user" | "assistant" | "system" {
  if (row.role === "owner") return "user";
  if (row.role === "ashley") return "assistant";
  return "system";
}

function isProjectable(row: ConversationEvidenceRecord): boolean {
  if (row.text == null || !row.text.trim()) return false;
  if (row.role === "ashley" && !row.delivered) return false;
  return row.role === "owner" || row.role === "ashley" || row.role === "system";
}

function alreadyProjected(nuclear: DatabaseSync, threadId: string, row: ConversationEvidenceRecord, withUuid: boolean): number | null {
  const uuid = entityUuid(row);
  const found = withUuid
    ? nuclear.prepare("SELECT id FROM mem_messages WHERE entity_uuid = ? LIMIT 1").get(uuid)
    : nuclear.prepare("SELECT id FROM mem_messages WHERE thread_id = ? AND role = ? AND text = ? LIMIT 1").get(threadId, role(row), row.text);
  if (!found || typeof found !== "object" || found === null || typeof (found as { id?: unknown }).id !== "number") return null;
  return (found as { id: number }).id;
}

/**
 * Copy utterance evidence into legacy `mem_messages` after cutover. No
 * semantic facts, assertions, or interpretation tables are written here.
 */
export function projectConversationEvidence(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  input: EvidenceCompatibilityProjectionInput,
): EvidenceCompatibilityProjectionResult {
  if (input.cutover !== true) return { projected: 0, replayed: 0, skippedDrafts: 0, messageIds: [], reason: "cutover_not_active" };
  const threadId = resolveActiveThread(nuclear, input.ownerId, "discord");
  const rows = listConversationEvidence(sidecar, input.conversationId, { limit: input.limit ?? 1000 });
  const withUuid = hasColumn(nuclear, "mem_messages", "entity_uuid");
  const result: EvidenceCompatibilityProjectionResult = { projected: 0, replayed: 0, skippedDrafts: 0, messageIds: [] };
  for (const row of rows) {
    if (!isProjectable(row)) {
      if (row.role === "ashley" && !row.delivered) result.skippedDrafts += 1;
      continue;
    }
    const existing = alreadyProjected(nuclear, threadId, row, withUuid);
    if (existing !== null) {
      result.replayed += 1;
      result.messageIds.push(existing);
      continue;
    }
    const id = insertMessage(nuclear, {
      threadId,
      ownerId: input.ownerId,
      role: role(row),
      text: row.text!,
      channel: "discord",
      dataClassification: row.dataClassification,
      entityUuid: withUuid ? entityUuid(row) : undefined,
    });
    if (id > 0) {
      result.projected += 1;
      result.messageIds.push(id);
    }
  }
  return result;
}

export const projectEvidenceCompatibility = projectConversationEvidence;
