// A counted proposal is not adoption; only a later Thought pass owns the position.
import type { DatabaseSync } from "node:sqlite";
import { maxClassification, type DataClassification } from "../../privacy/classification.js";
import { detectCredentialShape } from "../../privacy/secrets.js";
import { assertInfluenceContractCompatible } from "./contract-state.js";
import { branchEvidenceCurrent } from "./eligibility.js";

export type InfluencePosition = { influenceId: number; position: "admit" | "decline"; rationale: string };
export type InfluenceProposal = { influenceId: number; branchKey: string; label: string; distinctCycles: number };
export const INFLUENCE_POSITIONS_MAX = 3;
export const INFLUENCE_RATIONALE_MAX_CHARS = 200;

export function influenceProposalsForThought(db: DatabaseSync, ownerId: string, nowMs: number): InfluenceProposal[] {
  assertInfluenceContractCompatible(db);
  return db.prepare(`SELECT * FROM learned_influences WHERE owner_id=? AND branch_key IS NOT NULL
    AND adjudication_state='pending' AND contradiction_state='none' AND data_classification!='secret'
    ORDER BY created_at,id`).all(ownerId)
    .filter(row => Date.parse(String(row.created_at)) <= nowMs && branchEvidenceCurrent(db, row, nowMs))
    .slice(0, INFLUENCE_POSITIONS_MAX).map(row => ({
      influenceId: Number(row.id), branchKey: String(row.branch_key), label: String(row.text),
      distinctCycles: Number(db.prepare("SELECT count(*) AS n FROM learned_influence_branch_evidence WHERE learned_id=?").get(Number(row.id))!.n),
    }));
}

export function recordInfluencePositions(db: DatabaseSync, input: { ownerId: string; cycleId: string; positions: InfluencePosition[]; dataClassification: DataClassification; nowMs: number }): Array<{ influenceId: number; code: string }> {
  assertInfluenceContractCompatible(db);
  if (!Array.isArray(input.positions)) return [];
  const results: Array<{ influenceId: number; code: string }> = [];
  for (const item of input.positions.slice(0, INFLUENCE_POSITIONS_MAX)) {
    const result = (code: string) => results.push({ influenceId: item?.influenceId, code });
    if (!item || Object.keys(item).some(key => !["influenceId", "position", "rationale"].includes(key))
      || !Number.isSafeInteger(item.influenceId) || item.influenceId < 1
      || !["admit", "decline"].includes(item.position) || typeof item.rationale !== "string"
      || !item.rationale.trim() || item.rationale.length > INFLUENCE_RATIONALE_MAX_CHARS
      || detectCredentialShape(item.rationale).hit || input.dataClassification === "secret") {
      result("influence_position_invalid"); continue;
    }
    const row = db.prepare("SELECT * FROM learned_influences WHERE id=? AND owner_id=? AND branch_key IS NOT NULL").get(item.influenceId, input.ownerId);
    if (!row || row.adjudication_state !== "pending" || row.contradiction_state !== "none") { result("influence_not_pending"); continue; }
    const cycle = db.prepare("SELECT admitted_at_ms FROM cycle_records WHERE cycle_id=?").get(input.cycleId);
    const created = Date.parse(String(row.created_at));
    if (!cycle || !Number.isFinite(created) || row.proposed_cycle_id === input.cycleId
      || Number(cycle.admitted_at_ms) <= created || Number(cycle.admitted_at_ms) > input.nowMs) {
      result("influence_later_pass_required"); continue;
    }
    if (row.data_classification === "secret" || row.influence_class !== "I1" || row.provenance !== "live"
      || !branchEvidenceCurrent(db, row, input.nowMs)) { result("influence_evidence_not_current"); continue; }
    const at = new Date(input.nowMs).toISOString();
    db.prepare(`UPDATE learned_influences SET adjudication_state=?,proposal_lifecycle='admitted_to_review',
      adjudicator='thought',adjudication_decision_id=?,qualified_at=?,admitting_cycle_id=?,position_rationale=?,
      data_classification=?,updated_at=? WHERE id=? AND adjudication_state='pending'`).run(
        item.position === "admit" ? "accepted" : "declined", `influence-position:${input.cycleId}:${item.influenceId}`,
        item.position === "admit" ? at : null, input.cycleId, item.rationale.trim(),
        maxClassification(row.data_classification as DataClassification, input.dataClassification), at, item.influenceId);
    result(item.position === "admit" ? "influence_admitted" : "influence_declined");
  }
  return results;
}
