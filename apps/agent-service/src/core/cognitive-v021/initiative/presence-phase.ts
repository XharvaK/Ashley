import type { DatabaseSync } from "node:sqlite";

/**
 * Host read of the phase the inner-life poll already records.
 * Conversation wins: an Owner cycle still open, or an Owner message inside
 * the last 10 minutes. Otherwise a live afterglow, night, or awake inbox
 * event. Anything else is idle. This does not write.
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

function livePass(sidecar: DatabaseSync, conversationId: string): { kind: PassKind; sinceMs: number } | null {
  const rows = sidecar.prepare(
    `SELECT id, payload_json, created_at_ms
       FROM inbox_events
      WHERE conversation_id = ?
        AND status IN ('pending', 'claimed', 'failed_retryable')
      ORDER BY created_at_ms DESC`,
  ).all(conversationId) as Array<{ id?: unknown; payload_json?: unknown; created_at_ms?: unknown }>;
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const kind = passKindOf(row.id, row.payload_json);
    const sinceMs = numberOrNull(row.created_at_ms);
    if (kind && sinceMs !== null) return { kind, sinceMs };
  }
  return null;
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
  const pass = livePass(input.sidecar, conversationId);
  if (pass) return { phase: pass.kind, healthy: input.healthy, sinceMs: pass.sinceMs };
  return { phase: "idle", healthy: input.healthy, sinceMs: idleSinceMs(input.sidecar, conversationId) };
}
