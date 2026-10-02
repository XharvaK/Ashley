// Each configured policy owns its window; unknown policy IDs never borrow private Thought authority.
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { admitWake } from "../wake/ledger.js";
import { reservePrivateThought, getPrivateBudgetProjection, expirePrivateReservations } from "./ledger.js";
import { reconcilePolicyClock } from "./policy-time-ledger.js";
const port = await import("./" + "policies.js").catch(() => null);
const BASE = 1000000, DAY = 86400000;
const daily = { policyId: "fixture.daily.v1", version: 1, limit: 1, windowMs: DAY, clockDiscontinuityMs: 600000 };
const hourly = { policyId: "fixture.hourly.v1", version: 1, limit: 2, windowMs: 3600000, clockDiscontinuityMs: 300000 };
function configure(db: DatabaseSync, p: typeof daily) { port?.configureBudgetPolicy(db, p); }
function reserve(db: DatabaseSync, policyId: string, suffix: string, time = BASE) {
    const w = admitWake(db, { occurrenceId: suffix, triggerRef: suffix, sourceKind: "idle", conversationId: "fixture", cycleId: suffix, capturedAuthorityRevision: 1, nowMs: time });
    return reservePrivateThought(db, { admissionId: suffix, wakeId: w.wake.wakeId, conversationId: "fixture", policyId, wallClockNowMs: time });
}
describe("L1 configured policy resolver", () => {
    it("isolates limits and rejects an unconfigured policy without a clock or reservation write", () => {
        const db = openTestSidecar();
        try {
            configure(db, daily);
            configure(db, hourly);
            expect(reserve(db, daily.policyId, "daily1").kind).toBe("reserved");
            expect(reserve(db, daily.policyId, "daily2")).toMatchObject({ kind: "refused", reason: "capacity_exhausted" });
            expect(reserve(db, hourly.policyId, "hour1").kind).toBe("reserved");
            expect(reserve(db, hourly.policyId, "hour2").kind).toBe("reserved");
            expect(getPrivateBudgetProjection(db, { policyId: daily.policyId, wallClockNowMs: BASE })).toMatchObject({ limit: 1, windowMs: DAY, remaining: 0 });
        }
        finally {
            db.close();
        }
    });
    it("refuses unknown policy for admission, projection, expiry and clock reconciliation", () => {
        const db = openTestSidecar();
        try {
            expect(() => reserve(db, "unknown-policy", "unknown1")).toThrow("private_budget_policy_unconfigured");
            const changes = db.prepare("SELECT total_changes() AS n").get()!.n;
            expect(() => getPrivateBudgetProjection(db, { policyId: "unknown-policy", wallClockNowMs: BASE })).toThrow("private_budget_policy_unconfigured");
            expect(() => expirePrivateReservations(db, { policyId: "unknown-policy", wallClockNowMs: BASE })).toThrow("private_budget_policy_unconfigured");
            expect(() => reconcilePolicyClock(db, { policyId: "unknown-policy", wallClockNowMs: BASE, authorizationRef: "fixture-owner" })).toThrow("private_budget_policy_unconfigured");
            expect(db.prepare("SELECT total_changes() AS n").get()!.n).toBe(changes);
            expect(db.prepare("SELECT * FROM private_budget_policy_clock WHERE policy_id='unknown-policy'").all()).toEqual([]);
            expect(db.prepare("SELECT * FROM private_budget_reservations WHERE policy_id='unknown-policy'").all()).toEqual([]);
        }
        finally {
            db.close();
        }
    });
    it("keeps a real daily reservation consuming until the exact 24h boundary", () => {
        const db = openTestSidecar();
        try {
            configure(db, daily);
            const r = reserve(db, daily.policyId, "daily-boundary");
            expect(r.kind).toBe("reserved");
            expect(expirePrivateReservations(db, { policyId: daily.policyId, wallClockNowMs: BASE + DAY - 1 }).expired).toBe(0);
            expect(getPrivateBudgetProjection(db, { policyId: daily.policyId, wallClockNowMs: BASE + DAY - 1 }).remaining).toBe(0);
            expect(expirePrivateReservations(db, { policyId: daily.policyId, wallClockNowMs: BASE + DAY }).expired).toBe(1);
            expect(reserve(db, daily.policyId, "daily-after", BASE + DAY).kind).toBe("reserved");
        }
        finally {
            db.close();
        }
    });
    it("does not refill capacity or expire an old fingerprint under a shorter policy revision", () => {
        const db = openTestSidecar();
        try {
            configure(db, daily);
            const r = reserve(db, daily.policyId, "old-policy");
            expect(r.kind).toBe("reserved");
            configure(db, { ...daily, version: 2, limit: 9, windowMs: 3600000 });
            expect(() => getPrivateBudgetProjection(db, { policyId: daily.policyId, wallClockNowMs: BASE + 3600000 })).toThrow("private_budget_policy_revision_incompatible");
            expect(expirePrivateReservations(db, { policyId: daily.policyId, wallClockNowMs: BASE + 3600000 }).expired).toBe(0);
            const old = db.prepare("SELECT policy_fingerprint FROM private_budget_reservations WHERE admission_id='old-policy'").get();
            expect(old?.policy_fingerprint).toEqual(expect.stringMatching(/^sha256:/));
            expect(expirePrivateReservations(db, { policyId: daily.policyId, wallClockNowMs: BASE + DAY }).expired).toBe(1);
            expect(reserve(db, daily.policyId, "new-policy", BASE + DAY).kind).toBe("reserved");
            expect(db.prepare("SELECT policy_fingerprint FROM private_budget_reservations WHERE admission_id='new-policy'").get()!.policy_fingerprint).not.toBe(old!.policy_fingerprint);
        }
        finally {
            db.close();
        }
    });
    it("keeps the existing private-thought policy immutable", () => {
        const db = openTestSidecar();
        try {
            const id = "ashley.private_thought.v1";
            expect(() => configure(db, { policyId: id, version: 2, limit: 99, windowMs: DAY, clockDiscontinuityMs: 600000 })).toThrow("private_budget_default_policy_immutable");
        }
        finally {
            db.close();
        }
    });
});
