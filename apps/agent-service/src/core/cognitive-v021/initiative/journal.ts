import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { maxClassification, type DataClassification } from "../../privacy/classification.js";
import type { InterestTouch } from "../memory/interests.js";
import type { MemoryChannel, MemoryLineageClass } from "../types.js";

/**
 * Growth V1 §5.3: the activity journal.
 *
 * Every private pass leaves one entry. The Host records the facts it
 * witnessed (which pass, what Ashley read in that cycle, whether she spoke);
 * "spoke" is read from delivered Ashley evidence for the cycle, never from a
 * send that was only queued, so a suppressed or failed send never reads as
 * spoken (R11);
 * Ashley writes the entry itself. It is the only evidence she may describe
 * her time between messages from.
 */

export const JOURNAL_ACTIVITIES = ["think", "read", "plan", "reach_out", "rest", "reflect"] as const;
export type JournalActivity = (typeof JOURNAL_ACTIVITIES)[number];
export type JournalPassKind = "awake" | "afterglow" | "night" | "future_trigger" | "private";

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
  channel: MemoryChannel;
  lineageClass: MemoryLineageClass;
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
  channel?: `domus:${string}`;
  /** H0.4: this many passes in a row left no entry (nothing new), from sinceMs to atMs. */
  quiet?: number;
  sinceMs?: number;
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
    /** Speech was queued for delivery; stored for audit. Readers see "spoke" only once it is delivered. */
    spoke: boolean;
    nowMs: number;
    dataClassification?: DataClassification;
    channel?: MemoryChannel;
  },
): { entryId: string; activity: JournalActivity | null; readRefs: number } {
  const reads = readsForCycle(db, input.cycleId);
  const claimed = input.claim?.activity ?? null;
  const activity = claimed === "read" && reads.length === 0 ? null : claimed;
  const entry = input.claim?.entry.trim().slice(0, JOURNAL_ENTRY_MAX_CHARS) || null;
  const entryId = journalEntryIdFor(input.cycleId);
  db.prepare(
    `INSERT OR IGNORE INTO activity_journal
       (entry_id, conversation_id, cycle_id, pass_kind, activity, entry, read_refs_json, interests_json, spoke, data_classification, created_at_ms, channel, lineage_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current')`,
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
    maxClassification(input.dataClassification ?? "ordinary", ...reads.map((read) => read.dataClassification)),
    input.nowMs,
    input.channel ?? "discord",
  );
  return { entryId, activity, readRefs: reads.length };
}

function mapEntry(row: Row): JournalEntry {
  return {
    entryId: text(row.entry_id),
    conversationId: text(row.conversation_id),
    cycleId: text(row.cycle_id),
    passKind: (["awake", "afterglow", "night", "future_trigger"].includes(text(row.pass_kind)) ? text(row.pass_kind) : "private") as JournalPassKind,
    activity: isJournalActivity(row.activity) ? row.activity : null,
    entry: typeof row.entry === "string" ? row.entry : null,
    reads: parseJson<JournalRead[]>(row.read_refs_json, []),
    interests: parseJson<string[]>(row.interests_json, []),
    spoke: Number(row.delivered_speech) === 1,
    dataClassification: classification(row.data_classification),
    createdAtMs: Number(row.created_at_ms ?? 0),
    channel: memoryChannel(row.channel),
    lineageClass: memoryLineageClass(row.lineage_class),
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

/**
 * A journal lane: one channel, or every game lane (`domus`). spokenToo (M1) adds an entry of
 * another lane whose pass delivered speech: what she said to someone always shows.
 */
export type JournalLane = { channel?: MemoryChannel | "domus"; spokenToo?: boolean };

/** Recent live entries, newest first. Secret entries never leave the store. */
export function listRecentJournal(
  db: DatabaseSync,
  input: { sinceMs?: number; limit: number } & JournalLane,
): JournalEntry[] {
  const channel = input.channel === "domus" ? null : input.channel ?? null;
  const domus = input.channel === "domus" ? 1 : 0;
  return (db.prepare(
    `SELECT j.*, EXISTS (
         SELECT 1 FROM conversation_evidence_log e
          WHERE e.producing_cycle_id = j.cycle_id AND e.role = 'ashley' AND e.delivered = 1
       ) AS delivered_speech
       FROM activity_journal j
      WHERE j.forgotten_at_ms IS NULL AND j.created_at_ms >= ? AND j.data_classification != 'secret' AND j.lineage_class = 'current'
        AND (((? IS NULL OR j.channel = ?) AND (? = 0 OR j.channel LIKE 'domus:%'))
          OR (? = 1 AND EXISTS (SELECT 1 FROM conversation_evidence_log e
               WHERE e.producing_cycle_id = j.cycle_id AND e.role = 'ashley' AND e.delivered = 1)))
      ORDER BY j.created_at_ms DESC, j.entry_id DESC LIMIT ?`,
  ).all(input.sinceMs ?? 0, channel, channel, domus, input.spokenToo ? 1 : 0, Math.max(1, input.limit)) as Row[]).map(mapEntry);
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
    ...(entry.channel !== "discord" ? { channel: entry.channel } : {}),
  };
}

/** A pass that left nothing to read: no words, no reads, no speech. */
function wordless(entry: JournalEntry): boolean {
  return entry.entry === null && entry.reads.length === 0 && !entry.spoke;
}

/**
 * H0.4 (live 2026-10-05: one game hour of check-ins pushed every Discord entry out of view):
 * consecutive wordless passes on one channel read as one line, "n quiet passes from sinceMs to
 * atMs". Entries are newest first; so is the result.
 */
export function collapseQuietRuns(entries: readonly JournalEntry[]): ThoughtJournalEntry[] {
  const result: ThoughtJournalEntry[] = [];
  let run: { newest: JournalEntry; oldestAtMs: number; count: number } | null = null;
  const flush = () => {
    if (!run) return;
    result.push({ ...toThoughtJournalEntry(run.newest), quiet: run.count, sinceMs: run.oldestAtMs });
    run = null;
  };
  for (const entry of entries) {
    if (wordless(entry) && run && run.newest.channel === entry.channel && run.newest.passKind === entry.passKind) {
      run.count += 1;
      run.oldestAtMs = entry.createdAtMs;
      continue;
    }
    flush();
    if (wordless(entry)) run = { newest: entry, oldestAtMs: entry.createdAtMs, count: 1 };
    else result.push(toThoughtJournalEntry(entry));
  }
  flush();
  return result;
}

/** How many raw rows a collapsed read looks through for its items. */
export const JOURNAL_COLLAPSE_SCAN = 256;

/** Recent entries with quiet runs collapsed, newest first, up to limit items; one channel when given. */
export function recentJournalCollapsed(
  db: DatabaseSync,
  input: { sinceMs?: number; limit: number } & JournalLane,
): ThoughtJournalEntry[] {
  const { limit, ...lane } = input;
  const rows = listRecentJournal(db, { ...lane, limit: JOURNAL_COLLAPSE_SCAN });
  return collapseQuietRuns(rows).slice(0, Math.max(1, limit));
}

/**
 * What Thought reads: a Domus pass reads its own world's lane (H0.3); every other pass the Discord
 * lane plus any game pass that spoke (M1, live 2026-10-05: an hour of game check-ins pushed every
 * Discord entry out of her Discord turns). The game reaches those turns as domusNow and, once a
 * stretch of play is over, its session episode.
 */
export function journalForThought(db: DatabaseSync, nowMs: number, channel?: MemoryChannel): ThoughtJournalEntry[] {
  const lane: JournalLane = channel ? { channel } : { channel: "discord", spokenToo: true };
  return recentJournalCollapsed(db, { sinceMs: nowMs - JOURNAL_THOUGHT_WINDOW_MS, limit: JOURNAL_THOUGHT_LIMIT, ...lane });
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
