// 8h: her Sims diary. When her Sim falls asleep for the night, the helper sends one observation
// whose day is a facts-only digest of that day. She writes the diary once, in a private pass,
// on `domus:<world>`. The Host decides only when, from that observation; it never writes the day.
import type { DatabaseSync } from "node:sqlite";
import { getCurrentCycle } from "../cognitive-v021/cycle/inbox.js";
import { isPrivateThoughtActive, type IdleThoughtRunner } from "../cognitive-v021/initiative/idle.js";
import type { AfterglowPass, AfterglowReflection } from "../cognitive-v021/initiative/inner-pass.js";
import { recentJournalCollapsed, type ThoughtJournalEntry } from "../cognitive-v021/initiative/journal.js";
import { recordEpisode } from "../cognitive-v021/memory/episodes.js";

export const DOMUS_DIARY_MAX_ATTEMPTS = 3;
export const DOMUS_DIARY_JOURNAL = 24;
export const DOMUS_DIARY_ACTS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const SPAN_SLACK_MS = 60_000;

export type DomusDiaryRef = { world: string; observationId: string };

export type ThoughtDomusDiary = {
  world: string;
  observationId: string;
  atMs: number;
  day: Record<string, unknown>;
  journal: ThoughtJournalEntry[];
  acts: Array<{ label: string; state: string; atMs: number }>;
};

type Row = Record<string, unknown>;
type DiaryState = { state: string | null; attemptCount: number; failedAttempts: number };

const LIVE = new Set(["pending", "claimed", "failed_retryable"]);

function lane(world: string): `domus:${string}` {
  return `domus:${world}`;
}

function readState(db: DatabaseSync, observationId: string): DiaryState {
  const row = db.prepare("SELECT state, attempt_count, failed_attempts FROM domus_diary_state WHERE observation_id = ?").get(observationId) as Row | undefined;
  return {
    state: typeof row?.state === "string" ? row.state : null,
    attemptCount: Number(row?.attempt_count ?? 0),
    failedAttempts: Number(row?.failed_attempts ?? 0),
  };
}

function writeAttempt(db: DatabaseSync, diary: DomusDiaryRef, attempt: number, failed: number, nowMs: number): void {
  db.prepare(`INSERT INTO domus_diary_state (observation_id, world, state, attempt_count, failed_attempts, cycle_id, updated_at_ms)
    VALUES (?, ?, 'pending', ?, ?, NULL, ?)
    ON CONFLICT(observation_id) DO UPDATE SET state = 'pending', attempt_count = excluded.attempt_count,
      failed_attempts = excluded.failed_attempts, updated_at_ms = excluded.updated_at_ms`)
    .run(diary.observationId, diary.world, attempt, failed, nowMs);
}

function settleState(db: DatabaseSync, diary: DomusDiaryRef, state: "written" | "abandoned" | "forget_race", failed: number | null, cycleId: string | null, nowMs: number): void {
  db.prepare(`INSERT INTO domus_diary_state (observation_id, world, state, attempt_count, failed_attempts, cycle_id, updated_at_ms)
    VALUES (?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(observation_id) DO UPDATE SET state = excluded.state, world = excluded.world,
      failed_attempts = COALESCE(?, domus_diary_state.failed_attempts),
      cycle_id = excluded.cycle_id, updated_at_ms = excluded.updated_at_ms`)
    .run(diary.observationId, diary.world, state, failed ?? 0, cycleId, nowMs, failed);
}

/** Admitted, still-present observations that carry a day and have not been written, abandoned, or lost to a forget. Oldest first. */
export function domusDiariesDue(db: DatabaseSync): DomusDiaryRef[] {
  const rows = db.prepare(`SELECT observation_id, world FROM domus_observations
    WHERE admission_state = 'admitted' AND undone_at_ms IS NULL
      AND json_extract(payload_json, '$.day') IS NOT NULL
      AND observation_id NOT IN (
        SELECT observation_id FROM domus_diary_state WHERE state IN ('written', 'abandoned', 'forget_race'))
    ORDER BY receipt_time_ms`).all() as Row[];
  return rows.map((row) => ({ world: String(row.world), observationId: String(row.observation_id) }));
}

/** The oldest night that is due, written once; null when none is due. */
export async function tickDomusDiary(
  db: DatabaseSync,
  options: { conversationId: string; occupantId: string; authorityEpoch: number; nowMs: number; thought: IdleThoughtRunner; privateBudgetPolicyId?: string },
): Promise<import("../cognitive-v021/initiative/afterglow.js").AfterglowTickResult | null> {
  const [diary] = domusDiariesDue(db);
  if (!diary) return null;
  const { conversationId, nowMs } = options;
  if (isPrivateThoughtActive(conversationId) || getCurrentCycle(db, conversationId)) return { outcome: "busy", mode: "diary" };
  const state = readState(db, diary.observationId);
  const previous = state.attemptCount;
  const failed = previous > 0 ? state.failedAttempts + 1 : 0;
  const eventId = (attempt: number) => `diary:domus:${diary.observationId}:${attempt}`;
  if (previous > 0) {
    const live = db.prepare("SELECT status FROM inbox_events WHERE id = ?").get(eventId(previous)) as Row | undefined;
    if (live && LIVE.has(String(live.status))) return { outcome: "in_flight", mode: "diary" };
  }
  if (failed >= DOMUS_DIARY_MAX_ATTEMPTS) {
    settleState(db, diary, "abandoned", failed, null, nowMs);
    return { outcome: "abandoned", mode: "diary" };
  }
  const attempt = previous + 1;
  const pass: AfterglowPass = { kind: "afterglow", mode: "diary", rowIds: [], throughSeq: 0, diary };
  const { runReflectionPass } = await import("../cognitive-v021/initiative/afterglow.js");
  return runReflectionPass(db, {
    ...options, pass, eventId: eventId(attempt), triggerRef: `diary:domus:${diary.observationId}#${attempt}`,
    count: () => writeAttempt(db, diary, attempt, failed, nowMs),
    uncount: () => writeAttempt(db, diary, previous, state.failedAttempts, nowMs),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** What the diary pass shows her: the helper's day, and her journal and acts since the previous written night (or one day). */
export function domusDiaryForThought(db: DatabaseSync, diary: DomusDiaryRef): ThoughtDomusDiary {
  const row = db.prepare("SELECT payload_json, receipt_time_ms FROM domus_observations WHERE observation_id = ?").get(diary.observationId) as Row | undefined;
  const atMs = Number(row?.receipt_time_ms ?? 0);
  let day: Record<string, unknown> = {};
  if (typeof row?.payload_json === "string") {
    try { day = asRecord((JSON.parse(row.payload_json) as Row).day); } catch { day = {}; }
  }
  const previous = db.prepare(`SELECT o.receipt_time_ms AS at_ms FROM domus_diary_state d
    JOIN domus_observations o ON o.observation_id = d.observation_id
    WHERE d.world = ? AND d.state = 'written' AND o.receipt_time_ms < ?
    ORDER BY o.receipt_time_ms DESC LIMIT 1`).get(diary.world, atMs) as Row | undefined;
  const fromMs = previous ? Number(previous.at_ms) : atMs - DAY_MS;
  const journal = recentJournalCollapsed(db, { sinceMs: fromMs - SPAN_SLACK_MS, limit: DOMUS_DIARY_JOURNAL, channel: lane(diary.world) })
    .filter((entry) => entry.atMs <= atMs + SPAN_SLACK_MS).reverse();
  const acts = (db.prepare(`SELECT label, state, requested_at_ms FROM domus_acts
    WHERE world = ? AND requested_at_ms >= ? AND requested_at_ms <= ?
    ORDER BY requested_at_ms DESC LIMIT ?`).all(diary.world, fromMs - SPAN_SLACK_MS, atMs, DOMUS_DIARY_ACTS) as Row[])
    .reverse().map((item) => ({ label: String(item.label), state: String(item.state), atMs: Number(item.requested_at_ms) }));
  return { world: diary.world, observationId: diary.observationId, atMs, day, journal, acts };
}

/**
 * Keep her episode of the night. An undo that reached the observation first wins: nothing is
 * stored and the night is marked forget_race. A second call does nothing. Idempotent.
 */
export function completeDomusDiary(db: DatabaseSync, input: {
  cycleId: string; conversationId: string; diary: DomusDiaryRef; reflection: AfterglowReflection | undefined; nowMs: number;
}): "written" | "forget_race" | "abandoned" {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = readState(db, input.diary.observationId);
    if (existing.state === "written" || existing.state === "forget_race" || existing.state === "abandoned") {
      db.exec("COMMIT");
      return existing.state;
    }
    const row = db.prepare("SELECT observation_id, receipt_time_ms, undone_at_ms, world FROM domus_observations WHERE observation_id = ?")
      .get(input.diary.observationId) as Row | undefined;
    const undone = !row || row.undone_at_ms != null;
    const world = row ? String(row.world) : input.diary.world;
    if (!undone && input.reflection?.episode) {
      recordEpisode(db, {
        conversationId: input.conversationId,
        cycleId: input.cycleId,
        rows: [{ rowId: String(row!.observation_id), createdAtMs: Number(row!.receipt_time_ms), dataClassification: "ordinary" }],
        reflection: input.reflection.episode,
        nowMs: input.nowMs,
        channel: lane(world),
      });
    }
    const outcome = undone ? "forget_race" : "written";
    settleState(db, { world, observationId: input.diary.observationId }, outcome, null, input.cycleId, input.nowMs);
    db.exec("COMMIT");
    return outcome;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  }
}

export type DomusDiaryEntry = { world: string; at: string; text: string; takeaway: string | null };

/** Written diary episodes, newest first. Forgotten episodes stay out. */
export function listDomusDiary(db: DatabaseSync, limit = 7): DomusDiaryEntry[] {
  const rows = db.prepare(`SELECT d.world, e.ended_at_ms, e.summary, e.ashley_takeaway
    FROM episodes_v2 e
    JOIN domus_diary_state d ON d.cycle_id = e.cycle_id AND d.state = 'written'
    WHERE e.forgotten_at_ms IS NULL
    ORDER BY e.ended_at_ms DESC, e.created_at_ms DESC
    LIMIT ?`).all(Math.max(1, Math.floor(limit))) as Row[];
  return rows.map((row) => ({
    world: String(row.world),
    at: new Date(Number(row.ended_at_ms)).toISOString(),
    text: String(row.summary ?? ""),
    takeaway: typeof row.ashley_takeaway === "string" ? row.ashley_takeaway : null,
  }));
}
