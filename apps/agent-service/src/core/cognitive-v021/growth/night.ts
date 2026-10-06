import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
import { hashMemoryAssertion, listLiveMemoryAssertions, REDACTED_MEMORY_STATEMENT } from "../memory/assertions.js";
import { getMemoryStrength, recordMemoryFormation } from "../memory/strength.js";
import { listRecentEpisodes, toThoughtEpisode, type ThoughtEpisode } from "../memory/episodes.js";
import { listInterestBranches } from "../memory/interests.js";
import { recentJournalCollapsed, type ThoughtJournalEntry } from "../initiative/journal.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";
import type { NightPass } from "../initiative/inner-pass.js";
import { listAppliedRevisions, revisableIdentityEntries } from "./revisions.js";
import { applyWeeklyGaps, listActiveDimensions } from "./dimensions.js";
import type { IdentityStore } from "./growth.js";

/**
 * Growth V1 §5.4 and §6.6: what a NIGHT pass sees and what it leaves.
 *
 * The Host gathers the day (episodes, journal), her memories with the pairs
 * whose words overlap most, her self-evidence, questions that went stale,
 * her taste line beside her strongest interest branches, and on a weekly
 * night the week. It judges nothing: which memories are duplicates, what
 * matters, which question is dead, and whether her taste changed are all
 * Ashley's calls. She merges memories with ordinary `durableNominations`
 * (`supersedesRef`), proposes revisions with `growth.revisions`, and uses
 * `night` for the rest: the diary, re-scored salience, closed questions,
 * and the weekly "who I am becoming" narrative.
 */

export const NIGHT_MEMORIES_LIMIT = 40;
export const NIGHT_SIMILAR_PAIRS_LIMIT = 12;
export const NIGHT_SIMILARITY_THRESHOLD = 0.5;
export const NIGHT_SELF_EVIDENCE_LIMIT = 20;
export const NIGHT_STALE_QUESTIONS_LIMIT = 10;
/** As many as the AWAKE agenda: the eight seeds must not crowd out what she has started living. */
export const NIGHT_BRANCHES_LIMIT = 16;
export const NIGHT_DAY_EPISODES_LIMIT = 12;
export const NIGHT_DAY_JOURNAL_LIMIT = 16;
/** A question nobody touched for two weeks is offered for closing. */
export const STALE_QUESTION_AGE_MS = 14 * 24 * 60 * 60_000;
export const DIARY_MAX_CHARS = 1_500;
export const NARRATIVE_MAX_CHARS = 2_500;
export const NIGHT_SALIENCE_MAX = 20;
export const NIGHT_CLOSE_QUESTIONS_MAX = 10;

/** What a night settlement may author. */
export type NightClaim = {
  diary?: string;
  salience?: Array<{ key: string; salience: number }>;
  closeQuestions?: string[];
  narrative?: string;
  gaps?: {
    dimensions?: Array<{ id: string; score: number; note?: string; supportRefs?: string[] }>;
    choose?: string;
    edits?: Array<{ op: "add" | "rename" | "retire"; id?: string; name?: string; question?: string; reason?: string }>;
  };
};

export type ThoughtNightAgenda = {
  sinceMs: number;
  weekly: boolean;
  day: { episodes: ThoughtEpisode[]; journal: ThoughtJournalEntry[] };
  memories: Array<{ key: string; kind: string; statement: string; salience: number; formedAtMs: number | null; uses: number }>;
  /** Pairs whose words overlap most; only a hint, never a verdict. */
  similar: Array<{ keys: [string, string]; overlap: number }>;
  selfEvidence: Array<{ key: string; statement: string; formedAtMs: number | null }>;
  staleQuestions: Array<{ key: string; statement: string; formedAtMs: number | null }>;
  taste: {
    entries: Array<{ entryId: number; text: string }>;
    branches: Array<{ branchId: string; root: string; branch: string; strength: number; livedCount: number }>;
  };
  week?: {
    sinceMs: number;
    episodes: ThoughtEpisode[];
    changes: Array<{ layer: string; text: string; appliedAtMs: number }>;
    previousNarrative?: { text: string; writtenAtMs: number };
  };
  /** Present only when this weekly pass has active dimensions to feel against. */
  dimensions?: Array<{ id: string; name: string; question: string }>;
};

type Row = Record<string, unknown>;

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3));
}

/** Jaccard overlap of the words two statements share. Mechanical, not a judgement of sameness. */
export function wordOverlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function visibleMemory(statement: string, classification: DataClassification): boolean {
  return statement !== REDACTED_MEMORY_STATEMENT && classification !== "secret";
}

export function buildNightAgenda(
  db: DatabaseSync,
  input: { pass: NightPass; identityStore: IdentityStore | null; nowMs: number },
): ThoughtNightAgenda {
  const { pass, nowMs } = input;
  const live = listLiveMemoryAssertions(db)
    .filter((assertion) => visibleMemory(assertion.statement, assertion.dataClassification)
      && (!assertion.audienceScope || assertion.audienceScope.kind === "owner_private"))
    .map((assertion) => {
      const strength = getMemoryStrength(db, assertion.assertionKey);
      return {
        key: assertion.assertionKey,
        kind: assertion.memoryKind,
        statement: assertion.statement,
        salience: strength?.salience ?? 0.5,
        formedAtMs: strength?.formedAtMs ?? null,
        uses: (strength?.useCount ?? 0) + (strength?.recallCount ?? 0),
        lastTouchedMs: Math.max(strength?.formedAtMs ?? 0, strength?.lastUsedAtMs ?? 0, strength?.lastRecalledAtMs ?? 0),
      };
    });
  // The day's new memories first, then the rest by salience.
  const ordered = [...live].sort((a, b) => {
    const aNew = (a.formedAtMs ?? 0) > pass.sinceMs ? 1 : 0;
    const bNew = (b.formedAtMs ?? 0) > pass.sinceMs ? 1 : 0;
    return bNew - aNew || b.salience - a.salience || a.key.localeCompare(b.key);
  }).slice(0, NIGHT_MEMORIES_LIMIT);
  const similar: ThoughtNightAgenda["similar"] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const overlap = wordOverlap(ordered[i]!.statement, ordered[j]!.statement);
      if (overlap >= NIGHT_SIMILARITY_THRESHOLD) {
        similar.push({ keys: [ordered[i]!.key, ordered[j]!.key], overlap: Math.round(overlap * 100) / 100 });
      }
    }
  }
  similar.sort((a, b) => b.overlap - a.overlap || a.keys[0].localeCompare(b.keys[0]));
  const selfEvidence = live
    .filter((memory) => memory.kind === "learned_self_evidence")
    .sort((a, b) => (b.formedAtMs ?? 0) - (a.formedAtMs ?? 0))
    .slice(0, NIGHT_SELF_EVIDENCE_LIMIT)
    .map((memory) => ({ key: memory.key, statement: memory.statement, formedAtMs: memory.formedAtMs }));
  const staleQuestions = live
    .filter((memory) => memory.kind === "open_question" && memory.lastTouchedMs <= nowMs - STALE_QUESTION_AGE_MS)
    .slice(0, NIGHT_STALE_QUESTIONS_LIMIT)
    .map((memory) => ({ key: memory.key, statement: memory.statement, formedAtMs: memory.formedAtMs }));
  const episodes = listRecentEpisodes(db, 60).filter((episode) => episode.dataClassification !== "secret");
  const dayEpisodes = episodes.filter((episode) => episode.endedAtMs > pass.sinceMs)
    .slice(0, NIGHT_DAY_EPISODES_LIMIT).reverse().map(toThoughtEpisode);
  const journal = recentJournalCollapsed(db, { sinceMs: pass.sinceMs, limit: NIGHT_DAY_JOURNAL_LIMIT }).reverse();
  const taste = {
    entries: input.identityStore
      ? revisableIdentityEntries(input.identityStore.nuclear, input.identityStore.ownerId)
        .filter((entry) => entry.kind === "taste")
        .map((entry) => ({ entryId: entry.entryId, text: entry.text }))
      : [],
    branches: listInterestBranches(db, nowMs, NIGHT_BRANCHES_LIMIT).map((branch) => ({
      branchId: branch.branchId,
      root: branch.root,
      branch: branch.label,
      strength: branch.strength,
      livedCount: branch.livedCount,
    })),
  };
  const agenda: ThoughtNightAgenda = {
    sinceMs: pass.sinceMs,
    weekly: pass.weekly,
    day: { episodes: dayEpisodes, journal },
    memories: ordered.map(({ lastTouchedMs: _touched, ...memory }) => memory),
    similar: similar.slice(0, NIGHT_SIMILAR_PAIRS_LIMIT),
    selfEvidence,
    staleQuestions,
    taste,
  };
  if (pass.weekly) {
    const previous = latestNarrative(db);
    agenda.week = {
      sinceMs: pass.weekSinceMs,
      episodes: episodes.filter((episode) => episode.endedAtMs > pass.weekSinceMs).slice(0, NIGHT_DAY_EPISODES_LIMIT).reverse().map(toThoughtEpisode),
      changes: listAppliedRevisions(db, { sinceMs: pass.weekSinceMs, limit: 20 })
        .map((revision) => ({ layer: revision.layer, text: revision.proposedText, appliedAtMs: revision.appliedAtMs ?? revision.updatedAtMs })),
      ...(previous ? { previousNarrative: { text: previous.text, writtenAtMs: previous.createdAtMs } } : {}),
    };
    const dimensions = listActiveDimensions(db).map((dimension) => ({ id: dimension.id, name: dimension.name, question: dimension.question }));
    if (dimensions.length > 0) agenda.dimensions = dimensions;
  }
  return agenda;
}

function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function idFor(prefix: string, cycleId: string): string {
  return `${prefix}:${createHash("sha256").update(cycleId).digest("hex").slice(0, 32)}`;
}

/** Close one open question: it leaves recall but keeps its words (closing is not forgetting). */
export function closeOpenQuestion(db: DatabaseSync, key: string): boolean {
  const assertion = listLiveMemoryAssertions(db).find((item) => item.assertionKey === key);
  if (!assertion || assertion.memoryKind !== "open_question") return false;
  const result = db.prepare(
    "UPDATE sidecar_memory_assertions SET live = 0, admitted_generation = NULL, content_hash = ? WHERE assertion_key = ? AND live = 1",
  ).run(hashMemoryAssertion({ ...assertion, live: false, admittedGeneration: null }), key);
  if (Number(result.changes ?? 0) === 0) return false;
  try {
    notifySidecarPostCommit(db, { changedAssertionKeys: [key] });
  } catch {
    // The derived store reconciles on its next pass.
  }
  return true;
}

export type NightRecordResult = {
  diaryId: string | null;
  rescored: string[];
  closed: string[];
  narrativeId: string | null;
  gapsStored: number;
  gapsDropped: number;
  chosenId: string | null;
};

/**
 * Record what a night settlement authored. Only keys the pass could see are
 * touched; a narrative is kept only on a weekly night.
 */
export function recordNight(
  db: DatabaseSync,
  input: { cycleId: string; pass: NightPass; claim?: NightClaim; timeZone: string; dataClassification: DataClassification; nowMs: number },
): NightRecordResult {
  const { claim, nowMs } = input;
  const result: NightRecordResult = { diaryId: null, rescored: [], closed: [], narrativeId: null, gapsStored: 0, gapsDropped: 0, chosenId: null };
  if (!claim) return result;
  const live = new Map(listLiveMemoryAssertions(db).map((assertion) => [assertion.assertionKey, assertion]));
  const diary = claim.diary?.trim().slice(0, DIARY_MAX_CHARS);
  if (diary) {
    const diaryId = idFor("diary", input.cycleId);
    // The day a night closes: a 04:00 night writes about yesterday.
    const day = localDate(Math.max(input.pass.sinceMs, nowMs - 12 * 60 * 60_000), input.timeZone);
    db.prepare(
      `INSERT OR IGNORE INTO diary_entries (entry_id, cycle_id, day, text, data_classification, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(diaryId, input.cycleId, day, diary, input.dataClassification, nowMs);
    result.diaryId = diaryId;
  }
  for (const item of (claim.salience ?? []).slice(0, NIGHT_SALIENCE_MAX)) {
    if (!live.has(item.key) || typeof item.salience !== "number" || !Number.isFinite(item.salience)) continue;
    recordMemoryFormation(db, { assertionKey: item.key, salience: item.salience, nowMs });
    db.prepare("UPDATE memory_strength SET salience = ? WHERE assertion_key = ?")
      .run(Math.min(1, Math.max(0, item.salience)), item.key);
    result.rescored.push(item.key);
  }
  for (const key of (claim.closeQuestions ?? []).slice(0, NIGHT_CLOSE_QUESTIONS_MAX)) {
    if (closeOpenQuestion(db, key)) result.closed.push(key);
  }
  const narrative = claim.narrative?.trim().slice(0, NARRATIVE_MAX_CHARS);
  const weeklyWork = input.pass.weekly && (Boolean(claim.gaps) || Boolean(narrative));
  if (weeklyWork) db.exec("SAVEPOINT weekly_pass");
  try {
  if (input.pass.weekly && claim.gaps) {
    const gaps = applyWeeklyGaps(db, {
      passId: input.cycleId,
      nowMs,
      dataClassification: input.dataClassification,
      dimensions: claim.gaps.dimensions,
      choose: claim.gaps.choose,
      edits: claim.gaps.edits,
    });
    result.gapsStored = gaps.stored;
    result.gapsDropped = gaps.dropped;
    result.chosenId = gaps.chosenId;
  }
  if (narrative && input.pass.weekly) {
    const narrativeId = idFor("narrative", input.cycleId);
    // The narrative and its weekly watermark share storage truth, including aftermath replay.
    db.exec("SAVEPOINT weekly_narrative_closure");
    try {
      db.prepare(
        `INSERT OR IGNORE INTO self_narratives (narrative_id, cycle_id, week_since_ms, text, data_classification, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(narrativeId, input.cycleId, input.pass.weekSinceMs, narrative, input.dataClassification, nowMs);
      const stored = db.prepare("SELECT created_at_ms FROM self_narratives WHERE narrative_id=? AND cycle_id=?").get(narrativeId, input.cycleId);
      if (!stored) throw new Error("night_narrative_storage_missing");
      db.prepare(`UPDATE night_state
        SET last_weekly_at_ms = MAX(COALESCE(last_weekly_at_ms, 0), ?)
        WHERE conversation_id = (SELECT conversation_id FROM cycle_records WHERE cycle_id=?)`)
        .run(Number(stored.created_at_ms), input.cycleId);
      db.exec("RELEASE weekly_narrative_closure");
      result.narrativeId = narrativeId;
    } catch (error) {
      db.exec("ROLLBACK TO weekly_narrative_closure; RELEASE weekly_narrative_closure");
      throw error;
    }
  }
  if (weeklyWork) db.exec("RELEASE weekly_pass");
  } catch (error) {
    if (weeklyWork) db.exec("ROLLBACK TO weekly_pass; RELEASE weekly_pass");
    throw error;
  }
  return result;
}

export type DiaryEntry = { entryId: string; day: string; text: string; createdAtMs: number };
export type SelfNarrative = { narrativeId: string; text: string; createdAtMs: number };

export function listDiary(db: DatabaseSync, limit = 7): DiaryEntry[] {
  return (db.prepare(
    `SELECT * FROM diary_entries WHERE forgotten_at_ms IS NULL AND text IS NOT NULL AND data_classification != 'secret'
      ORDER BY created_at_ms DESC, entry_id DESC LIMIT ?`,
  ).all(Math.max(1, limit)) as Row[]).map((row) => ({
    entryId: String(row.entry_id), day: String(row.day), text: String(row.text), createdAtMs: Number(row.created_at_ms),
  }));
}

export function latestNarrative(db: DatabaseSync): SelfNarrative | null {
  const row = db.prepare(
    `SELECT * FROM self_narratives WHERE forgotten_at_ms IS NULL AND text IS NOT NULL AND data_classification != 'secret'
      ORDER BY created_at_ms DESC, narrative_id DESC LIMIT 1`,
  ).get() as Row | undefined;
  return row ? { narrativeId: String(row.narrative_id), text: String(row.text), createdAtMs: Number(row.created_at_ms) } : null;
}

function idsMentioning(db: DatabaseSync, table: "diary_entries" | "self_narratives", idColumn: string, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare(`SELECT ${idColumn} AS id, text FROM ${table} WHERE forgotten_at_ms IS NULL`).all() as Row[])
    .filter((row) => typeof row.text === "string" && row.text.toLowerCase().includes(needle))
    .map((row) => String(row.id));
}

export function diaryEntryIdsForForget(db: DatabaseSync, topic: string): string[] {
  return idsMentioning(db, "diary_entries", "entry_id", topic);
}

export function narrativeIdsForForget(db: DatabaseSync, topic: string): string[] {
  return idsMentioning(db, "self_narratives", "narrative_id", topic);
}

/** Her words go; the fact that a night happened stays. */
export function forgetDiaryEntry(db: DatabaseSync, entryId: string, nowMs: number): number {
  return Number(db.prepare("UPDATE diary_entries SET text = NULL, forgotten_at_ms = ? WHERE entry_id = ? AND forgotten_at_ms IS NULL")
    .run(nowMs, entryId).changes ?? 0);
}

export function forgetNarrative(db: DatabaseSync, narrativeId: string, nowMs: number): number {
  return Number(db.prepare("UPDATE self_narratives SET text = NULL, forgotten_at_ms = ? WHERE narrative_id = ? AND forgotten_at_ms IS NULL")
    .run(nowMs, narrativeId).changes ?? 0);
}
