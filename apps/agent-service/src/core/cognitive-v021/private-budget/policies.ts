// The Host owns configured budget bounds; a reservation keeps its original policy truth.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR, type PrivateBudgetPolicy } from "../types.js";
export const PRIVATE_THOUGHT_POLICY_ID = "ashley.private_thought.v1" as const;
export const PRIVATE_THOUGHT_WINDOW_MS = 3600000 as const;
export const PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS = 300000 as const;
export const DEFAULT_PRIVATE_THOUGHT_POLICY: PrivateBudgetPolicy = Object.freeze({ policyId: PRIVATE_THOUGHT_POLICY_ID, limit: PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR, windowMs: PRIVATE_THOUGHT_WINDOW_MS, clockDiscontinuityMs: PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS });
export type VersionedBudgetPolicy = PrivateBudgetPolicy & {
    version: number;
};
export type BudgetPolicySnapshot = VersionedBudgetPolicy & {
    fingerprint: string;
};
function validate(policy: VersionedBudgetPolicy): void {
    if (!policy.policyId.trim() || ![policy.version, policy.limit, policy.windowMs, policy.clockDiscontinuityMs].every(Number.isSafeInteger) || policy.version < 1 || policy.limit < 1 || policy.windowMs < 1 || policy.clockDiscontinuityMs < 0)
        throw new Error("private_budget_policy_invalid");
}
export function budgetPolicyFingerprint(policy: VersionedBudgetPolicy): string {
    validate(policy);
    return "sha256:" + createHash("sha256").update(JSON.stringify([policy.policyId, policy.version, policy.limit, policy.windowMs, policy.clockDiscontinuityMs])).digest("hex");
}
export const DEFAULT_BUDGET_SNAPSHOT: BudgetPolicySnapshot = Object.freeze({ ...DEFAULT_PRIVATE_THOUGHT_POLICY, version: 1, fingerprint: budgetPolicyFingerprint({ ...DEFAULT_PRIVATE_THOUGHT_POLICY, version: 1 }) });
function snapshot(row: Record<string, unknown>): BudgetPolicySnapshot {
    const policy = { policyId: String(row.policy_id), version: Number(row.policy_version), limit: Number(row.capacity_limit), windowMs: Number(row.window_ms), clockDiscontinuityMs: Number(row.clock_discontinuity_ms) };
    validate(policy);
    if (budgetPolicyFingerprint(policy) !== row.fingerprint)
        throw new Error("private_budget_policy_fingerprint_invalid");
    return Object.freeze({ ...policy, fingerprint: String(row.fingerprint) });
}
/** Host configuration only; this library does not expose configuration to Thought or a transport. */
export function configureBudgetPolicy(db: DatabaseSync, policy: VersionedBudgetPolicy): BudgetPolicySnapshot {
    validate(policy);
    const fingerprint = budgetPolicyFingerprint(policy);
    if (policy.policyId === PRIVATE_THOUGHT_POLICY_ID && fingerprint !== DEFAULT_BUDGET_SNAPSHOT.fingerprint)
        throw new Error("private_budget_default_policy_immutable");
    const current = db.prepare("SELECT * FROM private_budget_policies WHERE policy_id=? AND is_current=1").get(policy.policyId);
    if (current?.fingerprint === fingerprint)
        return snapshot(current);
    if (current && policy.version <= Number(current.policy_version))
        throw new Error("private_budget_policy_revision_invalid");
    db.exec("SAVEPOINT configure_budget_policy");
    try {
        db.prepare("UPDATE private_budget_policies SET is_current=0 WHERE policy_id=?").run(policy.policyId);
        db.prepare("INSERT INTO private_budget_policies (policy_id,policy_version,capacity_limit,window_ms,clock_discontinuity_ms,fingerprint,is_current) VALUES (?,?,?,?,?,?,1)").run(policy.policyId, policy.version, policy.limit, policy.windowMs, policy.clockDiscontinuityMs, fingerprint);
        db.exec("RELEASE configure_budget_policy");
        return Object.freeze({ ...policy, fingerprint });
    }
    catch (error) {
        db.exec("ROLLBACK TO configure_budget_policy; RELEASE configure_budget_policy");
        throw error;
    }
}
/** A missing policy never borrows private Thought defaults. Reads are pure. */
export function resolveBudgetPolicy(db: DatabaseSync, policyId: string, fingerprint?: string): BudgetPolicySnapshot {
    const row = fingerprint ? db.prepare("SELECT * FROM private_budget_policies WHERE policy_id=? AND fingerprint=?").get(policyId, fingerprint) : db.prepare("SELECT * FROM private_budget_policies WHERE policy_id=? AND is_current=1").get(policyId);
    if (!row)
        throw new Error(fingerprint ? "private_budget_policy_binding_unavailable" : "private_budget_policy_unconfigured");
    return snapshot(row);
}
export function reservationBudgetPolicy(db: DatabaseSync, row: Record<string, unknown>): BudgetPolicySnapshot {
    if (typeof row.policy_fingerprint !== "string")
        throw new Error("private_budget_policy_binding_unavailable");
    return resolveBudgetPolicy(db, String(row.policy_id), row.policy_fingerprint);
}
export function activeBudgetRows(db: DatabaseSync, policyId: string, policyTimeMs: number): Array<Record<string, unknown>> {
    return db.prepare("SELECT * FROM private_budget_reservations WHERE policy_id=? AND state IN ('held','committed','reconcile_required')").all(policyId).filter(row => Number(row.policy_time_ms) > policyTimeMs - reservationBudgetPolicy(db, row).windowMs);
}
export function assertCurrentBudgetPolicy(db: DatabaseSync, policy: BudgetPolicySnapshot, policyTimeMs: number): void {
    if (activeBudgetRows(db, policy.policyId, policyTimeMs).some(row => row.policy_fingerprint !== policy.fingerprint))
        throw new Error("private_budget_policy_revision_incompatible");
}
