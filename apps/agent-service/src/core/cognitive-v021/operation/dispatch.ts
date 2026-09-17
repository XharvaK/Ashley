import type { DatabaseSync } from "node:sqlite";
import { persistOrVerifyObservation } from "../observation/persistence.js";
import type {
  DeliveryIntent,
  Observation,
  ObservationIntentSemanticOutput,
} from "../types.js";
import {
  admitDetachedOperation,
  getDetachedOperation,
  markDetachedOperationStarted,
  setDetachedOperationTerminal,
  type DetachedOperationRecord,
} from "./detached.js";
import { authorizeInterimSpeech } from "./interim.js";

/** Own bounded wall-clock for a detached operation: outside any Thought budget. */
export const DETACHED_OPERATION_DEFAULT_DEADLINE_MS = 300_000 as const;

export type DetachInvestigateInput = {
  /** Full parsed Thought observation intent (carries purpose/evidenceNeed/interim). */
  intent: ObservationIntentSemanticOutput;
  cycleId: string;
  generation: number;
  conversationId: string;
  /** Originating Owner event that Thought A answered with this intent. */
  originOwnerEventId: string;
  originEvidenceRowId?: string | null;
  /** Owner identity for the interim delivery intent. */
  ownerId: string;
  nowMs?: number;
};

export type DetachInvestigateResult =
  | {
      detached: true;
      operation: DetachedOperationRecord;
      created: boolean;
      interimId: number | null;
      interimAuthored: boolean;
    }
  | { detached: false; reason: string };

export type DetachedWorkerInput = {
  operation: DetachedOperationRecord;
  request: Record<string, unknown>;
  purpose: string;
  evidenceNeed: string;
  nowMs: number;
};

export type DetachedWorkerResult =
  | { ok: true; payload: unknown }
  | { ok: false; errorCode: string };

export type DetachedWorker = (input: DetachedWorkerInput) => Promise<DetachedWorkerResult>;

export type DispatchDetachedResult =
  | { ok: true; operation: DetachedOperationRecord }
  | { ok: false; reason: string; operation?: DetachedOperationRecord };

function detachableRequest(request: unknown): request is Record<string, unknown> {
  if (typeof request !== "object" || request === null || Array.isArray(request)) return false;
  const projectId = (request as Record<string, unknown>).projectId;
  return typeof projectId === "string" && projectId.length > 0;
}

/**
 * Durably admit a Thought-authored project.investigate as a detached
 * operation and authorize its interim hold speech.
 *
 * Durable ordering: admission first, interim ownership second. A failed
 * admission authorizes nothing; a failed interim authorization still leaves
 * a truthfully admitted operation (delivery failure never cancels work).
 * Only project.investigate detaches; every other kind falls through so the
 * caller keeps today's synchronous execution.
 */
export function detachInvestigateIntent(
  sidecar: DatabaseSync,
  input: DetachInvestigateInput,
): DetachInvestigateResult {
  const nowMs = input.nowMs ?? Date.now();
  if (input.intent.operationKind !== "project.investigate") {
    return { detached: false, reason: "not_detachable_kind" };
  }
  if (
    typeof input.cycleId !== "string"
    || input.cycleId.length === 0
    || !Number.isSafeInteger(input.generation)
    || typeof input.conversationId !== "string"
    || input.conversationId.length === 0
    || typeof input.originOwnerEventId !== "string"
    || input.originOwnerEventId.length === 0
    || typeof input.ownerId !== "string"
    || input.ownerId.length === 0
    || !detachableRequest(input.intent.request)
    || typeof input.intent.purpose !== "string"
    || input.intent.purpose.length === 0
    || typeof input.intent.evidenceNeed !== "string"
    || input.intent.evidenceNeed.length === 0
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
  ) {
    return { detached: false, reason: "invalid_detach_request" };
  }

  const admitted = admitDetachedOperation(sidecar, {
    idempotencyKey: `detached:${input.conversationId}:${input.cycleId}:project.investigate`,
    conversationId: input.conversationId,
    originCycleId: input.cycleId,
    originGeneration: input.generation,
    originOwnerEventId: input.originOwnerEventId,
    originEvidenceRowId: input.originEvidenceRowId,
    operationKind: "project.investigate",
    request: input.intent.request,
    purpose: input.intent.purpose,
    evidenceNeed: input.intent.evidenceNeed,
    operationDeadlineAtMs: nowMs + DETACHED_OPERATION_DEFAULT_DEADLINE_MS,
    nowMs,
  });
  if (!admitted.ok) return { detached: false, reason: admitted.reason };

  const interim = input.intent.interimSpeech;
  if (interim?.mode !== "hold") {
    return {
      detached: true,
      operation: admitted.operation,
      created: admitted.created,
      interimId: null,
      interimAuthored: false,
    };
  }
  const deliveryIntent: DeliveryIntent = {
    ownerId: input.ownerId,
    channel: "discord",
    threadId: input.conversationId,
    conversationId: input.conversationId,
    trigger: "owner_message_reactive",
    deliveryLane: "reactive",
    purpose: "licensed_speech",
  };
  const authorized = authorizeInterimSpeech(sidecar, {
    operationId: admitted.operation.operationId,
    surfaceDraft: interim.surfaceDraft,
    presentationDirectives: interim.presentationDirectives,
    deliveryIntent,
    origin: "live",
    nowMs,
  });
  if (!authorized.ok) {
    // Admission stands; the operation proceeds without interim speech and
    // completion still wakes Ashley with the truth.
    return {
      detached: true,
      operation: admitted.operation,
      created: admitted.created,
      interimId: null,
      interimAuthored: false,
    };
  }
  return {
    detached: true,
    operation: admitted.operation,
    created: admitted.created,
    interimId: authorized.interim.interimId,
    interimAuthored: true,
  };
}

function workerObservationId(operationId: string): string {
  return `v021:observation:detached:${operationId}`;
}

/**
 * Execute one admitted detached operation to terminal truth. Exactly-once
 * via the admitted→started CAS: a duplicate dispatch observes the lost CAS
 * and never reruns the worker. Worker failure is terminal failed; a thrown
 * (ambiguous, may-have-executed) dispatch is terminal outcome_unknown, never
 * a blind rerun. Total: never throws.
 *
 * Terminal truth is persisted first; the completion opportunity for Thought B
 * is produced by the completion owner from that truth (Wave 3 seam).
 */
export async function dispatchDetachedOperation(
  sidecar: DatabaseSync,
  operationId: string,
  worker: DetachedWorker,
  options: { nowMs?: number } = {},
): Promise<DispatchDetachedResult> {
  try {
    const nowMs = options.nowMs ?? Date.now();
    const operation = getDetachedOperation(sidecar, operationId);
    if (!operation) return { ok: false, reason: "detached_operation_missing" };
    let request: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(operation.requestJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: "detached_operation_request_invalid", operation };
      }
      request = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "detached_operation_request_invalid", operation };
    }

    const started = markDetachedOperationStarted(sidecar, operationId, {
      startProofRef: `worker-dispatch:${operationId}:${nowMs}`,
      workerBinding: { kind: "project.investigate", dispatchedAtMs: nowMs },
      nowMs,
    });
    if (!started.ok) return { ok: false, reason: started.reason, operation };

    let result: DetachedWorkerResult;
    try {
      result = await worker({
        operation: started.operation,
        request,
        purpose: started.operation.purpose,
        evidenceNeed: started.operation.evidenceNeed,
        nowMs,
      });
    } catch {
      const terminal = setDetachedOperationTerminal(sidecar, operationId, {
        terminalState: "outcome_unknown",
        errorCode: "worker_dispatch_failed",
        nowMs: Date.now(),
      });
      return terminal.ok
        ? { ok: true, operation: terminal.operation }
        : { ok: false, reason: terminal.reason, operation: started.operation };
    }

    if (!result.ok) {
      const terminal = setDetachedOperationTerminal(sidecar, operationId, {
        terminalState: "failed",
        errorCode: result.errorCode,
        nowMs: Date.now(),
      });
      return terminal.ok
        ? { ok: true, operation: terminal.operation }
        : { ok: false, reason: terminal.reason, operation: started.operation };
    }

    let observationRef: string | null = null;
    try {
      const observation: Observation = {
        observationId: workerObservationId(operationId),
        cycleId: started.operation.originCycleId,
        generation: started.operation.originGeneration,
        derived: false,
        replaySafe: true,
        modality: "tool",
        payload: result.payload,
        provenance: "opencode-worker:project.investigate",
        dataClassification: "never_public",
        secretOmitted: true,
      };
      persistOrVerifyObservation(sidecar, observation, Date.now());
      observationRef = observation.observationId;
    } catch {
      // Execution truth stands; only the evidence attachment failed.
      observationRef = null;
    }
    const terminal = setDetachedOperationTerminal(sidecar, operationId, {
      terminalState: "succeeded",
      observationRef,
      nowMs: Date.now(),
    });
    return terminal.ok
      ? { ok: true, operation: terminal.operation }
      : { ok: false, reason: terminal.reason, operation: started.operation };
  } catch {
    return { ok: false, reason: "detached_dispatch_failed" };
  }
}
