// Interests she keeps returning to may become influences; the Host counts returns, Thought decides.
import type { DatabaseSync } from "node:sqlite";
import { getAssertion } from "../../memory/assertions.js";
import { influenceEligibleAt } from "../../memory/eligibility.js";
import { assertInfluenceContractCompatible, type InfluenceMode } from "./contract-state.js";
import { influenceContentHash, INFLUENCE_MIN_CYCLES } from "./proposals.js";

type Row = Record<string, unknown>;
export type EligibilityOptions = {
  /** Numeric legacy C1 assertion IDs belong to this explicit evidence owner, never to sidecar assertion keys. */
  evidenceDb?: DatabaseSync;
  mode?: InfluenceMode;
  at?: Date;
};

/** Branch IDs and cycle receipts have their own owner; they never become numeric C1 IDs. */
export function branchEvidenceCurrent(db: DatabaseSync, learned: Row, nowMs: number): boolean {
  const branch = db.prepare("SELECT * FROM interest_branches WHERE branch_id=? AND forgotten_at_ms IS NULL").get(String(learned.branch_key));
  if (!branch || (branch.origin !== "seed" && branch.origin !== "ashley")
    || learned.subject_facet !== "ashley_side" || learned.semantic_owner !== "thought"
    || learned.semantic_owner_ref !== `interest:${String(branch.branch_id)}`
    || learned.lineage_kind !== (branch.origin === "seed" ? "explicit_seed" : "ashley_native")
    || learned.text !== branch.label || learned.content_hash !== influenceContentHash(String(branch.label))) return false;
  const evidence = db.prepare(`SELECT e.branch_key,t.touched_at_ms,c.admitted_at_ms FROM learned_influence_branch_evidence e
    JOIN interest_touches t ON t.branch_key=e.branch_key AND t.cycle_id=e.cycle_id
    JOIN cycle_records c ON c.cycle_id=e.cycle_id WHERE e.learned_id=?`).all(Number(learned.id));
  return evidence.length >= INFLUENCE_MIN_CYCLES && evidence.every(item => item.branch_key === learned.branch_key
    && Number(item.admitted_at_ms) <= Number(item.touched_at_ms) && Number(item.touched_at_ms) <= nowMs);
}

function evidenceCurrent(db: DatabaseSync, evidenceDb: DatabaseSync | undefined, learned: Row, at: string): boolean {
  if (typeof learned.branch_key === "string") return branchEvidenceCurrent(db, learned, Date.parse(at));
  if (!evidenceDb) return false;
  const evidence = db.prepare("SELECT * FROM learned_influence_evidence WHERE learned_influence_id=? ORDER BY observed_at,id").all(Number(learned.id));
  if (evidence.length < 2 || evidence.some(item => item.provenance !== "live")) return false;
  const seen = new Set<number>();
  for (const item of evidence) {
    const assertionId = Number(item.assertion_id);
    if (seen.has(assertionId)) return false;
    seen.add(assertionId);
    const assertion = getAssertion(evidenceDb, assertionId);
    if (!assertion || assertion.ownerId !== learned.owner_id) return false;
    if (!influenceEligibleAt(evidenceDb, assertion.id, at)) return false;
  }
  return true;
}

/** Pure C3 eligibility facts. No read grants activation or mutates a lifecycle. */
export function readEligibility(db: DatabaseSync, learnedId: number, options: EligibilityOptions): boolean {
  assertInfluenceContractCompatible(db);
  const learned = db.prepare("SELECT * FROM learned_influences WHERE id=?").get(learnedId);
  if (!learned) return false;
  if (learned.adjudication_state !== "accepted" || learned.contradiction_state !== "none") return false;
  if (learned.provenance !== "live" || learned.data_classification === "secret") return false;
  if (typeof learned.branch_key === "string") {
    const cycle = db.prepare("SELECT admitted_at_ms FROM cycle_records WHERE cycle_id=?").get(String(learned.admitting_cycle_id));
    const created = Date.parse(String(learned.created_at)), qualified = Date.parse(String(learned.qualified_at));
    const admitted = Number(cycle?.admitted_at_ms);
    if (learned.adjudicator !== "thought" || learned.influence_class !== "I1" || !cycle
      || ![created, qualified, admitted].every(Number.isFinite)
      || learned.admitting_cycle_id === learned.proposed_cycle_id
      || admitted <= created || qualified < admitted
      || qualified > (options.at ?? new Date()).getTime()) return false;
  } else if ((options.mode ?? "observe") !== "dark_apply" || learned.capability_mode_at_write !== "dark_apply") return false;
  if (learned.influence_class === "I0") return false;
  return evidenceCurrent(db, options.evidenceDb, learned, (options.at ?? new Date()).toISOString());
}

/** Explicitly record the downstream consequence of C1 invalidation; C1 remains the authority. */
export function refreshEligibility(db: DatabaseSync, learnedId: number, options: Omit<EligibilityOptions, "mode">): Row | null {
  assertInfluenceContractCompatible(db);
  const learned = db.prepare("SELECT * FROM learned_influences WHERE id=?").get(learnedId);
  if (!learned) return null;
  if (["demoted", "superseded", "expired"].includes(String(learned.contradiction_state))) return learned;
  const at = (options.at ?? new Date()).toISOString();
  if (!evidenceCurrent(db, options.evidenceDb, learned, at)) {
    db.prepare(`UPDATE learned_influences
      SET contradiction_state='owner_corrected',
          contradiction_reason=COALESCE(contradiction_reason,?),
          classification_invalidated_at=COALESCE(classification_invalidated_at,?),updated_at=?
      WHERE id=? AND contradiction_state='none'`).run(typeof learned.branch_key === "string" ? "branch_evidence_no_longer_current" : "c1_evidence_no_longer_current", at, at, learnedId);
  }
  return db.prepare("SELECT * FROM learned_influences WHERE id=?").get(learnedId) ?? null;
}
