import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { maxClassification, type DataClassification } from "../../privacy/classification.js";
import { REDACTED_MEMORY_STATEMENT } from "./assertions.js";
import { lookupTerms } from "./lookup-terms.js";
import type { MemoryChannel, MemoryLineageClass } from "../types.js";

/**
 * Growth V1 §4.4: episodes and the thread story.
 *
 * Ashley writes both during an afterglow reflection. The Host only stores
 * them, links an episode to the exact conversation rows it covers, and
 * forgets them. It never writes their content.
 */

export const EPISODE_SUMMARY_MAX_CHARS = 1_200;
export const EPISODE_TAKEAWAY_MAX_CHARS = 600;
export const EPISODE_TONE_MAX_CHARS = 80;
export const EPISODE_UNRESOLVED_MAX_ITEMS = 8;
export const EPISODE_UNRESOLVED_MAX_CHARS = 200;
export const THREAD_STORY_MAX_CHARS = 6_000;

/** What Thought authors about one stretch of conversation. */
export type EpisodeReflection = {
  summary: string;
  salience: number;
  tone?: string;
  unresolvedThreads?: string[];
  takeaway?: string;
};

export type EpisodeRecord = {
  episodeId: string;
  conversationId: string;
  cycleId: string;
  startedAtMs: number;
  endedAtMs: number;
  evidenceRowIds: string[];
  summary: string;
  tone: string | null;
  salience: number;
  unresolvedThreads: string[];
  takeaway: string | null;
  dataClassification: DataClassification;
  createdAtMs: number;
  channel: MemoryChannel;
  lineageClass: MemoryLineageClass;
};

/** Compact episode shape Thought sees. */
export type ThoughtEpisode = {
  episodeId: string;
  startedAtMs: number;
  endedAtMs: number;
  summary: string;
  tone?: string;
  unresolvedThreads?: string[];
  takeaway?: string;
  channel?: `domus:${string}`;
};

export type ThreadStory = {
  conversationId: string;
  story: string;
  throughRowId: string | null;
  writtenAtMs: number;
};

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function classification(value: unknown): DataClassification {
  return value === "sensitive" || value === "never_public" || value === "secret" ? value : "ordinary";
}

function mapEpisode(row: unknown): EpisodeRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as Row;
  return {
    episodeId: text(value.episode_id),
    conversationId: text(value.conversation_id),
    cycleId: text(value.cycle_id),
    startedAtMs: number(value.started_at_ms),
    endedAtMs: number(value.ended_at_ms),
    evidenceRowIds: stringArray(value.evidence_row_ids_json),
    summary: text(value.summary),
    tone: typeof value.tone === "string" ? value.tone : null,
    salience: number(value.salience),
    unresolvedThreads: stringArray(value.unresolved_threads_json),
    takeaway: typeof value.ashley_takeaway === "string" ? value.ashley_takeaway : null,
    dataClassification: classification(value.data_classification),
    createdAtMs: number(value.created_at_ms),
    channel: memoryChannel(value.channel),
    lineageClass: memoryLineageClass(value.lineage_class),
  };
}

function memoryChannel(value: unknown): MemoryChannel {
  if (value === "discord") return "discord";
  if (typeof value === "string" && value.startsWith("domus:") && value.length > "domus:".length) {
    return value as MemoryChannel;
  }
  return "discord";
}

function memoryLineageClass(value: unknown): MemoryLineageClass {
  return value === "undone" ? "undone" : "current";
}

/** One episode per reflection cycle: the id is derived, so a replay cannot duplicate it. */
export function episodeIdFor(cycleId: string, firstRowId: string): string {
  return `episode:${createHash("sha256").update(`${cycleId}\n${firstRowId}`).digest("hex").slice(0, 32)}`;
}

function clampText(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

export function recordEpisode(
  db: DatabaseSync,
  input: {
    conversationId: string;
    cycleId: string;
    rows: ReadonlyArray<{ rowId: string; createdAtMs: number; dataClassification: DataClassification }>;
    reflection: EpisodeReflection;
    nowMs: number;
    channel?: MemoryChannel;
  },
): EpisodeRecord | null {
  const first = input.rows[0];
  const last = input.rows[input.rows.length - 1];
  const summary = clampText(input.reflection.summary, EPISODE_SUMMARY_MAX_CHARS);
  if (!first || !last || !summary) return null;
  const episodeId = episodeIdFor(input.cycleId, first.rowId);
  const takeaway = input.reflection.takeaway ? clampText(input.reflection.takeaway, EPISODE_TAKEAWAY_MAX_CHARS) : null;
  const tone = input.reflection.tone ? clampText(input.reflection.tone, EPISODE_TONE_MAX_CHARS) : null;
  const unresolved = (input.reflection.unresolvedThreads ?? [])
    .map((item) => clampText(item, EPISODE_UNRESOLVED_MAX_CHARS))
    .filter(Boolean)
    .slice(0, EPISODE_UNRESOLVED_MAX_ITEMS);
  const salience = Math.min(1, Math.max(0, Number.isFinite(input.reflection.salience) ? input.reflection.salience : 0.5));
  const inserted = db.prepare(
    `INSERT OR IGNORE INTO episodes_v2
       (episode_id, conversation_id, cycle_id, started_at_ms, ended_at_ms, evidence_row_ids_json,
        summary, tone, salience, unresolved_threads_json, ashley_takeaway, data_classification, created_at_ms,
        channel, lineage_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current')`,
  ).run(
    episodeId,
    input.conversationId,
    input.cycleId,
    first.createdAtMs,
    last.createdAtMs,
    JSON.stringify(input.rows.map((row) => row.rowId)),
    summary,
    tone,
    salience,
    JSON.stringify(unresolved),
    takeaway,
    maxClassification(...input.rows.map((row) => row.dataClassification)),
    input.nowMs,
    input.channel ?? "discord",
  );
  if (number(inserted.changes) > 0) {
    db.prepare("INSERT INTO episodes_v2_fts (episode_id, summary, ashley_takeaway) VALUES (?, ?, ?)")
      .run(episodeId, summary, takeaway ?? "");
  }
  return getEpisode(db, episodeId);
}

export function getEpisode(db: DatabaseSync, episodeId: string): EpisodeRecord | null {
  return mapEpisode(db.prepare("SELECT * FROM episodes_v2 WHERE episode_id = ? AND forgotten_at_ms IS NULL").get(episodeId));
}

export function listRecentEpisodes(db: DatabaseSync, limit: number): EpisodeRecord[] {
  return db.prepare(
    `SELECT * FROM episodes_v2
      WHERE forgotten_at_ms IS NULL AND lineage_class = 'current'
      ORDER BY ended_at_ms DESC, created_at_ms DESC
      LIMIT ?`,
  ).all(Math.max(1, Math.floor(limit)))
    .map(mapEpisode)
    .filter((episode): episode is EpisodeRecord => episode !== null);
}

function ftsQuery(terms: readonly string[]): string | null {
  const cleaned = lookupTerms(terms.join(" ")).slice(0, 24);
  return cleaned.length === 0 ? null : cleaned.map((term) => `"${term}"`).join(" OR ");
}

/** Episodes whose summary or takeaway mention any term, best match first. */
export function searchEpisodes(db: DatabaseSync, terms: readonly string[], limit: number): EpisodeRecord[] {
  const query = ftsQuery(terms);
  if (!query) return [];
  return db.prepare(
    `SELECT e.* FROM episodes_v2_fts f
       JOIN episodes_v2 e ON e.episode_id = f.episode_id
      WHERE episodes_v2_fts MATCH ? AND e.forgotten_at_ms IS NULL AND e.lineage_class = 'current'
      ORDER BY bm25(episodes_v2_fts), e.ended_at_ms DESC
      LIMIT ?`,
  ).all(query, Math.max(1, Math.floor(limit)))
    .map(mapEpisode)
    .filter((episode): episode is EpisodeRecord => episode !== null);
}

export function toThoughtEpisode(episode: EpisodeRecord): ThoughtEpisode {
  return {
    episodeId: episode.episodeId,
    startedAtMs: episode.startedAtMs,
    endedAtMs: episode.endedAtMs,
    summary: episode.summary,
    ...(episode.tone ? { tone: episode.tone } : {}),
    ...(episode.unresolvedThreads.length > 0 ? { unresolvedThreads: [...episode.unresolvedThreads] } : {}),
    ...(episode.takeaway ? { takeaway: episode.takeaway } : {}),
    ...(episode.channel !== "discord" ? { channel: episode.channel } : {}),
  };
}

/** The recent episodes plus the ones this moment brings to mind. */
/** M1/M2: the latest stretch of play stays in view of a Discord turn for this long. */
export const LATEST_GAME_EPISODE_MS = 3 * 24 * 60 * 60_000;

export function episodesForThought(
  db: DatabaseSync,
  terms: readonly string[],
  limits: { recent: number; matched: number } = { recent: 3, matched: 3 },
  nowMs?: number,
): ThoughtEpisode[] {
  const recent = listRecentEpisodes(db, limits.recent);
  // M1: the latest game session summary rides along even when talk has pushed it out of the recent ones.
  if (nowMs !== undefined && !recent.some((episode) => episode.channel !== "discord")) {
    const game = mapEpisode(db.prepare(`SELECT * FROM episodes_v2 WHERE forgotten_at_ms IS NULL AND lineage_class = 'current'
      AND channel LIKE 'domus:%' AND ended_at_ms >= ? ORDER BY ended_at_ms DESC LIMIT 1`).get(nowMs - LATEST_GAME_EPISODE_MS));
    if (game) recent.push(game);
  }
  const seen = new Set(recent.map((episode) => episode.episodeId));
  const matched = searchEpisodes(db, terms, limits.matched + recent.length)
    .filter((episode) => !seen.has(episode.episodeId))
    .slice(0, limits.matched);
  return [...recent, ...matched]
    .sort((a, b) => a.endedAtMs - b.endedAtMs)
    .map(toThoughtEpisode);
}

export function getThreadStory(db: DatabaseSync, conversationId: string): ThreadStory | null {
  const row = db.prepare(
    "SELECT * FROM thread_stories WHERE conversation_id = ? AND forgotten_at_ms IS NULL",
  ).get(conversationId) as Row | undefined;
  if (!row || !text(row.story)) return null;
  return {
    conversationId,
    story: text(row.story),
    throughRowId: typeof row.through_row_id === "string" ? row.through_row_id : null,
    writtenAtMs: number(row.written_at_ms),
  };
}

export function writeThreadStory(
  db: DatabaseSync,
  input: {
    conversationId: string;
    story: string;
    throughRowId: string | null;
    cycleId: string;
    dataClassification: DataClassification;
    nowMs: number;
  },
): void {
  const story = clampText(input.story, THREAD_STORY_MAX_CHARS);
  if (!story) return;
  db.prepare(
    `INSERT INTO thread_stories
       (conversation_id, story, through_row_id, cycle_id, data_classification, written_at_ms, forgotten_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(conversation_id) DO UPDATE SET
       story = excluded.story,
       through_row_id = excluded.through_row_id,
       cycle_id = excluded.cycle_id,
       data_classification = excluded.data_classification,
       written_at_ms = excluded.written_at_ms,
       forgotten_at_ms = NULL`,
  ).run(input.conversationId, story, input.throughRowId, input.cycleId, input.dataClassification, input.nowMs);
}

// --- Forget cascade -------------------------------------------------------

function mentions(value: unknown, topic: string): boolean {
  return typeof value === "string" && value.toLocaleLowerCase().includes(topic.toLocaleLowerCase());
}

/**
 * Episodes a forget reaches: any whose own words mention the topic, and any
 * built from a conversation row the same forget redacts.
 */
export function episodeIdsForForget(
  db: DatabaseSync,
  topic: string,
  forgottenEvidenceIds: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const row of db.prepare(
    `SELECT episode_id, summary, tone, ashley_takeaway, unresolved_threads_json, evidence_row_ids_json
       FROM episodes_v2 WHERE forgotten_at_ms IS NULL`,
  ).all() as Row[]) {
    const linked = stringArray(row.evidence_row_ids_json).some((id) => forgottenEvidenceIds.has(id));
    const named = [row.summary, row.tone, row.ashley_takeaway, row.unresolved_threads_json]
      .some((value) => mentions(value, topic));
    if (linked || named) ids.push(text(row.episode_id));
  }
  return ids;
}

/**
 * Thread stories a forget reaches. A story retells the whole conversation, so
 * a forget that redacts any of its rows retires the story too; the next
 * afterglow writes a fresh one from what remains.
 */
export function threadStoryIdsForForget(
  db: DatabaseSync,
  topic: string,
  forgottenEvidenceIds: ReadonlySet<string>,
): string[] {
  const forgottenConversations = new Set<string>();
  for (const id of forgottenEvidenceIds) {
    const row = db.prepare("SELECT conversation_id FROM conversation_evidence_log WHERE row_id = ?").get(id) as Row | undefined;
    if (row) forgottenConversations.add(text(row.conversation_id));
  }
  return (db.prepare("SELECT conversation_id, story FROM thread_stories WHERE forgotten_at_ms IS NULL").all() as Row[])
    .filter((row) => mentions(row.story, topic) || forgottenConversations.has(text(row.conversation_id)))
    .map((row) => text(row.conversation_id));
}

export function forgetEpisode(db: DatabaseSync, episodeId: string, nowMs: number): number {
  const changed = db.prepare(
    `UPDATE episodes_v2
        SET summary = ?, tone = NULL, ashley_takeaway = NULL, unresolved_threads_json = '[]', forgotten_at_ms = ?
      WHERE episode_id = ?`,
  ).run(REDACTED_MEMORY_STATEMENT, nowMs, episodeId);
  db.prepare("DELETE FROM episodes_v2_fts WHERE episode_id = ?").run(episodeId);
  return number(changed.changes);
}

export function forgetThreadStory(db: DatabaseSync, conversationId: string, nowMs: number): number {
  return number(db.prepare(
    "UPDATE thread_stories SET story = ?, forgotten_at_ms = ? WHERE conversation_id = ?",
  ).run(REDACTED_MEMORY_STATEMENT, nowMs, conversationId).changes);
}
