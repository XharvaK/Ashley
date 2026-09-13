import type { DatabaseSync } from "node:sqlite";
import { listDeliveryBubbles } from "../../delivery/store.js";
import { getSpeechOutbox } from "../speech/outbox.js";
import { getSystemNotice } from "../speech/infrastructure-notice.js";
import {
  buildDeliveryC3TerminalFailure,
  buildFrontierC3TerminalFailure,
  buildRetryC3TerminalFailure,
  buildThoughtC3TerminalFailure,
  safeRecordC3TerminalExperience,
} from "./c3-recorder.js";
import type {
  C3RepairOptions,
  C3RepairResult,
  C3TerminalExperienceRecord,
  SidecarDb,
} from "./types.js";

type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = number(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function occurredAt(value: unknown, fallback: number): number {
  const numeric = nullableNumber(value);
  if (numeric != null) return numeric;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function experienceExists(sidecar: DatabaseSync, experienceId: string): boolean {
  return Boolean(sidecar.prepare(
    "SELECT 1 FROM c3_terminal_experiences WHERE experience_id = ? LIMIT 1",
  ).get(experienceId));
}

function cutover(sidecar: DatabaseSync): Row {
  const value = row(sidecar.prepare(
    "SELECT * FROM c3_activation_cutover WHERE id = 1",
  ).get());
  if (!value) throw new Error("c3_activation_cutover_missing");
  return value;
}

/**
 * The delivery watermark is intentionally write-once. Migration cannot read
 * the separate nuclear database, so the first valid startup binds the
 * delivery scan to the highest reservation that already existed.
 */
export function initializeC3DeliveryCutover(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
): boolean {
  const current = cutover(sidecar);
  if (current.max_pre_v8_delivery_reservation_id != null) return true;
  const value = row(nuclear.prepare(
    "SELECT MAX(id) AS max_id FROM delivery_reservations",
  ).get());
  const maxId = number(value?.max_id, 0);
  sidecar.prepare(
    `UPDATE c3_activation_cutover
        SET max_pre_v8_delivery_reservation_id = ?
      WHERE id = 1 AND max_pre_v8_delivery_reservation_id IS NULL`,
  ).run(maxId);
  return true;
}

function thoughtCandidates(
  sidecar: DatabaseSync,
  watermark: number | null,
  limit: number,
): C3TerminalExperienceRecord[] {
  const reasons = ["unavailable", "malformed", "revision_exhausted", "authority_rejected", "context_allocation_required_overflow"] as const;
  const clauses = reasons.map(() => "n.notice_key LIKE ?").join(" OR ");
  const rows = sidecar.prepare(
    `SELECT n.notice_id, n.notice_key, n.cycle_id, c.generation, c.updated_at_ms
       FROM system_notice_outbox n
       JOIN cycle_records c ON c.cycle_id = n.cycle_id
      WHERE n.notice_id > COALESCE(?, 0)
        AND COALESCE(n.send_status, '') <> 'suppressed_shadow'
        AND (${clauses})
        AND NOT EXISTS (
          SELECT 1 FROM c3_terminal_experiences x
           WHERE x.experience_id = 'c3:thought:' || n.notice_key
        )
      ORDER BY n.notice_id ASC
      LIMIT ?`,
  ).all(watermark, ...reasons.map((reason) => `%:${reason}`), limit) as Row[];
  return rows.flatMap((value) => {
    const item = row(value);
    if (!item) return [];
    const record = buildThoughtC3TerminalFailure({
      noticeKey: text(item.notice_key),
      noticeId: number(item.notice_id),
      cycleId: text(item.cycle_id),
      generation: number(item.generation),
      occurredAtMs: number(item.updated_at_ms, number(item.notice_id)),
    });
    return record ? [record] : [];
  });
}

function frontierCandidates(
  sidecar: DatabaseSync,
  watermark: number | null,
  limit: number,
  fallbackNowMs: number,
): C3TerminalExperienceRecord[] {
  const rows = sidecar.prepare(
    `SELECT f.frontier_id, f.cycle_id, f.generation, f.updated_at_ms, c.cycle_id AS current_cycle_id
       FROM deferred_reactive_frontiers f
       JOIN cycle_records c ON c.cycle_id = f.cycle_id
      WHERE f.updated_at_ms > COALESCE(?, 0)
        AND f.state = 'exhausted'
        AND f.terminal_reason = 'capacity_wait_max_duration_exceeded'
        AND NOT EXISTS (
          SELECT 1 FROM c3_terminal_experiences x
           WHERE x.experience_id = 'c3:frontier:' || f.frontier_id || ':capacity_wait_max_duration_exceeded'
        )
      ORDER BY f.updated_at_ms ASC, f.frontier_id ASC
      LIMIT ?`,
  ).all(watermark, limit) as Row[];
  return rows.flatMap((value) => {
    const item = row(value);
    if (!item) return [];
    const record = buildFrontierC3TerminalFailure({
      frontierId: text(item.frontier_id),
      cycleId: text(item.cycle_id),
      generation: number(item.generation),
      occurredAtMs: number(item.updated_at_ms, fallbackNowMs),
    });
    return record ? [record] : [];
  });
}

function retryCandidates(
  sidecar: DatabaseSync,
  watermark: number | null,
  limit: number,
  fallbackNowMs: number,
): C3TerminalExperienceRecord[] {
  const rows = sidecar.prepare(
    `SELECT e.id AS event_id, e.wake_id, e.state, e.terminal_reason,
            a.attempt_id, a.ordinal, a.dispatch_truth, a.failure_class, a.error_code,
            a.finished_at_ms, w.cycle_id, c.generation
       FROM inbox_events e
       JOIN durable_work_attempts a ON a.event_id = e.id
       JOIN wakes w ON w.wake_id = e.wake_id
       JOIN cycle_records c ON c.cycle_id = w.cycle_id
      WHERE a.finished_at_ms > COALESCE(?, 0)
        AND a.attempt_id = (
          SELECT latest.attempt_id
            FROM durable_work_attempts latest
           WHERE latest.event_id = e.id
           ORDER BY latest.ordinal DESC
           LIMIT 1
        )
        AND (
          (e.state = 'terminal' AND e.terminal_reason = 'permanent_failure'
            AND a.failure_class = 'permanent_terminal')
          OR
          (e.state = 'quarantined'
            AND e.terminal_reason IN ('age_exhausted', 'attempts_exhausted')
            AND e.wake_id IS NOT NULL)
        )
      ORDER BY a.finished_at_ms ASC, e.id ASC, a.attempt_id ASC
      LIMIT ?`,
  ).all(watermark, limit) as Row[];
  return rows.flatMap((value) => {
    const item = row(value);
    if (!item) return [];
    const terminalReason = text(item.terminal_reason);
    const failureClass = terminalReason === "permanent_failure"
      ? "permanent_terminal"
      : terminalReason;
    const record = buildRetryC3TerminalFailure({
      eventId: text(item.event_id),
      attemptId: text(item.attempt_id),
      wakeId: item.wake_id == null ? null : text(item.wake_id),
      cycleId: text(item.cycle_id),
      generation: number(item.generation),
      ordinal: number(item.ordinal),
      dispatchTruth: text(item.dispatch_truth),
      failureClass,
      errorCode: item.error_code == null ? null : text(item.error_code),
      occurredAtMs: number(item.finished_at_ms, fallbackNowMs),
    });
    return record ? [record] : [];
  });
}

function recordedDeliveryReservationIds(sidecar: DatabaseSync): number[] {
  const rows = sidecar.prepare(
    `SELECT experience_id
       FROM c3_terminal_experiences
      WHERE source_domain_owner = 'delivery'
        AND experience_id LIKE 'c3:delivery:%'`,
  ).all() as Row[];
  return [...new Set(rows.flatMap((value) => {
    const experienceId = text(row(value)?.experience_id);
    const match = /^c3:delivery:(\d+):delivery_(?:aborted|expired|partially_delivered)$/.exec(experienceId);
    if (!match) return [];
    const reservationId = Number(match[1]);
    return Number.isSafeInteger(reservationId) ? [reservationId] : [];
  }))];
}

function deliveryCandidates(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  watermark: number | null,
  activatedAtMs: number,
  limit: number,
  fallbackNowMs: number,
): C3TerminalExperienceRecord[] {
  const recordedReservationIds = recordedDeliveryReservationIds(sidecar);
  const recordedCte = recordedReservationIds.length > 0
    ? `WITH recorded_delivery_reservations(reservation_id) AS (
         VALUES ${recordedReservationIds.map(() => "(?)").join(", ")}
       )`
    : "";
  const recordedExclusion = recordedReservationIds.length > 0
    ? `AND NOT EXISTS (
           SELECT 1
             FROM recorded_delivery_reservations recorded
            WHERE recorded.reservation_id = delivery_reservations.id
         )`
    : "";
  const rows = nuclear.prepare(
    `${recordedCte}
     SELECT id, state, created_at, finalized_at, cognitive_v021_projection_key
       FROM delivery_reservations
       WHERE (
           id > COALESCE(?, 0)
           OR CAST((julianday(finalized_at) - 2440587.5) * 86400000 AS INTEGER) > ?
         )
         AND finalized_at IS NOT NULL
        AND state IN ('aborted', 'expired', 'partially_delivered')
        AND cognitive_v021_projection_key IS NOT NULL
        ${recordedExclusion}
      ORDER BY id ASC
      LIMIT ?`,
  ).all(...recordedReservationIds, watermark, activatedAtMs, limit) as Row[];
  return rows.flatMap((value) => {
    const reservation = row(value);
    if (!reservation) return [];
    const reservationId = number(reservation.id);
    const projectionKey = text(reservation.cognitive_v021_projection_key);
    const match = /^(speech|system):(\d+)$/.exec(projectionKey);
    if (!match) return [];
    const sourceId = Number(match[2]);
    const source = match[1] === "speech"
      ? getSpeechOutbox(sidecar, sourceId)
      : getSystemNotice(sidecar, sourceId);
    if (!source?.cycleId) return [];
    const cycle = row(sidecar.prepare(
      "SELECT generation FROM cycle_records WHERE cycle_id = ? LIMIT 1",
    ).get(source.cycleId));
    const generation = "outboxId" in source
      ? source.generation
      : cycle ? number(cycle.generation) : null;
    if (generation == null) return [];
    const deliveredBubbleCount = listDeliveryBubbles(nuclear, reservationId)
      .filter((bubble) => bubble.discordMessageId).length;
    const state = text(reservation.state);
    if (state !== "aborted" && state !== "expired" && state !== "partially_delivered") return [];
    const record = buildDeliveryC3TerminalFailure({
      reservationId,
      cycleId: source.cycleId,
      generation,
      state,
      occurredAtMs: occurredAt(reservation.finalized_at, occurredAt(reservation.created_at, fallbackNowMs)),
      deliveredBubbleCount,
    });
    return record ? [record] : [];
  });
}

function wasRecordedBefore(sidecar: DatabaseSync, input: C3TerminalExperienceRecord): boolean {
  return experienceExists(sidecar, input.experienceId);
}

function persistCandidates(
  sidecar: DatabaseSync,
  candidates: C3TerminalExperienceRecord[],
): { recorded: number; skipped: number; recoveredExperienceIds: string[] } {
  let recorded = 0;
  let skipped = 0;
  const recoveredExperienceIds: string[] = [];
  for (const candidate of candidates) {
    if (wasRecordedBefore(sidecar, candidate)) {
      skipped += 1;
      continue;
    }
    const stored = safeRecordC3TerminalExperience(sidecar, candidate);
    if (stored) {
      recorded += 1;
      recoveredExperienceIds.push(stored.experienceId);
    } else {
      skipped += 1;
    }
  }
  return { recorded, skipped, recoveredExperienceIds };
}

/**
 * Recover only post-cutover, source-proven terminal experiences. This is a
 * derived repair pass: primary source state is never changed here.
 */
export async function repairMissingC3Experiences(
  sidecar: SidecarDb,
  nuclear: DatabaseSync,
  options: C3RepairOptions = {},
): Promise<C3RepairResult> {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(50, options.limit ?? 50));
  const initialized = initializeC3DeliveryCutover(sidecar, nuclear);
  const marker = cutover(sidecar);
  const sourceLimit = Math.max(limit, Math.min(1000, limit * 10));
  const candidates = [
    ...thoughtCandidates(sidecar, nullableNumber(marker.max_pre_v8_notice_id), sourceLimit),
    ...retryCandidates(sidecar, nullableNumber(marker.max_pre_v8_attempt_finished_at_ms), sourceLimit, nowMs),
    ...frontierCandidates(sidecar, nullableNumber(marker.max_pre_v8_frontier_updated_at_ms), sourceLimit, nowMs),
    ...deliveryCandidates(
      sidecar,
      nuclear,
      nullableNumber(marker.max_pre_v8_delivery_reservation_id),
      number(marker.activated_at_ms),
      sourceLimit,
      nowMs,
    ),
  ].sort((left, right) => left.occurredAtMs - right.occurredAtMs || left.experienceId.localeCompare(right.experienceId));
  const selected = candidates.slice(0, limit);
  const persisted = persistCandidates(sidecar, selected);
  return {
    scanned: selected.length,
    recorded: persisted.recorded,
    skipped: persisted.skipped + Math.max(0, candidates.length - selected.length),
    deliveryWatermarkInitialized: initialized,
    recoveredExperienceIds: persisted.recoveredExperienceIds,
  };
}
