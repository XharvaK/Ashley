import type { DatabaseSync } from "node:sqlite";
import { getAssertion } from "../memory/assertions.js";
import { influenceEligibleAt } from "../memory/eligibility.js";
import { assertC3ContractCompatible, learnedAutonomyCanInfluence } from "./contract-state.js";
import {
  getLearnedInfluence,
  listLearnedInfluenceEvidence,
} from "./admit.js";
import type {
  LearnedAutonomyMode,
  LearnedInfluence,
} from "./types.js";

function evidenceIsCurrent(
  db: DatabaseSync,
  learned: LearnedInfluence,
  at: string,
): boolean {
  const evidence = listLearnedInfluenceEvidence(db, learned.id);
  if (evidence.length < 2 || evidence.some((item) => item.provenance !== "live")) {
    return false;
  }
  const assertionIds = new Set<number>();
  for (const item of evidence) {
    if (assertionIds.has(item.assertionId)) return false;
    assertionIds.add(item.assertionId);
    const assertion = getAssertion(db, item.assertionId);
    if (!assertion || assertion.ownerId !== learned.ownerId) return false;
    if (!influenceEligibleAt(db, assertion.id, at)) return false;
  }
  return true;
}

/**
 * Reconcile a derived binding against C1 at the point of use. C1 remains the
 * source of currentness; this row only records the downstream consequence.
 */
export function refreshLearnedInfluenceEligibility(
  db: DatabaseSync,
  learnedId: number,
  at = new Date(),
): LearnedInfluence | null {
  assertC3ContractCompatible(db);
  const learned = getLearnedInfluence(db, learnedId);
  if (!learned) return null;
  if (
    learned.contradictionState === "demoted" ||
    learned.contradictionState === "superseded" ||
    learned.contradictionState === "expired"
  ) {
    return learned;
  }
  if (!evidenceIsCurrent(db, learned, at.toISOString())) {
    db.prepare(
      `UPDATE learned_influences
       SET contradiction_state = 'owner_corrected',
           contradiction_reason = COALESCE(contradiction_reason, 'c1_evidence_no_longer_current'),
           classification_invalidated_at = COALESCE(classification_invalidated_at, ?),
           updated_at = ?
       WHERE id = ? AND contradiction_state = 'none'`,
    ).run(at.toISOString(), at.toISOString(), learnedId);
  }
  return getLearnedInfluence(db, learnedId);
}

function isEligibleRow(
  db: DatabaseSync,
  learned: LearnedInfluence,
  mode: LearnedAutonomyMode,
  at: Date,
): boolean {
  if (mode !== "dark_apply") return false;
  if (!learnedAutonomyCanInfluence(db, mode)) return false;
  if (learned.adjudicationState !== "accepted") return false;
  if (learned.contradictionState !== "none") return false;
  if (learned.provenance !== "live") return false;
  if (learned.capabilityModeAtWrite !== "dark_apply") return false;
  if (learned.influenceClass === ("I0" as LearnedInfluence["influenceClass"])) return false;
  return evidenceIsCurrent(db, learned, at.toISOString());
}

export function isLearnedInfluenceEligible(
  db: DatabaseSync,
  learnedId: number,
  mode: LearnedAutonomyMode = "observe",
  at = new Date(),
): boolean {
  assertC3ContractCompatible(db);
  const refreshed = refreshLearnedInfluenceEligibility(db, learnedId, at);
  return refreshed !== null && isEligibleRow(db, refreshed, mode, at);
}

export function listActiveLearnedInfluences(
  db: DatabaseSync,
  ownerId: string,
  options: { mode?: LearnedAutonomyMode; at?: Date } = {},
): LearnedInfluence[] {
  assertC3ContractCompatible(db);
  const mode = options.mode ?? "observe";
  const at = options.at ?? new Date();
  if (mode !== "dark_apply") return [];
  const rows = db.prepare(
    `SELECT id FROM learned_influences
     WHERE owner_id = ? AND adjudication_state = 'accepted'
     ORDER BY qualified_at ASC, id ASC`,
  ).all(ownerId) as Array<{ id?: number }>;
  const active: LearnedInfluence[] = [];
  for (const row of rows) {
    const id = Number(row.id ?? 0);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const refreshed = refreshLearnedInfluenceEligibility(db, id, at);
    if (refreshed && isEligibleRow(db, refreshed, mode, at)) active.push(refreshed);
  }
  return active;
}
