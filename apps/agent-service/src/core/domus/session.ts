// M2 (LIVING pack Phase 1): the session afterglow. When a stretch of her life in a game world is
// over (the game closed or the helper went quiet), or has run for half an hour, she looks back on
// it once in a private pass, the way the conversation afterglow looks back on a talk. What she
// writes is one episode on `domus:<world>`, supported by the observations of that stretch, and she
// may nominate memories with domus_observation supports. The Host decides only when, by a
// watermark per world; it never writes what happened.
import type { DatabaseSync } from "node:sqlite";
import { getCurrentCycle } from "../cognitive-v021/cycle/inbox.js";
import { isPrivateThoughtActive, type IdleThoughtRunner } from "../cognitive-v021/initiative/idle.js";
import type { AfterglowPass, AfterglowReflection, AfterglowSession } from "../cognitive-v021/initiative/inner-pass.js";
import { recentJournalCollapsed, type ThoughtJournalEntry } from "../cognitive-v021/initiative/journal.js";
import { recordEpisode } from "../cognitive-v021/memory/episodes.js";
import { armedAttachments } from "./notification.js";

/** A stretch is over when nothing new came from its world for this long. */
export const DOMUS_SESSION_QUIET_MS = 10 * 60_000;
/** A long stretch is reflected while it runs, once it is this old. */
export const DOMUS_SESSION_ROLLING_MS = 30 * 60_000;
export const DOMUS_SESSION_MAX_ATTEMPTS = 3;
/** Observations an episode cites (the newest of the stretch). */
export const DOMUS_SESSION_EVIDENCE = 64;
export const DOMUS_SESSION_JOURNAL = 24;
export const DOMUS_SESSION_ACTS = 24;
/** Observations she may cite in a nomination, newest last. */
export const DOMUS_SESSION_CITABLE = 12;

export type DomusSessionDue = AfterglowSession & { reason: "ended" | "rolling"; lastAtMs: number };

type Row = Record<string, unknown>;
type SessionState = { reflectedThroughMs: number; attemptRange: string | null; attemptCount: number; failedAttempts: number };

export function readDomusSessionState(db: DatabaseSync, world: string): SessionState {
  const row = db.prepare("SELECT * FROM domus_session_state WHERE world = ?").get(world) as Row | undefined;
  return {
    reflectedThroughMs: Number(row?.reflected_through_ms ?? 0),
    attemptRange: typeof row?.attempt_range === "string" ? row.attempt_range : null,
    attemptCount: Number(row?.attempt_count ?? 0),
    failedAttempts: Number(row?.failed_attempts ?? 0),
  };
}

function writeAttempt(db: DatabaseSync, world: string, range: string, count: number, failed: number, nowMs: number): void {
  db.prepare(`INSERT INTO domus_session_state (world, reflected_through_ms, attempt_range, attempt_count, failed_attempts, updated_at_ms)
    VALUES (?, 0, ?, ?, ?, ?) ON CONFLICT(world) DO UPDATE SET attempt_range = excluded.attempt_range,
    attempt_count = excluded.attempt_count, failed_attempts = excluded.failed_attempts, updated_at_ms = excluded.updated_at_ms`)
    .run(world, range, count, failed, nowMs);
}

/** Move the watermark; it never moves back. */
export function advanceDomusSession(db: DatabaseSync, world: string, throughMs: number, outcome: string, nowMs: number): void {
  db.prepare(`INSERT INTO domus_session_state (world, reflected_through_ms, attempt_range, attempt_count, failed_attempts, last_outcome, updated_at_ms)
    VALUES (?, ?, NULL, 0, 0, ?, ?) ON CONFLICT(world) DO UPDATE SET
    reflected_through_ms = MAX(domus_session_state.reflected_through_ms, excluded.reflected_through_ms),
    attempt_range = NULL, attempt_count = 0, failed_attempts = 0, last_outcome = excluded.last_outcome, updated_at_ms = excluded.updated_at_ms`)
    .run(world, throughMs, outcome, nowMs);
}

function lane(world: string): `domus:${string}` {
  return `domus:${world}`;
}

/** What she wrote or did in the stretch: worded journal entries and her acts. */
function lived(db: DatabaseSync, world: string, fromMs: number, throughMs: number): number {
  const words = Number((db.prepare(`SELECT COUNT(*) AS n FROM activity_journal WHERE channel = ? AND forgotten_at_ms IS NULL
    AND lineage_class = 'current' AND entry IS NOT NULL AND created_at_ms > ? AND created_at_ms <= ?`)
    .get(lane(world), fromMs, throughMs) as Row).n);
  const acts = Number((db.prepare("SELECT COUNT(*) AS n FROM domus_acts WHERE world = ? AND requested_at_ms > ? AND requested_at_ms <= ?")
    .get(world, fromMs, throughMs) as Row).n);
  return words + acts;
}

/**
 * Stretches due for reflection, one per world. A stretch is the world's admitted observations
 * after its watermark. It is due once it ended (no armed helper sent anything for the quiet
 * period) or has run for the rolling period. A stretch with nothing lived in it is let go.
 */
export function domusSessionsDue(db: DatabaseSync, nowMs: number): DomusSessionDue[] {
  const armed = armedAttachments(db, nowMs);
  const worlds = (db.prepare(`SELECT world, MAX(receipt_time_ms) AS last_at FROM domus_observations
    WHERE admission_state = 'admitted' AND undone_at_ms IS NULL GROUP BY world`).all() as Row[]);
  const due: DomusSessionDue[] = [];
  for (const entry of worlds) {
    const world = String(entry.world);
    const state = readDomusSessionState(db, world);
    if (Number(entry.last_at) <= state.reflectedThroughMs) continue;
    const rows = db.prepare(`SELECT observation_id, attachment, receipt_time_ms FROM domus_observations
      WHERE world = ? AND admission_state = 'admitted' AND undone_at_ms IS NULL AND receipt_time_ms > ? AND receipt_time_ms <= ?
      ORDER BY receipt_time_ms, seq`).all(world, state.reflectedThroughMs, nowMs) as Row[];
    if (!rows.length) continue;
    const first = Number(rows[0]!.receipt_time_ms);
    const last = Number(rows.at(-1)!.receipt_time_ms);
    const playing = armed.has(String(rows.at(-1)!.attachment)) && nowMs - last < DOMUS_SESSION_QUIET_MS;
    const reason = !playing ? "ended" : nowMs - first >= DOMUS_SESSION_ROLLING_MS ? "rolling" : null;
    if (!reason) continue;
    if (!lived(db, world, state.reflectedThroughMs, last)) {
      advanceDomusSession(db, world, last, "nothing_lived", nowMs);
      continue;
    }
    due.push({ world, fromMs: first, throughMs: last, lastAtMs: last, reason,
      observationIds: rows.slice(-DOMUS_SESSION_EVIDENCE).map(row => String(row.observation_id)) });
  }
  return due.sort((a, b) => a.throughMs - b.throughMs);
}

/** M2: the oldest stretch that is due, reflected once; null when none is due. */
export async function tickDomusSession(
  db: DatabaseSync,
  options: { conversationId: string; occupantId: string; authorityEpoch: number; nowMs: number; thought: IdleThoughtRunner; privateBudgetPolicyId?: string },
): Promise<import("../cognitive-v021/initiative/afterglow.js").AfterglowTickResult | null> {
  const [session] = domusSessionsDue(db, options.nowMs);
  if (!session) return null;
  const { conversationId, nowMs } = options;
  if (isPrivateThoughtActive(conversationId) || getCurrentCycle(db, conversationId)) return { outcome: "busy", mode: "session" };
  const range = `${session.world}:${session.fromMs}..${session.throughMs}`;
  const state = readDomusSessionState(db, session.world);
  const sameRange = state.attemptRange === range;
  const previous = sameRange ? state.attemptCount : 0;
  const failed = previous > 0 ? (sameRange ? state.failedAttempts : 0) + 1 : 0;
  const eventId = (attempt: number) => `afterglow:domus:${range}:${attempt}`;
  if (previous > 0) {
    const live = db.prepare("SELECT status FROM inbox_events WHERE id = ?").get(eventId(previous)) as Row | undefined;
    if (live && ["pending", "claimed", "failed_retryable"].includes(String(live.status))) return { outcome: "in_flight", mode: "session" };
  }
  if (failed >= DOMUS_SESSION_MAX_ATTEMPTS) {
    advanceDomusSession(db, session.world, session.throughMs, "abandoned", nowMs);
    return { outcome: "abandoned", mode: "session" };
  }
  const attempt = previous + 1;
  const { reason: _reason, lastAtMs: _last, ...covered } = session;
  const pass: AfterglowPass = { kind: "afterglow", mode: "session", rowIds: [], throughSeq: 0, session: covered };
  const { runReflectionPass } = await import("../cognitive-v021/initiative/afterglow.js");
  return runReflectionPass(db, {
    ...options, pass, eventId: eventId(attempt), triggerRef: `afterglow:domus:${range}#${attempt}`,
    count: () => writeAttempt(db, session.world, range, attempt, failed, nowMs),
    uncount: () => writeAttempt(db, session.world, range, previous, sameRange ? state.failedAttempts : 0, nowMs),
  });
}

export type ThoughtDomusSession = {
  world: string;
  fromMs: number;
  throughMs: number;
  /** Her own game-lane journal over the stretch, oldest first, quiet runs collapsed. */
  journal: ThoughtJournalEntry[];
  /** Her acts in the stretch with what became of each, oldest first. */
  acts: Array<{ label: string; state: string; atMs: number }>;
  /** The newest observations of the stretch she may cite (domus_observation supports). */
  observations: Array<{ observationId: string; atMs: number }>;
};

/** What the session afterglow shows her. */
export function domusSessionForThought(db: DatabaseSync, session: AfterglowSession): ThoughtDomusSession {
  const journal = recentJournalCollapsed(db, { sinceMs: session.fromMs - 60_000, limit: DOMUS_SESSION_JOURNAL, channel: lane(session.world) })
    .filter(entry => entry.atMs <= session.throughMs + 60_000).reverse();
  const acts = (db.prepare(`SELECT label, state, requested_at_ms FROM domus_acts WHERE world = ? AND requested_at_ms >= ? AND requested_at_ms <= ?
    ORDER BY requested_at_ms DESC LIMIT ?`).all(session.world, session.fromMs - 60_000, session.throughMs, DOMUS_SESSION_ACTS) as Row[])
    .reverse().map(row => ({ label: String(row.label), state: String(row.state), atMs: Number(row.requested_at_ms) }));
  const read = db.prepare("SELECT receipt_time_ms FROM domus_observations WHERE observation_id = ? AND undone_at_ms IS NULL");
  const observations = session.observationIds.slice(-DOMUS_SESSION_CITABLE).flatMap(observationId => {
    const row = read.get(observationId) as Row | undefined;
    return row ? [{ observationId, atMs: Number(row.receipt_time_ms) }] : [];
  });
  return { world: session.world, fromMs: session.fromMs, throughMs: session.throughMs, journal, acts, observations };
}

/**
 * Keep her episode of the stretch and move the watermark. An undo that reached the stretch first
 * wins: the reflection is dropped and only the watermark moves. Idempotent.
 */
export function completeDomusSession(db: DatabaseSync, input: {
  cycleId: string; conversationId: string; session: AfterglowSession; reflection: AfterglowReflection | undefined; nowMs: number;
}): "reflected" | "forget_race" {
  db.exec("BEGIN IMMEDIATE");
  try {
    const read = db.prepare("SELECT observation_id, receipt_time_ms, undone_at_ms FROM domus_observations WHERE observation_id = ?");
    const rows = input.session.observationIds.map(id => read.get(id) as Row | undefined);
    const undone = rows.some(row => !row || row.undone_at_ms != null);
    if (!undone && input.reflection?.episode) {
      recordEpisode(db, {
        conversationId: input.conversationId,
        cycleId: input.cycleId,
        rows: rows.map(row => ({ rowId: String(row!.observation_id), createdAtMs: Number(row!.receipt_time_ms), dataClassification: "ordinary" as const })),
        reflection: input.reflection.episode,
        nowMs: input.nowMs,
        channel: lane(input.session.world),
      });
    }
    const outcome = undone ? "forget_race" : "reflected";
    advanceDomusSession(db, input.session.world, input.session.throughMs, outcome, input.nowMs);
    db.exec("COMMIT");
    return outcome;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  }
}
