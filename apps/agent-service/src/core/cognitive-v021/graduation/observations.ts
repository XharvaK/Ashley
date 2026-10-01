// Her predictions meet what happened; observation records operational facts without adjudicating them.
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { DataClassification } from "../../privacy/classification.js";
import { detectCredentialShape } from "../../privacy/secrets.js";
import { getExpectation } from "../growth/expectations.js";
import { assertCompatible, boundedText, combinedClassification, provenance } from "./internal.js";

export type ObservationKind = "receipt_backed" | "missing" | "outcome_unknown";
export type ObservationInput = {
  expectationId: string; observableKind: string; observationKind: ObservationKind;
  observedValueTyped?: unknown; observationEvidenceRef?: string; observationContentBinding?: string;
  operationalReceiptType?: string; operationalReceiptId?: string;
  dataClassification?: DataClassification; nowMs?: number;
};
export type Observation = {
  observationId: string; expectationId: string; observableKind: string; observationKind: ObservationKind;
  observedValueTyped: unknown | null; observationEvidenceRef: string | null; observationContentBinding: string | null;
  operationalReceiptType: string | null; operationalReceiptId: string | null;
  dataClassification: DataClassification; observedAtMs: number; provenance: "live" | "shadow";
};
function map(row: Record<string, unknown>): Observation {
  return {
    observationId: String(row.observation_id), expectationId: String(row.expectation_id), observableKind: String(row.observable_kind), observationKind: row.observation_kind as ObservationKind,
    observedValueTyped: row.observed_value_typed == null ? null : JSON.parse(String(row.observed_value_typed)),
    observationEvidenceRef: row.observation_evidence_ref == null ? null : String(row.observation_evidence_ref),
    observationContentBinding: row.observation_content_binding == null ? null : String(row.observation_content_binding),
    operationalReceiptType: row.operational_receipt_type == null ? null : String(row.operational_receipt_type),
    operationalReceiptId: row.operational_receipt_id == null ? null : String(row.operational_receipt_id),
    dataClassification: row.data_classification as DataClassification, observedAtMs: Number(row.observed_at_ms), provenance: row.provenance === "live" ? "live" : "shadow",
  };
}
export function getObservation(db: DatabaseSync, id: string): Observation | null {
  assertCompatible(db);
  const row = db.prepare("SELECT * FROM graduation_observations WHERE observation_id=?").get(id);
  return row ? map(row) : null;
}
export function listObservations(db: DatabaseSync, expectationId: string): Observation[] {
  assertCompatible(db);
  return db.prepare("SELECT * FROM graduation_observations WHERE expectation_id=? ORDER BY observed_at_ms,rowid").all(expectationId).map(map);
}
export function recordObservation(db: DatabaseSync, input: ObservationInput): Observation {
  assertCompatible(db);
  const expectation = getExpectation(db, input.expectationId);
  if (!expectation) throw new Error("cognitive_graduation_prediction_missing");
  const observableKind = boundedText(input.observableKind, "observable_kind", 64);
  if (!["receipt_backed", "missing", "outcome_unknown"].includes(input.observationKind)) throw new Error("cognitive_graduation_observation_kind_invalid");
  const hasValue = input.observedValueTyped !== undefined;
  const evidence = input.observationEvidenceRef == null ? null : boundedText(input.observationEvidenceRef, "observation_evidence_ref", 200);
  const binding = input.observationContentBinding == null ? null : boundedText(input.observationContentBinding, "observation_content_binding", 200);
  if ((evidence === null) !== (binding === null)) throw new Error("cognitive_graduation_observation_binding_incomplete");
  if (input.observationKind === "receipt_backed" && !hasValue && evidence === null) throw new Error("cognitive_graduation_observed_value_required");
  if (input.observationKind !== "receipt_backed" && hasValue) throw new Error("cognitive_graduation_unknown_observation_value_refused");
  const receiptType = input.operationalReceiptType == null ? null : boundedText(input.operationalReceiptType, "operational_receipt_type", 100);
  const receiptId = input.operationalReceiptId == null ? null : boundedText(input.operationalReceiptId, "operational_receipt_id", 200);
  if ((receiptType === null) !== (receiptId === null)) throw new Error("cognitive_graduation_operational_receipt_incomplete");
  if (input.observationKind === "receipt_backed" && receiptType === null) throw new Error("cognitive_graduation_operational_receipt_required");
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("cognitive_graduation_observed_at_invalid");
  const encoded = hasValue ? JSON.stringify(input.observedValueTyped) : null;
  if (hasValue && (encoded === undefined || encoded === null || Buffer.byteLength(encoded) > 4000)) throw new Error("cognitive_graduation_observed_value_too_large");
  if (encoded && detectCredentialShape(encoded).hit) throw new Error("cognitive_graduation_credential_shape_refused");
  const classification = combinedClassification(input.dataClassification, expectation.dataClassification);
  const id = randomUUID();
  db.prepare(`INSERT INTO graduation_observations (observation_id,expectation_id,observable_kind,observed_value_typed,observation_evidence_ref,observation_content_binding,operational_receipt_type,operational_receipt_id,observation_kind,data_classification,observed_at_ms,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, expectation.expectationId, observableKind, encoded ?? null, evidence, binding, receiptType, receiptId, input.observationKind, classification, nowMs, provenance(db));
  db.prepare("UPDATE expectations SET graduation_lifecycle='observation_available' WHERE expectation_id=? AND graduation_lifecycle IN ('selected','awaiting_observation')").run(input.expectationId);
  return getObservation(db, id)!;
}
