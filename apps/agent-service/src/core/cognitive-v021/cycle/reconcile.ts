import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { suppressUndeliveredOutbox } from "../speech/outbox.js";
import { finishWakeInTransaction, getWake, reconcileWakeInTransaction, recordWakeCancellationInTransaction } from "../wake/ledger.js";
import {
  getCycle,
  getCycleFreshnessState,
  hasValidDurableContinuationOwner,
  markUnresolvedDeferredInTransaction,
} from "./inbox.js";
import { proveNoExternalDispatch } from "../retry/startup-outcome-recovery.js";

export type ReconcileStartupResult = {
  retiredCycleIds: string[];
  recoveredOrphanEvidenceRowIds: string[];
  coveredSiblingEventIds: string[];
  unresolvedDeferredCycleIds: string[];
};

export const EXTERNAL_UNBATCHED_RECOVERY_HORIZON_MS = 10_000;

export type UnbatchedCaptureBatch = {
  captureRefs: string[];
  conversationKey: string;
  finalFragmentReceivedAtMs?: number;
};

export type ReconcileUnbatchedCapturesResult = {
  discovered: number;
  batched: number;
  failures: number;
};

type UnbatchedCaptureRow = {
  id?: unknown;
  conversation_id?: unknown;
  payload_json?: unknown;
  created_at_ms?: unknown;
};

type EvidenceCandidateRow = {
  row_id: string;
  conversation_id: string;
  created_at_ms: number;
  discord_message_ids_json: string;
};

type CycleCandidateRow = {
  cycle_id: string;
  wake_id: string;
  generation: number;
  state: string;
  compose_log_ids_json: string;
};

type CoveredSiblingCandidateRow = {
  id: string;
  wake_id: string;
  payload_json: string;
  compose_log_ids_json: string;
};

function isSocialConversation(conversationId: string, triggerKind?: string): boolean {
  return conversationId.startsWith("dm:")
    || conversationId.startsWith("room:")
    || triggerKind === "external_message";
}

function cycleEventIds(sidecar: DatabaseSync, cycleId: string, wakeId: string): string[] {
  const rows = sidecar.prepare(
    `SELECT id
       FROM inbox_events
      WHERE wake_id = ?
        AND (json_extract(payload_json, '$.cycleId') = ? OR kind IN ('external_utterance','external_message','external_eligible_pending'))
      ORDER BY created_at_ms ASC, id ASC`,
  ).all(wakeId, cycleId) as Array<{ id?: unknown }>;
  return rows.map((row) => typeof row.id === "string" ? row.id : "").filter(Boolean);
}

function proveSocialAttemptUndispatched(sidecar: DatabaseSync, cycleId: string, wakeId: string): boolean {
  const eventIds = cycleEventIds(sidecar, cycleId, wakeId);
  if (eventIds.length === 0) return false;
  let proven = false;
  for (const eventId of eventIds) {
    const proof = proveNoExternalDispatch(sidecar, eventId);
    if (!proof.ok) return false;
    proven = true;
  }
  return proven;
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function payloadEvidenceRowId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const evidenceRowId = (value as Record<string, unknown>).evidenceRowId;
  return typeof evidenceRowId === "string" && evidenceRowId.trim() ? evidenceRowId : null;
}

function capturePayload(value: unknown): {
  captureRef: string;
  evidenceRowId: string;
  conversationKey: string;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const captureRef = typeof row.captureRef === "string" ? row.captureRef.trim() : "";
  const evidenceRowId = typeof row.evidenceRowId === "string" ? row.evidenceRowId.trim() : "";
  const conversationKey = typeof row.conversationKey === "string" ? row.conversationKey.trim() : "";
  if (!captureRef || !evidenceRowId || !conversationKey) return null;
  return { captureRef, evidenceRowId, conversationKey };
}

function externalCaptureAlreadyBatched(sidecar: DatabaseSync, evidenceRowId: string): boolean {
  const row = sidecar.prepare(
    `SELECT 1 AS present
       FROM inbox_events
      WHERE id IN (?, ?)
      LIMIT 1`,
  ).get(
    `external:eligible:${evidenceRowId}`,
    `external:quarantine:${evidenceRowId}`,
  ) as { present?: unknown } | undefined;
  return row?.present === 1;
}

/**
 * Rediscover durable external captures that crossed capture COMMIT before the
 * bot/service could send the reference batch. This is a bounded startup
 * reconciliation seam; the injected batcher owns the normal admission
 * transaction and no inbox wake or cognitive cycle is created here.
 */
export async function reconcileUnbatchedCaptures(
  sidecar: DatabaseSync,
  options: {
    nowMs?: number;
    horizonMs?: number;
    limit?: number;
    batch: (input: UnbatchedCaptureBatch) => Promise<unknown> | unknown;
  },
): Promise<ReconcileUnbatchedCapturesResult> {
  const nowMs = options.nowMs ?? Date.now();
  const horizonMs = options.horizonMs ?? EXTERNAL_UNBATCHED_RECOVERY_HORIZON_MS;
  const cutoffMs = nowMs - horizonMs;
  const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
  const rows = sidecar.prepare(
    `SELECT id, conversation_id, payload_json, created_at_ms
       FROM inbox_events
      WHERE kind = 'external_captured'
        AND wake_id IS NULL
        AND state = 'pending'
        AND status = 'pending'
        AND created_at_ms <= ?
      ORDER BY created_at_ms ASC, id ASC
      LIMIT ?`,
  ).all(cutoffMs, limit) as UnbatchedCaptureRow[];

  const grouped = new Map<string, UnbatchedCaptureBatch>();
  let discovered = 0;
  let failures = 0;
  for (const row of rows) {
    let payloadValue: unknown;
    try {
      payloadValue = JSON.parse(typeof row.payload_json === "string" ? row.payload_json : "{}");
    } catch {
      failures += 1;
      continue;
    }
    const payload = capturePayload(payloadValue);
    if (!payload || externalCaptureAlreadyBatched(sidecar, payload.evidenceRowId)) continue;
    discovered += 1;
    const existing = grouped.get(payload.conversationKey);
    if (existing) {
      existing.captureRefs.push(payload.captureRef);
      existing.finalFragmentReceivedAtMs = Math.max(
        existing.finalFragmentReceivedAtMs ?? 0,
        Number(row.created_at_ms ?? 0),
      );
    } else {
      grouped.set(payload.conversationKey, {
        captureRefs: [payload.captureRef],
        conversationKey: payload.conversationKey,
        finalFragmentReceivedAtMs: Number(row.created_at_ms ?? 0),
      });
    }
  }

  let batched = 0;
  for (const batch of grouped.values()) {
    try {
      await options.batch(batch);
      batched += batch.captureRefs.length;
    } catch {
      failures += batch.captureRefs.length;
    }
  }
  return { discovered, batched, failures };
}

function convergedCoveredSiblingEvents(sidecar: DatabaseSync, nowMs: number): string[] {
  const candidates = sidecar.prepare(
    `SELECT ie.id, ie.wake_id, ie.payload_json, cr.compose_log_ids_json
       FROM inbox_events ie
       JOIN wakes w ON w.wake_id = ie.wake_id
       JOIN cycle_records cr ON cr.wake_id = ie.wake_id
      WHERE ie.kind IN ('owner_utterance', 'owner_message')
        AND ie.state IN ('pending', 'retry_wait')
        AND w.state = 'terminal'
        AND w.terminal_reason = 'completed'
        AND EXISTS (
          SELECT 1
            FROM settlements s
           WHERE s.cycle_id = cr.cycle_id
             AND s.generation = cr.generation
             AND (s.wake_id IS NULL OR s.wake_id = ie.wake_id)
        )
      ORDER BY ie.created_at_ms ASC, ie.id ASC`,
  ).all() as CoveredSiblingCandidateRow[];
  const converged: string[] = [];
  for (const candidate of candidates) {
    let payload: unknown;
    try {
      payload = JSON.parse(candidate.payload_json);
    } catch {
      continue;
    }
    const evidenceRowId = payloadEvidenceRowId(payload);
    if (!evidenceRowId || !parseJsonArray(candidate.compose_log_ids_json).includes(evidenceRowId)) continue;
    const result = sidecar.prepare(
      `UPDATE inbox_events
          SET state = 'terminal', status = 'consumed',
              terminal_reason = 'completed', quarantine_reason = NULL,
              consumed_at_ms = ?, next_eligible_at_ms = NULL,
              claim_token = NULL, worker_id = NULL,
              lease_expires_at_ms = NULL,
              last_error = NULL, last_failure_class = NULL
        WHERE id = ? AND wake_id = ?
          AND state IN ('pending', 'retry_wait')`,
    ).run(nowMs, candidate.id, candidate.wake_id);
    if (result.changes === 1) converged.push(candidate.id);
  }
  return converged;
}

/**
 * Authority-reconciles startup ownership:
 * 1. Discovers occupying cycles with missing durable continuation owners (zombie cycles)
 *    and retires them to 'silent'.
 *    Active frontiers past their deadline are preserved as active owners (unresolved frontier
 *    equals active cognitive occupancy; coordinator owns expiry/readmission).
 * 2. Bounded historical partial ingress recovery:
 *    Discovers conversation evidence rows without a corresponding inbox event that were
 *    recorded in the compose_log_ids_json of an ownerless or zombie cycle, and synthesizes
 *    a terminal inbox disposition with terminal_reason: 'historical_partial_ingress_abandoned'.
 *    Preserves fail-closed behavior for all other missing dispositions.
 */
export function reconcileStartupOwnership(
  sidecar: DatabaseSync,
  options?: { nowMs?: number },
): ReconcileStartupResult {
  const nowMs = options?.nowMs ?? Date.now();
  const retiredCycleIds: string[] = [];
  const recoveredOrphanEvidenceRowIds: string[] = [];
  const coveredSiblingEventIds: string[] = [];
  const unresolvedDeferredCycleIds: string[] = [];

  sidecar.exec("BEGIN IMMEDIATE");
  try {
    // Step 1: Discover and retire zombie cycles
    const occupyingRows = sidecar.prepare(
      "SELECT cycle_id FROM cycle_records WHERE state NOT IN ('silent', 'idle') AND COALESCE(disposition, '') != 'intentional_silence' ORDER BY admitted_at_ms ASC",
    ).all() as Array<{ cycle_id: string }>;

    for (const row of occupyingRows) {
      const cycle = getCycle(sidecar, row.cycle_id);
      if (!cycle) continue;
      if (!hasValidDurableContinuationOwner(sidecar, cycle)) {
        if (isSocialConversation(cycle.conversationId, cycle.triggerKind)) {
          // A social computation may disappear without resolving the captured
          // interaction. Prove the dispatch side before retiring only the
          // computation; the input remains pending/unresolved and is never
          // synthesized into an Owner-era terminal disposition.
          const freshness = getCycleFreshnessState(sidecar, cycle.cycleId);
          const proofAvailable = freshness.attemptId == null
            ? true
            : proveSocialAttemptUndispatched(sidecar, cycle.cycleId, cycle.wakeId);
          markUnresolvedDeferredInTransaction(sidecar, cycle.cycleId, nowMs);
          if (cycle.wakeId) {
            const wake = getWake(sidecar, cycle.wakeId);
            if (wake && wake.state !== "terminal") {
              recordWakeCancellationInTransaction(sidecar, { wakeId: cycle.wakeId, nowMs });
              if (wake.state !== "reconciling" && wake.state !== "consequence_pending") {
                reconcileWakeInTransaction(sidecar, cycle.wakeId, nowMs);
              }
            }
          }
          unresolvedDeferredCycleIds.push(cycle.cycleId);
          if (!proofAvailable) {
            // Keep the explicit unresolved disposition. The failed proof is
            // intentionally not converted into a terminal input outcome.
          }
        } else {
          suppressUndeliveredOutbox(sidecar, {
            conversationId: cycle.conversationId,
            generation: cycle.generation,
            reason: "preempted_zombie_cycle",
          });
          sidecar.prepare("UPDATE cycle_records SET state = 'silent', updated_at_ms = ? WHERE cycle_id = ?").run(nowMs, cycle.cycleId);
          if (cycle.wakeId) {
            const wake = getWake(sidecar, cycle.wakeId);
            if (wake && wake.state !== "terminal") {
              recordWakeCancellationInTransaction(sidecar, { wakeId: cycle.wakeId, nowMs });
              if (wake.state !== "reconciling" && wake.state !== "consequence_pending") {
                finishWakeInTransaction(sidecar, cycle.wakeId, wake.leaseToken, "cancelled", nowMs);
              }
            }
          }
        }
        retiredCycleIds.push(cycle.cycleId);
      }
    }

    // Step 2: Bounded historical partial ingress recovery
    // Recovery strictly requires that the cycle was mechanically proven ownerless/zombie
    // and retired by THIS reconciliation invocation (retained in retiredCycleIds).
    if (retiredCycleIds.length > 0) {
      const retiredOwnerCycleSet = new Set(retiredCycleIds.filter((cycleId) => !unresolvedDeferredCycleIds.includes(cycleId)));
      const orphanEvidenceRows = sidecar.prepare(
        `SELECT cel.row_id, cel.conversation_id, cel.created_at_ms, cel.discord_message_ids_json
         FROM conversation_evidence_log cel
         WHERE NOT EXISTS (
           SELECT 1 FROM inbox_events ie
           WHERE ie.conversation_id = cel.conversation_id
             AND json_extract(ie.payload_json, '$.evidenceRowId') = cel.row_id
         )
         ORDER BY cel.created_at_ms ASC`,
      ).all() as EvidenceCandidateRow[];

      for (const candidate of orphanEvidenceRows) {
        const cycles = sidecar.prepare(
          `SELECT cycle_id, wake_id, generation, state, compose_log_ids_json
           FROM cycle_records
           WHERE conversation_id = ?
           ORDER BY generation DESC, updated_at_ms DESC`,
        ).all(candidate.conversation_id) as CycleCandidateRow[];

        for (const cycleRow of cycles) {
          if (!retiredOwnerCycleSet.has(cycleRow.cycle_id)) continue;

          const composeLogIds = parseJsonArray(cycleRow.compose_log_ids_json);
          if (!composeLogIds.includes(candidate.row_id)) continue;

          // Evidence was composed into a cycle proven zombie and retired during this invocation.
          // Recover it by inserting a terminal inbox disposition.
          const inboxId = randomUUID();
          const payload = {
            cycleId: cycleRow.cycle_id,
            wakeId: cycleRow.wake_id,
            evidenceRowId: candidate.row_id,
            discordMessageIds: parseJsonArray(candidate.discord_message_ids_json),
            recoveredHistoricalOrphan: true,
          };

          sidecar.prepare(
            `INSERT INTO inbox_events
               (id, conversation_id, kind, payload_json, created_at_ms, status, state, terminal_reason, claim_token,
                worker_id, lease_expires_at_ms, attempt_count, claimed_at_ms, consumed_at_ms,
                last_error, wake_id)
             VALUES (?, ?, 'owner_utterance', ?, ?, 'consumed', 'terminal', 'historical_partial_ingress_abandoned', NULL,
                     NULL, NULL, 0, NULL, ?, NULL, ?)`,
          ).run(
            inboxId,
            candidate.conversation_id,
            JSON.stringify(payload),
            candidate.created_at_ms,
            nowMs,
            cycleRow.wake_id,
          );

          recoveredOrphanEvidenceRowIds.push(candidate.row_id);
          break;
        }
      }
    }

    // A previous successful cognition can leave a same-wake Owner event
    // pending when the process stops between semantic completion and the
    // lifecycle convergence repair. Close only rows whose evidence is in the
    // cycle's existing composition provenance and whose cycle has a durable
    // successful settlement. This is mechanical lifecycle reconciliation, not
    // a semantic judgment about the Owner message.
    coveredSiblingEventIds.push(...convergedCoveredSiblingEvents(sidecar, nowMs));

    sidecar.exec("COMMIT");
    return { retiredCycleIds, recoveredOrphanEvidenceRowIds, coveredSiblingEventIds, unresolvedDeferredCycleIds };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch {}
    throw error;
  }
}
