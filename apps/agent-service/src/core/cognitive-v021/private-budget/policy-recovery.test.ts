// Recovery conserves a reservation when its admitted policy evidence is unavailable.
import { describe, expect, it, vi } from "vitest";
import { COGNITIVE_SIDECAR_SCHEMA_V53 } from "../sidecar/schema.js";
import { DEFAULT_BUDGET_SNAPSHOT } from "./policies.js";
import { openTestSidecar, setTestSidecarVersion } from "../test-support.js";
import { admitWake } from "../wake/ledger.js";
import { configureBudgetPolicy } from "./policies.js";
import { bindPrivateReservationInvocation, bindPrivateRepairAttempt, commitPrivateDispatch, recordPrivateProviderResponse, reservePrivateThought, getPrivateBudgetProjection, getPrivateReservation } from "./ledger.js";
import { recoverPrivateBudget } from "./recovery.js";
const BASE = 2_000_000;
const daily = { policyId: "fixture.daily", version: 1, limit: 1, windowMs: 86_400_000, clockDiscontinuityMs: 600_000 };
const hourly = { policyId: "fixture.hourly", version: 1, limit: 2, windowMs: 3_600_000, clockDiscontinuityMs: 300_000 };
function setup() {
  const db = openTestSidecar();
  configureBudgetPolicy(db, daily); configureBudgetPolicy(db, hourly);
  function reserve(policyId: string) {
    const wake = admitWake(db, { occurrenceId: policyId, triggerRef: policyId, sourceKind: "idle", conversationId: "fixture", cycleId: policyId, capturedAuthorityRevision: 1, nowMs: BASE });
    const result = reservePrivateThought(db, { admissionId: policyId, wakeId: wake.wake.wakeId, conversationId: "fixture", policyId, wallClockNowMs: BASE });
    if (result.kind !== "reserved") throw new Error("fixture_reservation_missing");
    return result.reservation;
  }
  return { db, reserve };
}
describe("L1 policy-bound recovery and retry", () => {
  it("migrates known private-thought rows unchanged and leaves unknown historical policies unbound", () => {
    const { db, reserve } = setup(); try {
      const known = reserve("ashley.private_thought.v1");
      const unknown = reserve(daily.policyId);
      setTestSidecarVersion(db, 52);
      const before = db.prepare("SELECT * FROM private_budget_reservations ORDER BY reservation_id").all();
      db.exec(COGNITIVE_SIDECAR_SCHEMA_V53);
      db.exec("PRAGMA user_version=53");
      const after = db.prepare("SELECT * FROM private_budget_reservations ORDER BY reservation_id").all();
      expect(after.map(({ policy_fingerprint, ...row }) => row)).toEqual(before);
      expect(db.prepare("SELECT policy_fingerprint FROM private_budget_reservations WHERE reservation_id=?").get(known.reservationId)?.policy_fingerprint).toBe(DEFAULT_BUDGET_SNAPSHOT.fingerprint);
      expect(db.prepare("SELECT policy_fingerprint FROM private_budget_reservations WHERE reservation_id=?").get(unknown.reservationId)?.policy_fingerprint).toBeNull();
      expect(() => getPrivateBudgetProjection(db, { policyId: daily.policyId, wallClockNowMs: BASE })).toThrow("private_budget_policy_unconfigured");
      expect(recoverPrivateBudget(db, { wallClockNowMs: BASE }).released).toBe(1);
      expect(getPrivateReservation(db, unknown.reservationId)?.state).toBe("held");
    } finally { db.close(); }
  });

  it("conserves an unbound reservation with missing policy evidence during recovery", () => {
    const { db, reserve } = setup(); try {
      const r = reserve(daily.policyId);
      db.prepare("UPDATE private_budget_reservations SET policy_fingerprint=NULL WHERE reservation_id=?").run(r.reservationId);
      const receipt = vi.fn(() => null);
      const result = recoverPrivateBudget(db, { wallClockNowMs: BASE, resolveReceipt: receipt });
      expect(result.released).toBe(0);
      expect(result.reconciling).toBe(1);
      expect(getPrivateReservation(db, r.reservationId)?.state).toBe("held");
      expect(receipt).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it("refuses a new invocation when the reservation fingerprint cannot resolve", () => {
    const { db, reserve } = setup(); try {
      const r = reserve(daily.policyId);
      db.prepare("UPDATE private_budget_reservations SET policy_fingerprint='unavailable' WHERE reservation_id=?").run(r.reservationId);
      expect(() => bindPrivateReservationInvocation(db, { reservationId: r.reservationId, invocationId: "i", attemptId: "a", nowMs: BASE })).toThrow("private_budget_policy_binding_unavailable");
      expect(getPrivateReservation(db, r.reservationId)?.invocationId).toBeNull();
    } finally { db.close(); }
  });
  it("refuses repair when its parent policy evidence is missing", () => {
    const { db, reserve } = setup(); try {
      const r = reserve(daily.policyId);
      const binding = { reservationId: r.reservationId, invocationId: "i", attemptId: "a", nowMs: BASE };
      bindPrivateReservationInvocation(db, binding); commitPrivateDispatch(db, binding); recordPrivateProviderResponse(db, binding);
      db.prepare("UPDATE private_budget_reservations SET policy_fingerprint=NULL WHERE reservation_id=?").run(r.reservationId);
      expect(() => bindPrivateRepairAttempt(db, { reservationId: r.reservationId, invocationId: "repair", attemptId: "repair", ordinal: 2, reason: "structural_repair", wakeId: r.wakeId, conversationId: r.conversationId, nowMs: BASE })).toThrow("private_budget_policy_binding_unavailable");
      expect(db.prepare("SELECT * FROM private_budget_attempt_bindings").all()).toEqual([]);
    } finally { db.close(); }
  });
  it("recovers two crashed bound policies without changing their distinct clock tolerances or windows", () => {
    const { db, reserve } = setup(); try {
      const reservations = [reserve(daily.policyId), reserve(hourly.policyId)];
      for (const r of reservations) bindPrivateReservationInvocation(db, { reservationId: r.reservationId, invocationId: r.policyId, attemptId: r.policyId, nowMs: BASE });
      const result = recoverPrivateBudget(db, { wallClockNowMs: BASE - 400_000, resolveReceipt: () => ({ dispatchTruth: "attempted" }) });
      expect(result.committed).toBe(2);
      expect(getPrivateBudgetProjection(db, { policyId: daily.policyId, wallClockNowMs: BASE - 400_000 })).toMatchObject({ clockState: "stable", consumingCount: 1, remaining: 0 });
      expect(getPrivateBudgetProjection(db, { policyId: hourly.policyId, wallClockNowMs: BASE - 400_000 })).toMatchObject({ clockState: "clock_reconciliation", consumingCount: 1, remaining: 0 });
      expect(recoverPrivateBudget(db, { wallClockNowMs: BASE + 3_600_000 }).expired).toBe(1);
      expect(getPrivateReservation(db, reservations[0]!.reservationId)?.state).toBe("committed");
      expect(getPrivateReservation(db, reservations[1]!.reservationId)?.state).toBe("expired");
    } finally { db.close(); }
  });
});
