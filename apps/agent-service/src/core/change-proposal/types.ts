export const CHANGE_PROPOSAL_TARGET_CATEGORIES = [
  "runtime_code",
  "prompt_expression",
  "ordinary_identity",
  "foundational_identity",
  "ethics_governance",
  "capability_policy",
  "evaluation",
  "vision",
] as const;

export type ChangeProposalTargetCategory =
  (typeof CHANGE_PROPOSAL_TARGET_CATEGORIES)[number];

export const CHANGE_PROPOSAL_STATES = [
  "draft",
  "proposed",
  "awaiting_ashley_position",
  "awaiting_doc_decision",
  "approved",
  "rejected",
  "deferred",
  "expired",
  "stale_base",
  "quarantined",
  "superseded",
] as const;

export type ChangeProposalState = (typeof CHANGE_PROPOSAL_STATES)[number];

export type VerifyStatus = "succeeded" | "failed" | "unsupported" | "unverified";

export type TestReceiptRef = {
  artifactRef: string;
  entityUuid: string;
  taskId: string;
  verified: boolean;
  verifyStatus: VerifyStatus;
  recipeId?: string;
  contentHash?: string;
};

export const ALLOWED_EVENT_PAYLOAD_KEYS = new Set([
  "artifactRef",
  "entityUuid",
  "taskId",
  "hash",
  "statusCode",
  "errorCode",
  "baseCommit",
  "baseTreeHash",
  "recipeId",
  "brokerState",
  "verifyStatus",
  "archiveManifestRef",
  "archiveAggregateHash",
  "segmentIndex",
  "excludedPathCount",
  "tombstoneId",
  "linkedEntityUuid",
  "classification",
]);

export type ChangeProposalRecord = {
  id: number;
  entityUuid: string;
  ownerId: string;
  proposalId: string;
  proposer: "ashley" | "operator";
  targetCategory: ChangeProposalTargetCategory;
  objective: string;
  rationale: string;
  riskClass: "low" | "medium" | "high" | "consultation";
  dataClassification: string;
  state: ChangeProposalState;
  baseCommit: string | null;
  baseTreeHash: string | null;
  baseStale: boolean;
  testReceiptRefs: TestReceiptRef[];
  consultationRequired: boolean;
  ashleyPosition: "affirm" | "object" | "defer" | null;
  docDecision: "approve" | "reject" | "defer" | null;
  linkedRevisionEntityUuid: string | null;
  linkedIdentityReviewEntityUuid: string | null;
  quarantineReason: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ChangeProposalEvent = {
  id: number;
  entityUuid: string;
  proposalEntityUuid: string;
  eventType: string;
  actor: string;
  payload: Record<string, string | number | boolean>;
  createdAt: string;
};
