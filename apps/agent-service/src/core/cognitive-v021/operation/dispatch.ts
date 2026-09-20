import type { DatabaseSync } from "node:sqlite";
import { persistOrVerifyObservation } from "../observation/persistence.js";
import type {
  Observation,
  ObservationIntentSemanticOutput,
} from "../types.js";
import {
  admitDetachedOperation,
  detachedOperationIdFor,
  getDetachedOperation,
  markDetachedOperationStarted,
  markDetachedOperationWaiting,
  reconcileDetachedOperations,
  requestDetachedOperationCancel,
  resolveDetachedOperationCancel,
  setDetachedOperationTerminal,
  type DetachedOperationRecord,
} from "./detached.js";
import { produceOperationCompletion } from "./completion.js";
import { authorizeUndertakingAcknowledgement } from "./interim.js";
import { workerProjectInspectionRequest } from "./project-inspection-route.js";
import {
  bindWorkerUndertakingToOperation,
  detachedIdempotencyKeyForWorkerUndertaking,
  enqueueWorkerUndertaking,
  expireQueuedCuriosity,
  getWorkerExecutionSlot,
  getWorkerUndertaking,
  listDispatchingWorkerUndertakings,
  markWorkerUndertakingCapacity,
  markWorkerUndertakingRunning,
  markWorkerUndertakingWorkerBusy,
  projectWorkerUndertakingTerminal,
  requeueWorkerUndertakingAfterCapacity,
  repairWorkerExecutionSlot,
  recoverExpiredDispatchClaims,
  releaseWorkerExecutionSlot,
  selectNextWorkerUndertaking,
  listWorkerUndertakings,
  supersedeWorkerUndertaking,
  type EnqueueWorkerUndertakingInput,
  type WorkerUndertakingRecord,
} from "./worker-queue.js";
import {
  DETACHED_WORKER_MAX_WALL_CLOCK_MS,
  WORKER_FINALIZATION_RESERVE_MS,
  OPENCODE_MODEL_TURN_MAX_MS,
} from "../../sandbox/opencode/catalog.js";

export {
  DETACHED_WORKER_MAX_WALL_CLOCK_MS,
  WORKER_FINALIZATION_RESERVE_MS,
  OPENCODE_MODEL_TURN_MAX_MS,
};

/** Own bounded wall-clock for a detached operation: outside any Thought budget. (1 hour default) */
export const DETACHED_OPERATION_DEFAULT_DEADLINE_MS = DETACHED_WORKER_MAX_WALL_CLOCK_MS;

export type EnqueueWorkerUndertakingIntentInput = EnqueueWorkerUndertakingInput & {
  intent: ObservationIntentSemanticOutput;
  ownerId: string;
};

export type EnqueueWorkerUndertakingResult =
  | {
      queued: true;
      undertaking: WorkerUndertakingRecord;
      created: boolean;
      acknowledgementId: number | null;
      acknowledgementAuthored: boolean;
    }
  | { queued: false; reason: string };

/**
 * Admit semantic project inspection into the global worker queue. Queue
 * admission is intentionally separate from detached execution admission:
 * there is no execution deadline, worker binding, or operation identity
 * until the scheduler owns the global worker slot.
 */
export function enqueueWorkerUndertakingIntent(
  sidecar: DatabaseSync,
  input: EnqueueWorkerUndertakingIntentInput,
): EnqueueWorkerUndertakingResult {
  if (input.intent.operationKind !== "project.inspect") {
    return { queued: false, reason: "not_queueable_kind" };
  }
  const admitted = enqueueWorkerUndertaking(sidecar, {
    semanticKind: "project.inspect",
    origin: input.origin,
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    originCycleId: input.originCycleId,
    originGeneration: input.originGeneration,
    request: input.intent.request,
    purpose: input.intent.purpose,
    evidenceNeed: input.intent.evidenceNeed,
    nowMs: input.nowMs,
  });
  if (!admitted.ok) return { queued: false, reason: admitted.reason };

  const interimSpeech = input.intent.interimSpeech;
  const conversationId = input.conversationId;
  const ownerAcknowledgement = input.origin.kind === "OWNER_REQUEST"
    && interimSpeech?.mode === "hold"
    && conversationId != null
    && conversationId.length > 0;
  if (!ownerAcknowledgement) {
    return {
      queued: true,
      undertaking: admitted.undertaking,
      created: admitted.created,
      acknowledgementId: null,
      acknowledgementAuthored: false,
    };
  }
  const authorized = authorizeUndertakingAcknowledgement(sidecar, {
    undertakingId: admitted.undertaking.undertakingId,
    conversationId,
    cycleId: input.originCycleId,
    generation: input.originGeneration,
    surfaceDraft: interimSpeech.surfaceDraft,
    presentationDirectives: interimSpeech.presentationDirectives,
    deliveryIntent: {
      ownerId: input.ownerId,
      channel: "discord",
      threadId: conversationId,
      conversationId,
      trigger: "owner_message_reactive",
      deliveryLane: "reactive",
      purpose: "licensed_speech",
    },
    nowMs: input.nowMs,
  });
  if (!authorized.ok) {
    return {
      queued: true,
      undertaking: admitted.undertaking,
      created: admitted.created,
      acknowledgementId: null,
      acknowledgementAuthored: false,
    };
  }
  return {
    queued: true,
    undertaking: getWorkerUndertaking(sidecar, admitted.undertaking.undertakingId) ?? admitted.undertaking,
    created: admitted.created,
    acknowledgementId: authorized.interim.interimId,
    acknowledgementAuthored: true,
  };
}

export type DetachedWorkerInput = {
  operation: DetachedOperationRecord;
  request: Record<string, unknown>;
  purpose: string;
  evidenceNeed: string;
  nowMs: number;
};

export type DetachedWorkerResult =
  | { ok: true; payload: unknown }
  | { ok: false; errorCode: string; failureEvidence?: unknown };

/**
 * Canonical durable worker-failure diagnostic. Only these scalar fields are
 * representable; everything else (headers, keys, bodies, environment) is
 * structurally unpersistable.
 */
export type WorkerFailureEvidenceRecord = {
  failureClass: string;
  statusCode: number | null;
  errorType: string | null;
  message: string | null;
  processExit: number | null;
  modelId: string | null;
  openCodeVersion: string | null;
};

const FAILURE_EVIDENCE_MESSAGE_MAX = 300;

function evidenceString(value: unknown, max = FAILURE_EVIDENCE_MESSAGE_MAX): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim().slice(0, max);
}

function evidenceInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * Sanitize arbitrary worker-supplied failure evidence into the durable
 * allowlist shape. Accepts both the Mode-B `failureEvidence` vocabulary
 * (errorClass/exitStatus) and the canonical vocabulary. Returns a
 * JSON string ready for `failure_evidence_json`, or null when nothing
 * sanitizable was provided. Never throws.
 */
export function toSanitizedFailureEvidenceJson(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const failureClass = evidenceString(row.failureClass ?? row.errorClass, 128);
  if (!failureClass) return null;
  const record: WorkerFailureEvidenceRecord = {
    failureClass,
    statusCode: evidenceInt(row.statusCode),
    errorType: evidenceString(row.errorType, 128),
    message: evidenceString(row.message),
    processExit: evidenceInt(row.processExit ?? row.exitStatus),
    modelId: evidenceString(row.modelId, 256),
    openCodeVersion: evidenceString(row.openCodeVersion, 64),
  };
  try {
    const json = JSON.stringify(record);
    JSON.parse(json);
    return json;
  } catch {
    return null;
  }
}

export type DetachedWorker = (input: DetachedWorkerInput) => Promise<DetachedWorkerResult>;

export type DispatchDetachedResult =
  | { ok: true; operation: DetachedOperationRecord }
  | { ok: false; reason: string; operation?: DetachedOperationRecord };

export type DetachedCapacityDecision =
  | { available: true; workerBinding?: Record<string, unknown> }
  | {
      available: false;
      reason: string;
      nextProbeAtMs?: number | null;
      terminal?: boolean;
    };

export type DetachedCapacityProbe = (
  operation: DetachedOperationRecord,
) => DetachedCapacityDecision | Promise<DetachedCapacityDecision>;

export type DispatchDetachedOptions = {
  nowMs?: number;
  beforeStart?: DetachedCapacityProbe;
  onCapacityWait?: (
    operation: DetachedOperationRecord,
    decision: Extract<DetachedCapacityDecision, { available: false }>,
  ) => void | Promise<void>;
  onStarted?: (operation: DetachedOperationRecord) => void | Promise<void>;
  onTerminal?: (operation: DetachedOperationRecord) => void | Promise<void>;
};

function workerObservationId(operationId: string): string {
  return `v021:observation:detached:${operationId}`;
}

function workerRequestForInspection(request: Record<string, unknown>): Record<string, unknown> {
  // Route-neutral project.inspect history is translated at the Host seam.
  // Historical project.investigate requests are normalized to the same
  // bounded Mode-B shape without exposing that translation to Thought.
  return workerProjectInspectionRequest(request) ?? request;
}

/**
 * Best-effort completion production after terminal truth lands. A completion
 * failure never un-terminates the operation: crash reconciliation backfills
 * the missing event from the same terminal truth.
 */
function completeAfterTerminal(
  sidecar: DatabaseSync,
  operationId: string,
  terminal: DetachedOperationRecord,
): DetachedOperationRecord {
  try {
    produceOperationCompletion(sidecar, operationId);
  } catch {
    // Reconciliation backfills; terminal truth already stands.
  }
  return getDetachedOperation(sidecar, operationId) ?? terminal;
}

/**
 * Execute one admitted detached operation to terminal truth. Exactly-once
 * via the admitted→started CAS: a duplicate dispatch observes the lost CAS
 * and never reruns the worker. Worker failure is terminal failed; a thrown
 * (ambiguous, may-have-executed) dispatch is terminal outcome_unknown, never
 * a blind rerun. Total: never throws.
 *
 * Terminal truth is persisted first; the completion opportunity for Thought B
 * is produced from that truth immediately after, with reconciliation as the
 * crash backfill (a completion failure never un-terminates the operation).
 */
export async function dispatchDetachedOperation(
  sidecar: DatabaseSync,
  operationId: string,
  worker: DetachedWorker,
  options: DispatchDetachedOptions = {},
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

    const finishTerminal = async (terminal: DetachedOperationRecord): Promise<DetachedOperationRecord> => {
      const completed = completeAfterTerminal(sidecar, operationId, terminal);
      try { await options.onTerminal?.(completed); } catch { /* terminal truth already stands */ }
      return getDetachedOperation(sidecar, operationId) ?? completed;
    };

    if (operation.cancelRequestedAtMs != null && operation.state !== "started") {
      const cancelled = resolveDetachedOperationCancel(sidecar, operationId, {
        cancelledBy: "capacity-servicer",
        nowMs,
      });
      if (!cancelled.ok) return { ok: false, reason: cancelled.reason, operation };
      return { ok: true, operation: await finishTerminal(cancelled.operation) };
    }

    if (options.beforeStart) {
      let decision: DetachedCapacityDecision;
      try {
        decision = await options.beforeStart(operation);
      } catch {
        decision = { available: false, reason: "worker_capacity_probe_failed" };
      }
      if (!decision.available) {
        if (decision.terminal) {
          const terminal = setDetachedOperationTerminal(sidecar, operationId, {
            terminalState: "failed",
            errorCode: decision.reason,
            nowMs,
          });
          if (!terminal.ok) return { ok: false, reason: terminal.reason, operation };
          return { ok: true, operation: await finishTerminal(terminal.operation) };
        }
        const waiting = markDetachedOperationWaiting(sidecar, operationId, {
          reason: decision.reason,
          nextProbeAtMs: decision.nextProbeAtMs,
          nowMs,
        });
        if (!waiting.ok) return { ok: false, reason: waiting.reason, operation };
        if (options.onCapacityWait) {
          try { await options.onCapacityWait(waiting.operation, decision); } catch { /* queue reconciliation retries */ }
        }
        return { ok: true, operation: getDetachedOperation(sidecar, operationId) ?? waiting.operation };
      }
    }

    const started = markDetachedOperationStarted(sidecar, operationId, {
      startProofRef: `worker-dispatch:${operationId}:${nowMs}`,
      workerBinding: { kind: "project.investigate", dispatchedAtMs: nowMs },
      executionDeadlineAtMs: nowMs + DETACHED_OPERATION_DEFAULT_DEADLINE_MS,
      nowMs,
    });
    if (!started.ok) return { ok: false, reason: started.reason, operation };
    try { await options.onStarted?.(started.operation); } catch { /* started truth already stands */ }

    let result: DetachedWorkerResult;
    try {
      result = await worker({
        operation: started.operation,
        request: workerRequestForInspection(request),
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
      if (!terminal.ok) return { ok: false, reason: terminal.reason, operation: started.operation };
      return { ok: true, operation: await finishTerminal(terminal.operation) };
    }

    if (!result.ok) {
      const terminal = setDetachedOperationTerminal(sidecar, operationId, {
        terminalState: "failed",
        errorCode: result.errorCode,
        failureEvidenceJson: toSanitizedFailureEvidenceJson(result.failureEvidence),
        nowMs: Date.now(),
      });
      if (!terminal.ok) return { ok: false, reason: terminal.reason, operation: started.operation };
      return { ok: true, operation: await finishTerminal(terminal.operation) };
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
    if (!terminal.ok) return { ok: false, reason: terminal.reason, operation: started.operation };
    return { ok: true, operation: await finishTerminal(terminal.operation) };
  } catch {
    return { ok: false, reason: "detached_dispatch_failed" };
  }
}

export type WorkerUndertakingServiceOptions = {
  nowMs?: number;
  limit?: number;
  worker: DetachedWorker;
  capacityProbe: () => DetachedCapacityDecision | Promise<DetachedCapacityDecision>;
  commitmentCurrent?: (undertaking: WorkerUndertakingRecord) => boolean | Promise<boolean>;
};

export type WorkerUndertakingServiceResult = {
  serviced: string[];
  failures: string[];
  expired: string[];
  selectedClass: string | null;
};

function queueRequest(undertaking: WorkerUndertakingRecord): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(undertaking.requestJson);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function detachedCapacityProbeForQueue(
  probe: WorkerUndertakingServiceOptions["capacityProbe"],
): DetachedCapacityProbe {
  return () => probe();
}

function expirePreStartCuriosity(
  sidecar: DatabaseSync,
  nowMs: number,
): string[] {
  const expired: string[] = [];
  for (const undertaking of listWorkerUndertakings(sidecar, { limit: 100 })) {
    if (undertaking.originKind !== "ASHLEY_CURIOSITY"
      || (undertaking.state !== "queued" && undertaking.state !== "dispatching")
      || undertaking.curiosityExpiresAtMs == null
      || undertaking.curiosityExpiresAtMs > nowMs) continue;
    const operation = undertaking.selectedOperationId
      ? getDetachedOperation(sidecar, undertaking.selectedOperationId)
      : null;
    if (operation?.state === "started") {
      markWorkerUndertakingRunning(sidecar, undertaking.undertakingId, operation.operationId, nowMs);
      continue;
    }
    if (operation && !operation.terminalState) {
      requestDetachedOperationCancel(sidecar, operation.operationId, nowMs);
      resolveDetachedOperationCancel(sidecar, operation.operationId, {
        cancelledBy: "curiosity-ttl",
        nowMs,
      });
    }
    const projected = projectWorkerUndertakingTerminal(
      sidecar,
      undertaking.undertakingId,
      "expired",
      "curiosity_ttl_expired",
      nowMs,
    );
    if (projected?.state === "expired") expired.push(undertaking.undertakingId);
  }
  return expired;
}

async function dispatchBoundWorkerUndertaking(
  sidecar: DatabaseSync,
  undertaking: WorkerUndertakingRecord,
  worker: DetachedWorker,
  capacityProbe: WorkerUndertakingServiceOptions["capacityProbe"],
  nowMs: number,
): Promise<{ ok: boolean; operationId: string }> {
  const operationId = undertaking.selectedOperationId;
  if (!operationId) return { ok: false, operationId: "" };
  if (undertaking.cancelRequestedAtMs != null) {
    requestDetachedOperationCancel(sidecar, operationId, nowMs);
  }
  const result = await dispatchDetachedOperation(sidecar, operationId, worker, {
    nowMs,
    beforeStart: detachedCapacityProbeForQueue(capacityProbe),
    onCapacityWait: (operation, decision) => {
      requeueWorkerUndertakingAfterCapacity(sidecar, undertaking.undertakingId, {
        reason: decision.reason,
        nextProbeAtMs: decision.nextProbeAtMs,
        nowMs,
      });
      // The queue remains the scheduling owner. The detached row only records
      // the temporary already-bound handoff race.
      void operation;
    },
    onStarted: (started) => {
      markWorkerUndertakingRunning(sidecar, undertaking.undertakingId, started.operationId, Date.now());
    },
    onTerminal: (terminal) => {
      projectWorkerUndertakingTerminal(
        sidecar,
        undertaking.undertakingId,
        terminal.terminalState ?? "outcome_unknown",
        terminal.errorCode,
        Date.now(),
      );
    },
  });
  if (!result.ok) return { ok: false, operationId };
  return { ok: true, operationId };
}

/**
 * Service the global queue from the existing startup/reconciliation host.
 * This is the only production scheduler. Detached rows are serviced only
 * through their queue binding; arbitrary detached-row scans are prohibited.
 */
const workerServiceFlights = new WeakMap<DatabaseSync, Promise<WorkerUndertakingServiceResult>>();

async function serviceWorkerUndertakingsOnce(
  sidecar: DatabaseSync,
  options: WorkerUndertakingServiceOptions,
): Promise<WorkerUndertakingServiceResult> {
  const nowMs = options.nowMs ?? Date.now();
  const requestedLimit = options.limit ?? 1;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(50, requestedLimit))
    : 1;
  const serviced: string[] = [];
  const failures: string[] = [];
  repairWorkerExecutionSlot(sidecar, nowMs);
  const expired = [
    ...expirePreStartCuriosity(sidecar, nowMs),
    ...expireQueuedCuriosity(sidecar, nowMs),
  ].filter((undertakingId, index, ids) => ids.indexOf(undertakingId) === index);
  recoverExpiredDispatchClaims(sidecar, nowMs);
  reconcileDetachedOperations(sidecar, nowMs);
  repairWorkerExecutionSlot(sidecar, nowMs);

  // First converge a bound undertaking after a crash or a terminal detached
  // operation. This preserves one undertaking -> at most one operation.
  const dispatching = listDispatchingWorkerUndertakings(sidecar, limit);
  for (const undertaking of dispatching) {
    const operationId = undertaking.selectedOperationId;
    if (!operationId) continue;
    const operation = getDetachedOperation(sidecar, operationId);
    if (!operation) continue;
    const currentUndertaking = getWorkerUndertaking(sidecar, undertaking.undertakingId) ?? undertaking;
    if (currentUndertaking.cancelRequestedAtMs != null && !operation.terminalState) {
      requestDetachedOperationCancel(sidecar, operationId, nowMs);
    }
    if (operation.terminalState) {
      try { produceOperationCompletion(sidecar, operationId); } catch { /* startup backfill retries */ }
      projectWorkerUndertakingTerminal(
        sidecar,
        undertaking.undertakingId,
        operation.terminalState,
        operation.errorCode,
        nowMs,
      );
      serviced.push(undertaking.undertakingId);
      continue;
    }
    if (operation.state === "started") {
      markWorkerUndertakingRunning(sidecar, undertaking.undertakingId, operationId, nowMs);
      continue;
    }
    if (
      operation.state === "admitted"
      || (operation.state === "waiting_capacity"
        && (operation.capacityWaitNextProbeAtMs == null || operation.capacityWaitNextProbeAtMs <= nowMs))
    ) {
      try {
        const result = await dispatchBoundWorkerUndertaking(
          sidecar,
          getWorkerUndertaking(sidecar, undertaking.undertakingId) ?? undertaking,
          options.worker,
          options.capacityProbe,
          nowMs,
        );
        if (result.ok) serviced.push(undertaking.undertakingId);
        else failures.push(undertaking.undertakingId);
      } catch {
        failures.push(undertaking.undertakingId);
      }
    }
    // One active global slot means no new selection can happen here.
    return { serviced, failures, expired, selectedClass: null };
  }

  const slot = getWorkerExecutionSlot(sidecar);
  if (slot.undertakingId) {
    sidecar.prepare(
      `UPDATE worker_undertakings SET blocked_reason = 'worker_busy', updated_at_ms = ?
        WHERE state = 'queued' AND undertaking_id <> ?
          AND (blocked_reason IS NULL OR blocked_reason = 'worker_busy')`,
    ).run(nowMs, slot.undertakingId);
    return { serviced, failures, expired, selectedClass: null };
  }

  const selection = selectNextWorkerUndertaking(sidecar, nowMs);
  if (!selection) return { serviced, failures, expired, selectedClass: null };
  const undertaking = selection.undertaking;
  let decision: DetachedCapacityDecision;
  try {
    decision = await options.capacityProbe();
  } catch {
    decision = { available: false, reason: "worker_capacity_probe_failed" };
  }
  if (!decision.available) {
    if (decision.terminal) {
      projectWorkerUndertakingTerminal(sidecar, undertaking.undertakingId, "failed", decision.reason, nowMs);
      failures.push(undertaking.undertakingId);
    } else {
      markWorkerUndertakingCapacity(sidecar, undertaking.undertakingId, {
        reason: decision.reason,
        nextProbeAtMs: decision.nextProbeAtMs,
        nowMs,
      });
    }
    return {
      serviced,
      failures,
      expired,
      selectedClass: selection.selectedClass,
    };
  }

  if (undertaking.originKind === "ASHLEY_COMMITMENT" && options.commitmentCurrent) {
    let current = false;
    try {
      current = await options.commitmentCurrent(undertaking);
    } catch {
      current = false;
    }
    if (!current) {
      const superseded = supersedeWorkerUndertaking(sidecar, undertaking.undertakingId, {
        supersededBy: `commitment_currentness:${undertaking.originRef}`,
        nowMs,
      });
      if (superseded.ok) serviced.push(undertaking.undertakingId);
      else failures.push(undertaking.undertakingId);
      return { serviced, failures, expired, selectedClass: selection.selectedClass };
    }
  }

  const request = queueRequest(undertaking);
  const conversationId = undertaking.conversationId;
  if (!request || !conversationId) {
    projectWorkerUndertakingTerminal(sidecar, undertaking.undertakingId, "failed", "invalid_queue_request", nowMs);
    failures.push(undertaking.undertakingId);
    return { serviced, failures, expired, selectedClass: selection.selectedClass };
  }
  const idempotencyKey = detachedIdempotencyKeyForWorkerUndertaking(undertaking.undertakingId);
  const operationId = detachedOperationIdFor(idempotencyKey);
  const binding = bindWorkerUndertakingToOperation(sidecar, {
    undertakingId: undertaking.undertakingId,
    operationId,
    calendarIndex: selection.calendarIndex,
    nowMs,
    admitOperation: () => {
      const admitted = admitDetachedOperation(sidecar, {
        idempotencyKey,
        conversationId,
        originCycleId: undertaking.originCycleId,
        originGeneration: undertaking.originGeneration,
        originKind: undertaking.originKind,
        originRef: undertaking.originRef,
        originOwnerEventId: undertaking.originOwnerEventId,
        originEvidenceRowId: undertaking.originEvidenceRowId,
        workerUndertakingId: undertaking.undertakingId,
        operationKind: "project.investigate",
        request,
        purpose: undertaking.purpose,
        evidenceNeed: undertaking.evidenceNeed,
        operationDeadlineAtMs: nowMs + DETACHED_OPERATION_DEFAULT_DEADLINE_MS,
        nowMs,
      });
      return admitted.ok
        ? { ok: true as const, operationId: admitted.operation.operationId, created: admitted.created }
        : { ok: false as const, reason: admitted.reason };
    },
  });
  if (!binding.ok) {
    if (binding.reason === "worker_busy") {
      markWorkerUndertakingWorkerBusy(sidecar, undertaking.undertakingId, nowMs);
    } else if (binding.reason !== "undertaking_not_queued") {
      failures.push(undertaking.undertakingId);
    }
    return { serviced, failures, expired, selectedClass: selection.selectedClass };
  }
  try {
    const dispatched = await dispatchBoundWorkerUndertaking(
      sidecar,
      binding.undertaking,
      options.worker,
      options.capacityProbe,
      nowMs,
    );
    if (dispatched.ok) serviced.push(undertaking.undertakingId);
    else failures.push(undertaking.undertakingId);
  } catch {
    failures.push(undertaking.undertakingId);
  }
  return { serviced, failures, expired, selectedClass: selection.selectedClass };
}

export function serviceWorkerUndertakings(
  sidecar: DatabaseSync,
  options: WorkerUndertakingServiceOptions,
): Promise<WorkerUndertakingServiceResult> {
  const active = workerServiceFlights.get(sidecar);
  if (active) return active;
  const flight = serviceWorkerUndertakingsOnce(sidecar, options);
  workerServiceFlights.set(sidecar, flight);
  void flight.then(
    () => { if (workerServiceFlights.get(sidecar) === flight) workerServiceFlights.delete(sidecar); },
    () => { if (workerServiceFlights.get(sidecar) === flight) workerServiceFlights.delete(sidecar); },
  );
  return flight;
}
