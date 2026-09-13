import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { classifyTable } from "../qualification/state-inventory.js";
import { c4Decision, c4Prediction, C4_OWNER } from "./test-fixtures.js";
import { recordCognitiveOutcomeObservation } from "./observations.js";
import { recordCognitiveOutcomeAdjudication } from "./adjudications.js";
import { recordThoughtCalibrationAdjustment } from "./calibration.js";
import { getCognitiveGraduationDiagnostics } from "./diagnostics.js";
import { reconcileCognitiveWorkingView } from "./view-revision.js";

describe("C4 local settlement witnesses", () => {
  it("closes the additive chain without promotion or authority widening", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const admittingDecisionId = c4Decision(db);
      const prediction = c4Prediction(db);
      const observation = recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "fixture",
        observedValueTyped: { observed: true },
        observationKind: "receipt_backed",
        operationalReceiptType: "fixture_receipt",
        operationalReceiptId: "settlement-attempt",
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
      const diagnostics = getCognitiveGraduationDiagnostics(db, C4_OWNER);
      expect(diagnostics).toMatchObject({
        contractVersion: 1,
        capabilityState: "observe",
        counts: {
          predictionsRecorded: 1,
          predictionsSelected: 1,
          observationsRecorded: 1,
          observationsReceiptBacked: 1,
          adjudicationsRecorded: 1,
          adjudicationsConfirmed: 1,
          calibrationsRecorded: 1,
          calibrationsEligibleForFutureThought: 1,
        },
        influence: {
          authorized: false,
          executed: false,
          delivered: false,
          observed: true,
        },
      });
      expect(reconcileCognitiveWorkingView(db, prediction.id).status).toBe("current");
      expect(adjustment.admittingDecisionId).toBe(admittingDecisionId);
      expect(db.prepare(
        "SELECT live_authority_existed, state FROM cognitive_maturation_contract_state WHERE wave = 'c4'",
      ).get()).toEqual({ live_authority_existed: 0, state: "observe" });
    } finally {
      db.close();
    }
  });

  it("classifies all C4 durable records outside the live behavioral projection", () => {
    expect(classifyTable("cognitive_predictions")).toMatchObject({ cls: "SHADOW_ARTIFACT" });
    expect(classifyTable("cognitive_outcome_observations")).toMatchObject({ cls: "SHADOW_ARTIFACT" });
    expect(classifyTable("cognitive_outcome_adjudications")).toMatchObject({ cls: "SHADOW_ARTIFACT" });
    expect(classifyTable("working_view_links")).toMatchObject({ cls: "SHADOW_ARTIFACT" });
    expect(classifyTable("lived_experience_links")).toMatchObject({ cls: "SHADOW_ARTIFACT" });
    expect(classifyTable("thought_calibration_adjustments")).toMatchObject({ cls: "SHADOW_ARTIFACT" });
  });
});
