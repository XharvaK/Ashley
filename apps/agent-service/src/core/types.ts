import type { OperationalClaimLicense } from "./sandbox/engineering-types.js";
import type {
  SandboxV2InspectionEntry,
  SandboxV2SearchMatch,
  SandboxV2WorkspaceReadFileRequest,
  SandboxV2WorkspaceListDirectoryRequest,
  SandboxV2WorkspaceSearchTextRequest,
  SandboxV2WorkspaceWriteFileRequest,
  SandboxV2WorkspaceReplaceFileRequest,
  SandboxV2WorkspaceEditTextRequest,
  SandboxV2WorkspaceDeleteFileRequest,
  SandboxV2WorkspaceCreateDirectoryRequest,
} from "@composer-assistant/sandbox-v2";

export type CognitionInspectionRequest =
  | { operation: "project.read_file"; projectId: string; path: string }
  | { operation: "project.list_directory"; projectId: string; path: string }
  | {
      operation: "project.search_text";
      projectId: string;
      path?: string;
      pattern: string;
      maxMatches?: number;
    }
  | { operation: string; projectId: string; path: string };

export type CognitionWorkspaceRequest =
  | SandboxV2WorkspaceReadFileRequest
  | SandboxV2WorkspaceListDirectoryRequest
  | SandboxV2WorkspaceSearchTextRequest
  | SandboxV2WorkspaceWriteFileRequest
  | SandboxV2WorkspaceReplaceFileRequest
  | SandboxV2WorkspaceEditTextRequest
  | SandboxV2WorkspaceDeleteFileRequest
  | SandboxV2WorkspaceCreateDirectoryRequest;

export type CognitionVerificationRequest = {
  operation: "workspace.verify";
  projectId: string;
  workspaceId?: string;
  recipeId?: string;
};

export type CognitionAuthorshipRiskClass = "low" | "medium" | "high" | "consultation";

export type CognitionAuthorshipRequest = {
  operation: "changeset.author";
  projectId: string;
  workspaceId?: string;
  objective: string;
  rationale: string;
  riskClass: CognitionAuthorshipRiskClass;
  targetArea?: string;
  expectedEffect?: string;
  evidenceRefs?: string[];
  verificationRecipeIds?: string[];
  intendedPaths?: string[];
};

export type CognitionBoundedOperationOrigin = "owner_request" | "ashley_private_interest";

export type CognitionBoundedOperationStep =
  | { kind: "candidate_workspace_experiment"; request: CognitionWorkspaceRequest }
  | { kind: "candidate_verification"; request: CognitionVerificationRequest }
  | { kind: "candidate_authorship"; request: CognitionAuthorshipRequest };

export type CognitionBoundedOperationRequest = {
  operation: "objective.operate";
  projectId: string;
  workspaceId?: string;
  origin: CognitionBoundedOperationOrigin;
  objective: string;
  successCondition: string;
  failureCondition: string;
  steps: CognitionBoundedOperationStep[];
  budget: {
    maxSteps: number;
    deadlineAtMs: number;
  };
};

export type CognitionPatchExportRequest = {
  operation: "patch_export";
  projectId: string;
  changesetId: string;
};

export type CognitionOperationalRequest =
  | { kind: "project_inspection"; request: CognitionInspectionRequest }
  | { kind: "candidate_workspace_experiment"; request: CognitionWorkspaceRequest }
  | { kind: "candidate_verification"; request: CognitionVerificationRequest }
  | { kind: "candidate_authorship"; request: CognitionAuthorshipRequest }
  | { kind: "bounded_operation"; request: CognitionBoundedOperationRequest }
  | { kind: "patch_export"; request: CognitionPatchExportRequest };

export type ProjectReadFileObservation = {
  projectId: string;
  operation: "project.read_file";
  path: string;
  verified: boolean;
  truncated: false;
  executedAtMs: number;
  contentUtf8: string;
  bytes: number;
  sha256: string;
};

export type ProjectListDirectoryObservation = {
  projectId: string;
  operation: "project.list_directory";
  path: string;
  verified: boolean;
  truncated: boolean;
  executedAtMs: number;
  entries: SandboxV2InspectionEntry[];
};

export type ProjectSearchTextObservation = {
  projectId: string;
  operation: "project.search_text";
  path: string;
  pattern: string;
  verified: boolean;
  truncated: boolean;
  executedAtMs: number;
  matches: SandboxV2SearchMatch[];
  filesScanned: number;
};

export type ProjectInspectionObservation =
  | ProjectReadFileObservation
  | ProjectListDirectoryObservation
  | ProjectSearchTextObservation;

export type WorkspaceExperimentObservation = {
  kind: "workspace_experiment_observation";
  projectId: string;
  workspaceId: string;
  operation: string;
  verified: boolean;
  executedAtMs: number;
  logicalRelativePath?: string;
  contentUtf8?: string;
  entries?: SandboxV2InspectionEntry[];
  matches?: SandboxV2SearchMatch[];
  filesScanned?: number;
  bytesWritten?: number;
  bytesRead?: number;
  beforeSha256?: string;
  afterSha256?: string;
  contentHash?: string;
  deleted?: boolean;
  verifiedAbsent?: boolean;
  sourceSnapshotId?: string;
  error?: string | null;
};

export type DecisionKind =
  | "speak"
  | "silence"
  | "delay"
  | "ask"
  | "revisit"
  | "share"
  | "challenge"
  | "refuse";

export type DecisionDelayClass =
  | "brief"
  | "standard"
  | "long"
  | "reflection_review";

export type MotivationKind =
  | "user_message"
  | "question"
  | "fact"
  | "callback"
  | "opinion"
  | "take"
  | "unfinished"
  | "identity"
  | "availability"
  | "boundary"
  | "silence_signal"
  | "silence_ok"
  | "reminder"
  | "scheduled_proactive"
  | "learned_interest";

export type SilenceReasonCode =
  | "user_requested_space"
  | "withdrawal_turn"
  | "withdrawal_topic"
  | "withdrawal_initiative"
  | "withdrawal_pause"
  | "withdrawal_boundary_repair"
  | "constitutional_refusal"
  | "thought_hold"
  | "coercion_blocked";

export type HoldReasonCode =
  | "proactive_paused"
  | "daily_cap"
  | "relationship_observe"
  | "repair_backoff"
  | "delivery_in_progress"
  | "own_time";

export type Trigger = "reactive" | "proactive";

/**
 * Structured Thought evidence-disposition state. The four states are mutually
 * exclusive and structurally validated against the authoritative capability
 * state at deliberation time:
 * - sufficient: the supplied context already holds everything needed to decide;
 * - acquire_project_evidence: this turn requires repository evidence that an
 *   available inspection can provide now — REQUIRES a typed inspectionRequest;
 * - capability_unavailable: inspection is genuinely unavailable this turn and
 *   only valid when the authoritative capability state says so;
 * - defer: intentional postponement of the motivation to a later turn; never a
 *   stand-in for "I need evidence now" when acquisition is available.
 */
export type EvidenceDisposition =
  | "sufficient"
  | "acquire_project_evidence"
  | "capability_unavailable"
  | "defer";

export type ReflectionMode = "observe" | "apply";
export type CognitionMode = "observe" | "apply";

/**
 * Write-time behavioral authority label on evidence artifacts.
 * `live` = written while the governing capability held influence authority;
 * `shadow` = recorded in observe without authority. Shadow artifacts are never
 * eligible for influence, even after the master mode later flips to apply
 * (time-shift isolation).
 */
export type EvidenceProvenance = "shadow" | "live";

export type EvidenceRef = {
  type:
    | "message"
    | "episode"
    | "fact"
    | "question"
    | "opinion"
    | "take"
    | "identity"
    | "mind_state"
    | "doc_reminder"
    | "ashley_self_commitment"
    | "mutual_commitment"
    | "scheduled_proactive"
    | "relational_tension"
    | "withdrawal"
    | "open_cognitive_item";
  id: string | number;
};

export type AffectLicense = {
  permitted: boolean;
  valence: number;
  activation: number;
  openness: number;
  tension: number;
  reason: string;
  source?: EvidenceRef;
};

/**
 * Classification for Reflection and initiative-learning write paths.
 * These labels describe authority; they do not grant semantic authorship.
 */
export type ReflectionWriteClassification =
  | "MECHANICAL_CALIBRATION"
  | "NON_AUTHORITATIVE_ADVISORY_OUTPUT"
  | "THOUGHT_AUTHORED_SEMANTIC_STATE"
  | "DISALLOWED_UNDER_FROZEN_AUTHORITY";

/** Content that may be carried as provenance, but is not Ashley-authored meaning. */
export type NonAuthoritativeContentClass =
  | "NON_AUTHORITATIVE_BOOKKEEPING"
  | "NON_AUTHORITATIVE_DERIVED_CONTENT";

export type LearningSnapshot = {
  subjectKind: MotivationKind;
  adjustment: number;
  throughEventId: number;
  authorityClass?: "MECHANICAL_CALIBRATION";
};

/** v1 payload: transient decisions already implied by Decision.kind. Not the definition of Thought. */
export type CognitiveAllocation = {
  shouldSpeak: boolean;
  effort: "low" | "medium" | "high";
  completion: "complete" | "hold";
};

/** Exact licensed reading claim material for Expression (untrusted data). */
export type AuthorizedReadingClaim = {
  takeId: number;
  readRecordId: number;
  title: string;
  /** Exact stored take text; do not summarize before Expression. */
  claim: string;
};

export type PerceptionLicenses = {
  imageIncluded: string[];
  textExcerptIncluded: string[];
  conversationalReadIncluded: string[];
};

/** Refs Conversation previously reconstructed from kind + feed takes. */
export type AuthorizedClaims = {
  readingRecordIds: number[];
  readingTitles: string[];
  readingClaims: AuthorizedReadingClaim[];
};

export type OwnTimeReportStatus =
  | "no_session"
  | "no_activity"
  | "no_reportable_take"
  | "reportable_takes";

export type OwnTimeReportReason =
  | "no_session"
  | "no_owner_reading_activity"
  | "no_grounded_take"
  | "already_reported"
  | "reportable_takes";

/** Transient Agency marker for gated own-time return reports. */
export type OwnTimeReportMarker = {
  status: OwnTimeReportStatus;
  reason: OwnTimeReportReason;
  sessionId: number | null;
  selectedTakeIds: number[];
};

/**
 * Bounded Thought output-validation error taxonomy (replaces the coarse
 * `invalid_response`). Structural codes are retryable exactly once; provider
 * failure codes (rate_limited, mistral_unavailable, AbortError, ...) are never
 * retried. Every code is deterministic and derives from the canonical
 * operational-request contract shared by prompt, parser, and validator.
 */
export type ThoughtValidationErrorCode =
  | "invalid_json"
  | "truncation"
  | "unsupported_operation"
  | "unauthorized_task_continuation"
  | "missing_required_field"
  | "multiple_operational_intents"
  | "invalid_evidence_disposition_pairing"
  | "invalid_project"
  | "payload_invalid"
  | "contradictory_decision_fields"
  | "capability_unavailable";

/**
 * Cognitive phase identity for bounded Thought telemetry. `initial` is Pass 1
 * (decision/origination); `continuation` is Pass 2 (post-operation
 * interpretation). Optional for backward compatibility: historical Migration 28
 * rows predate the field and remain readable without it.
 */
export type ThoughtValidationPhase = "initial" | "continuation";

/**
 * Bounded forensic telemetry for one rejected Thought attempt. Never contains
 * raw model text: only a sha256 digest and bounded structural metadata.
 * At most two attempts per phase (initial + at most one structural
 * regeneration; continuation + at most one structural regeneration).
 */
export type ThoughtValidationAttempt = {
  /** Cognitive phase that produced this attempt (absent on pre-phase rows). */
  phase?: ThoughtValidationPhase;
  /** 1-based attempt number within this phase (max 2 with regeneration). */
  attempt: number;
  providerOutcome: "completed" | "error";
  outputTokens: number | null;
  maxTokens: number | null;
  truncated: boolean;
  parseOk: boolean;
  validationOk: boolean;
  errorCode: ThoughtValidationErrorCode | null;
  /** Bounded field/path reference when available (e.g. "request.path"). */
  field: string | null;
  /** Parsed operational kind if safely parsed (project_inspection / candidate_workspace_experiment). */
  opKind: string | null;
  bytes: number;
  sha256: string;
  promptTokens?: number | null;
  reasoningTokens?: number | null;
  finishReason?: string | null;
  decisionKind?: string | null;
  completion?: string | null;
  shouldSpeak?: boolean | null;
  shouldSpeakOmitted?: boolean | null;
  evidenceDisposition?: string | null;
};

export type ReactiveOperationalAdmissionClass =
  | "current_owner_request"
  | "explicit_resumption";

export type ReactiveOperationalRequestIdentity = {
  kind: CognitionOperationalRequest["kind"];
  operation?: string;
  projectId?: string;
  targetPath?: string | null;
  workspaceId?: string | null;
};

/**
 * Host-authored reactive execution license. Model output cannot create this
 * object; Thought validation and runtime consult the same evaluator.
 */
export type ReactiveOperationalAdmission = {
  admitted: true;
  admissionClass: ReactiveOperationalAdmissionClass;
  claimedBasisMotivationId: number | null;
  validatedBasisMotivationId: number;
  basisKind: MotivationKind;
  operationalKind: CognitionOperationalRequest["kind"];
  requestIdentity: ReactiveOperationalRequestIdentity;
  currentMessageEntityUuid: string | null;
};

/**
 * Bounded forensic envelope for one or both cognitive phases. When both phases
 * produced telemetry, attempts are concatenated phase-first (initial, then
 * continuation) and `finalErrorCode` reflects the terminal phase outcome.
 * Raw model text and raw project evidence are never persisted.
 */
export type ThoughtValidationEnvelope = {
  attempts: ThoughtValidationAttempt[];
  finalErrorCode: ThoughtValidationErrorCode | null;
  /** System-authored admission evidence. Never model-emitted authority. */
  reactiveOperationalAdmission?: ReactiveOperationalAdmission | null;
};

export type MindStateDispositionType =
  | "preserve"
  | "resolve"
  | "cancel"
  | "consume_callback";

export type MindStateDisposition = {
  itemId: number;
  disposition: MindStateDispositionType;
  reason?: string;
};

export type Decision = {
  id?: number;
  trigger: Trigger;
  kind: DecisionKind;
  /** Host-mapped semantic delay. Never an arbitrary model timestamp. */
  delayClass?: DecisionDelayClass;
  motivationIds: number[];
  score: number;
  reason: string;
  objective?: string;
  evidenceRefs: EvidenceRef[];
  uncertainty: number;
  urgency: number;
  thoughtSource: "deterministic" | "model" | "fallback";
  thoughtError: string | null;
  /** Bounded forensic envelope for rejected Thought validation attempts. */
  thoughtValidation?: ThoughtValidationEnvelope | null;
  affectLicense: AffectLicense;
  learning?: LearningSnapshot;
  cognitiveAllocation: CognitiveAllocation;
  authorizedClaims: AuthorizedClaims;
  perceptionLicenses?: PerceptionLicenses;
  ownTimeReport?: OwnTimeReportMarker;
  operationalLicense?: OperationalClaimLicense;
  evidenceDisposition?: EvidenceDisposition | null;
  operationalRequest?: CognitionOperationalRequest | null;
  operationalObservation?: ProjectInspectionObservation | WorkspaceExperimentObservation | null;
  operationalCognitiveResult?: string | null;
  /** Model-claimed basis ID. Provenance only; never execution authority. */
  operationalBasisMotivationId?: number | null;
  /** Trusted host admission. Never copied from model output. */
  reactiveOperationalAdmission?: ReactiveOperationalAdmission | null;
  inspectionRequest?: CognitionInspectionRequest | null;
  inspectionObservation?: ProjectInspectionObservation | null;
  inspectionCognitiveResult?: string | null;
  workspaceObservation?: WorkspaceExperimentObservation | null;
  holdReasonCode?: HoldReasonCode | null;
  silenceReasonCode?: SilenceReasonCode | null;
};

/**
 * Agency effect-purpose: the durable classification of why an effect is
 * intended, bounded to a fixed vocabulary. A purpose is only ever asserted
 * after it has been deterministically verified against a current, live,
 * owner-bound open cognitive item (OCI) recorded as decision evidence.
 * Zero-authority: purpose derivation alone never admits, schedules, or
 * executes anything.
 */
export type AgencyEffectPurpose =
  | "sandbox_verify_build_health"
  | "sandbox_test_quality"
  | "sandbox_lint_verification"
  | "sandbox_codebase_patch_verification"
  | "unsupported";

/**
 * Agency effect-intent: the deterministic, evidence-grounded expression of
 * what Ashley internally intends to do, derived only from the verified
 * purposes of an Agency decision's open-cognitive-item evidence. This is a
 * pure derivation output — it carries no execution authority. Broker
 * readiness, runtime state, sandbox state, and capability gates are all
 * checked separately (observe-only integration: nothing is admitted,
 * scheduled, or executed from an intent alone).
 */
export type AgencyEffectIntent = {
  purposes: AgencyEffectPurpose[];
  groundedRefs: EvidenceRef[];
  intentId: string;
  deterministic: true;
};

export type Motivation = {
  id?: number;
  ownerId?: string;
  kind: MotivationKind;
  score: number;
  baseScore?: number;
  learningAdjustment?: number;
  learningThroughEventId?: number;
  learningAuthorityClass?: "MECHANICAL_CALIBRATION";
  refType?: string | null;
  refId?: string | number | null;
  summary: string;
  createdAt?: string;
  sourceAuthorityClass?: NonAuthoritativeContentClass;
  memoryContextRole?:
    | "current_source_evidence"
    | "historical_source_evidence"
    | "corrected_source_evidence";
  memoryAssertionIds?: number[];
  memoryCorrectionIds?: number[];
};

export type IdentityLayer = "stable" | "dynamic";

export type QuestionStatus = "open" | "pursuing" | "resolved" | "forgotten";

export type EpistemicLevel =
  | "known"
  | "remembered"
  | "inferred"
  | "unknown";

export type QuestionSubject = "about_doc" | "about_self" | "about_world";

export type IdentitySource = "seeded" | "organic" | "manual";

export type IdentityEntry = {
  id: number;
  ownerId: string;
  layer: IdentityLayer;
  kind: string;
  text: string;
  source: IdentitySource;
  revisedFrom: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Opinion = {
  id: number;
  ownerId: string;
  topic: string;
  stance: string;
  confidence: number;
  revisedFrom: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Question = {
  id: number;
  ownerId: string;
  subject: QuestionSubject;
  text: string;
  status: QuestionStatus;
  priority: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type MindState = {
  ownerId: string;
  focus: string | null;
  mood: string | null;
  unfinished: string[];
  unfinishedJson: string;
  availability: string;
  lastDecisionId: number | null;
  updatedAt: string;
};

export type MindStateItemKind =
  | "goal"
  | "concern"
  | "commitment"
  | "interest"
  | "unfinished";

export type MindStateItem = {
  id: number;
  ownerId: string;
  kind: MindStateItemKind;
  text: string;
  sourceType: string;
  sourceId: string;
  activation: number;
  urgency: number;
  status: "active" | "resolved" | "forgotten";
  dueAt: string | null;
  wakeState: "pending" | "claimed" | "consumed";
  wakeAttempts: number;
  nextWakeAt: string | null;
  claimedAt: string | null;
  surfacedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AffectiveState = {
  ownerId: string;
  valence: number;
  activation: number;
  openness: number;
  tension: number;
  reason: string;
  sourceType: string | null;
  sourceId: string | null;
  updatedAt: string;
};

/** @deprecated Use MindState — same type, retained name for gradual call-site clarity. */
export type InternalState = MindState;
