// E4: the User's word watch. A private list of words and phrases (a file only the host reads, never in
// this repository) is matched against every line of hers: what she says, her journal, diary and
// self-narratives, what she writes or drafts for her places, the web places she asks for and the requests
// she makes. A match is flagged for the User to review. A flag is a pointer for a human and claims nothing;
// it lives in the host's observability store, and nothing of it reaches her.
import { readFileSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export const WATCH_SURFACES = ["speech", "journal", "diary", "narrative", "place_post", "place_draft", "web_place", "web_request"] as const;
export type WatchSurface = (typeof WATCH_SURFACES)[number];
export type WatchFlag = { id: number; surface: WatchSurface; ref: string; atMs: number; excerpt: string };

const EXCERPT_CHARS = 300;
const SCAN_LIMIT = 500;

/** Each surface: its rows of her own words, keyed and timed. */
const SOURCES: Record<WatchSurface, string> = {
  speech: "SELECT row_id AS ref, text, created_at_ms AS at FROM conversation_evidence_log WHERE role = 'ashley' AND created_at_ms > ?",
  journal: "SELECT entry_id AS ref, entry AS text, created_at_ms AS at FROM activity_journal WHERE created_at_ms > ?",
  diary: "SELECT entry_id AS ref, text, created_at_ms AS at FROM diary_entries WHERE created_at_ms > ?",
  narrative: "SELECT narrative_id AS ref, text, created_at_ms AS at FROM self_narratives WHERE created_at_ms > ?",
  place_post: "SELECT intent_id AS ref, place_ref || ': ' || say AS text, requested_at_ms AS at FROM place_intents WHERE requested_at_ms > ?",
  place_draft: "SELECT wish_id AS ref, place_ref || ': ' || draft AS text, requested_at_ms AS at FROM place_wishes WHERE requested_at_ms > ?",
  web_place: "SELECT origin || ':' || updated_at_ms AS ref, origin || ' ' || coalesce(reason, '') AS text, updated_at_ms AS at FROM web_places WHERE updated_at_ms > ?",
  web_request: "SELECT CAST(request_id AS TEXT) AS ref, origin || path AS text, at_ms AS at FROM web_requests WHERE at_ms > ?",
};

let cached: { path: string; stamp: number; terms: RegExp[] } | null = null;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The watch list: one word or phrase per line, `#` for comments. Missing file: no terms, no watch. */
export function loadWatchTerms(path: string): RegExp[] {
  let stamp: number;
  try { stamp = statSync(path).mtimeMs; } catch { return []; }
  if (cached && cached.path === path && cached.stamp === stamp) return cached.terms;
  const terms = readFileSync(path, "utf8").split(/\r?\n/).map(line => line.trim())
    .filter(line => line.length >= 3 && !line.startsWith("#"))
    .map(term => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, "iu"));
  cached = { path, stamp, terms };
  return terms;
}

export function initWordWatch(observability: DatabaseSync): void {
  observability.exec(`
    CREATE TABLE IF NOT EXISTS word_watch_state (surface TEXT PRIMARY KEY, since_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS word_watch_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surface TEXT NOT NULL,
      ref TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      excerpt TEXT NOT NULL,
      flagged_at_ms INTEGER NOT NULL,
      UNIQUE (surface, ref)
    );`);
}

/**
 * One pass over every surface since its watermark. A first pass starts from now: the watch looks
 * forward, it never sweeps her past. Returns the new flags.
 */
export function scanWordWatch(sidecar: DatabaseSync, observability: DatabaseSync, input: { terms: readonly RegExp[]; nowMs: number }): WatchFlag[] {
  if (input.terms.length === 0) return [];
  initWordWatch(observability);
  const readSince = observability.prepare("SELECT since_ms FROM word_watch_state WHERE surface = ?");
  const writeSince = observability.prepare(`INSERT INTO word_watch_state (surface, since_ms) VALUES (?, ?)
    ON CONFLICT(surface) DO UPDATE SET since_ms = excluded.since_ms`);
  const flag = observability.prepare(`INSERT OR IGNORE INTO word_watch_flags (surface, ref, at_ms, excerpt, flagged_at_ms)
    VALUES (?, ?, ?, ?, ?)`);
  const flags: WatchFlag[] = [];
  for (const surface of WATCH_SURFACES) {
    const known = readSince.get(surface) as { since_ms?: number } | undefined;
    if (known?.since_ms === undefined) { writeSince.run(surface, input.nowMs); continue; }
    let rows: Array<Record<string, unknown>>;
    try {
      rows = sidecar.prepare(`${SOURCES[surface]} ORDER BY at ASC LIMIT ${SCAN_LIMIT}`).all(Number(known.since_ms)) as Array<Record<string, unknown>>;
    } catch { continue; }
    let since = Number(known.since_ms);
    for (const row of rows) {
      const at = Number(row.at);
      since = Math.max(since, at);
      const text = typeof row.text === "string" ? row.text : "";
      if (!text || !input.terms.some(term => term.test(text))) continue;
      const excerpt = text.slice(0, EXCERPT_CHARS);
      const inserted = flag.run(surface, String(row.ref), at, excerpt, input.nowMs);
      if (Number(inserted.changes) > 0) {
        flags.push({ id: Number(inserted.lastInsertRowid), surface, ref: String(row.ref), atMs: at, excerpt });
      }
    }
    writeSince.run(surface, since);
  }
  return flags;
}

/** Flags raised in the last window, ids and times only (the helper saves the recording around them). */
export function recentWatchMarks(observability: DatabaseSync, sinceMs: number): Array<{ id: number; at_ms: number }> {
  try {
    return (observability.prepare("SELECT id, flagged_at_ms FROM word_watch_flags WHERE flagged_at_ms >= ? ORDER BY id")
      .all(sinceMs) as Array<Record<string, unknown>>).map(row => ({ id: Number(row.id), at_ms: Number(row.flagged_at_ms) }));
  } catch { return []; }
}

/** The User's private review channel (a webhook where she is not present). Never logs the URL or the words. */
export async function notifyWatch(webhook: string, flags: readonly WatchFlag[], fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!webhook || flags.length === 0) return false;
  const content = flags.slice(0, 5).map(item =>
    `Flag for review · ${item.surface} · ${new Date(item.atMs).toISOString()}\n> ${item.excerpt.replace(/\n/g, " ")}`).join("\n\n");
  try {
    const response = await fetcher(webhook, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }) });
    return response.ok;
  } catch { return false; }
}
