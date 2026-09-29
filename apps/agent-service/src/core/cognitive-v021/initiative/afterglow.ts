import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
import { maxClassification } from "../../privacy/classification.js";
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
import { recordEpisode, writeThreadStory } from "../memory/episodes.js";
import type { AfterglowMode, AfterglowPass, AfterglowReflection } from "./inner-pass.js";

export { afterglowPassFromPayload, type AfterglowMode, type AfterglowPass, type AfterglowReflection } from "./inner-pass.js";

/**
 * Growth V1 §5.1–§5.2: the afterglow.
 *
 * After a conversation goes quiet, Ashley reflects on it in a private Thought:
 * she writes an episode, rewrites the thread story, and nominates anything she
 * missed. The Host decides only *when*, by a watermark over conversation rows:
 *
 * - silence: 30 minutes after the last message, over every unreflected row;
 * - rolling: during a long conversation, as soon as more than 30 rows are
 *   unreflected, so nothing leaves the 40-row window unreflected.
 *
 * Coverage is by row range, so nothing is reflected twice or skipped; rows
 * that arrive during an afterglow belong to the next one.
 */

export const AFTERGLOW_SILENCE_MS = 30 * 60_000;
export const AFTERGLOW_ROLLING_ROWS = 30;
/** A rolling pass waits for a short pause so it does not start mid-exchange. */
export const AFTERGLOW_ROLLING_QUIET_MS = 3 * 60_000;
export const AFTERGLOW_MAX_ROWS = 60;
export const AFTERGLOW_MAX_ATTEMPTS = 3;
export const AFTERGLOW_POLL_MS = 2 * 60_000;

export type AfterglowRow = {
  seq: number;
  rowId: string;
  role: "owner" | "ashley";
  text: string;
  createdAtMs: number;
  dataClassification: DataClassification;
};

export type AfterglowDecision =
  | { kind: "nothing" }
  | { kind: "not_due"; unreflected: number; silentForMs: number }
  | { kind: "due"; mode: AfterglowMode; rows: AfterglowRow[] };

export type AfterglowTickResult = {
  outcome:
    | "nothing"
    | "not_due"
    | "busy"
    | "in_flight"
    | "abandoned"
    | "budget"
    | "wake_closed"
    | "ran";
  mode?: AfterglowMode;
  coveredRows?: number;
  thought?: IdleTickResult;
};

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classification(value: unknown): DataClassification {
  return value === "sensitive" || value === "never_public" || value === "secret" ? value : "ordinary";
}

type AfterglowState = {
  reflectedThroughSeq: number;
  attemptRange: string | null;
  /** Serial of the latest attempt at this range; every attempt gets a fresh wake. */
  attemptCount: number;
  /** Attempts that failed on their own. A pass the Owner interrupted is not a failure. */
  failedAttempts: number;
};

export function readAfterglowState(db: DatabaseSync, conversationId: string): AfterglowState {
  const row = db.prepare("SELECT * FROM afterglow_state WHERE conversation_id = ?").get(conversationId) as Row | undefined;
  return {
    reflectedThroughSeq: number(row?.reflected_through_seq),
    attemptRange: typeof row?.attempt_range === "string" ? row.attempt_range : null,
    attemptCount: number(row?.attempt_count),
    failedAttempts: number(row?.failed_attempts),
  };
}

function writeAttempt(
  db: DatabaseSync,
  conversationId: string,
  range: string,
  count: number,
  failed: number,
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO afterglow_state (conversation_id, reflected_through_seq, attempt_range, attempt_count, failed_attempts, updated_at_ms)
     VALUES (?, 0, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       attempt_range = excluded.attempt_range,
       attempt_count = excluded.attempt_count,
       failed_attempts = excluded.failed_attempts,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(conversationId, range, count, failed, nowMs);
}

/** Advance the watermark. It never moves backwards. */
export function advanceAfterglowWatermark(
  db: DatabaseSync,
  conversationId: string,
  throughSeq: number,
  outcome: string,
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO afterglow_state (conversation_id, reflected_through_seq, attempt_range, attempt_count, last_outcome, updated_at_ms)
     VALUES (?, ?, NULL, 0, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       reflected_through_seq = MAX(afterglow_state.reflected_through_seq, excluded.reflected_through_seq),
       attempt_range = NULL,
       attempt_count = 0,
       failed_attempts = 0,
       last_outcome = excluded.last_outcome,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(conversationId, throughSeq, outcome, nowMs);
}

/** Conversation rows Ashley has not reflected on yet, oldest first. */
export function listUnreflectedRows(db: DatabaseSync, conversationId: string, limit: number): AfterglowRow[] {
  const state = readAfterglowState(db, conversationId);
  return (db.prepare(
    `SELECT rowid AS seq, row_id, role, text, created_at_ms, data_classification
       FROM conversation_evidence_log
      WHERE conversation_id = ?
        AND rowid > ?
        AND role IN ('owner', 'ashley')
        AND text IS NOT NULL AND text != ''
        AND source_status != 'redacted'
        AND (role = 'owner' OR delivered = 1)
      ORDER BY rowid ASC
      LIMIT ?`,
  ).all(conversationId, state.reflectedThroughSeq, Math.max(1, limit)) as Row[]).map((row) => ({
    seq: number(row.seq),
    rowId: text(row.row_id),
    role: row.role === "ashley" ? "ashley" as const : "owner" as const,
    text: text(row.text),
    createdAtMs: number(row.created_at_ms),
    dataClassification: classification(row.data_classification),
  }));
}

function lastActivityAtMs(db: DatabaseSync, conversationId: string): number {
  const row = db.prepare(
    `SELECT MAX(created_at_ms) AS at_ms FROM conversation_evidence_log
      WHERE conversation_id = ? AND role IN ('owner', 'ashley')`,
  ).get(conversationId) as Row | undefined;
  return number(row?.at_ms);
}

export function evaluateAfterglow(
  db: DatabaseSync,
  input: { conversationId: string; nowMs: number },
): AfterglowDecision {
  const rows = listUnreflectedRows(db, input.conversationId, AFTERGLOW_MAX_ROWS);
  // A stretch with no Owner message is not a conversation to reflect on yet.
  if (!rows.some((row) => row.role === "owner")) return { kind: "nothing" };
  const silentForMs = Math.max(0, input.nowMs - lastActivityAtMs(db, input.conversationId));
  if (silentForMs >= AFTERGLOW_SILENCE_MS) return { kind: "due", mode: "silence", rows };
  if (rows.length > AFTERGLOW_ROLLING_ROWS && silentForMs >= AFTERGLOW_ROLLING_QUIET_MS) {
    return { kind: "due", mode: "rolling", rows };
  }
  return { kind: "not_due", unreflected: rows.length, silentForMs };
}

function afterglowEventId(conversationId: string, range: string, attempt: number): string {
  return `afterglow:${conversationId}:${range}:${attempt}`;
}

const LIVE_EVENT_STATUSES = new Set(["pending", "claimed", "failed_retryable"]);

function getInboxEvent(db: DatabaseSync, eventId: string): { status: string; createdAtMs: number } | null {
  const row = db.prepare("SELECT status, created_at_ms FROM inbox_events WHERE id = ?").get(eventId) as Row | undefined;
  return row ? { status: text(row.status), createdAtMs: number(row.created_at_ms) } : null;
}

function ownerSpokeSince(db: DatabaseSync, conversationId: string, sinceMs: number): boolean {
  return db.prepare(
    `SELECT 1 FROM conversation_evidence_log
      WHERE conversation_id = ? AND role = 'owner' AND created_at_ms >= ? LIMIT 1`,
  ).get(conversationId, sinceMs) !== undefined;
}

/**
 * One afterglow opportunity for one conversation. Runs at most one private
 * Thought, through the same wake, private budget, inbox, and kernel path as
 * every other private cycle.
 */
export async function tickAfterglow(
  db: DatabaseSync,
  options: {
    conversationId: string;
    occupantId: string;
    authorityEpoch: number;
    nowMs?: number;
    thought: IdleThoughtRunner;
    privateBudgetPolicyId?: string;
  },
): Promise<AfterglowTickResult> {
  const nowMs = options.nowMs ?? Date.now();
  const { conversationId } = options;
  const decision = evaluateAfterglow(db, { conversationId, nowMs });
  if (decision.kind === "nothing") return { outcome: "nothing" };
  if (decision.kind === "not_due") return { outcome: "not_due" };
  // The Owner always comes first: never reflect while a turn is in progress.
  if (isPrivateThoughtActive(conversationId) || getCurrentCycle(db, conversationId)) {
    return { outcome: "busy", mode: decision.mode };
  }

  const { rows, mode } = decision;
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const range = `${first.rowId}..${last.rowId}`;
  const state = readAfterglowState(db, conversationId);
  const sameRange = state.attemptRange === range;
  const previousAttempts = sameRange ? state.attemptCount : 0;
  let failedAttempts = sameRange ? state.failedAttempts : 0;
  if (previousAttempts > 0) {
    const previous = getInboxEvent(db, afterglowEventId(conversationId, range, previousAttempts));
    if (previous !== null && LIVE_EVENT_STATUSES.has(previous.status)) return { outcome: "in_flight", mode };
    // The Owner coming back pre-empts an afterglow; that is not a failure.
    if (!ownerSpokeSince(db, conversationId, previous?.createdAtMs ?? nowMs)) failedAttempts += 1;
  }
  if (failedAttempts >= AFTERGLOW_MAX_ATTEMPTS) {
    // Repeated failure must not block every later reflection. These rows stay
    // in the searchable log; only this afterglow is given up.
    advanceAfterglowWatermark(db, conversationId, last.seq, "abandoned", nowMs);
    return { outcome: "abandoned", mode, coveredRows: rows.length };
  }

  const attempt = previousAttempts + 1;
  const triggerRef = `afterglow:${range}#${attempt}`;
  const policyId = options.privateBudgetPolicyId ?? PRIVATE_THOUGHT_POLICY_ID;
  const projection = getPrivateBudgetProjection(db, { conversationId, policyId, wallClockNowMs: nowMs });
  if (projection.clockState === "clock_reconciliation" || projection.remaining <= 0) {
    return { outcome: "budget", mode };
  }
  // Count the attempt before any durable work exists, so a crash between the
  // steps below costs an attempt instead of repeating one forever.
  writeAttempt(db, conversationId, range, attempt, failedAttempts, nowMs);
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
  if (admission.kind === "stale" || admission.kind === "cancelled") return { outcome: "wake_closed", mode };
  if (getInboxEvent(db, afterglowEventId(conversationId, range, attempt)) !== null) return { outcome: "in_flight", mode };
  const cycle = getCycle(db, admission.wake.cycleId);
  if (!cycle) throw new Error("afterglow_cycle_missing");
  const budget = reservePrivateThought(db, {
    admissionId: `private-thought:${cycle.wakeId}`,
    wakeId: cycle.wakeId,
    conversationId,
    policyId,
    wallClockNowMs: nowMs,
  });
  if (budget.kind === "refused" || budget.reservation.state !== "held") {
    writeAttempt(db, conversationId, range, previousAttempts, sameRange ? state.failedAttempts : 0, nowMs);
    return { outcome: "budget", mode };
  }

  const pass: AfterglowPass = {
    kind: "afterglow",
    mode,
    rowIds: rows.map((row) => row.rowId),
    throughSeq: last.seq,
  };
  const event = appendInboxEvent(db, {
    id: afterglowEventId(conversationId, range, attempt),
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
  return { outcome: "ran", mode, coveredRows: rows.length, thought };
}

/** The covered rows as they stand now; a forgotten row comes back redacted. */
export function loadAfterglowRows(
  db: DatabaseSync,
  rowIds: readonly string[],
): Array<AfterglowRow & { redacted: boolean }> {
  return rowIds.flatMap((rowId) => {
    const row = db.prepare(
      `SELECT rowid AS seq, row_id, role, text, created_at_ms, data_classification, source_status
         FROM conversation_evidence_log WHERE row_id = ?`,
    ).get(rowId) as Row | undefined;
    if (!row) return [];
    return [{
      seq: number(row.seq),
      rowId,
      role: row.role === "ashley" ? "ashley" as const : "owner" as const,
      text: text(row.text),
      createdAtMs: number(row.created_at_ms),
      dataClassification: classification(row.data_classification),
      redacted: row.text == null || text(row.source_status) === "redacted",
    }];
  });
}

/**
 * Store what Ashley wrote and move the watermark past the covered rows.
 * Idempotent. A forget that reached any covered row first wins: the
 * reflection is dropped, and only the watermark moves.
 */
export function completeAfterglow(
  db: DatabaseSync,
  input: {
    conversationId: string;
    cycleId: string;
    pass: AfterglowPass;
    reflection: AfterglowReflection | undefined;
    nowMs: number;
  },
): "reflected" | "forget_race" {
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = loadAfterglowRows(db, input.pass.rowIds);
    const forgotten = rows.length !== input.pass.rowIds.length || rows.some((row) => row.redacted);
    if (!forgotten && input.reflection?.episode) {
      recordEpisode(db, {
        conversationId: input.conversationId,
        cycleId: input.cycleId,
        rows,
        reflection: input.reflection.episode,
        nowMs: input.nowMs,
      });
    }
    if (!forgotten && input.reflection?.threadStory) {
      writeThreadStory(db, {
        conversationId: input.conversationId,
        story: input.reflection.threadStory,
        throughRowId: rows[rows.length - 1]?.rowId ?? null,
        cycleId: input.cycleId,
        dataClassification: maxClassification(...rows.map((row) => row.dataClassification)),
        nowMs: input.nowMs,
      });
    }
    const outcome = forgotten ? "forget_race" : "reflected";
    advanceAfterglowWatermark(db, input.conversationId, input.pass.throughSeq, outcome, input.nowMs);
    db.exec("COMMIT");
    return outcome;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  }
}
