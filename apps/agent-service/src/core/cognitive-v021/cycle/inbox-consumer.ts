import type { DatabaseSync } from "node:sqlite";
import {
  claimInboxEvent,
  getInboxEvent,
} from "./inbox.js";
import {
  getOpenDurableAttempt,
  settleDurableAttempt,
  type DurableSettlementOutcome,
} from "../retry/ledger.js";
import {
  reconcileStrandedOutcomeUnknownAtStartup,
  type OutcomeUnknownScanCursor,
} from "../retry/startup-outcome-recovery.js";
import {
  getPrivateReservation,
  getPrivateReservationForWake,
} from "../private-budget/ledger.js";
import {
  explicitEventReservationId,
  isPeriodicRecoveryDispatchBlocked,
  PERIODIC_RECOVERY_DEFER_MS,
  PERIODIC_RECOVERY_DISPATCH_BLOCKED,
} from "../dispatch/live.js";
import type { CognitiveDispatchResult, HandlerResult, InboxEvent, KernelRunResult, PrivateBudgetReservation } from "../types.js";
import { captureOwnerDispatchCoverage } from "./owner-coverage.js";
import { isOwnerObligationEventKind } from "../owner-obligation.js";

/**
 * P0 steady-state reconciliation bounds (R7 §22.2, frozen). The opportunity
 * bound is on invocation gap, not on traffic shape: a reconciliation pass
 * must occur at least every 60,000 ms while agent-service is healthy/running,
 * independent of normal inbox traffic (continuous-consumed, idle, or a
 * legitimate long handler holding the loop).
 */
export const STEADY_STATE_RECONCILIATION_MAX_INVOCATION_GAP_MS = 60_000 as const;
/** Opportunistic floor preserving current idle behavior (idle/failed ticks). */
export const STEADY_STATE_RECONCILIATION_OPPORTUNISTIC_FLOOR_MS = 1_000 as const;
/** Bounded work per pass: <= the existing 500 clamp, small enough to never stall the loop. */
export const STEADY_STATE_RECONCILIATION_BATCH_LIMIT = 5 as const;

export type InboxConsumerHandlerResult = HandlerResult | CognitiveDispatchResult | undefined;

export type InboxConsumerHandler = (
  event: InboxEvent,
) => InboxConsumerHandlerResult | Promise<InboxConsumerHandlerResult>;

export function claimNextInboxEvent(
  db: DatabaseSync,
  input: { workerId: string; conversationId?: string; nowMs?: number; leaseMs?: number },
): InboxEvent | null {
  return claimInboxEvent(db, input);
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSuccessfulCognitiveDispatch(
  result: InboxConsumerHandlerResult,
  event: InboxEvent,
): boolean {
  if (result == null || "kind" in result || result.published !== true || result.acceptedSettlements <= 0) {
    return false;
  }
  const ownerResolution = result.ownerObligationResolution;
  if (!isOwnerObligationEventKind(event.kind)) {
    return ownerResolution?.ownerObligationOutcome !== "unresolved";
  }
  return ownerResolution?.attemptOutcome === "published"
    && (ownerResolution.ownerObligationOutcome === "resolved"
      || ownerResolution.ownerObligationOutcome === "transferred");
}

function toHandlerResult(result: InboxConsumerHandlerResult, event: InboxEvent): HandlerResult {
  if (result == null) {
    return {
      kind: "failed",
      failureClass: "unclassified_internal",
      errorCode: "cognitive_dispatch_result_missing",
      dispatchTruth: "not_started",
      retryAfterMs: 1_000,
    };
  }
  if ("kind" in result) {
    return result;
  }
  if (result.ownerSupersession) {
    return result.ownerSupersession;
  }
  if (result.deferred === true && typeof result.nextEligibleAtMs === "number") {
    return {
      kind: "deferred_to_frontier",
      conversationId: result.conversationId ?? event.conversationId,
      cycleId: result.cycleId ?? "",
      generation: result.generation ?? 1,
      nextEligibleAtMs: result.nextEligibleAtMs,
      latestEvidenceRowId: result.latestEvidenceRowId ?? event.id,
    };
  }
  if (result.publicationReason) {
    return {
      kind: "failed",
      errorCode: `publication_rejected:${result.publicationReason}`,
      failureClass: "transient_retryable",
      dispatchTruth: "provider_responded",
      retryAfterMs: 1_000,
    };
  }
  const ownerResolution = result.ownerObligationResolution;
  if (isOwnerObligationEventKind(event.kind) && !ownerResolution) {
    return {
      kind: "failed",
      failureClass: "transient_retryable",
      errorCode: "owner_obligation_resolution_missing",
      dispatchTruth: result.thoughtExecutionProvenance?.dispatchTruth === "not_sent"
        ? "not_started"
        : "provider_responded",
      retryAfterMs: 1_000,
    };
  }
  if (ownerResolution?.attemptOutcome === "abstained") {
    if (ownerResolution.ownerObligationOutcome === "not_applicable") {
      return {
        kind: "failed",
        failureClass: "stale_or_cancelled",
        errorCode: "stale",
        dispatchTruth: "provider_responded",
      };
    }
    return {
      kind: "failed",
      failureClass: "transient_retryable",
      errorCode: "owner_obligation_abstained",
      dispatchTruth: "provider_responded",
      retryAfterMs: 1_000,
    };
  }
  if (ownerResolution?.ownerObligationOutcome === "unresolved") {
    return {
      kind: "failed",
      failureClass: "transient_retryable",
      errorCode: ownerResolution.remainingResponsibility ?? "owner_obligation_unresolved",
      dispatchTruth: result.thoughtExecutionProvenance?.dispatchTruth === "not_sent"
        ? "not_started"
        : "provider_responded",
      retryAfterMs: 1_000,
    };
  }
  return { kind: "completed" };
}

function settledOutcomeOrThrow(
  db: DatabaseSync,
  event: InboxEvent,
  result: HandlerResult,
  nowMs: number,
  coveredSiblingEventIds: readonly string[] = [],
): DurableSettlementOutcome {
  const attempt = event.durableAttemptId
    ? getOpenDurableAttempt(db, event.id)
    : getOpenDurableAttempt(db, event.id);
  if (!attempt || (event.durableAttemptId && attempt.attemptId !== event.durableAttemptId)) {
    throw new Error("inbox_durable_attempt_missing");
  }
  return settleDurableAttempt(db, {
    eventId: event.id,
    attemptId: attempt.attemptId,
    claimToken: event.claimToken ?? attempt.claimToken,
    result,
    nowMs,
    coveredSiblingEventIds,
  });
}

/** Run a handler and settle the durable attempt. Exceptions are outcome-unknown. */
export async function consumeInboxEvent(
  db: DatabaseSync,
  event: InboxEvent,
  handler: InboxConsumerHandler,
  nowMs = Date.now(),
): Promise<DurableSettlementOutcome> {
  const attempt = getOpenDurableAttempt(db, event.id);
  if (!attempt || (event.durableAttemptId && attempt.attemptId !== event.durableAttemptId)) {
    throw new Error("inbox_durable_attempt_missing");
  }
  const dispatchCoverage = captureOwnerDispatchCoverage(db, event);
  try {
    const result = await handler({ ...event, dispatchCoverage });
    const settlementResult = toHandlerResult(result, event);
    return settledOutcomeOrThrow(
      db,
      event,
      settlementResult,
      nowMs,
      isSuccessfulCognitiveDispatch(result, event) ? dispatchCoverage.coveredOwnerEventIds : [],
    );
  } catch (error) {
    const currentAttempt = getOpenDurableAttempt(db, event.id);
    if (currentAttempt) {
      settleDurableAttempt(db, {
        eventId: event.id,
        attemptId: currentAttempt.attemptId,
        claimToken: event.claimToken ?? currentAttempt.claimToken,
        result: {
          kind: "outcome_unknown",
          operationId: event.id,
          errorCode: errorCode(error),
        },
        nowMs,
      });
    }
    throw error;
  }
}

export type InboxConsumerOptions = {
  workerId: string;
  handler: InboxConsumerHandler;
  conversationId?: string;
  nowMs?: () => number;
  leaseMs?: number;
  pollMs?: number;
  onError?: (error: unknown, event: InboxEvent | null) => void;
  /**
   * Host-composed maintenance after each bounded reconciliation opportunity.
   * The consumer owns no observability semantics; this callback is an
   * optional servicing seam for the existing reconciliation host.
   */
  onReconciliationMaintenance?: (nowMs: number) => void;
  /**
   * Test-only compression seam for the steady-state cadence. Production
   * always uses the frozen defaults above; tests override to prove the
   * mechanism without real 60 s waits, and pin the defaults separately.
   */
  reconciliationGapMs?: number;
  reconciliationOpportunisticFloorMs?: number;
  reconciliationBatchLimit?: number;
};

export type InboxConsumerTick = {
  outcome: "idle" | "consumed" | "failed";
  eventId?: string;
  error?: string;
};

/** Consumer-layer periodic fence input: periodic lineage + reservation state. */
function isPeriodicRecoveryDispatchBlockedForEvent(db: DatabaseSync, event: InboxEvent): boolean {
  let reservation: PrivateBudgetReservation | null = null;
  try {
    const explicitId = explicitEventReservationId(event.payload);
    reservation = explicitId
      ? getPrivateReservation(db, explicitId)
      : event.wakeId ? getPrivateReservationForWake(db, event.wakeId) : null;
  } catch {
    // Ambiguous/unresolvable reservation truth while disabled is itself a
    // reason to defer: the gate treats unprovable finish-right as blocked.
    // (When enabled the predicate below returns false regardless.)
    reservation = null;
  }
  return isPeriodicRecoveryDispatchBlocked(db, event, reservation);
}

/** Claim one fair eligible event and settle its durable attempt. */
export async function consumeNextInboxEvent(
  db: DatabaseSync,
  options: InboxConsumerOptions,
): Promise<InboxConsumerTick> {
  const nowMs = options.nowMs?.() ?? Date.now();
  const event = claimNextInboxEvent(db, {
    workerId: options.workerId,
    conversationId: options.conversationId,
    nowMs,
    leaseMs: options.leaseMs,
  });
  if (!event) return { outcome: "idle" };
  try {
    // P0 periodic recovery dispatch fence (consumer layer — retain/defer):
    // a recovered periodic lineage must not cross into NEW provider work
    // through the generic consumer while periodic cognition is disabled.
    // Settle retry_wait via existing truth (binding retained, never unbound,
    // never reselected, zero provider dispatch). The runLiveCognitiveTurn
    // gate remains the second layer for direct dispatches.
    if (isPeriodicRecoveryDispatchBlockedForEvent(db, event)) {
      const open = getOpenDurableAttempt(db, event.id);
      if (!open || (event.durableAttemptId && open.attemptId !== event.durableAttemptId)) {
        throw new Error("inbox_durable_attempt_missing");
      }
      settleDurableAttempt(db, {
        eventId: event.id,
        attemptId: open.attemptId,
        claimToken: event.claimToken ?? open.claimToken,
        result: {
          kind: "failed",
          failureClass: "transient_retryable",
          errorCode: PERIODIC_RECOVERY_DISPATCH_BLOCKED,
          dispatchTruth: "not_started",
          retryAfterMs: PERIODIC_RECOVERY_DEFER_MS,
        },
        nowMs,
      });
      return { outcome: "failed", eventId: event.id, error: PERIODIC_RECOVERY_DISPATCH_BLOCKED };
    }
    const settled = await consumeInboxEvent(db, event, options.handler, nowMs);
    if (settled.kind === "completed") return { outcome: "consumed", eventId: event.id };
    return { outcome: "failed", eventId: event.id, error: settled.kind === "terminal" ? settled.reason : settled.kind };
  } catch (error) {
    options.onError?.(error, getInboxEvent(db, event.id) ?? event);
    return {
      outcome: "failed",
      eventId: event.id,
      error: errorCode(error),
    };
  }
}

export type InboxConsumerHandle = {
  stop: () => void;
  done: Promise<void>;
};

/**
 * Start a bounded polling loop. Retry timing remains in the durable ledger.
 *
 * P0 steady-state reconciliation host (R7 §22.2): ownership of reconciliation
 * stays DURABLE_WORK / RETRY — this loop merely provides the servicing
 * opportunity, at least every STEADY_STATE_RECONCILIATION_MAX_INVOCATION_GAP_MS
 * while healthy/running, on the existing host (no new process, timer
 * subsystem, owner, or reconciliation model):
 * - time-based cadence after EVERY tick (consumed, idle, or failed — never
 *   outcome-based, so continuous traffic cannot postpone reconciliation);
 * - bounded batch + in-memory rotation cursor (proof-failed old rows cannot
 *   monopolize the scan);
 * - in-flight reconciliation deadline: while a handler promise is pending,
 *   the SAME timer/wake slots arm a one-shot deadline racing the handler, so
 *   a legitimate long Thought execution (up to THOUGHT_DEADLINE_MS) cannot
 *   postpone the opportunity past the bound. Single-handle invariant: the
 *   in-flight deadline XOR the idle-sleep delay is ever alive, never both.
 */
export function startInboxConsumer(
  db: DatabaseSync,
  options: InboxConsumerOptions,
): InboxConsumerHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  const delay = Math.max(1, Math.min(60_000, options.pollMs ?? 250));
  const nowFn = (): number => options.nowMs?.() ?? Date.now();
  const gapMs = options.reconciliationGapMs ?? STEADY_STATE_RECONCILIATION_MAX_INVOCATION_GAP_MS;
  const floorMs = options.reconciliationOpportunisticFloorMs ?? STEADY_STATE_RECONCILIATION_OPPORTUNISTIC_FLOOR_MS;
  const batchLimit = options.reconciliationBatchLimit ?? STEADY_STATE_RECONCILIATION_BATCH_LIMIT;
  let lastReconciliationAtMs = 0;
  let reconciliationCursor: OutcomeUnknownScanCursor = null;

  function runSteadyStateReconciliationPass(nowMs: number): void {
    try {
      const outcome = reconcileStrandedOutcomeUnknownAtStartup(db, {
        nowMs,
        limit: batchLimit,
        cursor: reconciliationCursor,
      });
      reconciliationCursor = outcome.nextCursor;
    } catch (error) {
      // Reconciliation truth failure must never fail the consumer loop or
      // cognition: report through the existing error seam and advance the
      // cadence clock (per-row fail-closed counting already happened inside
      // the entry for row-level faults).
      options.onError?.(error, null);
    } finally {
      try {
        options.onReconciliationMaintenance?.(nowMs);
      } catch (error) {
        // Maintenance failure must not change reconciliation or cognition
        // truth. Report it through the existing loop error seam only.
        try {
          options.onError?.(error, null);
        } catch {
          // Error reporting is best-effort and must not rethrow maintenance
          // failure into the consumer loop.
        }
      }
      lastReconciliationAtMs = nowMs;
    }
  }

  function maybeReconcilePostTick(tick: InboxConsumerTick): void {
    const nowMs = nowFn();
    const elapsed = nowMs - lastReconciliationAtMs;
    if (elapsed >= gapMs) {
      runSteadyStateReconciliationPass(nowMs);
    } else if (tick.outcome !== "consumed" && elapsed >= floorMs) {
      runSteadyStateReconciliationPass(nowMs);
    }
  }

  function awaitTickWithInflightDeadline(tickPromise: Promise<InboxConsumerTick>): Promise<InboxConsumerTick> {
    return new Promise<InboxConsumerTick>((resolve, reject) => {
      let finished = false;
      const settle = (fn: () => void): void => {
        if (finished) return;
        finished = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        fn();
      };
      void tickPromise.then(
        (tick) => settle(() => resolve(tick)),
        (error) => settle(() => reject(error)),
      );
      const armDeadline = (): void => {
        if (finished || stopped) return;
        const waitMs = lastReconciliationAtMs + gapMs - nowFn();
        if (waitMs <= 0) {
          runSteadyStateReconciliationPass(nowFn());
          armDeadline();
          return;
        }
        timer = setTimeout(() => {
          timer = null;
          if (finished || stopped) return;
          runSteadyStateReconciliationPass(nowFn());
          armDeadline();
        }, waitMs);
      };
      armDeadline();
    });
  }

  const done = (async () => {
    while (!stopped) {
      const tick = await awaitTickWithInflightDeadline(consumeNextInboxEvent(db, options));
      if (stopped) break;
      maybeReconcilePostTick(tick);
      if (tick.outcome !== "consumed") {
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(() => {
            timer = null;
            wake = null;
            resolve();
          }, delay);
        });
      }
    }
  })();
  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      wake?.();
      wake = null;
    },
    done,
  };
}
