export const EXTERNAL_ACTION_KINDS = [
  "read",
  "draft",
  "send_private",
  "send_public",
  "observe",
  "prepare",
] as const;

export type ExternalActionKind = (typeof EXTERNAL_ACTION_KINDS)[number];

export const HARD_DENY_ACTION_KINDS = ["password_change", "account_delete"] as const;

export type HardDenyActionKind = (typeof HARD_DENY_ACTION_KINDS)[number];

export const EXTERNAL_RISK_CLASSES = [
  "observe",
  "prepare",
  "reversible_private",
  "public",
  "irreversible",
] as const;

export type ExternalRiskClass = (typeof EXTERNAL_RISK_CLASSES)[number];

export const EXTERNAL_ACTION_STATES = [
  "drafted",
  "policy_checked",
  "policy_denied",
  "reserved",
  "dispatching",
  "receipt_received",
  "committed",
  "partially_delivered",
  "aborted",
  "cancelled",
  "expired",
  "reconciliation_required",
  "reconciliation_expired",
  "outcome_unknown",
] as const;

export type ExternalActionState = (typeof EXTERNAL_ACTION_STATES)[number];

export const ALLOWED_EVENT_PAYLOAD_KEYS = new Set([
  "actionId",
  "adapterId",
  "destinationId",
  "hash",
  "statusCode",
  "errorCode",
  "brokerState",
  "receiptId",
  "providerAttemptId",
  "deliveredCount",
  "plannedCount",
  "credentialRef",
  "policyDecisionHash",
  "publicDisclosureResultHash",
  "terminalReason",
  "reconciliationRef",
  "classification",
]);

export type ExternalActionRecord = {
  id: number;
  entityUuid: string;
  ownerId: string;
  actionId: string;
  adapterId: string;
  destinationId: string;
  accountRef: string | null;
  actionKind: ExternalActionKind;
  riskClass: ExternalRiskClass;
  dataClassification: string;
  retentionClass: string;
  retentionExpiresAt: string | null;
  policyAuthorizationRef: string | null;
  ownerApprovalRef: string | null;
  policyDecisionHash: string | null;
  policyContractId: string | null;
  policyContractHash: string | null;
  capabilityContractHash: string | null;
  capabilityReleaseId: string | null;
  evaluatorBuildId: string | null;
  payloadRef: string | null;
  payloadHash: string | null;
  payloadClassification: string | null;
  classificationInputsHash: string | null;
  thoughtAuthorizationRefs: string[];
  publicDisclosureResultHash: string | null;
  credentialRef: string | null;
  credentialLineageRef: string | null;
  state: ExternalActionState;
  idempotencyKey: string;
  terminalReason: string | null;
  reconciliationState: string | null;
  reconciliationRef: string | null;
  reconciliationLeaseExpiresAt: string | null;
  providerReceiptIds: string[];
  providerMessageIds: string[];
  providerAttemptId: string | null;
  deliveredCount: number;
  plannedCount: number;
  reservationExpiresAt: string | null;
  dispatchLeaseId: string | null;
  dispatchLeaseExpiresAt: string | null;
  externalErasureScope: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExternalActionEvent = {
  id: number;
  entityUuid: string;
  actionEntityUuid: string;
  ownerId: string;
  eventType: string;
  actor: string;
  payload: Record<string, string | number | boolean>;
  dataClassification: string;
  createdAt: string;
};

export type ExternalEntityNoteRecord = {
  id: number;
  entityUuid: string;
  ownerId: string;
  sourceEntityUuid: string;
  sourceEntityId: string | null;
  channel: "private" | "public";
  dataClassification: string;
  retentionClass: string;
  retentionExpiresAt: string | null;
  claims: string[];
  verifiedFacts: string[];
  ashleyOpinion: string | null;
  evidenceRefs: string[];
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

export type VaultCredentialIndexRecord = {
  id: number;
  entityUuid: string;
  ownerId: string;
  credentialRef: string;
  credentialLineageRef: string;
  destinationId: string | null;
  dataClassification: string;
  retentionClass: string;
  state: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
};
