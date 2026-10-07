import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Owner reactions on her bubbles, newest first. Plain facts; no reading of them. */
export type HerBubbleReactionFact = {
  emoji: string;
  onHerMessageAt: number;
  atMs: number;
};

const REACTION_KEY = "signal:owner-bubble-reactions";
const MAX_STORED_REACTIONS = 50;
const MAX_REACTION_FACTS = 5;

type StoredReaction = {
  id: string;
  emoji: string;
  messageId: string;
  atMs: number;
};

/** Unicode as received. A custom emoji `<:name:id>` or `<a:name:id>` is its name only. */
export function reactionEmojiFact(emoji: string): string | null {
  const trimmed = emoji.trim();
  if (!trimmed) return null;
  const custom = /^<a?:([^:>]+):\d+>$/.exec(trimmed);
  return custom ? custom[1]! : trimmed;
}

function readStored(db: DatabaseSync): StoredReaction[] {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(REACTION_KEY) as
    | { value?: unknown }
    | undefined;
  if (!row || typeof row.value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.emoji !== "string") return [];
      if (typeof record.messageId !== "string" || typeof record.atMs !== "number") return [];
      if (!Number.isFinite(record.atMs)) return [];
      return [{
        id: record.id,
        emoji: record.emoji,
        messageId: record.messageId,
        atMs: record.atMs,
      }];
    });
  } catch {
    return [];
  }
}

function writeStored(db: DatabaseSync, rows: readonly StoredReaction[]): void {
  db.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(REACTION_KEY, JSON.stringify(rows));
}

/** Append one Owner reaction. The Host does not classify it. */
export function recordOwnerBubbleReaction(
  db: DatabaseSync,
  input: { messageId: string; emoji: string; atMs: number },
): void {
  const emoji = reactionEmojiFact(input.emoji);
  const messageId = input.messageId.trim();
  if (!emoji || !messageId || !Number.isFinite(input.atMs)) return;
  const next = [
    ...readStored(db),
    { id: randomUUID(), emoji, messageId, atMs: input.atMs },
  ].sort((left, right) => right.atMs - left.atMs || right.id.localeCompare(left.id))
    .slice(0, MAX_STORED_REACTIONS);
  writeStored(db, next);
}

function deliverySentAtMs(nuclear: DatabaseSync, messageId: string): number | null {
  try {
    const row = nuclear.prepare(
      `SELECT sent_at FROM delivery_bubbles
       WHERE discord_message_id = ? AND sent_at IS NOT NULL
       LIMIT 1`,
    ).get(messageId) as { sent_at?: unknown } | undefined;
    if (!row || typeof row.sent_at !== "string") return null;
    const ms = Date.parse(row.sent_at);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function evidenceSentAtMs(sidecar: DatabaseSync, messageId: string): number | null {
  try {
    const row = sidecar.prepare(
      `SELECT e.sent_at_ms AS sent_at_ms, e.created_at_ms AS created_at_ms
       FROM conversation_evidence_discord_ids d
       JOIN conversation_evidence_log e
         ON e.lineage_id = d.lineage_id AND e.role = 'ashley'
       WHERE d.discord_message_id = ?
       ORDER BY e.version DESC
       LIMIT 1`,
    ).get(messageId) as { sent_at_ms?: unknown; created_at_ms?: unknown } | undefined;
    if (!row) return null;
    if (typeof row.sent_at_ms === "number" && Number.isFinite(row.sent_at_ms)) return row.sent_at_ms;
    if (typeof row.created_at_ms === "number" && Number.isFinite(row.created_at_ms)) return row.created_at_ms;
    return null;
  } catch {
    return null;
  }
}

export function herMessageAtMs(
  nuclear: DatabaseSync,
  sidecar: DatabaseSync,
  messageId: string,
): number | null {
  return deliverySentAtMs(nuclear, messageId) ?? evidenceSentAtMs(sidecar, messageId);
}

/**
 * Unshown reactions whose bubble time can be resolved, at most five, newest first.
 * Unresolved rows stay stored. Callers mark the returned ids only after the
 * projection actually includes the facts.
 */
export function unshownOwnerBubbleReactions(
  nuclear: DatabaseSync,
  sidecar: DatabaseSync,
): { facts: HerBubbleReactionFact[]; ids: string[] } {
  const stored = readStored(nuclear);
  const resolved: Array<{ id: string; fact: HerBubbleReactionFact }> = [];
  for (const row of stored) {
    const onHerMessageAt = herMessageAtMs(nuclear, sidecar, row.messageId);
    if (onHerMessageAt === null) continue;
    resolved.push({
      id: row.id,
      fact: { emoji: row.emoji, onHerMessageAt, atMs: row.atMs },
    });
  }
  resolved.sort((left, right) => right.fact.atMs - left.fact.atMs || right.id.localeCompare(left.id));
  const selected = resolved.slice(0, MAX_REACTION_FACTS);
  return {
    facts: selected.map((row) => row.fact),
    ids: selected.map((row) => row.id),
  };
}

export function markOwnerBubbleReactionsShown(db: DatabaseSync, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  writeStored(db, readStored(db).filter((row) => !drop.has(row.id)));
}
