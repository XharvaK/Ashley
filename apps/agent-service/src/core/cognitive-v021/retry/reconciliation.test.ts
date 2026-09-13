import { describe, expect, it, vi } from "vitest";
import { recordEffectReceipt, putInFlight } from "../effect/in-flight.js";
import { admitWake } from "../wake/ledger.js";
import type { EffectReceipt } from "../types.js";
import { openTestSidecar } from "../test-support.js";
import { createRepairEvent, reconcileOutcomeUnknown, startDurableAttempt, settleDurableAttempt, claimNextDurableWork } from "./ledger.js";
import {
  reservePrivateThought,
  bindPrivateReservationInvocation,
  recordPrivateReservationNoDispatchProof,
  commitPrivateDispatch,
  bindPrivateRepairAttempt,
  commitPrivateRepairDispatch,
  markPrivateReservationUnknown,
  releasePrivateReservation,
  getPrivateReservation,
} from "../private-budget/ledger.js";
import { reconcilePolicyClock } from "../private-budget/policy-time-ledger.js";

function seedEvent(db: ReturnType<typeof openTestSidecar>, id: string): string {
  const admitted = admitWake(db, {
    occurrenceId: `occurrence:${id}`,
    triggerRef: `trigger:${id}`,
    sourceKind: "inbox",
    conversationId: `conversation:${id}`,
    cycleId: `cycle:${id}`,
    capturedAuthorityRevision: 1,
    nowMs: 1,
  });
  db.prepare(
    `INSERT INTO inbox_events
       (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
     VALUES (?, ?, 'test', '{}', 1, 'pending', ?)`,
  ).run(id, `conversation:${id}`, admitted.wake.wakeId);
  return admitted.wake.wakeId;
}

describe("durable retry reconciliation", () => {
  it("does not replay an unknown outcome without proof, then closes on a receipt", () => {
    const db = openTestSidecar();
    try {
      const wakeId = seedEvent(db, "event:unknown");
      const started = startDurableAttempt(db, { eventId: "event:unknown", workerId: "worker", nowMs: 1_000 });
      settleDurableAttempt(db, {
        eventId: "event:unknown",
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:unknown", errorCode: "timeout" },
        nowMs: 1_100,
      });
      putInFlight(db, {
        effectId: "effect:unknown",
        cycleId: "cycle:event:unknown",
        generation: 1,
        wakeId,
        correlationId: "correlation:unknown",
        idempotencyKey: "idempotency:unknown",
        dispatchedAtMs: 1_050,
        originEventId: "event:unknown",
        originAttemptId: started.attemptId,
      });

      expect(reconcileOutcomeUnknown(db, { eventId: "event:unknown", nowMs: 1_200 })).toEqual({
        kind: "pending",
        reason: "outcome_still_unknown",
        eventId: "event:unknown",
      });
      expect(db.prepare("SELECT state FROM inbox_events WHERE id = 'event:unknown'").get()).toMatchObject({ state: "reconciling" });

      const receipt: EffectReceipt = {
        receiptId: "receipt:unknown",
        effectId: "effect:unknown",
        idempotencyKey: "idempotency:unknown",
        outcome: "succeeded",
        claims: { referenceOnly: true },
        atMs: 1_300,
        dataClassification: "never_public",
        secretOmitted: true,
      };
      recordEffectReceipt(db, receipt);
      expect(reconcileOutcomeUnknown(db, { eventId: "event:unknown", nowMs: 1_400 })).toEqual({
        kind: "terminal",
        reason: "completed",
        eventId: "event:unknown",
      });
      expect(db.prepare("SELECT state, status, terminal_reason FROM inbox_events WHERE id = 'event:unknown'").get()).toMatchObject({ state: "terminal", status: "consumed", terminal_reason: "completed" });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({ state: "terminal", terminal_reason: "completed" });

      expect(reconcileOutcomeUnknown(db, { eventId: "event:unknown", nowMs: 1_500 })).toEqual({
        kind: "terminal",
        reason: "completed",
        eventId: "event:unknown",
      });
    } finally {
      db.close();
    }
  });

  it("returns the same event to pending only with an explicit no-dispatch proof", () => {
    const db = openTestSidecar();
    try {
      const wakeId = seedEvent(db, "event:no-dispatch");
      const started = startDurableAttempt(db, { eventId: "event:no-dispatch", workerId: "worker", nowMs: 1_000 });
      settleDurableAttempt(db, {
        eventId: "event:no-dispatch",
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:no-dispatch", errorCode: "worker_crash" },
        nowMs: 1_100,
      });

      expect(reconcileOutcomeUnknown(db, {
        eventId: "event:no-dispatch",
        nowMs: 1_200,
        noExternalDispatchProof: true,
        proofRef: "proof:no-dispatch",
      })).toEqual({ kind: "pending", reason: "safe_to_retry", eventId: "event:no-dispatch" });
      expect(db.prepare("SELECT state, status FROM inbox_events WHERE id = 'event:no-dispatch'").get()).toMatchObject({ state: "pending", status: "pending" });
      expect(db.prepare("SELECT state, lease_token FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({ state: "pending", lease_token: null });

      const retry = startDurableAttempt(db, { eventId: "event:no-dispatch", workerId: "worker-2", nowMs: 1_201 });
      expect(retry.ordinal).toBe(2);
      expect(retry.wakeId).toBe(wakeId);
    } finally {
      db.close();
    }
  });

  it("creates an authorized repair event without rewriting the predecessor", () => {
    const db = openTestSidecar();
    try {
      const wakeId = seedEvent(db, "event:repair");
      const started = startDurableAttempt(db, { eventId: "event:repair", workerId: "worker", nowMs: 1_000 });
      settleDurableAttempt(db, {
        eventId: "event:repair",
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:repair", errorCode: "timeout" },
        nowMs: 1_100,
      });

      const repair = createRepairEvent(db, {
        predecessorEventId: "event:repair",
        authorizationRef: "owner-review:repair-1",
        nowMs: 1_200,
        payload: { referenceOnly: true },
      });
      const duplicate = createRepairEvent(db, {
        predecessorEventId: "event:repair",
        authorizationRef: "owner-review:repair-1",
        nowMs: 1_300,
      });
      expect(duplicate.id).toBe(repair.id);
      expect(repair.id).not.toBe("event:repair");
      expect(repair.wakeId).not.toBe(wakeId);
      expect(db.prepare("SELECT state FROM inbox_events WHERE id = 'event:repair'").get()).toMatchObject({ state: "reconciling" });
      expect(db.prepare("SELECT predecessor_event_id, authorization_ref FROM durable_work_repairs WHERE repair_event_id = ?").get(repair.id)).toMatchObject({ predecessor_event_id: "event:repair", authorization_ref: "owner-review:repair-1" });
    } finally {
      db.close();
    }
  });

  it("enforces multi-effect reconciliation rule over exact bound effects", () => {
    const db = openTestSidecar();
    try {
      const wakeId = seedEvent(db, "event:multi");
      const started = startDurableAttempt(db, { eventId: "event:multi", workerId: "worker", nowMs: 1_000 });
      settleDurableAttempt(db, {
        eventId: "event:multi",
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:multi", errorCode: "timeout" },
        nowMs: 1_100,
      });

      // Bind 2 effects to this event (e.g. across two attempts)
      const wake2 = seedEvent(db, "event:multi-attempt-2");
      putInFlight(db, {
        effectId: "effect:multi-1",
        cycleId: "cycle:event:multi",
        generation: 1,
        wakeId,
        correlationId: "corr:multi-1",
        idempotencyKey: "idem:multi-1",
        dispatchedAtMs: 1_050,
        originEventId: "event:multi",
      });
      putInFlight(db, {
        effectId: "effect:multi-2",
        cycleId: "cycle:event:multi-attempt-2",
        generation: 2,
        wakeId: wake2,
        correlationId: "corr:multi-2",
        idempotencyKey: "idem:multi-2",
        dispatchedAtMs: 1_050,
        originEventId: "event:multi",
      });

      // Case 1: One succeeded, one missing receipt -> pending
      recordEffectReceipt(db, {
        receiptId: "rec:multi-1",
        effectId: "effect:multi-1",
        idempotencyKey: "idem:multi-1",
        outcome: "succeeded",
        claims: {},
        atMs: 1_200,
        dataClassification: "never_public",
        secretOmitted: false,
      });
      expect(reconcileOutcomeUnknown(db, { eventId: "event:multi", nowMs: 1_250 })).toEqual({
        kind: "pending",
        reason: "outcome_still_unknown",
        eventId: "event:multi",
      });

      // Case 2: One succeeded, one outcome_unknown -> pending
      recordEffectReceipt(db, {
        receiptId: "rec:multi-2",
        effectId: "effect:multi-2",
        idempotencyKey: "idem:multi-2",
        outcome: "outcome_unknown",
        claims: {},
        atMs: 1_300,
        dataClassification: "never_public",
        secretOmitted: false,
      });
      expect(reconcileOutcomeUnknown(db, { eventId: "event:multi", nowMs: 1_350 })).toEqual({
        kind: "pending",
        reason: "outcome_still_unknown",
        eventId: "event:multi",
      });

      // Case 3: Update effect 2 receipt to succeeded -> all succeeded -> completed
      db.prepare("UPDATE effect_receipts SET outcome = 'succeeded' WHERE receipt_id = 'rec:multi-2'").run();
      expect(reconcileOutcomeUnknown(db, { eventId: "event:multi", nowMs: 1_400 })).toEqual({
        kind: "terminal",
        reason: "completed",
        eventId: "event:multi",
      });
    } finally {
      db.close();
    }
  });

  it("walks predecessor repair lineage and does not leak wake-wide effects", () => {
    const db = openTestSidecar();
    try {
      const wakeId = seedEvent(db, "event:pred");
      const started = startDurableAttempt(db, { eventId: "event:pred", workerId: "worker", nowMs: 1_000 });
      settleDurableAttempt(db, {
        eventId: "event:pred",
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:pred", errorCode: "timeout" },
        nowMs: 1_100,
      });

      // Effect is bound to predecessor event
      putInFlight(db, {
        effectId: "effect:pred",
        cycleId: "cycle:event:pred",
        generation: 1,
        wakeId,
        correlationId: "corr:pred",
        idempotencyKey: "idem:pred",
        dispatchedAtMs: 1_050,
        originEventId: "event:pred",
      });
      recordEffectReceipt(db, {
        receiptId: "rec:pred",
        effectId: "effect:pred",
        idempotencyKey: "idem:pred",
        outcome: "succeeded",
        claims: {},
        atMs: 1_150,
        dataClassification: "never_public",
        secretOmitted: false,
      });

      // Create repair event
      const repair = createRepairEvent(db, {
        predecessorEventId: "event:pred",
        authorizationRef: "auth:repair-lineage",
        nowMs: 1_200,
        payload: {},
      });

      // Mark repair event as reconciling
      db.prepare("UPDATE inbox_events SET state = 'reconciling' WHERE id = ?").run(repair.id);

      // Reconciling the repair event walks predecessor and finds effect:pred succeeded
      expect(reconcileOutcomeUnknown(db, { eventId: repair.id, nowMs: 1_250 })).toEqual({
        kind: "terminal",
        reason: "completed",
        eventId: repair.id,
      });
    } finally {
      db.close();
    }
  });
});

describe("P0 spend-aware outcome-unknown partition (R7 §22.2)", () => {
  const POLICY = "private-v1";
  const BASE = 2_000_000;

  function seedPrivateStranded(
    db: ReturnType<typeof openTestSidecar>,
    tag: string,
    options: { periodic?: boolean; payload?: Record<string, unknown> } = {},
  ): { eventId: string; wakeId: string; conversationId: string } {
    const conversationId = `conversation:part:${tag}`;
    const triggerRef = options.periodic ? `periodic:occurrence:${tag}:${BASE}` : `trigger:part:${tag}`;
    const admitted = admitWake(db, {
      occurrenceId: `occurrence:part:${tag}`,
      triggerRef,
      sourceKind: "inbox",
      conversationId,
      cycleId: `cycle:part:${tag}`,
      capturedAuthorityRevision: 1,
      nowMs: 1,
    });
    const wakeId = admitted.wake.wakeId;
    const eventId = `event:part:${tag}`;
    db.prepare(
      `INSERT INTO inbox_events
         (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
       VALUES (?, ?, 'test', ?, 1, 'pending', ?)`,
    ).run(eventId, conversationId, JSON.stringify(options.payload ?? {}), wakeId);
    return { eventId, wakeId, conversationId };
  }

  function strand(db: ReturnType<typeof openTestSidecar>, eventId: string): void {
    const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs: BASE });
    settleDurableAttempt(db, {
      eventId,
      attemptId: started.attemptId,
      claimToken: started.claimToken,
      result: { kind: "outcome_unknown", operationId: `operation:${eventId}`, errorCode: "worker_crash" },
      nowMs: BASE + 100,
    });
  }

  function reserve(db: ReturnType<typeof openTestSidecar>, wakeId: string, conversationId: string, tag: string) {
    const result = reservePrivateThought(db, {
      admissionId: `adm:part:${tag}`,
      wakeId,
      conversationId,
      policyId: POLICY,
      wallClockNowMs: BASE,
    });
    if (result.kind !== "reserved") throw new Error(`reserve_failed:${tag}`);
    return result.reservation;
  }

  it("OWNER_OUTCOME_UNKNOWN_PROOF_PASS_SAFE_TO_RETRY_UNCHANGED", () => {
    const db = openTestSidecar();
    try {
      const { eventId, wakeId } = seedPrivateStranded(db, "owner");
      strand(db, eventId);
      expect(reconcileOutcomeUnknown(db, {
        eventId,
        nowMs: BASE + 200,
        noExternalDispatchProof: true,
        proofRef: "proof:owner",
      })).toEqual({ kind: "pending", reason: "safe_to_retry", eventId });
      expect(db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({ state: "pending" });
      expect(db.prepare("SELECT state FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({ state: "pending" });
      // Fresh Owner Thought retry remains legal on the same lineage.
      const retry = startDurableAttempt(db, { eventId, workerId: "worker-2", nowMs: BASE + 201 });
      expect(retry.ordinal).toBe(2);
      expect(retry.wakeId).toBe(wakeId);
    } finally {
      db.close();
    }
  });

  it("PRIVATE_NOT_SPENT_SAME_LINEAGE_CONTINUES", () => {
    const db = openTestSidecar();
    try {
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:part-b" });
      const { wakeId, conversationId } = seedPrivateStranded(db, "b");
      const reservation = reserve(db, wakeId, conversationId, "b");
      const eventId = "event:part:b";
      db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
        JSON.stringify({ privateBudgetReservationId: reservation.reservationId }),
        eventId,
      );
      const reservationsBefore = (db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count;
      strand(db, eventId);
      expect(reconcileOutcomeUnknown(db, {
        eventId,
        nowMs: BASE + 200,
        noExternalDispatchProof: true,
        proofRef: "proof:part-b",
      })).toEqual({ kind: "pending", reason: "safe_to_retry", eventId });
      // Same lineage, no new reservation, binding intact.
      expect(getPrivateReservation(db, reservation.reservationId)).toMatchObject({ state: "held", dispatchTruth: "not_bound" });
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(reservationsBefore);
      const retry = startDurableAttempt(db, { eventId, workerId: "worker-2", nowMs: BASE + 201 });
      expect(retry.wakeId).toBe(wakeId);
    } finally {
      db.close();
    }
  });

  it("PERIODIC_COMMITTED_PUBLICATION_FAILURE_NO_RETHOUGHT", () => {
    const db = openTestSidecar();
    try {
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:part-c" });
      const { wakeId, conversationId } = seedPrivateStranded(db, "c", { periodic: true });
      const reservation = reserve(db, wakeId, conversationId, "c");
      bindPrivateReservationInvocation(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:c",
        attemptId: "attempt:part:c",
        nowMs: BASE,
      });
      commitPrivateDispatch(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:c",
        attemptId: "attempt:part:c",
        nowMs: BASE,
      });
      const eventId = "event:part:c";
      db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
        JSON.stringify({ privateBudgetReservationId: reservation.reservationId }),
        eventId,
      );
      const inboxBefore = (db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get() as { count: number }).count;
      strand(db, eventId);
      // Semantic publication proven absent, provider SPENT: terminal Failure
      // Truth, never a second Thought/reservation/replay.
      expect(reconcileOutcomeUnknown(db, {
        eventId,
        nowMs: BASE + 200,
        noExternalDispatchProof: true,
        proofRef: "proof:part-c",
      })).toEqual({ kind: "terminal", reason: "permanent_failure", eventId });
      expect(db.prepare("SELECT state, status, terminal_reason, last_error FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        state: "terminal",
        status: "failed_terminal",
        terminal_reason: "permanent_failure",
        last_error: "private_spent_no_rethought:committed",
      });
      expect(db.prepare("SELECT state FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({ state: "terminal" });
      expect(getPrivateReservation(db, reservation.reservationId)).toMatchObject({ state: "committed" });
      expect((db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get() as { count: number }).count).toBe(inboxBefore);
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM settlements").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("PRIVATE_SPENT_CHILD_ATTEMPT_NEVER_RETHOUGHT", () => {
    const db = openTestSidecar();
    try {
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:part-child" });
      const { wakeId, conversationId } = seedPrivateStranded(db, "child");
      const reservation = reserve(db, wakeId, conversationId, "child");
      bindPrivateReservationInvocation(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:child:1",
        attemptId: "attempt:part:child:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:child:1",
        attemptId: "attempt:part:child:1",
        proofRef: "proof:part:child:no-dispatch",
        nowMs: BASE,
      });
      bindPrivateRepairAttempt(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:child:2",
        attemptId: "attempt:part:child:2",
        wakeId,
        conversationId,
        ordinal: 2,
        reason: "structural_repair",
        nowMs: BASE,
      });
      commitPrivateRepairDispatch(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:child:2",
        nowMs: BASE,
      });
      const eventId = "event:part:child";
      db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
        JSON.stringify({ privateBudgetReservationId: reservation.reservationId }),
        eventId,
      );
      strand(db, eventId);
      expect(reconcileOutcomeUnknown(db, {
        eventId,
        nowMs: BASE + 200,
        noExternalDispatchProof: true,
        proofRef: "proof:part-child",
      })).toEqual({ kind: "terminal", reason: "permanent_failure", eventId });
      expect(db.prepare("SELECT last_error FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({
        last_error: expect.stringContaining("private_spent_no_rethought"),
      });
    } finally {
      db.close();
    }
  });

  it("PRIVATE_UNCERTAIN_STAYS_FENCED", () => {
    for (const tag of ["unknown", "released"] as const) {
      const db = openTestSidecar();
      try {
        reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: `owner:part-d:${tag}` });
        const { wakeId, conversationId } = seedPrivateStranded(db, `d-${tag}`);
        const reservation = reserve(db, wakeId, conversationId, `d-${tag}`);
        bindPrivateReservationInvocation(db, {
          reservationId: reservation.reservationId,
          invocationId: `invocation:part:d:${tag}`,
          attemptId: `attempt:part:d:${tag}`,
          nowMs: BASE,
        });
        if (tag === "unknown") {
          markPrivateReservationUnknown(db, reservation.reservationId, { nowMs: BASE });
        } else {
          releasePrivateReservation(db, {
            reservationId: reservation.reservationId,
            proofRef: `proof:part:d:${tag}`,
            dispatchTruth: "not_started",
            nowMs: BASE,
          });
        }
        const eventId = `event:part:d-${tag}`;
        db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
          JSON.stringify({ privateBudgetReservationId: reservation.reservationId }),
          eventId,
        );
        strand(db, eventId);
        expect(reconcileOutcomeUnknown(db, {
          eventId,
          nowMs: BASE + 200,
          noExternalDispatchProof: true,
          proofRef: `proof:part-d:${tag}`,
        })).toEqual({ kind: "pending", reason: "outcome_still_unknown", eventId });
        expect(db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({ state: "reconciling" });
      } finally {
        db.close();
      }
    }
  });

  it("PERIODIC_RECOVERED_PREDISPATCH_ENABLED_CONTINUES_SAME_LINEAGE", () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "true");
    const db = openTestSidecar();
    try {
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:part-enabled" });
      const { eventId, wakeId, conversationId } = seedPrivateStranded(db, "enabled", { periodic: true });
      const reservation = reserve(db, wakeId, conversationId, "enabled");
      db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
        JSON.stringify({ privateBudgetReservationId: reservation.reservationId }),
        eventId,
      );
      strand(db, eventId);
      expect(reconcileOutcomeUnknown(db, {
        eventId,
        nowMs: BASE + 200,
        noExternalDispatchProof: true,
        proofRef: "proof:part-enabled",
      })).toEqual({ kind: "pending", reason: "safe_to_retry", eventId });
      expect(getPrivateReservation(db, reservation.reservationId)).toMatchObject({ state: "held" });
      expect(db.prepare("SELECT wake_id FROM inbox_events WHERE id = ?").get(eventId)).toMatchObject({ wake_id: wakeId });
    } finally {
      db.close();
      vi.unstubAllEnvs();
    }
  });

  it("PERIODIC_BOUND_OUTCOME_UNKNOWN_CONVERGES_WITHOUT_ORPHAN", () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "0");
    const db = openTestSidecar();
    try {
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:part-orphan" });
      const { eventId, wakeId, conversationId } = seedPrivateStranded(db, "orphan", { periodic: true });
      const reservation = reserve(db, wakeId, conversationId, "orphan");
      db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
        JSON.stringify({ privateBudgetReservationId: reservation.reservationId }),
        eventId,
      );
      strand(db, eventId);
      expect(reconcileOutcomeUnknown(db, {
        eventId,
        nowMs: BASE + 200,
        noExternalDispatchProof: true,
        proofRef: "proof:part-orphan",
      })).toEqual({ kind: "pending", reason: "safe_to_retry", eventId });
      // Same lineage adopted: no repair/orphan rows minted, binding intact.
      expect((db.prepare("SELECT COUNT(*) AS count FROM durable_work_repairs").get() as { count: number }).count).toBe(0);
      expect(getPrivateReservation(db, reservation.reservationId)).toMatchObject({ state: "held" });
      const retry = claimNextDurableWork(db, { workerId: "worker-2", eventId, nowMs: BASE + 201 });
      expect(retry?.wakeId).toBe(wakeId);
    } finally {
      db.close();
      vi.unstubAllEnvs();
    }
  });

  it("KILL_SWITCH_TERMINAL_NO_DISPATCH_CAN_CLOSE", () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "");
    const db = openTestSidecar();
    try {
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:part-term" });
      const { eventId, wakeId, conversationId } = seedPrivateStranded(db, "term", { periodic: true });
      const reservation = reserve(db, wakeId, conversationId, "term");
      bindPrivateReservationInvocation(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:term",
        attemptId: "attempt:part:term",
        nowMs: BASE,
      });
      commitPrivateDispatch(db, {
        reservationId: reservation.reservationId,
        invocationId: "invocation:part:term",
        attemptId: "attempt:part:term",
        nowMs: BASE,
      });
      db.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
        JSON.stringify({ privateBudgetReservationId: reservation.reservationId }),
        eventId,
      );
      strand(db, eventId);
      // Terminal truth closes while disabled: receipt/bookkeeping completes,
      // zero new provider dispatch (no settlement/outbox fabricated here).
      expect(reconcileOutcomeUnknown(db, {
        eventId,
        nowMs: BASE + 200,
        noExternalDispatchProof: true,
        proofRef: "proof:part-term",
      })).toEqual({ kind: "terminal", reason: "permanent_failure", eventId });
      expect((db.prepare("SELECT COUNT(*) AS count FROM settlements").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get() as { count: number }).count).toBe(0);
      expect(db.prepare("SELECT state FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({ state: "terminal" });
    } finally {
      db.close();
      vi.unstubAllEnvs();
    }
  });
});
