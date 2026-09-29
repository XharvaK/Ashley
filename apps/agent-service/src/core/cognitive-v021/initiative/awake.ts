import { createHash } from "node:crypto";
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
import type { AwakePass } from "./inner-pass.js";

export { awakePassFromPayload, type AwakePass } from "./inner-pass.js";

/**
 * Growth V1 §5.1 and §5.3: the AWAKE rhythm.
 *
 * Every three hours (jittered by up to 20 minutes either way) Ashley gets a
 * pass of her own time. The Host decides only when; in the pass she chooses
 * what to do from her inner agenda: think, read, plan, reach out, or rest.
 *
 * Layering (rule 3): AWAKE never re-reads raw conversation. While the Owner
 * conversation is still live it waits, and when an afterglow is due that
 * runs first; AWAKE then consumes the episodes written since its own last
 * pass.
 */

export const AWAKE_INTERVAL_MS = 3 * 60 * 60_000;
export const AWAKE_JITTER_MS = 20 * 60_000;
/** The first pass after the rhythm starts, so a fresh start reflects first. */
export const AWAKE_FIRST_DELAY_MS = 20 * 60_000;

export type InnerState = {
  nextAwakeAtMs: number;
  lastAwakeAtMs: number | null;
  slot: number;
  lastOutcome: string | null;
};

export type AwakeTickResult = {
  outcome:
    | "scheduled"
    | "not_due"
    | "afterglow_first"
    | "engaged"
    | "busy"
    | "in_flight"
    | "budget"
    | "wake_closed"
    | "ran";
  slot?: number;
  nextAwakeAtMs?: number;
  thought?: IdleTickResult;
};

type Row = Record<string, unknown>;

export function readInnerState(db: DatabaseSync, conversationId: string): InnerState | null {
  const row = db.prepare("SELECT * FROM inner_state WHERE conversation_id = ?").get(conversationId) as Row | undefined;
  if (!row) return null;
  return {
    nextAwakeAtMs: Number(row.next_awake_at_ms),
    lastAwakeAtMs: row.last_awake_at_ms == null ? null : Number(row.last_awake_at_ms),
    slot: Number(row.awake_slot ?? 0),
    lastOutcome: typeof row.last_outcome === "string" ? row.last_outcome : null,
  };
}

function writeInnerState(db: DatabaseSync, conversationId: string, state: InnerState, nowMs: number): void {
  db.prepare(
    `INSERT INTO inner_state (conversation_id, next_awake_at_ms, last_awake_at_ms, awake_slot, last_outcome, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       next_awake_at_ms = excluded.next_awake_at_ms,
       last_awake_at_ms = excluded.last_awake_at_ms,
       awake_slot = excluded.awake_slot,
       last_outcome = excluded.last_outcome,
       updated_at_ms = excluded.updated_at_ms`,
  ).run(conversationId, state.nextAwakeAtMs, state.lastAwakeAtMs, state.slot, state.lastOutcome, nowMs);
}

/** Deterministic jitter in [-20 min, +20 min] per slot, so the rhythm never locks to the clock. */
export function awakeJitterMs(conversationId: string, slot: number): number {
  const digest = createHash("sha256").update(`${conversationId}\n${slot}`).digest();
  const unit = digest.readUInt32BE(0) / 0xffffffff;
  return Math.round((unit * 2 - 1) * AWAKE_JITTER_MS);
}

function awakeEventId(conversationId: string, slot: number): string {
  return `awake:${conversationId}:${slot}`;
}

const LIVE_EVENT_STATUSES = new Set(["pending", "claimed", "failed_retryable"]);

function eventLive(db: DatabaseSync, eventId: string): boolean {
  const row = db.prepare("SELECT status FROM inbox_events WHERE id = ?").get(eventId) as Row | undefined;
  return row !== undefined && LIVE_EVENT_STATUSES.has(String(row.status));
}

/**
 * One AWAKE opportunity. Runs at most one private Thought, through the same
 * wake, private budget, inbox, and kernel path as every other private cycle.
 */
export async function tickAwake(
  db: DatabaseSync,
  options: {
    conversationId: string;
    occupantId: string;
    authorityEpoch: number;
    nowMs?: number;
    thought: IdleThoughtRunner;
    /** When afterglow is switched off, a due afterglow must not hold AWAKE back forever. */
    afterglowEnabled?: boolean;
    privateBudgetPolicyId?: string;
  },
): Promise<AwakeTickResult> {
  const nowMs = options.nowMs ?? Date.now();
  const { conversationId } = options;
  const state = readInnerState(db, conversationId);
  if (!state) {
    const nextAwakeAtMs = nowMs + AWAKE_FIRST_DELAY_MS;
    writeInnerState(db, conversationId, { nextAwakeAtMs, lastAwakeAtMs: null, slot: 0, lastOutcome: "scheduled" }, nowMs);
    return { outcome: "scheduled", nextAwakeAtMs };
  }
  if (nowMs < state.nextAwakeAtMs) return { outcome: "not_due", nextAwakeAtMs: state.nextAwakeAtMs };

  const afterglow = evaluateAfterglow(db, { conversationId, nowMs });
  if (afterglow.kind === "not_due") return { outcome: "engaged" };
  if (afterglow.kind === "due" && options.afterglowEnabled !== false) return { outcome: "afterglow_first" };
  if (isPrivateThoughtActive(conversationId) || getCurrentCycle(db, conversationId)) return { outcome: "busy" };
  if (state.slot > 0 && eventLive(db, awakeEventId(conversationId, state.slot))) {
    return { outcome: "in_flight", slot: state.slot };
  }

  const policyId = options.privateBudgetPolicyId ?? PRIVATE_THOUGHT_POLICY_ID;
  const projection = getPrivateBudgetProjection(db, { conversationId, policyId, wallClockNowMs: nowMs });
  if (projection.clockState === "clock_reconciliation" || projection.remaining <= 0) return { outcome: "budget" };

  const slot = state.slot + 1;
  const nextAwakeAtMs = nowMs + AWAKE_INTERVAL_MS + awakeJitterMs(conversationId, slot + 1);
  // Move the rhythm before any durable work exists: a crash below costs one
  // pass instead of repeating it forever.
  writeInnerState(db, conversationId, { nextAwakeAtMs, lastAwakeAtMs: nowMs, slot, lastOutcome: "started" }, nowMs);
  const triggerRef = `awake:${slot}`;
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
  if (!cycle) throw new Error("awake_cycle_missing");
  const budget = reservePrivateThought(db, {
    admissionId: `private-thought:${cycle.wakeId}`,
    wakeId: cycle.wakeId,
    conversationId,
    policyId,
    wallClockNowMs: nowMs,
  });
  if (budget.kind === "refused" || budget.reservation.state !== "held") {
    writeInnerState(db, conversationId, { ...state, lastOutcome: "budget" }, nowMs);
    return { outcome: "budget" };
  }

  const pass: AwakePass = { kind: "awake", slot, sinceMs: state.lastAwakeAtMs ?? 0 };
  const event = appendInboxEvent(db, {
    id: awakeEventId(conversationId, slot),
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
  writeInnerState(db, conversationId, {
    nextAwakeAtMs,
    lastAwakeAtMs: nowMs,
    slot,
    lastOutcome: thought.reason ?? "ran",
  }, nowMs);
  return { outcome: "ran", slot, nextAwakeAtMs, thought };
}
