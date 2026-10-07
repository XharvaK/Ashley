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

function missingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

function readStored(db: DatabaseSync): StoredReaction[] {
  let row: { value?: unknown } | undefined;
  try {
    row = db.prepare("SELECT value FROM kv WHERE key = ?").get(REACTION_KEY) as
      | { value?: unknown }
      | undefined;
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
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
  try {
    db.prepare(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(REACTION_KEY, JSON.stringify(rows));
  } catch (error) {
    if (missingTable(error)) return;
    throw error;
  }
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

/** First Owner message after at least this long a gap is a return. */
export const OWNER_RETURN_GAP_MS = 2 * 60 * 60 * 1000;

/** Mechanical text shapes. Not a reading of why the Owner left. */
export const OWNER_BRB_TEXTS = Object.freeze([
  "brb",
  "back soon",
  "afk",
  "one sec",
  "bir dk",
  "geliyorum",
]);

export const OWNER_GOODNIGHT_TEXTS = Object.freeze([
  "gn",
  "good night",
  "goodnight",
  "iyi geceler",
  "night",
]);

export type LastExchangeEnd =
  | "her_open_question"
  | "owner_fragment"
  | "owner_brb"
  | "owner_goodnight"
  | "plain";

export type ReturningFacts = {
  sinceOwnerLastMs: number;
  lastExchangeEnd: LastExchangeEnd;
  /** UX W3: her messages since the Owner's last one (present when above 0). */
  herSince?: number;
  /** UX W3: her game stretches that ended in the gap (their summaries ride in episodes). */
  playedMeanwhile?: number;
};

export type ExchangeRow = {
  rowId: string;
  role: "owner" | "ashley";
  text: string;
  atMs: number;
};

function mechanicalText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** For the fixed lists: trailing punctuation, emoji and symbols don't change the shape ("good night!" is a goodnight). */
function listText(text: string): string {
  return mechanicalText(text).replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}]+$/u, "");
}

function endsWithQuestion(text: string): boolean {
  return text.trimEnd().endsWith("?");
}

/** Shape of one Owner message. Lists win over the short-fragment rule. */
export function ownerMessageShape(text: string): Exclude<LastExchangeEnd, "her_open_question"> {
  const normalized = mechanicalText(text);
  if ((OWNER_BRB_TEXTS as readonly string[]).includes(listText(normalized))) return "owner_brb";
  if ((OWNER_GOODNIGHT_TEXTS as readonly string[]).includes(listText(normalized))) return "owner_goodnight";
  const words = normalized.length === 0 ? [] : normalized.split(" ");
  const endPunctuation = /[.!?…]$/.test(text.trim());
  if (words.length <= 3 && !endPunctuation) return "owner_fragment";
  return "plain";
}

/** How the exchange ended. Her unanswered "?" wins; otherwise the last Owner message. */
export function lastExchangeEnd(rows: readonly ExchangeRow[]): LastExchangeEnd {
  const last = rows.at(-1);
  if (!last) return "plain";
  if (last.role === "ashley" && endsWithQuestion(last.text)) return "her_open_question";
  if (last.role === "owner") return ownerMessageShape(last.text);
  return "plain";
}

export function returningFromRows(input: {
  mode: "owner_message" | "afterglow";
  rows: readonly ExchangeRow[];
  currentRowId?: string | null;
  nowMs: number;
}): ReturningFacts | null {
  if (input.mode === "afterglow") {
    const lastOwner = [...input.rows].reverse().find((row) => row.role === "owner");
    if (!lastOwner) return null;
    return {
      sinceOwnerLastMs: Math.max(0, input.nowMs - lastOwner.atMs),
      lastExchangeEnd: lastExchangeEnd(input.rows),
      ...herSince(input.rows.slice(input.rows.lastIndexOf(lastOwner) + 1)),
    };
  }
  if (!input.currentRowId) return null;
  const currentIndex = input.rows.findIndex((row) => row.rowId === input.currentRowId);
  if (currentIndex < 0) return null;
  const current = input.rows[currentIndex]!;
  if (current.role !== "owner") return null;
  const prior = input.rows.slice(0, currentIndex);
  const previousOwner = [...prior].reverse().find((row) => row.role === "owner");
  if (!previousOwner) return null;
  const sinceOwnerLastMs = current.atMs - previousOwner.atMs;
  if (sinceOwnerLastMs < OWNER_RETURN_GAP_MS) return null;
  return {
    sinceOwnerLastMs,
    lastExchangeEnd: lastExchangeEnd(prior),
    ...herSince(prior.slice(prior.lastIndexOf(previousOwner) + 1)),
  };
}

function herSince(after: readonly ExchangeRow[]): { herSince?: number } {
  const count = after.filter((row) => row.role === "ashley").length;
  return count > 0 ? { herSince: count } : {};
}

/** UX W3: game stretches (M2 session episodes) that ended inside the gap. */
function playedMeanwhile(sidecar: DatabaseSync, fromMs: number, toMs: number): { playedMeanwhile?: number } {
  try {
    const row = sidecar.prepare(
      `SELECT COUNT(*) AS n FROM episodes_v2
        WHERE channel LIKE 'domus:%' AND lineage_class = 'current' AND forgotten_at_ms IS NULL
          AND ended_at_ms > ? AND ended_at_ms <= ?`,
    ).get(fromMs, toMs) as { n?: unknown } | undefined;
    const count = Number(row?.n ?? 0);
    return count > 0 ? { playedMeanwhile: count } : {};
  } catch (error) {
    if (missingTable(error) || (error instanceof Error && /no such column/i.test(error.message))) return {};
    throw error;
  }
}

export function loadExchangeRows(sidecar: DatabaseSync, conversationId: string): ExchangeRow[] {
  type EvidenceRow = {
    row_id?: unknown;
    role?: unknown;
    text?: unknown;
    created_at_ms?: unknown;
    sent_at_ms?: unknown;
  };
  let rows: EvidenceRow[];
  try {
    rows = sidecar.prepare(
      `SELECT row_id, role, text, created_at_ms, sent_at_ms
       FROM conversation_evidence_log
       WHERE conversation_id = ?
         AND role IN ('owner', 'ashley')
         AND source_status != 'redacted'
         AND version = (
           SELECT MAX(e2.version) FROM conversation_evidence_log e2
           WHERE e2.lineage_id = conversation_evidence_log.lineage_id
         )
       ORDER BY created_at_ms DESC, rowid DESC
       LIMIT 40`,
    ).all(conversationId) as EvidenceRow[];
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  const chronological: ExchangeRow[] = [];
  for (const row of rows) {
    if (row.role !== "owner" && row.role !== "ashley") continue;
    if (typeof row.row_id !== "string") continue;
    const createdAtMs = typeof row.created_at_ms === "number" ? row.created_at_ms : Number(row.created_at_ms);
    const sentAtMs = typeof row.sent_at_ms === "number" ? row.sent_at_ms : null;
    const atMs = sentAtMs !== null && Number.isFinite(sentAtMs) ? sentAtMs : createdAtMs;
    if (!Number.isFinite(atMs)) continue;
    chronological.push({
      rowId: row.row_id,
      role: row.role,
      text: typeof row.text === "string" ? row.text : "",
      atMs,
    });
  }
  chronological.reverse();
  return chronological;
}

/** afterglow mode also serves her awake time: how things stood since the Owner last wrote. */
export function returningForThought(
  sidecar: DatabaseSync,
  input: {
    mode: "owner_message" | "afterglow";
    conversationId: string;
    currentRowId?: string | null;
    nowMs: number;
  },
): ReturningFacts | null {
  const rows = loadExchangeRows(sidecar, input.conversationId);
  const facts = returningFromRows({
    mode: input.mode,
    rows,
    currentRowId: input.currentRowId,
    nowMs: input.nowMs,
  });
  if (!facts) return null;
  const endMs = input.mode === "owner_message"
    ? rows.find((row) => row.rowId === input.currentRowId)?.atMs ?? input.nowMs
    : input.nowMs;
  return { ...facts, ...playedMeanwhile(sidecar, endMs - facts.sinceOwnerLastMs, endMs) };
}
