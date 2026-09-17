import type { DatabaseSync } from "node:sqlite";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendSystemEvent } from "../evidence/conversation-log.js";
import {
  getCanonicalObservationById,
  observationBindingHash,
} from "../observation/persistence.js";
import type { DetachedOperationTerminalState } from "./detached.js";
import { getDetachedOperation } from "./detached.js";
import { getInterimOutboxByOperation } from "./interim.js";

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
  purpose: string;
  evidenceNeed: string;
  interimText: string | null;
  observationRef: string | null;
  receiptRef: string | null;
  errorCode: string | null;
  supersededBy: string | null;
}): string {
  const parts = [
    `Detached investigation ${input.terminalState}: ${truncate(input.purpose, 280)}.`,
    `Evidence need: ${truncate(input.evidenceNeed, 200)}.`,
  ];
  if (input.interimText) {
    parts.push(`Ashley interim: "${truncate(input.interimText, 300)}".`);
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
  if (!operation) return { ok: false, reason: "detached_operation_missing" };
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

  const payload = {
    detachedOperationId: operationId,
    terminalState: operation.terminalState,
    errorCode: operation.errorCode,
    originCycleId: operation.originCycleId,
    originGeneration: operation.originGeneration,
    originOwnerEventId: operation.originOwnerEventId,
    originEvidenceRowId: operation.originEvidenceRowId,
    purpose: operation.purpose,
    evidenceNeed: operation.evidenceNeed,
    interimText: interim?.surfaceDraft ?? null,
    observationRef: operation.observationRef,
    receiptRef: operation.receiptRef,
    supersededBy: operation.supersededBy,
    successorOperationId: operation.successorOperationId,
    observationsCapture,
    observationIds,
    observationCount: observationIds.length,
    observationBindingHash: bindingHash,
    triggerRef: `operation-completion:${operationId}`,
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
  options: { nowMs?: number; limit?: number } = {},
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
  return { produced, failures };
}
