import type { DatabaseSync } from "node:sqlite";
import { listActiveLearnedInfluences } from "../learned-autonomy/eligibility.js";
import { getAssertion } from "../memory/assertions.js";
import { influenceEligibleAt } from "../memory/eligibility.js";
import { assertC4ContractCompatible } from "./contract-state.js";
import { getCognitivePrediction } from "./predictions.js";
import { requireText, numberValue, text, isRow } from "./internal.js";
import type { CognitivePrediction, WorkingViewLink } from "./types.js";

export function linkWorkingView(
  db: DatabaseSync,
  input: {
    predictionId: number;
    assertionId: number;
    linkRole: string;
    now?: string;
  },
): WorkingViewLink {
  assertC4ContractCompatible(db);
  const prediction = getCognitivePrediction(db, input.predictionId);
  if (!prediction) throw new Error("cognitive_graduation_prediction_missing");
  const assertion = getAssertion(db, input.assertionId);
  if (!assertion || assertion.ownerId !== prediction.ownerId) {
    throw new Error("cognitive_graduation_working_view_assertion_missing");
  }
  const at = input.now ?? new Date().toISOString();
  if (!influenceEligibleAt(db, assertion.id, at)) {
    throw new Error("cognitive_graduation_working_view_not_current");
  }
  const linkRole = requireText(input.linkRole, "working_view_link_role", 64);
  db.prepare(
    `INSERT OR IGNORE INTO working_view_links
       (prediction_id, assertion_id, link_role) VALUES (?, ?, ?)`,
  ).run(prediction.id, assertion.id, linkRole);
  return { predictionId: prediction.id, assertionId: assertion.id, linkRole };
}

export function listWorkingViewLinks(
  db: DatabaseSync,
  predictionId: number,
): WorkingViewLink[] {
  assertC4ContractCompatible(db);
  return db.prepare(
    `SELECT prediction_id, assertion_id, link_role
     FROM working_view_links WHERE prediction_id = ?
     ORDER BY assertion_id ASC, link_role ASC`,
  ).all(predictionId).flatMap((value) => {
    if (!isRow(value)) return [];
    return [{
      predictionId: numberValue(value.prediction_id),
      assertionId: numberValue(value.assertion_id),
      linkRole: text(value.link_role),
    }];
  });
}

/** Re-check C1 instead of treating a historical link as current truth. */
export function currentWorkingViewLinks(
  db: DatabaseSync,
  prediction: CognitivePrediction,
  at = new Date().toISOString(),
): WorkingViewLink[] {
  const learnedRefs = prediction.evidenceRefs.filter((ref) => ref.type === "learned_influence");
  if (learnedRefs.length > 0) {
    if (prediction.capabilityModeAtWrite !== "dark_apply") return [];
    const active = new Set(
      listActiveLearnedInfluences(db, prediction.ownerId, {
        mode: "dark_apply",
        at: new Date(at),
      }).map((influence) => influence.id),
    );
    if (learnedRefs.some((ref) => !active.has(Number(ref.id)))) return [];
  }
  return listWorkingViewLinks(db, prediction.id).filter((link) => {
    const assertion = getAssertion(db, link.assertionId);
    return assertion?.ownerId === prediction.ownerId && influenceEligibleAt(db, link.assertionId, at);
  });
}

export function workingViewRemainsCurrent(
  db: DatabaseSync,
  prediction: CognitivePrediction,
  at = new Date().toISOString(),
): boolean {
  const links = currentWorkingViewLinks(db, prediction, at);
  return links.length > 0 && (
    prediction.workingViewAssertionId == null ||
    links.some((link) => link.assertionId === prediction.workingViewAssertionId)
  );
}
