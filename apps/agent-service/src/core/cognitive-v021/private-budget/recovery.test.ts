import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { admitWake } from "../wake/ledger.js";
import {
  bindPrivateReservationInvocation,
  commitPrivateDispatch,
  getPrivateReservation,
  markPrivateReservationUnknown,
  recordPrivateReservationNoDispatchProof,
  reservePrivateThought,
} from "./ledger.js";
import { insertDeferredFrontierRecord } from "../frontier/ledger.js";
import { reconcilePolicyClock } from "./policy-time-ledger.js";
import { recoverPrivateBudget } from "./recovery.js";

const BASE = 3_000_000;

function sidecar(): DatabaseSync {
  const db = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
  reconcilePolicyClock(db, { policyId: "private-v1", wallClockNowMs: BASE, authorizationRef: "owner:recovery-epoch" });
  return db;
}

function reservation(db: DatabaseSync, suffix: string) {
  const wake = admitWake(db, {
    occurrenceId: `occurrence:recovery:${suffix}`,
    triggerRef: `trigger:recovery:${suffix}`,
    sourceKind: "idle",
    conversationId: "conversation:recovery",
    cycleId: `cycle:recovery:${suffix}`,
    capturedAuthorityRevision: 1,
    nowMs: BASE,
  });
  const result = reservePrivateThought(db, {
    admissionId: `admission:recovery:${suffix}`,
    wakeId: wake.wake.wakeId,
    conversationId: "conversation:recovery",
    policyId: "private-v1",
    wallClockNowMs: BASE,
  });
  if (result.kind !== "reserved") throw new Error("recovery_reservation_missing");
  return result.reservation;
}

describe("private budget restart and crash recovery", () => {
  it("releases an unbound hold because the W0 binding gate was never crossed", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "unbound");
      expect(recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 })).toMatchObject({ released: 1, reconciling: 0 });
      expect(getPrivateReservation(db, item.reservationId)).toMatchObject({ state: "released", dispatchTruth: "not_started" });
    } finally {
      db.close();
    }
  });

  it("keeps a bound hold consuming when no durable receipt proves no dispatch", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "unknown");
      bindPrivateReservationInvocation(db, { reservationId: item.reservationId, invocationId: "mf-invocation:unknown", attemptId: "mf-attempt:unknown", nowMs: BASE });
      expect(recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 })).toMatchObject({ reconciling: 1 });
      expect(getPrivateReservation(db, item.reservationId)).toMatchObject({ state: "reconcile_required", dispatchTruth: "unknown" });
    } finally {
      db.close();
    }
  });

  it("uses a receipt resolver to release before-dispatch and commit after-dispatch states", () => {
    const db = sidecar();
    try {
      const notStarted = reservation(db, "receipt-not-started");
      bindPrivateReservationInvocation(db, { reservationId: notStarted.reservationId, invocationId: "mf-invocation:not-started", attemptId: "mf-attempt:not-started", nowMs: BASE });
      const attempted = reservation(db, "receipt-attempted");
      bindPrivateReservationInvocation(db, { reservationId: attempted.reservationId, invocationId: "mf-invocation:attempted", attemptId: "mf-attempt:attempted", nowMs: BASE });
      const recovered = recoverPrivateBudget(db, {
        wallClockNowMs: BASE + 1,
        resolveReceipt: (item) => item.reservationId === notStarted.reservationId
          ? { dispatchTruth: "not_started", proofRef: "mf-receipt:not-started" }
          : item.reservationId === attempted.reservationId
            ? { dispatchTruth: "attempted" }
            : null,
      });
      expect(recovered).toMatchObject({ released: 1, committed: 1 });
      expect(getPrivateReservation(db, notStarted.reservationId)).toMatchObject({ state: "released" });
      expect(getPrivateReservation(db, attempted.reservationId)).toMatchObject({ state: "committed", dispatchTruth: "attempted" });
    } finally {
      db.close();
    }
  });

  it("can settle an already-reconciling reservation only with the exact bound receipt", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "reconcile-attempted");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-invocation:reconcile-attempted",
        attemptId: "mf-attempt:reconcile-attempted",
        nowMs: BASE,
      });
      markPrivateReservationUnknown(db, item.reservationId, { nowMs: BASE + 1 });
      expect(recoverPrivateBudget(db, {
        wallClockNowMs: BASE + 2,
        resolveReceipt: (candidate) => candidate.reservationId === item.reservationId
          ? { dispatchTruth: "attempted" }
          : null,
      })).toMatchObject({ committed: 1, released: 0, reconciling: 0 });
      expect(getPrivateReservation(db, item.reservationId)).toMatchObject({ state: "committed", dispatchTruth: "attempted" });
    } finally {
      db.close();
    }
  });

  it("preserves the rolling-hour consumption across restart and expires committed work only at the boundary", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "restart");
      bindPrivateReservationInvocation(db, { reservationId: item.reservationId, invocationId: "mf-invocation:restart", attemptId: "mf-attempt:restart", nowMs: BASE });
      commitPrivateDispatch(db, { reservationId: item.reservationId, invocationId: "mf-invocation:restart", attemptId: "mf-attempt:restart", nowMs: BASE });
      expect(recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 })).toMatchObject({ released: 0, committed: 0, reconciling: 0 });
      expect(getPrivateReservation(db, item.reservationId)).toMatchObject({ state: "committed" });
      expect(recoverPrivateBudget(db, { wallClockNowMs: BASE + 3_600_000 })).toMatchObject({ expired: 1 });
      expect(getPrivateReservation(db, item.reservationId)).toMatchObject({ state: "expired" });
    } finally {
      db.close();
    }
  });
});

describe("F1 Sol R2.1 Continuation Owner & Recovery Witnesses", () => {
  it("MISSING_WAKE_WITH_PROVEN_NO_SEND_DOES_NOT_RELEASE", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "missing-wake");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:mw:1",
        attemptId: "mf-att:mw:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:mw:1",
        attemptId: "mf-att:mw:1",
        proofRef: "proof:mw:1",
        nowMs: BASE,
      });
      // Point reservation to missing wake (disable FK temporarily to simulate orphaned wake_id)
      db.exec("PRAGMA foreign_keys = OFF");
      db.prepare("UPDATE private_budget_reservations SET wake_id = 'wake:non-existent' WHERE reservation_id = ?").run(item.reservationId);
      db.exec("PRAGMA foreign_keys = ON");

      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 });
      expect(recovered.released).toBe(0);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({ state: "held", dispatchTruth: "not_started", releaseProofRef: "proof:mw:1" });
    } finally {
      db.close();
    }
  });

  it("MISSING_CYCLE_WITH_PROVEN_NO_SEND_DOES_NOT_RELEASE", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "missing-cycle");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:mc:1",
        attemptId: "mf-att:mc:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:mc:1",
        attemptId: "mf-att:mc:1",
        proofRef: "proof:mc:1",
        nowMs: BASE,
      });
      // Point wake to missing cycle
      db.prepare("UPDATE wakes SET cycle_id = 'cycle:non-existent' WHERE wake_id = ?").run(item.wakeId);

      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 });
      expect(recovered.released).toBe(0);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({ state: "held", dispatchTruth: "not_started", releaseProofRef: "proof:mc:1" });
    } finally {
      db.close();
    }
  });

  it("WAKE_CYCLE_IDENTITY_CONFLICT_DOES_NOT_RELEASE", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "conflict-identity");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:ci:1",
        attemptId: "mf-att:ci:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:ci:1",
        attemptId: "mf-att:ci:1",
        proofRef: "proof:ci:1",
        nowMs: BASE,
      });
      // Mismatch conversation on cycle
      const wake = db.prepare("SELECT cycle_id FROM wakes WHERE wake_id = ?").get(item.wakeId) as { cycle_id: string };
      db.prepare("UPDATE cycle_records SET conversation_id = 'conversation:mismatch' WHERE cycle_id = ?").run(wake.cycle_id);

      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 });
      expect(recovered.released).toBe(0);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({ state: "held", dispatchTruth: "not_started", releaseProofRef: "proof:ci:1" });
    } finally {
      db.close();
    }
  });

  it("EXACT_PROVEN_NO_OWNER_RELEASES", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "proven-no-owner");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:pno:1",
        attemptId: "mf-att:pno:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:pno:1",
        attemptId: "mf-att:pno:1",
        proofRef: "proof:pno:1",
        nowMs: BASE,
      });
      // Mark wake terminal
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'expired' WHERE wake_id = ?").run(item.wakeId);

      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 });
      expect(recovered.released).toBe(1);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({ state: "released", dispatchTruth: "not_started", releaseProofRef: "proof:pno:1" });
    } finally {
      db.close();
    }
  });

  it("EXACT_VALID_OWNER_PRESERVES", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "valid-owner");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:vo:1",
        attemptId: "mf-att:vo:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:vo:1",
        attemptId: "mf-att:vo:1",
        proofRef: "proof:vo:1",
        nowMs: BASE,
      });

      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 });
      expect(recovered.released).toBe(0);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({ state: "held", dispatchTruth: "not_started", releaseProofRef: "proof:vo:1" });
    } finally {
      db.close();
    }
  });

  it("COMPOSE_NO_SEND_SURVIVES_CRASH_WHEN_EXACT_DURABLE_OWNER_REMAINS", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "compose-survives");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:cs:1",
        attemptId: "mf-att:cs:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:cs:1",
        attemptId: "mf-att:cs:1",
        proofRef: "model-fabric:mf-inv:cs:1:mf-att:cs:1:not-sent",
        nowMs: BASE,
      });

      // Simulate crash recovery
      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 10 });
      expect(recovered.released).toBe(0);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({
        state: "held",
        dispatchTruth: "not_started",
        releaseProofRef: "model-fabric:mf-inv:cs:1:mf-att:cs:1:not-sent",
      });
    } finally {
      db.close();
    }
  });

  it("PROVEN_NO_SEND_WITH_NO_CONTINUATION_OWNER_RELEASES", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "proven-no-owner-2");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:pno2:1",
        attemptId: "mf-att:pno2:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:pno2:1",
        attemptId: "mf-att:pno2:1",
        proofRef: "proof:pno2:1",
        nowMs: BASE,
      });
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'expired' WHERE wake_id = ?").run(item.wakeId);

      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 });
      expect(recovered.released).toBe(1);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({ state: "released", releaseProofRef: "proof:pno2:1" });
    } finally {
      db.close();
    }
  });

  it("UNRELATED_FRONTIER_SAME_CONVERSATION_DOES_NOT_PRESERVE_RESERVATION", () => {
    const db = sidecar();
    try {
      const item = reservation(db, "unrelated-frontier");
      bindPrivateReservationInvocation(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:uf:1",
        attemptId: "mf-att:uf:1",
        nowMs: BASE,
      });
      recordPrivateReservationNoDispatchProof(db, {
        reservationId: item.reservationId,
        invocationId: "mf-inv:uf:1",
        attemptId: "mf-att:uf:1",
        proofRef: "proof:uf:1",
        nowMs: BASE,
      });
      // The reservation's own wake is terminal
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'expired' WHERE wake_id = ?").run(item.wakeId);

      // Create an active deferred frontier for an UNRELATED cycle in the same conversation
      insertDeferredFrontierRecord(db, {
        conversationId: "conversation:recovery",
        cycleId: "cycle:completely-different",
        generation: 1,
        nextEligibleAtMs: BASE + 50_000,
        latestEvidenceRowId: "ev:1",
        nowMs: BASE,
      });

      // Recovery MUST release the item because item's owner is terminal (unrelated frontier does NOT preserve it)
      const recovered = recoverPrivateBudget(db, { wallClockNowMs: BASE + 1 });
      expect(recovered.released).toBe(1);
      const res = getPrivateReservation(db, item.reservationId);
      expect(res).toMatchObject({ state: "released" });
    } finally {
      db.close();
    }
  });
});
