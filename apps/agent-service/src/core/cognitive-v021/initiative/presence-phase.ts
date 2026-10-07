import type { DatabaseSync } from "node:sqlite";

/**
 * Host read of the phase the inner-life poll already records.
 * Conversation wins: an Owner cycle still open, or an Owner message inside
 * the last 10 minutes. Otherwise a live afterglow or awake inbox event.
 * Otherwise the night period: from the start of the latest night pass until
 * a later awake or afterglow pass. An Owner message overlays conversation
 * and leaves that period in place. Anything else is idle. This does not write.
 */
export const OWNER_CONVERSATION_WINDOW_MS = 10 * 60 * 1000;

export type PresencePhaseName = "conversation" | "awake" | "afterglow" | "night" | "idle";

export type PresencePhaseReport = {
  phase: PresencePhaseName;
  healthy: boolean;
  sinceMs: number;
};

type PassKind = "afterglow" | "night" | "awake";

function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function activeConversationId(nuclear: DatabaseSync, ownerId: string): string | null {
  const row = nuclear.prepare(
    `SELECT id FROM mem_threads
      WHERE owner_id = ? AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1`,
  ).get(ownerId) as { id?: unknown } | undefined;
  return typeof row?.id === "string" && row.id.trim() ? row.id : null;
}

function ownerCycleSinceMs(sidecar: DatabaseSync, conversationId: string): number | null {
  const row = sidecar.prepare(
    `SELECT trigger_kind, admitted_at_ms
       FROM cycle_records
      WHERE conversation_id = ?
        AND state NOT IN ('silent', 'idle')
      ORDER BY generation DESC, updated_at_ms DESC
      LIMIT 1`,
  ).get(conversationId) as { trigger_kind?: unknown; admitted_at_ms?: unknown } | undefined;
  if (!row || row.trigger_kind !== "owner_message") return null;
  return numberOrNull(row.admitted_at_ms);
}

function latestOwnerMessageSinceMs(
  sidecar: DatabaseSync,
  conversationId: string,
  nowMs: number,
): number | null {
  const row = sidecar.prepare(
    `SELECT MAX(created_at_ms) AS at_ms
       FROM conversation_evidence_log
      WHERE conversation_id = ?
        AND role = 'owner'
        AND created_at_ms >= ?
        AND created_at_ms <= ?`,
  ).get(conversationId, nowMs - OWNER_CONVERSATION_WINDOW_MS, nowMs) as { at_ms?: unknown } | undefined;
  return numberOrNull(row?.at_ms);
}

function passKindOf(id: string, payloadJson: unknown): PassKind | null {
  if (id.startsWith("afterglow:")) return "afterglow";
  if (id.startsWith("night:")) return "night";
  if (id.startsWith("awake:")) return "awake";
  if (typeof payloadJson !== "string") return null;
  try {
    const payload = JSON.parse(payloadJson) as { innerPass?: { kind?: unknown } };
    const kind = payload.innerPass?.kind;
    if (kind === "afterglow" || kind === "night" || kind === "awake") return kind;
  } catch {
    return null;
  }
  return null;
}

const LIVE_PASS_STATUSES = new Set(["pending", "claimed", "failed_retryable"]);

type PassMark = { kind: PassKind; sinceMs: number; status: string };

function passMarks(sidecar: DatabaseSync, conversationId: string): PassMark[] {
  const rows = sidecar.prepare(
    `SELECT id, payload_json, created_at_ms, status
       FROM inbox_events
      WHERE conversation_id = ?
        AND (
          id LIKE 'afterglow:%'
          OR id LIKE 'night:%'
          OR id LIKE 'awake:%'
          OR status IN ('pending', 'claimed', 'failed_retryable')
        )`,
  ).all(conversationId) as Array<{ id?: unknown; payload_json?: unknown; created_at_ms?: unknown; status?: unknown }>;
  const marks: PassMark[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const kind = passKindOf(row.id, row.payload_json);
    const sinceMs = numberOrNull(row.created_at_ms);
    if (!kind || sinceMs === null) continue;
    marks.push({ kind, sinceMs, status: typeof row.status === "string" ? row.status : "" });
  }
  return marks;
}

function latestLiveAwakeOrAfterglow(marks: readonly PassMark[]): PassMark | null {
  let best: PassMark | null = null;
  for (const mark of marks) {
    if (mark.kind === "night" || !LIVE_PASS_STATUSES.has(mark.status)) continue;
    if (!best || mark.sinceMs > best.sinceMs) best = mark;
  }
  return best;
}

function recordedNightStartMs(sidecar: DatabaseSync, conversationId: string): number | null {
  const row = sidecar.prepare(
    "SELECT last_night_at_ms AS at_ms FROM night_state WHERE conversation_id = ?",
  ).get(conversationId) as { at_ms?: unknown } | undefined;
  return numberOrNull(row?.at_ms);
}

/** Start of the latest night pass: its inbox event, or night_state when the row is ahead of the events. */
function nightPeriodStartMs(marks: readonly PassMark[], recordedStart: number | null): number | null {
  let eventStart: number | null = null;
  for (const mark of marks) {
    if (mark.kind !== "night") continue;
    if (eventStart === null || mark.sinceMs > eventStart) eventStart = mark.sinceMs;
  }
  if (recordedStart !== null && (eventStart === null || recordedStart > eventStart)) return recordedStart;
  return eventStart;
}

function laterAwakeOrAfterglow(marks: readonly PassMark[], nightStartMs: number): boolean {
  return marks.some((mark) =>
    (mark.kind === "awake" || mark.kind === "afterglow") && mark.sinceMs > nightStartMs);
}

function idleSinceMs(sidecar: DatabaseSync, conversationId: string): number {
  const marks = [
    sidecar.prepare("SELECT updated_at_ms AS at_ms FROM night_state WHERE conversation_id = ?").get(conversationId),
    sidecar.prepare("SELECT updated_at_ms AS at_ms FROM inner_state WHERE conversation_id = ?").get(conversationId),
    sidecar.prepare("SELECT updated_at_ms AS at_ms FROM afterglow_state WHERE conversation_id = ?").get(conversationId),
  ];
  let latest = 0;
  for (const mark of marks) {
    const at = numberOrNull((mark as { at_ms?: unknown } | undefined)?.at_ms);
    if (at !== null && at > latest) latest = at;
  }
  return latest;
}

export function readPresencePhase(input: {
  sidecar: DatabaseSync;
  nuclear: DatabaseSync;
  ownerId: string;
  nowMs: number;
  /** Same flag `/nuclear/status` reports as `health.ok`. */
  healthy: boolean;
}): PresencePhaseReport {
  const conversationId = activeConversationId(input.nuclear, input.ownerId);
  if (!conversationId) {
    return { phase: "idle", healthy: input.healthy, sinceMs: 0 };
  }
  const cycleSince = ownerCycleSinceMs(input.sidecar, conversationId);
  const messageSince = latestOwnerMessageSinceMs(input.sidecar, conversationId, input.nowMs);
  if (cycleSince !== null || messageSince !== null) {
    const sinceMs = cycleSince !== null && messageSince !== null
      ? Math.min(cycleSince, messageSince)
      : (cycleSince ?? messageSince ?? input.nowMs);
    return { phase: "conversation", healthy: input.healthy, sinceMs };
  }
  const marks = passMarks(input.sidecar, conversationId);
  const live = latestLiveAwakeOrAfterglow(marks);
  if (live) return { phase: live.kind, healthy: input.healthy, sinceMs: live.sinceMs };
  const nightStartMs = nightPeriodStartMs(marks, recordedNightStartMs(input.sidecar, conversationId));
  if (nightStartMs !== null && !laterAwakeOrAfterglow(marks, nightStartMs)) {
    return { phase: "night", healthy: input.healthy, sinceMs: nightStartMs };
  }
  return { phase: "idle", healthy: input.healthy, sinceMs: idleSinceMs(input.sidecar, conversationId) };
}
