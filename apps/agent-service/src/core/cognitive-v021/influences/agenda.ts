// Only own-time branch order may change; Thought still decides what to pursue.
import type { DatabaseSync } from "node:sqlite";
import type { InterestBranch } from "../memory/interests.js";
import { influenceMode } from "./contract-state.js";
import { readEligibility } from "./eligibility.js";
import { influenceContentHash } from "./proposals.js";

export type InfluenceAgendaContext = { cycleId: string; ownerId: string };
export const INFLUENCE_AGENDA_POLICY = "own_time_agenda:admitted_branch_first:v1";

/** Explicit observation write, independent of the pure eligibility/lifecycle APIs. */
export function recordInfluencedAgendaOrder(db: DatabaseSync, branches: InterestBranch[], context: InfluenceAgendaContext, nowMs: number): InterestBranch[] {
  const mode = influenceMode(db);
  const cycle = db.prepare("SELECT trigger_kind,admitted_at_ms FROM cycle_records WHERE cycle_id=?").get(context.cycleId);
  if (!context.ownerId.trim() || !cycle || cycle.trigger_kind !== "idle_opportunity" || Number(cycle.admitted_at_ms) > nowMs) return branches;
  const candidates = new Set(branches.map(branch => branch.branchId));
  const eligible = db.prepare(`SELECT * FROM learned_influences WHERE owner_id=? AND branch_key IS NOT NULL
    AND adjudication_state='accepted' ORDER BY id`).all(context.ownerId)
    .filter(row => candidates.has(String(row.branch_key)) && row.admitting_cycle_id !== context.cycleId
      && Date.parse(String(row.qualified_at)) < Number(cycle.admitted_at_ms)
      && readEligibility(db, Number(row.id), { mode, at: new Date(nowMs) }));
  if (!eligible.length) return branches;
  const admitted = new Set(eligible.map(row => String(row.branch_key)));
  const order = (ids: Set<string>) => [...branches.filter(branch => ids.has(branch.branchId)), ...branches.filter(branch => !ids.has(branch.branchId))];
  const counterfactual = order(admitted);
  const actual = mode === "apply" ? counterfactual : branches;
  const counterfactualIds = counterfactual.map(branch => branch.branchId);
  const actualIds = actual.map(branch => branch.branchId);
  db.exec("SAVEPOINT influence_agenda_receipts");
  try {
    for (const row of eligible) {
      // Isolate this binding's consequence; do not attribute a cohort's change to every member.
      const without = new Set(admitted); without.delete(String(row.branch_key));
      const baselineIds = order(without).map(branch => branch.branchId);
      const delta = Object.fromEntries(baselineIds.map((id, index) => [id, index - counterfactualIds.indexOf(id)]));
      const differs = baselineIds.some((id, index) => id !== counterfactualIds[index]);
      const inputHash = influenceContentHash(JSON.stringify({ cycleId: context.cycleId, ownerId: context.ownerId, mode,
        branches, binding: row.entity_uuid, admitted: eligible.map(item => [item.entity_uuid, item.adjudication_decision_id]) }));
      const outputHash = influenceContentHash(JSON.stringify({ actual: actualIds, without: baselineIds, with: counterfactualIds }));
      db.prepare(`INSERT OR IGNORE INTO learned_choice_receipts
        (receipt_id,owner_id,learned_id,choice_kind,candidate_ids_json,selected_ids_json,rank_delta_json,
         policy_binding,reason_code,input_content_hash,output_content_hash,eligible_input_affected_ranking,
         agency_made_final_choice,data_classification,created_at,cycle_id,counterfactual_ids_json)
        VALUES(?,?,?,'agenda_order',?,?,?,?,?,?,?,?,0,?,?,?,?)`).run(
          `influence-agenda:${context.cycleId}:${String(row.id)}`, context.ownerId, Number(row.id),
          JSON.stringify(baselineIds), JSON.stringify(actualIds), JSON.stringify(delta), INFLUENCE_AGENDA_POLICY,
          differs ? (mode === "apply" ? "agenda_reordered" : "agenda_would_reorder") : "agenda_unchanged",
          inputHash, outputHash, mode === "apply" && differs ? 1 : 0, String(row.data_classification),
          new Date(nowMs).toISOString(), context.cycleId, JSON.stringify(counterfactualIds));
    }
    db.exec("RELEASE influence_agenda_receipts");
    return actual;
  } catch (error) {
    db.exec("ROLLBACK TO influence_agenda_receipts; RELEASE influence_agenda_receipts");
    throw error;
  }
}
