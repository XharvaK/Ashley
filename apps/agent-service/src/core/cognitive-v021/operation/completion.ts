import type { DatabaseSync } from "node:sqlite";
import { entityName } from "../../entity-names.js";
import { appendInboxEvent, getInboxEvent } from "../cycle/inbox.js";
import { appendSystemEvent, getConversationEvidence } from "../evidence/conversation-log.js";
import {
  getCanonicalObservationById,
  observationBindingHash,
} from "../observation/persistence.js";
import type { DetachedOperationTerminalState } from "./detached.js";
import { getDetachedOperation } from "./detached.js";
import { getInterimOutboxByOperation } from "./interim.js";
import { getWorkerUndertaking } from "./worker-queue.js";
import { isAuthorizedOwnerId } from "../../../owner-auth.js";
import { getEffectReceipt, getInFlightByEffectId, recordEffectReceipt } from "../effect/in-flight.js";
import {
  abandonEffectContinuation,
  effectContinuationBindingHash,
  EFFECT_CONTINUATION_PUBLICATION_MARGIN_MS,
  EFFECT_CONTINUATION_RUNTIME_ID,
  getEffectContinuation,
  listRunningEffectContinuations,
  recordEffectContinuationCompletion,
} from "../effect/continuation.js";
import type { EffectReceipt } from "../types.js";

export type ProduceCompletionResult =
  | { ok: true; eventId: string; created: boolean }
  | { ok: false; reason: string };

/** Exactly-one completion identity per operation across all producers. */
export function completionEventIdFor(operationId: string): string {
  return `operation:${operationId}:completion`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function completionSummary(input: {
  terminalState: DetachedOperationTerminalState;
  originKind: string;
  purpose: string;
  evidenceNeed: string;
  interimText: string | null;
  observationRef: string | null;
  receiptRef: string | null;
  errorCode: string | null;
  supersededBy: string | null;
}): string {
  const label = input.originKind === "OWNER_REQUEST"
    ? "Detached investigation"
    : `${input.originKind} worker investigation`;
  const parts = [
    `${label} ${input.terminalState}: ${truncate(input.purpose, 280)}.`,
    `Evidence need: ${truncate(input.evidenceNeed, 200)}.`,
  ];
  if (input.interimText) {
    parts.push(`${entityName()} interim: "${truncate(input.interimText, 300)}".`);
  }
  const refs = [
    input.observationRef ? `observation ${input.observationRef}` : null,
    input.receiptRef ? `receipt ${input.receiptRef}` : null,
    input.errorCode ? `error ${input.errorCode}` : null,
  ].filter((ref): ref is string => ref !== null);
  if (refs.length > 0) parts.push(`Refs: ${refs.join(", ")}.`);
  if (input.supersededBy) parts.push(`Superseded by: ${input.supersededBy}.`);
  return parts.join(" ");
}

/**
 * Produce the exactly-one completion opportunity for a terminal detached
 * operation. Terminal truth is the precondition: this function never
 * classifies, executes, or reruns work. The inbox event id is deterministic
 * (`operation:<id>:completion`) and appendInboxEvent is idempotent on id, so
 * concurrent producers and crash retries converge on one wake.
 *
 * Thought B context travels on two source-faithful channels: the worker
 * observation binds through the durable observation-binding payload (when
 * terminal succeeded with stored evidence), and a bounded Host system event
 * carries terminal state, purpose, interim text, and refs into conversation
 * evidence. Worker text stays evidence; the completion never speaks for
 * Ashley.
 */
export function produceOperationCompletion(
  sidecar: DatabaseSync,
  operationId: string,
  options: { nowMs?: number } = {},
): ProduceCompletionResult {
  const nowMs = options.nowMs ?? Date.now();
  if (typeof operationId !== "string" || operationId.length === 0) {
    return { ok: false, reason: "invalid_operation" };
  }
  const operation = getDetachedOperation(sidecar, operationId);
  if (!operation) {
    const continuation = getEffectContinuation(sidecar, operationId);
    if (!continuation) return { ok: false, reason: "detached_operation_missing" };
    if (continuation.state === "running") return { ok: false, reason: "effect_continuation_not_terminal" };
    const receipt = getEffectReceipt(sidecar, operationId);
    if (!receipt || receipt.outcome === "in_progress") {
      return { ok: false, reason: "effect_continuation_receipt_missing" };
    }
    const eventId = completionEventIdFor(operationId);
    if (continuation.completionEventRef) {
      return { ok: true, eventId: continuation.completionEventRef, created: false };
    }
    const existingEvent = getInboxEvent(sidecar, eventId);
    if (existingEvent) {
      recordEffectContinuationCompletion(sidecar, operationId, eventId, nowMs);
      return { ok: true, eventId, created: false };
    }
    const inFlight = getInFlightByEffectId(sidecar, operationId);
    if (!inFlight || inFlight.cycleId !== continuation.cycleId
      || inFlight.generation !== continuation.generation) {
      return { ok: false, reason: "effect_continuation_binding_missing" };
    }
    const bindingHash = effectContinuationBindingHash(continuation);
    const observationBindingHashValue = observationBindingHash({ observationIds: [], observations: [] });
    const payload = {
      effectContinuationId: operationId,
      operationId,
      effectId: operationId,
      effectBindingHash: bindingHash,
      terminalState: continuation.state,
      terminalClass: continuation.terminalClass ?? "UNKNOWN",
      effectTruth: continuation.effectTruth ?? "unknown",
      purpose: continuation.purpose,
      target: continuation.target,
      diagnosticRef: continuation.diagnosticRef,
      deadlineAtMs: continuation.deadlineAtMs,
      remainingEffectRounds: continuation.remainingEffectRounds,
      originCycleId: continuation.cycleId,
      originGeneration: continuation.generation,
      originOwnerEventId: inFlight.originEventId,
      observationRef: null,
      receiptRef: receipt.receiptId,
      observationsCapture: "none",
      observationIds: [],
      observationCount: 0,
      observationBindingHash: observationBindingHashValue,
      triggerRef: `operation-completion:${operationId}`,
    };
    appendInboxEvent(sidecar, {
      id: eventId,
      conversationId: continuation.conversationId,
      kind: "observation_or_receipt",
      payload,
      createdAtMs: nowMs,
    });
    appendSystemEvent(sidecar, {
      conversationId: continuation.conversationId,
      text: `Develop effect ${continuation.state} (${continuation.terminalClass ?? "UNKNOWN"}; effect truth ${continuation.effectTruth ?? "unknown"}). Purpose: ${truncate(continuation.purpose, 280)}. Target: ${JSON.stringify(continuation.target)}. Refs: effect ${operationId}, diagnostic ${continuation.diagnosticRef ?? "unavailable"}, receipt ${receipt.receiptId}.`,
      producingCycleId: continuation.cycleId,
      dataClassification: "never_public",
      nowMs,
    });
    recordEffectContinuationCompletion(sidecar, operationId, eventId, nowMs);
    return { ok: true, eventId, created: true };
  }
  if (operation.terminalState === null) {
    return { ok: false, reason: "detached_operation_not_terminal" };
  }
  const eventId = completionEventIdFor(operationId);
  if (operation.completionEventRef) {
    return { ok: true, eventId: operation.completionEventRef, created: false };
  }

  const interim = getInterimOutboxByOperation(sidecar, operationId);
  const observationIds: string[] = [];
  let observationBindingHashValue: string | null = null;
  if (operation.terminalState === "succeeded" && operation.observationRef) {
    const canonical = getCanonicalObservationById(sidecar, operation.observationRef);
    if (canonical) {
      observationIds.push(canonical.observationId);
      observationBindingHashValue = observationBindingHash({
        observationIds,
        observations: [canonical],
      });
    }
  }
  const observationsCapture = observationIds.length > 0 ? "present" : "none";
  const bindingHash = observationBindingHashValue
    ?? observationBindingHash({ observationIds: [], observations: [] });

  let canonicalOwnerId: string | null = null;
  if (operation.originKind === "OWNER_REQUEST") {
    if (operation.workerUndertakingId) {
      const undertaking = getWorkerUndertaking(sidecar, operation.workerUndertakingId);
      if (undertaking?.ownerId && typeof undertaking.ownerId === "string" && undertaking.ownerId.trim().length > 0) {
        canonicalOwnerId = undertaking.ownerId.trim();
      }
    }
    if (!canonicalOwnerId && operation.originOwnerEventId) {
      const ownerEvent = getInboxEvent(sidecar, operation.originOwnerEventId);
      const evPayload = ownerEvent && typeof ownerEvent.payload === "object" && ownerEvent.payload !== null && !Array.isArray(ownerEvent.payload)
        ? (ownerEvent.payload as Record<string, unknown>)
        : null;
      if (evPayload && typeof evPayload.ownerId === "string" && evPayload.ownerId.trim().length > 0) {
        canonicalOwnerId = evPayload.ownerId.trim();
      }
    }
    if (!canonicalOwnerId && interim?.deliveryIntent?.ownerId && typeof interim.deliveryIntent.ownerId === "string" && interim.deliveryIntent.ownerId.trim().length > 0) {
      canonicalOwnerId = interim.deliveryIntent.ownerId.trim();
    }
    if (!canonicalOwnerId && operation.originEvidenceRowId) {
      const evidence = getConversationEvidence(sidecar, operation.originEvidenceRowId);
      if (evidence?.speakerPrincipalId && typeof evidence.speakerPrincipalId === "string" && evidence.speakerPrincipalId.trim().length > 0) {
        canonicalOwnerId = evidence.speakerPrincipalId.trim();
      }
    }
    if (canonicalOwnerId && !isAuthorizedOwnerId(canonicalOwnerId)) {
      canonicalOwnerId = null;
    }
  }

  const payload = {
    detachedOperationId: operationId,
    terminalState: operation.terminalState,
    errorCode: operation.errorCode,
    originCycleId: operation.originCycleId,
    originGeneration: operation.originGeneration,
    originKind: operation.originKind,
    originRef: operation.originRef,
    originOwnerEventId: operation.originOwnerEventId,
    originEvidenceRowId: operation.originEvidenceRowId,
    workerUndertakingId: operation.workerUndertakingId,
    purpose: operation.purpose,
    evidenceNeed: operation.evidenceNeed,
    interimText: interim?.surfaceDraft ?? null,
    observationRef: operation.observationRef,
    receiptRef: operation.receiptRef,
    supersededBy: operation.supersededBy,
    successorOperationId: operation.successorOperationId,
    cancelRequestedAtMs: operation.cancelRequestedAtMs,
    observationsCapture,
    observationIds,
    observationCount: observationIds.length,
    observationBindingHash: bindingHash,
    triggerRef: `operation-completion:${operationId}`,
    ...(canonicalOwnerId ? { ownerId: canonicalOwnerId } : {}),
  };

  appendInboxEvent(sidecar, {
    id: eventId,
    conversationId: operation.conversationId,
    kind: "observation_or_receipt",
    payload,
    createdAtMs: nowMs,
  });
  appendSystemEvent(sidecar, {
    conversationId: operation.conversationId,
    text: completionSummary({
      terminalState: operation.terminalState,
      originKind: operation.originKind,
      purpose: operation.purpose,
      evidenceNeed: operation.evidenceNeed,
      interimText: interim?.surfaceDraft ?? null,
      observationRef: operation.observationRef,
      receiptRef: operation.receiptRef,
      errorCode: operation.errorCode,
      supersededBy: operation.supersededBy,
    }),
    producingCycleId: operation.originCycleId,
    dataClassification: "never_public",
    nowMs,
  });
  sidecar
    .prepare("UPDATE detached_operations SET completion_event_ref = ?, updated_at_ms = ? WHERE operation_id = ?")
    .run(eventId, nowMs, operationId);
  return { ok: true, eventId, created: true };
}

/**
 * Crash-boundary backfill: every terminal operation lacking a completion
 * reference gets its exactly-one completion opportunity. Terminal truth is
 * never re-derived here; rows already carrying a reference are untouched.
 */
export function reconcileMissingCompletions(
  sidecar: DatabaseSync,
  options: { nowMs?: number; limit?: number; runtimeId?: string } = {},
): { produced: string[]; failures: string[] } {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const rows = sidecar
    .prepare(
      `SELECT operation_id FROM detached_operations
        WHERE terminal_state IS NOT NULL AND completion_event_ref IS NULL
        ORDER BY terminal_at_ms ASC, operation_id ASC LIMIT ?`,
    )
    .all(limit) as Array<{ operation_id?: unknown }>;
  const produced: string[] = [];
  const failures: string[] = [];
  for (const row of rows) {
    if (typeof row.operation_id !== "string" || !row.operation_id) continue;
    try {
      const result = produceOperationCompletion(sidecar, row.operation_id, { nowMs });
      if (result.ok) produced.push(result.eventId);
      else failures.push(row.operation_id);
    } catch {
      failures.push(row.operation_id);
    }
  }
  const continuationRows = listRunningEffectContinuations(sidecar, limit);
  for (const continuation of continuationRows) {
    if (continuation.runtimeId === (options.runtimeId ?? EFFECT_CONTINUATION_RUNTIME_ID)
      && nowMs < continuation.deadlineAtMs + EFFECT_CONTINUATION_PUBLICATION_MARGIN_MS) continue;
    const existingReceipt = getEffectReceipt(sidecar, continuation.effectId);
    let receipt = existingReceipt;
    if (!receipt || receipt.outcome === "in_progress") {
      const inFlight = getInFlightByEffectId(sidecar, continuation.effectId);
      if (!inFlight) {
        failures.push(continuation.effectId);
        continue;
      }
      const timeout = nowMs >= continuation.deadlineAtMs + EFFECT_CONTINUATION_PUBLICATION_MARGIN_MS;
      const unknownReceipt: EffectReceipt = {
        receiptId: `v021:effect:${continuation.effectId}:recovered-unknown`,
        effectId: continuation.effectId,
        idempotencyKey: inFlight.idempotencyKey,
        outcome: "outcome_unknown",
        claims: {
          executionTruth: "effect_unknown",
          terminationClass: timeout ? "RESOURCE_EXHAUSTED" : "CANCELLED",
          errorCode: timeout ? "effect_deadline_exhausted" : "effect_process_restarted",
        },
        atMs: nowMs,
        dataClassification: "never_public",
        secretOmitted: true,
      };
      receipt = recordEffectReceipt(sidecar, unknownReceipt);
    }
    const terminalClass = typeof receipt.claims.terminationClass === "string"
      ? receipt.claims.terminationClass
      : receipt.outcome === "succeeded" ? "SUCCESS" : "FAILED";
    const effectTruth = typeof receipt.claims.executionTruth === "string"
      ? receipt.claims.executionTruth
      : receipt.outcome === "succeeded" ? "unknown" : "effect_unknown";
    const state = terminalClass === "CANCELLED"
      ? "cancelled" as const
      : receipt.outcome === "succeeded"
        ? "succeeded" as const
        : receipt.outcome === "failed"
          ? "failed" as const
          : "outcome_unknown" as const;
    abandonEffectContinuation(sidecar, {
      effectId: continuation.effectId,
      nowMs,
      terminalClass,
      effectTruth,
      state,
    });
  }
  const terminalContinuations = sidecar.prepare(
    `SELECT effect_id FROM effect_continuations
      WHERE state <> 'running' AND completion_event_ref IS NULL
      ORDER BY started_at_ms ASC, effect_id ASC LIMIT ?`,
  ).all(limit) as Array<{ effect_id?: unknown }>;
  for (const row of terminalContinuations) {
    if (typeof row.effect_id !== "string" || !row.effect_id) continue;
    try {
      const result = produceOperationCompletion(sidecar, row.effect_id, { nowMs });
      if (result.ok) produced.push(result.eventId);
      else failures.push(row.effect_id);
    } catch {
      failures.push(row.effect_id);
    }
  }
  return { produced, failures };
}
