// Explicit mechanical curiosity ranking; Thought admission and current branch evidence own eligibility.
import type { DatabaseSync } from "node:sqlite";
import type { Candidate } from "../thalamus/core.js";
import { external, type ExternalFacts } from "../thalamus/nuclei/external.js";
import { influenceMode } from "./contract-state.js";
import { readEligibility } from "./eligibility.js";
import { influenceContentHash } from "./proposals.js";

export type CuriosityFacts = Omit<ExternalFacts, "influenceEligible"> & { branchKey: string | null };
export type CuriosityContext = { cycleId: string; ownerId: string };
export const INFLUENCE_CURIOSITY_POLICY = "external_curiosity:admitted_branch_gain:v1";
const ids = (candidates: Candidate[]) => candidates.map(candidate => candidate.eventId);

/** No subscription acquisition, semantic matching, admission or lifecycle mutation occurs here. */
export function recordInfluencedCuriosityRank(db: DatabaseSync, facts: readonly CuriosityFacts[], context: CuriosityContext, nowMs: number): Candidate[] {
  const mode = influenceMode(db);
  if (!Number.isFinite(nowMs)) throw new Error("curiosity_nonfinite_time");
  const seen = new Set<string>();
  for (const fact of facts) {
    if (seen.has(fact.eventId)) throw new Error("curiosity_candidate_identity_conflict");
    seen.add(fact.eventId);
  }
  const rank = (bindings: Set<string>) => facts.flatMap(fact => {
    const candidate = external({ ...fact, influenceEligible: fact.branchKey !== null && bindings.has(fact.branchKey) }, "apply");
    return candidate ? [candidate] : [];
  }).sort((a,b) => b.salience-a.salience || (a.eventId<b.eventId ? -1 : a.eventId>b.eventId ? 1 : 0));
  const baseline = rank(new Set());
  const cycle = db.prepare("SELECT trigger_kind,admitted_at_ms FROM cycle_records WHERE cycle_id=?").get(context.cycleId);
  if (!context.ownerId.trim() || !cycle || cycle.trigger_kind !== "idle_opportunity" || Number(cycle.admitted_at_ms)>nowMs) return baseline;
  const branches = new Set(facts.filter(fact => fact.subscriptionCurrent).map(fact => fact.branchKey));
  const eligible = db.prepare(`SELECT * FROM learned_influences WHERE owner_id=? AND branch_key IS NOT NULL
    AND adjudication_state='accepted' ORDER BY id`).all(context.ownerId).filter(row =>
      branches.has(String(row.branch_key)) && row.admitting_cycle_id !== context.cycleId
      && Date.parse(String(row.qualified_at)) < Number(cycle.admitted_at_ms)
      && readEligibility(db,Number(row.id),{mode,at:new Date(nowMs)}));
  if (!eligible.length) return baseline;
  const admitted = new Set(eligible.map(row => String(row.branch_key)));
  const counterfactual = rank(admitted), actual = mode === "apply" ? counterfactual : baseline;
  const withIds = ids(counterfactual), actualIds = ids(actual);
  db.exec("SAVEPOINT influence_curiosity_receipts");
  try {
    for (const row of eligible) {
      const without = new Set(admitted); without.delete(String(row.branch_key));
      const withoutIds = ids(rank(without));
      const delta = Object.fromEntries(withoutIds.map((id,index)=>[id,index-withIds.indexOf(id)]));
      const differs = withoutIds.some((id,index)=>id!==withIds[index]);
      const inputHash = influenceContentHash(JSON.stringify({cycleId:context.cycleId,ownerId:context.ownerId,mode,facts,
        binding:row.entity_uuid,admitted:eligible.map(item=>[item.entity_uuid,item.adjudication_decision_id])}));
      const outputHash = influenceContentHash(JSON.stringify({actual,without:rank(without),with:counterfactual}));
      db.prepare(`INSERT OR IGNORE INTO learned_choice_receipts
        (receipt_id,owner_id,learned_id,choice_kind,candidate_ids_json,selected_ids_json,rank_delta_json,
         policy_binding,reason_code,input_content_hash,output_content_hash,eligible_input_affected_ranking,
         agency_made_final_choice,data_classification,created_at,cycle_id,counterfactual_ids_json)
        VALUES(?,?,?,'curiosity_rank',?,?,?,?,?,?,?,?,0,?,?,?,?)`).run(
          `influence-curiosity:${context.cycleId}:${String(row.id)}`,context.ownerId,Number(row.id),
          JSON.stringify(withoutIds),JSON.stringify(actualIds),JSON.stringify(delta),INFLUENCE_CURIOSITY_POLICY,
          differs ? (mode === "apply" ? "curiosity_reordered" : "curiosity_would_reorder") : "curiosity_unchanged",
          inputHash,outputHash,mode === "apply" && differs ? 1 : 0,String(row.data_classification),
          new Date(nowMs).toISOString(),context.cycleId,JSON.stringify(withIds));
    }
    db.exec("RELEASE influence_curiosity_receipts");
    return actual;
  } catch (error) {
    db.exec("ROLLBACK TO influence_curiosity_receipts; RELEASE influence_curiosity_receipts");
    throw error;
  }
}
