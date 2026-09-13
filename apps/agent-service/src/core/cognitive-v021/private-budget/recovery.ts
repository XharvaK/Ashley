import type { DatabaseSync } from "node:sqlite";
import { resolveDurableContinuationOwner } from "../cycle/inbox.js";
import {
  commitPrivateDispatch,
  expirePrivateReservations,
  getPrivateRepairBinding,
  getPrivateReservation,
  markPrivateReservationUnknown,
  reconcilePrivateRepairAttempt,
  recordPrivateProviderResponse,
  releasePrivateRepairAttempt,
  releasePrivateReservation,
  type PrivateBudgetAttemptBinding,
  type PrivateBudgetChildReason,
  type PrivateBudgetProjection,
} from "./ledger.js";
import type { PrivateBudgetReservation } from "../types.js";

export type PrivateBudgetParentReceiptSubject = PrivateBudgetReservation & {
  kind: "parent";
  ordinal: 1;
  reason: "initial_dispatch";
};

export type PrivateBudgetChildReceiptSubject = {
  kind: "child";
  reservationId: string;
  invocationId: string;
  attemptId: string;
  ordinal: number;
  reason: PrivateBudgetChildReason;
  binding: PrivateBudgetAttemptBinding;
};

export type PrivateBudgetReceiptSubject =
  | PrivateBudgetParentReceiptSubject
  | PrivateBudgetChildReceiptSubject;

export type PrivateBudgetReceiptTruth =
  | { dispatchTruth: "not_started"; proofRef: string }
  | { dispatchTruth: "attempted" | "responded" | "unknown"; proofRef?: string; providerRequestId?: string };

export type PrivateBudgetRecoveryResult = {
  released: number;
  committed: number;
  reconciling: number;
  expired: number;
  /** F1: child repair-attempt rows released with no-dispatch proof (spend-neutral). */
  releasedRepairs: number;
  /** F1: child repair-attempt rows advanced to match durable receipt truth (spend-neutral). */
  committedRepairs: number;
};

export type PrivateBudgetRecoveryOptions = {
  wallClockNowMs?: number;
  resolveReceipt?: (subject: PrivateBudgetReceiptSubject) => PrivateBudgetReceiptTruth | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reconcile stranded reservations without guessing. An unbound reservation
 * proves that the W0 binding gate was never crossed; every bound reservation
 * requires a durable receipt resolver or remains consuming.
 */
export function recoverPrivateBudget(
  db: DatabaseSync,
  options: PrivateBudgetRecoveryOptions = {},
): PrivateBudgetRecoveryResult {
  const nowMs = options.wallClockNowMs ?? Date.now();
  const result: PrivateBudgetRecoveryResult = { released: 0, committed: 0, reconciling: 0, expired: 0, releasedRepairs: 0, committedRepairs: 0 };

  const policies = db.prepare("SELECT DISTINCT policy_id FROM private_budget_reservations ORDER BY policy_id").all() as Array<{ policy_id?: unknown }>;
  for (const row of policies) {
    const policyId = text(row.policy_id);
    if (!policyId) continue;
    try {
      result.expired += expirePrivateReservations(db, { policyId, wallClockNowMs: nowMs }).expired;
    } catch {
      // A malformed clock must not turn recovery into an optimistic release.
    }
  }

  const stranded = db.prepare(
    `SELECT reservation_id FROM private_budget_reservations
      WHERE state IN ('held', 'reconcile_required')
      ORDER BY created_at_ms ASC, reservation_id ASC`,
  ).all() as Array<{ reservation_id?: unknown }>;

  for (const row of stranded) {
    const reservationId = text(row.reservation_id);
    if (!reservationId) continue;
    const reservation = getPrivateReservation(db, reservationId);
    if (!reservation || (reservation.state !== "held" && reservation.state !== "reconcile_required")) continue;

    if (!reservation.invocationId && reservation.dispatchTruth === "not_bound") {
      try {
        releasePrivateReservation(db, {
          reservationId,
          proofRef: `recovery:${reservationId}:w0-binding-not-crossed`,
          dispatchTruth: "not_started",
          nowMs,
        });
        result.released += 1;
      } catch {
        result.reconciling += 1;
      }
      continue;
    }

    // Proven continuable held parent: dispatch never started and durable no-dispatch proof was already persisted.
    if (
      reservation.state === "held" &&
      reservation.dispatchTruth === "not_started" &&
      reservation.releaseProofRef != null
    ) {
      const owner = resolveDurableContinuationOwner(db, {
        wakeId: reservation.wakeId,
        conversationId: reservation.conversationId,
      });
      if (owner.status === "valid_owner") {
        // Valid active cycle/wake owns this reservation; preserve held + proof for upcoming continuation.
        continue;
      }
      if (owner.status === "proven_no_owner") {
        // Proven terminal/dead owner; safely release using the recorded proof.
        try {
          releasePrivateReservation(db, {
            reservationId,
            proofRef: reservation.releaseProofRef,
            dispatchTruth: "not_started",
            invocationId: reservation.invocationId ?? undefined,
            attemptId: reservation.attemptId ?? undefined,
            nowMs,
          });
          result.released += 1;
        } catch {
          result.reconciling += 1;
        }
        continue;
      }
      // indeterminate_identity: conserve held + proof without releasing or marking unknown.
      result.reconciling += 1;
      continue;
    }

    const parentSubject: PrivateBudgetParentReceiptSubject = {
      ...reservation,
      kind: "parent",
      ordinal: 1,
      reason: "initial_dispatch",
    };
    const receipt = options.resolveReceipt?.(parentSubject) ?? null;
    if (receipt?.dispatchTruth === "not_started" && receipt.proofRef) {
      try {
        releasePrivateReservation(db, {
          reservationId,
          proofRef: receipt.proofRef,
          dispatchTruth: "not_started",
          invocationId: reservation.invocationId ?? undefined,
          attemptId: reservation.attemptId ?? undefined,
          nowMs,
        });
        result.released += 1;
      } catch {
        result.reconciling += 1;
      }
      continue;
    }

    if (
      (receipt?.dispatchTruth === "attempted" || receipt?.dispatchTruth === "responded")
      && reservation.invocationId
      && reservation.attemptId
    ) {
      try {
        commitPrivateDispatch(db, {
          reservationId,
          invocationId: reservation.invocationId,
          attemptId: reservation.attemptId,
          nowMs,
        });
        if (receipt.dispatchTruth === "responded") {
          recordPrivateProviderResponse(db, {
            reservationId,
            invocationId: reservation.invocationId,
            attemptId: reservation.attemptId,
            nowMs,
          });
        }
        result.committed += 1;
        continue;
      } catch {
        // Fall through to the conservative unknown state.
      }
    }

    try {
      const current = getPrivateReservation(db, reservationId);
      if (current?.state === "held") markPrivateReservationUnknown(db, reservationId, { nowMs });
      result.reconciling += 1;
    } catch {
      result.reconciling += 1;
    }
  }

  // F1: extend identical receipt-resolver semantics to child repair rows. A
  // bound-but-never-dispatched child (not_started, no release proof) proves
  // the W0 gate was never crossed for that binding and releases with proof —
  // exactly like a held parent. A dispatched child (attempted/responded/
  // unknown) requires the same durable receipt the parent path requires, or
  // is conserved. Child outcomes never consume budget units.
  const strandedChildren = db.prepare(
    `SELECT reservation_id, invocation_id FROM private_budget_attempt_bindings
      WHERE dispatch_truth IN ('not_started', 'attempted', 'unknown')
        AND release_proof_ref IS NULL
      ORDER BY created_at_ms ASC, binding_id ASC`,
  ).all() as Array<{ reservation_id?: unknown; invocation_id?: unknown }>;
  for (const row of strandedChildren) {
    const reservationId = text(row.reservation_id);
    const invocationId = text(row.invocation_id);
    if (!reservationId || !invocationId) continue;
    const binding = getPrivateRepairBinding(db, reservationId, invocationId);
    if (!binding || binding.releaseProofRef != null) continue;

    const childSubject: PrivateBudgetChildReceiptSubject = {
      kind: "child",
      reservationId,
      invocationId,
      attemptId: binding.attemptId,
      ordinal: binding.ordinal,
      reason: binding.reason,
      binding,
    };
    const receipt = options.resolveReceipt?.(childSubject) ?? null;

    try {
      if (receipt?.dispatchTruth === "not_started" && receipt.proofRef) {
        releasePrivateRepairAttempt(db, { reservationId, invocationId, proofRef: receipt.proofRef, nowMs });
        result.releasedRepairs += 1;
        continue;
      }
      if (receipt?.dispatchTruth === "attempted" || receipt?.dispatchTruth === "responded") {
        reconcilePrivateRepairAttempt(db, {
          reservationId,
          invocationId,
          targetTruth: receipt.dispatchTruth,
          providerRequestId: receipt.providerRequestId,
          nowMs,
        });
        result.committedRepairs += 1;
        continue;
      }
      if (binding.dispatchTruth === "not_started") {
        releasePrivateRepairAttempt(db, {
          reservationId,
          invocationId,
          proofRef: `recovery:${reservationId}:${invocationId}:w0-binding-not-crossed`,
          nowMs,
        });
        result.releasedRepairs += 1;
        continue;
      }
      // No receipt: conserve the child row untouched (never guess; unknown stays unknown, attempted stays attempted).
    } catch {
      // Fail closed: leave the child row for operator/receipt truth.
    }
  }

  return result;
}

/** Read-only helper used by diagnostics callers that already have a projection. */
export function privateBudgetRecoveryStatus(projection: PrivateBudgetProjection): "ready" | "blocked" {
  return projection.clockState === "stable" ? "ready" : "blocked";
}
