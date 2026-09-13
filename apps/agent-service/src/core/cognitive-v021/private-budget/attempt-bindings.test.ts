import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { admitWake } from "../wake/ledger.js";
import {
  DEFAULT_PRIVATE_THOUGHT_POLICY,
  bindPrivateRepairAttempt,
  bindPrivateReservationInvocation,
  bindPrivateReservationOrRepairAttempt,
  commitPrivateDispatch,
  commitPrivateRepairDispatch,
  getPrivateBudgetProjection,
  getPrivateRepairBinding,
  listPrivateAttemptHistory,
  markPrivateRepairAttemptUnknown,
  nextPrivateRepairOrdinal,
  reconcilePrivateRepairAttempt,
  recordPrivateProviderResponse,
  recordPrivateRepairResponse,
  recordPrivateReservationNoDispatchProof,
  releasePrivateRepairAttempt,
  releasePrivateReservation,
  reservePrivateThought,
  getPrivateReservationForWake,
} from "./ledger.js";
import { recoverPrivateBudget, type PrivateBudgetReceiptSubject } from "./recovery.js";
import { env } from "../../../env.js";
import { openNuclearDb } from "../../../core/db.js";
import { completeChat, resetAdapterCache } from "../../../mistral-client.js";
import { withOfflineAppGateDisabled } from "../../../core/qualification/offline-test-helpers.js";
import * as cloudflareAdapterModule from "../../../core/model-routing/adapters/cloudflare-adapter.js";
import * as mistralAdapterModule from "../../../core/model-routing/adapters/mistral-adapter.js";
import { reconcilePolicyClock } from "./policy-time-ledger.js";
import { runCognitiveCycle } from "../thought/run.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";

const BASE = 2_000_000;
const CONVERSATION = "conversation:repair";
const POLICY = "private-v1";

function db(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
}

function wake(sidecar: DatabaseSync, suffix: string, conversationId = CONVERSATION, nowMs = BASE): string {
  const admitted = admitWake(sidecar, {
    occurrenceId: `occurrence:repair:${suffix}`,
    triggerRef: `trigger:repair:${suffix}`,
    sourceKind: "idle",
    conversationId,
    cycleId: `cycle:repair:${suffix}`,
    capturedAuthorityRevision: 1,
    nowMs,
  });
  return admitted.wake.wakeId;
}

function reserveHeld(sidecar: DatabaseSync, suffix: string, conversationId = CONVERSATION): string {
  const reserved = reservePrivateThought(sidecar, {
    admissionId: `admission:repair:${suffix}`,
    wakeId: wake(sidecar, suffix, conversationId),
    conversationId,
    policyId: POLICY,
    wallClockNowMs: BASE,
  });
  if (reserved.kind !== "reserved") throw new Error("test_reservation_missing");
  return reserved.reservation.reservationId;
}

/** Drive a parent reservation to committed + responded (post-response evidence, e.g. malformed or LENGTH-truncated attempt 1). */
function commitResponded(sidecar: DatabaseSync, reservationId: string, tag: string): void {
  bindPrivateReservationInvocation(sidecar, { reservationId, invocationId: `invocation:${tag}`, attemptId: `attempt:${tag}`, nowMs: BASE });
  commitPrivateDispatch(sidecar, { reservationId, invocationId: `invocation:${tag}`, attemptId: `attempt:${tag}`, nowMs: BASE });
  recordPrivateProviderResponse(sidecar, { reservationId, invocationId: `invocation:${tag}`, attemptId: `attempt:${tag}`, nowMs: BASE });
}

function reservationWakeId(sidecar: DatabaseSync, reservationId: string): string {
  return String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
}

describe("F1 append-only repair-attempt authorization", () => {
  it("binds attempt 2 after a responded attempt 1 and keeps both rows queryable with one budget unit", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "two-attempts");
      commitResponded(sidecar, reservationId, "two-attempts:one");
      const child = bindPrivateRepairAttempt(sidecar, {
        reservationId,
        invocationId: "invocation:two-attempts:two",
        attemptId: "attempt:two-attempts:two",
        wakeId: reservationWakeId(sidecar, reservationId),
        conversationId: CONVERSATION,
        ordinal: 2,
        reason: "structural_repair",
        nowMs: BASE,
      });
      expect(child).toMatchObject({ reservationId, ordinal: 2, reason: "structural_repair", dispatchTruth: "not_started" });
      expect(child.bindingId.startsWith("private-attempt-binding:")).toBe(true);
      // Attempt-1 provenance is untouched by the repair bind.
      const parent = sidecar.prepare("SELECT invocation_id, attempt_id, state, dispatch_truth FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
      expect(parent).toMatchObject({ invocation_id: "invocation:two-attempts:one", attempt_id: "attempt:two-attempts:one", state: "committed", dispatch_truth: "responded" });
      // One reservation = one unit regardless of attempt count.
      expect(getPrivateBudgetProjection(sidecar, { policyId: POLICY, wallClockNowMs: BASE })).toMatchObject({
        consumingCount: 1,
        remaining: DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1,
      });
    } finally {
      sidecar.close();
    }
  });

  it("refuses repair when the previous attempt has no durable response evidence", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "unknown-previous");
      // Attempt 1 dispatched (committed) but never responded: blind re-dispatch refused.
      bindPrivateReservationInvocation(sidecar, { reservationId, invocationId: "invocation:unknown:one", attemptId: "attempt:unknown:one", nowMs: BASE });
      commitPrivateDispatch(sidecar, { reservationId, invocationId: "invocation:unknown:one", attemptId: "attempt:unknown:one", nowMs: BASE });
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:unknown:two", attemptId: "attempt:unknown:two",
        wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_requires_response_evidence");
      expect(nextPrivateRepairOrdinal(sidecar, reservationId)).toBe(2);
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_attempt_bindings WHERE reservation_id = ?").get(reservationId) as { count: number }).count).toBe(0);
    } finally {
      sidecar.close();
    }
  });

  it("refuses repair on a non-committed parent and reserves ordinal 1 for the parent", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "held-parent");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:held:two", attemptId: "attempt:held:two",
        wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_parent_held_unproven");
      const releasedId = reserveHeld(sidecar, "released-p");
      releasePrivateReservation(sidecar, { reservationId: releasedId, proofRef: "proof:rel", dispatchTruth: "not_started", nowMs: BASE });
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId: releasedId, invocationId: "invocation:rel:two", attemptId: "attempt:rel:two",
        wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_parent_not_committed");
      commitResponded(sidecar, reservationId, "held-parent:one");
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:held:two", attemptId: "attempt:held:two",
        wakeId, conversationId: CONVERSATION, ordinal: 1, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_ordinal_reserved");
    } finally {
      sidecar.close();
    }
  });

  it("enforces the ordinal 12 backstop and typed ordinal conflicts", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "ordinal-cap");
      commitResponded(sidecar, reservationId, "ordinal-cap:one");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      for (let ordinal = 2; ordinal <= 12; ordinal += 1) {
        const tag = `ordinal-cap:${ordinal}`;
        const bound = bindPrivateRepairAttempt(sidecar, {
          reservationId, invocationId: `invocation:${tag}`, attemptId: `attempt:${tag}`,
          wakeId, conversationId: CONVERSATION, ordinal, reason: "structural_repair", nowMs: BASE,
        });
        expect(bound.ordinal).toBe(ordinal);
        commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: `invocation:${tag}`, nowMs: BASE });
        recordPrivateRepairResponse(sidecar, { reservationId, invocationId: `invocation:${tag}`, nowMs: BASE });
      }
      expect(nextPrivateRepairOrdinal(sidecar, reservationId)).toBe(13);
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:ordinal-cap:13", attemptId: "attempt:ordinal-cap:13",
        wakeId, conversationId: CONVERSATION, ordinal: 13, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_ordinal_exceeded");
      // Same reservation + same ordinal + different invocation: typed conflict, never an overwrite.
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:ordinal-cap:dupe", attemptId: "attempt:ordinal-cap:dupe",
        wakeId, conversationId: CONVERSATION, ordinal: 5, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_ordinal_conflict");
      // Same invocation retried: idempotent, existing row returned.
      const again = bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:ordinal-cap:5", attemptId: "attempt:ordinal-cap:5",
        wakeId, conversationId: CONVERSATION, ordinal: 5, reason: "structural_repair", nowMs: BASE,
      });
      expect(again).toMatchObject({ ordinal: 5, invocationId: "invocation:ordinal-cap:5", dispatchTruth: "responded" });
      expect((sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_attempt_bindings WHERE reservation_id = ?").get(reservationId) as { count: number }).count).toBe(11);
    } finally {
      sidecar.close();
    }
  });

  it("refuses cross-wake and cross-conversation repair binds", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "hijack");
      commitResponded(sidecar, reservationId, "hijack:one");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:hijack:two", attemptId: "attempt:hijack:two",
        wakeId: "wake:other", conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_identity_conflict");
      expect(() => bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:hijack:two", attemptId: "attempt:hijack:two",
        wakeId, conversationId: "conversation:other", ordinal: 2, reason: "structural_repair", nowMs: BASE,
      })).toThrow("repair_identity_conflict");
    } finally {
      sidecar.close();
    }
  });

  it("routes first binds to the parent and repair binds to children (or-repair helper)", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "or-repair");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      const first = bindPrivateReservationOrRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:or:one", attemptId: "attempt:or:one",
        wakeId, conversationId: CONVERSATION, nowMs: BASE,
      });
      expect(first.kind).toBe("parent");
      // Held parent + different invocation: A2 guard preserved, still throws (never silently converted).
      expect(() => bindPrivateReservationOrRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:or:sneaky", attemptId: "attempt:or:sneaky",
        wakeId, conversationId: CONVERSATION, nowMs: BASE,
      })).toThrow("invocation_binding_conflict");
      commitPrivateDispatch(sidecar, { reservationId, invocationId: "invocation:or:one", attemptId: "attempt:or:one", nowMs: BASE });
      recordPrivateProviderResponse(sidecar, { reservationId, invocationId: "invocation:or:one", attemptId: "attempt:or:one", nowMs: BASE });
      expect(() => bindPrivateReservationOrRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:or:two", attemptId: "attempt:or:two",
        wakeId, conversationId: CONVERSATION, nowMs: BASE,
      })).toThrow("private_budget_child_reason_unavailable");
      const second = bindPrivateReservationOrRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:or:two", attemptId: "attempt:or:two",
        wakeId, conversationId: CONVERSATION, childReason: "structural_repair", nowMs: BASE,
      });
      expect(second.kind).toBe("child");
      if (second.kind !== "child") throw new Error("test_child_missing");
      expect(second.ordinal).toBe(2);
      expect(second.binding.reason).toBe("structural_repair");
      // Committed parent + same ids: idempotent parent path.
      const same = bindPrivateReservationOrRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:or:one", attemptId: "attempt:or:one",
        wakeId, conversationId: CONVERSATION, nowMs: BASE,
      });
      expect(same.kind).toBe("parent");
    } finally {
      sidecar.close();
    }
  });

  it("commits, records, and releases child rows with parent-mirrored semantics", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "child-lifecycle");
      commitResponded(sidecar, reservationId, "child-lifecycle:one");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      const input = { reservationId, invocationId: "invocation:child:two", attemptId: "attempt:child:two", wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair" as const, nowMs: BASE };
      const bound = bindPrivateRepairAttempt(sidecar, input);
      expect(bound.dispatchTruth).toBe("not_started");
      expect(() => commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:child:missing", nowMs: BASE })).toThrow("dispatch_without_reservation");
      const committed = commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: input.invocationId, attemptId: input.attemptId, nowMs: BASE });
      expect(committed.dispatchTruth).toBe("attempted");
      expect(commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: input.invocationId, nowMs: BASE }).dispatchTruth).toBe("attempted");
      const responded = recordPrivateRepairResponse(sidecar, { reservationId, invocationId: input.invocationId, providerRequestId: "provider:req:1", nowMs: BASE });
      expect(responded).toMatchObject({ dispatchTruth: "responded", providerRequestId: "provider:req:1" });
      // A dispatched child can no longer release.
      expect(() => releasePrivateRepairAttempt(sidecar, { reservationId, invocationId: input.invocationId, proofRef: "proof:late", nowMs: BASE })).toThrow("reservation_state_conflict");
      // A bound-but-never-dispatched child releases with proof; same proof is idempotent, another conflicts.
      const releasable = bindPrivateRepairAttempt(sidecar, { ...input, invocationId: "invocation:child:three", attemptId: "attempt:child:three", ordinal: 3, reason: "structural_repair" });
      expect(releasable.dispatchTruth).toBe("not_started");
      const released = releasePrivateRepairAttempt(sidecar, { reservationId, invocationId: releasable.invocationId, proofRef: "proof:never-sent", nowMs: BASE });
      expect(released.releaseProofRef).toBe("proof:never-sent");
      expect(releasePrivateRepairAttempt(sidecar, { reservationId, invocationId: releasable.invocationId, proofRef: "proof:never-sent", nowMs: BASE }).releaseProofRef).toBe("proof:never-sent");
      expect(() => releasePrivateRepairAttempt(sidecar, { reservationId, invocationId: releasable.invocationId, proofRef: "proof:other", nowMs: BASE })).toThrow("release_proof_conflict");
      expect(getPrivateRepairBinding(sidecar, reservationId, "invocation:child:missing")).toBeNull();
    } finally {
      sidecar.close();
    }
  });

  it("recovers a crashed child bind with proof and lets the next ordinal continue", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "crash-between-binds");
      commitResponded(sidecar, reservationId, "crash:one");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      // Crash between child-bind and dispatch: child stuck not_started, parent committed.
      bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:crash:two", attemptId: "attempt:crash:two",
        wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      });
      const recovered = recoverPrivateBudget(sidecar, { wallClockNowMs: BASE + 1 });
      expect(recovered).toMatchObject({ releasedRepairs: 1, committedRepairs: 0 });
      // Attempt-1 provenance preserved; parent spend truth preserved.
      const parent = sidecar.prepare("SELECT invocation_id, state, dispatch_truth FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
      expect(parent).toMatchObject({ invocation_id: "invocation:crash:one", state: "committed", dispatch_truth: "responded" });
      // The released child proves its attempt never happened, so ordinal 3 may bind.
      const next = bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:crash:three", attemptId: "attempt:crash:three",
        wakeId, conversationId: CONVERSATION, ordinal: 3, reason: "structural_repair", nowMs: BASE + 1,
      });
      expect(next.ordinal).toBe(3);
    } finally {
      sidecar.close();
    }
  });

  it("reads the full attempt set as UNION(parent, children) ordered by ordinal", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "union");
      commitResponded(sidecar, reservationId, "union:one");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:union:2", attemptId: "attempt:union:2",
        wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      });
      commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:union:2", nowMs: BASE });
      recordPrivateRepairResponse(sidecar, { reservationId, invocationId: "invocation:union:2", nowMs: BASE });

      bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:union:3", attemptId: "attempt:union:3",
        wakeId, conversationId: CONVERSATION, ordinal: 3, reason: "cycle_continuation", nowMs: BASE,
      });
      commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:union:3", nowMs: BASE });
      recordPrivateRepairResponse(sidecar, { reservationId, invocationId: "invocation:union:3", nowMs: BASE });

      const history = listPrivateAttemptHistory(sidecar, reservationId);
      expect(history.map((record) => [record.ordinal, record.reason, record.dispatchTruth])).toEqual([
        [1, "initial_dispatch", "responded"],
        [2, "structural_repair", "responded"],
        [3, "cycle_continuation", "responded"],
      ]);
      // Children-alone undercounts by exactly one once attempt 1 is bound.
      const childrenOnly = (sidecar.prepare("SELECT COUNT(*) AS count FROM private_budget_attempt_bindings WHERE reservation_id = ?").get(reservationId) as { count: number }).count;
      expect(history.length - childrenOnly).toBe(1);
    } finally {
      sidecar.close();
    }
  });

  it("advances dispatched children from durable receipt truth during recovery", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "receipt-advance");
      commitResponded(sidecar, reservationId, "receipt:one");
      const wakeId = String((sidecar.prepare("SELECT wake_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>).wake_id);
      bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:receipt:two", attemptId: "attempt:receipt:two",
        wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      });
      commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:receipt:two", nowMs: BASE });
      const respondedParent = sidecar.prepare("SELECT * FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId);
      const recovered = recoverPrivateBudget(sidecar, {
        wallClockNowMs: BASE + 1,
        resolveReceipt: () => ({ dispatchTruth: "responded" as const }),
      });
      expect(recovered.committedRepairs).toBe(1);
      expect(getPrivateRepairBinding(sidecar, reservationId, "invocation:receipt:two")).toMatchObject({ dispatchTruth: "responded" });
      expect(respondedParent).toBeTruthy();
    } finally {
      sidecar.close();
    }
  });

  it("keeps V10 child rows spend-invisible under multi-attempt cycles", () => {
    const sidecar = db();
    try {
      const reservationId = reserveHeld(sidecar, "spend-invisible");
      commitResponded(sidecar, reservationId, "spend:one");
      const historyBefore = listPrivateAttemptHistory(sidecar, reservationId);
      expect(historyBefore).toHaveLength(1);
      const wakeId = reservationWakeId(sidecar, reservationId);
      bindPrivateRepairAttempt(sidecar, {
        reservationId, invocationId: "invocation:spend:two", attemptId: "attempt:spend:two",
        wakeId, conversationId: CONVERSATION, ordinal: 2, reason: "structural_repair", nowMs: BASE,
      });
      expect(getPrivateBudgetProjection(sidecar, { policyId: POLICY, wallClockNowMs: BASE })).toMatchObject({ consumingCount: 1 });
      expect(wakeId).toBeTruthy();
    } finally {
      sidecar.close();
    }
  });

  describe("F1 child attempt recovery and convergence", () => {
    it("transitions child repair states through markPrivateRepairAttemptUnknown and reconcilePrivateRepairAttempt", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "matrix-transitions");
        commitResponded(sidecar, reservationId, "matrix:one");
        const wakeId = reservationWakeId(sidecar, reservationId);
        const input = {
          reservationId,
          invocationId: "invocation:matrix:two",
          attemptId: "attempt:matrix:two",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "structural_repair" as const,
          nowMs: BASE,
        };
        bindPrivateRepairAttempt(sidecar, input);

        // not_started -> attempted via reconcile
        const recAttempted = reconcilePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: input.invocationId,
          targetTruth: "attempted",
          nowMs: BASE,
        });
        expect(recAttempted.dispatchTruth).toBe("attempted");

        // attempted -> unknown via markPrivateRepairAttemptUnknown
        const markedUnknown = markPrivateRepairAttemptUnknown(sidecar, {
          reservationId,
          invocationId: input.invocationId,
          nowMs: BASE,
        });
        expect(markedUnknown.dispatchTruth).toBe("unknown");
        // Idempotent if already unknown
        expect(markPrivateRepairAttemptUnknown(sidecar, {
          reservationId,
          invocationId: input.invocationId,
          nowMs: BASE,
        }).dispatchTruth).toBe("unknown");

        // unknown -> attempted via reconcile
        const fromUnknownToAttempted = reconcilePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: input.invocationId,
          targetTruth: "attempted",
          nowMs: BASE,
        });
        expect(fromUnknownToAttempted.dispatchTruth).toBe("attempted");

        // attempted -> unknown again
        markPrivateRepairAttemptUnknown(sidecar, {
          reservationId,
          invocationId: input.invocationId,
          nowMs: BASE,
        });

        // unknown -> responded via reconcile with providerRequestId
        const fromUnknownToResponded = reconcilePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: input.invocationId,
          targetTruth: "responded",
          providerRequestId: "prov:req:matrix-two",
          nowMs: BASE,
        });
        expect(fromUnknownToResponded).toMatchObject({
          dispatchTruth: "responded",
          providerRequestId: "prov:req:matrix-two",
        });

        // Never rolls backward: responded -> attempted is rejected
        expect(() => reconcilePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: input.invocationId,
          targetTruth: "attempted",
          nowMs: BASE,
        })).toThrow("contradictory_dispatch_truth");
      } finally {
        sidecar.close();
      }
    });

    it("UNKNOWN_CHILD_NO_RECEIPT_STAYS_UNKNOWN", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "no-receipt-unknown");
        commitResponded(sidecar, reservationId, "no-receipt:one");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "invocation:no-receipt:two",
          attemptId: "attempt:no-receipt:two",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "structural_repair",
          nowMs: BASE,
        });
        commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:no-receipt:two", nowMs: BASE });
        markPrivateRepairAttemptUnknown(sidecar, { reservationId, invocationId: "invocation:no-receipt:two", nowMs: BASE });
        expect(getPrivateRepairBinding(sidecar, reservationId, "invocation:no-receipt:two")?.dispatchTruth).toBe("unknown");

        const recovered = recoverPrivateBudget(sidecar, { wallClockNowMs: BASE + 1 });
        expect(recovered.releasedRepairs).toBe(0);
        expect(recovered.committedRepairs).toBe(0);
        // Conserved untouched: unknown child without receipt stays unknown
        expect(getPrivateRepairBinding(sidecar, reservationId, "invocation:no-receipt:two")?.dispatchTruth).toBe("unknown");
      } finally {
        sidecar.close();
      }
    });

    it("UNKNOWN_CHILD_CHILD_SPECIFIC_ATTEMPTED_RECEIPT -> attempted", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "receipt-attempted-child");
        commitResponded(sidecar, reservationId, "rec-att:one");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "invocation:rec-att:two",
          attemptId: "attempt:rec-att:two",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "structural_repair",
          nowMs: BASE,
        });
        commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:rec-att:two", nowMs: BASE });
        markPrivateRepairAttemptUnknown(sidecar, { reservationId, invocationId: "invocation:rec-att:two", nowMs: BASE });

        const recovered = recoverPrivateBudget(sidecar, {
          wallClockNowMs: BASE + 1,
          resolveReceipt: (subject: PrivateBudgetReceiptSubject) => {
            if (subject.kind === "child" && subject.attemptId === "attempt:rec-att:two") {
              return { dispatchTruth: "attempted" };
            }
            return null;
          },
        });
        expect(recovered.committedRepairs).toBe(1);
        expect(getPrivateRepairBinding(sidecar, reservationId, "invocation:rec-att:two")?.dispatchTruth).toBe("attempted");
      } finally {
        sidecar.close();
      }
    });

    it("UNKNOWN_CHILD_CHILD_SPECIFIC_RESPONDED_RECEIPT -> responded", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "receipt-responded-child");
        commitResponded(sidecar, reservationId, "rec-resp:one");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "invocation:rec-resp:two",
          attemptId: "attempt:rec-resp:two",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "structural_repair",
          nowMs: BASE,
        });
        commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:rec-resp:two", nowMs: BASE });
        markPrivateRepairAttemptUnknown(sidecar, { reservationId, invocationId: "invocation:rec-resp:two", nowMs: BASE });

        const recovered = recoverPrivateBudget(sidecar, {
          wallClockNowMs: BASE + 1,
          resolveReceipt: (subject: PrivateBudgetReceiptSubject) => {
            if (subject.kind === "child" && subject.attemptId === "attempt:rec-resp:two") {
              return { dispatchTruth: "responded", providerRequestId: "prov-req-child-resp" };
            }
            return null;
          },
        });
        expect(recovered.committedRepairs).toBe(1);
        const child = getPrivateRepairBinding(sidecar, reservationId, "invocation:rec-resp:two");
        expect(child?.dispatchTruth).toBe("responded");
        expect(child?.providerRequestId).toBe("prov-req-child-resp");
      } finally {
        sidecar.close();
      }
    });

    it("PARENT_RESPONSE_DOES_NOT_RESOLVE_UNKNOWN_CHILD", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "parent-isolation");
        commitResponded(sidecar, reservationId, "parent-iso:one");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "invocation:child-iso:two",
          attemptId: "attempt:child-iso:two",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "structural_repair",
          nowMs: BASE,
        });
        commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:child-iso:two", nowMs: BASE });
        markPrivateRepairAttemptUnknown(sidecar, { reservationId, invocationId: "invocation:child-iso:two", nowMs: BASE });

        // Resolver resolves parent attempt only (or proves parent responded)
        const subjectsSeen: PrivateBudgetReceiptSubject[] = [];
        const recovered1 = recoverPrivateBudget(sidecar, {
          wallClockNowMs: BASE + 1,
          resolveReceipt: (subject: PrivateBudgetReceiptSubject) => {
            subjectsSeen.push(subject);
            if (subject.kind === "parent") {
              return { dispatchTruth: "responded" };
            }
            return null; // A receipt proving parent responded does NOT resolve the child attempt
          },
        });
        // The child subject was seen with child-specific attempt context
        const childSubjectSeen = subjectsSeen.find((s) => s.kind === "child") as Extract<PrivateBudgetReceiptSubject, { kind: "child" }> | undefined;
        expect(childSubjectSeen).toBeTruthy();
        expect(childSubjectSeen?.attemptId).toBe("attempt:child-iso:two");
        expect(childSubjectSeen?.ordinal).toBe(2);
        expect(childSubjectSeen?.reason).toBe("structural_repair");

        // Child attempt was NOT resolved by parent response — stays unknown!
        expect(recovered1.committedRepairs).toBe(0);
        expect(getPrivateRepairBinding(sidecar, reservationId, "invocation:child-iso:two")?.dispatchTruth).toBe("unknown");

        // Now supply child-specific receipt
        const recovered2 = recoverPrivateBudget(sidecar, {
          wallClockNowMs: BASE + 2,
          resolveReceipt: (subject: PrivateBudgetReceiptSubject) => {
            if (subject.kind === "child" && subject.attemptId === "attempt:child-iso:two") {
              return { dispatchTruth: "responded", providerRequestId: "child-prov-id" };
            }
            return null;
          },
        });
        expect(recovered2.committedRepairs).toBe(1);
        expect(getPrivateRepairBinding(sidecar, reservationId, "invocation:child-iso:two")?.dispatchTruth).toBe("responded");
      } finally {
        sidecar.close();
      }
    });

    it("RECOVERY_NEVER_DISPATCHES_PROVIDER", () => {
      const sidecar = db();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        const reservationId = reserveHeld(sidecar, "offline-purity");
        commitResponded(sidecar, reservationId, "offline:one");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "invocation:offline:two",
          attemptId: "attempt:offline:two",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "structural_repair",
          nowMs: BASE,
        });
        commitPrivateRepairDispatch(sidecar, { reservationId, invocationId: "invocation:offline:two", nowMs: BASE });
        markPrivateRepairAttemptUnknown(sidecar, { reservationId, invocationId: "invocation:offline:two", nowMs: BASE });

        recoverPrivateBudget(sidecar, {
          wallClockNowMs: BASE + 1,
          resolveReceipt: (subject) => subject.kind === "child" ? { dispatchTruth: "responded" } : null,
        });

        // Recovery is strictly local ledger reconciliation; it never dispatches to any provider
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        sidecar.close();
      }
    });
  });

  describe("R7.1 Integration Witnesses (Thought runtime path)", () => {
    const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
    const capabilityReality: CapabilityReality = {
      vision: false,
      attachmentText: false,
      conversationalRead: false,
      webSearch: false,
      canOfferProjectInspection: false,
      canOfferWorkspace: false,
      canOfferVerification: false,
      canOfferAuthorship: false,
      canOfferBoundedOperation: false,
      canOfferPatchExport: false,
      approvedProjectIds: [],
    };

    it("Witness A: STRUCTURAL REPAIR TRUTH via runCognitiveCycle", async () => {
      env.mistralApiKey = "test-mistral-key";
      env.cloudflareApiToken = "test-cloudflare-token";
      env.cloudflareAccountId = "test-cloudflare-account";
      resetAdapterCache();

      const sidecar = db();
      const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
      const nowMs = Date.now();
      reconcilePolicyClock(sidecar, { policyId: POLICY, wallClockNowMs: nowMs, authorizationRef: "owner:witness-a" });

      const wakeId = wake(sidecar, "witness-a", CONVERSATION, nowMs);
      const reserved = reservePrivateThought(sidecar, {
        admissionId: "admission:witness-a",
        wakeId,
        conversationId: CONVERSATION,
        policyId: POLICY,
        wallClockNowMs: nowMs,
      });
      if (reserved.kind !== "reserved") throw new Error("test_reservation_missing");
      const reservationId = reserved.reservation.reservationId;

      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle:witness-a",
        conversationId: CONVERSATION,
        triggerKind: "owner_message",
        triggerRef: "trigger:witness-a",
        occupantId: "doc",
        nowMs,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: CONVERSATION,
        text: "Please run structural repair test",
        discordMessageIds: ["d:witness-a"],
        nowMs,
      });
      const event = appendInboxEvent(sidecar, {
        conversationId: CONVERSATION,
        kind: "owner_message",
        payload: {
          cycleId: cycle.cycleId,
          evidenceRowId: evidence.rowId,
          ownerMessage: evidence.text,
        },
        createdAtMs: nowMs,
      });

      let callCount = 0;
      const validSettlement = makeSemanticSettlement({
        speech: { mode: "draft", surfaceDraft: "repaired settlement", mustSay: [], acceptableRealizations: [] },
      });

      const dispatch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // Pass 1: returns malformed structural output
          return {
            text: "malformed output {not valid json}",
            providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
            usage: { promptTokens: 10, completionTokens: 5 },
            finishReason: "stop",
          };
        }
        // Pass 2: valid structural retry settlement
        return {
          text: JSON.stringify(validSettlement),
          providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
          usage: { promptTokens: 15, completionTokens: 10 },
          finishReason: "stop",
        };
      });

      vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter").mockReturnValue({ provider: "cloudflare", dispatch });
      vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({ provider: "mistral", dispatch });

      const deps: KernelDeps = {
        nowMs: () => Date.now(),
        attentionDb,
        completeChat: (messages, options) => withOfflineAppGateDisabled(() => completeChat(messages, options)),
        runPerception: vi.fn(async (): Promise<Observation[]> => []),
        executeObservation: vi.fn(),
        executeEffect: vi.fn(),
        checkAuthority: () => ({ ok: true }),
        loadAuthorityPacks: () => ({
          epistemic: { allowInferredWorldClaims: false },
          currentness: { requireObservationForLatest: true },
          receipt: { receiptsByEffectId: {} },
          capability: capabilityReality,
          operational: { sandboxAvailable: false },
          relational: { withdrawalActive: false, neverMention: [] },
          stateEpoch: { authorityEpoch: 1 },
        }),
        expressionEnabled: false,
        projectOutbox: vi.fn(async () => undefined),
        constitution,
        capabilityReality,
      };

      try {
        const result = await runCognitiveCycle(sidecar, attentionDb, event, deps, {
          privateBudgetBinding: {
            sidecar,
            reservationId,
            wakeId,
            conversationId: CONVERSATION,
          },
        });

        expect(callCount).toBe(2);
        expect(result.thoughtModelAttempts).toBe(2);

        const history = listPrivateAttemptHistory(sidecar, reservationId);
        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({
          ordinal: 1,
          reason: "initial_dispatch",
          dispatchTruth: "responded",
        });
        expect(history[1]).toMatchObject({
          ordinal: 2,
          reason: "structural_repair",
          dispatchTruth: "responded",
        });

        // Exactly one parent reservation only
        const reservations = sidecar.prepare("SELECT reservation_id FROM private_budget_reservations").all();
        expect(reservations).toHaveLength(1);

        // Exactly one budget unit consumed
        const projection = getPrivateBudgetProjection(sidecar, { policyId: POLICY, wallClockNowMs: nowMs });
        expect(projection.consumingCount).toBe(1);
      } finally {
        sidecar.close();
        attentionDb.close();
      }
    });

    it("Witness B: ORDINARY CYCLE CONTINUATION TRUTH via runCognitiveCycle", async () => {
      env.mistralApiKey = "test-mistral-key";
      env.cloudflareApiToken = "test-cloudflare-token";
      env.cloudflareAccountId = "test-cloudflare-account";
      resetAdapterCache();

      const sidecar = db();
      const attentionDb = openNuclearDb(new DatabaseSync(":memory:"));
      const nowMs = Date.now();
      reconcilePolicyClock(sidecar, { policyId: POLICY, wallClockNowMs: nowMs, authorizationRef: "owner:witness-b" });

      const wakeId = wake(sidecar, "witness-b", CONVERSATION, nowMs);
      const reserved = reservePrivateThought(sidecar, {
        admissionId: "admission:witness-b",
        wakeId,
        conversationId: CONVERSATION,
        policyId: POLICY,
        wallClockNowMs: nowMs,
      });
      if (reserved.kind !== "reserved") throw new Error("test_reservation_missing");
      const reservationId = reserved.reservation.reservationId;

      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle:witness-b",
        conversationId: CONVERSATION,
        triggerKind: "owner_message",
        triggerRef: "trigger:witness-b",
        occupantId: "doc",
        nowMs,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: CONVERSATION,
        text: "Please run observation continuation test",
        discordMessageIds: ["d:witness-b"],
        nowMs,
      });
      const event = appendInboxEvent(sidecar, {
        conversationId: CONVERSATION,
        kind: "owner_message",
        payload: {
          cycleId: cycle.cycleId,
          evidenceRowId: evidence.rowId,
          ownerMessage: evidence.text,
        },
        createdAtMs: nowMs,
      });

      let callCount = 0;
      const validSettlement = makeSemanticSettlement({
        speech: { mode: "draft", surfaceDraft: "continuation settlement", mustSay: [], acceptableRealizations: [] },
      });

      const dispatch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // Pass 1: returns valid observation_intent
          return {
            text: JSON.stringify({
              kind: "observation_intent",
              operationKind: "project.read_file",
              request: { path: "README.md" },
              purpose: "inspect",
              evidenceNeed: "contents",
              existingRefs: ["trigger:witness-b"],
            }),
            providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
            usage: { promptTokens: 10, completionTokens: 5 },
            finishReason: "stop",
          };
        }
        // Pass 2: valid settlement after observation
        return {
          text: JSON.stringify(validSettlement),
          providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
          usage: { promptTokens: 15, completionTokens: 10 },
          finishReason: "stop",
        };
      });

      vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter").mockReturnValue({ provider: "cloudflare", dispatch });
      vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({ provider: "mistral", dispatch });

      const observed: Observation = {
        observationId: "observation-witness-b",
        cycleId: cycle.cycleId,
        generation: 1,
        derived: false,
        replaySafe: true,
        modality: "text",
        payload: { text: "observed content" },
        provenance: "fake-read",
        dataClassification: "ordinary",
        secretOmitted: false,
      };
      const executeObservation = vi.fn(async () => observed);

      const deps: KernelDeps = {
        nowMs: () => Date.now(),
        attentionDb,
        completeChat: (messages, options) => withOfflineAppGateDisabled(() => completeChat(messages, options)),
        runPerception: vi.fn(async (): Promise<Observation[]> => []),
        executeObservation,
        executeEffect: vi.fn(),
        checkAuthority: () => ({ ok: true }),
        loadAuthorityPacks: () => ({
          epistemic: { allowInferredWorldClaims: false },
          currentness: { requireObservationForLatest: true },
          receipt: { receiptsByEffectId: {} },
          capability: capabilityReality,
          operational: { sandboxAvailable: false },
          relational: { withdrawalActive: false, neverMention: [] },
          stateEpoch: { authorityEpoch: 1 },
        }),
        expressionEnabled: false,
        projectOutbox: vi.fn(async () => undefined),
        constitution,
        capabilityReality,
      };

      try {
        const result = await runCognitiveCycle(sidecar, attentionDb, event, deps, {
          privateBudgetBinding: {
            sidecar,
            reservationId,
            wakeId,
            conversationId: CONVERSATION,
          },
        });

        expect(callCount).toBe(2);
        expect(executeObservation).toHaveBeenCalledTimes(1);
        expect(result.thoughtModelAttempts).toBe(2);

        // Authoritative attempt history
        const history = listPrivateAttemptHistory(sidecar, reservationId);
        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({
          ordinal: 1,
          reason: "initial_dispatch",
          dispatchTruth: "responded",
        });
        expect(history[1]).toMatchObject({
          ordinal: 2,
          reason: "cycle_continuation",
          dispatchTruth: "responded",
        });

        // No structural_repair reason may appear for the second call
        const reasons = history.map((h) => h.reason);
        expect(reasons).not.toContain("structural_repair");
        expect(reasons).toEqual(["initial_dispatch", "cycle_continuation"]);

        // Exactly one parent reservation only
        const reservations = sidecar.prepare("SELECT reservation_id FROM private_budget_reservations").all();
        expect(reservations).toHaveLength(1);

        // Exactly one budget unit consumed
        const projection = getPrivateBudgetProjection(sidecar, { policyId: POLICY, wallClockNowMs: nowMs });
        expect(projection.consumingCount).toBe(1);
      } finally {
        sidecar.close();
        attentionDb.close();
      }
    });
  });

  describe("F1 Final Continuation-Authority Witnesses (R2 + R2.1)", () => {
    it("HELD_PARENT_WITHOUT_NO_SEND_PROOF_CANNOT_BIND_CHILD", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-unproven-held");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:unproven:1",
          attemptId: "att:unproven:1",
          nowMs: BASE,
        });
        // Held parent without proof throws repair_parent_held_unproven
        expect(() =>
          bindPrivateRepairAttempt(sidecar, {
            reservationId,
            invocationId: "inv:unproven:2",
            attemptId: "att:unproven:2",
            wakeId,
            conversationId: CONVERSATION,
            ordinal: 2,
            reason: "cycle_continuation",
            nowMs: BASE,
          }),
        ).toThrow("repair_parent_held_unproven");

        // Routing helper also refuses and fails closed via invocation_binding_conflict
        expect(() =>
          bindPrivateReservationOrRepairAttempt(sidecar, {
            reservationId,
            invocationId: "inv:unproven:2",
            attemptId: "att:unproven:2",
            wakeId,
            conversationId: CONVERSATION,
            childReason: "cycle_continuation",
            nowMs: BASE,
          }),
        ).toThrow("invocation_binding_conflict");
      } finally {
        sidecar.close();
      }
    });

    it("HELD_PARENT_NOT_BOUND_CANNOT_BIND_CHILD", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-not-bound");
        const wakeId = reservationWakeId(sidecar, reservationId);
        expect(() =>
          bindPrivateRepairAttempt(sidecar, {
            reservationId,
            invocationId: "inv:not-bound:2",
            attemptId: "att:not-bound:2",
            wakeId,
            conversationId: CONVERSATION,
            ordinal: 2,
            reason: "cycle_continuation",
            nowMs: BASE,
          }),
        ).toThrow("repair_parent_held_unproven");
      } finally {
        sidecar.close();
      }
    });

    it("HELD_PARENT_WITH_MISMATCHED_WAKE_OR_CONVERSATION_CANNOT_BIND_CHILD", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-mismatched");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:mismatched:1",
          attemptId: "att:mismatched:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:mismatched:1",
          attemptId: "att:mismatched:1",
          proofRef: "proof:mismatched:1",
          nowMs: BASE,
        });
        // Wrong wakeId
        expect(() =>
          bindPrivateRepairAttempt(sidecar, {
            reservationId,
            invocationId: "inv:mismatched:2",
            attemptId: "att:mismatched:2",
            wakeId: "wake:other",
            conversationId: CONVERSATION,
            ordinal: 2,
            reason: "cycle_continuation",
            nowMs: BASE,
          }),
        ).toThrow("repair_identity_conflict");
        // Wrong conversationId
        expect(() =>
          bindPrivateRepairAttempt(sidecar, {
            reservationId,
            invocationId: "inv:mismatched:2",
            attemptId: "att:mismatched:2",
            wakeId,
            conversationId: "conversation:other",
            ordinal: 2,
            reason: "cycle_continuation",
            nowMs: BASE,
          }),
        ).toThrow("repair_identity_conflict");
      } finally {
        sidecar.close();
      }
    });

    it("HELD_PARENT_WITH_NO_SEND_PROOF_CAN_BIND_CHILD", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-held-proof");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:held-proof:1",
          attemptId: "att:held-proof:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:held-proof:1",
          attemptId: "att:held-proof:1",
          proofRef: "proof:held-proof:1",
          nowMs: BASE,
        });
        const bound = bindPrivateReservationOrRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:held-proof:2",
          attemptId: "att:held-proof:2",
          wakeId,
          conversationId: CONVERSATION,
          childReason: "cycle_continuation",
          nowMs: BASE,
        });
        expect(bound.kind).toBe("child");
        if (bound.kind === "child") {
          expect(bound.ordinal).toBe(2);
          expect(bound.binding).toMatchObject({
            reservationId,
            invocationId: "inv:held-proof:2",
            attemptId: "att:held-proof:2",
            reason: "cycle_continuation",
            dispatchTruth: "not_started",
          });
        }
        // Parent remains held with proof
        const parent = sidecar.prepare("SELECT state, dispatch_truth, release_proof_ref FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        expect(parent).toMatchObject({
          state: "held",
          dispatch_truth: "not_started",
          release_proof_ref: "proof:held-proof:1",
        });
      } finally {
        sidecar.close();
      }
    });

    it("NO_SEND_PROOF_RECORDING_DOES_NOT_RELEASE_CAPACITY", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-capacity-preserved");
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:cap:1",
          attemptId: "att:cap:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:cap:1",
          attemptId: "att:cap:1",
          proofRef: "proof:cap:1",
          nowMs: BASE,
        });
        const proj = getPrivateBudgetProjection(sidecar, { policyId: POLICY, wallClockNowMs: BASE });
        expect(proj.consumingCount).toBe(1);
        expect(proj.remaining).toBe(DEFAULT_PRIVATE_THOUGHT_POLICY.limit - 1);
        expect(proj.stateCounts.held).toBe(1);
        expect(proj.stateCounts.released).toBe(0);
      } finally {
        sidecar.close();
      }
    });

    it("NO_SEND_PROOF_CONFLICT_FAILS_CLOSED", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-proof-conflict");
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:conflict:1",
          attemptId: "att:conflict:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:conflict:1",
          attemptId: "att:conflict:1",
          proofRef: "proof:alpha",
          nowMs: BASE,
        });
        // Idempotent with same proof
        expect(recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:conflict:1",
          attemptId: "att:conflict:1",
          proofRef: "proof:alpha",
          nowMs: BASE,
        }).releaseProofRef).toBe("proof:alpha");
        // Conflicting proof throws
        expect(() =>
          recordPrivateReservationNoDispatchProof(sidecar, {
            reservationId,
            invocationId: "inv:conflict:1",
            attemptId: "att:conflict:1",
            proofRef: "proof:beta",
            nowMs: BASE,
          }),
        ).toThrow("proof_ref_conflict");
      } finally {
        sidecar.close();
      }
    });

    it("CHILD_W0_CANNOT_COMMIT_UNPROVEN_HELD_PARENT", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-unproven-w0");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:w0:1",
          attemptId: "att:w0:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:w0:1",
          attemptId: "att:w0:1",
          proofRef: "proof:w0:1",
          nowMs: BASE,
        });
        // Bind child 2
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:w0:2",
          attemptId: "att:w0:2",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "cycle_continuation",
          nowMs: BASE,
        });
        // Tamper parent proof away
        sidecar.prepare("UPDATE private_budget_reservations SET release_proof_ref = NULL WHERE reservation_id = ?").run(reservationId);
        // Committing child dispatch on unproven held parent MUST throw
        expect(() =>
          commitPrivateRepairDispatch(sidecar, {
            reservationId,
            invocationId: "inv:w0:2",
            nowMs: BASE,
          }),
        ).toThrow("child_commit_unproven_held_parent");

        // Restore proof: committing child dispatch atomically commits parent unit
        sidecar.prepare("UPDATE private_budget_reservations SET release_proof_ref = 'proof:w0:1' WHERE reservation_id = ?").run(reservationId);
        const childCommit = commitPrivateRepairDispatch(sidecar, {
          reservationId,
          invocationId: "inv:w0:2",
          nowMs: BASE,
        });
        expect(childCommit.dispatchTruth).toBe("attempted");
        const committedParent = sidecar.prepare("SELECT state, dispatch_truth, release_proof_ref FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        expect(committedParent).toMatchObject({
          state: "committed",
          dispatch_truth: "not_started",
          release_proof_ref: "proof:w0:1",
        });
      } finally {
        sidecar.close();
      }
    });

    it("CHILD_W0_CANNOT_COMMIT_HELD_PARENT_WITH_MISSING_ATTEMPT1_BINDING", () => {
      const sidecar = db();
      try {
        // Reserve a held parent and bind + record proof so the parent qualifies
        // as "continuable" for the child bind path.
        const reservationId = reserveHeld(sidecar, "witness-missing-a1-binding");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:a1miss:1",
          attemptId: "att:a1miss:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:a1miss:1",
          attemptId: "att:a1miss:1",
          proofRef: "proof:a1miss:1",
          nowMs: BASE,
        });
        // Bind child 2 while parent still has correct invocation
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:a1miss:2",
          attemptId: "att:a1miss:2",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "cycle_continuation",
          nowMs: BASE,
        });
        // SQL-corrupt the parent: zero out invocation_id (direct table write only valid in tests)
        sidecar.prepare("UPDATE private_budget_reservations SET invocation_id = NULL, attempt_id = NULL WHERE reservation_id = ?").run(reservationId);
        // Committing child dispatch on held parent with missing attempt-1 binding MUST throw
        expect(() =>
          commitPrivateRepairDispatch(sidecar, {
            reservationId,
            invocationId: "inv:a1miss:2",
            nowMs: BASE,
          }),
        ).toThrow("child_commit_unproven_held_parent");

        // Restoring invocation_id and attempt_id makes the commit succeed
        sidecar.prepare("UPDATE private_budget_reservations SET invocation_id = 'inv:a1miss:1', attempt_id = 'att:a1miss:1' WHERE reservation_id = ?").run(reservationId);
        const childCommit = commitPrivateRepairDispatch(sidecar, {
          reservationId,
          invocationId: "inv:a1miss:2",
          nowMs: BASE,
        });
        expect(childCommit.dispatchTruth).toBe("attempted");
        const committedParent = sidecar.prepare("SELECT state, invocation_id, attempt_id FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        // Parent is committed with attempt-1 binding preserved
        expect(committedParent).toMatchObject({
          state: "committed",
          invocation_id: "inv:a1miss:1",
          attempt_id: "att:a1miss:1",
        });
      } finally {
        sidecar.close();
      }
    });

    it("CHILD_COMPOSE_PRE_W0_RECORDS_CHILD_NO_SEND_PROOF", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-child-compose");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:c-comp:1",
          attemptId: "att:c-comp:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:c-comp:1",
          attemptId: "att:c-comp:1",
          proofRef: "proof:c-comp:1",
          nowMs: BASE,
        });
        const child = bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:c-comp:2",
          attemptId: "att:c-comp:2",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "cycle_continuation",
          nowMs: BASE,
        });
        expect(child.dispatchTruth).toBe("not_started");

        // Pre-W0 abort on child
        const releasedChild = releasePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:c-comp:2",
          proofRef: "model-fabric:inv:c-comp:2:att:c-comp:2:not-sent",
          nowMs: BASE,
        });
        expect(releasedChild.dispatchTruth).toBe("not_started");
        expect(releasedChild.releaseProofRef).toBe("model-fabric:inv:c-comp:2:att:c-comp:2:not-sent");

        // Parent state unchanged
        const parent = sidecar.prepare("SELECT state, dispatch_truth, release_proof_ref FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        expect(parent).toMatchObject({
          state: "held",
          dispatch_truth: "not_started",
          release_proof_ref: "proof:c-comp:1",
        });
      } finally {
        sidecar.close();
      }
    });

    it("CHILD_NO_SEND_DOES_NOT_REFUND_COMMITTED_PARENT", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-committed-parent");
        commitResponded(sidecar, reservationId, "comm-parent:1");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:comm:2",
          attemptId: "att:comm:2",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "structural_repair",
          nowMs: BASE,
        });
        // Child aborts before W0
        releasePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:comm:2",
          proofRef: "proof:child:not-sent",
          nowMs: BASE,
        });
        // Parent remains committed and consuming
        const parent = sidecar.prepare("SELECT state FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        expect(parent.state).toBe("committed");
        const proj = getPrivateBudgetProjection(sidecar, { policyId: POLICY, wallClockNowMs: BASE });
        expect(proj.consumingCount).toBe(1);
      } finally {
        sidecar.close();
      }
    });

    it("CHILD_NO_SEND_WITH_HELD_PARENT_AND_VALID_OWNER_PRESERVES_PARENT", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-preserve-held");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:pres:1",
          attemptId: "att:pres:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:pres:1",
          attemptId: "att:pres:1",
          proofRef: "proof:pres:1",
          nowMs: BASE,
        });
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:pres:2",
          attemptId: "att:pres:2",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "cycle_continuation",
          nowMs: BASE,
        });
        releasePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:pres:2",
          proofRef: "proof:pres-child:not-sent",
          nowMs: BASE,
        });
        // Recovery runs with valid active owner cycle/wake
        const rec = recoverPrivateBudget(sidecar, { wallClockNowMs: BASE + 1 });
        expect(rec.released).toBe(0);
        // Parent remains held with its original proof
        const parent = sidecar.prepare("SELECT state, release_proof_ref FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        expect(parent).toMatchObject({ state: "held", release_proof_ref: "proof:pres:1" });
      } finally {
        sidecar.close();
      }
    });

    it("CHILD_NO_SEND_TERMINAL_WITH_HELD_PARENT_EVENTUALLY_RELEASES_PARENT", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-terminal-held");
        const wakeId = reservationWakeId(sidecar, reservationId);
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:term:1",
          attemptId: "att:term:1",
          nowMs: BASE,
        });
        recordPrivateReservationNoDispatchProof(sidecar, {
          reservationId,
          invocationId: "inv:term:1",
          attemptId: "att:term:1",
          proofRef: "proof:term:1",
          nowMs: BASE,
        });
        bindPrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:term:2",
          attemptId: "att:term:2",
          wakeId,
          conversationId: CONVERSATION,
          ordinal: 2,
          reason: "cycle_continuation",
          nowMs: BASE,
        });
        releasePrivateRepairAttempt(sidecar, {
          reservationId,
          invocationId: "inv:term:2",
          proofRef: "proof:term-child:not-sent",
          nowMs: BASE,
        });
        // Owner wake becomes terminal
        sidecar.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'expired' WHERE wake_id = ?").run(wakeId);
        // Recovery runs
        const rec = recoverPrivateBudget(sidecar, { wallClockNowMs: BASE + 1 });
        expect(rec.released).toBe(1);
        const parent = sidecar.prepare("SELECT state, release_proof_ref FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        expect(parent).toMatchObject({ state: "released", release_proof_ref: "proof:term:1" });
      } finally {
        sidecar.close();
      }
    });

    it("MULTIPLE_WAKE_RESERVATIONS_FAIL_CLOSED", () => {
      const sidecar = db();
      try {
        const reservationId1 = reserveHeld(sidecar, "witness-multi-1");
        const wakeId = reservationWakeId(sidecar, reservationId1);
        // Inject duplicate reservation for same wakeId
        sidecar.prepare(
          `INSERT INTO private_budget_reservations
            (reservation_id, admission_id, wake_id, conversation_id, policy_id, state, policy_time_ms, invocation_id, attempt_id, dispatch_truth, release_proof_ref, created_at_ms, updated_at_ms)
           VALUES ('res:dupe:2', 'adm:dupe:2', ?, ?, ?, 'held', ?, NULL, NULL, 'not_bound', NULL, ?, ?)`
        ).run(wakeId, CONVERSATION, POLICY, BASE, BASE, BASE);

        expect(() => getPrivateReservationForWake(sidecar, wakeId)).toThrow("private_budget_wake_reservation_ambiguous");
      } finally {
        sidecar.close();
      }
    });

    it("POST_W0_TRANSPORT_FAILURE_NEVER_REFUNDS", () => {
      const sidecar = db();
      try {
        const reservationId = reserveHeld(sidecar, "witness-post-w0");
        bindPrivateReservationInvocation(sidecar, {
          reservationId,
          invocationId: "inv:post:1",
          attemptId: "att:post:1",
          nowMs: BASE,
        });
        commitPrivateDispatch(sidecar, {
          reservationId,
          invocationId: "inv:post:1",
          attemptId: "att:post:1",
          nowMs: BASE,
        });
        // Dispatched past W0: release attempt must fail
        expect(() =>
          releasePrivateReservation(sidecar, {
            reservationId,
            proofRef: "proof:impossible",
            dispatchTruth: "not_started",
            nowMs: BASE,
          }),
        ).toThrow("reservation_state_conflict");
        // State remains committed
        const res = sidecar.prepare("SELECT state FROM private_budget_reservations WHERE reservation_id = ?").get(reservationId) as Record<string, unknown>;
        expect(res.state).toBe("committed");
      } finally {
        sidecar.close();
      }
    });
  });
});
