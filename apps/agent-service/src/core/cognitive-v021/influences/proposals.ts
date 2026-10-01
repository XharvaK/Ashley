// The Host counts returns and copies their existing label; Thought decides adoption.
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
import { detectCredentialShape } from "../../privacy/secrets.js";
import { listInterestBranches } from "../memory/interests.js";
import { assertInfluenceContractCompatible } from "./contract-state.js";

export const INFLUENCE_MIN_CYCLES = 3;
export const influenceContentHash = (text: string): string => `sha256:${createHash("sha256").update(text).digest("hex")}`;

export function proposeInfluences(db: DatabaseSync, input: { ownerId: string; cycleId: string; nowMs: number; dataClassification: DataClassification }): number[] {
  assertInfluenceContractCompatible(db);
  const cycle = db.prepare("SELECT admitted_at_ms FROM cycle_records WHERE cycle_id=?").get(input.cycleId);
  if (!input.ownerId.trim() || !cycle || Number(cycle.admitted_at_ms) > input.nowMs || input.dataClassification === "secret") return [];
  const proposed: number[] = [];
  db.exec("SAVEPOINT influence_propose");
  try {
    for (const branch of listInterestBranches(db, input.nowMs, Number.POSITIVE_INFINITY)) {
      const origin = db.prepare("SELECT origin FROM interest_branches WHERE branch_id=?").get(branch.branchId)?.origin;
      if (origin !== "seed" && origin !== "ashley") continue;
      if (detectCredentialShape(branch.label).hit) continue;
      if (db.prepare("SELECT 1 FROM learned_influences WHERE owner_id=? AND branch_key=?").get(input.ownerId, branch.branchId)) continue;
      const evidence = db.prepare(`SELECT t.cycle_id FROM interest_touches t JOIN cycle_records c ON c.cycle_id=t.cycle_id
        WHERE t.branch_key=? AND t.touched_at_ms<=? AND c.admitted_at_ms<=t.touched_at_ms
        ORDER BY t.touched_at_ms,t.cycle_id LIMIT ?`).all(branch.branchId, input.nowMs, INFLUENCE_MIN_CYCLES);
      if (evidence.length < INFLUENCE_MIN_CYCLES) continue;
      const at = new Date(input.nowMs).toISOString();
      const row = db.prepare(`INSERT INTO learned_influences
        (entity_uuid,owner_id,kind,subject_facet,semantic_owner,semantic_owner_ref,lineage_kind,influence_class,
         text,content_hash,proposal_lifecycle,adjudication_state,provenance,capability_mode_at_write,
         data_classification,classification_source,created_at,updated_at,branch_key,proposed_cycle_id)
        VALUES(?,?,'interest','ashley_side','thought',?,?,'I1',?,?,'proposed','pending','live','observe',?,
         'derived_most_restrictive',?,?,?,?)`).run(randomUUID(), input.ownerId, `interest:${branch.branchId}`,
          branch.origin === "seed" ? "explicit_seed" : "ashley_native", branch.label, influenceContentHash(branch.label),
          input.dataClassification === "ordinary" ? "never_public" : input.dataClassification, at, at, branch.branchId, input.cycleId);
      const id = Number(row.lastInsertRowid);
      for (const item of evidence) db.prepare("INSERT INTO learned_influence_branch_evidence (learned_id,branch_key,cycle_id) VALUES (?,?,?)").run(id, branch.branchId, String(item.cycle_id));
      proposed.push(id);
    }
    db.exec("RELEASE influence_propose");
    return proposed;
  } catch (error) {
    db.exec("ROLLBACK TO influence_propose; RELEASE influence_propose");
    throw error;
  }
}
