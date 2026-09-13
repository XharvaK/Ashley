import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  CAPACITY_WAIT_MAX_DURATION_MS,
  type CreateDeferredFrontierInput,
  type ClaimFrontierResult,
  type DeferredFrontierState,
  type DeferredReactiveFrontierRecord,
  type RescheduleFrontierResult,
} from "./types.js";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mapFrontier(row: unknown): DeferredReactiveFrontierRecord | null {
  if (!isRow(row)) return null;
  const frontierId = stringValue(row.frontier_id);
  if (!frontierId) return null;
  return {
    frontierId,
    conversationId: stringValue(row.conversation_id),
    cycleId: stringValue(row.cycle_id),
    generation: numberValue(row.generation),
    state: stringValue(row.state) as DeferredFrontierState,
    nextEligibleAtMs: numberValue(row.next_eligible_at_ms),
    capacityDeadlineAtMs: numberValue(row.capacity_deadline_at_ms),
    latestEvidenceRowId: stringValue(row.latest_evidence_row_id),
    claimToken: row.claim_token == null ? null : stringValue(row.claim_token),
    leaseExpiresAtMs: row.lease_expires_at_ms == null ? null : numberValue(row.lease_expires_at_ms),
    attemptCount: numberValue(row.attempt_count),
    createdAtMs: numberValue(row.created_at_ms),
    updatedAtMs: numberValue(row.updated_at_ms),
    terminalReason: row.terminal_reason == null ? null : stringValue(row.terminal_reason),
  };
}

export function insertDeferredFrontierRecord(
  db: DatabaseSync,
  input: CreateDeferredFrontierInput,
): DeferredReactiveFrontierRecord {
  const frontierId = input.frontierId ?? randomUUID();
  const nowMs = input.nowMs ?? Date.now();
  if (input.nextEligibleAtMs <= nowMs) {
    throw new Error(`invalid_frontier_schedule:non_forward_hint:${input.nextEligibleAtMs}<=${nowMs}`);
  }
  const capacityDeadlineAtMs = nowMs + CAPACITY_WAIT_MAX_DURATION_MS;

  db.prepare(
    `INSERT INTO deferred_reactive_frontiers
       (frontier_id, conversation_id, cycle_id, generation, state,
        next_eligible_at_ms, capacity_deadline_at_ms, latest_evidence_row_id,
        claim_token, lease_expires_at_ms, attempt_count, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?, NULL, NULL, 0, ?, ?)`,
  ).run(
    frontierId,
    input.conversationId,
    input.cycleId,
    input.generation,
    input.nextEligibleAtMs,
    capacityDeadlineAtMs,
    input.latestEvidenceRowId,
    nowMs,
    nowMs,
  );

  const frontier = getDeferredFrontier(db, frontierId);
  if (!frontier) throw new Error("frontier_creation_failed");
  return frontier;
}

/** Deprecated alias for insertDeferredFrontierRecord */
export const createDeferredFrontierInTransaction = insertDeferredFrontierRecord;

export function getActiveDeferredFrontier(
  db: DatabaseSync,
  conversationId: string,
): DeferredReactiveFrontierRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM deferred_reactive_frontiers
       WHERE conversation_id = ? AND state IN ('waiting', 'running')
       LIMIT 1`,
    )
    .get(conversationId);
  return mapFrontier(row);
}

export function getDeferredFrontier(
  db: DatabaseSync,
  frontierId: string,
): DeferredReactiveFrontierRecord | null {
  const row = db
    .prepare(`SELECT * FROM deferred_reactive_frontiers WHERE frontier_id = ? LIMIT 1`)
    .get(frontierId);
  return mapFrontier(row);
}

export function advanceDeferredFrontierEvidence(
  db: DatabaseSync,
  frontierId: string,
  latestEvidenceRowId: string,
  nowMs = Date.now(),
): boolean {
  const result = db
    .prepare(
      `UPDATE deferred_reactive_frontiers
       SET latest_evidence_row_id = ?, updated_at_ms = ?
       WHERE frontier_id = ? AND state IN ('waiting', 'running')`,
    )
    .run(latestEvidenceRowId, nowMs, frontierId);
  return Number(result.changes) === 1;
}

export function claimDueDeferredFrontier(
  db: DatabaseSync,
  frontierId: string,
  claimToken: string,
  leaseMs: number,
  nowMs = Date.now(),
): ClaimFrontierResult {
  const leaseExpiresAtMs = nowMs + leaseMs;
  const result = db
    .prepare(
      `UPDATE deferred_reactive_frontiers
       SET state = 'running',
           claim_token = ?,
           lease_expires_at_ms = ?,
           attempt_count = attempt_count + 1,
           updated_at_ms = ?
       WHERE frontier_id = ?
         AND (
           (state = 'waiting' AND next_eligible_at_ms <= ?)
           OR (state = 'running' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
         )`,
    )
    .run(claimToken, leaseExpiresAtMs, nowMs, frontierId, nowMs, nowMs);

  const claimed = Number(result.changes) === 1;
  if (!claimed) return { claimed: false };
  const frontier = getDeferredFrontier(db, frontierId);
  return { claimed: true, frontier: frontier ?? undefined };
}

export function rescheduleDeferredFrontier(
  db: DatabaseSync,
  frontierId: string,
  nextEligibleAtMs: number,
  nowMs = Date.now(),
): RescheduleFrontierResult {
  const current = getDeferredFrontier(db, frontierId);
  if (!current) throw new Error("frontier_not_found");
  if (current.state !== "running" && current.state !== "waiting") {
    throw new Error(`frontier_reschedule_invalid_state:${current.state}`);
  }

  if (nowMs >= current.capacityDeadlineAtMs || nextEligibleAtMs > current.capacityDeadlineAtMs) {
    exhaustDeferredFrontier(db, frontierId, nowMs, "capacity_wait_max_duration_exceeded");
    const updated = getDeferredFrontier(db, frontierId);
    return { outcome: "exhausted", frontier: updated ?? undefined, reason: "capacity_wait_max_duration_exceeded" };
  }

  if (nextEligibleAtMs <= nowMs) {
    exhaustDeferredFrontier(db, frontierId, nowMs, "non_forward_scheduling_hint");
    const updated = getDeferredFrontier(db, frontierId);
    return { outcome: "exhausted", frontier: updated ?? undefined, reason: "non_forward_scheduling_hint" };
  }

  const result = db
    .prepare(
      `UPDATE deferred_reactive_frontiers
       SET state = 'waiting',
           next_eligible_at_ms = ?,
           claim_token = NULL,
           lease_expires_at_ms = NULL,
           updated_at_ms = ?
       WHERE frontier_id = ? AND state IN ('running', 'waiting')`,
    )
    .run(nextEligibleAtMs, nowMs, frontierId);

  if (Number(result.changes) !== 1) throw new Error("frontier_reschedule_lost");
  const updated = getDeferredFrontier(db, frontierId);
  return { outcome: "rescheduled", frontier: updated ?? undefined };
}

export function resolveDeferredFrontier(
  db: DatabaseSync,
  frontierId: string,
  nowMs = Date.now(),
): boolean {
  const result = db
    .prepare(
      `UPDATE deferred_reactive_frontiers
       SET state = 'resolved',
           claim_token = NULL,
           lease_expires_at_ms = NULL,
           updated_at_ms = ?
       WHERE frontier_id = ? AND state = 'running'`,
    )
    .run(nowMs, frontierId);
  return Number(result.changes) === 1;
}

export function exhaustDeferredFrontier(
  db: DatabaseSync,
  frontierId: string,
  nowMs = Date.now(),
  terminalReason: string | null = null,
): boolean {
  const result = db
    .prepare(
      `UPDATE deferred_reactive_frontiers
        SET state = 'exhausted',
            terminal_reason = ?,
            claim_token = NULL,
            lease_expires_at_ms = NULL,
            updated_at_ms = ?
        WHERE frontier_id = ? AND state IN ('waiting', 'running')`,
    )
    .run(terminalReason, nowMs, frontierId);
  return Number(result.changes) === 1;
}

export function listDueDeferredFrontiers(
  db: DatabaseSync,
  nowMs = Date.now(),
): DeferredReactiveFrontierRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM deferred_reactive_frontiers
       WHERE (state = 'waiting' AND next_eligible_at_ms <= ?)
          OR (state = 'running' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
       ORDER BY next_eligible_at_ms ASC, created_at_ms ASC`,
    )
    .all(nowMs, nowMs);
  return rows.flatMap((row) => {
    const item = mapFrontier(row);
    return item ? [item] : [];
  });
}

export function getNextDueFrontierDelayMs(
  db: DatabaseSync,
  nowMs = Date.now(),
): number | null {
  const row = db
    .prepare(
      `SELECT MIN(next_eligible_at_ms) AS earliest
       FROM deferred_reactive_frontiers
       WHERE state = 'waiting'`,
    )
    .get() as { earliest?: unknown } | undefined;
  if (!row || row.earliest == null) return null;
  const earliest = numberValue(row.earliest);
  return Math.max(0, earliest - nowMs);
}
