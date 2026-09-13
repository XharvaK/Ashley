import type { DatabaseSync } from "node:sqlite";
import { assertC4ContractCompatible } from "./contract-state.js";
import { latestCognitiveOutcomeAdjudication } from "./adjudications.js";
import { getCognitivePrediction } from "./predictions.js";
import { currentWorkingViewLinks } from "./view-links.js";
import type { CorrectionClass } from "./types.js";

export type CognitiveWorkingViewReconciliation = {
  predictionId: number;
  status: "current" | "requires_owner_revision" | "unknown";
  currentAssertionIds: number[];
  correctionClass: CorrectionClass | null;
  c4MutatedCurrentTruth: false;
  reason: string;
};

/**
 * Reconcile a C4 link against C1. The natural C1/Mind State owners must
 * perform any revision; C4 returns a bounded request signal only.
 */
export function reconcileCognitiveWorkingView(
  db: DatabaseSync,
  predictionId: number,
  at = new Date().toISOString(),
): CognitiveWorkingViewReconciliation {
  assertC4ContractCompatible(db);
  const prediction = getCognitivePrediction(db, predictionId);
  if (!prediction) {
    return {
      predictionId,
      status: "unknown",
      currentAssertionIds: [],
      correctionClass: null,
      c4MutatedCurrentTruth: false,
      reason: "prediction_missing",
    };
  }
  const links = currentWorkingViewLinks(db, prediction, at);
  const latest = latestCognitiveOutcomeAdjudication(db, prediction.id);
  const correctionClass = latest?.correctionClass ?? null;
  if (links.length === 0) {
    return {
      predictionId,
      status: "requires_owner_revision",
      currentAssertionIds: [],
      correctionClass,
      c4MutatedCurrentTruth: false,
      reason: "c1_working_view_not_current",
    };
  }
  if (latest?.disposition === "contradicted" || latest?.disposition === "partial_support") {
    return {
      predictionId,
      status: "requires_owner_revision",
      currentAssertionIds: links.map((link) => link.assertionId),
      correctionClass,
      c4MutatedCurrentTruth: false,
      reason: latest.disposition === "contradicted"
        ? "outcome_contradicts_working_view"
        : "outcome_partially_supports_working_view",
    };
  }
  return {
    predictionId,
    status: "current",
    currentAssertionIds: links.map((link) => link.assertionId),
    correctionClass,
    c4MutatedCurrentTruth: false,
    reason: "c1_working_view_current",
  };
}

/** No C4 function can write a replacement C1 assertion. */
export function assertCognitiveViewRevisionOwnedByC1(): never {
  throw new Error("cognitive_graduation_view_revision_requires_c1_owner");
}
