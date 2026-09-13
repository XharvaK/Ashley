import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDecision } from "../agency/log.js";
import { assertC4ContractCompatible, cognitiveGraduationCanInfluence, normalizeC4WriteMode, provenanceForC4Mode } from "./contract-state.js";
import { latestCognitiveOutcomeAdjudication, getCognitiveOutcomeAdjudication } from "./adjudications.js";
import { workingViewRemainsCurrent } from "./view-links.js";
import { getCognitivePrediction } from "./predictions.js";
import {
  combinedClassification,
  isRow,
  nullableText,
  numberValue,
  parseObject,
  rejectSecret,
  requireText,
  text,
  validatePolicyLineage,
} from "./internal.js";
import type {
  CalibrationKind,
  CalibrationLifecycle,
  CorrectionClass,
  C4Mode,
  ThoughtCalibrationAdjustment,
  ThoughtCalibrationAdjustmentInput,
} from "./types.js";

function calibrationKind(value: unknown): CalibrationKind | null {
  return value === "increase_caution" || value === "decrease_caution" ||
    value === "narrow_scope" || value === "request_more_evidence" ||
    value === "hold_for_review"
    ? value
    : null;
}

function lifecycle(value: unknown): CalibrationLifecycle | null {
  return value === "proposed" || value === "admitted" || value === "eligible_for_future_thought" ||
    value === "demoted" || value === "expired" || value === "contradicted" ||
    value === "rolled_back_through_capability"
    ? value
    : null;
}

function correction(value: unknown): CorrectionClass | null {
  return value === "TEMPORAL_SUPERSESSION" || value === "INTERPRETATION_INVALIDATION" ||
    value === "PROVENANCE_CORRECTION" || value === "SCOPE_REFINEMENT" || value === "unclassified"
    ? value
    : null;
}

function adjustmentRow(value: unknown): ThoughtCalibrationAdjustment | null {
  if (!isRow(value)) return null;
  const kind = calibrationKind(value.adjustment_kind);
  const state = lifecycle(value.lifecycle_state);
  if (!kind || !state) return null;
  return {
    adjustmentId: text(value.adjustment_id),
    ownerId: text(value.owner_id),
    predictionId: numberValue(value.prediction_id),
    latestAdmittedAdjudicationId: text(value.latest_admitted_adjudication_id),
    judgmentClass: text(value.judgment_class),
    correctionClass: correction(value.correction_class),
    adjustmentKind: kind,
    effectValue: numberValue(value.effect_value),
    effectiveFrom: text(value.effective_from),
    effectiveTo: nullableText(value.effective_to),
    dataClassification:
      value.data_classification === "ordinary" || value.data_classification === "sensitive" ||
      value.data_classification === "never_public" || value.data_classification === "secret"
        ? value.data_classification
        : "never_public",
    provenance: value.provenance === "live" ? "live" : "shadow",
    capabilityModeAtWrite:
      value.capability_mode_at_write === "dark_apply" || value.capability_mode_at_write === "apply"
        ? value.capability_mode_at_write
        : "observe",
    policyLineage: parseObject(value.policy_lineage_json),
    admittingDecisionId: numberValue(value.admitting_decision_id),
    futureThoughtConsumer: text(value.future_thought_consumer),
    lifecycleState: state,
    createdAt: text(value.created_at),
  };
}

function adjustmentById(db: DatabaseSync, id: string): ThoughtCalibrationAdjustment | null {
  return adjustmentRow(db.prepare(
    `SELECT * FROM thought_calibration_adjustments WHERE adjustment_id = ?`,
  ).get(id));
}

function validateInterval(effectiveFrom: string, effectiveTo: string | null): void {
  if (!Number.isFinite(Date.parse(effectiveFrom))) throw new Error("cognitive_graduation_effective_from_invalid");
  if (effectiveTo != null && (!Number.isFinite(Date.parse(effectiveTo)) || effectiveFrom >= effectiveTo)) {
    throw new Error("cognitive_graduation_effective_interval_invalid");
  }
}

function validateInput(
  db: DatabaseSync,
  input: ThoughtCalibrationAdjustmentInput,
): {
  prediction: NonNullable<ReturnType<typeof getCognitivePrediction>>;
  adjudication: NonNullable<ReturnType<typeof getCognitiveOutcomeAdjudication>>;
  adjustmentKind: CalibrationKind;
  effectValue: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  classification: ReturnType<typeof combinedClassification>;
  policyLineage: string;
  admittingDecisionId: number;
  futureThoughtConsumer: string;
  mode: C4Mode;
} {
  assertC4ContractCompatible(db);
  const ownerId = requireText(input.ownerId, "owner_id", 256);
  const prediction = getCognitivePrediction(db, Number(input.predictionId));
  if (!prediction || prediction.ownerId !== ownerId) throw new Error("cognitive_graduation_prediction_missing");
  const adjudicationId = requireText(
    input.latestAdmittedAdjudicationId,
    "latest_admitted_adjudication_id",
    200,
  );
  const adjudication = getCognitiveOutcomeAdjudication(db, adjudicationId);
  const latest = latestCognitiveOutcomeAdjudication(db, prediction.id);
  if (!adjudication || adjudication.predictionId !== prediction.id || !latest || latest.adjudicationId !== adjudication.adjudicationId) {
    throw new Error("cognitive_graduation_latest_adjudication_required");
  }
  if (!adjudication.hostValidationOk) throw new Error("cognitive_graduation_host_validation_required");
  const adjustmentKind = calibrationKind(input.adjustmentKind);
  if (!adjustmentKind) throw new Error("cognitive_graduation_adjustment_kind_invalid");
  const effectValue = Number(input.effectValue);
  if (!Number.isFinite(effectValue) || effectValue < -0.25 || effectValue > 0.25) {
    throw new Error("cognitive_graduation_adjustment_bound_exceeded");
  }
  const effectiveFrom = input.effectiveFrom ?? new Date().toISOString();
  const effectiveTo = input.effectiveTo == null ? null : input.effectiveTo;
  validateInterval(effectiveFrom, effectiveTo);
  const admittingDecisionId = Number(input.admittingDecisionId);
  if (!Number.isSafeInteger(admittingDecisionId) || admittingDecisionId <= 0 ||
      !getDecision(db, admittingDecisionId) ||
      getDecision(db, admittingDecisionId)?.ownerId !== ownerId) {
    throw new Error("cognitive_graduation_admitting_decision_missing");
  }
  const futureThoughtConsumer = requireText(input.futureThoughtConsumer, "future_thought_consumer", 64);
  if (/current[_ -]?turn|in[-_ ]?flight|agency|identity|relationship/i.test(futureThoughtConsumer)) {
    throw new Error("cognitive_graduation_current_turn_consumer_forbidden");
  }
  const requestedMode = normalizeC4WriteMode(db, input.capabilityMode ?? prediction.capabilityModeAtWrite);
  // A shadow-era prediction can never become live merely because a later
  // caller asks for dark apply. This preserves C1 time-shift isolation.
  const mode = requestedMode === "dark_apply" &&
    prediction.provenance === "live" &&
    prediction.capabilityModeAtWrite === "dark_apply"
    ? requestedMode
    : "observe";
  const classification = combinedClassification(
    input.dataClassification,
    prediction.dataClassification,
    adjudication.dataClassification,
  );
  rejectSecret(classification, "cognitive_graduation_secret_calibration_refused");
  return {
    prediction,
    adjudication,
    adjustmentKind,
    effectValue,
    effectiveFrom,
    effectiveTo,
    classification,
    policyLineage: validatePolicyLineage(input.policyLineage ?? prediction.policyLineage),
    admittingDecisionId,
    futureThoughtConsumer,
    mode,
  };
}

/**
 * Reflection/Thought may append a bounded adjustment for a future Thought.
 * This function never updates the admitting or any in-flight Decision.
 */
export function recordThoughtCalibrationAdjustment(
  db: DatabaseSync,
  input: ThoughtCalibrationAdjustmentInput,
): ThoughtCalibrationAdjustment {
  const checked = validateInput(db, input);
  const duplicate = db.prepare(
    `SELECT * FROM thought_calibration_adjustments
     WHERE owner_id = ? AND prediction_id = ?
       AND latest_admitted_adjudication_id = ?
       AND adjustment_kind = ? AND effect_value = ?
       AND future_thought_consumer = ?
       AND lifecycle_state <> 'rolled_back_through_capability'
     ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  ).get(
    checked.prediction.ownerId,
    checked.prediction.id,
    checked.adjudication.adjudicationId,
    checked.adjustmentKind,
    checked.effectValue,
    checked.futureThoughtConsumer,
  );
  const existing = adjustmentRow(duplicate);
  if (existing) return existing;
  const createdAt = new Date().toISOString();
  const id = randomUUID();
  const state: CalibrationLifecycle = checked.mode === "dark_apply"
    ? "eligible_for_future_thought"
    : "proposed";
  db.prepare(
    `INSERT INTO thought_calibration_adjustments
       (adjustment_id, owner_id, prediction_id, latest_admitted_adjudication_id,
        judgment_class, correction_class, adjustment_kind, effect_value,
        effective_from, effective_to, data_classification, provenance,
        capability_mode_at_write, policy_lineage_json, admitting_decision_id,
        future_thought_consumer, lifecycle_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  ).run(
    id,
    checked.prediction.ownerId,
    checked.prediction.id,
    checked.adjudication.adjudicationId,
    checked.prediction.judgmentClass,
    checked.adjudication.correctionClass,
    checked.adjustmentKind,
    checked.effectValue,
    checked.effectiveFrom,
    checked.effectiveTo,
    checked.classification,
    provenanceForC4Mode(checked.mode),
    checked.mode,
    checked.policyLineage,
    checked.admittingDecisionId,
    checked.futureThoughtConsumer,
    state,
    createdAt,
  );
  const adjustment = adjustmentById(db, id);
  if (!adjustment) throw new Error("cognitive_graduation_calibration_readback_failed");
  return adjustment;
}

export function getThoughtCalibrationAdjustment(
  db: DatabaseSync,
  adjustmentId: string,
): ThoughtCalibrationAdjustment | null {
  assertC4ContractCompatible(db);
  return adjustmentById(db, adjustmentId);
}

function intervalActive(row: ThoughtCalibrationAdjustment, at: string): boolean {
  return row.effectiveFrom <= at && (row.effectiveTo == null || at < row.effectiveTo);
}

function eligibleAdjustment(
  db: DatabaseSync,
  row: ThoughtCalibrationAdjustment,
  mode: C4Mode,
  at: string,
): boolean {
  if (!cognitiveGraduationCanInfluence(db, mode)) return false;
  if (row.lifecycleState !== "eligible_for_future_thought" || row.provenance !== "live" ||
      row.capabilityModeAtWrite !== "dark_apply" || !intervalActive(row, at)) return false;
  const prediction = getCognitivePrediction(db, row.predictionId);
  if (!prediction || prediction.ownerId !== row.ownerId || prediction.lifecycleState === "abandoned") return false;
  const latest = latestCognitiveOutcomeAdjudication(db, prediction.id);
  if (!latest || latest.adjudicationId !== row.latestAdmittedAdjudicationId || !latest.hostValidationOk) return false;
  return workingViewRemainsCurrent(db, prediction, at);
}

/** Read path for future Thought only. Observe and stale C1 state return none. */
export function listEligibleThoughtCalibration(
  db: DatabaseSync,
  ownerId: string,
  options: { mode?: C4Mode; at?: string } = {},
): Array<ThoughtCalibrationAdjustment & { eligibleNow: true }> {
  assertC4ContractCompatible(db);
  const mode = options.mode ?? "observe";
  const at = options.at ?? new Date().toISOString();
  const rows = db.prepare(
    `SELECT * FROM thought_calibration_adjustments
     WHERE owner_id = ? ORDER BY effective_from ASC, created_at ASC, rowid ASC`,
  ).all(ownerId).map(adjustmentRow)
    .filter((row): row is ThoughtCalibrationAdjustment => row !== null);
  return rows.flatMap((row) => eligibleAdjustment(db, row, mode, at)
    ? [{ ...row, eligibleNow: true as const }]
    : []);
}

export function listThoughtCalibrationAdjustments(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): ThoughtCalibrationAdjustment[] {
  assertC4ContractCompatible(db);
  return db.prepare(
    `SELECT * FROM thought_calibration_adjustments
     WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).all(ownerId, Math.max(1, Math.min(200, limit))).map(adjustmentRow)
    .filter((row): row is ThoughtCalibrationAdjustment => row !== null);
}

/** Capability rollback disables future influence without deleting history. */
export function rollbackCognitiveGraduation(
  db: DatabaseSync,
  ownerId: string,
): number {
  assertC4ContractCompatible(db);
  const result = db.prepare(
    `UPDATE thought_calibration_adjustments
     SET lifecycle_state = 'rolled_back_through_capability'
     WHERE owner_id = ? AND lifecycle_state = 'eligible_for_future_thought'`,
  ).run(ownerId);
  return Number(result.changes);
}
