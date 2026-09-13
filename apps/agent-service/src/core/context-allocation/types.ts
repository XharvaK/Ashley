import type { ChatMessage, RouteId } from "../model-routing/types.js";
import type { DataClassification } from "../privacy/classification.js";
import type { EvidenceProvenance, EvidenceRef } from "../types.js";
import type { ContextProjection } from "../model-fabric/projection.js";

export type { ContextProjection } from "../model-fabric/projection.js";

export type ContextPurpose = "thought" | "expression" | "expression_fallback" | string;
export type ContextSurface = "private" | "public";
export type ContextBudgetMode = "observe" | "dark_apply" | "apply";
export type ContextRouteClass =
  | "remote_companion"
  | "local"
  | "public_surface"
  | "unknown";

/** Section names are intentionally open: policy owns reservations, not meaning. */
export type ContextSection = string;

export type ContextInputCandidate = {
  ref?: EvidenceRef;
  sourceType?: string;
  sourceId?: string | number;
  section: ContextSection;
  content: string;
  messageRole?: "system" | "user" | "assistant";
  classification?: DataClassification | null;
  influenceClass?: "I0" | "I1" | "I2" | "I3" | "I4" | null;
  provenance?: EvidenceProvenance | null;
  memoryContextRole?:
    | "current_source_evidence"
    | "historical_source_evidence"
    | "corrected_source_evidence";
  assertionId?: number | null;
  entityUuid?: string | null;
  correctionIds?: number[];
  barrierCovered?: boolean;
  influenceEligible?: boolean;
  retrievalEligible?: boolean;
  required?: boolean;
  priority?: number;
  authorized?: boolean;
  egressApprovalRef?: string | null;
  ownerId?: string;
  observedAt?: string | null;
};

export type ContextRequest = {
  requestId?: string;
  ownerId: string;
  purpose: ContextPurpose;
  routeId?: RouteId | string;
  surface: ContextSurface;
  audience?: string;
  inputs?: ContextInputCandidate[];
  maxUtf8Bytes?: number;
  totalUtf8Bytes?: number;
  policyId?: string;
  policyVersion?: number;
  sectionBudgets?: Record<string, number>;
  tokenEstimateDivisor?: number;
  requiredSections?: ContextSection[];
  capabilityMode?: ContextBudgetMode;
  mode?: ContextBudgetMode;
  routeClassHint?: string;
  egressApprovalRef?: string | null;
  snapshotId?: string | null;
  currentMessage?: string;
  contextPolicyId?: string;
};

export type ContextRouteBinding = {
  routeId: RouteId;
  routeClass: ContextRouteClass;
  provider: string;
  adapterClass: string;
  profileId: string;
  profileVersion: number;
  profileFingerprint: string;
  routePolicySnapshotId: string;
};

export type EligibleInputRef = {
  ref: EvidenceRef;
  sourceType: string;
  sourceId: string | number;
  section: ContextSection;
  content: string;
  classification: DataClassification;
  influenceClass: ContextInputCandidate["influenceClass"];
  provenance: EvidenceProvenance | null;
  memoryContextRole: ContextInputCandidate["memoryContextRole"] | null;
  assertionId: number | null;
  correctionIds: number[];
  barrierCovered: boolean;
  influenceEligible: boolean;
  retrievalEligible: boolean;
  required: boolean;
  priority: number;
  authorized: boolean;
  observedAt: string | null;
  routeClass: ContextRouteClass;
  entityUuid?: string | null;
  messageRole: "system" | "user" | "assistant";
  omitReason?: string;
};

export type ContextBudgetPolicy = {
  policyId: string;
  version: number;
  totalUtf8Bytes: number;
  sectionBudgets: Record<string, number>;
  tokenEstimateDivisor: number;
  createdAt?: string;
};

export type ContextBudgetPlan = {
  requestId: string;
  policyId: string;
  policyVersion: number;
  totalUtf8Bytes: number;
  sectionBudgets: Record<string, number>;
  tokenEstimateDivisor: number;
  maxEstimatedTokens: number;
  requiredSections: ContextSection[];
  route: ContextRouteBinding;
  snapshotId: string;
};

export type ContextSelectionDecision = {
  included: EligibleInputRef[];
  omitted: Array<{
    ref: EvidenceRef;
    section: ContextSection;
    omitReason: string;
    bytes: number;
  }>;
  truncated: Array<{
    ref: EvidenceRef;
    section: ContextSection;
    truncationReason: string;
  }>;
  compressed: Array<{
    summaryId: string;
    sourceRefs: EvidenceRef[];
    section: ContextSection;
  }>;
  degradation: string[];
  includedUtf8Bytes: number;
  estimatedTokens: number;
};

export type ContextAllocationReceipt = {
  receiptId: string;
  requestId: string;
  ownerId: string;
  purpose: string;
  route: ContextRouteBinding;
  policyId: string;
  policyVersion: number;
  projectionId: string;
  contentBinding: string;
  included: unknown[];
  omitted: unknown[];
  truncated: unknown[];
  compressed: unknown[];
  degradation: string[];
  sameSnapshotId: string | null;
  capabilityMode: ContextBudgetMode;
  createdAt: string;
};

export type ContextAllocation = {
  messages: ChatMessage[];
  projection: ContextProjection;
  receipt: ContextAllocationReceipt;
  selection: ContextSelectionDecision;
  plan: ContextBudgetPlan;
};

export type ProjectionInspection = ContextAllocationReceipt & {
  included: unknown[];
  omitted: unknown[];
  truncated: unknown[];
  compressed: unknown[];
  degradation: string[];
};
