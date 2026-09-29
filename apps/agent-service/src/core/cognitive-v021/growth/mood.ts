import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";

/**
 * Growth V1 §6.4: mood (port of the stale `state/affect.ts`).
 *
 * Four dimensions: valence, energy, openness, tension. Ashley's Thought
 * authors an appraisal (what moved her and why, and which way); the Host
 * only bounds the deltas, keeps the numbers in range, and lets them decay
 * toward baseline at ×0.85 per hour. Mood is an input to Thought, never a
 * script for it.
 */

export type MoodVector = { valence: number; energy: number; openness: number; tension: number };
export type MoodDimension = keyof MoodVector;

export const MOOD_DIMENSIONS: readonly MoodDimension[] = Object.freeze(["valence", "energy", "openness", "tension"]);
export const MOOD_BASELINE: Readonly<MoodVector> = Object.freeze({ valence: 0, energy: 0.5, openness: 0.5, tension: 0 });
export const MOOD_DECAY_PER_HOUR = 0.85;
/** One appraisal moves any dimension by at most this much. */
export const MOOD_MAX_DELTA = 0.3;
/** Below this distance from baseline on every dimension, she is simply at rest. */
export const MOOD_SETTLED_EPSILON = 0.05;
export const APPRAISAL_NOTE_MAX_CHARS = 400;

/** What Thought authors: the note is hers; the deltas are the direction she felt moved. */
export type MoodAppraisal = {
  note: string;
  valence?: number;
  energy?: number;
  openness?: number;
  tension?: number;
};

export type MoodReading = MoodVector & {
  /** Ashley's own words for what moved her last, while the feeling is still present. */
  reason: string | null;
  lastAppraisalAtMs: number | null;
  settled: boolean;
};

type Row = Record<string, unknown>;

const RANGE: Record<MoodDimension, [number, number]> = {
  valence: [-1, 1],
  energy: [0, 1],
  openness: [0, 1],
  tension: [0, 1],
};

function clamp(value: number, [low, high]: [number, number]): number {
  return Math.max(low, Math.min(high, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Continuous decay toward baseline: each hour keeps 85% of the distance. */
export function decayMood(mood: MoodVector, elapsedMs: number): MoodVector {
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  const factor = MOOD_DECAY_PER_HOUR ** hours;
  const result = { ...mood };
  for (const dimension of MOOD_DIMENSIONS) {
    result[dimension] = MOOD_BASELINE[dimension] + (mood[dimension] - MOOD_BASELINE[dimension]) * factor;
  }
  return result;
}

export function moodSettled(mood: MoodVector): boolean {
  return MOOD_DIMENSIONS.every((dimension) => Math.abs(mood[dimension] - MOOD_BASELINE[dimension]) < MOOD_SETTLED_EPSILON);
}

/** Bound one appraisal's deltas, then keep every dimension in range. */
export function applyMoodDeltas(mood: MoodVector, appraisal: MoodAppraisal): { next: MoodVector; applied: MoodVector } {
  const next = { ...mood };
  const applied: MoodVector = { valence: 0, energy: 0, openness: 0, tension: 0 };
  for (const dimension of MOOD_DIMENSIONS) {
    const requested = clamp(finite(appraisal[dimension], 0), [-MOOD_MAX_DELTA, MOOD_MAX_DELTA]);
    next[dimension] = clamp(mood[dimension] + requested, RANGE[dimension]);
    applied[dimension] = next[dimension] - mood[dimension];
  }
  return { next, applied };
}

function storedMood(db: DatabaseSync): { mood: MoodVector; reason: string | null; updatedAtMs: number; lastAppraisalAtMs: number | null } | null {
  const row = db.prepare("SELECT * FROM mood_state WHERE id = 1").get() as Row | undefined;
  if (!row) return null;
  return {
    mood: {
      valence: finite(row.valence, MOOD_BASELINE.valence),
      energy: finite(row.energy, MOOD_BASELINE.energy),
      openness: finite(row.openness, MOOD_BASELINE.openness),
      tension: finite(row.tension, MOOD_BASELINE.tension),
    },
    reason: typeof row.reason === "string" ? row.reason : null,
    updatedAtMs: finite(row.updated_at_ms, 0),
    lastAppraisalAtMs: row.last_appraisal_at_ms == null ? null : finite(row.last_appraisal_at_ms, 0),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Mood as it stands now, decayed from the last event; baseline before any. */
export function readMood(db: DatabaseSync, nowMs: number): MoodReading {
  const stored = storedMood(db);
  if (!stored) return { ...MOOD_BASELINE, reason: null, lastAppraisalAtMs: null, settled: true };
  const decayed = decayMood(stored.mood, nowMs - stored.updatedAtMs);
  const settled = moodSettled(decayed);
  return {
    valence: round(decayed.valence),
    energy: round(decayed.energy),
    openness: round(decayed.openness),
    tension: round(decayed.tension),
    // Once she has settled, the old reason no longer explains anything.
    reason: settled ? null : stored.reason,
    lastAppraisalAtMs: stored.lastAppraisalAtMs,
    settled,
  };
}

export function moodEventIdFor(cycleId: string): string {
  return `mood:${createHash("sha256").update(cycleId).digest("hex").slice(0, 32)}`;
}

/**
 * Record one appraisal and move the mood. Idempotent per cycle: a replayed
 * settlement cannot move her twice.
 */
export function recordAppraisal(
  db: DatabaseSync,
  input: { cycleId: string; appraisal: MoodAppraisal; dataClassification: DataClassification; nowMs: number },
): { eventId: string; applied: MoodVector | null } {
  const eventId = moodEventIdFor(input.cycleId);
  const note = input.appraisal.note.trim().slice(0, APPRAISAL_NOTE_MAX_CHARS);
  const stored = storedMood(db);
  const current = stored ? decayMood(stored.mood, input.nowMs - stored.updatedAtMs) : { ...MOOD_BASELINE };
  const { next, applied } = applyMoodDeltas(current, input.appraisal);
  const inserted = db.prepare(
    `INSERT OR IGNORE INTO mood_events
       (event_id, cycle_id, appraisal, valence_delta, energy_delta, openness_delta, tension_delta, data_classification, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(eventId, input.cycleId, note || null, applied.valence, applied.energy, applied.openness, applied.tension,
    input.dataClassification, input.nowMs);
  if (Number(inserted.changes ?? 0) === 0) return { eventId, applied: null };
  db.prepare(
    `INSERT INTO mood_state (id, valence, energy, openness, tension, reason, source_event_id, last_appraisal_at_ms, updated_at_ms)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       valence = excluded.valence, energy = excluded.energy, openness = excluded.openness, tension = excluded.tension,
       reason = excluded.reason, source_event_id = excluded.source_event_id,
       last_appraisal_at_ms = excluded.last_appraisal_at_ms, updated_at_ms = excluded.updated_at_ms`,
  ).run(next.valence, next.energy, next.openness, next.tension, note || null, eventId, input.nowMs, input.nowMs);
  return { eventId, applied };
}

/** Appraisals whose words mention a forgotten topic. */
export function moodEventIdsForForget(db: DatabaseSync, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare("SELECT event_id, appraisal FROM mood_events WHERE forgotten_at_ms IS NULL").all() as Row[])
    .filter((row) => typeof row.appraisal === "string" && row.appraisal.toLowerCase().includes(needle))
    .map((row) => String(row.event_id));
}

/** The numbers stay (mechanics); her words go, here and as the mood's current reason. */
export function forgetMoodEvent(db: DatabaseSync, eventId: string, nowMs: number): number {
  let changed = Number(db.prepare(
    "UPDATE mood_events SET appraisal = NULL, forgotten_at_ms = ? WHERE event_id = ? AND forgotten_at_ms IS NULL",
  ).run(nowMs, eventId).changes ?? 0);
  changed += Number(db.prepare("UPDATE mood_state SET reason = NULL WHERE source_event_id = ?").run(eventId).changes ?? 0);
  return changed;
}
