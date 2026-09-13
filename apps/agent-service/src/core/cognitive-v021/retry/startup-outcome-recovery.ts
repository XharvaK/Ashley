import type { DatabaseSync } from "node:sqlite";
import { reconcileOutcomeUnknown } from "./ledger.js";

export type NoDispatchProof =
  | { ok: true; eventId: string; wakeId: string; cycleId: string; generation: number }
  | { ok: false; eventId: string; reason: string };

export type StartupOutcomeRecoveryResult = {
  scanned: number;
  recoveredToPending: number;
  leftReconciling: number;
  recoveredEventIds: string[];
};

/**
 * Advisory rotation cursor for the P0 steady-state pass. Loop-local,
 * in-memory performance state only: crash/restart loses it and the scan
 * restarts oldest-first with identical correctness (proof-gating is
 * idempotent). A permanently proof-failed oldest row is therefore attempted
 * once per rotation, not once per pass, so it cannot starve later
 * proof-resolvable rows forever under a bounded batch.
 */
export type OutcomeUnknownScanCursor = { createdAtMs: number; id: string } | null;

type DbRow = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function row(value: unknown): DbRow | undefined {
  return typeof value === "object" && value !== null ? (value as DbRow) : undefined;
}

/** Repair lineage used by reconcileOutcomeUnknown: this event plus predecessors. */
function lineageEventIds(db: DatabaseSync, eventId: string): string[] {
  const eventIds: string[] = [eventId];
  let cursor: string | null = eventId;
  while (cursor) {
    const repairRow = row(
      db.prepare("SELECT predecessor_event_id FROM durable_work_repairs WHERE repair_event_id = ?").get(cursor),
    );
    const predecessor = repairRow?.predecessor_event_id;
    if (typeof predecessor === "string" && predecessor && !eventIds.includes(predecessor)) {
      eventIds.push(predecessor);
      cursor = predecessor;
    } else {
      cursor = null;
    }
  }
  return eventIds;
}

/**
 * Mechanical no-external-dispatch proof for a stranded outcome-unknown event.
 *
 * Proof requires ALL of (source-defined external-dispatch bearing state):
 * - no in_flight_effects bound by origin_event_id lineage nor by wake_id;
 * - no published settlement identity for the event's cycle/generation (or wake);
 * - no speech_outbox row for the event's cycle/generation;
 * - no system_notice_outbox row for the event's cycle;
 * - no durable attempt in the lineage with dispatch_truth beyond unknown/not_started.
 *
 * Anything else fails closed. No synthetic terminal outcome is produced here.
 */
export function proveNoExternalDispatch(db: DatabaseSync, eventId: string): NoDispatchProof {
  const eventRow = row(
    db.prepare("SELECT id, conversation_id, state, wake_id FROM inbox_events WHERE id = ?").get(eventId),
  );
  if (!eventRow) return { ok: false, eventId, reason: "event_missing" };
  const wakeId = text(eventRow.wake_id);
  if (!wakeId) return { ok: false, eventId, reason: "wake_missing" };

  const wakeRow = row(db.prepare("SELECT wake_id, cycle_id FROM wakes WHERE wake_id = ?").get(wakeId));
  if (!wakeRow) return { ok: false, eventId, reason: "wake_missing" };
  const cycleId = text(wakeRow.cycle_id);
  if (!cycleId) return { ok: false, eventId, reason: "cycle_missing" };

  const cycleRow = row(
    db.prepare("SELECT cycle_id, generation FROM cycle_records WHERE cycle_id = ? LIMIT 1").get(cycleId),
  );
  if (!cycleRow) return { ok: false, eventId, reason: "cycle_missing" };
  const generation = number(cycleRow.generation);

  const eventIds = lineageEventIds(db, eventId);
  const placeholders = eventIds.map(() => "?").join(",");

  // 1. Bound or wake-scoped in-flight effects prove possible dispatch.
  const boundEffect = row(
    db.prepare(`SELECT effect_id FROM in_flight_effects WHERE origin_event_id IN (${placeholders}) LIMIT 1`).get(...eventIds),
  );
  if (boundEffect) return { ok: false, eventId, reason: "in_flight_effect_present" };
  const wakeEffect = row(db.prepare("SELECT effect_id FROM in_flight_effects WHERE wake_id = ? LIMIT 1").get(wakeId));
  if (wakeEffect) return { ok: false, eventId, reason: "in_flight_effect_present" };

  // 2. Published settlement identity for this cycle/generation (or wake) proves dispatch-adjacent publication.
  const settlement = row(
    db
      .prepare("SELECT settlement_id FROM settlements WHERE cycle_id = ? AND generation = ? LIMIT 1")
      .get(cycleId, generation),
  );
  if (settlement) return { ok: false, eventId, reason: "settlement_present" };
  const wakeSettlement = row(db.prepare("SELECT settlement_id FROM settlements WHERE wake_id = ? LIMIT 1").get(wakeId));
  if (wakeSettlement) return { ok: false, eventId, reason: "settlement_present" };

  // 3. Speech outbox for this cycle/generation proves owner-visible dispatch.
  const outbox = row(
    db
      .prepare("SELECT outbox_id FROM speech_outbox WHERE cycle_id = ? AND generation = ? LIMIT 1")
      .get(cycleId, generation),
  );
  if (outbox) return { ok: false, eventId, reason: "speech_outbox_present" };

  // 4. System-notice outbox for this cycle proves owner-visible dispatch.
  // UNKNOWN != ABSENT: a query/inspection failure is PROOF_UNAVAILABLE and
  // must fail closed, never fall through as proven absent.
  try {
    const notice = row(db.prepare("SELECT notice_id FROM system_notice_outbox WHERE cycle_id = ? LIMIT 1").get(cycleId));
    if (notice) return { ok: false, eventId, reason: "system_notice_present" };
  } catch {
    return { ok: false, eventId, reason: "proof_unavailable" };
  }

  // 5. A lineage attempt that already records attempted/responded dispatch truth
  // cannot be proven undispatched.
  const dispatchedAttempt = row(
    db
      .prepare(
        `SELECT attempt_id FROM durable_work_attempts WHERE event_id IN (${placeholders}) AND dispatch_truth NOT IN ('unknown', 'not_started') LIMIT 1`,
      )
      .get(...eventIds),
  );
  if (dispatchedAttempt) return { ok: false, eventId, reason: "dispatch_truth_present" };

  return { ok: true, eventId, wakeId, cycleId, generation };
}

/**
 * Bounded durable-work startup reconciliation for stranded outcome-unknown work.
 *
 * Ownership lives in the DURABLE-WORK / RETRY subsystem. It must run during
 * startup before the normal inbox consumer begins, and never inside
 * cycle/reconcile.ts. Each reconciling outcome-unknown event is returned to
 * pending only after the mechanical no-dispatch proof above completes; then
 * reconcileOutcomeUnknown performs the safe_to_retry transition (inbox
 * pending + wake pending) preserving event/wake/cycle/generation lineage so
 * the normal consumer can reclaim the SAME durable obligation with a fresh
 * Thought pass. Incomplete proof remains fail closed (outcome unknown).
 */
export function reconcileStrandedOutcomeUnknownAtStartup(
  db: DatabaseSync,
  options: { nowMs?: number; limit?: number; cursor?: OutcomeUnknownScanCursor } = {},
): StartupOutcomeRecoveryResult & { nextCursor: OutcomeUnknownScanCursor } {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const cursor = options.cursor ?? null;
  const rows = (cursor
    ? db
      .prepare(
        `SELECT id, created_at_ms FROM inbox_events
          WHERE state = 'reconciling' AND last_failure_class = 'outcome_unknown_reconcile'
            AND (created_at_ms > ? OR (created_at_ms = ? AND id > ?))
          ORDER BY created_at_ms ASC, id ASC LIMIT ?`,
      )
      .all(cursor.createdAtMs, cursor.createdAtMs, cursor.id, limit)
    : db
      .prepare(
        `SELECT id, created_at_ms FROM inbox_events
          WHERE state = 'reconciling' AND last_failure_class = 'outcome_unknown_reconcile'
          ORDER BY created_at_ms ASC, id ASC LIMIT ?`,
      )
      .all(limit)) as Array<{ id?: unknown; created_at_ms?: unknown }>;

  const result: StartupOutcomeRecoveryResult & { nextCursor: OutcomeUnknownScanCursor } = {
    scanned: 0,
    recoveredToPending: 0,
    leftReconciling: 0,
    recoveredEventIds: [],
    nextCursor: null,
  };

  for (const value of rows) {
    const id = text(value.id);
    if (!id) continue;
    result.scanned += 1;
    try {
      const proof = proveNoExternalDispatch(db, id);
      if (!proof.ok) {
        result.leftReconciling += 1;
        continue;
      }
      const outcome = reconcileOutcomeUnknown(db, {
        eventId: id,
        nowMs,
        noExternalDispatchProof: true,
        proofRef: `startup-no-dispatch:${id}:${nowMs}`,
      });
      if (outcome.kind === "pending" && outcome.reason === "safe_to_retry") {
        result.recoveredToPending += 1;
        result.recoveredEventIds.push(id);
      } else {
        result.leftReconciling += 1;
      }
    } catch {
      // Fail closed: leave the event reconciling for operator/receipt truth.
      result.leftReconciling += 1;
    }
  }

  // Rotation accounting: a full page means more rows may remain — the next
  // pass resumes AFTER the last row attempted here. A short page ends the
  // rotation (the next pass restarts oldest-first with identical correctness).
  if (rows.length >= limit) {
    const last = rows[rows.length - 1]!;
    const createdAtMs = typeof last.created_at_ms === "number" ? last.created_at_ms : Number(last.created_at_ms);
    const id = typeof last.id === "string" ? last.id : "";
    result.nextCursor = id && Number.isFinite(createdAtMs) ? { createdAtMs, id } : null;
  }

  return result;
}
