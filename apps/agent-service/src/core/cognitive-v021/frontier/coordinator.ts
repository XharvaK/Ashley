import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { KernelDeps, OutboxDeliveryProjector } from "../types.js";
import { getCycle, resolveDurableContinuationOwner, updateCycleState } from "../cycle/inbox.js";
import { finishWakeInTransaction, getWake } from "../wake/ledger.js";
import { runLiveCognitiveTurn } from "../dispatch/live.js";
import type { InboxEvent } from "../types.js";
import {
  claimDueDeferredFrontier,
  exhaustDeferredFrontier,
  getNextDueFrontierDelayMs,
  listDueDeferredFrontiers,
  rescheduleDeferredFrontier,
  resolveDeferredFrontier,
} from "./ledger.js";
import { recordFrontierC3TerminalFailure } from "../failure/c3-recorder.js";
import {
  getPrivateReservationForWake,
  releasePrivateReservation,
} from "../private-budget/ledger.js";

export type FrontierCoordinatorOptions = {
  workerId?: string;
  pollMs?: number;
  projector?: OutboxDeliveryProjector;
  nowMs?: () => number;
};

export type FrontierCoordinatorHandle = {
  stop: () => void;
  pollNow: () => Promise<number>;
};

export function settleFrontierTerminalReservation(
  db: DatabaseSync,
  wakeId: string | undefined,
  conversationId: string,
  nowMs: number,
): void {
  if (!wakeId) return;
  try {
    const reservation = getPrivateReservationForWake(db, wakeId);
    if (!reservation) return;
    if (
      reservation.state === "held" &&
      reservation.dispatchTruth === "not_started" &&
      reservation.releaseProofRef != null
    ) {
      const owner = resolveDurableContinuationOwner(db, { wakeId, conversationId });
      if (owner.status === "proven_no_owner") {
        releasePrivateReservation(db, {
          reservationId: reservation.reservationId,
          proofRef: reservation.releaseProofRef,
          dispatchTruth: "not_started",
          invocationId: reservation.invocationId ?? undefined,
          attemptId: reservation.attemptId ?? undefined,
          nowMs,
        });
      }
    }
  } catch {
    // Fail safe; startup recovery or idle pass will reconcile if needed.
  }
}

export function startFrontierCoordinator(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  deps: KernelDeps,
  options: FrontierCoordinatorOptions = {},
): FrontierCoordinatorHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pollMs = Math.max(50, Math.min(60_000, options.pollMs ?? 500));
  const workerId = options.workerId ?? `frontier-coordinator:${randomUUID()}`;
  const getNowMs = options.nowMs ?? (() => Date.now());

  async function processDueFrontiers(): Promise<number> {
    const nowMs = getNowMs();
    const dueList = listDueDeferredFrontiers(sidecar, nowMs);
    let processed = 0;

    for (const due of dueList) {
      if (stopped) break;
      const claim = claimDueDeferredFrontier(sidecar, due.frontierId, workerId, 30_000, nowMs);
      if (!claim.claimed || !claim.frontier) continue;
      const claimedFrontier = claim.frontier;
      processed += 1;

      const cycle = getCycle(sidecar, claimedFrontier.cycleId);
      if (!cycle || cycle.state === "silent" || cycle.state === "idle" || cycle.state === "sending") {
        exhaustDeferredFrontier(sidecar, claimedFrontier.frontierId, nowMs);
        settleFrontierTerminalReservation(sidecar, cycle?.wakeId, claimedFrontier.conversationId, nowMs);
        continue;
      }

      const event: InboxEvent = {
        id: `frontier-wake:${claimedFrontier.frontierId}:${claimedFrontier.attemptCount}`,
        conversationId: claimedFrontier.conversationId,
        wakeId: cycle.wakeId,
        kind: "frontier_wake",
        payload: {
          cycleId: claimedFrontier.cycleId,
          evidenceRowId: claimedFrontier.latestEvidenceRowId,
          frontierId: claimedFrontier.frontierId,
        },
        createdAtMs: claimedFrontier.createdAtMs,
        status: "claimed",
        claimToken: claimedFrontier.claimToken!,
        workerId,
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        attemptCount: claimedFrontier.attemptCount,
        claimedAtMs: nowMs,
        consumedAtMs: null,
        lastError: null,
      };

      try {
        const result = await runLiveCognitiveTurn({
          sidecar,
          nuclear,
          deps,
          projector: options.projector,
          event,
        });
        if (result.published) {
          resolveDeferredFrontier(sidecar, claimedFrontier.frontierId, getNowMs());
        } else if (result.deferred && typeof result.nextEligibleAtMs === "number") {
          const resched = rescheduleDeferredFrontier(sidecar, claimedFrontier.frontierId, result.nextEligibleAtMs, getNowMs());
          if (resched.outcome === "exhausted") {
            updateCycleState(sidecar, claimedFrontier.cycleId, "silent", getNowMs());
            // Campaign-1 exhaustion terminalization: only the mechanically proven
            // capacity-deadline expiry path terminalizes the wake as expired.
            // Other exhaustion reasons (e.g. non_forward_scheduling_hint) keep
            // their existing truthful transition and must not invent expiry.
            if (resched.reason === "capacity_wait_max_duration_exceeded") {
              try {
                const cycle = getCycle(sidecar, claimedFrontier.cycleId);
                if (cycle?.wakeId) {
                  const wake = getWake(sidecar, cycle.wakeId);
                  if (wake && wake.state !== "terminal") {
                    finishWakeInTransaction(sidecar, cycle.wakeId, wake.leaseToken, "expired", getNowMs());
                  }
                }
              } catch {
                // Preserve frontier exhaustion + cycle silence. Terminal
                // immutability and lease laws win over expiry terminalization.
              }
              recordFrontierC3TerminalFailure(sidecar, {
                frontierId: claimedFrontier.frontierId,
                cycleId: claimedFrontier.cycleId,
                generation: claimedFrontier.generation,
                occurredAtMs: getNowMs(),
              });
            }
            settleFrontierTerminalReservation(sidecar, cycle?.wakeId, claimedFrontier.conversationId, getNowMs());
          }
        } else if (!result.deferred) {
          exhaustDeferredFrontier(sidecar, claimedFrontier.frontierId, getNowMs());
          settleFrontierTerminalReservation(sidecar, cycle?.wakeId, claimedFrontier.conversationId, getNowMs());
        }
      } catch {
        exhaustDeferredFrontier(sidecar, claimedFrontier.frontierId, getNowMs());
        settleFrontierTerminalReservation(sidecar, cycle?.wakeId, claimedFrontier.conversationId, getNowMs());
      }
    }
    return processed;
  }

  function scheduleNext() {
    if (stopped) return;
    const nowMs = getNowMs();
    const nextDelay = getNextDueFrontierDelayMs(sidecar, nowMs);
    const delay = nextDelay != null ? Math.min(nextDelay, pollMs) : pollMs;
    timer = setTimeout(async () => {
      timer = null;
      try {
        await processDueFrontiers();
      } finally {
        scheduleNext();
      }
    }, Math.max(25, delay));
  }

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    pollNow: processDueFrontiers,
  };
}
