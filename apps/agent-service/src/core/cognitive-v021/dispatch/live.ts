import type { DatabaseSync } from "node:sqlite";
import {
  type CycleRecord,
  type InboxEvent,
  type KernelDeps,
  type KernelRunResult,
  type OutboxDeliveryProjector,
  type PrivateBudgetReservation,
  type WakeRecord,
} from "../types.js";
import { runCognitiveCycle } from "../thought/run.js";
import { createOutboxProjector } from "../delivery/outbox-projector.js";
import { getCycle } from "../cycle/inbox.js";
import { getWake } from "../wake/ledger.js";
import {
  getPrivateReservation,
  getPrivateReservationForWake,
} from "../private-budget/ledger.js";
import { getDeferredFrontier } from "../frontier/ledger.js";

export type LiveCognitiveTurnInput = {
  sidecar: DatabaseSync;
  nuclear: DatabaseSync;
  event: InboxEvent;
  deps: KernelDeps;
  projector?: OutboxDeliveryProjector;
};

/**
 * P0 periodic recovery dispatch fence (R7 §§22.2–22.3). Canonical periodic
 * trigger_ref identity: `periodic:<scheduleOccurrenceId>:<eligibleAtMs>`
 * (opaque to all consumers — hashed/stored/prefix-filtered, never parsed).
 * Periodic origin is determined mechanically from the bound wake's
 * trigger_ref via this prefix — never by semantic interpretation.
 */
export const PERIODIC_TRIGGER_REF_PREFIX = "periodic:" as const;
/** Kill-switch refusal code: retained/deferred, never dispatched, never fabricated terminal. */
export const PERIODIC_RECOVERY_DISPATCH_BLOCKED = "periodic_recovery_dispatch_blocked" as const;
/**
 * Retain/defer horizon for a refused recovered periodic lineage (one nominal
 * opportunity). The durable age boundary (15 min) clamps the effective wait;
 * the row is preserved durably throughout — never dispatched, never unbound.
 */
export const PERIODIC_RECOVERY_DEFER_MS = 21_600_000 as const;

export function isPeriodicCognitionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PERIODIC_COGNITION_ENABLED;
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function isPeriodicLineageTriggerRef(triggerRef: unknown): boolean {
  return typeof triggerRef === "string" && triggerRef.startsWith(PERIODIC_TRIGGER_REF_PREFIX);
}

export function explicitEventReservationId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)["privateBudgetReservationId"];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * P0 PERIODIC_RECOVERY_DISPATCH_GATE. The switch blocks authorization or
 * progression into NEW periodic provider work; it does NOT fabricate
 * terminal failure and never blocks truthful recovery/bookkeeping.
 *
 * - Switch != explicit true/1 + periodic bound-wake lineage + NOT
 *   committed ⇒ blocked: retain the same binding; never unbind, reselect,
 *   or mint replacement lineage; zero new periodic provider dispatch.
 * - Already COMMITTED/running ⇒ not blocked: existing
 *   execution/recovery/publication/Failure Truth/terminal bookkeeping may
 *   complete; no replacement dispatch is authorized downstream.
 * - Non-periodic authored work (incl. due future triggers) ⇒ not blocked.
 */
export function isPeriodicRecoveryDispatchBlocked(
  sidecar: DatabaseSync,
  event: InboxEvent,
  reservation: PrivateBudgetReservation | null,
): boolean {
  if (isPeriodicCognitionEnabled()) return false;
  const wake = event.wakeId ? getWake(sidecar, event.wakeId) : null;
  if (!wake || !isPeriodicLineageTriggerRef(wake.triggerRef)) return false;
  if (reservation?.state === "committed") return false;
  return true;
}

/**
 * Sol R2.1 Amendment C (exact-lineage): Authorize continuation provider dispatch for deferred reactive frontiers.
 * Execution requires ALL of:
 * 1. event kind is frontier_wake
 * 2. payload.frontierId and payload.cycleId are present
 * 3. deferred frontier exists in state 'running' (state 'waiting' does NOT authorize execution)
 * 4. frontier.claimToken is non-empty and matches event.claimToken exactly
 * 5. frontier.leaseExpiresAtMs is non-null and matches event.leaseExpiresAtMs exactly
 * 6. lease has not expired (leaseExpiresAtMs > current authorization time)
 * 7. EXACT LINEAGE:
 *    wake.wakeId === event.wakeId
 *    reservation.wakeId === wake.wakeId
 *    cycle.wakeId === wake.wakeId
 *    wake.cycleId === cycle.cycleId
 *    payload.cycleId === cycle.cycleId
 *    frontier.cycleId === cycle.cycleId
 *    frontier.generation === cycle.generation
 *    frontier.conversationId === event.conversationId
 *    cycle.conversationId === event.conversationId
 *    reservation.conversationId === event.conversationId
 */
export function isAuthorizedDeferredFrontierContinuation(
  sidecar: DatabaseSync,
  event: InboxEvent,
  wake: WakeRecord,
  reservation: PrivateBudgetReservation,
  cycle: CycleRecord,
): boolean {
  if (event.kind !== "frontier_wake") return false;
  const payload = typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  const frontierId = typeof payload.frontierId === "string" ? payload.frontierId : null;
  if (!frontierId) return false;
  const payloadCycleId = typeof payload.cycleId === "string" ? payload.cycleId : null;
  if (!payloadCycleId) return false;
  const frontier = getDeferredFrontier(sidecar, frontierId);
  if (!frontier) return false;
  if (frontier.state !== "running") return false;
  if (!frontier.claimToken || event.claimToken == null || event.claimToken !== frontier.claimToken) return false;
  if (frontier.leaseExpiresAtMs == null || event.leaseExpiresAtMs == null || event.leaseExpiresAtMs !== frontier.leaseExpiresAtMs) return false;
  if (frontier.leaseExpiresAtMs <= Date.now()) return false;
  // Exact lineage: wake chain
  if (wake.wakeId !== event.wakeId) return false;
  if (reservation.wakeId !== wake.wakeId) return false;
  if (cycle.wakeId !== wake.wakeId) return false;
  // wake -> cycle binding
  if (wake.cycleId !== cycle.cycleId) return false;
  // payload cycleId must match cycle
  if (payloadCycleId !== cycle.cycleId) return false;
  // frontier must belong to the exact cycle
  if (frontier.cycleId !== cycle.cycleId) return false;
  if (frontier.generation !== cycle.generation) return false;
  // conversation identity across all four objects
  if (frontier.conversationId !== event.conversationId) return false;
  if (cycle.conversationId !== event.conversationId) return false;
  if (reservation.conversationId !== event.conversationId) return false;
  return true;
}

function withProjector(
  deps: KernelDeps,
  projector: OutboxDeliveryProjector | undefined,
): KernelDeps {
  if (!projector) return { ...deps, origin: "live" };
  return {
    ...deps,
    origin: "live",
    projectOutbox: (outboxId) => projector.project(outboxId),
    projectSystemNotice: (noticeId) => projector.projectSystem(noticeId),
  };
}

/**
 * Run one admitted inbox event through the v0.2.1 kernel and then through the
 * nuclear delivery projector. This function has no legacy `/chat/text` path.
 */
export async function runLiveCognitiveTurn(
  input: LiveCognitiveTurnInput,
): Promise<KernelRunResult>;
export async function runLiveCognitiveTurn(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  event: InboxEvent,
  deps: KernelDeps,
): Promise<KernelRunResult>;
export async function runLiveCognitiveTurn(
  inputOrSidecar: LiveCognitiveTurnInput | DatabaseSync,
  nuclear?: DatabaseSync,
  event?: InboxEvent,
  deps?: KernelDeps,
): Promise<KernelRunResult> {
  const input: LiveCognitiveTurnInput = inputOrSidecar instanceof Object &&
    "sidecar" in inputOrSidecar
    ? inputOrSidecar as LiveCognitiveTurnInput
    : {
        sidecar: inputOrSidecar as DatabaseSync,
        nuclear: nuclear!,
        event: event!,
        deps: deps!,
      };
  if (!input.sidecar || !input.nuclear || !input.event || !input.deps) {
    throw new Error("live_cognitive_turn_input_required");
  }
  if (!input.event.wakeId) throw new Error("wake_required");
  const wake = getWake(input.sidecar, input.event.wakeId);
  if (!wake) throw new Error("wake_missing");
  const payload = typeof input.event.payload === "object" && input.event.payload !== null && !Array.isArray(input.event.payload)
    ? input.event.payload as Record<string, unknown>
    : {};
  const cycleId = typeof payload.cycleId === "string" ? payload.cycleId : wake.cycleId;
  const cycle = getCycle(input.sidecar, cycleId);
  if (!cycle || cycle.wakeId !== wake.wakeId) throw new Error("wake_cycle_conflict");
  if (wake.state === "terminal" || wake.state === "reconciling") throw new Error("wake_not_dispatchable");

  const explicitReservationId = typeof payload.privateBudgetReservationId === "string"
    ? payload.privateBudgetReservationId
    : null;
  const reservation = explicitReservationId
    ? getPrivateReservation(input.sidecar, explicitReservationId)
    : getPrivateReservationForWake(input.sidecar, wake.wakeId);

  // P0 PERIODIC_RECOVERY_DISPATCH_GATE (execution-boundary layer): a
  // recovered periodic durable obligation may not cross into NEW provider
  // work merely because generic durable-work reconciliation returned it to
  // pending. Blocked lineages retain their binding and defer (the generic
  // consumer settles retry_wait without invoking dispatch); committed work
  // finishes through existing truth below.
  if (isPeriodicRecoveryDispatchBlocked(input.sidecar, input.event, reservation)) {
    throw new Error(PERIODIC_RECOVERY_DISPATCH_BLOCKED);
  }

  const isPrivateTrigger = cycle.triggerKind === "idle_opportunity" ||
    cycle.triggerKind === "subscription_item" ||
    cycle.triggerKind === "future_trigger_due";

  if (!reservation) {
    if (explicitReservationId || isPrivateTrigger) {
      throw new Error("private_budget_reservation_missing");
    }
  }

  const privateBudgetBinding = reservation
    ? (() => {
        if (reservation.wakeId !== wake.wakeId || reservation.conversationId !== input.event.conversationId) {
          throw new Error("private_budget_reservation_identity_conflict");
        }
        if (reservation.state === "committed") {
          if (!isAuthorizedDeferredFrontierContinuation(input.sidecar, input.event, wake, reservation, cycle)) {
            throw new Error("private_budget_reservation_not_dispatchable");
          }
        } else if (reservation.state !== "held") {
          throw new Error("private_budget_reservation_not_dispatchable");
        }
        return {
          sidecar: input.sidecar,
          reservationId: reservation.reservationId,
          wakeId: wake.wakeId,
          conversationId: input.event.conversationId,
        };
      })()
    : undefined;
  const projector = input.projector ?? createOutboxProjector(input.sidecar, input.nuclear);
  return runCognitiveCycle(
    input.sidecar,
    input.nuclear,
    input.event,
    withProjector(input.deps, projector),
    { privateBudgetBinding },
  );
}

/** Factory form used by the durable inbox worker. */
export function createLiveCognitiveDispatcher(input: {
  sidecar: DatabaseSync;
  nuclear: DatabaseSync;
  deps: KernelDeps;
  projector?: OutboxDeliveryProjector;
}): (event: InboxEvent) => Promise<KernelRunResult> {
  return (event) => runLiveCognitiveTurn({ ...input, event });
}
