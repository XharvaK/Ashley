import type { DataClassification } from "../privacy/classification.js";
import type { EvidenceRef } from "../types.js";

export type C4Mode = "observe" | "dark_apply" | "apply";
export type C4Provenance = "shadow" | "live";

export type CognitiveEvidenceRef = EvidenceRef | {
  type: "assertion" | "learned_influence";
  id: string | number;
};

export type PredictionLifecycle =
  | "selected"
  | "awaiting_observation"
  | "observation_available"
  | "closed"
  | "abandoned";

export type OutcomeObservationKind =
  | "receipt_backed"
  | "missing"
  | "outcome_unknown";

export type OutcomeDisposition =
  | "confirmed"
  | "contradicted"
  | "partial_support"
  | "unresolved";

export type AdjudicationProposalOrigin =
  | "model"
  | "worker"
  | "deterministic_extractor"
  | "owner";

export type AdjudicationAuthority =
  | "deterministic_compare"
  | "ashley_thought_reflection"
  | "owner_confirmed";

export type CorrectionClass =
  | "TEMPORAL_SUPERSESSION"
  | "INTERPRETATION_INVALIDATION"
  | "PROVENANCE_CORRECTION"
  | "SCOPE_REFINEMENT"
  | "unclassified";

export type CalibrationKind =
  | "increase_caution"
  | "decrease_caution"
  | "narrow_scope"
  | "request_more_evidence"
  | "hold_for_review";

export type CalibrationLifecycle =
  | "proposed"
  | "admitted"
  | "eligible_for_future_thought"
  | "demoted"
  | "expired"
  | "contradicted"
  | "rolled_back_through_capability";

export type CognitivePrediction = {
  id: number;
  entityUuid: string;
  ownerId: string;
  decisionId: number | null;
  judgmentText: string;
  judgmentClass: string;
  evidenceRefs: CognitiveEvidenceRef[];
  evidentialStrength: number;
  expectedObservableOutcome: string;
  expectedHorizon: string;
  modelRouteReceiptId: string;
  workingViewAssertionId: number | null;
  lifecycleState: PredictionLifecycle;
  selected: boolean;
  dataClassification: DataClassification;
  classificationSource: "copied" | "derived_most_restrictive";
  provenance: C4Provenance;
  capabilityModeAtWrite: C4Mode;
  policyLineage: Record<string, unknown>;
  createdAt: string;
};

export type CognitivePredictionInput = {
  ownerId: string;
  decisionId?: number | null;
  judgmentText: string;
  judgmentClass: string;
  evidenceRefs: CognitiveEvidenceRef[];
  evidentialStrength: number;
  expectedObservableOutcome: string | unknown;
  expectedHorizon: string;
  modelRouteReceiptId: string;
  workingViewAssertionId?: number | null;
  dataClassification?: DataClassification | null;
  policyLineage?: Record<string, unknown>;
  capabilityMode?: C4Mode;
  selected?: boolean;
  createdAt?: string;
};

export type CognitiveOutcomeObservation = {
  observationId: string;
  predictionId: number;
  observableKind: string;
  observedValueTyped: unknown | null;
  observationEvidenceRef: string | null;
  observationContentBinding: string | null;
  operationalReceiptType: string | null;
  operationalReceiptId: string | null;
  observationKind: OutcomeObservationKind;
  observedAt: string;
  dataClassification: DataClassification;
  provenance: C4Provenance;
};

export type CognitiveOutcomeObservationInput = {
  predictionId: number;
  observableKind: string;
  observedValueTyped?: unknown;
  observationEvidenceRef?: string | null;
  observationContentBinding?: string | null;
  operationalReceiptType?: string | null;
  operationalReceiptId?: string | null;
  observationKind: OutcomeObservationKind;
  observedAt?: string;
  dataClassification?: DataClassification | null;
};

export type CognitiveOutcomeAdjudication = {
  adjudicationId: string;
  predictionId: number;
  observationId: string;
  disposition: OutcomeDisposition;
  proposalOrigin: AdjudicationProposalOrigin;
  hostValidationOk: boolean;
  adjudicationAuthority: AdjudicationAuthority;
  adjudicatingDecisionId: number | null;
  comparatorPolicyVersion: string | null;
  supersedesAdjudicationId: string | null;
  correctionClass: CorrectionClass | null;
  dataClassification: DataClassification;
  provenance: C4Provenance;
  createdAt: string;
};

export type CognitiveOutcomeAdjudicationInput = {
  predictionId: number;
  observationId: string;
  disposition: OutcomeDisposition;
  proposalOrigin: AdjudicationProposalOrigin;
  hostValidationOk: boolean;
  adjudicationAuthority: AdjudicationAuthority | string;
  adjudicatingDecisionId?: number | null;
  comparatorPolicyVersion?: string | null;
  supersedesAdjudicationId?: string | null;
  correctionClass?: CorrectionClass | null;
  dataClassification?: DataClassification | null;
};

export type WorkingViewLink = {
  predictionId: number;
  assertionId: number;
  linkRole: string;
};

export type LivedExperienceLink = {
  id: string;
  ownerId: string;
  episodeId: number | null;
  predictionId: number | null;
  operationalRef: string;
  reflectionEventId: number | null;
  revisionId: number | null;
  dataClassification: DataClassification;
  provenance: C4Provenance;
  evidenceRefs: CognitiveEvidenceRef[];
  validityState: "active" | "invalidated";
  invalidatedAt: string | null;
  createdAt: string;
};

export type LivedExperienceLinkInput = {
  ownerId: string;
  episodeId?: number | null;
  predictionId?: number | null;
  operationalRef: string;
  reflectionEventId?: number | null;
  revisionId?: number | null;
  dataClassification?: DataClassification | null;
  evidenceRefs?: CognitiveEvidenceRef[];
  capabilityMode?: C4Mode;
};

export type ThoughtCalibrationAdjustment = {
  adjustmentId: string;
  ownerId: string;
  predictionId: number;
  latestAdmittedAdjudicationId: string;
  judgmentClass: string;
  correctionClass: CorrectionClass | null;
  adjustmentKind: CalibrationKind;
  effectValue: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  dataClassification: DataClassification;
  provenance: C4Provenance;
  capabilityModeAtWrite: C4Mode;
  policyLineage: Record<string, unknown>;
  admittingDecisionId: number;
  futureThoughtConsumer: string;
  lifecycleState: CalibrationLifecycle;
  createdAt: string;
};

export type ThoughtCalibrationAdjustmentInput = {
  ownerId: string;
  predictionId: number;
  latestAdmittedAdjudicationId: string;
  adjustmentKind: CalibrationKind;
  effectValue: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  dataClassification?: DataClassification | null;
  policyLineage?: Record<string, unknown>;
  admittingDecisionId: number;
  futureThoughtConsumer: string;
  capabilityMode?: C4Mode;
};

export type EligibleThoughtCalibration = ThoughtCalibrationAdjustment & {
  eligibleNow: true;
};
