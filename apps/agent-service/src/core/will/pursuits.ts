// C1 and D1 (live 2026-10-06: 48 of 55 own-time passes in a week were rest, "while Alex is away";
// she had nothing of her own to carry on): her pursuits and her clock. A pursuit is something she
// chose to go after (a question, a topic to read into, a skill, a friendship, something to make),
// with why, its next step, her notes and when she wants to come back to it. Her clock is the time
// she asks for her next own time, and what for. The Host keeps them and wakes her when she asked;
// it never picks a pursuit or a time for her.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const PURSUIT_OPS_MAX = 4;
export const PURSUITS_ACTIVE_MAX = 7;
export const PURSUIT_NOTES_KEPT = 12;
export const PURSUIT_NOTES_SHOWN = 3;
export const PURSUIT_TEXT_MAX = 600;
export const OWN_TIME_MIN_AHEAD_MS = 5 * 60_000;
export const OWN_TIME_MAX_AHEAD_MS = 14 * 24 * 60 * 60_000;
export const OWN_TIME_PENDING_MAX = 5;

export type PursuitState = "active" | "parked" | "finished" | "dropped";
export type PursuitOp =
  | { start: { title: string; why: string; nextStep?: string; returnAtMs?: number } }
  | { id: string; note?: string; nextStep?: string; returnAtMs?: number; state?: PursuitState };
export type OwnTimeClaim = { atMs: number; for: string; pursuitId?: string };
export type ThoughtPursuit = {
  id: string; title: string; why: string; state: PursuitState; nextStep?: string; returnAtMs?: number;
  notes?: Array<{ atMs: number; note: string }>; startedAtMs: number; touched: number; endedAtMs?: number;
};
export type ThoughtWill = {
  pursuits: ThoughtPursuit[];
  /** Times she asked for her own time, still ahead. */
  ownTime?: Array<{ atMs: number; for: string; pursuitId?: string }>;
  /** What became of her last changes here. */
  recent?: Array<{ what: string; ok: boolean; reason?: string; atMs: number }>;
};

type Row = Record<string, unknown>;

function text(value: unknown, max = PURSUIT_TEXT_MAX): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isPursuitOps(value: unknown): value is PursuitOp[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PURSUIT_OPS_MAX) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const op = item as Row;
    if ("start" in op) {
      const start = op.start as Row;
      return Object.keys(op).length === 1 && !!start && typeof start === "object"
        && Object.keys(start).every(key => ["title", "why", "nextStep", "returnAtMs"].includes(key))
        && typeof start.title === "string" && start.title.trim().length > 0 && start.title.length <= 120
        && typeof start.why === "string" && start.why.trim().length > 0 && start.why.length <= PURSUIT_TEXT_MAX
        && (start.nextStep === undefined || (typeof start.nextStep === "string" && start.nextStep.length <= PURSUIT_TEXT_MAX))
        && (start.returnAtMs === undefined || isTime(start.returnAtMs));
    }
    return Object.keys(op).every(key => ["id", "note", "nextStep", "returnAtMs", "state"].includes(key))
      && typeof op.id === "string" && op.id.length > 0 && op.id.length <= 64
      && (op.note === undefined || (typeof op.note === "string" && op.note.length <= PURSUIT_TEXT_MAX))
      && (op.nextStep === undefined || (typeof op.nextStep === "string" && op.nextStep.length <= PURSUIT_TEXT_MAX))
      && (op.returnAtMs === undefined || isTime(op.returnAtMs))
      && (op.state === undefined || ["active", "parked", "finished", "dropped"].includes(String(op.state)))
      && Object.keys(op).length > 1;
  });
}

export function isOwnTimeClaim(value: unknown): value is OwnTimeClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Row;
  return Object.keys(claim).every(key => ["atMs", "for", "pursuitId"].includes(key)) && isTime(claim.atMs)
    && typeof claim.for === "string" && claim.for.trim().length > 0 && claim.for.length <= 300
    && (claim.pursuitId === undefined || (typeof claim.pursuitId === "string" && claim.pursuitId.length <= 64));
}

function logChange(sidecar: DatabaseSync, cycleId: string, ordinal: number, what: string, ok: boolean, reason: string | null, nowMs: number): void {
  sidecar.prepare("INSERT OR IGNORE INTO will_changes (cycle_id, ordinal, what, ok, reason, at_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .run(cycleId, ordinal, what.slice(0, 200), ok ? 1 : 0, reason, nowMs);
}

function activeCount(sidecar: DatabaseSync): number {
  return Number((sidecar.prepare("SELECT count(*) AS n FROM pursuits WHERE state = 'active'").get() as Row).n ?? 0);
}

/** Apply her pursuit changes from one settled cycle, once. */
export function applyPursuitOps(sidecar: DatabaseSync, input: { cycleId: string; ops: readonly PursuitOp[]; nowMs: number }): void {
  if (sidecar.prepare("SELECT 1 FROM will_changes WHERE cycle_id = ? AND ordinal < 100 LIMIT 1").get(input.cycleId)) return;
  input.ops.slice(0, PURSUIT_OPS_MAX).forEach((op, ordinal) => {
    if ("start" in op) {
      const title = text(op.start.title, 120)!;
      if (activeCount(sidecar) >= PURSUITS_ACTIVE_MAX) {
        logChange(sidecar, input.cycleId, ordinal, `start ${title}`, false, "too_many_active", input.nowMs);
        return;
      }
      const id = `pursuit:${randomUUID().slice(0, 8)}`;
      sidecar.prepare(`INSERT INTO pursuits (pursuit_id, title, why, next_step, state, notes_json, return_at_ms, started_cycle_id,
        started_at_ms, updated_at_ms, touched_count) VALUES (?, ?, ?, ?, 'active', '[]', ?, ?, ?, ?, 1)`).run(
        id, title, text(op.start.why)!, text(op.start.nextStep) ?? null, op.start.returnAtMs ?? null, input.cycleId, input.nowMs, input.nowMs);
      logChange(sidecar, input.cycleId, ordinal, `start ${id} ${title}`, true, null, input.nowMs);
      return;
    }
    const row = sidecar.prepare("SELECT * FROM pursuits WHERE pursuit_id = ?").get(op.id) as Row | undefined;
    if (!row) { logChange(sidecar, input.cycleId, ordinal, `update ${op.id}`, false, "no_such_pursuit", input.nowMs); return; }
    if (op.state === "active" && row.state !== "active" && activeCount(sidecar) >= PURSUITS_ACTIVE_MAX) {
      logChange(sidecar, input.cycleId, ordinal, `resume ${op.id}`, false, "too_many_active", input.nowMs);
      return;
    }
    let notes: Array<{ atMs: number; note: string }> = [];
    try { notes = JSON.parse(String(row.notes_json)) as typeof notes; } catch { notes = []; }
    const note = text(op.note);
    if (note) notes = [...notes, { atMs: input.nowMs, note }].slice(-PURSUIT_NOTES_KEPT);
    const ended = op.state === "finished" || op.state === "dropped";
    sidecar.prepare(`UPDATE pursuits SET notes_json = ?, next_step = COALESCE(?, next_step), return_at_ms = COALESCE(?, return_at_ms),
      state = COALESCE(?, state), ended_at_ms = CASE WHEN ? THEN ? ELSE ended_at_ms END, touched_count = touched_count + 1, updated_at_ms = ?
      WHERE pursuit_id = ?`).run(JSON.stringify(notes), text(op.nextStep) ?? null, op.returnAtMs ?? null, op.state ?? null,
      ended ? 1 : 0, input.nowMs, input.nowMs, op.id);
    logChange(sidecar, input.cycleId, ordinal, `${op.state ?? "update"} ${op.id}`, true, null, input.nowMs);
  });
}

/** Keep the time she asked for her next own time. Too soon or too far is refused with its reason. */
export function recordOwnTime(sidecar: DatabaseSync, input: { cycleId: string; claim: OwnTimeClaim; nowMs: number }): { ok: boolean; reason?: string } {
  const reason = input.claim.atMs < input.nowMs + OWN_TIME_MIN_AHEAD_MS ? "too_soon"
    : input.claim.atMs > input.nowMs + OWN_TIME_MAX_AHEAD_MS ? "too_far_ahead"
    : Number((sidecar.prepare("SELECT count(*) AS n FROM own_time_wishes WHERE state = 'pending'").get() as Row).n) >= OWN_TIME_PENDING_MAX ? "too_many_pending"
    : null;
  if (!reason) {
    sidecar.prepare(`INSERT OR IGNORE INTO own_time_wishes (wish_id, cycle_id, want_at_ms, reason, pursuit_id, state, created_at_ms)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(`wish:${randomUUID().slice(0, 8)}`, input.cycleId, input.claim.atMs,
      input.claim.for.trim().slice(0, 300), input.claim.pursuitId ?? null, input.nowMs);
  }
  logChange(sidecar, input.cycleId, 100, `own time at ${new Date(input.claim.atMs).toISOString()}`, !reason, reason, input.nowMs);
  return reason ? { ok: false, reason } : { ok: true };
}

/** Wishes whose time has come (the thalamus proposes an own-time pass for them). */
export function dueOwnTime(sidecar: DatabaseSync, nowMs: number): Array<{ wishId: string; atMs: number; for: string; pursuitId?: string }> {
  return (sidecar.prepare("SELECT wish_id, want_at_ms, reason, pursuit_id FROM own_time_wishes WHERE state = 'pending' AND want_at_ms <= ? ORDER BY want_at_ms LIMIT 5")
    .all(nowMs) as Row[]).map(row => ({ wishId: String(row.wish_id), atMs: Number(row.want_at_ms), for: String(row.reason),
      ...(typeof row.pursuit_id === "string" ? { pursuitId: row.pursuit_id } : {}) }));
}

/**
 * The own-time pass that serves due wishes shows them in its agenda. They stay pending: their ids go to `served`,
 * and only a settled pass marks them fired (markOwnTimeFired). A pass that fails leaves them due.
 */
export function takeDueOwnTime(sidecar: DatabaseSync, nowMs: number, served?: string[]): Array<{ atMs: number; for: string; pursuitId?: string }> {
  const due = dueOwnTime(sidecar, nowMs);
  served?.push(...due.map((wish) => wish.wishId));
  return due.map(({ wishId: _wishId, ...wish }) => wish);
}

/** A settled pass marks the wishes it served as fired, once. */
export function markOwnTimeFired(sidecar: DatabaseSync, wishIds: readonly string[], nowMs: number): void {
  const fire = sidecar.prepare("UPDATE own_time_wishes SET state = 'fired', fired_at_ms = ? WHERE wish_id = ? AND state = 'pending'");
  for (const wishId of new Set(wishIds)) fire.run(nowMs, wishId);
}

function toThought(row: Row): ThoughtPursuit {
  let notes: Array<{ atMs: number; note: string }> = [];
  try { notes = JSON.parse(String(row.notes_json)) as typeof notes; } catch { notes = []; }
  return {
    id: String(row.pursuit_id), title: String(row.title), why: String(row.why), state: String(row.state) as PursuitState,
    ...(typeof row.next_step === "string" && row.next_step ? { nextStep: row.next_step } : {}),
    ...(row.return_at_ms == null ? {} : { returnAtMs: Number(row.return_at_ms) }),
    ...(notes.length ? { notes: notes.slice(-PURSUIT_NOTES_SHOWN) } : {}),
    startedAtMs: Number(row.started_at_ms), touched: Number(row.touched_count),
    ...(row.ended_at_ms == null ? {} : { endedAtMs: Number(row.ended_at_ms) }),
  };
}

/** Her pursuits (active, parked, and those ended in the last week), her clock, and her latest changes. */
export function willForThought(sidecar: DatabaseSync, nowMs: number): ThoughtWill | undefined {
  try {
    const pursuits = (sidecar.prepare(`SELECT * FROM pursuits WHERE state IN ('active','parked') OR ended_at_ms >= ?
      ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'parked' THEN 1 ELSE 2 END, updated_at_ms DESC LIMIT 14`).all(nowMs - 7 * 24 * 60 * 60_000) as Row[]).map(toThought);
    const ownTime = (sidecar.prepare("SELECT want_at_ms, reason, pursuit_id FROM own_time_wishes WHERE state = 'pending' ORDER BY want_at_ms LIMIT 5").all() as Row[])
      .map(row => ({ atMs: Number(row.want_at_ms), for: String(row.reason), ...(typeof row.pursuit_id === "string" ? { pursuitId: row.pursuit_id } : {}) }));
    const recent = (sidecar.prepare("SELECT what, ok, reason, at_ms FROM will_changes WHERE at_ms >= ? ORDER BY at_ms DESC, ordinal DESC LIMIT 6")
      .all(nowMs - 48 * 60 * 60_000) as Row[]).reverse().map(row => ({ what: String(row.what), ok: Number(row.ok) === 1,
        ...(typeof row.reason === "string" && row.reason ? { reason: row.reason } : {}), atMs: Number(row.at_ms) }));
    return { pursuits, ...(ownTime.length ? { ownTime } : {}), ...(recent.length ? { recent } : {}) };
  } catch {
    return undefined;
  }
}
