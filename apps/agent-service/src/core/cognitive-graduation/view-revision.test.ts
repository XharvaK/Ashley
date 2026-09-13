import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { getAssertion } from "../memory/assertions.js";
import { C4_TIME_2, c4Prediction, C4_OWNER, c4Decision } from "./test-fixtures.js";
import { recordCognitiveOutcomeObservation } from "./observations.js";
import { recordCognitiveOutcomeAdjudication } from "./adjudications.js";
import {
  assertCognitiveViewRevisionOwnedByC1,
  reconcileCognitiveWorkingView,
} from "./view-revision.js";

describe("C4 working-view revision boundary", () => {
  it("reports an outcome contradiction without rewriting the C1 assertion", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      const assertionId = prediction.workingViewAssertionId!;
      const before = getAssertion(db, assertionId);
      const observation = recordCognitiveOutcomeObservation(db, {
        predictionId: prediction.id,
        observableKind: "fixture",
        observedValueTyped: { observed: false },
        observationKind: "receipt_backed",
        operationalReceiptType: "fixture_receipt",
        operationalReceiptId: "revision-attempt",
      });
      recordCognitiveOutcomeAdjudication(db, {
        predictionId: prediction.id,
        observationId: observation.observationId,
        disposition: "contradicted",
        proposalOrigin: "deterministic_extractor",
        hostValidationOk: true,
        adjudicationAuthority: "deterministic_compare",
        comparatorPolicyVersion: "typed-json-v1",
        correctionClass: "INTERPRETATION_INVALIDATION",
      });
      const reconciliation = reconcileCognitiveWorkingView(db, prediction.id);
      expect(reconciliation).toMatchObject({
        status: "requires_owner_revision",
        currentAssertionIds: [assertionId],
        correctionClass: "INTERPRETATION_INVALIDATION",
        c4MutatedCurrentTruth: false,
      });
      expect(getAssertion(db, assertionId)).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("reconciles C1 invalidation as stale and does not allow C4 to replace it", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      const assertionId = prediction.workingViewAssertionId!;
      db.prepare(
        "UPDATE memory_assertions SET termination_reason = 'invalidated', authority_to = ? WHERE id = ?",
      ).run("2026-08-21T10:00:00.001Z", assertionId);
      expect(reconcileCognitiveWorkingView(db, prediction.id)).toMatchObject({
        status: "requires_owner_revision",
        currentAssertionIds: [],
        reason: "c1_working_view_not_current",
        c4MutatedCurrentTruth: false,
      });
      expect(() => assertCognitiveViewRevisionOwnedByC1())
        .toThrow("cognitive_graduation_view_revision_requires_c1_owner");
    } finally {
      db.close();
    }
  });

  it("reports a current C1 working view when no semantic contradiction exists", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      expect(reconcileCognitiveWorkingView(db, prediction.id)).toMatchObject({
        status: "current",
        currentAssertionIds: [prediction.workingViewAssertionId],
      });
    } finally {
      db.close();
    }
  });
});
