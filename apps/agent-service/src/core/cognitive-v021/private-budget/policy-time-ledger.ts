import type { DatabaseSync } from "node:sqlite";
import { computePolicyTime } from "./policy-time.js";

export function reconcilePolicyClock(db: DatabaseSync, input: { policyId: string; wallClockNowMs: number; authorizationRef: string }): { policyTimeMs: number } {
  if (!input.policyId.trim()) throw new Error("policy_id_required");
  if (!Number.isFinite(input.wallClockNowMs) || input.wallClockNowMs < 0) throw new Error("policy_clock_invalid");
  if (!input.authorizationRef.trim()) throw new Error("policy_reconciliation_authorization_required");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT last_policy_now_ms FROM private_budget_policy_clock WHERE policy_id = ?").get(input.policyId) as { last_policy_now_ms: number } | undefined;
    const policyTimeMs = Math.max(Number(row?.last_policy_now_ms ?? 0), input.wallClockNowMs);
    db.prepare(
      `INSERT INTO private_budget_policy_clock (policy_id, last_policy_now_ms, clock_state, discrepancy_ms, reconciled_at_ms, reconciliation_ref)
       VALUES (?, ?, 'stable', 0, ?, ?)
       ON CONFLICT(policy_id) DO UPDATE SET last_policy_now_ms = excluded.last_policy_now_ms, clock_state = 'stable', discrepancy_ms = 0, reconciled_at_ms = excluded.reconciled_at_ms, reconciliation_ref = excluded.reconciliation_ref`,
    ).run(input.policyId, policyTimeMs, input.wallClockNowMs, input.authorizationRef);
    db.exec("COMMIT");
    return { policyTimeMs };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

export function advancePolicyClock(db: DatabaseSync, policyId: string, wallClockNowMs: number, thresholdMs = 300_000): { policyTimeMs: number; state: "stable" | "clock_reconciliation"; discrepancyMs: number } {
  if (!policyId.trim()) throw new Error("policy_id_required");
  if (!Number.isFinite(wallClockNowMs) || wallClockNowMs < 0) throw new Error("policy_clock_invalid");
  const row = db.prepare("SELECT last_policy_now_ms, clock_state FROM private_budget_policy_clock WHERE policy_id = ?").get(policyId) as { last_policy_now_ms: number; clock_state: string } | undefined;
  if (!row) throw new Error("policy_clock_missing");
  const result = computePolicyTime({ lastPolicyNowMs: Number(row.last_policy_now_ms), wallClockNowMs, discrepancyThresholdMs: thresholdMs });
  // F0 (R7 §15.4): no sticky latch. The persisted state always reflects the
  // CURRENT observation: a stored reconciliation exits automatically once the
  // wall clock is back inside the safe region, and forward gaps can never
  // write reconciliation. result.policyTimeMs is max(high-water, wall), so
  // the high-water mark is never lowered here.
  const state = result.state;
  db.prepare("UPDATE private_budget_policy_clock SET last_policy_now_ms = ?, clock_state = ?, discrepancy_ms = ? WHERE policy_id = ?").run(result.policyTimeMs, state, result.discrepancyMs, policyId);
  return { ...result, state };
}
