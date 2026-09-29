import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { maxClassification, type DataClassification } from "../../privacy/classification.js";
import type { InterestTouch } from "../memory/interests.js";

/**
 * Growth V1 §5.3: the activity journal.
 *
 * Every private pass leaves one entry. The Host records the facts it
 * witnessed (which pass, what Ashley read in that cycle, whether she spoke);
 * Ashley writes the entry itself. It is the only evidence she may describe
 * her time between messages from.
 */

export const JOURNAL_ACTIVITIES = ["think", "read", "plan", "reach_out", "rest", "reflect"] as const;
export type JournalActivity = (typeof JOURNAL_ACTIVITIES)[number];
export type JournalPassKind = "awake" | "afterglow" | "future_trigger" | "private";

export const JOURNAL_ENTRY_MAX_CHARS = 1_000;
export const JOURNAL_READ_REFS_MAX = 8;
export const JOURNAL_THOUGHT_LIMIT = 10;
export const JOURNAL_THOUGHT_WINDOW_MS = 72 * 60 * 60_000;

/** What Ashley authors about a private pass. */
export type JournalClaim = { activity: JournalActivity; entry: string };

/** One thing Ashley read in that cycle, as the Host recorded it. */
export type JournalRead = { observationId: string; modality: string; label?: string };

export type JournalEntry = {
  entryId: string;
  conversationId: string;
  cycleId: string;
  passKind: JournalPassKind;
  activity: JournalActivity | null;
  entry: string | null;
  reads: JournalRead[];
  interests: string[];
  spoke: boolean;
  dataClassification: DataClassification;
  createdAtMs: number;
};

/** Compact journal shape Thought sees. */
export type ThoughtJournalEntry = {
  entryId: string;
  atMs: number;
  pass: JournalPassKind;
  activity?: JournalActivity;
  entry?: string;
  reads?: JournalRead[];
  interests?: string[];
  spoke?: true;
};

type Row = Record<string, unknown>;

const ACTIVITIES = new Set<string>(JOURNAL_ACTIVITIES);

export function isJournalActivity(value: unknown): value is JournalActivity {
  return typeof value === "string" && ACTIVITIES.has(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function classification(value: unknown): DataClassification {
  return value === "sensitive" || value === "never_public" || value === "secret" ? value : "ordinary";
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function journalEntryIdFor(cycleId: string): string {
  return `journal:${createHash("sha256").update(cycleId).digest("hex").slice(0, 32)}`;
}

function readLabel(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = payload as Row;
  for (const key of ["title", "finalUrl", "requestedUrl", "url", "query"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 200);
  }
  return undefined;
}

/**
 * What Ashley read during one cycle: every page or text observation that did
 * not come from her own memory. Mechanical; the Host never judges it.
 */
export function readsForCycle(db: DatabaseSync, cycleId: string): Array<JournalRead & { dataClassification: DataClassification }> {
  return (db.prepare(
    `SELECT observation_id, modality, payload_json, data_classification FROM observations
      WHERE cycle_id = ? AND modality IN ('page', 'text') AND provenance NOT LIKE 'sidecar:%'
      ORDER BY created_at_ms ASC, observation_id ASC LIMIT ?`,
  ).all(cycleId, JOURNAL_READ_REFS_MAX) as Row[]).map((row) => {
    const label = readLabel(parseJson<unknown>(row.payload_json, null));
    return {
      observationId: text(row.observation_id),
      modality: text(row.modality),
      ...(label ? { label } : {}),
      dataClassification: classification(row.data_classification),
    };
  });
}

/**
 * Record the journal entry for one private cycle. Idempotent per cycle.
 * A "read" with nothing read in the cycle keeps Ashley's words but loses the
 * label: the journal records reading only where the Host saw it.
 */
export function recordJournalEntry(
  db: DatabaseSync,
  input: {
    conversationId: string;
    cycleId: string;
    passKind: JournalPassKind;
    claim?: JournalClaim;
    interests?: readonly InterestTouch[];
    spoke: boolean;
    nowMs: number;
  },
): { entryId: string; activity: JournalActivity | null; readRefs: number } {
  const reads = readsForCycle(db, input.cycleId);
  const claimed = input.claim?.activity ?? null;
  const activity = claimed === "read" && reads.length === 0 ? null : claimed;
  const entry = input.claim?.entry.trim().slice(0, JOURNAL_ENTRY_MAX_CHARS) || null;
  const entryId = journalEntryIdFor(input.cycleId);
  db.prepare(
    `INSERT OR IGNORE INTO activity_journal
       (entry_id, conversation_id, cycle_id, pass_kind, activity, entry, read_refs_json, interests_json, spoke, data_classification, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entryId,
    input.conversationId,
    input.cycleId,
    input.passKind,
    activity,
    entry,
    JSON.stringify(reads.map(({ dataClassification: _classification, ...read }) => read)),
    JSON.stringify((input.interests ?? []).map((touch) => `${touch.root} / ${touch.branch}`)),
    input.spoke ? 1 : 0,
    maxClassification("ordinary", ...reads.map((read) => read.dataClassification)),
    input.nowMs,
  );
  return { entryId, activity, readRefs: reads.length };
}

function mapEntry(row: Row): JournalEntry {
  return {
    entryId: text(row.entry_id),
    conversationId: text(row.conversation_id),
    cycleId: text(row.cycle_id),
    passKind: (["awake", "afterglow", "future_trigger"].includes(text(row.pass_kind)) ? text(row.pass_kind) : "private") as JournalPassKind,
    activity: isJournalActivity(row.activity) ? row.activity : null,
    entry: typeof row.entry === "string" ? row.entry : null,
    reads: parseJson<JournalRead[]>(row.read_refs_json, []),
    interests: parseJson<string[]>(row.interests_json, []),
    spoke: Number(row.spoke) === 1,
    dataClassification: classification(row.data_classification),
    createdAtMs: Number(row.created_at_ms ?? 0),
  };
}

/** Recent live entries, newest first. Secret entries never leave the store. */
export function listRecentJournal(
  db: DatabaseSync,
  input: { sinceMs?: number; limit: number },
): JournalEntry[] {
  return (db.prepare(
    `SELECT * FROM activity_journal
      WHERE forgotten_at_ms IS NULL AND created_at_ms >= ? AND data_classification != 'secret'
      ORDER BY created_at_ms DESC, entry_id DESC LIMIT ?`,
  ).all(input.sinceMs ?? 0, Math.max(1, input.limit)) as Row[]).map(mapEntry);
}

export function toThoughtJournalEntry(entry: JournalEntry): ThoughtJournalEntry {
  return {
    entryId: entry.entryId,
    atMs: entry.createdAtMs,
    pass: entry.passKind,
    ...(entry.activity ? { activity: entry.activity } : {}),
    ...(entry.entry ? { entry: entry.entry } : {}),
    ...(entry.reads.length > 0 ? { reads: entry.reads } : {}),
    ...(entry.interests.length > 0 ? { interests: entry.interests } : {}),
    ...(entry.spoke ? { spoke: true as const } : {}),
  };
}

export function journalForThought(db: DatabaseSync, nowMs: number): ThoughtJournalEntry[] {
  return listRecentJournal(db, { sinceMs: nowMs - JOURNAL_THOUGHT_WINDOW_MS, limit: JOURNAL_THOUGHT_LIMIT })
    .map(toThoughtJournalEntry);
}

/** Entries that mention a forgotten topic, or cite a read that a forget redacted. */
export function journalEntryIdsForForget(
  db: DatabaseSync,
  topic: string,
  forgottenObservationIds: readonly string[] = [],
): string[] {
  const needle = topic.trim().toLowerCase();
  const forgotten = new Set(forgottenObservationIds);
  return (db.prepare("SELECT entry_id, entry, read_refs_json, interests_json FROM activity_journal WHERE forgotten_at_ms IS NULL").all() as Row[])
    .filter((row) => {
      const words = `${text(row.entry)}\n${text(row.read_refs_json)}\n${text(row.interests_json)}`.toLowerCase();
      if (needle && words.includes(needle)) return true;
      return parseJson<JournalRead[]>(row.read_refs_json, []).some((read) => forgotten.has(read.observationId));
    })
    .map((row) => text(row.entry_id));
}

/** The Host facts stay (a pass happened); Ashley's words and the reads go. */
export function forgetJournalEntry(db: DatabaseSync, entryId: string, nowMs: number): number {
  return Number(db.prepare(
    `UPDATE activity_journal SET entry = NULL, read_refs_json = '[]', interests_json = '[]', forgotten_at_ms = ?
      WHERE entry_id = ? AND forgotten_at_ms IS NULL`,
  ).run(nowMs, entryId).changes ?? 0);
}
