import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  ObservabilityStore,
  type ThoughtDispatchDiagnostic,
} from "../thought/diagnostics.js";
import {
  getPrivateReservationForWake,
  listPrivateAttemptHistory,
  type PrivateAttemptRecord,
} from "../private-budget/ledger.js";
import { getCycle } from "../cycle/inbox.js";
import { getWake } from "../wake/ledger.js";
import type { CycleRecord, WakeRecord } from "../types.js";
import {
  listReceipts as listPeriodicReceipts,
  periodicTriggerRef,
  readReceipt,
  readSchedule,
  type PeriodicOccurrenceReceipt,
  type PeriodicScheduleRow,
} from "./periodic-schedule.js";

type DbRow = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueRow(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): DbRow | null {
  const rows = db.prepare(sql).all(...params) as DbRow[];
  return rows.length === 1 ? rows[0]! : null;
}

export type PeriodicDiagnosticCycle = {
  cycleId: string;
  generation: number;
  conversationId: string;
  state: string;
  triggerKind: string;
  triggerRef: string | null;
  occupantId: string | null;
  authorityEpoch: number;
  architectureEpoch: string;
  admittedAtMs: number;
  updatedAtMs: number | null;
};

export type PeriodicDiagnosticWake = {
  wakeId: string;
  occurrenceId: string;
  triggerRef: string;
  sourceKind: string;
  conversationId: string;
  cycleId: string;
  state: string;
  terminalReason: string | null;
  capturedTriggerGeneration: number | null;
  capturedAuthorityRevision: number;
};

export type PeriodicDiagnosticInboxEvent = {
  id: string;
  conversationId: string;
  kind: string;
  createdAtMs: number;
  status: string;
  state: string;
  attemptCount: number;
  claimedAtMs: number | null;
  consumedAtMs: number | null;
  leaseExpiresAtMs: number | null;
  nextEligibleAtMs: number | null;
  lastError: string | null;
  terminalReason: string | null;
  quarantineReason: string | null;
};

export type PeriodicDiagnosticReservation = {
  reservationId: string;
  admissionId: string;
  wakeId: string;
  conversationId: string;
  policyId: string;
  state: string;
  policyTimeMs: number;
  invocationId: string | null;
  attemptId: string | null;
  dispatchTruth: string;
  releaseProofRef: string | null;
};

export type PeriodicDiagnosticAttempt = PrivateAttemptRecord & {
  /** The durable child binding wins; the parent is resolved from S5 evidence. */
  providerRequestId: string | null;
  diagnostics: ThoughtDispatchDiagnostic[];
};

export type PeriodicDiagnosticAllocationReceipt = {
  requestId: string;
  cycleId: string;
  generation: number;
  policyId: string;
  policyVersion: number;
  quotaBucket: string;
  hardTpm: number;
  maxOutputTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  totalDemandTokens: number;
  headroomTokens: number;
  compression: boolean;
  requiredOverflow: boolean;
  semanticProjectionHash: string;
  dispatchMessagesHash: string;
  createdAtMs: number;
};

export type PeriodicDiagnosticSettlement = {
  settlementId: string;
  cycleId: string;
  generation: number;
  wakeId: string | null;
  semanticPass: number | null;
};

export type PeriodicDiagnosticSpeechOutbox = {
  outboxId: number;
  settlementId: string;
  projectionKey: string;
  cycleId: string;
  generation: number;
  sendStatus: string;
  nuclearReservationId: number | null;
  suppressed: boolean;
  origin: string;
  nuclearFinalizationReason: string | null;
};

export type PeriodicDiagnosticSystemNotice = {
  noticeId: number;
  noticeKey: string;
  projectionKey: string;
  cycleId: string | null;
  conversationId: string;
  sendStatus: string;
  nuclearReservationId: number | null;
  discordMessageId: string | null;
  origin: string;
};

export type PeriodicDiagnosticRecord = {
  occurrence: PeriodicOccurrenceReceipt;
  schedule: PeriodicScheduleRow | null;
  wake: PeriodicDiagnosticWake | null;
  cycle: PeriodicDiagnosticCycle | null;
  inboxEvents: PeriodicDiagnosticInboxEvent[];
  reservation: PeriodicDiagnosticReservation | null;
  attempts: PeriodicDiagnosticAttempt[];
  allocationReceipts: PeriodicDiagnosticAllocationReceipt[];
  diagnostics: ThoughtDispatchDiagnostic[];
  settlement: PeriodicDiagnosticSettlement | null;
  publication: {
    speechOutbox: PeriodicDiagnosticSpeechOutbox | null;
    systemNotices: PeriodicDiagnosticSystemNotice[];
  };
  debugCapture: ReturnType<ObservabilityStore["getThoughtDebugCapture"]>;
  spend: {
    parentReservationId: string | null;
    parentReservationCount: number;
    childAttemptCount: number;
    countedAttemptOrdinals: number[];
  };
};

export type PeriodicDiagnosticsOptions = {
  limit?: number;
  nowMs?: number;
};

function cycleSummary(row: CycleRecord | null): PeriodicDiagnosticCycle | null {
  if (!row) return null;
  return {
    cycleId: row.cycleId,
    generation: row.generation,
    conversationId: row.conversationId,
    state: row.state,
    triggerKind: row.triggerKind,
    triggerRef: row.triggerRef || null,
    occupantId: row.occupantId || null,
    authorityEpoch: row.authorityEpoch,
    architectureEpoch: row.architectureEpoch,
    admittedAtMs: row.admittedAtMs,
    updatedAtMs: null,
  };
}

function wakeSummary(row: WakeRecord | null): PeriodicDiagnosticWake | null {
  if (!row) return null;
  return {
    wakeId: row.wakeId,
    occurrenceId: row.occurrenceId,
    triggerRef: row.triggerRef,
    sourceKind: row.sourceKind,
    conversationId: row.conversationId,
    cycleId: row.cycleId,
    state: row.state,
    terminalReason: row.terminalReason,
    capturedTriggerGeneration: row.capturedTriggerGeneration,
    capturedAuthorityRevision: row.capturedAuthorityRevision,
  };
}

function reservationSummary(row: ReturnType<typeof getPrivateReservationForWake>): PeriodicDiagnosticReservation | null {
  if (!row) return null;
  return {
    reservationId: row.reservationId,
    admissionId: row.admissionId,
    wakeId: row.wakeId,
    conversationId: row.conversationId,
    policyId: row.policyId,
    state: row.state,
    policyTimeMs: row.policyTimeMs,
    invocationId: row.invocationId,
    attemptId: row.attemptId,
    dispatchTruth: row.dispatchTruth,
    releaseProofRef: row.releaseProofRef,
  };
}

function readInboxEvents(db: DatabaseSync, wakeId: string | null): PeriodicDiagnosticInboxEvent[] {
  if (!wakeId) return [];
  const rows = db.prepare(
    `SELECT id, conversation_id, kind, created_at_ms, status, state,
            attempt_count, claimed_at_ms, consumed_at_ms, lease_expires_at_ms,
            next_eligible_at_ms, last_error, terminal_reason, quarantine_reason
       FROM inbox_events
      WHERE wake_id = ?
      ORDER BY created_at_ms ASC, id ASC`,
  ).all(wakeId) as DbRow[];
  return rows.map((row) => ({
    id: text(row.id),
    conversationId: text(row.conversation_id),
    kind: text(row.kind),
    createdAtMs: number(row.created_at_ms),
    status: text(row.status),
    state: text(row.state),
    attemptCount: number(row.attempt_count),
    claimedAtMs: nullableNumber(row.claimed_at_ms),
    consumedAtMs: nullableNumber(row.consumed_at_ms),
    leaseExpiresAtMs: nullableNumber(row.lease_expires_at_ms),
    nextEligibleAtMs: nullableNumber(row.next_eligible_at_ms),
    lastError: nullableText(row.last_error),
    terminalReason: nullableText(row.terminal_reason),
    quarantineReason: nullableText(row.quarantine_reason),
  }));
}

function readAllocationReceipts(
  db: DatabaseSync,
  cycleId: string | null,
  generation: number | null,
): PeriodicDiagnosticAllocationReceipt[] {
  if (!cycleId || generation === null) return [];
  const rows = db.prepare(
    `SELECT request_id, cycle_id, generation, policy_id, policy_version,
            quota_bucket, hard_tpm, max_output_tokens, estimated_input_tokens,
            estimated_output_tokens, total_demand_tokens, headroom_tokens,
            compression, required_overflow, semantic_projection_hash,
            dispatch_messages_hash, created_at_ms
       FROM allocation_receipts
      WHERE cycle_id = ? AND generation = ?
      ORDER BY created_at_ms ASC, request_id ASC`,
  ).all(cycleId, generation) as DbRow[];
  return rows.map((row) => ({
    requestId: text(row.request_id),
    cycleId: text(row.cycle_id),
    generation: number(row.generation),
    policyId: text(row.policy_id),
    policyVersion: number(row.policy_version),
    quotaBucket: text(row.quota_bucket),
    hardTpm: number(row.hard_tpm),
    maxOutputTokens: number(row.max_output_tokens),
    estimatedInputTokens: number(row.estimated_input_tokens),
    estimatedOutputTokens: number(row.estimated_output_tokens),
    totalDemandTokens: number(row.total_demand_tokens),
    headroomTokens: number(row.headroom_tokens),
    compression: number(row.compression) === 1,
    requiredOverflow: number(row.required_overflow) === 1,
    semanticProjectionHash: text(row.semantic_projection_hash),
    dispatchMessagesHash: text(row.dispatch_messages_hash),
    createdAtMs: number(row.created_at_ms),
  }));
}

function readSettlement(
  db: DatabaseSync,
  cycleId: string | null,
  generation: number | null,
): PeriodicDiagnosticSettlement | null {
  if (!cycleId || generation === null) return null;
  const row = db.prepare(
    `SELECT settlement_id, cycle_id, generation, wake_id, semantic_pass
       FROM settlements WHERE cycle_id = ? AND generation = ? LIMIT 1`,
  ).get(cycleId, generation) as DbRow | undefined;
  if (!row) return null;
  return {
    settlementId: text(row.settlement_id),
    cycleId: text(row.cycle_id),
    generation: number(row.generation),
    wakeId: nullableText(row.wake_id),
    semanticPass: nullableNumber(row.semantic_pass),
  };
}

function readSpeechOutbox(
  db: DatabaseSync,
  cycleId: string | null,
  generation: number | null,
): PeriodicDiagnosticSpeechOutbox | null {
  if (!cycleId || generation === null) return null;
  const row = db.prepare(
    `SELECT outbox_id, settlement_id, projection_key, cycle_id, generation,
            send_status, nuclear_reservation_id, suppressed, origin,
            nuclear_finalization_reason
       FROM speech_outbox
      WHERE cycle_id = ? AND generation = ?
      ORDER BY outbox_id ASC LIMIT 1`,
  ).get(cycleId, generation) as DbRow | undefined;
  if (!row) return null;
  return {
    outboxId: number(row.outbox_id),
    settlementId: text(row.settlement_id),
    projectionKey: text(row.projection_key),
    cycleId: text(row.cycle_id),
    generation: number(row.generation),
    sendStatus: text(row.send_status),
    nuclearReservationId: nullableNumber(row.nuclear_reservation_id),
    suppressed: number(row.suppressed) === 1,
    origin: text(row.origin),
    nuclearFinalizationReason: nullableText(row.nuclear_finalization_reason),
  };
}

function readSystemNotices(db: DatabaseSync, cycleId: string | null): PeriodicDiagnosticSystemNotice[] {
  if (!cycleId) return [];
  const rows = db.prepare(
    `SELECT notice_id, notice_key, projection_key, cycle_id, conversation_id,
            send_status, nuclear_reservation_id, discord_message_id, origin
       FROM system_notice_outbox
      WHERE cycle_id = ?
      ORDER BY notice_id ASC`,
  ).all(cycleId) as DbRow[];
  return rows.map((row) => ({
    noticeId: number(row.notice_id),
    noticeKey: text(row.notice_key),
    projectionKey: text(row.projection_key),
    cycleId: nullableText(row.cycle_id),
    conversationId: text(row.conversation_id),
    sendStatus: text(row.send_status),
    nuclearReservationId: nullableNumber(row.nuclear_reservation_id),
    discordMessageId: nullableText(row.discord_message_id),
    origin: text(row.origin),
  }));
}

function diagnosticMatchesAttempt(
  diagnostic: ThoughtDispatchDiagnostic,
  attempt: PrivateAttemptRecord,
): boolean {
  return diagnostic.providerDiagnostics?.attemptOrdinal === attempt.ordinal
    || diagnostic.providerFailure?.attemptOrdinal === attempt.ordinal
    || diagnostic.primaryAttemptId === attempt.attemptId
    || diagnostic.providerFailure?.modelFabricAttemptId === attempt.attemptId
    || diagnostic.requestId === attempt.invocationId;
}

function providerRequestIdForAttempt(
  attempt: PrivateAttemptRecord,
  diagnostics: ThoughtDispatchDiagnostic[],
): string | null {
  const candidates = new Set<string>();
  if (attempt.providerRequestId) candidates.add(attempt.providerRequestId);
  for (const diagnostic of diagnostics) {
    const providerRequestId = diagnostic.providerDiagnostics?.providerRequestId;
    if (providerRequestId) candidates.add(providerRequestId);
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
}

function buildRecord(
  sidecar: DatabaseSync,
  observability: ObservabilityStore,
  occurrence: PeriodicOccurrenceReceipt,
  schedule: PeriodicScheduleRow | null,
  nowMs: number,
): PeriodicDiagnosticRecord {
  let wake: WakeRecord | null = occurrence.wakeId ? getWake(sidecar, occurrence.wakeId) : null;
  // A NULL-wake terminal is authoritative. The exact trigger backstop may
  // enrich it when a wake exists, but never replaces the receipt's NULL root.
  if (!occurrence.wakeId) {
    const triggerRef = periodicTriggerRef(occurrence.scheduleOccurrenceId, occurrence.eligibleAtMs);
    const row = uniqueRow(
      sidecar,
      "SELECT * FROM wakes WHERE trigger_ref = ? LIMIT 2",
      triggerRef,
    );
    if (row) wake = getWake(sidecar, text(row.wake_id));
  }
  const cycle = wake ? getCycle(sidecar, wake.cycleId) : null;
  const reservation = wake
    ? (() => {
        try {
          return getPrivateReservationForWake(sidecar, wake!.wakeId);
        } catch {
          // Ambiguous reservation truth is not collapsed into a fabricated
          // single reservation in a diagnostic projection.
          return null;
        }
      })()
    : null;
  const reservationProjection = reservationSummary(reservation);
  const durableAttempts = reservation
    ? listPrivateAttemptHistory(sidecar, reservation.reservationId)
    : [];
  const diagnostics = cycle
    ? observability.listDiagnostics(10_000, { cycleId: cycle.cycleId, generation: cycle.generation })
    : [];
  const attempts = durableAttempts.map((attempt) => {
    const attemptDiagnostics = diagnostics.filter((diagnostic) => diagnosticMatchesAttempt(diagnostic, attempt));
    return {
      ...attempt,
      providerRequestId: providerRequestIdForAttempt(attempt, attemptDiagnostics),
      diagnostics: attemptDiagnostics,
    };
  });
  const cycleProjection = cycleSummary(cycle);
  const settlement = readSettlement(sidecar, cycleProjection?.cycleId ?? null, cycleProjection?.generation ?? null);

  return {
    occurrence,
    schedule,
    wake: wakeSummary(wake),
    cycle: cycleProjection,
    inboxEvents: readInboxEvents(sidecar, wake?.wakeId ?? null),
    reservation: reservationProjection,
    attempts,
    allocationReceipts: readAllocationReceipts(observability.db, cycleProjection?.cycleId ?? null, cycleProjection?.generation ?? null),
    diagnostics,
    settlement,
    publication: {
      speechOutbox: readSpeechOutbox(sidecar, cycleProjection?.cycleId ?? null, cycleProjection?.generation ?? null),
      systemNotices: readSystemNotices(sidecar, cycleProjection?.cycleId ?? null),
    },
    debugCapture: observability.getThoughtDebugCapture(occurrence.scheduleOccurrenceId, nowMs),
    spend: {
      parentReservationId: reservationProjection?.reservationId ?? null,
      parentReservationCount: reservationProjection ? 1 : 0,
      childAttemptCount: attempts.filter((attempt) => attempt.ordinal >= 2).length,
      countedAttemptOrdinals: reservationProjection && attempts.some((attempt) => attempt.ordinal === 1) ? [1] : [],
    },
  };
}

export function listPeriodicDiagnostics(
  sidecar: DatabaseSync,
  observabilityDb: DatabaseSync,
  options: PeriodicDiagnosticsOptions = {},
): PeriodicDiagnosticRecord[] {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 100)));
  const nowMs = options.nowMs ?? Date.now();
  const observability = new ObservabilityStore(observabilityDb);
  return listPeriodicReceipts(sidecar)
    .sort((left, right) => right.closedAtMs - left.closedAtMs || right.scheduleOccurrenceId.localeCompare(left.scheduleOccurrenceId))
    .slice(0, limit)
    .map((occurrence) => buildRecord(sidecar, observability, occurrence, readSchedule(sidecar), nowMs));
}

export function getPeriodicDiagnostic(
  sidecar: DatabaseSync,
  observabilityDb: DatabaseSync,
  occurrenceId: string,
  options: Omit<PeriodicDiagnosticsOptions, "limit"> = {},
): PeriodicDiagnosticRecord | null {
  const occurrence = readReceipt(sidecar, occurrenceId);
  if (!occurrence) return null;
  const observability = new ObservabilityStore(observabilityDb);
  return buildRecord(sidecar, observability, occurrence, readSchedule(sidecar), options.nowMs ?? Date.now());
}
