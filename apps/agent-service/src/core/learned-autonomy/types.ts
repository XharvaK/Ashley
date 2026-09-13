import type { DataClassification } from "../privacy/classification.js";

export type LearnedInterestKind = "interest";
export type LearnedSubjectFacet =
  | "owner_model"
  | "external_verifiable"
  | "ashley_side"
  | "unknown";
export type LearnedSemanticOwner =
  | "memory_evidence"
  | "identity"
  | "mind_state"
  | "thought"
  | "agency";
export type LearnedLineageKind =
  | "unknown"
  | "explicit_seed"
  | "owner_designated"
  | "observed_overlap"
  | "ashley_native";
export type LearnedInfluenceClass = "I0" | "I1" | "I2" | "I3";
export type LearnedProposalLifecycle =
  | "proposed"
  | "admitted_to_review"
  | "withdrawn"
  | "expired_as_proposal";
export type LearnedAdjudicationState = "pending" | "accepted" | "declined";
export type LearnedContradictionState =
  | "none"
  | "contradicted"
  | "superseded"
  | "demoted"
  | "expired"
  | "owner_corrected";
export type LearnedAutonomyMode = "observe" | "dark_apply" | "apply";
export type LearnedAdjudicator = "thought" | "natural_owner";
export type LearnedChoiceKind =
  | "curiosity_rank"
  | "motivation_admission"
  | "thought_selection";

export type LearnedInfluenceEvidenceInput = {
  evidenceType: "assertion";
  evidenceId: string;
  assertionId?: number;
  observedAt: string;
  provenance: "live" | "shadow";
  dataClassification?: DataClassification | null;
  sourceContentHash?: string | null;
};

export type LearnedInfluenceCandidateInput = {
  ownerId: string;
  kind: LearnedInterestKind;
  subjectFacet: LearnedSubjectFacet;
  semanticOwner: LearnedSemanticOwner;
  semanticOwnerRef: string;
  lineageKind: LearnedLineageKind;
  influenceClass: LearnedInfluenceClass;
  text: string;
  evidence: LearnedInfluenceEvidenceInput[];
  capabilityMode?: LearnedAutonomyMode;
  adjudication?: {
    adjudicator: LearnedAdjudicator;
    adjudicationDecisionId: string | number;
  };
};

export type LearnedInfluence = {
  id: number;
  entityUuid: string;
  ownerId: string;
  kind: LearnedInterestKind;
  subjectFacet: LearnedSubjectFacet;
  semanticOwner: LearnedSemanticOwner;
  semanticOwnerRef: string;
  lineageKind: LearnedLineageKind;
  influenceClass: LearnedInfluenceClass;
  text: string;
  contentHash: string;
  proposalLifecycle: LearnedProposalLifecycle;
  adjudicationState: LearnedAdjudicationState;
  adjudicator: LearnedAdjudicator | null;
  adjudicationDecisionId: string | null;
  qualifiedAt: string | null;
  contradictionState: LearnedContradictionState;
  contradictionReason: string | null;
  demotedAt: string | null;
  provenance: "live" | "shadow";
  capabilityModeAtWrite: "observe" | "dark_apply" | "apply";
  dataClassification: DataClassification;
  classificationSource: "copied" | "derived_most_restrictive";
  classificationInvalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LearnedInfluenceEvidence = {
  id: number;
  entityUuid: string;
  learnedInfluenceId: number;
  ownerId: string;
  evidenceType: "assertion";
  evidenceId: string;
  assertionId: number;
  observedAt: string;
  provenance: "live" | "shadow";
  dataClassification: DataClassification;
  sourceContentHash: string | null;
  createdAt: string;
};

export type LearnedChoiceReceiptInput = {
  learnedInfluenceId: number;
  choiceKind: LearnedChoiceKind;
  candidateIds: Array<string | number>;
  selectedIds: Array<string | number>;
  rankDelta: Record<string, number>;
  policyBinding: string;
  reasonCode: string;
  inputContentHash: string;
  outputContentHash: string;
  eligibleInputAffectedRanking: boolean;
  agencyMadeFinalChoice: boolean;
  dataClassification?: DataClassification;
};

export type LearnedChoiceReceipt = {
  receiptId: string;
  ownerId: string;
  learnedInfluenceId: number;
  choiceKind: LearnedChoiceKind;
  candidateIds: Array<string | number>;
  selectedIds: Array<string | number>;
  rankDelta: Record<string, number>;
  policyBinding: string;
  reasonCode: string;
  inputContentHash: string;
  outputContentHash: string;
  eligibleInputAffectedRanking: boolean;
  agencyMadeFinalChoice: boolean;
  dataClassification: DataClassification;
  createdAt: string;
};

export type IdentitySeedLineageInput = {
  ownerId: string;
  identityEntryId: number;
  disposition: "retained" | "independently_reinterpreted" | "rejected";
  seedSource: "explicit_seed" | "owner_designated" | "historical" | "historical_source";
};

export type CurrentSharedOverlap = {
  key: string;
  ownerAssertionId: number;
  ashleyAssertionId: number;
  ownerText: string;
  ashleyText: string;
};
