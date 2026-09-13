import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  C4_OWNER,
  c4Decision,
  c4Prediction,
} from "./test-fixtures.js";
import { markPredictionAwaitingObservation } from "./predictions.js";
import {
  listCognitiveOutcomeObservations,
  recordCognitiveOutcomeObservation,
} from "./observations.js";
import {
  listCognitiveOutcomeAdjudications,
  recordCognitiveOutcomeAdjudication,
} from "./adjudications.js";

describe("C4 operational observations and semantic adjudication", () => {
  it("requires a later actual value or evidence binding, and does not adjudicate on receipt", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      markPredictionAwaitingObservation(db, prediction.id);
      expect(() => recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "fixture",
        observationKind: "receipt_backed",
        operationalReceiptType: "fixture_receipt",
        operationalReceiptId: "attempt-1",
      })).toThrow("cognitive_graduation_observed_value_required");
      const observation = recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "fixture",
        observedValueTyped: { observed: true },
        observationKind: "receipt_backed",
        operationalReceiptType: "fixture_receipt",
        operationalReceiptId: "attempt-1",
      });
      expect(observation).toMatchObject({
        predictionId: prediction.id,
        observationKind: "receipt_backed",
        observedValueTyped: { observed: true },
        provenance: "live",
      });
      expect(listCognitiveOutcomeAdjudications(db, prediction.id)).toEqual([]);
      expect(db.prepare(
        "SELECT lifecycle_state FROM cognitive_predictions WHERE id = ?",
      ).get(prediction.id)).toEqual({ lifecycle_state: "observation_available" });
    } finally {
      db.close();
    }
  });

  it("allows missing and OUTCOME_UNKNOWN without treating either as a failed retry", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c4Prediction(db);
      const missing = recordCognitiveOutcomeObservation(db, {
        predictionId: first.id,
        observableKind: "fixture",
        observationKind: "missing",
      });
      expect(missing.observationKind).toBe("missing");
      expect(() => recordCognitiveOutcomeObservation(db, {
        predictionId: first.id,
        observableKind: "fixture",
        observedValueTyped: false,
        observationKind: "outcome_unknown",
      })).toThrow("cognitive_graduation_unknown_observation_value_refused");

      const second = c4Prediction(db);
      const unknown = recordCognitiveOutcomeObservation(db, {
        predictionId: second.id,
        observableKind: "fixture",
        observationKind: "outcome_unknown",
      });
      expect(unknown.observationKind).toBe("outcome_unknown");
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM cognitive_outcome_adjudications WHERE prediction_id = ?",
      ).get(second.id)).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("uses deterministic comparison only for typed comparable values and keeps later adjudications append-only", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      const observation = recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "fixture",
        observedValueTyped: { observed: true },
        observationKind: "receipt_backed",
        operationalReceiptType: "fixture_receipt",
        operationalReceiptId: "attempt-2",
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
      expect(adjudication).toMatchObject({
        disposition: "confirmed",
        adjudicationAuthority: "deterministic_compare",
        adjudicatingDecisionId: null,
        comparatorPolicyVersion: "typed-json-v1",
      });
      const secondObservation = recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "fixture",
        observedValueTyped: { observed: false },
        observationKind: "receipt_backed",
        operationalReceiptType: "fixture_receipt",
        operationalReceiptId: "attempt-3",
      });
      const contradicted = recordCognitiveOutcomeAdjudication(db, {
        predictionId: prediction.id,
        observationId: secondObservation.observationId,
        disposition: "contradicted",
        proposalOrigin: "worker",
        hostValidationOk: true,
        adjudicationAuthority: "deterministic_compare",
        comparatorPolicyVersion: "typed-json-v1",
        supersedesAdjudicationId: adjudication.adjudicationId,
        correctionClass: "SCOPE_REFINEMENT",
      });
      expect(listCognitiveOutcomeAdjudications(db, prediction.id)).toHaveLength(2);
      expect(contradicted.supersedesAdjudicationId).toBe(adjudication.adjudicationId);
      expect(db.prepare(
        "SELECT lifecycle_state FROM cognitive_predictions WHERE id = ?",
      ).get(prediction.id)).toEqual({ lifecycle_state: "closed" });
      expect(() => db.prepare(
        "UPDATE cognitive_outcome_adjudications SET disposition = 'unresolved' WHERE adjudication_id = ?",
      ).run(adjudication.adjudicationId)).toThrow("cognitive_adjudication_append_only");
      expect(() => db.prepare(
        "DELETE FROM cognitive_outcome_observations WHERE observation_id = ?",
      ).run(observation.observationId)).toThrow("cognitive_observation_append_only");
    } finally {
      db.close();
    }
  });

  it("rejects proposed reflection authority, invalid host admission, and semantic claims over unknown outcomes", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      const unknown = recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "fixture",
        observationKind: "outcome_unknown",
      });
      expect(() => recordCognitiveOutcomeAdjudication(db, {
        predictionId: prediction.id,
        observationId: unknown.observationId,
        disposition: "confirmed",
        proposalOrigin: "model",
        hostValidationOk: true,
        adjudicationAuthority: "ashley_thought_reflection",
        adjudicatingDecisionId: c4Decision(db),
      })).toThrow("cognitive_graduation_unknown_outcome_unresolved_required");
      expect(() => recordCognitiveOutcomeAdjudication(db, {
        predictionId: prediction.id,
        observationId: unknown.observationId,
        disposition: "unresolved",
        proposalOrigin: "model",
        hostValidationOk: false,
        adjudicationAuthority: "ashley_thought_reflection",
        adjudicatingDecisionId: c4Decision(db),
      })).toThrow("cognitive_graduation_host_validation_required");
      expect(() => recordCognitiveOutcomeAdjudication(db, {
        predictionId: prediction.id,
        observationId: unknown.observationId,
        disposition: "unresolved",
        proposalOrigin: "model",
        hostValidationOk: true,
        adjudicationAuthority: "thought_reflection_proposed",
        adjudicatingDecisionId: c4Decision(db),
      })).toThrow("cognitive_graduation_proposed_authority_forbidden");
    } finally {
      db.close();
    }
  });

  it("supports exact evidence plus content binding when a typed value is not copied", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      const observation = recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "delivery_content",
        observationEvidenceRef: "delivery_reservation:1",
        observationContentBinding: "sha256:fixture-content",
        observationKind: "receipt_backed",
        operationalReceiptType: "fixture_receipt",
        operationalReceiptId: "attempt-bound",
      });
      expect(observation.observedValueTyped).toBeNull();
      expect(listCognitiveOutcomeObservations(db, prediction.id)).toHaveLength(1);
      const adjudication = recordCognitiveOutcomeAdjudication(db, {
        predictionId: prediction.id,
        observationId: observation.observationId,
        disposition: "partial_support",
        proposalOrigin: "worker",
        hostValidationOk: true,
        adjudicationAuthority: "ashley_thought_reflection",
        adjudicatingDecisionId: c4Decision(db),
      });
      expect(adjudication.disposition).toBe("partial_support");
    } finally {
      db.close();
    }
  });
});
