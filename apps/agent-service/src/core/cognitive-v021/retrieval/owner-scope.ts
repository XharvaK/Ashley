import type { DatabaseSync } from "node:sqlite";
import { listOwnerTrustedRoomConversationIds } from "../../relationship/social-authority.js";

/** Every Owner-private Discord thread the Owner has had, archived ones included. */
export function listOwnerThreadConversationIds(authorityDb: DatabaseSync, ownerId: string): string[] {
  if (!ownerId.trim()) return [];
  try {
    const rows = authorityDb.prepare(
      "SELECT id FROM mem_threads WHERE owner_id = ? ORDER BY created_at ASC, id ASC",
    ).all(ownerId) as Array<{ id?: unknown }>;
    return rows.flatMap((row) => (typeof row.id === "string" && row.id.trim() ? [row.id] : []));
  } catch {
    return [];
  }
}

/**
 * Growth V1 §4.6.4: conversations an Owner-private cycle may recall from,
 * resolved from authority, never from caller input: the Owner's trusted
 * rooms and every Owner-private thread. The full log stays searchable, so
 * nothing is lost when a thread is archived or falls out of the window.
 */
export function listOwnerRecallConversationIds(authorityDb: DatabaseSync, ownerId: string): string[] {
  let rooms: string[] = [];
  try {
    rooms = listOwnerTrustedRoomConversationIds(authorityDb, ownerId);
  } catch {
    rooms = [];
  }
  return [...new Set([...rooms, ...listOwnerThreadConversationIds(authorityDb, ownerId)])];
}
