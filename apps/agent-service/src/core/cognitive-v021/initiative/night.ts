import type { DatabaseSync } from "node:sqlite";
import { appendInboxEvent, getCurrentCycle, getCycle } from "../cycle/inbox.js";
import { admitWake } from "../wake/ledger.js";
import { occurrenceIdFor } from "../wake/identity.js";
import {
  PRIVATE_THOUGHT_POLICY_ID,
  getPrivateBudgetProjection,
  reservePrivateThought,
} from "../private-budget/ledger.js";
import {
  executeAdmittedThought,
  isPrivateThoughtActive,
  type IdleThoughtRunner,
  type IdleTickResult,
} from "./idle.js";
import { evaluateAfterglow } from "./afterglow.js";
import type { NightPass } from "./inner-pass.js";

export { nightPassFromPayload, type NightPass } from "./inner-pass.js";

/**
 * Growth V1 §5.4 and §6.6: the NIGHT pass and the long arc.
 *
 * Once per 24 hours, at the hour the Owner is quietest, Ashley gets a
 * consolidation pass: she merges and supersedes memories, re-scores what
 * matters, turns repeated self-evidence into revision proposals, closes
 * questions that went stale, looks at whether her taste line still matches
 * the interests she lives, and writes a diary entry for the day. Every
 * seventh day the same pass is also the long arc: "who I am becoming".
 *
 * The Host learns the hour from when the Owner writes (mechanics only) and
 * decides when; everything the pass produces is Ashley's. Layering: a due
 * afterglow runs first and a live conversation is never interrupted.
 */

export const NIGHT_DEFAULT_HOUR = 4;
/** Owner messages needed before the learned hour replaces the default. */
export const NIGHT_MIN_SAMPLES = 20;
export const NIGHT_LEARNING_WINDOW_MS = 28 * 24 * 60 * 60_000;
/** After a pass, the next one is the quiet hour at least this far ahead: once per day. */
export const NIGHT_MIN_GAP_MS = 12 * 60 * 60_000;
/** The long arc: a weekly night, with half a day of slack for a moving quiet hour. */
export const WEEKLY_NARRATIVE_INTERVAL_MS = 7 * 24 * 60 * 60_000 - NIGHT_MIN_GAP_MS;

export type NightState = {
  nextNightAtMs: number;
  lastNightAtMs: number | null;
  slot: number;
  quietHour: number;
  rhythmStartedAtMs: number;
  lastWeeklyAtMs: number | null;
  lastOutcome: string | null;
};

export type NightTickResult = {
  outcome: "scheduled" | "not_due" | "afterglow_first" | "engaged" | "busy" | "in_flight" | "budget" | "wake_closed" | "ran";
  slot?: number;
  weekly?: boolean;
  quietHour?: number;
  nextNightAtMs?: number;
  thought?: IdleTickResult;
};

type Row = Record<string, unknown>;

function localHour(ms: number, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms))
    .find((part) => part.type === "hour")?.value;
  return Number(hour ?? 0) % 24;
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/**
 * The local hour when the Owner writes least, over the last four weeks.
 * Each hour is weighed with its neighbours, so one stray message does not
 * move the night. Before there is enough to learn from, 04:00.
 */
export function quietestHour(db: DatabaseSync, input: { nowMs: number; timeZone: string }): number {
  const rows = db.prepare(
    `SELECT created_at_ms FROM conversation_evidence_log
      WHERE role = 'owner' AND created_at_ms >= ? AND created_at_ms <= ?`,
  ).all(input.nowMs - NIGHT_LEARNING_WINDOW_MS, input.nowMs) as Row[];
  if (rows.length < NIGHT_MIN_SAMPLES) return NIGHT_DEFAULT_HOUR;
  const counts = new Array<number>(24).fill(0);
  for (const row of rows) counts[localHour(Number(row.created_at_ms), input.timeZone)]! += 1;
  let best = NIGHT_DEFAULT_HOUR;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let hour = 0; hour < 24; hour += 1) {
    const score = counts[(hour + 23) % 24]! + 2 * counts[hour]! + counts[(hour + 1) % 24]!;
    const closer = circularDistance(hour, NIGHT_DEFAULT_HOUR) < circularDistance(best, NIGHT_DEFAULT_HOUR);
    if (score < bestScore || (score === bestScore && closer)) {
      best = hour;
      bestScore = score;
    }
  }
  return best;
}

/** The first top of an hour after `afterMs` whose local hour is `hour`. */
export function nextLocalHour(afterMs: number, hour: number, timeZone: string): number {
  const start = Math.ceil((afterMs + 1) / 3_600_000) * 3_600_000;
  for (let step = 0; step <= 48; step += 1) {
    const candidate = start + step * 3_600_000;
    if (localHour(candidate, timeZone) === hour) return candidate;
  }
  return start + 24 * 3_600_000;
}

export function readNightState(db: DatabaseSync, conversationId: string): NightState | null {
  const row = db.prepare("SELECT * FROM night_state WHERE conversation_id = ?").get(conversationId) as Row | undefined;
  if (!row) return null;
  return {
    nextNightAtMs: Number(row.next_night_at_ms),
    lastNightAtMs: row.last_night_at_ms == null ? null : Number(row.last_night_at_ms),
    slot: Number(row.night_slot ?? 0),
    quietHour: Number(row.quiet_hour ?? NIGHT_DEFAULT_HOUR),
    rhythmStartedAtMs: Number(row.rhythm_started_at_ms),
    lastWeeklyAtMs: row.last_weekly_at_ms == null ? null : Number(row.last_weekly_at_ms),
    lastOutcome: typeof row.last_outcome === "string" ? row.last_outcome : null,
  };
}

function writeNightState(db: DatabaseSync, conversationId: string, state: NightState, nowMs: number): void {
  db.prepare(
    `INSERT INTO night_state
       (conversation_id, next_night_at_ms, last_night_at_ms, night_slot, quiet_hour, rhythm_started_at_ms, last_weekly_at_ms, last_outcome, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       next_night_at_ms = excluded.next_night_at_ms,
       last_night_at_ms = excluded.last_night_at_ms,
       night_slot = excluded.night_slot,
       quiet_hour = excluded.quiet_hour,
       rhythm_started_at_ms = excluded.rhythm_started_at_ms,
       last_weekly_at_ms = excluded.last_weekly_at_ms,
       last_outcome = excluded.last_outcome,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(conversationId, state.nextNightAtMs, state.lastNightAtMs, state.slot, state.quietHour, state.rhythmStartedAtMs,
    state.lastWeeklyAtMs, state.lastOutcome, nowMs);
}

function nightEventId(conversationId: string, slot: number): string {
  return `night:${conversationId}:${slot}`;
}

const LIVE_EVENT_STATUSES = new Set(["pending", "claimed", "failed_retryable"]);

function eventLive(db: DatabaseSync, eventId: string): boolean {
  const row = db.prepare("SELECT status FROM inbox_events WHERE id = ?").get(eventId) as Row | undefined;
  return row !== undefined && LIVE_EVENT_STATUSES.has(String(row.status));
}

/** Whether this night is also the weekly long arc. */
export function nightIsWeekly(state: Pick<NightState, "lastWeeklyAtMs" | "rhythmStartedAtMs">, nowMs: number): boolean {
  return nowMs - (state.lastWeeklyAtMs ?? state.rhythmStartedAtMs) >= WEEKLY_NARRATIVE_INTERVAL_MS;
}

/**
 * One NIGHT opportunity. Runs at most one private Thought, through the same
 * wake, private budget, inbox, and kernel path as every other private pass.
 */
export async function tickNight(
  db: DatabaseSync,
  options: {
    conversationId: string;
    occupantId: string;
    authorityEpoch: number;
    timeZone: string;
    nowMs?: number;
    thought: IdleThoughtRunner;
    afterglowEnabled?: boolean;
    privateBudgetPolicyId?: string;
  },
): Promise<NightTickResult> {
  const nowMs = options.nowMs ?? Date.now();
  const { conversationId, timeZone } = options;
  const state = readNightState(db, conversationId);
  if (!state) {
    const quietHour = quietestHour(db, { nowMs, timeZone });
    const nextNightAtMs = nextLocalHour(nowMs, quietHour, timeZone);
    writeNightState(db, conversationId, {
      nextNightAtMs, lastNightAtMs: null, slot: 0, quietHour, rhythmStartedAtMs: nowMs, lastWeeklyAtMs: null, lastOutcome: "scheduled",
    }, nowMs);
    return { outcome: "scheduled", quietHour, nextNightAtMs };
  }
  if (nowMs < state.nextNightAtMs) return { outcome: "not_due", nextNightAtMs: state.nextNightAtMs };

  const afterglow = evaluateAfterglow(db, { conversationId, nowMs });
  if (afterglow.kind === "not_due") return { outcome: "engaged" };
  if (afterglow.kind === "due" && options.afterglowEnabled !== false) return { outcome: "afterglow_first" };
  if (isPrivateThoughtActive(conversationId) || getCurrentCycle(db, conversationId)) return { outcome: "busy" };
  if (state.slot > 0 && eventLive(db, nightEventId(conversationId, state.slot))) return { outcome: "in_flight", slot: state.slot };

  const policyId = options.privateBudgetPolicyId ?? PRIVATE_THOUGHT_POLICY_ID;
  const projection = getPrivateBudgetProjection(db, { conversationId, policyId, wallClockNowMs: nowMs });
  if (projection.clockState === "clock_reconciliation" || projection.remaining <= 0) return { outcome: "budget" };

  const slot = state.slot + 1;
  const weekly = nightIsWeekly(state, nowMs);
  const quietHour = quietestHour(db, { nowMs, timeZone });
  const nextNightAtMs = nextLocalHour(nowMs + NIGHT_MIN_GAP_MS, quietHour, timeZone);
  const moved: NightState = {
    ...state,
    nextNightAtMs,
    lastNightAtMs: nowMs,
    slot,
    quietHour,
    lastWeeklyAtMs: weekly ? nowMs : state.lastWeeklyAtMs,
    lastOutcome: "started",
  };
  // Move the rhythm before any durable work exists: a crash below costs one
  // night instead of repeating it forever.
  writeNightState(db, conversationId, moved, nowMs);
  const triggerRef = `night:${slot}`;
  const admission = admitWake(db, {
    occurrenceId: occurrenceIdFor({ sourceKind: "idle", triggerRef, conversationId }),
    triggerRef,
    sourceKind: "idle",
    conversationId,
    triggerKind: "idle_opportunity",
    occupantId: options.occupantId,
    authorityEpoch: options.authorityEpoch,
    capturedAuthorityRevision: 0,
    nowMs,
  });
  if (admission.kind === "stale" || admission.kind === "cancelled") return { outcome: "wake_closed", slot };
  const cycle = getCycle(db, admission.wake.cycleId);
  if (!cycle) throw new Error("night_cycle_missing");
  const budget = reservePrivateThought(db, {
    admissionId: `private-thought:${cycle.wakeId}`,
    wakeId: cycle.wakeId,
    conversationId,
    policyId,
    wallClockNowMs: nowMs,
  });
  if (budget.kind === "refused" || budget.reservation.state !== "held") {
    writeNightState(db, conversationId, { ...moved, lastOutcome: "budget" }, nowMs);
    return { outcome: "budget" };
  }

  const pass: NightPass = {
    kind: "night",
    slot,
    // The day this night closes: everything since the previous night (or a day, the first time).
    sinceMs: state.lastNightAtMs ?? nowMs - 24 * 60 * 60_000,
    weekly,
    weekSinceMs: state.lastWeeklyAtMs ?? state.rhythmStartedAtMs,
  };
  const event = appendInboxEvent(db, {
    id: nightEventId(conversationId, slot),
    wakeId: cycle.wakeId,
    conversationId,
    kind: "idle_opportunity",
    payload: {
      ownerId: options.occupantId,
      channel: "discord",
      threadId: conversationId,
      triggerRef,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      privateBudgetReservationId: budget.reservation.reservationId,
      occupantId: options.occupantId,
      observations: [],
      dueTriggers: [],
      innerPass: pass,
    },
    createdAtMs: nowMs,
  });
  const thought = await executeAdmittedThought(db, {
    conversationId,
    cycle,
    wakeId: cycle.wakeId,
    event,
    trigger: { kind: "idle_opportunity", ref: triggerRef },
    occupancy: [],
    observations: [],
    dueTriggers: [],
    suppressedTriggers: [],
    reservation: budget.reservation,
    nowMs,
    thought: options.thought,
  });
  writeNightState(db, conversationId, { ...moved, lastOutcome: thought.reason ?? "ran" }, nowMs);
  return { outcome: "ran", slot, weekly, quietHour, nextNightAtMs, thought };
}
