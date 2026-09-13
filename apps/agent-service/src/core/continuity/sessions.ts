import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { recordContinuityEvent } from "./db.js";

export function startRuntimeSession(
  continuity: DatabaseSync,
  input: {
    lineageId: string;
    buildIdentity?: string | null;
    nuclearSchemaVersion?: number;
  },
): string {
  const now = new Date().toISOString();
  const open = continuity
    .prepare(
      `SELECT session_id, started_at, last_seen_at FROM runtime_sessions
       WHERE clean_shutdown_at IS NULL`,
    )
    .all() as Array<{
    session_id: string;
    started_at: string;
    last_seen_at: string;
  }>;
  for (const prior of open) {
    continuity
      .prepare(
        `UPDATE runtime_sessions SET clean_shutdown_at = NULL WHERE session_id = ?`,
      )
      .run(prior.session_id);
    // Mark unclean by leaving clean_shutdown_at null and recording event;
    // set a sentinel last_seen as interval end.
    recordContinuityEvent(continuity, {
      kind: "shutdown_unclean",
      lineageId: input.lineageId,
      detail: {
        priorSessionId: prior.session_id,
        lostFrom: prior.last_seen_at,
        lostTo: now,
      },
      sessionId: prior.session_id,
      occurredAt: now,
    });
    continuity
      .prepare(
        `UPDATE runtime_sessions SET clean_shutdown_at = ? WHERE session_id = ?`,
      )
      .run(now, prior.session_id);
  }

  const sessionId = randomUUID();
  continuity
    .prepare(
      `INSERT INTO runtime_sessions
         (session_id, started_at, last_seen_at, clean_shutdown_at,
          build_identity, nuclear_schema_version, lineage_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      sessionId,
      now,
      now,
      input.buildIdentity ?? null,
      input.nuclearSchemaVersion ?? null,
      input.lineageId,
    );
  recordContinuityEvent(continuity, {
    kind: "startup",
    lineageId: input.lineageId,
    sessionId,
    detail: { sessionId },
    occurredAt: now,
  });
  return sessionId;
}

export function heartbeatSession(
  continuity: DatabaseSync,
  sessionId: string,
): void {
  continuity
    .prepare(
      `UPDATE runtime_sessions SET last_seen_at = ? WHERE session_id = ? AND clean_shutdown_at IS NULL`,
    )
    .run(new Date().toISOString(), sessionId);
}

export function cleanShutdownSession(
  continuity: DatabaseSync,
  input: { sessionId: string; lineageId: string },
): void {
  const now = new Date().toISOString();
  continuity
    .prepare(
      `UPDATE runtime_sessions
       SET clean_shutdown_at = ?, last_seen_at = ?
       WHERE session_id = ? AND clean_shutdown_at IS NULL`,
    )
    .run(now, now, input.sessionId);
  recordContinuityEvent(continuity, {
    kind: "shutdown_clean",
    lineageId: input.lineageId,
    sessionId: input.sessionId,
    occurredAt: now,
  });
}

/** Edge-triggered provider outage: open at most one open interval. */
export function noteProviderOutage(
  continuity: DatabaseSync,
  lineageId: string,
  detail: Record<string, unknown> = {},
): boolean {
  const open = continuity
    .prepare(
      `SELECT id FROM continuity_events
       WHERE kind = 'provider_outage'
         AND lineage_id = ?
         AND json_extract(detail_json, '$.open') = 1
       ORDER BY id DESC LIMIT 1`,
    )
    .get(lineageId);
  if (open) return false;
  recordContinuityEvent(continuity, {
    kind: "provider_outage",
    lineageId,
    detail: { ...detail, open: 1 },
  });
  return true;
}

export function noteProviderRecovery(
  continuity: DatabaseSync,
  lineageId: string,
  detail: Record<string, unknown> = {},
): boolean {
  const open = continuity
    .prepare(
      `SELECT id FROM continuity_events
       WHERE kind = 'provider_outage'
         AND lineage_id = ?
         AND json_extract(detail_json, '$.open') = 1
       ORDER BY id DESC LIMIT 1`,
    )
    .get(lineageId) as { id?: number } | undefined;
  if (!open?.id) return false;
  continuity
    .prepare(
      `UPDATE continuity_events
       SET detail_json = json_set(detail_json, '$.open', 0, '$.recovered_at', ?)
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), open.id);
  recordContinuityEvent(continuity, {
    kind: "provider_recovery",
    lineageId,
    detail: { ...detail, closedOutageId: open.id },
  });
  return true;
}
