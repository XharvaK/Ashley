import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { admitWake } from "../wake/ledger.js";
import {
  bindPrivateReservationInvocation,
  commitPrivateDispatch,
  getPrivateReservation,
  markPrivateReservationUnknown,
  recordPrivateProviderResponse,
  releasePrivateReservation,
  reservePrivateThought,
} from "./ledger.js";
import { reconcilePolicyClock } from "./policy-time-ledger.js";

const BASE = 2_000_000;

function db(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
}

function reserveOne(sidecar: DatabaseSync, suffix: string) {
  const wake = admitWake(sidecar, {
    occurrenceId: `occurrence:binding:${suffix}`,
    triggerRef: `trigger:binding:${suffix}`,
    sourceKind: "idle",
    conversationId: "conversation:binding",
    cycleId: `cycle:binding:${suffix}`,
    capturedAuthorityRevision: 1,
    nowMs: BASE,
  });
  const result = reservePrivateThought(sidecar, {
    admissionId: `admission:binding:${suffix}`,
    wakeId: wake.wake.wakeId,
    conversationId: "conversation:binding",
    policyId: "private-v1",
    wallClockNowMs: BASE,
  });
  if (result.kind !== "reserved") throw new Error("binding_reservation_missing");
  return result.reservation;
}

function setup(): DatabaseSync {
  const sidecar = db();
  reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: BASE, authorizationRef: "owner:binding-epoch" });
  return sidecar;
}

describe("private budget W0 dispatch binding", () => {
  it("binds one exact invocation, makes duplicate callbacks idempotent, and commits at dispatch attempt", () => {
    const sidecar = setup();
    try {
      const reservation = reserveOne(sidecar, "exact");
      const bound = bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "mf-invocation:exact",
        attemptId: "mf-attempt:exact",
        nowMs: BASE + 1,
      });
      expect(bound).toMatchObject({ invocationId: "mf-invocation:exact", attemptId: "mf-attempt:exact", dispatchTruth: "not_started", state: "held" });
      expect(bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "mf-invocation:exact",
        attemptId: "mf-attempt:exact",
        nowMs: BASE + 2,
      })).toEqual(expect.objectContaining({ state: "held" }));
      expect(commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "mf-invocation:exact",
        attemptId: "mf-attempt:exact",
        nowMs: BASE + 3,
      })).toMatchObject({ state: "committed", dispatchTruth: "attempted" });
      expect(commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "mf-invocation:exact",
        attemptId: "mf-attempt:exact",
        nowMs: BASE + 4,
      })).toMatchObject({ state: "committed" });
      expect(recordPrivateProviderResponse(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "mf-invocation:exact",
        attemptId: "mf-attempt:exact",
        nowMs: BASE + 5,
      })).toMatchObject({ state: "committed", dispatchTruth: "responded" });
      expect(() => releasePrivateReservation(sidecar, {
        reservationId: reservation.reservationId,
        proofRef: "forged:no-dispatch",
        dispatchTruth: "not_started",
        invocationId: "mf-invocation:exact",
        attemptId: "mf-attempt:exact",
        nowMs: BASE + 6,
      })).toThrow("reservation_state_conflict");
    } finally {
      sidecar.close();
    }
  });

  it("rejects conflicting invocation bindings and does not accept forged release proof", () => {
    const sidecar = setup();
    try {
      const reservation = reserveOne(sidecar, "conflict");
      bindPrivateReservationInvocation(sidecar, { reservationId: reservation.reservationId, invocationId: "mf-invocation:one", attemptId: "mf-attempt:one", nowMs: BASE });
      expect(() => bindPrivateReservationInvocation(sidecar, { reservationId: reservation.reservationId, invocationId: "mf-invocation:two", attemptId: "mf-attempt:two", nowMs: BASE })).toThrow("invocation_binding_conflict");
      expect(() => releasePrivateReservation(sidecar, { reservationId: reservation.reservationId, proofRef: "", dispatchTruth: "not_started" })).toThrow("release_proof_missing");
      expect(() => releasePrivateReservation(sidecar, { reservationId: reservation.reservationId, proofRef: "not-started-without-explicit-truth" })).toThrow("release_proof_missing");
      markPrivateReservationUnknown(sidecar, reservation.reservationId, { nowMs: BASE + 1 });
      expect(getPrivateReservation(sidecar, reservation.reservationId)).toMatchObject({ state: "reconcile_required", dispatchTruth: "unknown" });
      expect(releasePrivateReservation(sidecar, {
        reservationId: reservation.reservationId,
        proofRef: "receipt:reconciled-not-started",
        dispatchTruth: "not_started",
        invocationId: "mf-invocation:one",
        attemptId: "mf-attempt:one",
        nowMs: BASE + 2,
      })).toMatchObject({ state: "released", dispatchTruth: "not_started", releaseProofRef: "receipt:reconciled-not-started" });
    } finally {
      sidecar.close();
    }
  });

  it("prevents one invocation from binding two reservations", () => {
    const sidecar = setup();
    try {
      const first = reserveOne(sidecar, "one");
      const second = reserveOne(sidecar, "two");
      bindPrivateReservationInvocation(sidecar, { reservationId: first.reservationId, invocationId: "mf-invocation:duplicate", attemptId: "mf-attempt:one", nowMs: BASE });
      expect(() => bindPrivateReservationInvocation(sidecar, { reservationId: second.reservationId, invocationId: "mf-invocation:duplicate", attemptId: "mf-attempt:two", nowMs: BASE })).toThrow("invocation_binding_conflict");
    } finally {
      sidecar.close();
    }
  });
});
