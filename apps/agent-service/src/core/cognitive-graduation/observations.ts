import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  getDeliveryReservation,
  listDeliveryBubbles,
} from "../delivery/store.js";
import { isTerminalDeliveryState } from "../delivery/types.js";
import { assertC4ContractCompatible } from "./contract-state.js";
import {
  combinedClassification,
  isRow,
  nullableText,
  numberValue,
  parseJson,
  rejectSecret,
  requireBoundedJson,
  requireText,
  text,
} from "./internal.js";
import { getCognitivePrediction } from "./predictions.js";
import type {
  CognitiveOutcomeObservation,
  CognitiveOutcomeObservationInput,
  OutcomeObservationKind,
} from "./types.js";

function observationKind(value: unknown): OutcomeObservationKind | null {
  return value === "receipt_backed" || value === "missing" || value === "outcome_unknown"
    ? value
    : null;
}

function observationRow(value: unknown): CognitiveOutcomeObservation | null {
  if (!isRow(value)) return null;
  const kind = observationKind(value.observation_kind);
  if (!kind) return null;
  return {
    observationId: text(value.observation_id),
    predictionId: numberValue(value.prediction_id),
    observableKind: text(value.observable_kind),
    observedValueTyped: value.observed_value_typed == null
      ? null
      : parseJson(value.observed_value_typed),
    observationEvidenceRef: nullableText(value.observation_evidence_ref),
    observationContentBinding: nullableText(value.observation_content_binding),
    operationalReceiptType: nullableText(value.operational_receipt_type),
    operationalReceiptId: nullableText(value.operational_receipt_id),
    observationKind: kind,
    observedAt: text(value.observed_at),
    dataClassification:
      value.data_classification === "ordinary" || value.data_classification === "sensitive" ||
      value.data_classification === "never_public" || value.data_classification === "secret"
        ? value.data_classification
        : "never_public",
    provenance: value.provenance === "live" ? "live" : "shadow",
  };
}

function observationById(db: DatabaseSync, id: string): CognitiveOutcomeObservation | null {
  return observationRow(db.prepare(
    `SELECT * FROM cognitive_outcome_observations WHERE observation_id = ?`,
  ).get(id));
}

function validateDeliveryReceipt(
  db: DatabaseSync,
  ownerId: string,
  receiptType: string,
  receiptId: string,
): void {
  if (receiptType !== "delivery_reservation") return;
  const id = Number(receiptId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("cognitive_graduation_operational_receipt_invalid");
  }
  const reservation = getDeliveryReservation(db, id);
  if (!reservation || reservation.ownerId !== ownerId || !isTerminalDeliveryState(reservation.state)) {
    throw new Error("cognitive_graduation_operational_receipt_unresolved");
  }
  const hasDeliveredBubble = listDeliveryBubbles(db, id).some((bubble) => bubble.discordMessageId != null);
  if (!hasDeliveredBubble && reservation.state !== "committed") {
    throw new Error("cognitive_graduation_operational_receipt_unresolved");
  }
}

function validateObservationInput(
  db: DatabaseSync,
  input: CognitiveOutcomeObservationInput,
): {
  predictionId: number;
  observableKind: string;
  observedValueJson: string | null;
  observationEvidenceRef: string | null;
  observationContentBinding: string | null;
  receiptType: string | null;
  receiptId: string | null;
  kind: OutcomeObservationKind;
  observedAt: string;
  dataClassification: ReturnType<typeof combinedClassification>;
} {
  assertC4ContractCompatible(db);
  const predictionId = Number(input.predictionId);
  if (!Number.isSafeInteger(predictionId) || predictionId <= 0) {
    throw new Error("cognitive_graduation_prediction_invalid");
  }
  const prediction = getCognitivePrediction(db, predictionId);
  if (!prediction) throw new Error("cognitive_graduation_prediction_missing");
  const observableKind = requireText(input.observableKind, "observable_kind", 64);
  const kind = observationKind(input.observationKind);
  if (!kind) throw new Error("cognitive_graduation_observation_kind_invalid");
  const hasTypedValue = input.observedValueTyped !== undefined;
  const observationEvidenceRef = input.observationEvidenceRef == null
    ? null
    : requireText(input.observationEvidenceRef, "observation_evidence_ref", 200);
  const observationContentBinding = input.observationContentBinding == null
    ? null
    : requireText(input.observationContentBinding, "observation_content_binding", 200);
  if ((observationEvidenceRef == null) !== (observationContentBinding == null)) {
    throw new Error("cognitive_graduation_observation_binding_incomplete");
  }
  const hasResolvedActual = hasTypedValue || (
    observationEvidenceRef !== null && observationContentBinding !== null
  );
  if (kind === "receipt_backed" && !hasResolvedActual) {
    throw new Error("cognitive_graduation_observed_value_required");
  }
  if ((kind === "missing" || kind === "outcome_unknown") && hasTypedValue) {
    throw new Error("cognitive_graduation_unknown_observation_value_refused");
  }
  const receiptType = input.operationalReceiptType == null
    ? null
    : requireText(input.operationalReceiptType, "operational_receipt_type", 100);
  const receiptId = input.operationalReceiptId == null
    ? null
    : requireText(input.operationalReceiptId, "operational_receipt_id", 200);
  if ((receiptType == null) !== (receiptId == null)) {
    throw new Error("cognitive_graduation_operational_receipt_incomplete");
  }
  if (kind === "receipt_backed" && (receiptType == null || receiptId == null)) {
    throw new Error("cognitive_graduation_operational_receipt_required");
  }
  if (receiptType != null && receiptId != null) {
    validateDeliveryReceipt(db, prediction.ownerId, receiptType, receiptId);
  }
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error("cognitive_graduation_observed_at_invalid");
  }
  const dataClassification = combinedClassification(
    input.dataClassification,
    prediction.dataClassification,
  );
  rejectSecret(dataClassification, "cognitive_graduation_secret_observation_refused");
  return {
    predictionId,
    observableKind,
    observedValueJson: hasTypedValue
      ? requireBoundedJson(input.observedValueTyped, "observed_value", 4000)
      : null,
    observationEvidenceRef,
    observationContentBinding,
    receiptType,
    receiptId,
    kind,
    observedAt,
    dataClassification,
  };
}

/** Record operational truth only. This does not adjudicate semantic success. */
export function recordCognitiveOutcomeObservation(
  db: DatabaseSync,
  input: CognitiveOutcomeObservationInput,
): CognitiveOutcomeObservation {
  const checked = validateObservationInput(db, input);
  const prediction = getCognitivePrediction(db, checked.predictionId);
  if (!prediction) throw new Error("cognitive_graduation_prediction_missing");
  const observationId = randomUUID();
  db.prepare(
    `INSERT INTO cognitive_outcome_observations
       (observation_id, prediction_id, observable_kind, observed_value_typed,
        observation_evidence_ref, observation_content_binding,
        operational_receipt_type, operational_receipt_id, observation_kind,
        observed_at, data_classification, provenance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  ).run(
    observationId,
    checked.predictionId,
    checked.observableKind,
    checked.observedValueJson,
    checked.observationEvidenceRef,
    checked.observationContentBinding,
    checked.receiptType,
    checked.receiptId,
    checked.kind,
    checked.observedAt,
    checked.dataClassification,
    prediction.provenance,
  );
  db.prepare(
    `UPDATE cognitive_predictions SET lifecycle_state = 'observation_available'
     WHERE id = ? AND lifecycle_state IN ('selected', 'awaiting_observation')`,
  ).run(checked.predictionId);
  const observation = observationById(db, observationId);
  if (!observation) throw new Error("cognitive_graduation_observation_readback_failed");
  return observation;
}

export function getCognitiveOutcomeObservation(
  db: DatabaseSync,
  observationId: string,
): CognitiveOutcomeObservation | null {
  assertC4ContractCompatible(db);
  return observationById(db, observationId);
}

export function listCognitiveOutcomeObservations(
  db: DatabaseSync,
  predictionId: number,
): CognitiveOutcomeObservation[] {
  assertC4ContractCompatible(db);
  return db.prepare(
    `SELECT * FROM cognitive_outcome_observations
     WHERE prediction_id = ? ORDER BY observed_at ASC, observation_id ASC`,
  ).all(predictionId).map(observationRow)
    .filter((item): item is CognitiveOutcomeObservation => item !== null);
}
