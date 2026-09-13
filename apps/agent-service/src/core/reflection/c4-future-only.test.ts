import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { getDecision } from "../agency/log.js";
import {
  c4Decision,
  c4Prediction,
  C4_OWNER,
} from "../cognitive-graduation/test-fixtures.js";
import {
  listEligibleThoughtCalibration,
  listThoughtCalibrationAdjustments,
  recordThoughtCalibrationAdjustment,
  rollbackCognitiveGraduation,
} from "../cognitive-graduation/calibration.js";
import { recordCognitiveOutcomeAdjudication } from "../cognitive-graduation/adjudications.js";
import { recordCognitiveOutcomeObservation } from "../cognitive-graduation/observations.js";

function settledPrediction(db: DatabaseSync) {
  const prediction = c4Prediction(db);
  const observation = recordCognitiveOutcomeObservation(db, {
    predictionId: prediction.id,
    observableKind: "fixture",
    observedValueTyped: { observed: true },
    observationKind: "receipt_backed",
    operationalReceiptType: "fixture_receipt",
    operationalReceiptId: "calibration-attempt",
  });
  const adjudication = recordCognitiveOutcomeAdjudication(db, {
    predictionId: prediction.id,
    observationId: observation.observationId,
    disposition: "confirmed",
    proposalOrigin: "deterministic_extractor",
    hostValidationOk: true,
    adjudicationAuthority: "deterministic_compare",
    comparatorPolicyVersion: "typed-json-v1",
  });
  return { prediction, adjudication };
}

describe("C4 Reflection future-only calibration", () => {
  it("records a bounded future adjustment without mutating the admitting Decision", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const admittingDecisionId = c4Decision(db);
      const before = getDecision(db, admittingDecisionId);
      const { prediction, adjudication } = settledPrediction(db);
      const adjustment = recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "increase_caution",
        effectValue: 0.2,
        admittingDecisionId,
        futureThoughtConsumer: "future_thought_selection",
        capabilityMode: "dark_apply",
        policyLineage: { policy: "c4-fixture-v1" },
      });
      const after = getDecision(db, admittingDecisionId);
      expect(after).toEqual(before);
      expect(adjustment).toMatchObject({
        lifecycleState: "eligible_for_future_thought",
        provenance: "live",
        capabilityModeAtWrite: "dark_apply",
        effectValue: 0.2,
      });
      expect(listEligibleThoughtCalibration(db, C4_OWNER, { mode: "dark_apply" }))
        .toEqual([expect.objectContaining({ adjustmentId: adjustment.adjustmentId })]);
      expect(listEligibleThoughtCalibration(db, C4_OWNER, { mode: "observe" })).toEqual([]);

      const repeated = recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "increase_caution",
        effectValue: 0.2,
        admittingDecisionId,
        futureThoughtConsumer: "future_thought_selection",
        capabilityMode: "dark_apply",
        policyLineage: { policy: "c4-fixture-v1" },
      });
      expect(repeated.adjustmentId).toBe(adjustment.adjustmentId);
      expect(listThoughtCalibrationAdjustments(db, C4_OWNER)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("keeps observe calibration shadow-only and rejects current-turn or unbounded influence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const admittingDecisionId = c4Decision(db);
      const { prediction, adjudication } = settledPrediction(db);
      const observed = recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "request_more_evidence",
        effectValue: 0.1,
        admittingDecisionId,
        futureThoughtConsumer: "future_thought_selection",
        capabilityMode: "observe",
      });
      expect(observed).toMatchObject({
        lifecycleState: "proposed",
        provenance: "shadow",
        capabilityModeAtWrite: "observe",
      });
      expect(listEligibleThoughtCalibration(db, C4_OWNER, { mode: "dark_apply" })).toEqual([]);
      expect(() => recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "increase_caution",
        effectValue: 0.26,
        admittingDecisionId,
        futureThoughtConsumer: "future_thought_selection",
        capabilityMode: "dark_apply",
      })).toThrow("cognitive_graduation_adjustment_bound_exceeded");
      expect(() => recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "increase_caution",
        effectValue: 0.1,
        admittingDecisionId,
        futureThoughtConsumer: "current_turn_agency",
        capabilityMode: "dark_apply",
      })).toThrow("cognitive_graduation_current_turn_consumer_forbidden");
      expect(() => recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "increase_caution",
        effectValue: 0.1,
        admittingDecisionId,
        futureThoughtConsumer: "future_thought_selection",
        capabilityMode: "apply",
      })).toThrow("cognitive_graduation_live_apply_not_authorized");
    } finally {
      db.close();
    }
  });

  it("stops influence after rollback and keeps semantic calibration history", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const admittingDecisionId = c4Decision(db);
      const { prediction, adjudication } = settledPrediction(db);
      const adjustment = recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "narrow_scope",
        effectValue: -0.15,
        admittingDecisionId,
        futureThoughtConsumer: "future_thought_selection",
        capabilityMode: "dark_apply",
      });
      expect(rollbackCognitiveGraduation(db, C4_OWNER)).toBe(1);
      expect(listEligibleThoughtCalibration(db, C4_OWNER, { mode: "dark_apply" })).toEqual([]);
      expect(listThoughtCalibrationAdjustments(db, C4_OWNER)[0]).toMatchObject({
        adjustmentId: adjustment.adjustmentId,
        lifecycleState: "rolled_back_through_capability",
      });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM cognitive_outcome_adjudications WHERE prediction_id = ?",
      ).get(prediction.id)).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("cannot time-shift a shadow prediction into live future influence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const admittingDecisionId = c4Decision(db);
      const { prediction, adjudication } = settledPrediction(db);
      db.prepare(
        "UPDATE cognitive_predictions SET provenance = 'shadow', capability_mode_at_write = 'observe' WHERE id = ?",
      ).run(prediction.id);
      const adjustment = recordThoughtCalibrationAdjustment(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        latestAdmittedAdjudicationId: adjudication.adjudicationId,
        adjustmentKind: "increase_caution",
        effectValue: 0.1,
        admittingDecisionId,
        futureThoughtConsumer: "future_thought_selection",
        capabilityMode: "dark_apply",
      });
      expect(adjustment).toMatchObject({ lifecycleState: "proposed", provenance: "shadow" });
      expect(listEligibleThoughtCalibration(db, C4_OWNER, { mode: "dark_apply" })).toEqual([]);
    } finally {
      db.close();
    }
  });
});
