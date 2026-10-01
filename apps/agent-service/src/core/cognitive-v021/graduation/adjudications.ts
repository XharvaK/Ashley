// Semantic adjudications are explicit, attributable, and append-only.
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { DataClassification } from "../../privacy/classification.js";
import { getExpectation } from "../growth/expectations.js";
import { getObservation } from "./observations.js";
import { assertCompatible, boundedText, combinedClassification, stableEqual } from "./internal.js";

export const DISPOSITIONS = ["confirmed", "contradicted", "partial_support", "unresolved"] as const;
export type Disposition = typeof DISPOSITIONS[number];
export const CORRECTION_CLASSES = ["TEMPORAL_SUPERSESSION", "INTERPRETATION_INVALIDATION", "PROVENANCE_CORRECTION", "SCOPE_REFINEMENT", "unclassified"] as const;
export type AdjudicationInput = {
  expectationId: string; observationId: string; disposition: Disposition;
  proposalOrigin: "model" | "worker" | "deterministic_extractor" | "owner";
  hostValidationOk: boolean;
  adjudicationAuthority: "deterministic_compare" | "ashley_thought_reflection" | "owner_confirmed";
  adjudicatingCycleId?: string; comparatorPolicyVersion?: string;
  supersedesAdjudicationId?: string; correctionClass?: typeof CORRECTION_CLASSES[number];
  dataClassification?: DataClassification; nowMs?: number;
};
export type Adjudication = {
  adjudicationId: string; expectationId: string; observationId: string; disposition: Disposition;
  proposalOrigin: AdjudicationInput["proposalOrigin"]; hostValidationOk: boolean;
  adjudicationAuthority: AdjudicationInput["adjudicationAuthority"];
  adjudicatingCycleId: string | null; comparatorPolicyVersion: string | null;
  supersedesAdjudicationId: string | null; correctionClass: AdjudicationInput["correctionClass"] | null;
  dataClassification: DataClassification; createdAtMs: number;
};
function map(row: Record<string, unknown>): Adjudication {
  return {
    adjudicationId: String(row.adjudication_id), expectationId: String(row.expectation_id), observationId: String(row.observation_id), disposition: row.disposition as Disposition,
    proposalOrigin: row.proposal_origin as AdjudicationInput["proposalOrigin"], hostValidationOk: Number(row.host_validation_ok) === 1,
    adjudicationAuthority: row.adjudication_authority as AdjudicationInput["adjudicationAuthority"],
    adjudicatingCycleId: row.adjudicating_cycle_id == null ? null : String(row.adjudicating_cycle_id),
    comparatorPolicyVersion: row.comparator_policy_version == null ? null : String(row.comparator_policy_version),
    supersedesAdjudicationId: row.supersedes_adjudication_id == null ? null : String(row.supersedes_adjudication_id),
    correctionClass: row.correction_class as Adjudication["correctionClass"], dataClassification: row.data_classification as DataClassification, createdAtMs: Number(row.created_at_ms),
  };
}
export function listAdjudications(db: DatabaseSync, expectationId: string): Adjudication[] {
  assertCompatible(db);
  return db.prepare("SELECT * FROM graduation_adjudications WHERE expectation_id=? ORDER BY created_at_ms,rowid").all(expectationId).map(map);
}
export function latestAdjudication(db: DatabaseSync, expectationId: string): Adjudication | null {
  assertCompatible(db);
  const row = db.prepare("SELECT * FROM graduation_adjudications WHERE expectation_id=? ORDER BY created_at_ms DESC,rowid DESC LIMIT 1").get(expectationId);
  return row ? map(row) : null;
}
export function recordAdjudication(db: DatabaseSync, input: AdjudicationInput): Adjudication {
  assertCompatible(db);
  const expectation = getExpectation(db, input.expectationId);
  const observation = getObservation(db, input.observationId);
  if (!expectation) throw new Error("cognitive_graduation_prediction_missing");
  if (!observation || observation.expectationId !== input.expectationId) throw new Error("cognitive_graduation_observation_missing");
  if ((input.adjudicationAuthority as string) === "thought_reflection_proposed") throw new Error("cognitive_graduation_proposed_authority_forbidden");
  if (!DISPOSITIONS.includes(input.disposition)) throw new Error("cognitive_graduation_disposition_invalid");
  if (!["model", "worker", "deterministic_extractor", "owner"].includes(input.proposalOrigin)) throw new Error("cognitive_graduation_proposal_origin_invalid");
  if (!["deterministic_compare", "ashley_thought_reflection", "owner_confirmed"].includes(input.adjudicationAuthority)) throw new Error("cognitive_graduation_authority_invalid");
  if (input.hostValidationOk !== true) throw new Error("cognitive_graduation_host_validation_required");
  const cycleId = input.adjudicatingCycleId == null ? null : boundedText(input.adjudicatingCycleId, "adjudicating_cycle_id", 200);
  const policy = input.comparatorPolicyVersion == null ? null : boundedText(input.comparatorPolicyVersion, "comparator_policy_version", 100);
  const automaticMissing = input.adjudicationAuthority === "deterministic_compare"
    && observation.observationKind === "missing" && expectation.check !== null
    && observation.observableKind === expectation.check && policy === `${expectation.check}.v1`;
  if (input.adjudicationAuthority === "deterministic_compare") {
    if (cycleId !== null || policy === null) throw new Error("cognitive_graduation_deterministic_binding_invalid");
    let expected: unknown;
    if (policy === "owner_reply.v1" && expectation.check === "owner_reply") expected = { replied: true };
    else if (policy === "delivered.v1" && expectation.check === "delivered") expected = { delivered: true };
    else if (expectation.observable !== null) {
      try { expected = JSON.parse(expectation.observable); } catch { expected = expectation.observable; }
    }
    const computed = automaticMissing ? "contradicted" : observation.observationKind !== "receipt_backed" || observation.observedValueTyped === null
      ? "unresolved" : expected === undefined ? null : stableEqual(expected, observation.observedValueTyped) ? "confirmed" : "contradicted";
    if (computed === null || computed !== input.disposition) throw new Error("cognitive_graduation_deterministic_comparison_invalid");
  } else {
    if (cycleId === null || policy !== null) throw new Error("cognitive_graduation_semantic_binding_invalid");
    if (!db.prepare("SELECT 1 FROM cycle_records WHERE cycle_id=?").get(cycleId)) throw new Error("cognitive_graduation_adjudicating_decision_missing");
    if (input.adjudicationAuthority === "owner_confirmed" && input.proposalOrigin !== "owner") throw new Error("cognitive_graduation_owner_confirmation_origin_required");
  }
  if (observation.observationKind !== "receipt_backed" && input.disposition !== "unresolved" && !automaticMissing) throw new Error("cognitive_graduation_unknown_outcome_unresolved_required");
  const supersedes = input.supersedesAdjudicationId == null ? null : boundedText(input.supersedesAdjudicationId, "supersedes_adjudication_id", 200);
  if (supersedes && !db.prepare("SELECT 1 FROM graduation_adjudications WHERE adjudication_id=? AND expectation_id=?").get(supersedes, input.expectationId)) throw new Error("cognitive_graduation_superseded_adjudication_missing");
  if (input.correctionClass !== undefined && !CORRECTION_CLASSES.includes(input.correctionClass)) throw new Error("cognitive_graduation_correction_class_invalid");
  const classification = combinedClassification(input.dataClassification, expectation.dataClassification, observation.dataClassification);
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("cognitive_graduation_adjudicated_at_invalid");
  const id = randomUUID();
  db.prepare(`INSERT INTO graduation_adjudications (adjudication_id,expectation_id,observation_id,disposition,proposal_origin,host_validation_ok,adjudication_authority,adjudicating_cycle_id,comparator_policy_version,supersedes_adjudication_id,correction_class,data_classification,created_at_ms) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?)`).run(id, input.expectationId, input.observationId, input.disposition, input.proposalOrigin, input.adjudicationAuthority, cycleId, policy, supersedes, input.correctionClass ?? null, classification, nowMs);
  db.prepare("UPDATE expectations SET graduation_lifecycle=CASE WHEN ?='unresolved' THEN 'observation_available' ELSE 'closed' END WHERE expectation_id=? AND graduation_lifecycle<>'abandoned'").run(input.disposition, input.expectationId);
  return map(db.prepare("SELECT * FROM graduation_adjudications WHERE adjudication_id=?").get(id)!);
}
