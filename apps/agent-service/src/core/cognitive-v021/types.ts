import type { DatabaseSync } from "node:sqlite";
import type { StructuredOutputRequest } from "../model-fabric/types.js";
import type { ChatMessage, CompletionOptions, ProviderId } from "../model-routing/types.js";
import type {
  CognitiveDispatchOptions,
  completeChat,
} from "../../mistral-client.js";
import type { DataClassification } from "../privacy/classification.js";
import type { SandboxV2CapabilitySpec } from "@composer-assistant/sandbox-v2";
import type { ThoughtSourceCurrentness } from "./thought/source-currentness.js";
import type {
  CommitmentProposal,
  CommitmentRealizationBinding,
  AvailableSocialDestination,
  SocialAudience,
} from "./social/types.js";

export type { DataClassification } from "../privacy/classification.js";

export const ARCHITECTURE_EPOCH = "v0.2.1" as const;
export const IMPLEMENTATION_SPEC_VERSION = "0.2.1.r6" as const;
export const THOUGHT_CONTRACT_VERSION = 2 as const;
export const COGNITIVE_SIDECAR_SCHEMA_VERSION = 19 as const;
export const CAPACITY_WAIT_MAX_DURATION_MS = 120_000 as const;
export const MECHANICAL_SPIN_GUARD_LIMIT = 12 as const;

export type DeferredFrontierState = "waiting" | "running" | "resolved" | "exhausted";

export type DeferredReactiveFrontierRecord = {
  frontierId: string;
  conversationId: string;
  cycleId: string;
  generation: number;
  state: DeferredFrontierState;
  nextEligibleAtMs: number;
  capacityDeadlineAtMs: number;
  latestEvidenceRowId: string;
  claimToken: string | null;
  leaseExpiresAtMs: number | null;
  attemptCount: number;
  createdAtMs: number;
  updatedAtMs: number;
  terminalReason?: string | null;
};
export const SETTLEMENT_SCHEMA_VERSION = 2 as const;
export const OUTBOX_BRIDGE_VERSION = 1 as const;
export const LEGACY_IMPORT_TOOL_VERSION = 1 as const;
export const MAX_AUTHORITY_REVISIONS = 2 as const;
export const MAX_THOUGHT_PASSES = 6 as const;
export const MAX_THOUGHT_MODEL_ATTEMPTS = 12 as const;
export const PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR = 4 as const;
export const PRIVATE_THOUGHT_MAX_CONCURRENT = 1 as const;
export const PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE = 4 as const;
export const MAX_OBSERVATION_ROUNDS = 4 as const;
export const MAX_EFFECT_ROUNDS = 4 as const;
export const DEFAULT_LAST_N_TURNS = 12 as const;
export const DEFAULT_OCCUPANCY_COMPACT_K = 12 as const;
export const DEFAULT_IDLE_TICK_MS = 60_000 as const;
export const DEFAULT_MAX_SUBSCRIPTIONS = 16 as const;
export const DEFAULT_MISS_ROUND_CAP = 1 as const;
export const DEFAULT_TOOL_CYCLE_LEASE_MS = 120_000 as const;
export const ORDINARY_THOUGHT_BUDGET_MS = 300_000 as const;
export const THOUGHT_UNAVAILABLE_NOTICE =
  "[system] Thought did not complete. Please send the message again." as const;

export type KernelMode = "v021";
export type CycleId = string;
export type ConversationId = string;
export type Generation = number;
export type AuthorityEpoch = number;
export type OccupantId = string;
export type IdempotencyKey = string;
export type ReservationId = number;
export type OutboxId = number;
export type NoticeId = number;
export type DeliveryProjectionKey = string;
export type ConcernId = string;
export type AssertionKey = string;
export type finalLicensedText = string | null;

export type ExistingRef = string & { readonly __kind: "allowlisted-existing-ref" };
export type LocalAlias = string & { readonly __kind: "output-local-alias" };
export type SemanticRef =
  | { kind: "existing"; ref: ExistingRef }
  | { kind: "local"; alias: LocalAlias };
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type ThoughtInvocationContext = {
  invocationId: string;
  allocationId: number;
  cycleId: CycleId;
  generation: Generation;
  semanticPass: number;
  structuralAttemptOrdinal: number;
  authorityEpoch: AuthorityEpoch;
  authorityVersionVector: Readonly<Record<string, string | number>>;
  /** W4 by-value barrier/currentness binding captured before provider dispatch. */
  authorityCurrentness?: AuthorityCurrentnessBinding;
  triggerRef: string;
  semanticProjectionHash: string;
  dispatchMessagesHash: string;
  allowlistFingerprint: string;
  absoluteDeadlineAtMs: number;
};

export type CapturedModelAttemptIdentity = {
  allocationId: number;
  modelFabricInvocationId: string;
  modelFabricAttemptId: string;
  attemptOrdinal: number;
  dispatchSequence: number;
  routeAlias: string | null;
  provider: ProviderId;
  configuredModelId: string;
  occupantId: string;
  modelEpoch: number;
  contractId: string;
  buildIdentity: string;
  logicalStructuredOutputId: string;
  semanticSchemaFingerprint: string;
  wireSchemaFingerprint: string;
  actualWireBindingId: string;
  schemaEnforcementMode: string;
  resourcePolicyFingerprint: string;
};

export type KernelEnvelope = ThoughtInvocationContext & {
  protocolIdentity: string;
  kernelEnvelopeVersion: "ashley.thought.kernel-envelope.v1";
  parserValidatorIdentity: string;
  runtimeArtifactIdentity: string;
  capturedAttempt: CapturedModelAttemptIdentity;
  responseHash: string;
};

export type KernelBoundThoughtOutput = {
  envelope: KernelEnvelope;
  semantic: ThoughtSemanticOutput;
  structuralValidity: "valid";
};

export type ThoughtRuntimeOutcome =
  | "provider_unavailable"
  | "timeout"
  | "malformed_json"
  | "schema_violation"
  | "deadline_exhausted"
  | "cancelled_invocation"
  | "stale_response"
  | "revision_budget_exhausted"
  | "pass_budget_exhausted"
  | "outcome_unknown";

export type WakeState =
  | "pending" | "claimed" | "authorized" | "consequence_pending"
  | "reconciling" | "terminal";
export type WakeTerminalReason =
  | "completed" | "no_action" | "refused" | "cancelled" | "expired" | "quarantined" | "superseded";
export type WakeRecord = Readonly<{
  wakeId: string;
  occurrenceId: string;
  triggerRef: string;
  sourceKind: "inbox" | "future_trigger" | "idle" | "subscription";
  conversationId: string;
  cycleId: string;
  state: WakeState;
  terminalReason: WakeTerminalReason | null;
  capturedTriggerGeneration: number | null;
  capturedAuthorityRevision: number;
  consequenceChainId: string | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAtMs: number | null;
  cancellationId: string | null;
}>;
export type PrivateBudgetReservationState = "held" | "committed" | "released" | "reconcile_required" | "expired";
export type PrivateBudgetPolicy = Readonly<{
  policyId: string;
  limit: 4;
  windowMs: 3_600_000;
  clockDiscontinuityMs: 300_000;
}>;
export type PrivateBudgetReservation = Readonly<{
  reservationId: string;
  admissionId: string;
  wakeId: string;
  conversationId: string;
  policyId: string;
  state: PrivateBudgetReservationState;
  policyTimeMs: number;
  invocationId: string | null;
  attemptId: string | null;
  dispatchTruth: "not_bound" | "not_started" | "attempted" | "responded" | "unknown";
  releaseProofRef: string | null;
}>;
export type PrivateBudgetAdmission =
  | { kind: "reserved" | "existing"; reservation: PrivateBudgetReservation; remaining: number }
  | { kind: "refused"; reason: "capacity_exhausted" | "clock_reconciliation"; remaining: 0 };

export type CycleTriggerKind =
  | "owner_message"
  | "external_message"
  | "idle_opportunity"
  | "commitment_due"
  | "subscription_item"
  | "future_trigger_due"
  | "observation_or_receipt"
  | "recovery";

export type CycleState =
  | "admitted"
  | "assembling"
  | "thinking"
  | "awaiting_operation"
  | "authority_check"
  | "publishing"
  | "sending"
  | "capacity_wait"
  | "silent"
  | "idle";

export type CycleRecord = {
  cycleId: CycleId;
  conversationId: ConversationId;
  generation: Generation;
  wakeId: string;
  triggerKind: CycleTriggerKind;
  triggerRef: string;
  state: CycleState;
  occupantId: OccupantId;
  authorityEpoch: AuthorityEpoch;
  architectureEpoch: typeof ARCHITECTURE_EPOCH;
  admittedAtMs: number;
  composeLogIds: string[];
  preemptedGeneration: Generation | null;
};

export type SettlementSchemaVersion = typeof SETTLEMENT_SCHEMA_VERSION;
export type DiscourseAct =
  | "inform"
  | "ask"
  | "correct"
  | "acknowledge"
  | "disagree"
  | "hold"
  | "silence"
  | "other";

export type ReferentBinding = {
  span: string;
  concernId?: ConcernId;
  entityKey?: string;
  sourceTurnIds: string[];
};

export type CorrectionRecord = {
  correctedTurnIds: string[];
  fromSpan: string;
  toSpan: string;
  concernId?: ConcernId;
};

export type EpistemicSource =
  | "owner_utterance"
  | "ashley_interpretation"
  | "tool"
  | "perception"
  | "receipt"
  | "prior_settlement";
export type EpistemicStatus =
  | "asserted"
  | "interpreted"
  | "unverified"
  | "contradicted"
  | "superseded"
  | "unresolved";
export type EpistemicTime = "current" | "historical" | "unknown_freshness";
export type EpistemicReliability =
  | "owner_supplied"
  | "fallible_observation"
  | "receipt_backed"
  | "inferred"
  | "unavailable_source";

export type EpistemicDimensions = {
  source: EpistemicSource;
  status: EpistemicStatus;
  time: EpistemicTime;
  reliability: EpistemicReliability;
};

export type EpistemicCommitment = {
  dimensions: EpistemicDimensions;
  statement: string;
  /** Exact literal portion of Thought's surfaceDraft that realizes this
   * commitment for final-surface fidelity binding. */
  surfaceSpan?: string;
  /** Thought-authored governed observations warranting this claim. */
  observationRefs?: readonly ExistingRef[];
};

export type ConversationalCommitment =
  | "answer"
  | "ask"
  | "acknowledge"
  | "disagree"
  | "hold"
  | "silence";

export type Stance = {
  warmth: "low" | "medium" | "high";
  humorAllowed: boolean;
  disagreement: boolean;
  uncertaintyDisplay: boolean;
};

export type SpeechMode = "none" | "draft";

export type ThoughtSpeechDraft = {
  mode: SpeechMode;
  /** Omitted when Thought authors no literal inclusion constraint. */
  mustSay?: string[];
  /** Omitted when Thought authors no forbidden literal constraint. */
  mustNot?: string[];
  surfaceDraft: string | null;
  /** Historical V1 payload compatibility only; VNext authoring never emits it. */
  acceptableRealizations?: string[];
  /** Omitted when Thought authors no presentation guidance. */
  presentationDirectives?: string[];
};

export type WorkingContextItemType =
  | "topic"
  | "referent"
  | "correction"
  | "owner_teaching"
  | "question"
  | "commitment_temp"
  | "repair";

export type WorkingContextItem = {
  id: string;
  conversationId: ConversationId;
  type: WorkingContextItemType;
  text: string;
  concernId: ConcernId | null;
  sourceTurnIds: string[];
  status: "active" | "superseded" | "abandoned";
  supersedesId: string | null;
  updatedGeneration: Generation;
  /** Audience/protection facets are optional for legacy Owner rows. */
  audienceScope?: SocialAudience | null;
  sourcePrincipal?: string | null;
  sourceEvidenceRef?: string | null;
  protectionSubjects?: string[] | null;
  protectionBasisRefs?: string[];
  protectionStatus?: "admitted" | "unresolved" | null;
  licenseRefs?: string[];
};

export type WorkingContextDelta =
  | {
      op: "upsert";
      item: Omit<WorkingContextItem, "updatedGeneration">;
    }
  | {
      op: "supersede";
      id: string;
      replacement: Omit<WorkingContextItem, "updatedGeneration">;
    }
  | { op: "abandon"; id: string };

export type DeskAuthorKind = "ashley" | "owner" | "quoted_external";
export type DeskForm = "note" | "draft" | "observation" | "brainstorm";
export type DeskLifecycle = "active" | "archived" | "tombstoned";

/** Owner-private, durable desk content. Meaning remains Thought-authored. */
export type DeskEntry = {
  id: string;
  concernRef: ConcernId | null;
  body: string;
  authorKind: DeskAuthorKind;
  sourceRefs: string[];
  verbatim: boolean;
  form: DeskForm;
  endorsementRef: string | null;
  audienceScope: SocialAudience;
  lifecycle: DeskLifecycle;
  supersededBy: string | null;
  updatedCycle: CycleId;
  updatedGeneration: Generation;
  createdAtMs: number;
  updatedAtMs: number;
};

export type DeskEntryDraft = Omit<
  DeskEntry,
  "lifecycle" | "supersededBy" | "updatedCycle" | "updatedGeneration" | "createdAtMs" | "updatedAtMs"
>;

export type DeskDelta =
  | { op: "upsert"; entry: DeskEntryDraft }
  | { op: "supersede"; id: string; replacement: DeskEntryDraft }
  | { op: "archive"; id: string }
  | { op: "tombstone"; id: string };

export type ConcernRecord = {
  concernId: ConcernId;
  conversationId: ConversationId;
  statement: string;
  sourceTurnIds: string[];
  dimensions: EpistemicDimensions;
  assertionKey: AssertionKey | null;
  status: OccupancyStatus;
  snapshotHash: string;
  audienceScope?: SocialAudience | null;
  protectionStatus?: "admitted" | "unresolved" | null;
};

export type OccupancyStatus =
  | "active"
  | "investigating"
  | "waiting_for_evidence"
  | "dormant_but_revisitable"
  | "resolved"
  | "quarantined";

export type MindOccupancy = {
  conversationId: ConversationId;
  concernId: ConcernId;
  status: OccupancyStatus;
  priority: number;
  updatedCycle: CycleId;
  updatedGeneration: Generation;
  audienceScope?: SocialAudience | null;
  protectionStatus?: "admitted" | "unresolved" | null;
};

/** Existing occupancy row plus the optional persisted statement carried into Thought assembly. */
export type ThoughtOccupancy = MindOccupancy & {
  statement?: string;
  provenance?: "cognitive_sidecar.concerns";
};

/** Minimal model-visible concern representation for an eligible occupied concern. */
export type OccupiedConcernProjection = Readonly<{
  concernId: ConcernId;
  statement: string;
  status: Extract<OccupancyStatus, "active" | "investigating" | "waiting_for_evidence">;
  priority: number;
  /** Existing epistemic context needed for a later Thought inquiry review. */
  dimensions: Readonly<Pick<EpistemicDimensions, "status" | "reliability">>;
  provenance: "cognitive_sidecar.concerns";
}>;

export type ConcernDelta =
  | { op: "upsert"; record: Omit<ConcernRecord, "snapshotHash"> }
  | { op: "resolve"; concernId: ConcernId };
export type OccupancyDelta = {
  op: "set";
  occupancy: Omit<MindOccupancy, "updatedCycle">;
};

export type FutureTrigger = {
  triggerId: string;
  conversationId: ConversationId;
  concernId: ConcernId;
  snapshotHash: string;
  dueAtMs: number;
  status: "scheduled" | "fired" | "cancelled" | "suppressed_stale";
  wakeId?: string | null;
  payload?: Record<string, unknown>;
};
export type FutureTriggerDelta =
  | { op: "create"; trigger: Omit<FutureTrigger, "status"> }
  | { op: "cancel"; triggerId: string };

export type ExternalSubscriptionSourceKind = "url" | "url_pattern" | "rss" | "atom" | "json";
export type ExternalSubscriptionSource = {
  kind: ExternalSubscriptionSourceKind;
  urlPattern: string;
};
export type SubscriptionPollOutcomeKind =
  | "not_due"
  | "complete_no_match"
  | "matched"
  | "fetch_failure"
  | "timeout"
  | "partial"
  | "unavailable"
  | "rejected"
  | "expired";
export type SubscriptionMutationAuthority = "thought_adoption" | "owner_request";
export type SubscriptionPollClaim = {
  subscriptionId: string;
  claimToken: string;
  generation: number;
  expiresAtMs: number;
};

export type ObservationSubscription = {
  subscriptionId: string;
  conversationId: ConversationId;
  concernId: ConcernId | null;
  source: string;
  scope: string;
  topicKeys: string[];
  match: "equality" | "substring";
  expiresAtMs: number | null;
  status: "active" | "cancelled";
  externalSource?: ExternalSubscriptionSource | null;
  pollIntervalMs?: number | null;
  requesterId?: string | null;
  lastPolledAtMs?: number | null;
  lastPollOutcome?: SubscriptionPollOutcomeKind | null;
  expiryOpportunityEmittedAtMs?: number | null;
  pollClaimToken?: string | null;
  pollClaimExpiresAtMs?: number | null;
  pollGeneration?: number;
  ingestedFrontierAtMs?: number | null;
};
export type SubscriptionDelta =
  | {
      op: "create";
      subscription: Omit<ObservationSubscription, "status">;
      /** Host-derived authority binding for same-id renewal/expansion. */
      authority?: SubscriptionMutationAuthority;
    }
  | { op: "cancel"; subscriptionId: string };

export type ConversationEvidenceRecord = {
  rowId: string;
  lineageId: string;
  version: number;
  conversationId: ConversationId;
  role: "owner" | "ashley" | "system" | "external_dialog";
  text: string | null;
  createdAtMs: number;
  discordMessageIds: string[];
  reservationId: ReservationId | null;
  producingCycleId: CycleId | null;
  architectureEpoch: string;
  contentHash: string;
  sourceStatus: string;
  dataClassification: DataClassification;
  secretOmitted: boolean;
  delivered: boolean;
  speakerPrincipalId?: string | null;
  speakerKind?: "owner" | "external_human" | "external_bot" | "ashley";
  location?: unknown | null;
  audienceAtCapture?: "owner_private" | "dm" | "room" | "unknown";
  sentAtMs?: number | null;
  replyToMessageId?: string | null;
  mentionIds?: string[];
  attachmentRefs?: unknown[];
  provenance?: unknown | null;
};
export type ConversationEvidenceDiscordId = {
  discordMessageId: string;
  conversationId: ConversationId;
  lineageId: string;
  ordinal: number;
};

export type InboxConsumerStatus =
  | "pending"
  | "claimed"
  | "consumed"
  | "failed_retryable"
  | "failed_terminal";
export type InboxEvent = {
  id: string;
  conversationId: ConversationId;
  wakeId: string;
  kind: string;
  payload: unknown;
  createdAtMs: number;
  status: InboxConsumerStatus;
  claimToken: string | null;
  workerId: string | null;
  leaseExpiresAtMs: number | null;
  attemptCount: number;
  claimedAtMs: number | null;
  consumedAtMs: number | null;
  lastError: string | null;
  terminalReason?: string | null;
  /** W6 claim metadata attached to a just-leased event. */
  durableAttemptId?: string;
  durableAttemptOrdinal?: number;
  /** Host-only dispatch snapshot. It is derived from existing durable owners. */
  dispatchCoverage?: OwnerDispatchCoverage;
};

export type DurableDispatchTruth = "not_started" | "attempted" | "provider_responded" | "unknown";
export type DurableFailureClass =
  | "transient_retryable"
  | "rate_limited_retryable"
  | "permanent_terminal"
  | "unclassified_internal"
  | "outcome_unknown_reconcile"
  | "stale_or_cancelled";
export type DurableWorkState = "pending" | "leased" | "retry_wait" | "reconciling" | "terminal" | "quarantined";
export type DurableTerminalReason = "completed" | "permanent_failure" | "stale" | "cancelled" | "age_exhausted" | "attempts_exhausted" | "historical_partial_ingress_abandoned" | "superseded";
export type DurableAttemptReceipt = Readonly<{
  attemptId: string;
  eventId: string;
  wakeId: string | null;
  ordinal: 1 | 2 | 3 | 4 | 5;
  workerId: string;
  startedAtMs: number;
  finishedAtMs: number | null;
  dispatchTruth: DurableDispatchTruth;
  failureClass: DurableFailureClass | null;
  errorCode: string | null;
}>;
export type HandlerResult =
  | { kind: "completed" }
  | {
      kind: "deferred_to_frontier";
      conversationId: string;
      cycleId: string;
      generation: number;
      nextEligibleAtMs: number;
      latestEvidenceRowId: string;
    }
  | {
      kind: "failed";
      failureClass: Exclude<DurableFailureClass, "outcome_unknown_reconcile">;
      errorCode: string;
      dispatchTruth?: Exclude<DurableDispatchTruth, "unknown">;
      retryAfterMs?: number;
    }
  | {
      kind: "superseded";
      successorIdentity: { wakeId: string; eventId: string };
      coveredOwnerEventIds: readonly string[];
      uncoveredOwnerEventIds: readonly string[];
      coverageHash: string;
    }
  | { kind: "outcome_unknown"; operationId: string; errorCode: string };

export type OwnerDispatchCoverage = Readonly<{
  primaryEventId: string;
  coveredOwnerEventIds: readonly string[];
  uncoveredOwnerEventIds: readonly string[];
  coverageHash: string;
}>;

export type OwnerObligationAttemptOutcome = "published" | "abstained" | "failed" | "deferred" | "rejected";
export type OwnerObligationOutcome = "not_applicable" | "unresolved" | "transferred" | "resolved";
export type DeliveryDisposition =
  | "not_applicable"
  | "not_required"
  | "handed_to_delivery"
  | "delivery_pending"
  | "delivery_confirmed"
  | "delivery_unknown"
  | "delivery_failed";
export type OwnerObligationResolution = Readonly<{
  attemptOutcome: OwnerObligationAttemptOutcome;
  ownerObligationOutcome: OwnerObligationOutcome;
  primaryEventId: string | null;
  coveredOwnerEventIds: readonly string[];
  uncoveredOwnerEventIds: readonly string[];
  coverageHash: string | null;
  semanticCommitment: ConversationalCommitment | null;
  settlementId: string | null;
  successorIdentity: string | null;
  remainingResponsibility: string | null;
  deliveryDisposition: DeliveryDisposition;
}>;

export type RetrievalRequest = {
  triggerTerms: string[];
  workingContextTopics: string[];
  assertionKeys: string[];
  timeRangeMs?: { from: number; to: number };
  includeLogSearch: true;
};
export type RetrievalEvidenceSource =
  | "conversation_log"
  | "live_memory"
  | "quarantined_memory";
export type RetrievalHitKind = "lexical" | "key" | "time" | "log" | "vector";
export type MemoryKind =
  | "owner_preference"
  | "owner_self_description"
  | "owner_goal"
  | "owner_world_claim"
  | "project_knowledge"
  | "commitment"
  | "relational_boundary"
  | "shared_episode"
  | "open_question"
  | "ashley_interpretation"
  | "learned_self_evidence";
export type RetrievalHit = {
  kind: RetrievalHitKind;
  sourceStore: RetrievalEvidenceSource;
  ref: string;
  snippet: string;
  score: number;
  assertionKey: AssertionKey | null;
  memoryKind: MemoryKind | null;
  dimensions: EpistemicDimensions | null;
  dataClassification: DataClassification;
  live: boolean | null;
  role?: "owner" | "ashley" | "system" | "unknown" | null;
  supportRefs: string[];
  /** Transport/source truth and admitted protection metadata for §8.1 filtering. */
  source?: string | null;
  subject?: string[] | null;
  audienceScope?: SocialAudience | null;
  licenseRefs?: string[];
  protectionStatus?: "admitted" | "unresolved" | null;
};
export type RetrievalInfrastructureState = "ready" | "unavailable";

export type RetrievalResult<H = RetrievalHit> = {
  request: RetrievalRequest;
  hits: H[];
  state: RetrievalInfrastructureState;
  miss: boolean;
};

export type Observation = {
  observationId: string;
  cycleId: CycleId;
  generation: Generation;
  derived: boolean;
  replaySafe: boolean;
  modality: "text" | "image" | "page" | "tool" | "subscription" | "receipt";
  payload: unknown;
  provenance: string;
  rawOutranksDerivedOf?: string;
  dataClassification: DataClassification;
  secretOmitted: boolean;
  audienceScope?: SocialAudience | null;
  protectionStatus?: "admitted" | "unresolved" | null;
  /** Host-operational claim binding for external-watch ingestion. */
  pollClaim?: SubscriptionPollClaim;
};

export type ThoughtInterpretation = {
  discourseActs?: readonly DiscourseAct[];
  referentBindings?: readonly {
    span: string;
    concernRef?: ExistingRef;
    entityRef?: ExistingRef;
    sourceTurnRefs: readonly ExistingRef[];
  }[];
  corrections?: readonly {
    correctedTurnRefs: readonly ExistingRef[];
    fromSpan: string;
    toSpan: string;
    concernRef?: ExistingRef;
  }[];
  unresolvedAmbiguities?: readonly string[];
  topics?: readonly string[];
};

export type OperationalClaimState =
  | "not_attempted"
  | "in_progress"
  | "outcome_unknown"
  | "failed"
  | "succeeded";

export type OperationalStateClaim = {
  effectRef: string;
  claimedState: OperationalClaimState;
};

export type ThoughtCommitments = {
  epistemic?: readonly EpistemicCommitment[];
  operational?: readonly OperationalStateClaim[];
  conversational?: readonly ConversationalCommitment[];
  stance?: Stance;
  commitmentProposals?: readonly CommitmentProposal[];
};

export type ThoughtSpeechIntent =
  | {
      mode: "none";
      // VNext silence is intentionally minimal. There are no implicit
      // constraints or presentation directives for a silent settlement.
    }
  | {
      mode: "draft";
      mustSay?: readonly string[];
      mustNotSay?: readonly string[];
      surfaceDraft: string;
      presentationDirectives?: readonly string[];
    };

export type WorkingContextItemSemantic = {
  identity: SemanticRef;
  type: WorkingContextItemType;
  text: string;
  concernRef: SemanticRef | null;
  sourceTurnRefs: readonly ExistingRef[];
  status: "active" | "superseded" | "abandoned";
  supersedesRef: SemanticRef | null;
};

export type WorkingContextSemanticDelta =
  | { op: "upsert"; item: WorkingContextItemSemantic }
  | { op: "supersede"; target: ExistingRef; replacement: WorkingContextItemSemantic }
  | { op: "abandon"; target: ExistingRef };

export type DeskEntrySemantic = {
  identity: SemanticRef;
  concernRef: SemanticRef | null;
  body: string;
  authorKind: DeskAuthorKind;
  sourceRefs: readonly ExistingRef[];
  verbatim: boolean;
  form: DeskForm;
  endorsementRef: ExistingRef | null;
  audienceScope: SocialAudience;
};

export type DeskSemanticDelta =
  | { op: "upsert"; entry: DeskEntrySemantic }
  | { op: "supersede"; target: ExistingRef; replacement: DeskEntrySemantic }
  | { op: "archive"; target: ExistingRef }
  | { op: "tombstone"; target: ExistingRef };

export type ConcernSemanticDelta =
  | {
      op: "upsert";
      record: {
        identity: SemanticRef;
        statement: string;
        sourceTurnRefs: readonly ExistingRef[];
        dimensions: EpistemicDimensions;
        status: OccupancyStatus;
      };
    }
  | { op: "resolve"; target: ExistingRef };

export type OccupancySemanticDelta = {
  op: "set";
  concernRef: SemanticRef;
  status: OccupancyStatus;
  priority: number;
};

export type FutureTriggerSemanticDelta =
  | {
      op: "create";
      concernRef: SemanticRef;
      dueAtMs: number;
      purpose: string;
      payload: JsonObject;
    }
  | { op: "cancel"; target: ExistingRef };

export type SubscriptionSemanticDelta =
  | {
      op: "create";
      subscription: {
        concernRef: SemanticRef | null;
        source: string;
        scope: string;
        topicKeys: readonly string[];
        match: "equality" | "substring";
        expiresAtMs: number | null;
        externalSource?: ExternalSubscriptionSource;
        pollIntervalMs?: number;
      };
    }
  | { op: "cancel"; target: ExistingRef };

export type ThoughtDurableNomination = {
  statement: string;
  memoryKind: MemoryKind;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  sourceRefs: readonly ExistingRef[];
  supersedesRef: ExistingRef | null;
  concernRef: SemanticRef | null;
};

export type ThoughtEvidenceUse = {
  observationRefsUsed?: readonly ExistingRef[];
  retrievalRefsUsed?: readonly ExistingRef[];
  sourceRefsUsed?: readonly ExistingRef[];
  openIntentRefs?: readonly ExistingRef[];
};

export type SettlementSemanticOutput = {
  kind: "settlement";
  speech: ThoughtSpeechIntent;
  /** Thought-authored declared contact intent; Host enforces it at admission. */
  interactionIntent?: "continue" | "initiate";
  interpretation?: ThoughtInterpretation;
  commitments?: ThoughtCommitments;
  workingContextDeltas?: readonly WorkingContextSemanticDelta[];
  deskDeltas?: readonly DeskSemanticDelta[];
  concernDeltas?: readonly ConcernSemanticDelta[];
  occupancyDeltas?: readonly OccupancySemanticDelta[];
  futureTriggerDeltas?: readonly FutureTriggerSemanticDelta[];
  subscriptionDeltas?: readonly SubscriptionSemanticDelta[];
  durableNominations?: readonly ThoughtDurableNomination[];
  evidenceUse?: ThoughtEvidenceUse;
};

export type ObservationIntentSemanticOutput = {
  kind: "observation_intent";
  operationKind: string;
  request: JsonObject;
  purpose: string;
  evidenceNeed: string;
  existingRefs: readonly ExistingRef[];
  /**
   * Optional bounded interim hold. Valid only on detached V1 async
   * project.investigate. It is acknowledgement/intent, never a settlement:
   * publishable only after durable operation admission, and it never
   * resolves the originating Owner obligation.
   */
  interimSpeech?: ThoughtInterimSpeech;
};

/**
 * Thought-authored interim hold for a detached operation. mode "none" is
 * explicitly no interim speech; mode "hold" carries a short
 * acknowledgement/intent draft that claims no findings, success, or
 * unproven worker start.
 */
export type ThoughtInterimSpeech =
  | { mode: "none" }
  | {
      mode: "hold";
      surfaceDraft: string;
      presentationDirectives?: readonly string[];
    };

export type EffectIntentSemanticOutput = {
  kind: "effect_intent";
  operationKind: string;
  request: JsonObject;
  purpose: string;
  expectedOutcome: string;
  existingRefs: readonly ExistingRef[];
};

export type SemanticAbstainReason =
  | "insufficient_evidence"
  | "unresolved_ambiguity"
  | "no_responsible_proposal";

export type AbstainSemanticOutput = {
  kind: "abstain";
  reason: SemanticAbstainReason;
  explanation: string;
  evidenceRefs: readonly ExistingRef[];
};

export type ThoughtSemanticOutput =
  | SettlementSemanticOutput
  | ObservationIntentSemanticOutput
  | EffectIntentSemanticOutput
  | AbstainSemanticOutput;

export type ObservationRequest = {
  requestId: string;
  cycleId: CycleId;
  generation: Generation;
  kind: string;
  request: unknown;
  replaySafe: true;
  authorityCurrentness?: AuthorityCurrentnessBinding;
};

export type EffectProposal = {
  effectId: string;
  cycleId: CycleId;
  generation: Generation;
  idempotencyKey: IdempotencyKey;
  kind: string;
  request: unknown;
  authorityEpoch: AuthorityEpoch;
  authorityCurrentness?: AuthorityCurrentnessBinding;
  originEventId?: string;
  originAttemptId?: string | null;
};
export type InFlightRecord = {
  effectId: string;
  cycleId: CycleId;
  generation: Generation;
  wakeId: string | null;
  correlationId: string;
  idempotencyKey: IdempotencyKey;
  status: "in_flight" | "receipted" | "unknown";
  dispatchedAtMs: number;
  originJobId: string | null;
  originEventId: string | null;
  originAttemptId: string | null;
  audienceScope?: SocialAudience | null;
};
export type EffectReceipt = {
  receiptId: string;
  effectId: string;
  idempotencyKey: IdempotencyKey;
  outcome: "succeeded" | "failed" | "outcome_unknown" | "not_attempted" | "in_progress";
  claims: Record<string, unknown>;
  atMs: number;
  dataClassification: DataClassification;
  secretOmitted: boolean;
};

export type AuthorityCode =
  | "CURRENTNESS_UNVERIFIED"
  | "RECEIPT_REQUIRED"
  | "RECEIPT_CONTRADICTS_CLAIM"
  | "IN_FLIGHT_UNKNOWN"
  | "CAPABILITY_UNAVAILABLE"
  | "EFFECT_NOT_AUTHORIZED"
  | "RELATIONAL_BOUNDARY"
  | "RELATIONAL_WITHDRAWAL"
  | "SOURCE_CLASS_INSUFFICIENT"
  | "STALE_STATE"
  | "IDENTITY_MUTATION_FORBIDDEN"
  | "SECRET_OR_CREDENTIAL"
  | "REVISION_BUDGET_EXHAUSTED"
  | "DISPATCH_EPOCH_CHANGED"
  | "STALE_GENERATION"
  | "DRAFT_COMMITMENT_CONFLICT"
  | "EMPTY_COMMITMENTS_WITH_DRAFT"
  | "commitment_contract_failure"
  | "AUTHORITY_TRANSITION_ACTIVE"
  | "AUTHORITY_PACK_INCOMPLETE"
  | "AUTHORITY_VECTOR_STALE"
  | "DERIVED_SCOPE_INVALIDATED"
  | "DERIVED_SCOPE_UNAVAILABLE"
  | "OPERATIONAL_CLAIM_STATE_MISMATCH"
  | "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN";
export type AuthorityStage = "proposal" | "settlement" | "dispatch";
export type CanonicalOwner = "nuclear" | "continuity" | "cognitive_sidecar";
export type AuthorityVersionVector = Readonly<Record<CanonicalOwner, number>>;
export type AuthorityCurrentnessBinding = Readonly<{
  barrierId: "global";
  barrierEpoch: number;
  barrierRevision: number;
  ownerVersions: AuthorityVersionVector;
}>;
export type AuthorityPacks = {
  epistemic: { allowInferredWorldClaims: boolean };
  currentness: {
    requireObservationForLatest: boolean;
    observedObservationIds?: string[];
    binding?: AuthorityCurrentnessBinding;
    complete?: boolean;
    receiptLimit?: number;
    receiptsTruncated?: boolean;
  };
  receipt: { receiptsByEffectId: Record<string, EffectReceipt>; bounded?: boolean };
  capability: CapabilityReality;
  operational: { sandboxAvailable: boolean };
  relational: { withdrawalActive: boolean; neverMention: string[] };
  stateEpoch: { authorityEpoch: AuthorityEpoch };
};
export type AuthorityVerdict =
  | { ok: true }
  | { ok: false; codes: AuthorityCode[] };

export type ThoughtSettlementDraft = {
  schemaVersion: SettlementSchemaVersion;
  cycleId: CycleId;
  generation: Generation;
  authorityEpoch: AuthorityEpoch;
  occupantId: OccupantId;
  architectureEpoch: typeof ARCHITECTURE_EPOCH;
  triggerRef: string;
  /** Thought-authored declared contact intent; Host enforces it at admission. */
  interactionIntent?: "continue" | "initiate";
  interpretation?: {
    discourseActs?: DiscourseAct[];
    referentBindings?: ReferentBinding[];
    corrections?: CorrectionRecord[];
    unresolvedAmbiguities?: string[];
    topics?: string[];
  };
  commitments?: {
    epistemic?: EpistemicCommitment[];
    operational?: OperationalStateClaim[];
    conversational?: ConversationalCommitment[];
    stance?: Stance;
    commitmentProposals?: CommitmentProposal[];
  };
  speech: ThoughtSpeechDraft;
  workingContextDelta?: WorkingContextDelta[];
  deskDeltas?: DeskDelta[];
  concernDeltas?: ConcernDelta[];
  occupancyDelta?: OccupancyDelta[];
  futureTriggers?: FutureTriggerDelta[];
  subscriptions?: SubscriptionDelta[];
  durableNominations?: DurableNomination[];
  operations: {
    observationsConsumed: string[];
    /** Authored retrieval reliance preserved for post-publication audit. */
    retrievalRefsUsed?: string[];
    /** Authored source reliance preserved for post-publication audit. */
    sourceRefsUsed?: string[];
    effectsCompleted: string[];
    intentsStillInFlight: string[];
  };
  authority: {
    objectionsApplied: AuthorityCode[];
    revisionCount: number;
  };
};
export type PublishedSpeech = ThoughtSpeechDraft & {
  finalLicensedText: string | null;
};
export type PublishedCognitiveSettlement = ThoughtSettlementDraft & {
  speech: PublishedSpeech;
  settlementId: string;
  wakeId?: string;
  /** Host admission bindings; Thought cannot author or modify this field. */
  commitmentBindings?: CommitmentRealizationBinding[];
};
export type CognitiveSettlement = PublishedCognitiveSettlement;

export type ThoughtStepKind =
  | "observation_request"
  | "effect_proposal"
  | "settlement"
  | "abstain"
  | "failure";
export type ThoughtParserFailureCode =
  | "invalid_json"
  | "root_not_object"
  | "wrong_kind"
  | "unknown_field"
  | "empty_when_present"
  | "required_field_missing"
  | "wrong_type"
  | "invalid_enum"
  | "reference_not_allowlisted"
  | "alias_invalid"
  | "alias_collides_with_existing_ref"
  | "operation_not_registered"
  | "identity_missing"
  | "identity_mismatch"
  | "missing_settlement_fields"
  | "speech_contract_failure"
  | "commitment_contract_failure"
  | "commitment_binding_invalid"
  | "operations_contract_failure"
  | "authority_contract_failure"
  | "observation_contract_failure"
  | "effect_contract_failure"
  | "forbidden_fields"
  | "schema_version_mismatch"
  | "alias_duplicate"
  | "dangling_local_reference"
  | "reference_target_type_mismatch"
  | "future_trigger_snapshot_unavailable"
  | "other";
export type ThoughtCorrectionFailureCode = "structural_correction_scope_violation";
export type ThoughtPassIndex = number;
export type ThoughtStepBase = {
  kind: ThoughtStepKind;
  cycleId: CycleId;
  generation: Generation;
  pass: ThoughtPassIndex;
  requestId: string;
  occupantId: OccupantId;
};
export type ThoughtObservationRequestStep = ThoughtStepBase & {
  kind: "observation_request";
  observationRequest: ObservationRequest;
  correlationId: string;
  expectedResultType: "observation";
  deadlineAtMs: number;
};
export type ThoughtEffectProposalStep = ThoughtStepBase & {
  kind: "effect_proposal";
  effectProposal: EffectProposal;
  correlationId: string;
  expectedResultType: "effect_receipt";
  deadlineAtMs: number;
};
export type ThoughtSettlementStep = ThoughtStepBase & {
  kind: "settlement";
  settlement: ThoughtSettlementDraft;
};
export type ThoughtFailureStep = ThoughtStepBase & {
  kind: "failure";
  reason:
    | "malformed"
    | "unavailable"
    | "revision_exhausted"
    | "pass_exhausted"
    | "capacity_deferred"
    | "cancelled";
  /** Bounded structural category. Raw provider output is never persisted. */
  diagnosticCode?: ThoughtParserFailureCode;
  /** Parser-owned field/path metadata; raw provider output is never persisted. */
  diagnosticField?: string;
  /** Host-owned rejection when a localized correction changes data outside its scope. */
  correctionFailureCode?: ThoughtCorrectionFailureCode;
};
export type ThoughtAbstainStep = ThoughtStepBase & {
  kind: "abstain";
  abstain: AbstainSemanticOutput;
};
export type ThoughtStepOutput =
  | ThoughtObservationRequestStep
  | ThoughtEffectProposalStep
  | ThoughtSettlementStep
  | ThoughtAbstainStep
  | ThoughtFailureStep;

export type CognitiveWorkspace = { notes: string };
export type IdentitySlice = {
  constitutional: string[];
  stableSelf: string[];
  /** Optional source-owned redaction metadata; text is never classified by Host. */
  privateDerivative?: string[];
  privateDerivativeIndexes?: number[];
};
export type LearnedSelfSlice = {
  dispositions: string[];
  interests: string[];
  /** Source/support references for the currently projected learned-self slice. */
  supportRefs?: string[];
  /** New audience-separated projection. Kept optional for legacy in-process callers. */
  broadOrientation?: {
    dispositions: string[];
    interests: string[];
    supportRefs?: string[];
    audienceScope?: SocialAudience | null;
    protectionStatus?: "admitted" | "unresolved" | null;
  };
  personLinked?: Array<{
    audience: SocialAudience;
    dispositions: string[];
    interests: string[];
    sourceRefs: string[];
    supportRefs?: string[];
    protectionStatus?: "admitted" | "unresolved" | null;
    licenseRefs?: string[];
  }>;
};
export type RuntimeCondition = {
  fallback: boolean;
  compression: boolean;
  lookupFailed: boolean;
  thoughtUnavailable: boolean;
};

export const CAPABILITY_REALITY_REASON_CODES = [
  "capability_exists",
  "unavailable",
  "another_audience_only",
  "needs_owner_approval",
  "substrate_without_authority",
  "evidence_not_acquired",
  "capacity_unproven",
  "worker_capacity_exhausted",
] as const;

export type CapabilityRealityReasonCode = (typeof CAPABILITY_REALITY_REASON_CODES)[number];

export type CapabilityReachability = Readonly<{
  audience: SocialAudience;
  reasons: Readonly<Record<string, CapabilityRealityReasonCode>>;
}>;

export type PublicPresenceCapability = Readonly<{
  operationKind: "discord.public_presence";
  semanticClass: "effect";
  audience: "FULLY_PUBLIC";
  available: true;
  requiredRequestFields: readonly ["action"];
  optionalRequestFields: readonly ["text"];
}>;

export type PublicPresenceContext = Readonly<{
  audience: "FULLY_PUBLIC";
  text: string | null;
  authoredAtMs: number | null;
  expiresAtMs: number | null;
}>;
export type OccupantCalibration = {
  occupantId: OccupantId;
  notes: string[];
};

export type CapabilityReality = {
  vision: boolean;
  attachmentText: boolean;
  /** Additional authorized user-requested URL/page reads; does not gate already projected rawConversation. */
  conversationalRead: boolean;
  webSearch: boolean;
  canOfferProjectInspection: boolean;
  canOfferWorkspace: boolean;
  canOfferVerification: boolean;
  canOfferAuthorship: boolean;
  canOfferBoundedOperation: boolean;
  canOfferInquiry: boolean;
  canOfferPatchExport: boolean;
  /** Host-effective delegated investigation worker; not a quota-class name. */
  canOfferDelegatedInvestigation?: boolean;
  /** Host-effective iterative candidate worker; not a quota-class name. */
  canOfferIterativeEngineering?: boolean;
  approvedProjectIds: string[];
  /** Host-owned affordance facts exposed to Thought; never a selected branch. */
  operationCapabilities?: readonly ThoughtOperationCapability[];
  /** Autonomous-only public self-presentation affordance. */
  publicPresence?: PublicPresenceCapability;
  /** Reason-coded reachability facts for the audience used to build this reality. */
  reachability?: CapabilityReachability;
};

export type ThoughtOperationCapability = Readonly<{
  operationKind: string;
  semanticClass: "observation" | "effect";
  /** Canonical operation-family metadata from the Sandbox V2 registry. */
  family: SandboxV2CapabilitySpec["family"];
  /** Canonical mutation property from the Sandbox V2 registry. */
  readOnly: boolean;
  /** Canonical project-binding property from the Sandbox V2 registry. */
  requiresProject: boolean;
  available: boolean;
  requiredRequestFields: readonly string[];
  optionalRequestFields: readonly string[];
  operatorBoundRequestFields: readonly string[];
  authorizedProjectIds: readonly string[];
}>;

export type CommitmentEvidenceCompleteness = "supported" | "contradicted" | "unknown";
export type CommitmentDueProjection = Readonly<{
  commitmentId: string;
  realizationClause: string;
  evidenceCompleteness: CommitmentEvidenceCompleteness;
}>;

export type ThoughtInput = {
  cycleId: CycleId;
  generation: Generation;
  occupantId: OccupantId;
  authorityEpoch: AuthorityEpoch;
  trigger: { kind: CycleTriggerKind; ref: string };
  /** Stored commitment meaning plus fire-time evidence completeness for Thought. */
  commitmentDue?: CommitmentDueProjection;
  rawConversation: ConversationEvidenceRecord[];
  /** Source-owned frontier identity/coverage metadata; text may be budgeted separately. */
  conversationSelection?: {
    frontierIncludedIds: string[];
    omittedEvidenceIds: string[];
    /** Current row resolved from the cycle trigger's source lineage, when available. */
    currentTriggerRowId?: string | null;
  };
  workingContext: WorkingContextItem[];
  /** Owner-private desk projection; absent when no eligible entries exist. */
  deskEntries?: DeskEntry[];
  occupancy: ThoughtOccupancy[];
  /** Host-captured concern snapshots seen while assembling this Thought input. */
  concernSnapshots?: Readonly<Record<string, string>>;
  /** Host-only source witness; attached non-enumerably and never sent to Thought. */
  sourceCurrentness?: ThoughtSourceCurrentness;
  constitution: IdentitySlice;
  learnedSelfSlice: LearnedSelfSlice;
  capabilityReality: CapabilityReality;
  /** Present only for an autonomous idle-opportunity Thought. */
  publicPresence?: PublicPresenceContext;
  /** Host facts for permitted social destinations; Thought chooses if used. */
  availableDestinations?: readonly AvailableSocialDestination[];
  observations: Observation[];
  retrieval: RetrievalResult;
  inFlight: InFlightRecord[];
  authorityObjections: AuthorityCode[];
  runtimeCondition: RuntimeCondition;
  rememberDirective: RememberDirective | null;
};
export type ThoughtCompleteOptions = CognitiveDispatchOptions & {
  attentionDb: DatabaseSync;
  route: "thought";
  responseFormat: "json_schema";
  structuredOutput: StructuredOutputRequest;
  requestId?: string;
};

export type DurableNomination = {
  nominationId: string;
  cycleId: CycleId;
  generation: Generation;
  assertionKey: AssertionKey;
  statement: string;
  memoryKind: MemoryKind;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  supersedesAssertionKey: AssertionKey | null;
  concernId: ConcernId | null;
  sourceRefs?: string[];
};
export type MemorySupportProvenance = "native" | "legacy_import";
export type MemoryAssertion = {
  assertionKey: AssertionKey;
  statement: string;
  memoryKind: MemoryKind;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  lineageParentKey: AssertionKey | null;
  admittedGeneration: Generation | null;
  live: boolean;
  sourcePrincipal?: string | null;
  subject?: string[] | null;
  audienceScope?: SocialAudience | null;
  sourceEvidenceRef?: string | null;
  protectionBasisRefs?: string[];
  protectionStatus?: "admitted" | "unresolved" | null;
  licenseRefs?: string[];
};
export type MemorySupport = {
  supportId: string;
  assertionKey: AssertionKey;
  source: EpistemicSource;
  provenance: MemorySupportProvenance;
  sourceArchitectureEpoch: typeof ARCHITECTURE_EPOCH | "legacy";
  sourceRef: string | null;
  settlementId: string | null;
  evidenceLineageId: string | null;
  observationId: string | null;
  receiptId: string | null;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  createdAtMs: number;
};
export type RememberDirective = {
  rememberRequested: true;
  evidenceLineageId: string;
  evidenceRowId: string;
  dataClassification: DataClassification;
  audienceScope?: SocialAudience | null;
  protectionStatus?: "admitted" | "unresolved" | null;
};

export type V021ForgetDisposition =
  | "REDACT"
  | "DELETE"
  | "DETACH"
  | "CANCEL"
  | "KEEP_METADATA_ONLY"
  | "NO_CONTENT"
  | "NO_ACTION";
export type V021ForgetEntityType =
  | "v021_conversation_evidence"
  | "v021_thought_step"
  | "v021_working_context"
  | "v021_desk_entry"
  | "v021_concern"
  | "v021_occupancy"
  | "v021_future_trigger"
  | "v021_subscription"
  | "v021_observation"
  | "v021_effect_receipt"
  | "v021_nomination"
  | "v021_memory_assertion"
  | "v021_memory_support"
  | "v021_settlement"
  | "v021_speech_outbox"
  | "v021_system_notice"
  | "v021_causal_ledger"
  | "v021_inbox_event"
  | "v021_in_flight";
export type V021ForgetTarget = {
  entityType: V021ForgetEntityType | string;
  entityUuid: string;
  action: "redact" | "delete" | "detach" | "cancel" | "keep_metadata_only";
};

export type DeliveryIntent = {
  ownerId: string;
  channel: string;
  threadId: string;
  conversationId: ConversationId;
  trigger:
    | "owner_message_reactive"
    | "external_message"
    | "idle"
    | "commitment_due"
    | "future_trigger"
    | "subscription"
    | "recovery"
    | "operation_completion";
  deliveryLane: "reactive" | "proactive" | "social_notify";
  purpose: "licensed_speech" | "system_notice";
  /** Host-owned destination binding for a permitted social publication. */
  destination?:
    | { kind: "external_dm"; principalId: string; channelId?: string; threadId?: string }
    | { kind: "room"; roomId: string; guildId?: string; channelId?: string; threadId?: string; ownerRoom?: boolean };
  /** S5 input retained until the existing outbox projector owns a reservation id. */
  externalPublication?: {
    destination:
      | { kind: "external_dm"; principalId: string; channelId?: string; threadId?: string }
      | { kind: "room"; roomId: string; guildId?: string; channelId?: string; threadId?: string };
    attemptInputBasis: import("./social/types.js").AttemptInputBasis;
    hardDependencyBundle: import("./social/types.js").HardDependencyBundle;
    interactionIntent: import("./social/types.js").InteractionIntent;
    licenseRefs: string[];
    materialHash?: string;
  };
  /** Host admission bindings carried through the existing outbox JSON. */
  commitmentBindings?: CommitmentRealizationBinding[];
  /** Social lifecycle identity carried through the existing outbox JSON. */
  socialLifecycle?: {
    consequenceChainId: string;
    attemptId: string | null;
  };
};
export type OutboxSendStatus =
  | "pending"
  | "projecting"
  | "projected"
  | "sending"
  | "delivered"
  | "partially_delivered"
  | "send_failure"
  | "suppressed"
  | "suppressed_shadow";
export type OutboxOrigin = "live" | "shadow";
export type SpeechOutboxRow = {
  outboxId: OutboxId;
  settlementId: string;
  projectionKey: DeliveryProjectionKey;
  cycleId: CycleId;
  generation: Generation;
  conversationId: ConversationId;
  nuclearReservationId: ReservationId | null;
  licensedText: string;
  sendStatus: OutboxSendStatus;
  discordMessageIds: string[];
  suppressed: boolean;
  origin: OutboxOrigin;
  deliveryIntent: DeliveryIntent;
  nuclearFinalizationReason: string | null;
};
export type SystemNoticeOutbox = {
  noticeId: NoticeId;
  noticeKey: string;
  projectionKey: DeliveryProjectionKey;
  cycleId: CycleId | null;
  conversationId: ConversationId;
  deliveryIntent: DeliveryIntent;
  noticeText: string;
  sendStatus: OutboxSendStatus;
  nuclearReservationId: ReservationId | null;
  discordMessageId: string | null;
  origin: OutboxOrigin;
};
export interface OutboxDeliveryProjector {
  project(outboxId: OutboxId): Promise<void>;
  projectSystem(noticeId: NoticeId): Promise<void>;
}
export type ExternalizationGateReason =
  | "ok"
  | "proactive_disabled"
  | "proactive_paused"
  | "daily_cap"
  | "chat_in_progress"
  | "unavailable"
  | "idle_floor"
  | "private_compute_budget";

export type CausalLedgerEntry = {
  cycleId: CycleId;
  generation: Generation;
  triggerKind: CycleTriggerKind;
  occupantId: OccupantId;
  authorityEpoch: AuthorityEpoch;
  settlementId: string | null;
  observationIds: string[];
  effectIds: string[];
  authorityCodes: AuthorityCode[];
  nominationIds: string[];
  outboxId: OutboxId | null;
  fidelity: "passed" | "rejected" | "skipped";
  thoughtUnavailable: boolean;
  architectureEpoch: typeof ARCHITECTURE_EPOCH;
};
export type CausalBundle = {
  evidenceShownToThought: ConversationEvidenceRecord[];
  thoughtInputHash: string;
  settlement: PublishedCognitiveSettlement | null;
  workingContext: WorkingContextItem[];
  occupancy: MindOccupancy[];
  authorityCodes: AuthorityCode[];
  nominations: DurableNomination[];
  expressionInput: string | null;
  outboxText: string | null;
  deliveredText: string | null;
  thoughtModelAttempts: number;
  acceptedSettlements: number;
  acceptedGeneration: Generation | null;
  triggerKind?: CycleTriggerKind;
  outboxGeneration?: Generation | null;
};

export type ThoughtExecutionDispatchTruth = "not_sent" | "sent" | "unknown";

/** Physical Model Fabric execution evidence, separate from Thought control counters. */
export type ThoughtExecutionProvenance = Readonly<{
  dispatchTruth: ThoughtExecutionDispatchTruth;
  providerAttempts: number | "unknown";
}>;

export type PublicationRejectionReason =
  | "stale_generation"
  | "authority_transition"
  | "authority_vector_stale"
  | "source_currentness_stale"
  | "wake_missing"
  | "wake_terminal"
  | "wake_reconciliation_required"
  | "consequence_exists"
  | "future_trigger_snapshot_conflict";

export type KernelDeps = {
  nowMs: () => number;
  attentionDb: DatabaseSync;
  completeChat: typeof completeChat;
  runPerception: (input: {
    cycleId: CycleId;
    generation: Generation;
    ownerMessage: string;
  }) => Promise<Observation[]>;
  executeObservation: (req: ObservationRequest) => Promise<Observation>;
  executeEffect: (proposal: EffectProposal) => Promise<EffectReceipt>;
  checkAuthority: CheckAuthority;
  loadAuthorityPacks: () => AuthorityPacks;
  expressionEnabled: boolean;
  adaptExpression?: (input: {
    draft: string;
    commitments: ThoughtSettlementDraft["commitments"];
    commitmentBindings?: readonly CommitmentRealizationBinding[];
    stance?: Stance;
    directives?: string[];
    profile: string;
    medium: "discord";
  }) => Promise<string>;
  projectOutbox: (outboxId: OutboxId) => Promise<void>;
  projectSystemNotice?: (noticeId: NoticeId) => Promise<void>;
  /** Shadow supplies `shadow`; live/default execution remains `live`. */
  origin?: OutboxOrigin;
  constitution: IdentitySlice;
  capabilityReality: CapabilityReality;
  derivedStore?: import("./retrieval/derived-store.js").DerivedStore;
  observabilityDb?: DatabaseSync;
};
export type KernelRunResult = {
  cycleId: CycleId;
  generation: Generation;
  published: boolean;
  outboxId: OutboxId | null;
  infrastructureNotice: string | null;
  thoughtModelAttempts: number;
  acceptedThoughtPasses: number;
  composeCancelledAttempts: number;
  acceptedSettlements: number;
  /** Optional because legacy runner/test seams remain structurally compatible. */
  thoughtExecutionProvenance?: ThoughtExecutionProvenance;
  /** Host-derived owner handoff/resolution truth for durable dispatch. */
  ownerObligationResolution?: OwnerObligationResolution;
  /** Host-derived exact successor proof for a stale Owner event. */
  ownerSupersession?: Extract<HandlerResult, { kind: "superseded" }>;
  /** Publication rejection is not a committed settlement. */
  publicationReason?: PublicationRejectionReason;
  deferred?: boolean;
  nextEligibleAtMs?: number;
  conversationId?: string;
  latestEvidenceRowId?: string;
};

export type CognitiveDispatchResult = KernelRunResult | null;

export type CheckAuthority = (
  stage: AuthorityStage,
  input: {
    settlement?: ThoughtSettlementDraft | PublishedCognitiveSettlement;
    proposal?: EffectProposal | ObservationRequest;
    packs: AuthorityPacks;
    authorityEpoch: AuthorityEpoch;
    authorityDb?: DatabaseSync;
    receiptDb?: DatabaseSync;
    expectedCurrentness?: AuthorityCurrentnessBinding;
    /** Host-owned effects active for the cycle being settled. */
    activeEffects?: readonly InFlightRecord[];
  },
) => AuthorityVerdict;
export type InvokeThoughtComplete = (
  messages: ChatMessage[],
  options: ThoughtCompleteOptions,
) => ReturnType<typeof completeChat>;
export type PublishSemanticTransaction = (...args: unknown[]) => unknown;
export type CompletionOptionsForCognitive = CompletionOptions;
