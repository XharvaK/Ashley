// Interests she keeps returning to may become influences; the Host counts returns, Thought decides.
import type { DatabaseSync } from "node:sqlite";
import { getAssertion } from "../../memory/assertions.js";
import { influenceEligibleAt } from "../../memory/eligibility.js";
import { assertInfluenceContractCompatible, type InfluenceMode } from "./contract-state.js";

type Row = Record<string, unknown>;
export type EligibilityOptions = {
  /** Numeric legacy C1 assertion IDs belong to this explicit evidence owner, never to sidecar assertion keys. */
  evidenceDb: DatabaseSync;
  mode?: InfluenceMode;
  at?: Date;
};

function evidenceCurrent(db: DatabaseSync, evidenceDb: DatabaseSync, learned: Row, at: string): boolean {
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
  if (!learned || (options.mode ?? "observe") !== "dark_apply") return false;
  if (learned.adjudication_state !== "accepted" || learned.contradiction_state !== "none") return false;
  if (learned.provenance !== "live" || learned.capability_mode_at_write !== "dark_apply") return false;
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
          contradiction_reason=COALESCE(contradiction_reason,'c1_evidence_no_longer_current'),
          classification_invalidated_at=COALESCE(classification_invalidated_at,?),updated_at=?
      WHERE id=? AND contradiction_state='none'`).run(at, at, learnedId);
  }
  return db.prepare("SELECT * FROM learned_influences WHERE id=?").get(learnedId) ?? null;
}
