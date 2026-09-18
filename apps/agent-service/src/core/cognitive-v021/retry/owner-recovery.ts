import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationEvidenceRecord,
  InboxEvent,
  ThoughtContinuityRecovery,
} from "../types.js";
import { getEvidenceByRowId } from "../evidence/conversation-log.js";
import { getCycle, hasValidDurableContinuationOwner } from "../cycle/inbox.js";
import { getWake } from "../wake/ledger.js";
import { createRepairEvent, type RepairEvent } from "./ledger.js";
import {
  emitInfrastructureNotice,
  getSystemNoticeByKey,
} from "../speech/infrastructure-notice.js";
import { recordThoughtC3TerminalFailure } from "../failure/c3-recorder.js";
import { hasActiveOwnerWorkerUndertaking } from "../operation/worker-queue.js";

/**
 * R1 unanswered-Owner-obligation recovery (durable-work/retry ownership).
 *
 * Maturation of existing owners only: terminal/quarantined Owner inbox rows
 * with no valid ordinary continuation can receive exactly one
 * conversation-coalesced repair undertaking per conversation through the
 * existing `createRepairEvent()` lineage. No new workflow engine, scheduler,
 * obligation subsystem, recovery daemon, or history database.
 *
 * Eligibility is a bounded, deterministic predicate over current
 * durable/evidence truth — never text heuristics, never age alone, never
 * terminal state alone.
 */

/** Stable deterministic authorization identity for automatic owner recovery. */
export const OWNER_RECOVERY_AUTHORIZATION_REF = "unanswered_owner_recovery:v1" as const;
/** Bounded repair lineages per predecessor; further failure needs an operator. */
export const OWNER_RECOVERY_MAX_LINEAGES_PER_PREDECESSOR = 3 as const;
/** Bounded outstanding-evidence tail carried by one repair undertaking. */
export const OWNER_RECOVERY_MAX_OUTSTANDING_REFS = 25 as const;
/** Bounded conversations serviced per pass. */
export const OWNER_RECOVERY_MAX_CONVERSATIONS_PER_PASS = 10 as const;
/** Bounded orphan-wake scan per pass. */
export const OWNER_RECOVERY_MAX_ORPHAN_WAKES_PER_PASS = 100 as const;
/** Bounded terminal-row scan per pass. */
export const OWNER_RECOVERY_CANDIDATE_SCAN_LIMIT = 500 as const;

const OWNER_EVENT_KINDS = ["owner_message", "owner_utterance"] as const;
const TERMINAL_NON_STATES = ["terminal", "quarantined"] as const;
/** Terminal dispositions that already resolve the obligation. Never repaired. */
const RESOLVING_TERMINAL_REASONS = new Set([
  "superseded",
  "cancelled",
  "stale",
  "historical_partial_ingress_abandoned",
]);
/** Explicit refusal codes that already resolve the obligation. Never repaired. */
const REFUSAL_ERROR_CODES = new Set(["authority_refused", "refused"]);
/** Social/external conversation prefixes. Never enter Owner recovery. */
const NON_OWNER_CONVERSATION_PREFIXES = ["dm:", "room:"] as const;

type DbValue = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function rowIdOf(value: unknown): string {
  const record = typeof value === "object" && value !== null ? value as DbValue : {};
  const payload = typeof record.payload_json === "string" ? record.payload_json : "{}";
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const ref = parsed["evidenceRowId"];
    return typeof ref === "string" ? ref : "";
  } catch {
    return "";
  }
}

function payloadHasExternalDestination(value: unknown): boolean {
  const record = typeof value === "object" && value !== null ? value as DbValue : {};
  const payload = typeof record.payload_json === "string" ? record.payload_json : "{}";
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return parsed["externalDestination"] !== undefined && parsed["externalDestination"] !== null;
  } catch {
    return false;
  }
}

function isCurrentEvidenceVersion(db: DatabaseSync, evidence: ConversationEvidenceRecord): boolean {
  const peak = db.prepare(
    "SELECT MAX(version) AS version FROM conversation_evidence_log WHERE lineage_id = ?",
  ).get(evidence.lineageId) as { version?: unknown } | undefined;
  const maxVersion = typeof peak?.version === "number" ? peak.version : Number(peak?.version ?? NaN);
  return Number.isFinite(maxVersion) && evidence.version >= maxVersion;
}

function latestAttemptErrorCode(db: DatabaseSync, eventId: string): string | null {
  const found = db.prepare(
    `SELECT error_code FROM durable_work_attempts WHERE event_id = ? ORDER BY ordinal DESC LIMIT 1`,
  ).get(eventId) as { error_code?: unknown } | undefined;
  return typeof found?.error_code === "string" && found.error_code ? found.error_code : null;
}

function hasNonterminalOwnerContinuation(db: DatabaseSync, conversationId: string): boolean {
  if (Boolean(db.prepare(
    `SELECT 1 FROM inbox_events
      WHERE conversation_id = ? AND kind IN ('owner_message', 'owner_utterance', 'frontier_wake')
        AND state NOT IN ('terminal', 'quarantined')
      LIMIT 1`,
  ).get(conversationId))) return true;
  if (hasActiveOwnerWorkerUndertaking(db, conversationId)) return true;
  // A pending detached-operation completion owns the Owner obligation it
  // carries; its composition turn answers the outstanding evidence.
  return Boolean(db.prepare(
    `SELECT 1 FROM inbox_events
      WHERE conversation_id = ? AND kind = 'observation_or_receipt'
        AND state NOT IN ('terminal', 'quarantined')
        AND TRIM(COALESCE(json_extract(payload_json, '$.detachedOperationId'), '')) <> ''
      LIMIT 1`,
  ).get(conversationId));
}

function hasDeliveredAshleyAfter(
  db: DatabaseSync,
  conversationId: string,
  evidence: ConversationEvidenceRecord,
): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM conversation_evidence_log
      WHERE conversation_id = ? AND role = 'ashley' AND delivered = 1
        AND (created_at_ms > ?
          OR (created_at_ms = ? AND rowid > (SELECT rowid FROM conversation_evidence_log WHERE row_id = ?)))
      LIMIT 1`,
  ).get(conversationId, evidence.createdAtMs, evidence.createdAtMs, evidence.rowId));
}

function hasLaterCoveringSettlement(
  db: DatabaseSync,
  conversationId: string,
  candidateCreatedAtMs: number,
  evidenceRowId: string,
): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM settlements s
       JOIN cycle_records c ON c.cycle_id = s.cycle_id AND c.generation = s.generation
      WHERE c.conversation_id = ? AND c.admitted_at_ms > ?
        AND EXISTS (SELECT 1 FROM json_each(c.compose_log_ids_json) WHERE value = ?)
      LIMIT 1`,
  ).get(conversationId, candidateCreatedAtMs, evidenceRowId));
}

function hasActiveFrontier(db: DatabaseSync, conversationId: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM deferred_reactive_frontiers
      WHERE conversation_id = ? AND state IN ('waiting', 'running')
      LIMIT 1`,
  ).get(conversationId));
}

function hasActiveDetachedOperation(db: DatabaseSync, conversationId: string): boolean {
  if (hasActiveOwnerWorkerUndertaking(db, conversationId)) return true;
  return Boolean(db.prepare(
    `SELECT 1 FROM detached_operations
      WHERE conversation_id = ? AND state IN ('admitted', 'waiting_capacity', 'started')
      LIMIT 1`,
  ).get(conversationId));
}

function hasActiveRepair(db: DatabaseSync, conversationId: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM durable_work_repairs r
       JOIN inbox_events e ON e.id = r.repair_event_id
      WHERE e.conversation_id = ? AND e.state NOT IN ('terminal', 'quarantined')
      LIMIT 1`,
  ).get(conversationId));
}

function countRepairLineages(db: DatabaseSync, predecessorEventId: string): number {
  const found = db.prepare(
    "SELECT COUNT(*) AS count FROM durable_work_repairs WHERE predecessor_event_id = ?",
  ).get(predecessorEventId) as { count?: unknown } | undefined;
  const count = typeof found?.count === "number" ? found.count : Number(found?.count ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function lineageEventIds(db: DatabaseSync, eventId: string): string[] {
  const eventIds: string[] = [eventId];
  let cursor: string | null = eventId;
  while (cursor) {
    const repairRow = db.prepare(
      "SELECT predecessor_event_id FROM durable_work_repairs WHERE repair_event_id = ?",
    ).get(cursor) as { predecessor_event_id?: unknown } | undefined;
    const predecessor = typeof repairRow?.predecessor_event_id === "string"
      ? repairRow.predecessor_event_id
      : "";
    if (predecessor && !eventIds.includes(predecessor)) {
      eventIds.push(predecessor);
      cursor = predecessor;
    } else {
      cursor = null;
    }
  }
  return eventIds;
}

type NoOwnerVisibleDispatch =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * R1-A owner-visible dispatch proof. A finished-failed Owner attempt whose
 * Thought provider call responded is NOT ambiguous by itself: external
 * duplication can only cross the settlement/outbox/notice/effect boundary,
 * and every one of those owners is checked. This is deliberately narrower
 * than the outcome-unknown proof (which must also fence provider spend for
 * still-unresolved work); reusing that proof here would exclude nearly every
 * real terminal failure. Anything unprovable fails closed.
 */
function proveNoOwnerVisibleDispatch(
  db: DatabaseSync,
  candidate: { id: string; conversationId: string; wakeId: string | null },
): NoOwnerVisibleDispatch {
  const eventIds = lineageEventIds(db, candidate.id);
  const placeholders = eventIds.map(() => "?").join(",");
  if (Boolean(db.prepare(
    `SELECT 1 FROM in_flight_effects WHERE origin_event_id IN (${placeholders}) LIMIT 1`,
  ).get(...eventIds))) return { ok: false, reason: "in_flight_effect_present" };

  if (!candidate.wakeId) {
    // Wakeless legacy rows have no cycle scope. Fail closed on any
    // non-delivered owner-visible projection in the conversation (a stuck
    // projection is exactly the ambiguity that must block re-entry).
    if (Boolean(db.prepare(
      `SELECT 1 FROM speech_outbox
        WHERE conversation_id = ?
          AND send_status NOT IN ('delivered', 'partially_delivered', 'send_failure', 'suppressed', 'suppressed_shadow')
        LIMIT 1`,
    ).get(candidate.conversationId))) return { ok: false, reason: "speech_outbox_present" };
    try {
      if (Boolean(db.prepare(
        `SELECT 1 FROM system_notice_outbox
          WHERE conversation_id = ?
            AND send_status NOT IN ('delivered', 'send_failure', 'suppressed')
          LIMIT 1`,
      ).get(candidate.conversationId))) return { ok: false, reason: "system_notice_present" };
    } catch {
      return { ok: false, reason: "proof_unavailable" };
    }
    return { ok: true };
  }

  if (Boolean(db.prepare(
    "SELECT 1 FROM in_flight_effects WHERE wake_id = ? LIMIT 1",
  ).get(candidate.wakeId))) return { ok: false, reason: "in_flight_effect_present" };
  const wakeRow = db.prepare(
    "SELECT wake_id, cycle_id FROM wakes WHERE wake_id = ?",
  ).get(candidate.wakeId) as { wake_id?: unknown; cycle_id?: unknown } | undefined;
  if (!wakeRow || typeof wakeRow.cycle_id !== "string" || !wakeRow.cycle_id) {
    return { ok: false, reason: "wake_missing" };
  }
  const cycleId = wakeRow.cycle_id;
  const cycleRow = db.prepare(
    "SELECT cycle_id, generation FROM cycle_records WHERE cycle_id = ? LIMIT 1",
  ).get(cycleId) as { cycle_id?: unknown; generation?: unknown } | undefined;
  if (!cycleRow) return { ok: false, reason: "cycle_missing" };
  const generation = typeof cycleRow.generation === "number" ? cycleRow.generation : Number(cycleRow.generation ?? NaN);
  if (!Number.isFinite(generation)) return { ok: false, reason: "cycle_missing" };
  if (Boolean(db.prepare(
    "SELECT 1 FROM settlements WHERE cycle_id = ? AND generation = ? LIMIT 1",
  ).get(cycleId, generation))) return { ok: false, reason: "settlement_present" };
  if (Boolean(db.prepare(
    "SELECT 1 FROM settlements WHERE wake_id = ? LIMIT 1",
  ).get(candidate.wakeId))) return { ok: false, reason: "settlement_present" };
  if (Boolean(db.prepare(
    "SELECT 1 FROM speech_outbox WHERE cycle_id = ? AND generation = ? LIMIT 1",
  ).get(cycleId, generation))) return { ok: false, reason: "speech_outbox_present" };
  try {
    if (Boolean(db.prepare(
      "SELECT 1 FROM system_notice_outbox WHERE cycle_id = ? LIMIT 1",
    ).get(cycleId))) return { ok: false, reason: "system_notice_present" };
  } catch {
    return { ok: false, reason: "proof_unavailable" };
  }
  return { ok: true };
}

export type OwnerRecoveryEligibility =
  | { eligible: true; evidence: ConversationEvidenceRecord }
  | { eligible: false; reason: string };

/**
 * Bounded deterministic eligibility for UNRESOLVED OWNER CONVERSATIONAL
 * OBLIGATION. Every rejection fails closed with a reason code; callers must
 * never reinterpret a rejection as permission.
 */
export function checkUnansweredOwnerEligibility(
  db: DatabaseSync,
  candidate: {
    id: string;
    conversationId: string;
    kind: string;
    payloadJson: string;
    createdAtMs: number;
    terminalReason: string | null;
    lastError: string | null;
    wakeId: string | null;
  },
): OwnerRecoveryEligibility {
  if (!candidate.conversationId.trim()) return { eligible: false, reason: "conversation_missing" };
  if (NON_OWNER_CONVERSATION_PREFIXES.some((prefix) => candidate.conversationId.startsWith(prefix))) {
    return { eligible: false, reason: "non_owner_conversation" };
  }
  if (payloadHasExternalDestination({ payload_json: candidate.payloadJson })) {
    return { eligible: false, reason: "external_destination" };
  }
  if (candidate.terminalReason && RESOLVING_TERMINAL_REASONS.has(candidate.terminalReason)) {
    return { eligible: false, reason: `terminal_disposition:${candidate.terminalReason}` };
  }
  const refusal = latestAttemptErrorCode(db, candidate.id) ?? candidate.lastError;
  if (refusal && REFUSAL_ERROR_CODES.has(refusal)) {
    return { eligible: false, reason: `explicit_refusal:${refusal}` };
  }
  const evidenceRowId = rowIdOf({ payload_json: candidate.payloadJson });
  if (!evidenceRowId) return { eligible: false, reason: "evidence_ref_missing" };
  const evidence = getEvidenceByRowId(db, evidenceRowId);
  if (!evidence || evidence.role !== "owner" || evidence.conversationId !== candidate.conversationId) {
    return { eligible: false, reason: "evidence_missing" };
  }
  if (!isCurrentEvidenceVersion(db, evidence)) return { eligible: false, reason: "evidence_stale" };
  if (hasNonterminalOwnerContinuation(db, candidate.conversationId)) {
    return { eligible: false, reason: "ordinary_continuation_open" };
  }
  if (hasDeliveredAshleyAfter(db, candidate.conversationId, evidence)) {
    return { eligible: false, reason: "later_reply_delivered" };
  }
  if (hasLaterCoveringSettlement(db, candidate.conversationId, candidate.createdAtMs, evidence.rowId)) {
    return { eligible: false, reason: "later_settlement_covers" };
  }
  if (hasActiveFrontier(db, candidate.conversationId)) return { eligible: false, reason: "frontier_owns" };
  if (hasActiveDetachedOperation(db, candidate.conversationId)) {
    return { eligible: false, reason: "detached_operation_owns" };
  }
  const activeUndertakingForPredecessor = db.prepare(
    `SELECT 1 FROM worker_undertakings
      WHERE origin_kind = 'OWNER_REQUEST'
        AND (origin_ref = ? OR origin_owner_event_id = ?)
        AND state IN ('queued', 'dispatching', 'running')
      LIMIT 1`,
  ).get(candidate.id, candidate.id);
  if (activeUndertakingForPredecessor) return { eligible: false, reason: "worker_undertaking_owns" };
  const activePredecessorRepair = db.prepare(
    `SELECT 1 FROM durable_work_repairs r
       JOIN inbox_events e ON e.id = r.repair_event_id
      WHERE r.predecessor_event_id = ? AND e.state NOT IN ('terminal', 'quarantined')
      LIMIT 1`,
  ).get(candidate.id);
  if (activePredecessorRepair) return { eligible: false, reason: "repair_active" };
  if (hasActiveRepair(db, candidate.conversationId)) return { eligible: false, reason: "repair_active" };
  const proof = proveNoOwnerVisibleDispatch(db, {
    id: candidate.id,
    conversationId: candidate.conversationId,
    wakeId: candidate.wakeId,
  });
  if (!proof.ok) return { eligible: false, reason: `dispatch_unproven:${proof.reason}` };
  return { eligible: true, evidence };
}

export type EligibleOwnerConversation = {
  conversationId: string;
  primaryPredecessorEventId: string;
  primaryCreatedAtMs: number;
  outstandingOwnerEvidenceRefs: string[];
  eligibleEventIds: string[];
};

/**
 * Scan terminal Owner rows oldest-first and coalesce per conversation: at
 * most one undertaking per conversation, anchored on the deterministic oldest
 * eligible predecessor, exposing the complete bounded still-outstanding Owner
 * evidence tail.
 */
export function findEligibleUnansweredOwnerObligations(
  db: DatabaseSync,
  options: { conversationLimit?: number } = {},
): EligibleOwnerConversation[] {
  const conversationLimit = Math.max(
    1,
    Math.min(50, Math.floor(options.conversationLimit ?? OWNER_RECOVERY_MAX_CONVERSATIONS_PER_PASS)),
  );
  const rows = db.prepare(
    `SELECT id, conversation_id, kind, payload_json, created_at_ms, state, status,
            terminal_reason, last_error, wake_id
       FROM inbox_events
      WHERE kind IN ('owner_message', 'owner_utterance')
        AND ((state = 'quarantined') OR (state = 'terminal' AND status = 'failed_terminal'))
        AND COALESCE(terminal_reason, '') NOT IN ('superseded', 'cancelled', 'stale', 'historical_partial_ingress_abandoned')
      ORDER BY created_at_ms ASC, id ASC
      LIMIT ?`,
  ).all(OWNER_RECOVERY_CANDIDATE_SCAN_LIMIT) as Array<{
    id?: unknown;
    conversation_id?: unknown;
    kind?: unknown;
    payload_json?: unknown;
    created_at_ms?: unknown;
    terminal_reason?: unknown;
    last_error?: unknown;
    wake_id?: unknown;
  }>;

  const byConversation = new Map<string, Array<{ id: string; createdAtMs: number; evidence: ConversationEvidenceRecord }>>();
  for (const value of rows) {
    const id = text(value.id);
    const conversationId = text(value.conversation_id);
    if (!id || !conversationId) continue;
    const createdRaw = typeof value.created_at_ms === "number" ? value.created_at_ms : Number(value.created_at_ms ?? NaN);
    if (!Number.isFinite(createdRaw)) continue;
    const verdict = checkUnansweredOwnerEligibility(db, {
      id,
      conversationId,
      kind: text(value.kind),
      payloadJson: typeof value.payload_json === "string" ? value.payload_json : "",
      createdAtMs: createdRaw,
      terminalReason: typeof value.terminal_reason === "string" ? value.terminal_reason : null,
      lastError: typeof value.last_error === "string" ? value.last_error : null,
      wakeId: typeof value.wake_id === "string" ? value.wake_id : null,
    });
    if (!verdict.eligible) continue;
    const list = byConversation.get(conversationId) ?? [];
    list.push({ id, createdAtMs: createdRaw, evidence: verdict.evidence });
    byConversation.set(conversationId, list);
  }

  const result: EligibleOwnerConversation[] = [];
  for (const [conversationId, eligible] of byConversation) {
    if (result.length >= conversationLimit) break;
    eligible.sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
    const tail = outstandingOwnerTail(db, conversationId);
    if (tail.length === 0) continue;
    if (tail.length > OWNER_RECOVERY_MAX_OUTSTANDING_REFS) continue;
    result.push({
      conversationId,
      primaryPredecessorEventId: eligible[0]!.id,
      primaryCreatedAtMs: eligible[0]!.createdAtMs,
      outstandingOwnerEvidenceRefs: tail,
      eligibleEventIds: eligible.map((item) => item.id),
    });
  }
  return result;
}

/**
 * The complete bounded still-outstanding Owner evidence set: current-version
 * Owner rows after the last delivered Ashley turn (rowid-ordered within equal
 * timestamps). References only — content stays in canonical evidence.
 */
export function outstandingOwnerTail(db: DatabaseSync, conversationId: string): string[] {
  const last = db.prepare(
    `SELECT created_at_ms, rowid AS rowid FROM conversation_evidence_log
      WHERE conversation_id = ? AND role = 'ashley' AND delivered = 1
      ORDER BY created_at_ms DESC, rowid DESC LIMIT 1`,
  ).get(conversationId) as { created_at_ms?: unknown; rowid?: unknown } | undefined;
  const hasAnchor = last != null;
  const anchorCreated = typeof last?.created_at_ms === "number" ? last.created_at_ms : Number(last?.created_at_ms ?? 0);
  const anchorRowid = typeof last?.rowid === "number" ? last.rowid : Number(last?.rowid ?? 0);
  const rows = hasAnchor
    ? db.prepare(
      `SELECT row_id FROM conversation_evidence_log cel
        WHERE conversation_id = ? AND role = 'owner'
          AND version = (SELECT MAX(version) FROM conversation_evidence_log e2 WHERE e2.lineage_id = cel.lineage_id)
          AND (created_at_ms > ? OR (created_at_ms = ? AND rowid > ?))
        ORDER BY created_at_ms ASC, rowid ASC
        LIMIT ?`,
    ).all(
      conversationId,
      anchorCreated,
      anchorCreated,
      anchorRowid,
      OWNER_RECOVERY_MAX_OUTSTANDING_REFS + 1,
    ) as Array<{ row_id?: unknown }>
    : db.prepare(
      `SELECT row_id FROM conversation_evidence_log cel
        WHERE conversation_id = ? AND role = 'owner'
          AND version = (SELECT MAX(version) FROM conversation_evidence_log e2 WHERE e2.lineage_id = cel.lineage_id)
        ORDER BY created_at_ms ASC, rowid ASC
        LIMIT ?`,
    ).all(conversationId, OWNER_RECOVERY_MAX_OUTSTANDING_REFS + 1) as Array<{ row_id?: unknown }>;
  return rows
    .map((value) => text(value.row_id))
    .filter((id) => id.length > 0);
}

function repairAuthorizationRef(db: DatabaseSync, predecessorEventId: string): string | null {
  const lineages = countRepairLineages(db, predecessorEventId);
  if (lineages <= 0) return OWNER_RECOVERY_AUTHORIZATION_REF;
  if (lineages >= OWNER_RECOVERY_MAX_LINEAGES_PER_PREDECESSOR) return null;
  return `${OWNER_RECOVERY_AUTHORIZATION_REF}:retry${lineages + 1}`;
}

export type CreatedOwnerRepair = {
  conversationId: string;
  repair: RepairEvent;
  created: boolean;
  predecessorEventId: string;
  outstandingOwnerEvidenceRefs: string[];
};

export type OrphanWakeConvergence = {
  scanned: number;
  converged: string[];
  skippedProtected: number;
};

/**
 * Converge mechanically orphaned pending wakes. A pending wake is orphaned
 * only when it has no claimable/pending/retry/reconciling durable inbox
 * continuation, no valid continuation owner through its cycle (frontier,
 * delivery, or normal phase), no in-flight/unresolved effect, no
 * undelivered system-notice owner, and no detached-operation continuation
 * bound to its cycle — and its conversation holds no eligible obligation or
 * active repair. Convergence terminalizes `no_action` through the existing
 * wake lifecycle; it never fabricates completed/answered/delivered.
 */
export function convergeOrphanPendingWakes(
  db: DatabaseSync,
  options: { nowMs?: number; limit?: number; protectedConversationIds?: ReadonlySet<string> } = {},
): OrphanWakeConvergence {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? OWNER_RECOVERY_MAX_ORPHAN_WAKES_PER_PASS)));
  const protectedConversations = options.protectedConversationIds ?? new Set<string>();
  const rows = db.prepare(
    `SELECT wake_id, conversation_id, cycle_id FROM wakes
      WHERE state = 'pending'
      ORDER BY created_at_ms ASC, wake_id ASC
      LIMIT ?`,
  ).all(limit) as Array<{ wake_id?: unknown; conversation_id?: unknown; cycle_id?: unknown }>;
  const result: OrphanWakeConvergence = { scanned: 0, converged: [], skippedProtected: 0 };
  for (const value of rows) {
    const wakeId = text(value.wake_id);
    const conversationId = text(value.conversation_id);
    const cycleId = text(value.cycle_id);
    if (!wakeId || !conversationId) continue;
    result.scanned += 1;
    if (protectedConversations.has(conversationId)) {
      result.skippedProtected += 1;
      continue;
    }
    const continuation = db.prepare(
      `SELECT 1 FROM inbox_events
        WHERE wake_id = ? AND state IN ('pending', 'retry_wait', 'leased', 'reconciling')
        LIMIT 1`,
    ).get(wakeId);
    if (continuation) continue;
    if (cycleId) {
      const cycle = getCycle(db, cycleId);
      if (cycle && hasValidDurableContinuationOwner(db, cycle)) continue;
      const notice = db.prepare(
        `SELECT 1 FROM system_notice_outbox
          WHERE cycle_id = ? AND send_status NOT IN ('delivered', 'send_failure', 'suppressed')
          LIMIT 1`,
      ).get(cycleId);
      if (notice) continue;
      const detached = db.prepare(
        `SELECT 1 FROM detached_operations
          WHERE origin_cycle_id = ? AND state IN ('admitted', 'waiting_capacity', 'started')
          LIMIT 1`,
      ).get(cycleId);
      if (detached) continue;
      const undertaking = db.prepare(
        `SELECT 1 FROM worker_undertakings
          WHERE origin_cycle_id = ? AND origin_kind = 'OWNER_REQUEST'
            AND state IN ('queued', 'dispatching', 'running')
          LIMIT 1`,
      ).get(cycleId);
      if (undertaking) continue;
    }
    const wake = getWake(db, wakeId);
    if (!wake || wake.state !== "pending") continue;
    const ambiguous = db.prepare(
      `SELECT 1 FROM in_flight_effects
        WHERE wake_id = ? AND state IN ('in_flight', 'unknown') LIMIT 1`,
    ).get(wakeId);
    if (ambiguous) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = getWake(db, wakeId);
      if (!current || current.state !== "pending") {
        db.exec("COMMIT");
        continue;
      }
      db.prepare(
        `UPDATE wakes
            SET state = 'terminal', terminal_reason = 'no_action',
                lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL,
                updated_at_ms = ?
          WHERE wake_id = ? AND state = 'pending'`,
      ).run(nowMs, wakeId);
      db.exec("COMMIT");
      result.converged.push(wakeId);
    } catch {
      try { db.exec("ROLLBACK"); } catch { /* preserve the convergence error */ }
      throw new Error(`orphan_wake_convergence_failed:${wakeId}`);
    }
  }
  return result;
}

export type UnansweredOwnerRecoveryResult = {
  eligibleConversations: number;
  createdRepairs: CreatedOwnerRepair[];
  lineageExhaustedConversations: string[];
  failedConversations: Array<{ conversationId: string; error: string }>;
  wakesScanned: number;
  wakesConverged: string[];
  wakesSkippedProtected: number;
  finalFailureNoticeIds: number[];
};

function finalFailureNoticeForExhaustedOwner(
  db: DatabaseSync,
  conversation: EligibleOwnerConversation,
  nowMs: number,
): number | null {
  const row = db.prepare(
    `SELECT id, conversation_id, payload_json, wake_id, terminal_reason, last_error
       FROM inbox_events WHERE id = ? LIMIT 1`,
  ).get(conversation.primaryPredecessorEventId) as DbValue | undefined;
  if (!row) return null;
  let payload: DbValue = {};
  try {
    const parsed = JSON.parse(text(row.payload_json, "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as DbValue;
  } catch {
    // The eligibility proof already established durable Owner evidence. The
    // notice remains mechanically truthful even without optional payload data.
  }
  const wakeId = text(row.wake_id);
  const wake = wakeId ? getWake(db, wakeId) : null;
  const cycleId = wake?.cycleId ?? null;
  const cycle = cycleId ? getCycle(db, cycleId) : null;
  const generation = cycle?.generation ?? null;
  const ownerId = text(payload.ownerId, cycle?.occupantId ?? conversation.conversationId);
  const channel = text(payload.channel, "discord");
  const threadId = text(payload.threadId, conversation.conversationId);
  const failureCode = latestAttemptErrorCode(db, conversation.primaryPredecessorEventId)
    ?? (text(row.last_error) || text(row.terminal_reason) || null);
  const notice = emitInfrastructureNotice(db, {
    ownerId,
    channel,
    threadId,
    conversationId: conversation.conversationId,
    cycleId,
    generation,
    reason: "owner_recovery_exhausted",
    failureCode,
    origin: "live",
    trigger: "owner_message_reactive",
    deliveryLane: "reactive",
  });
  const existing = getSystemNoticeByKey(db, notice.noticeKey);
  if (existing && existing.noticeId !== notice.noticeId) return existing.noticeId;
  recordThoughtC3TerminalFailure(db, {
    noticeKey: notice.noticeKey,
    noticeId: notice.noticeId,
    cycleId: cycleId ?? `owner-recovery:${conversation.conversationId}`,
    generation: generation ?? 0,
    occurredAtMs: nowMs,
    failureClass: "owner_recovery_exhausted",
    attemptId: conversation.primaryPredecessorEventId,
  });
  return notice.noticeId;
}

/**
 * Bounded servicing opportunity for unanswered-Owner recovery. Discovers
 * eligible conversations oldest-first, materializes at most one repair
 * undertaking per conversation through existing repair lineage, then
 * converges orphan pending wakes outside protected conversations. Each
 * repair commits in its own transaction; per-conversation failures are
 * counted, never retried inline, and protect the conversation from wake
 * convergence for this pass (fail closed).
 */
export function serviceUnansweredOwnerRecovery(
  db: DatabaseSync,
  options: { nowMs?: number; conversationLimit?: number; wakeLimit?: number } = {},
): UnansweredOwnerRecoveryResult {
  const nowMs = options.nowMs ?? Date.now();
  const eligible = findEligibleUnansweredOwnerObligations(db, options);
  const result: UnansweredOwnerRecoveryResult = {
    eligibleConversations: eligible.length,
    createdRepairs: [],
    lineageExhaustedConversations: [],
    failedConversations: [],
    wakesScanned: 0,
    wakesConverged: [],
    wakesSkippedProtected: 0,
    finalFailureNoticeIds: [],
  };
  const protectedConversations = new Set<string>();
  for (const conversation of eligible) {
    try {
      const authorizationRef = repairAuthorizationRef(db, conversation.primaryPredecessorEventId);
      if (!authorizationRef) {
        result.lineageExhaustedConversations.push(conversation.conversationId);
        protectedConversations.add(conversation.conversationId);
        const noticeId = finalFailureNoticeForExhaustedOwner(db, conversation, nowMs);
        if (noticeId != null) result.finalFailureNoticeIds.push(noticeId);
        continue;
      }
      const repair = createRepairEvent(db, {
        predecessorEventId: conversation.primaryPredecessorEventId,
        authorizationRef,
        nowMs,
        continuityRecovery: {
          primaryPredecessorEventId: conversation.primaryPredecessorEventId,
          outstandingOwnerEvidenceRefs: conversation.outstandingOwnerEvidenceRefs,
          reason: "unanswered_owner_obligation_recovery",
        },
      });
      const created = repair.authorizationRef === authorizationRef
        && repair.predecessorEventId === conversation.primaryPredecessorEventId
        && !repairAlreadyTerminal(db, repair.eventId);
      result.createdRepairs.push({
        conversationId: conversation.conversationId,
        repair,
        created,
        predecessorEventId: conversation.primaryPredecessorEventId,
        outstandingOwnerEvidenceRefs: conversation.outstandingOwnerEvidenceRefs,
      });
      protectedConversations.add(conversation.conversationId);
    } catch (error) {
      result.failedConversations.push({
        conversationId: conversation.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      protectedConversations.add(conversation.conversationId);
    }
  }
  const convergence = convergeOrphanPendingWakes(db, {
    nowMs,
    limit: options.wakeLimit,
    protectedConversationIds: protectedConversations,
  });
  result.wakesScanned = convergence.scanned;
  result.wakesConverged = convergence.converged;
  result.wakesSkippedProtected = convergence.skippedProtected;
  return result;
}

function repairAlreadyTerminal(db: DatabaseSync, repairEventId: string): boolean {
  const found = db.prepare(
    "SELECT state FROM inbox_events WHERE id = ?",
  ).get(repairEventId) as { state?: unknown } | undefined;
  return found != null && (found.state === "terminal" || found.state === "quarantined");
}

/**
 * Resolve the continuity-recovery frame for a repair Thought from the repair
 * payload. Returns the model-visible frame (current-version refs), the
 * resolved evidence rows, and the primary row. Throws when nothing resolves:
 * a recovery Thought with no outstanding evidence must not run.
 */
export function resolveRepairContinuityRecovery(
  db: DatabaseSync,
  event: Pick<InboxEvent, "id" | "kind" | "conversationId" | "payload">,
): {
  frame: ThoughtContinuityRecovery;
  evidence: ConversationEvidenceRecord[];
  primary: ConversationEvidenceRecord;
} {
  if (event.kind !== "repair") throw new Error("continuity_recovery_not_repair");
  const payload = typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  const stored = typeof payload.continuityRecovery === "object" && payload.continuityRecovery !== null
    && !Array.isArray(payload.continuityRecovery)
    ? payload.continuityRecovery as Record<string, unknown>
    : null;
  const primaryPredecessorEventId = typeof payload.repairOfEventId === "string"
    ? payload.repairOfEventId
    : "";
  const refs = Array.isArray(stored?.outstandingOwnerEvidenceRefs)
    ? stored.outstandingOwnerEvidenceRefs.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0).slice(0, OWNER_RECOVERY_MAX_OUTSTANDING_REFS + 1)
    : [];
  if (!primaryPredecessorEventId || refs.length === 0) throw new Error("continuity_recovery_missing");
  if (refs.length > OWNER_RECOVERY_MAX_OUTSTANDING_REFS) throw new Error("continuity_recovery_unbounded");
  const resolved: ConversationEvidenceRecord[] = [];
  for (const ref of refs) {
    const direct = getEvidenceByRowId(db, ref);
    const current = direct && direct.conversationId === event.conversationId && direct.role === "owner"
      ? (isCurrentEvidenceVersion(db, direct) ? direct : currentLineageVersion(db, direct))
      : currentLineageVersionByRowId(db, event.conversationId, ref);
    if (current) resolved.push(current);
  }
  if (resolved.length === 0) throw new Error("continuity_recovery_unresolvable");
  const seen = new Set<string>();
  const unique = resolved.filter((item) => {
    if (seen.has(item.rowId)) return false;
    seen.add(item.rowId);
    return true;
  });
  return {
    frame: {
      repairEventId: event.id,
      primaryPredecessorEventId,
      outstandingOwnerEvidenceRefs: unique.map((item) => item.rowId),
      reason: "unanswered_owner_obligation_recovery",
    },
    evidence: unique,
    primary: unique[0]!,
  };
}

function currentLineageVersion(db: DatabaseSync, evidence: ConversationEvidenceRecord): ConversationEvidenceRecord | null {
  const peak = db.prepare(
    "SELECT row_id FROM conversation_evidence_log WHERE lineage_id = ? ORDER BY version DESC LIMIT 1",
  ).get(evidence.lineageId) as { row_id?: unknown } | undefined;
  if (typeof peak?.row_id !== "string" || !peak.row_id) return null;
  const current = getEvidenceByRowId(db, peak.row_id);
  return current && current.conversationId === evidence.conversationId && current.role === "owner" ? current : null;
}

function currentLineageVersionByRowId(
  db: DatabaseSync,
  conversationId: string,
  rowId: string,
): ConversationEvidenceRecord | null {
  const lineage = db.prepare(
    "SELECT lineage_id FROM conversation_evidence_log WHERE row_id = ?",
  ).get(rowId) as { lineage_id?: unknown } | undefined;
  if (typeof lineage?.lineage_id !== "string" || !lineage.lineage_id) return null;
  const peak = db.prepare(
    "SELECT row_id FROM conversation_evidence_log WHERE lineage_id = ? ORDER BY version DESC LIMIT 1",
  ).get(lineage.lineage_id) as { row_id?: unknown } | undefined;
  if (typeof peak?.row_id !== "string" || !peak.row_id) return null;
  const current = getEvidenceByRowId(db, peak.row_id);
  return current && current.conversationId === conversationId && current.role === "owner" ? current : null;
}
