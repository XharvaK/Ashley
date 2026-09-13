import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDecision } from "../agency/log.js";
import { getAssertion } from "../memory/assertions.js";
import { assertC4ContractCompatible } from "./contract-state.js";
import { getCognitiveOutcomeObservation } from "./observations.js";
import { expectedOutcomeForPrediction, getCognitivePrediction } from "./predictions.js";
import {
  combinedClassification,
  isRow,
  nullableNumber,
  nullableText,
  numberValue,
  stableEqual,
  text,
  rejectSecret,
  requireText,
} from "./internal.js";
import type {
  AdjudicationAuthority,
  AdjudicationProposalOrigin,
  CognitiveOutcomeAdjudication,
  CognitiveOutcomeAdjudicationInput,
  CorrectionClass,
  OutcomeDisposition,
} from "./types.js";

function disposition(value: unknown): OutcomeDisposition | null {
  return value === "confirmed" || value === "contradicted" ||
    value === "partial_support" || value === "unresolved"
    ? value
    : null;
}

function origin(value: unknown): AdjudicationProposalOrigin | null {
  return value === "model" || value === "worker" ||
    value === "deterministic_extractor" || value === "owner"
    ? value
    : null;
}

function authority(value: unknown): AdjudicationAuthority | null {
  return value === "deterministic_compare" || value === "ashley_thought_reflection" ||
    value === "owner_confirmed"
    ? value
    : null;
}

function correction(value: unknown): CorrectionClass | null {
  return value === "TEMPORAL_SUPERSESSION" || value === "INTERPRETATION_INVALIDATION" ||
    value === "PROVENANCE_CORRECTION" || value === "SCOPE_REFINEMENT" ||
    value === "unclassified"
    ? value
    : null;
}

function adjudicationRow(value: unknown): CognitiveOutcomeAdjudication | null {
  if (!isRow(value)) return null;
  const rowDisposition = disposition(value.disposition);
  const rowOrigin = origin(value.proposal_origin);
  const rowAuthority = authority(value.adjudication_authority);
  if (!rowDisposition || !rowOrigin || !rowAuthority) return null;
  return {
    adjudicationId: text(value.adjudication_id),
    predictionId: numberValue(value.prediction_id),
    observationId: text(value.observation_id),
    disposition: rowDisposition,
    proposalOrigin: rowOrigin,
    hostValidationOk: Number(value.host_validation_ok) === 1,
    adjudicationAuthority: rowAuthority,
    adjudicatingDecisionId: nullableNumber(value.adjudicating_decision_id),
    comparatorPolicyVersion: nullableText(value.comparator_policy_version),
    supersedesAdjudicationId: nullableText(value.supersedes_adjudication_id),
    correctionClass: correction(value.correction_class),
    dataClassification:
      value.data_classification === "ordinary" || value.data_classification === "sensitive" ||
      value.data_classification === "never_public" || value.data_classification === "secret"
        ? value.data_classification
        : "never_public",
    provenance: value.provenance === "live" ? "live" : "shadow",
    createdAt: text(value.created_at),
  };
}

function adjudicationById(db: DatabaseSync, id: string): CognitiveOutcomeAdjudication | null {
  return adjudicationRow(db.prepare(
    `SELECT * FROM cognitive_outcome_adjudications WHERE adjudication_id = ?`,
  ).get(id));
}

function parseComparableExpected(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function deterministicDisposition(
  prediction: NonNullable<ReturnType<typeof getCognitivePrediction>>,
  observation: NonNullable<ReturnType<typeof getCognitiveOutcomeObservation>>,
): OutcomeDisposition | null {
  if (observation.observationKind !== "receipt_backed" || observation.observedValueTyped === null) {
    return "unresolved";
  }
  const expected = parseComparableExpected(prediction.expectedObservableOutcome);
  if (expected === undefined || observation.observedValueTyped === undefined) return null;
  return stableEqual(expected, observation.observedValueTyped)
    ? "confirmed"
    : "contradicted";
}

/** Return the newest append-only semantic adjudication for a prediction. */
export function latestCognitiveOutcomeAdjudication(
  db: DatabaseSync,
  predictionId: number,
): CognitiveOutcomeAdjudication | null {
  assertC4ContractCompatible(db);
  return adjudicationRow(db.prepare(
    `SELECT * FROM cognitive_outcome_adjudications
     WHERE prediction_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).get(predictionId));
}

function validateInput(
  db: DatabaseSync,
  input: CognitiveOutcomeAdjudicationInput,
): {
  prediction: NonNullable<ReturnType<typeof getCognitivePrediction>>;
  observation: NonNullable<ReturnType<typeof getCognitiveOutcomeObservation>>;
  disposition: OutcomeDisposition;
  origin: AdjudicationProposalOrigin;
  authority: AdjudicationAuthority;
  decisionId: number | null;
  comparatorPolicyVersion: string | null;
  supersedesId: string | null;
  correctionClass: CorrectionClass | null;
  classification: ReturnType<typeof combinedClassification>;
} {
  assertC4ContractCompatible(db);
  const prediction = getCognitivePrediction(db, Number(input.predictionId));
  if (!prediction) throw new Error("cognitive_graduation_prediction_missing");
  const observationId = requireText(input.observationId, "observation_id", 200);
  const observation = getCognitiveOutcomeObservation(db, observationId);
  if (!observation || observation.predictionId !== prediction.id) {
    throw new Error("cognitive_graduation_observation_missing");
  }
  const rowDisposition = disposition(input.disposition);
  if (!rowDisposition) throw new Error("cognitive_graduation_disposition_invalid");
  const rowOrigin = origin(input.proposalOrigin);
  if (!rowOrigin) throw new Error("cognitive_graduation_proposal_origin_invalid");
  if (input.hostValidationOk !== true) {
    throw new Error("cognitive_graduation_host_validation_required");
  }
  const rowAuthority = authority(input.adjudicationAuthority);
  if (!rowAuthority) {
    if (input.adjudicationAuthority === "thought_reflection_proposed") {
      throw new Error("cognitive_graduation_proposed_authority_forbidden");
    }
    throw new Error("cognitive_graduation_adjudication_authority_invalid");
  }
  const decisionId = input.adjudicatingDecisionId == null
    ? null
    : Number(input.adjudicatingDecisionId);
  if (decisionId != null && (!Number.isSafeInteger(decisionId) || decisionId <= 0)) {
    throw new Error("cognitive_graduation_adjudicating_decision_invalid");
  }
  const comparatorPolicyVersion = input.comparatorPolicyVersion == null
    ? null
    : requireText(input.comparatorPolicyVersion, "comparator_policy_version", 100);
  if (rowAuthority === "deterministic_compare") {
    if (decisionId !== null || comparatorPolicyVersion === null) {
      throw new Error("cognitive_graduation_deterministic_binding_invalid");
    }
    const computed = deterministicDisposition(prediction, observation);
    if (computed === null || computed !== rowDisposition) {
      throw new Error("cognitive_graduation_deterministic_comparison_invalid");
    }
  } else {
    if (decisionId === null || comparatorPolicyVersion !== null) {
      throw new Error("cognitive_graduation_semantic_binding_invalid");
    }
    const decision = getDecision(db, decisionId);
    if (!decision || decision.ownerId !== prediction.ownerId) {
      throw new Error("cognitive_graduation_adjudicating_decision_missing");
    }
    const workingView = prediction.workingViewAssertionId == null
      ? null
      : getAssertion(db, prediction.workingViewAssertionId);
    const ownerModelWorkingView = workingView?.subjectFacet === "owner_model" &&
      (workingView.influenceClass === "I2" || workingView.influenceClass === "I3");
    if (ownerModelWorkingView && rowAuthority !== "owner_confirmed") {
      throw new Error("cognitive_graduation_owner_model_confirmation_required");
    }
    if (rowAuthority === "owner_confirmed" && rowOrigin !== "owner") {
      throw new Error("cognitive_graduation_owner_confirmation_origin_required");
    }
  }
  if (
    (observation.observationKind === "missing" || observation.observationKind === "outcome_unknown") &&
    rowDisposition !== "unresolved"
  ) {
    throw new Error("cognitive_graduation_unknown_outcome_unresolved_required");
  }
  const hasBoundActual = observation.observedValueTyped !== null || (
    observation.observationEvidenceRef !== null &&
    observation.observationContentBinding !== null
  );
  if (observation.observationKind === "receipt_backed" && !hasBoundActual &&
      rowDisposition !== "unresolved") {
    throw new Error("cognitive_graduation_observed_value_required");
  }
  const supersedesId = input.supersedesAdjudicationId == null
    ? null
    : requireText(input.supersedesAdjudicationId, "supersedes_adjudication_id", 200);
  if (supersedesId != null) {
    const superseded = adjudicationById(db, supersedesId);
    if (!superseded || superseded.predictionId !== prediction.id) {
      throw new Error("cognitive_graduation_superseded_adjudication_missing");
    }
  }
  const correctionClass = input.correctionClass == null ? null : correction(input.correctionClass);
  if (input.correctionClass != null && correctionClass === null) {
    throw new Error("cognitive_graduation_correction_class_invalid");
  }
  const classification = combinedClassification(
    input.dataClassification,
    prediction.dataClassification,
    observation.dataClassification,
  );
  rejectSecret(classification, "cognitive_graduation_secret_adjudication_refused");
  return {
    prediction,
    observation,
    disposition: rowDisposition,
    origin: rowOrigin,
    authority: rowAuthority,
    decisionId,
    comparatorPolicyVersion,
    supersedesId,
    correctionClass,
    classification,
  };
}

/** Add an append-only semantic interpretation after operational observation. */
export function recordCognitiveOutcomeAdjudication(
  db: DatabaseSync,
  input: CognitiveOutcomeAdjudicationInput,
): CognitiveOutcomeAdjudication {
  const checked = validateInput(db, input);
  const createdAt = new Date().toISOString();
  const adjudicationId = randomUUID();
  db.prepare(
    `INSERT INTO cognitive_outcome_adjudications
       (adjudication_id, prediction_id, observation_id, disposition,
        proposal_origin, host_validation_ok, adjudication_authority,
        adjudicating_decision_id, comparator_policy_version,
        supersedes_adjudication_id, correction_class, data_classification,
        provenance, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  ).run(
    adjudicationId,
    checked.prediction.id,
    checked.observation.observationId,
    checked.disposition,
    checked.origin,
    checked.authority,
    checked.decisionId,
    checked.comparatorPolicyVersion,
    checked.supersedesId,
    checked.correctionClass,
    checked.classification,
    checked.prediction.provenance,
    createdAt,
  );
  db.prepare(
    `UPDATE cognitive_predictions
     SET lifecycle_state = CASE WHEN ? = 'unresolved'
       THEN 'observation_available' ELSE 'closed' END
     WHERE id = ? AND lifecycle_state <> 'abandoned'`,
  ).run(checked.disposition, checked.prediction.id);
  const adjudication = adjudicationById(db, adjudicationId);
  if (!adjudication) throw new Error("cognitive_graduation_adjudication_readback_failed");
  return adjudication;
}

export function getCognitiveOutcomeAdjudication(
  db: DatabaseSync,
  adjudicationId: string,
): CognitiveOutcomeAdjudication | null {
  assertC4ContractCompatible(db);
  return adjudicationById(db, adjudicationId);
}

export function listCognitiveOutcomeAdjudications(
  db: DatabaseSync,
  predictionId: number,
): CognitiveOutcomeAdjudication[] {
  assertC4ContractCompatible(db);
  return db.prepare(
    `SELECT * FROM cognitive_outcome_adjudications
     WHERE prediction_id = ? ORDER BY created_at ASC, rowid ASC`,
  ).all(predictionId).map(adjudicationRow)
    .filter((item): item is CognitiveOutcomeAdjudication => item !== null);
}
