import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDecision } from "../agency/log.js";
import { listLearnedInfluenceEvidence } from "../learned-autonomy/admit.js";
import { listActiveLearnedInfluences } from "../learned-autonomy/eligibility.js";
import { getAssertion } from "../memory/assertions.js";
import { influenceEligibleAt } from "../memory/eligibility.js";
import {
  combinedClassification,
  hasUnsafeReasoningMarker,
  isRow,
  normalizeEvidenceRefs,
  numberValue,
  parseEvidenceRefs,
  parseObject,
  nullableNumber,
  rejectSecret,
  requireBoundedJson,
  requireText,
  assertionIds,
  text,
  validatePolicyLineage,
} from "./internal.js";
import {
  normalizeC4WriteMode,
  provenanceForC4Mode,
  assertC4ContractCompatible,
} from "./contract-state.js";
import type {
  CognitiveEvidenceRef,
  CognitivePrediction,
  CognitivePredictionInput,
  C4Mode,
  PredictionLifecycle,
} from "./types.js";

type Row = Record<string, unknown>;

function lifecycle(value: unknown): PredictionLifecycle | null {
  return value === "selected" || value === "awaiting_observation" ||
    value === "observation_available" || value === "closed" || value === "abandoned"
    ? value
    : null;
}

function predictionRow(value: unknown): CognitivePrediction | null {
  if (!isRow(value)) return null;
  const state = lifecycle(value.lifecycle_state);
  if (!state) return null;
  return {
    id: numberValue(value.id),
    entityUuid: text(value.entity_uuid),
    ownerId: text(value.owner_id),
    decisionId: nullableNumber(value.decision_id),
    judgmentText: text(value.judgment_text),
    judgmentClass: text(value.judgment_class),
    evidenceRefs: parseEvidenceRefs(value.evidence_refs_json),
    evidentialStrength: numberValue(value.evidential_strength),
    expectedObservableOutcome: text(value.expected_observable_outcome),
    expectedHorizon: text(value.expected_horizon),
    modelRouteReceiptId: text(value.model_route_receipt_id),
    workingViewAssertionId: nullableNumber(value.working_view_assertion_id),
    lifecycleState: state,
    selected: Number(value.selected) === 1,
    dataClassification:
      value.data_classification === "ordinary" ||
      value.data_classification === "sensitive" ||
      value.data_classification === "never_public" ||
      value.data_classification === "secret"
        ? value.data_classification
        : "never_public",
    classificationSource: value.classification_source === "copied"
      ? "copied"
      : "derived_most_restrictive",
    provenance: value.provenance === "live" ? "live" : "shadow",
    capabilityModeAtWrite:
      value.capability_mode_at_write === "dark_apply" || value.capability_mode_at_write === "apply"
        ? value.capability_mode_at_write
        : "observe",
    policyLineage: parseObject(value.policy_lineage_json),
    createdAt: text(value.created_at),
  };
}

function predictionById(db: DatabaseSync, id: number): CognitivePrediction | null {
  return predictionRow(db.prepare(
    `SELECT * FROM cognitive_predictions WHERE id = ?`,
  ).get(id));
}

function expectedOutcomeText(value: unknown): string {
  if (typeof value === "string") return requireText(value, "expected_observable_outcome", 1000);
  const encoded = requireBoundedJson(value, "expected_observable_outcome", 4000);
  return requireText(encoded, "expected_observable_outcome", 1000);
}

function validateDate(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`cognitive_graduation_${name}_invalid`);
  }
}

function validateC1Evidence(
  db: DatabaseSync,
  ownerId: string,
  ids: number[],
  at: string,
): { classifications: Array<"ordinary" | "sensitive" | "never_public" | "secret">; assertionIds: number[] } {
  const uniqueIds = [...new Set(ids)];
  const classifications: Array<"ordinary" | "sensitive" | "never_public" | "secret"> = [];
  for (const assertionId of uniqueIds) {
    const assertion = getAssertion(db, assertionId);
    if (!assertion || assertion.ownerId !== ownerId) {
      throw new Error("cognitive_graduation_c1_evidence_assertion_missing");
    }
    if (!influenceEligibleAt(db, assertionId, at)) {
      throw new Error("cognitive_graduation_c1_evidence_not_current");
    }
    classifications.push(assertion.dataClassification);
  }
  return { classifications, assertionIds: uniqueIds };
}

function learnedInfluenceIds(refs: CognitiveEvidenceRef[]): number[] {
  return refs.flatMap((ref) => {
    if (ref.type !== "learned_influence") return [];
    const id = Number(ref.id);
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  });
}

function validateC3Evidence(
  db: DatabaseSync,
  ownerId: string,
  refs: CognitiveEvidenceRef[],
  at: string,
  mode: C4Mode,
): { classifications: Array<"ordinary" | "sensitive" | "never_public" | "secret">; assertionIds: number[] } {
  const ids = learnedInfluenceIds(refs);
  if (refs.some((ref) => ref.type === "learned_influence" && !ids.includes(Number(ref.id)))) {
    throw new Error("cognitive_graduation_c3_learned_influence_invalid");
  }
  if (ids.length === 0) return { classifications: [], assertionIds: [] };
  if (mode !== "dark_apply") {
    throw new Error("cognitive_graduation_c3_learned_influence_requires_dark_apply");
  }
  const active = new Map(
    listActiveLearnedInfluences(db, ownerId, {
      mode: "dark_apply",
      at: new Date(at),
    }).map((influence) => [influence.id, influence]),
  );
  const classifications: Array<"ordinary" | "sensitive" | "never_public" | "secret"> = [];
  const assertionIds: number[] = [];
  for (const id of [...new Set(ids)]) {
    const influence = active.get(id);
    if (!influence) {
      throw new Error("cognitive_graduation_c3_learned_influence_not_current");
    }
    classifications.push(influence.dataClassification);
    const evidence = listLearnedInfluenceEvidence(db, id);
    if (evidence.length < 2 || evidence.some((item) => item.provenance !== "live")) {
      throw new Error("cognitive_graduation_c3_learned_evidence_not_current");
    }
    for (const item of evidence) {
      const assertion = getAssertion(db, item.assertionId);
      if (!assertion || assertion.ownerId !== ownerId || !influenceEligibleAt(db, assertion.id, at)) {
        throw new Error("cognitive_graduation_c3_learned_evidence_not_current");
      }
      classifications.push(assertion.dataClassification);
      assertionIds.push(assertion.id);
    }
  }
  return { classifications, assertionIds: [...new Set(assertionIds)] };
}

function validatePredictionInput(
  db: DatabaseSync,
  input: CognitivePredictionInput,
  now: string,
): {
  ownerId: string;
  decisionId: number | null;
  judgmentText: string;
  judgmentClass: string;
  evidenceRefs: ReturnType<typeof normalizeEvidenceRefs>;
  evidentialStrength: number;
  expectedOutcome: string;
  expectedHorizon: string;
  routeReceipt: string;
  workingViewAssertionId: number | null;
  classification: "ordinary" | "sensitive" | "never_public" | "secret";
  policyLineage: string;
  mode: C4Mode;
} {
  assertC4ContractCompatible(db);
  const ownerId = requireText(input.ownerId, "owner_id", 256);
  const judgmentText = requireText(input.judgmentText, "judgment_text", 600);
  if (hasUnsafeReasoningMarker(judgmentText)) {
    throw new Error("cognitive_graduation_chain_of_thought_refused");
  }
  const judgmentClass = requireText(input.judgmentClass, "judgment_class", 64);
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
  const mode = normalizeC4WriteMode(db, input.capabilityMode);
  const c1 = validateC1Evidence(db, ownerId, assertionIds(evidenceRefs), now);
  const c3 = validateC3Evidence(db, ownerId, evidenceRefs, now, mode);
  const currentAssertionIds = [...new Set([...c1.assertionIds, ...c3.assertionIds])];
  if (currentAssertionIds.length < 2) {
    throw new Error("cognitive_graduation_c1_evidence_minimum");
  }
  const evidentialStrength = Number(input.evidentialStrength);
  if (!Number.isFinite(evidentialStrength) || evidentialStrength < 0 || evidentialStrength > 1) {
    throw new Error("cognitive_graduation_evidential_strength_invalid");
  }
  const expectedOutcome = expectedOutcomeText(input.expectedObservableOutcome);
  if (hasUnsafeReasoningMarker(expectedOutcome)) {
    throw new Error("cognitive_graduation_chain_of_thought_refused");
  }
  const expectedHorizon = requireText(input.expectedHorizon, "expected_horizon", 128);
  const routeReceipt = requireText(input.modelRouteReceiptId, "model_route_receipt_id", 200);
  if (input.selected === false) throw new Error("cognitive_graduation_selection_required");

  let decisionId: number | null = null;
  if (input.decisionId != null) {
    const candidate = Number(input.decisionId);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) {
      throw new Error("cognitive_graduation_decision_invalid");
    }
    const decision = getDecision(db, candidate);
    if (!decision || decision.ownerId !== ownerId) {
      throw new Error("cognitive_graduation_decision_missing");
    }
    decisionId = candidate;
  }

  const workingViewAssertionId = input.workingViewAssertionId == null
    ? currentAssertionIds[0] ?? null
    : Number(input.workingViewAssertionId);
  if (workingViewAssertionId == null || !currentAssertionIds.includes(workingViewAssertionId)) {
    throw new Error("cognitive_graduation_working_view_assertion_required");
  }

  const classification = combinedClassification(
    input.dataClassification,
    ...c1.classifications,
    ...c3.classifications,
  );
  rejectSecret(classification, "cognitive_graduation_secret_evidence_refused");
  const policyLineage = validatePolicyLineage(input.policyLineage);
  return {
    ownerId,
    decisionId,
    judgmentText,
    judgmentClass,
    evidenceRefs,
    evidentialStrength,
    expectedOutcome,
    expectedHorizon,
    routeReceipt,
    workingViewAssertionId,
    classification,
    policyLineage,
    mode,
  };
}

/**
 * Thought-owned explicit selection of one consequential prediction. This is
 * never inferred from uncertainty, initiative learning, model text, or an
 * outcome field on decision_log.
 */
export function selectConsequentialPrediction(
  db: DatabaseSync,
  input: CognitivePredictionInput,
): CognitivePrediction {
  const createdAt = input.createdAt ?? new Date().toISOString();
  validateDate(createdAt, "created_at");
  const checked = validatePredictionInput(db, input, createdAt);
  const result = db.prepare(
    `INSERT INTO cognitive_predictions
       (entity_uuid, owner_id, decision_id, judgment_text, judgment_class,
        evidence_refs_json, evidential_strength, expected_observable_outcome,
        expected_horizon, model_route_receipt_id, working_view_assertion_id,
        lifecycle_state, selected, data_classification, classification_source,
        provenance, capability_mode_at_write, policy_lineage_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'selected', 1, ?,
             'derived_most_restrictive', ?, ?, ?, ?)` ,
  ).run(
    randomUUID(),
    checked.ownerId,
    checked.decisionId,
    checked.judgmentText,
    checked.judgmentClass,
    requireBoundedJson(checked.evidenceRefs, "evidence_refs", 8000),
    checked.evidentialStrength,
    checked.expectedOutcome,
    checked.expectedHorizon,
    checked.routeReceipt,
    checked.workingViewAssertionId,
    checked.classification,
    provenanceForC4Mode(checked.mode),
    checked.mode,
    checked.policyLineage,
    createdAt,
  );
  const prediction = predictionById(db, Number(result.lastInsertRowid));
  if (!prediction) throw new Error("cognitive_graduation_prediction_readback_failed");
  db.prepare(
    `INSERT OR IGNORE INTO working_view_links
       (prediction_id, assertion_id, link_role) VALUES (?, ?, 'primary_working_view')`,
  ).run(prediction.id, checked.workingViewAssertionId);
  return prediction;
}

export function getCognitivePrediction(
  db: DatabaseSync,
  predictionId: number,
): CognitivePrediction | null {
  assertC4ContractCompatible(db);
  return predictionById(db, predictionId);
}

export function listCognitivePredictions(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): CognitivePrediction[] {
  assertC4ContractCompatible(db);
  return db.prepare(
    `SELECT * FROM cognitive_predictions
     WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(ownerId, Math.max(1, Math.min(200, limit)))
    .map(predictionRow)
    .filter((item): item is CognitivePrediction => item !== null);
}

export function markPredictionAwaitingObservation(
  db: DatabaseSync,
  predictionId: number,
): CognitivePrediction | null {
  assertC4ContractCompatible(db);
  db.prepare(
    `UPDATE cognitive_predictions
     SET lifecycle_state = 'awaiting_observation'
     WHERE id = ? AND lifecycle_state = 'selected'`,
  ).run(predictionId);
  return predictionById(db, predictionId);
}

export function expectedOutcomeForPrediction(
  prediction: CognitivePrediction,
): unknown {
  const parsed = (() => {
    try { return JSON.parse(prediction.expectedObservableOutcome) as unknown; } catch { return undefined; }
  })();
  return parsed === undefined ? prediction.expectedObservableOutcome : parsed;
}
