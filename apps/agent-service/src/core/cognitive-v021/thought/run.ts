import { selfChangeResultForThought } from "../growth/self-change-results.js";
import { domusActBindingFor, domusChannelFor, domusForThought, domusGameOnlyFor, domusHomeFor, domusNowForThought } from "../../domus/notification.js";
import { domusDiaryForThought } from "../../domus/diary.js";
import { domusSessionForThought } from "../../domus/session.js";
import { thoughtPlaces } from "../../places/thought.js";
import { placesSeenMarks } from "../../places/places.js";
import { homeForThought, homeRootFor } from "../../home/home.js";
import { willForThought } from "../../will/pursuits.js";
import { vaultDirFor } from "../../reach/vault-dir.js";
import { applyContactStop } from "../../places/rules.js";
import { recordLessons, teacherForThought } from "../../teach/lessons.js";
import { readThoughtAttention } from "../thalamus/store.js";
import { randomUUID } from "node:crypto";
import { env } from "../../../env.js";
import type { DatabaseSync } from "node:sqlite";
import { isAuthorizedOwnerId } from "../../../owner-auth.js";
import { LONG_OPERATION_HORIZON_MS } from "../../sandbox/worker/contracts.js";
import { resolveCanonicalOwnerPrincipal } from "../owner-principal.js";
import {
  completeChat,
} from "../../../mistral-client.js";
import type { ChatMessage } from "../../model-routing/types.js";
import { commandCodeThoughtEvidenceFromError } from "../../command-code/evidence.js";
import { thoughtLifeboatForTrigger, thoughtModelForTrigger } from "../../command-code/policy.js";
import { THOUGHT_MODEL_CIRCUIT_MS, thoughtModelCircuit } from "./model-circuit.js";
import {
  ORDINARY_THOUGHT_BUDGET_MS,
  MAX_AUTHORITY_REVISIONS,
  MAX_EFFECT_ROUNDS,
  MAX_OBSERVATION_ROUNDS,
  MAX_THOUGHT_PASSES,
  MAX_THOUGHT_MODEL_ATTEMPTS,
  SETTLEMENT_SCHEMA_VERSION,
  type CycleTriggerKind,
  type CommitmentDueProjection,
  type CommitmentEvidenceCompleteness,
  type InboxEvent,
  type KernelDeps,
  type KernelRunResult,
  type PublishedCognitiveSettlement,
  type ThoughtCompleteOptions,
  type ThoughtInput,
  type ThoughtParserFailureCode,
  type ThoughtStepOutput,
  type ThoughtSettlementDraft,
  type ThoughtSemanticOutput,
  type KernelEnvelope,
  type SettlementSemanticOutput,
  type ObservationIntentSemanticOutput,
  type EffectIntentSemanticOutput,
  type EffectProposal,
  type SemanticRef,
  type Observation,
  type DeliveryIntent,
  type RememberDirective,
  type AuthorityCode,
  type InFlightRecord,
  type EffectReceipt,
  type ThoughtExecutionDispatchTruth,
  type ThoughtExecutionProvenance,
  type ThoughtWakeCause,
  type PublicationRejectionReason,
  type OwnerObligationAttemptOutcome,
  type OwnerObligationResolution,
  type ConversationalCommitment,
  type ThoughtContinuityRecovery,
  type ConversationEvidenceRecord,
  type CapabilityReality,
} from "../types.js";
import {
  createThoughtStructuralFeedback,
  validateThoughtStructuralCorrectionScope,
  parseThoughtStructuralCandidate,
  type StructuralFeedbackInput,
  type ThoughtStructuralCorrectionScopeViolation,
  type ThoughtStructuralFeedback,
} from "./structural-feedback.js";
import type { PrivateBudgetDispatchBinding } from "../private-budget/ledger.js";
import {
  getCycle,
  getCurrentCycle,
  admitCycle,
  appendCycleLogIds,
  updateCycleState,
  currentAttemptIs,
  getCycleFreshnessState,
  getInboxEvent,
  listCycleOwnerUtterances,
} from "../cycle/inbox.js";
import {
  activeThoughtMayFinishWhileDetachedCompletionQueued,
  CONVERSATION_COGNITION_OCCUPIED,
} from "../cycle/cognition-claim.js";
import type { AttemptInputBasis } from "../social/types.js";
import type { CommitmentRealizationBinding } from "../social/types.js";
import {
  commitmentBindingsForSettlement,
  getCommitmentOpportunity,
  isCommitmentsEnabled,
  persistCommitmentProposals,
  settlePersistedCommitmentProposals,
} from "../../relationship/commitment-admission.js";
import { captureOwnerDispatchCoverage, proveExactOwnerSupersession } from "../cycle/owner-coverage.js";
import { getConversationEvidence, listConversationEvidence } from "../evidence/conversation-log.js";
import {
  futureTriggerWakeContext,
  normalizeFutureTriggerEvidenceRefs,
  normalizeFutureTriggerTimingPolicy,
} from "../initiative/future-triggers.js";
import { listInFlightForThoughtCycle } from "../effect/in-flight.js";
import { dispatchEffect } from "../effect/proposal.js";
import type { EffectExecutionControl } from "../effect/execution-control.js";
import {
  effectContinuationFromCompletion,
  finishEffectContinuation,
} from "../effect/continuation.js";
import { produceOperationCompletion } from "../operation/completion.js";
import {
  buildOperationalEffectNamespace,
  buildOperationalEffectNamespaceFromRefs,
} from "../effect/effect-ref.js";
import { registerActiveThought } from "../cycle/active.js";
import { adaptPerception } from "../perception/adapter.js";
import { resolveAttachmentObservations } from "../perception/attachments.js";
import { buildThoughtInput, captureThoughtSourcePackage, thoughtInputContainsSecret } from "./input.js";
import { describeFieldShape } from "./field-shape.js";
import { parseThoughtSemanticOutput, THOUGHT_SEMANTIC_PARSER_ID } from "./parse.js";
import { salvageSettlement } from "./salvage.js";
import {
  concernDiscoverItemAuthorable,
  concernInspectRefsForInput,
  type ConcernInspectAuthority,
} from "./concern-inspect.js";
import { getConcern } from "../concerns/lineage.js";
import {
  buildReferenceAllowlist,
  hasReferenceTarget,
  registerLocalAlias,
  type ThoughtReferenceAllowlist,
  type ThoughtReferenceTarget,
  type ThoughtReferenceTargetMap,
} from "./reference-allowlist.js";
import { bindEffectIntent, bindObservationIntent } from "./operation-binding.js";
import { CapabilityUnavailableError } from "./typed-inspection.js";
import { routeProjectInspectionRequest } from "../operation/project-inspection-route.js";
import {
  thoughtOutputStructuredRequest,
  thoughtContractProfile,
  thoughtContractProfileKey,
} from "./output-contract.js";
import { createPrefixMeter } from "./prefix-meter.js";
import {
  ProjectionCache,
  semanticPassKey,
  hashAuthorityObjections,
  hashThoughtSourceCurrentness,
} from "./projection-allocator/cache.js";
import {
  allocateThoughtProjection,
  RequiredOverflowError,
  thoughtMessagesForProjection,
  type AllocatedThoughtProjection,
} from "./projection-allocator/allocator.js";
import {
  MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
  TARGET_SEMANTIC_INPUT_ENVELOPE,
  estimateRequestInputBytes,
  estimateRequestTokens,
} from "./projection-allocator/budget.js";
import {
  type ProjectedThoughtInput,
  type ProjectedInFlightRecord,
  computeSemanticProjectionHash,
  computeDispatchMessagesHash,
} from "./projection.js";
import { validateThoughtSettlementDraft } from "../settlement/validate.js";
import { getPublishedSettlementIdentity, publishSemanticTransaction } from "../settlement/publish.js";
import { getWake } from "../wake/ledger.js";
import { resolveOriginProfile } from "../cycle/origin-profile.js";
import { resolveRepairContinuityRecovery } from "../retry/owner-recovery.js";
import { admitOwnerSuppliedClaim, runGovernedAdmissionCatchup } from "../memory/admission.js";
import { admissionTickFromResults, logMemoryAdmission, logMemoryAdmissionError, logMemorySettlement } from "../memory/decision-log.js";
import { recordMemoryRecall, recordMemoryUse } from "../memory/strength.js";
import {
  afterglowPassFromPayload,
  completeAfterglow,
  loadAfterglowRows,
  type AfterglowPass,
} from "../initiative/afterglow.js";
import { awakePassFromPayload, nightPassFromPayload } from "../initiative/inner-pass.js";
import { buildInnerAgenda } from "../initiative/agenda.js";
import { recordSettlementAftermath, type AftermathContext } from "./aftermath.js";
import {
  applySemanticForget,
  expireForgetProposals,
  isOwnerPrivateConversation,
  pendingForgetsForThought,
  type ThoughtPendingForget,
} from "../memory/semantic-forget.js";
import { isUnsolicitedTriggerKind, unsolicitedFuseTripped } from "../initiative/reach-out.js";
import { holdQuietDraft, noteQuietSilentSent, quietPublicationFor, recordQuietRefusal } from "../quiet/window.js";
import { readSenseFacts, senseBandsForDeclines, sensesForThought } from "../senses/senses.js";
import { ownerWeatherForPass } from "../world/weather.js";
import { growthForThought, type IdentityStore } from "../growth/growth.js";
import {
  markOwnerBubbleReactionsShown,
  returningForThought,
  unshownOwnerBubbleReactions,
} from "./owner-surface.js";
import { buildNightAgenda } from "../growth/night.js";
import { DEFAULT_OWNER_TIME_ZONE } from "./clock.js";
import {
  c1V021ProviderBoundBasisFromProjection,
  c1V021SemanticResultHash,
  recordC1V021NativeShadowWitness,
} from "../../memory/shadow-witness.js";
import { hasStructuredCurrentnessEntitlement } from "../authority/check.js";
import {
  buildProviderS5,
  captureThoughtDebug,
  recordDiagnostic,
  recordThoughtCycleMetrics,
} from "./diagnostics.js";
import type { ThoughtProviderFailureCapture } from "./diagnostics.js";
import { metadataFromError } from "../../model-fabric/receipts.js";
import type {
  ModelAttemptReceipt,
  ModelFabricDispatchMetadata,
} from "../../model-fabric/types.js";
import { sha256Text } from "../../model-fabric/hash.js";
import { canonicalObservationView } from "../observation/view.js";
import type {
  ProviderBoundaryControls,
  ProviderBoundaryTiming,
  ProviderBoundaryTransport,
  ProviderResponseDiagnostics,
  WireDispatchEvidence,
} from "../../model-routing/types.js";
import { PROVIDER_BOUNDARY_TRANSPORT_ABSENT } from "../../model-routing/types.js";
import { fidelityCheck } from "../speech/fidelity.js";
import {
  recordInfrastructureFailureDiagnostic,
  makeThoughtTerminal,
  type ThoughtTerminalDescriptor,
} from "../speech/infrastructure-notice.js";
import { renderForTransport } from "../../conversation/rendering.js";
import {
  getThoughtAttemptCounters,
  incrementThoughtAttemptCounter,
  seedThoughtAttemptCountersEffectRounds,
  type ThoughtAttemptCounters,
} from "./counters.js";
import { buildKernelEnvelope } from "./kernel-envelope.js";
import { THOUGHT_OUTPUT_SCHEMA_FINGERPRINT } from "./output-contract.js";
import { captureAuthorityCurrentness, hasAuthorityBarrier } from "../authority/barrier.js";
import {
  getActiveDeferredFrontier,
  resolveDeferredFrontier,
} from "../frontier/ledger.js";
import { getContinuityFor } from "../../continuity/registry.js";
import { concernSnapshotHash } from "../concerns/lineage.js";
import { resolveOwnerObligation } from "../owner-obligation.js";
import {
  persistOrVerifyObservation,
  resolveObservationBinding,
} from "../observation/persistence.js";
import {
  isAutonomousPublicPresenceOpportunity,
  readPublicPresenceContext,
  withPublicPresenceCapability,
} from "../public-presence.js";
import {
  buildExternalDmAuthorityBinding,
  externalDmPrincipalAllowed,
  isExternalDmCognitionEnabled,
  isExternalDmPublicationEnabled,
} from "../social/dm-activation.js";
import {
  buildRoomAuthorityBinding,
  isRoomPublicationEnabled,
  roomIdentity,
  type OwnerRoomDestination,
} from "../social/room-activation.js";
import {
  listAvailableSocialDestinations,
  listOwnerTrustedRoomConversationIds,
  recheckSocialOperationDelegation,
  socialEvidenceSourceForConversation,
  socialOperationClassForOperation,
} from "../../relationship/social-authority.js";
import { defaultQuotaBucket } from "../../attention/ledger.js";
import {
  ResourceFuse,
  resourceFusePolicyFromOwners,
  type OperationalExhaustion,
} from "../social/resource-fuse.js";
import type { QuotaBucket } from "../../model-routing/types.js";

const SOCIAL_RESOURCE_FUSE = new ResourceFuse(
  resourceFusePolicyFromOwners(defaultQuotaBucket() as QuotaBucket),
);
/** Inspection only; provider admission keeps the existing chain, lifecycle and usage checks. */
export function readSocialWakeResourceAvailability(input:Parameters<ResourceFuse["projectWake"]>[0]) {
  return SOCIAL_RESOURCE_FUSE.projectWake(input);
}

export type ThoughtInvocation = {
  output: ThoughtStepOutput;
  semantic?: ThoughtSemanticOutput;
  structuralFeedback?: ThoughtStructuralFeedback;
  correctionScopeViolation?: ThoughtStructuralCorrectionScopeViolation;
  attempts: number;
  requestId: string;
  malformed?: boolean;
  unavailable?: boolean;
  cancelled?: boolean;
  /** True when the dispatch's own absolute deadline fired before any provider response. */
  thoughtDeadline?: boolean;
  deferred?: boolean;
  nextEligibleAtMs?: number;
  kernelEnvelope?: KernelEnvelope;
  /** Provider prompt input tokens, or the shared structural estimate for a fixture. */
  inputTokens?: number;
  /** Bounded provider-boundary evidence for a failed Thought attempt. */
  providerFailureCapture?: ThoughtProviderFailureCapture;
  /** Bounded provider usage for a successful Thought attempt; diagnostic only. */
  providerUsageCapture?: ThoughtProviderFailureCapture;
  /** Physical execution evidence projected from the canonical Model Fabric receipt. */
  thoughtExecutionProvenance?: ThoughtExecutionProvenance;
  /** HA2: set when the pass's own model failed and the lifeboat model was dispatched. */
  lifeboat?: {
    fromModelId: string;
    toModelId: string;
    toEffort: string;
    primaryFailureClass: string;
    primaryDispatchTruth: "sent" | "not_sent" | "unknown";
    primaryAttemptId: string | null;
    primaryProviderAttempts: number | "unknown";
  };
};

type SettlementRevisionFeedback = {
  failureCode: "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN";
  invalidEffectRefs: string[];
  allowedEffectRefs: string[];
};

export type ThoughtCycleTokenMetrics = {
  first_pass_total_input_tokens: number;
  total_cycle_input_tokens_including_retries: number;
  retry_amplification_ratio: number;
  request_count: number;
};

export function createThoughtCycleTokenMetrics(): ThoughtCycleTokenMetrics {
  return {
    first_pass_total_input_tokens: 0,
    total_cycle_input_tokens_including_retries: 0,
    retry_amplification_ratio: 0,
    request_count: 0,
  };
}

/** Pure accumulator so retry accounting cannot mutate an allocation receipt. */
export function observeThoughtCycleInput(
  metrics: ThoughtCycleTokenMetrics,
  inputTokens: number,
): ThoughtCycleTokenMetrics {
  if (!Number.isFinite(inputTokens) || inputTokens < 0) return metrics;
  const first = metrics.request_count === 0
    ? inputTokens
    : metrics.first_pass_total_input_tokens;
  const total = metrics.total_cycle_input_tokens_including_retries + inputTokens;
  return {
    first_pass_total_input_tokens: first,
    total_cycle_input_tokens_including_retries: total,
    retry_amplification_ratio: first > 0 ? total / first : 0,
    request_count: metrics.request_count + 1,
  };
}

export type ThoughtCompleteInvoker = (
  messages: ChatMessage[],
  options: ThoughtCompleteOptions,
) => ReturnType<typeof completeChat>;

/**
 * Caller-owned structural retry output bound. Effective dispatch ceilings and
 * the active route policy remain authoritative in Model Fabric; this bound
 * only keeps a corrective retry admissible under the shared rolling TPM
 * contract.
 */
export const STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS = 65_536;

/** The single adapter boundary for Thought dispatch. attentionDb is mandatory. */
export async function invokeThoughtComplete(
  messages: ChatMessage[],
  options: ThoughtCompleteOptions,
  invoker: ThoughtCompleteInvoker = completeChat,
): ReturnType<typeof completeChat> {
  if (!options.attentionDb) throw new Error("dispatch_data_plane_missing");
  return invoker(messages, options);
}

/** HA2: the least time a lifeboat dispatch needs left before the pass deadline. */
export const THOUGHT_LIFEBOAT_MIN_REMAINING_MS = 20_000;

type ThoughtProviderCaptureStatus = {
  parserStatus: ThoughtProviderFailureCapture["parserStatus"];
  validatorStatus: ThoughtProviderFailureCapture["validatorStatus"];
  failureClass?: string;
  structuralRetryStatus: ThoughtProviderFailureCapture["structuralRetryStatus"];
};

function terminalModelAttempt(
  metadata: ModelFabricDispatchMetadata | null | undefined,
): ModelAttemptReceipt | null {
  const receipt = metadata?.receipt;
  if (!receipt || receipt.receiptStage !== "resolved") return null;
  return receipt.attempts.at(-1) ?? null;
}

const UNKNOWN_EXECUTION_PROVENANCE: ThoughtExecutionProvenance = Object.freeze({
  dispatchTruth: "unknown",
  providerAttempts: "unknown",
});

const NOT_SENT_EXECUTION_PROVENANCE: ThoughtExecutionProvenance = Object.freeze({
  dispatchTruth: "not_sent",
  providerAttempts: 0,
});

export function executionProvenanceFromMetadata(
  metadata: ModelFabricDispatchMetadata | null | undefined,
): ThoughtExecutionProvenance {
  const receipt = metadata?.receipt;
  if (!receipt || receipt.receiptStage !== "resolved" || receipt.attempts.length === 0) {
    return UNKNOWN_EXECUTION_PROVENANCE;
  }
  let providerAttempts = 0;
  let providerAttemptsKnown = true;
  let responseReceived = false;
  let dispatchOutcomeUnknown = false;
  let allNotSent = true;
  for (const attempt of receipt.attempts) {
    if (attempt.providerRequestCount === 0 || attempt.providerRequestCount === 1) {
      providerAttempts += attempt.providerRequestCount;
    } else {
      providerAttemptsKnown = false;
    }
    if (attempt.dispatchTruth === "response_received") responseReceived = true;
    if (attempt.dispatchTruth === "sent_outcome_unknown") dispatchOutcomeUnknown = true;
    if (attempt.dispatchTruth !== "not_sent") allNotSent = false;
  }
  return Object.freeze({
    dispatchTruth: responseReceived
      ? "sent"
      : dispatchOutcomeUnknown
        ? "unknown"
        : allNotSent
          ? "not_sent"
          : "unknown",
    providerAttempts: providerAttemptsKnown ? providerAttempts : "unknown",
  });
}

function executionProvenanceFromDirectCommandCode(
  evidence: NonNullable<Awaited<ReturnType<typeof completeChat>>["commandCodeEvidence"]>,
): ThoughtExecutionProvenance {
  return Object.freeze({
    dispatchTruth: evidence.transportOutcome === "response_received"
      ? "sent"
      : evidence.transportOutcome === "not_sent"
        ? "not_sent"
        : "unknown",
    providerAttempts: evidence.providerAttempts,
  });
}

function executionProvenanceForCompletion(
  completion: Awaited<ReturnType<typeof completeChat>>,
): ThoughtExecutionProvenance {
  return completion.commandCodeEvidence
    ? executionProvenanceFromDirectCommandCode(completion.commandCodeEvidence)
    : executionProvenanceFromMetadata(completion.modelFabric);
}

function withLifeboatAttempts(
  provenance: ThoughtExecutionProvenance,
  lifeboat: ThoughtInvocation["lifeboat"],
): ThoughtExecutionProvenance {
  if (!lifeboat) return provenance;
  const total = typeof provenance.providerAttempts === "number" && typeof lifeboat.primaryProviderAttempts === "number"
    ? provenance.providerAttempts + lifeboat.primaryProviderAttempts
    : "unknown";
  return Object.freeze({ ...provenance, providerAttempts: total });
}

function executionProvenanceForError(
  error: unknown,
  completion?: Awaited<ReturnType<typeof completeChat>>,
): ThoughtExecutionProvenance {
  const directEvidence = commandCodeThoughtEvidenceFromError(error)
    ?? completion?.commandCodeEvidence;
  if (directEvidence) return executionProvenanceFromDirectCommandCode(directEvidence);
  return executionProvenanceFromMetadata(establishedExecutionMetadata(metadataFromError(error), completion));
}

function mergeExecutionProvenance(
  current: ThoughtExecutionProvenance | null,
  next: ThoughtExecutionProvenance,
): ThoughtExecutionProvenance {
  if (!current) return next;
  const dispatchTruth: ThoughtExecutionDispatchTruth = current.dispatchTruth === "sent"
    || next.dispatchTruth === "sent"
    ? "sent"
    : current.dispatchTruth === "unknown" || next.dispatchTruth === "unknown"
      ? "unknown"
      : "not_sent";
  const providerAttempts = current.providerAttempts === "unknown"
    || next.providerAttempts === "unknown"
    ? "unknown"
    : current.providerAttempts + next.providerAttempts;
  return Object.freeze({ dispatchTruth, providerAttempts });
}

function establishedExecutionMetadata(
  errorMetadata: ModelFabricDispatchMetadata | null,
  completion?: Awaited<ReturnType<typeof completeChat>>,
): ModelFabricDispatchMetadata | null {
  const completionMetadata = completion?.modelFabric;
  if (
    completionMetadata?.receipt.receiptStage === "resolved" &&
    completionMetadata.receipt.attempts.length > 0
  ) return completionMetadata;
  return errorMetadata ?? completionMetadata ?? null;
}

function safeFailureClass(value: unknown): string | undefined {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string"
      ? (value as { code: string }).code
      : value instanceof Error && value.name
        ? value.name
        : undefined;
  if (!raw) return undefined;
  const bounded = raw.trim().slice(0, 128);
  return bounded.length > 0 && /^[A-Za-z0-9_.:-]+$/.test(bounded)
    ? bounded
    : "sanitized_failure";
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Default affinity-transport truth when no provider-boundary observation is
 * available: affinity was not applied on this attempt. The observed fact —
 * minted by the Cloudflare adapter when it constructs the provider fetch —
 * overrides this via completion or Model Fabric metadata. The raw affinity
 * identifier never reaches this layer; only the applied/policy truth does.
 * Cache state stays infrastructure: these fields never influence Thought
 * semantics, retry policy, or fallback policy.
 */

/**
 * Bounded abort reason for the failure capture. AppError code "timeout" is
 * minted only by the dispatch deadline branch, so it carries TimeoutError
 * provenance without retaining exception prose.
 */
function abortReasonNameFor(error: unknown): "TimeoutError" | "AbortError" | "none" {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "timeout") return "TimeoutError";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return error.name;
  }
  return "none";
}

function providerFailureCapture(input: {
  metadata?: ModelFabricDispatchMetadata | null;
  completion?: Awaited<ReturnType<typeof completeChat>>;
  controls?: ProviderBoundaryControls;
  timing?: ProviderBoundaryTiming;
  /** Observed affinity-transport truth override; completion/metadata win when set. */
  transport?: ProviderBoundaryTransport;
  /** Raw dispatch error; only its bounded abort class is retained, never prose. */
  error?: unknown;
  options: {
    deadlineAtMs?: number | null;
    maxTokens?: number;
    temperature?: number;
    structuredOutput?: { schemaFingerprint?: string };
  };
  dispatchTruth: ThoughtProviderFailureCapture["dispatchTruth"];
  status: ThoughtProviderCaptureStatus;
}): ThoughtProviderFailureCapture {
  const metadata = input.metadata ?? input.completion?.modelFabric ?? null;
  const attempt = terminalModelAttempt(metadata);
  const directEvidence = input.completion?.commandCodeEvidence
    ?? commandCodeThoughtEvidenceFromError(input.error);
  const providerHttpStatus = attempt?.receiptStage === "provider_response"
    ? attempt.providerHttpStatus
    : directEvidence?.providerHttpStatus ?? undefined;
  const canonicalUsage = attempt?.receiptStage === "provider_response"
    ? attempt.usage
    : undefined;
  const completion = input.completion;
  const controls = input.controls
    ?? completion?.providerBoundaryControls
    ?? metadata?.providerBoundaryControls;
  const timing = input.timing
    ?? completion?.providerBoundaryTiming
    ?? metadata?.providerBoundaryTiming;
  const transport = input.transport
    ?? completion?.providerBoundaryTransport
    ?? metadata?.providerBoundaryTransport
    ?? PROVIDER_BOUNDARY_TRANSPORT_ABSENT;
  const wireEvidence: WireDispatchEvidence | undefined = completion?.wireEvidence
    ?? metadata?.wireEvidence
    ?? attempt?.wireEvidence
    ?? undefined;
  const responseDiagnostics: ProviderResponseDiagnostics | undefined =
    completion?.responseDiagnostics;
  const capturedAttempt = completion?.capturedAttemptIdentity;
  const provider = attempt?.provider
    ?? metadata?.resolvedRoute?.provider
    ?? (directEvidence?.backend === "command_code_api"
      ? "command_code"
      : capturedAttempt?.provider);
  const capturedModelId = capturedAttempt
    ? ("requestedModelId" in capturedAttempt
        ? capturedAttempt.requestedModelId
        : capturedAttempt.configuredModelId)
    : undefined;
  const model = attempt?.configuredModelId
    ?? directEvidence?.requestedModelId
    ?? capturedModelId
    ?? completion?.modelAlias;
  const providerModel = completion?.providerModel ?? directEvidence?.providerModel ?? undefined;
  // P3 S5: provider request identity + cache/usage truth. Missing numeric
  // evidence stays absent (UNKNOWN downstream) — never coerced (no Number()
  // wrapping: Number(null) === 0 would launder missingness into observed
  // zero). cachedSource marks WHERE the cached count was observed.
  const providerRequestId = typeof completion?.providerRequestId === "string" && completion.providerRequestId
    ? completion.providerRequestId
    : typeof directEvidence?.providerRequestId === "string" && directEvidence.providerRequestId
      ? directEvidence.providerRequestId
    : typeof (attempt as { providerRequestId?: unknown } | undefined)?.providerRequestId === "string"
      && (attempt as { providerRequestId: string }).providerRequestId
      ? (attempt as { providerRequestId: string }).providerRequestId
    : undefined;
  const cfRay = typeof completion?.cfRay === "string" && completion.cfRay.trim()
    ? completion.cfRay.trim().slice(0, 64)
    : undefined;
  const observedTotalTokens = completion?.usage?.totalTokens
    ?? canonicalUsage?.totalTokens;
  const totalTokens = typeof observedTotalTokens === "number" && Number.isFinite(observedTotalTokens)
    ? observedTotalTokens
    : undefined;
  const completionCachedTokens = finiteNonNegative(completion?.usage?.cachedTokens);
  const canonicalCachedTokens = canonicalUsage?.cachedInputTokens !== null
    && canonicalUsage?.cachedInputTokens !== undefined
    && Number.isFinite(canonicalUsage.cachedInputTokens)
    && canonicalUsage.cachedInputTokens >= 0
    ? canonicalUsage.cachedInputTokens
    : undefined;
  const cachedInputTokens = completionCachedTokens ?? canonicalCachedTokens;
  const cachedSource = cachedInputTokens !== undefined ? "provider_usage" : undefined;
  const receipt = metadata?.receipt;
  const attentionRequestId = completion?.attentionRequestId
    ?? (receipt && receipt.attentionRequestId !== null ? receipt.attentionRequestId : undefined);
  const canonicalSchemaFingerprint = capturedAttempt?.semanticSchemaFingerprint
    ?? THOUGHT_OUTPUT_SCHEMA_FINGERPRINT;
  const wireSchemaFingerprint = capturedAttempt?.wireSchemaFingerprint
    ?? attempt?.structuredOutputSchemaFingerprint
    ?? input.options.structuredOutput?.schemaFingerprint;
  const reasoningConfiguration = controls?.reasoningConfiguration
    ?? directEvidence?.reasoningEffort
    ?? attempt?.effectiveReasoningSent
    ?? attempt?.translatedWireControl
    ?? attempt?.effectiveReasoning
    ?? undefined;
  const maxTokens = controls?.maxTokens
    ?? responseDiagnostics?.outputTokenLimit
    ?? input.options.maxTokens;
  const deadlineAtMs = controls?.deadlineAtMs ?? input.options.deadlineAtMs;
  const capture: ThoughtProviderFailureCapture = {
    dispatchTruth: input.dispatchTruth,
    parserStatus: input.status.parserStatus,
    validatorStatus: input.status.validatorStatus,
    structuralRetryStatus: input.status.structuralRetryStatus,
    ...(provider ? { provider: String(provider) } : {}),
    ...(model ? { model: String(model) } : {}),
    ...(providerModel ? { providerModel: String(providerModel) } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(cfRay ? { cfRay } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedSource ? { cachedSource } : {}),
    ...(attempt?.invocationId
      ? { modelFabricInvocationId: attempt.invocationId }
      : capturedAttempt && "modelFabricInvocationId" in capturedAttempt && capturedAttempt.modelFabricInvocationId
        ? { modelFabricInvocationId: capturedAttempt.modelFabricInvocationId }
      : receipt?.invocationId
        ? { modelFabricInvocationId: receipt.invocationId }
        : {}),
    ...(attempt?.attemptId
      ? { modelFabricAttemptId: attempt.attemptId }
      : capturedAttempt && "modelFabricAttemptId" in capturedAttempt && capturedAttempt.modelFabricAttemptId
        ? { modelFabricAttemptId: capturedAttempt.modelFabricAttemptId }
        : {}),
    ...(directEvidence ? {
      backend: directEvidence.backend,
      providerInvocationId: directEvidence.providerInvocationId,
      providerAttemptId: directEvidence.providerAttemptId,
      ...(directEvidence.requestHash ? { requestHash: directEvidence.requestHash } : {}),
      ...(directEvidence.responseHash ? { responseHash: directEvidence.responseHash } : {}),
      providerAttemptCount: directEvidence.providerAttempts,
      alternateProviderAttempts: directEvidence.alternateProviderAttempts,
      transportOutcome: directEvidence.transportOutcome,
    } : {}),
    ...(attempt?.attemptOrdinal !== undefined
      ? { attemptOrdinal: attempt.attemptOrdinal }
      : capturedAttempt?.attemptOrdinal !== undefined
        ? { attemptOrdinal: capturedAttempt.attemptOrdinal }
        : {}),
    ...(capturedAttempt?.dispatchSequence !== undefined
      ? { dispatchSequence: capturedAttempt.dispatchSequence }
      : {}),
    ...(typeof attentionRequestId === "number" ? { attentionRequestId } : {}),
    ...(canonicalSchemaFingerprint ? { canonicalSchemaFingerprint } : {}),
    ...(wireSchemaFingerprint ? { wireSchemaFingerprint } : {}),
    ...(wireEvidence?.bindingId ? { wireBindingId: wireEvidence.bindingId } : {}),
    ...(wireEvidence?.wireFormat ? { wireFormat: wireEvidence.wireFormat } : {}),
    ...(wireEvidence?.sanitizedBodyDigest
      ? { wireBodyDigest: wireEvidence.sanitizedBodyDigest }
      : {}),
    ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    ...(reasoningConfiguration ? { reasoningConfiguration } : {}),
    ...(typeof controls?.reasoningBudgetTokens === "number"
      ? { reasoningBudgetTokens: controls.reasoningBudgetTokens }
      : {}),
    ...(typeof (controls?.temperature ?? input.options.temperature) === "number"
      ? { temperature: controls?.temperature ?? input.options.temperature }
      : {}),
    ...(typeof controls?.topP === "number" ? { topP: controls.topP } : {}),
    ...(typeof deadlineAtMs === "number" ? { deadlineAtMs } : {}),
    ...(timing?.requestStartedAtMs !== undefined
      ? { requestStartedAtMs: timing.requestStartedAtMs }
      : {}),
    ...(timing?.responseAtMs !== undefined ? { responseAtMs: timing.responseAtMs } : {}),
    ...(timing?.elapsedMs !== undefined ? { elapsedMs: timing.elapsedMs } : {}),
    ...(timing?.remainingDeadlineMs !== undefined
      ? { remainingDeadlineMs: timing.remainingDeadlineMs }
      : {}),
    ...(responseDiagnostics?.finishReason ?? completion?.finishReason
      ? { finishReason: responseDiagnostics?.finishReason ?? completion?.finishReason! }
      : {}),
    ...(finiteNonNegative(completion?.usage?.promptTokens) !== undefined
      ? { inputTokens: finiteNonNegative(completion?.usage?.promptTokens) }
      : {}),
    ...(finiteNonNegative(completion?.usage?.completionTokens) !== undefined
      ? { completionTokens: finiteNonNegative(completion?.usage?.completionTokens) }
      : {}),
    ...(finiteNonNegative(responseDiagnostics?.requestWireBytes) !== undefined
      ? { requestWireBytes: finiteNonNegative(responseDiagnostics?.requestWireBytes) }
      : {}),
    ...(finiteNonNegative(responseDiagnostics?.requestWireAdditionalBytes) !== undefined
      ? { requestWireAdditionalBytes: finiteNonNegative(responseDiagnostics?.requestWireAdditionalBytes) }
      : {}),
    ...(providerHttpStatus !== undefined ? { providerHttpStatus } : {}),
    ...(canonicalUsage?.reasoningTokens !== null
      && canonicalUsage?.reasoningTokens !== undefined
      ? { reasoningTokens: canonicalUsage.reasoningTokens }
      : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(canonicalUsage?.neuronUsage !== null
      && canonicalUsage?.neuronUsage !== undefined
      ? { neuronUsage: canonicalUsage.neuronUsage }
      : {}),
    ...(responseDiagnostics?.finalTextBytes !== undefined
      ? { contentBytes: responseDiagnostics.finalTextBytes }
      : completion && typeof completion.text === "string"
        ? { contentBytes: Buffer.byteLength(completion.text, "utf8") }
        : {}),
    ...(responseDiagnostics?.reasoningContentBytes !== undefined
      ? { reasoningContentBytes: responseDiagnostics.reasoningContentBytes }
      : {}),
    ...(responseDiagnostics?.reasoningHash
      ? { reasoningHash: responseDiagnostics.reasoningHash }
      : {}),
    ...(completion && typeof completion.text === "string"
      ? { contentHash: `sha256:${sha256Text(completion.text)}` }
      : {}),
    ...(input.status.failureClass ? { failureClass: input.status.failureClass } : {}),
    // Completion-built captures answered, so they never lack a response.
    // Error-built captures record whether any provider HTTP response arrived.
    ...(input.error !== undefined
      ? {
          abortReasonName: abortReasonNameFor(input.error),
          noHttpResponse: providerHttpStatus === undefined,
        }
      : { abortReasonName: "none" as const, noHttpResponse: false }),
    ...{
      sessionAffinityApplied: transport.sessionAffinityApplied,
      affinityPolicy: transport.affinityPolicy,
    },
  };
  return capture;
}

function providerFailureCaptureForCompletion(
  completion: Awaited<ReturnType<typeof completeChat>>,
  options: ThoughtCompleteOptions,
  status: ThoughtProviderCaptureStatus,
): ThoughtProviderFailureCapture {
  const dispatchTruth: ThoughtProviderFailureCapture["dispatchTruth"] =
    executionProvenanceForCompletion(completion).dispatchTruth;
  return providerFailureCapture({
    completion,
    options,
    dispatchTruth,
    status,
  });
}

function providerFailureCaptureForError(
  error: unknown,
  options: ThoughtCompleteOptions,
  completion?: Awaited<ReturnType<typeof completeChat>>,
  dispatchStarted = true,
): ThoughtProviderFailureCapture {
  const errorMetadata = metadataFromError(error);
  const metadata = establishedExecutionMetadata(errorMetadata, completion);
  const dispatchTruth = !dispatchStarted && !completion
    ? NOT_SENT_EXECUTION_PROVENANCE.dispatchTruth
    : executionProvenanceForError(error, completion).dispatchTruth;
  return providerFailureCapture({
    metadata,
    completion,
    options,
    dispatchTruth,
    error,
    status: {
      parserStatus: "not_run",
      validatorStatus: "not_run",
      failureClass: commandCodeThoughtEvidenceFromError(error)?.failureClass
        ?? metadata?.failure?.sanitizedCauseClass
        ?? safeFailureClass(error),
      structuralRetryStatus: "not_applicable",
    },
  });
}

type LocalAliasTarget = "working_context" | "desk" | "concern";
type LocalAliasBinding = { id: string; target: LocalAliasTarget };

type ThoughtMaterializationFailureCode = Extract<
  ThoughtParserFailureCode,
  "alias_duplicate" | "dangling_local_reference" | "reference_target_type_mismatch" | "future_trigger_snapshot_unavailable"
>;

class ThoughtMaterializationError extends Error {
  readonly code: ThoughtMaterializationFailureCode;
  readonly field: string;

  constructor(code: ThoughtMaterializationFailureCode, field: string) {
    super(code);
    this.name = "ThoughtMaterializationError";
    this.code = code;
    this.field = field;
  }
}

/** Only a provider that could not answer launches the lifeboat; never a timeout, a cancel or a bad request. */
export function lifeboatQualifies(error: unknown): boolean {
  if (error instanceof ThoughtMaterializationError) return false;
  const code = (error as { code?: unknown } | null)?.code;
  return code === "provider_unavailable" || code === "rate_limited";
}

function materializationFailure(
  code: ThoughtMaterializationFailureCode,
  field: string,
): never {
  throw new ThoughtMaterializationError(code, field);
}

function materializeExistingReference(
  value: string,
  referenceAllowlist: ThoughtReferenceAllowlist,
  expectedTarget: ThoughtReferenceTarget,
  field: string,
): string {
  if (!hasReferenceTarget(referenceAllowlist, value, expectedTarget)) {
    return materializationFailure("reference_target_type_mismatch", field);
  }
  return value;
}

function semanticReferenceValue(
  value: SemanticRef | string | null,
  localAliases: Map<string, LocalAliasBinding>,
  referenceAllowlist: ThoughtReferenceAllowlist,
  expectedTarget?: ThoughtReferenceTarget,
  field = "reference",
): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return expectedTarget
      ? materializeExistingReference(value, referenceAllowlist, expectedTarget, field)
      : value;
  }
  if (value.kind === "existing") {
    return expectedTarget
      ? materializeExistingReference(value.ref, referenceAllowlist, expectedTarget, field)
      : value.ref;
  }
  const binding = localAliases.get(value.alias);
  if (!binding) return materializationFailure("dangling_local_reference", field);
  if (expectedTarget && binding.target !== expectedTarget) {
    return materializationFailure("reference_target_type_mismatch", field);
  }
  return binding.id;
}

export function materializeEffectsCompleted(
  inFlight: readonly InFlightRecord[] | readonly ProjectedInFlightRecord[],
  receiptsByEffectId?: Readonly<Record<string, EffectReceipt>>,
): string[] {
  if (!receiptsByEffectId) return [];
  const completed: string[] = [];
  for (const item of inFlight) {
    if ("effectId" in item && typeof item.effectId === "string") {
      const receipt = receiptsByEffectId[item.effectId];
      if (receipt && (receipt.outcome === "succeeded" || receipt.outcome === "failed")) {
        completed.push(item.effectId);
      }
    } else {
      for (const [id, receipt] of Object.entries(receiptsByEffectId)) {
        if (receipt && (receipt.outcome === "succeeded" || receipt.outcome === "failed") && !completed.includes(id)) {
          completed.push(id);
        }
      }
    }
  }
  return completed;
}

function materializeSemanticSettlement(
  semantic: Extract<ThoughtSemanticOutput, { kind: "settlement" }>,
  input: ThoughtInput | ProjectedThoughtInput,
  receiptsByEffectId?: Readonly<Record<string, EffectReceipt>>,
  sawSecret = true,
): ThoughtSettlementDraft {
  // Local semantic aliases are resolved to ordinary durable IDs in this
  // kernel projection. The aliases themselves never become a lookup namespace.
  const localAliases = new Map<string, LocalAliasBinding>();
  const conversationId = input.sourceCurrentness?.conversationId
    ?? input.rawConversation[0]?.conversationId
    ?? input.occupancy[0]?.conversationId
    ?? input.cycleId;
  // Register declaration identities before resolving cross-domain references.
  // The parser rejects aliases colliding with existing references. This
  // materializer pass owns duplicate registration and Host-minted IDs.
  const referenceAllowlist = buildReferenceAllowlist(
    semanticReferencesForInput(input),
    semanticReferenceTargetsForInput(input),
  );
  const register = (alias: string, target: LocalAliasTarget, field: string): void => {
    try {
      registerLocalAlias(referenceAllowlist, alias);
    } catch (error) {
      if (error instanceof Error && error.message === "alias_duplicate") {
        return materializationFailure("alias_duplicate", field);
      }
      throw error;
    }
    localAliases.set(alias, { id: randomUUID(), target });
  };
  for (const [index, delta] of (semantic.workingContextDeltas ?? []).entries()) {
    if (delta.op === "upsert" && delta.item.identity.kind === "local") {
      register(delta.item.identity.alias, "working_context", `workingContextDeltas[${index}].item.identity`);
    }
    if (delta.op === "supersede" && delta.replacement.identity.kind === "local") {
      register(delta.replacement.identity.alias, "working_context", `workingContextDeltas[${index}].replacement.identity`);
    }
  }
  for (const [index, delta] of (semantic.deskDeltas ?? []).entries()) {
    if (delta.op === "upsert" && delta.entry.identity.kind === "local") {
      register(delta.entry.identity.alias, "desk", `deskDeltas[${index}].entry.identity`);
    }
    if (delta.op === "supersede" && delta.replacement.identity.kind === "local") {
      register(delta.replacement.identity.alias, "desk", `deskDeltas[${index}].replacement.identity`);
    }
  }
  for (const [index, delta] of (semantic.concernDeltas ?? []).entries()) {
    if (delta.op === "upsert" && delta.record.identity.kind === "local") {
      register(delta.record.identity.alias, "concern", `concernDeltas[${index}].record.identity`);
    }
  }

  // Concern snapshots are Host-owned lineage evidence. For a concern changed
  // in this same settlement, compute the resulting hash from the exact
  // materialized record so a co-authored future trigger can bind atomically.
  const authoredConcernSnapshots = new Map<string, string>();
  for (const [index, delta] of (semantic.concernDeltas ?? []).entries()) {
    if (delta.op !== "upsert") continue;
    const concernId = semanticReferenceValue(
      delta.record.identity,
      localAliases,
      referenceAllowlist,
      "concern",
      `concernDeltas[${index}].record.identity`,
    );
    if (!concernId) continue;
    authoredConcernSnapshots.set(concernId, concernSnapshotHash({
      concernId,
      conversationId,
      statement: delta.record.statement,
      sourceTurnIds: [...delta.record.sourceTurnRefs],
      ...(delta.record.supportRefs ? { supportRefs: [...delta.record.supportRefs] } : {}),
      dimensions: { ...delta.record.dimensions },
      assertionKey: null,
      status: delta.record.status,
      ...(delta.record.objective ? { objective: delta.record.objective } : {}),
    }));
  }

  const result: Record<string, unknown> = {
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    cycleId: input.cycleId,
    generation: input.generation,
    authorityEpoch: input.authorityEpoch,
    occupantId: input.occupantId,
    architectureEpoch: "v0.2.1",
    triggerRef: input.trigger.ref,
    ...(semantic.interactionIntent ? { interactionIntent: semantic.interactionIntent } : {}),
    ...(semantic.initiativePreference
      ? {
        initiativePreference: {
          stance: semantic.initiativePreference.stance,
          reason: semantic.initiativePreference.reason,
        },
      }
      : {}),
    speech: {
      mode: semantic.speech.mode,
      surfaceDraft: semantic.speech.mode === "draft" ? semantic.speech.surfaceDraft : null,
      ...(semantic.speech.mode === "draft" && semantic.speech.mustSay ? { mustSay: [...semantic.speech.mustSay] } : {}),
      ...(semantic.speech.mode === "draft" && semantic.speech.mustNotSay ? { mustNot: [...semantic.speech.mustNotSay] } : {}),
      ...(semantic.speech.mode === "draft" && semantic.speech.presentationDirectives
        ? { presentationDirectives: [...semantic.speech.presentationDirectives] }
        : {}),
    },
    // These fields are internal mechanical bookkeeping. They remain present
    // even when the semantic evidenceUse domain is absent.
    operations: {
      observationsConsumed: semantic.evidenceUse?.observationRefsUsed?.map((ref, index) =>
        materializeExistingReference(
          ref,
          referenceAllowlist,
          "observation",
          `evidenceUse.observationRefsUsed[${index}]`,
        ),
      ) ?? [],
      ...(semantic.evidenceUse?.retrievalRefsUsed
        ? { retrievalRefsUsed: [...semantic.evidenceUse.retrievalRefsUsed] }
        : {}),
      ...(semantic.evidenceUse?.sourceRefsUsed
        ? { sourceRefsUsed: [...semantic.evidenceUse.sourceRefsUsed] }
        : {}),
      effectsCompleted: materializeEffectsCompleted(input.inFlight, receiptsByEffectId),
      intentsStillInFlight: [...(semantic.evidenceUse?.openIntentRefs ?? [])],
    },
    authority: { objectionsApplied: [], revisionCount: 0 },
  };

  if (semantic.interpretation) {
    const interpretation = semantic.interpretation;
    result.interpretation = {
      ...(interpretation.discourseActs ? { discourseActs: [...interpretation.discourseActs] } : {}),
      ...(interpretation.referentBindings ? { referentBindings: interpretation.referentBindings.map((binding, index) => ({
        span: binding.span,
        ...(binding.concernRef ? {
          concernId: semanticReferenceValue(
            binding.concernRef,
            localAliases,
            referenceAllowlist,
            "concern",
            `interpretation.referentBindings[${index}].concernRef`,
          ),
        } : {}),
        ...(binding.entityRef ? {
          entityKey: semanticReferenceValue(
            binding.entityRef,
            localAliases,
            referenceAllowlist,
            undefined,
            `interpretation.referentBindings[${index}].entityRef`,
          ),
        } : {}),
        sourceTurnIds: [...binding.sourceTurnRefs],
      })) } : {}),
      ...(interpretation.corrections ? { corrections: interpretation.corrections.map((correction, index) => ({
        correctedTurnIds: [...correction.correctedTurnRefs],
        fromSpan: correction.fromSpan,
        toSpan: correction.toSpan,
        ...(correction.concernRef ? {
          concernId: semanticReferenceValue(
            correction.concernRef,
            localAliases,
            referenceAllowlist,
            "concern",
            `interpretation.corrections[${index}].concernRef`,
          ),
        } : {}),
      })) } : {}),
      ...(interpretation.unresolvedAmbiguities ? { unresolvedAmbiguities: [...interpretation.unresolvedAmbiguities] } : {}),
      ...(interpretation.topics ? { topics: [...interpretation.topics] } : {}),
    };
  }

  if (semantic.commitments) {
    const commitments = semantic.commitments;
    result.commitments = {
      ...(commitments.epistemic ? { epistemic: commitments.epistemic.map((item) => ({ ...item })) } : {}),
      ...(commitments.operational ? { operational: commitments.operational.map((item) => ({
        effectRef: String(item.effectRef),
        claimedState: item.claimedState,
      })) } : {}),
      ...(commitments.conversational ? { conversational: [...commitments.conversational] } : {}),
      ...(commitments.commitmentProposals ? { commitmentProposals: commitments.commitmentProposals.map((proposal) => ({
        ordinal: proposal.ordinal,
        action: proposal.action,
        beneficiary: proposal.beneficiary,
        destination: { ...proposal.destination },
        temporal: { ...proposal.temporal },
        ...(proposal.timezoneId === undefined ? {} : { timezoneId: proposal.timezoneId }),
        ...(proposal.requiredPrecisionMs === undefined ? {} : { requiredPrecisionMs: proposal.requiredPrecisionMs }),
        ...(proposal.lateBehavior === undefined ? {} : { lateBehavior: proposal.lateBehavior }),
        ...(proposal.latestUsefulAtMs === undefined ? {} : { latestUsefulAtMs: proposal.latestUsefulAtMs }),
        realizationClause: proposal.realizationClause,
        thoughtCycle: { ...proposal.thoughtCycle },
      })) } : {}),
      ...(commitments.stance ? { stance: { ...commitments.stance } } : {}),
    };
  }

  if (semantic.workingContextDeltas) result.workingContextDelta = semantic.workingContextDeltas.map((delta, index) => {
      if (delta.op === "abandon") {
        return {
          op: "abandon",
          id: materializeExistingReference(
            delta.target,
            referenceAllowlist,
            "working_context",
            `workingContextDeltas[${index}].target`,
          ),
        };
      }
      const item = delta.op === "upsert" ? delta.item : delta.replacement;
      const legacyItem = {
        id: semanticReferenceValue(
          item.identity,
          localAliases,
          referenceAllowlist,
          "working_context",
          `workingContextDeltas[${index}].${delta.op === "upsert" ? "item" : "replacement"}.identity`,
        ) ?? randomUUID(),
        conversationId,
        type: item.type,
        text: item.text,
        concernId: semanticReferenceValue(
          item.concernRef,
          localAliases,
          referenceAllowlist,
          "concern",
          `workingContextDeltas[${index}].${delta.op === "upsert" ? "item" : "replacement"}.concernRef`,
        ),
        sourceTurnIds: [...item.sourceTurnRefs],
        status: item.status,
        supersedesId: semanticReferenceValue(
          item.supersedesRef,
          localAliases,
          referenceAllowlist,
          "working_context",
          `workingContextDeltas[${index}].${delta.op === "upsert" ? "item" : "replacement"}.supersedesRef`,
        ),
        ...(item.interpretationEnvelope === undefined ? {} : { interpretationEnvelope: item.interpretationEnvelope }),
      };
      return delta.op === "upsert"
        ? { op: "upsert", item: legacyItem }
        : {
            op: "supersede",
            id: materializeExistingReference(
              delta.target,
              referenceAllowlist,
              "working_context",
              `workingContextDeltas[${index}].target`,
            ),
            replacement: legacyItem,
          };
    });
  if (semantic.deskDeltas) result.deskDeltas = semantic.deskDeltas.map((delta, index) => {
    if (delta.op === "archive" || delta.op === "tombstone") {
      return {
        op: delta.op,
        id: materializeExistingReference(
          delta.target,
          referenceAllowlist,
          "desk",
          `deskDeltas[${index}].target`,
        ),
      };
    }
    const entry = delta.op === "upsert" ? delta.entry : delta.replacement;
    const materializedEntry = {
      id: semanticReferenceValue(
        entry.identity,
        localAliases,
        referenceAllowlist,
        "desk",
        `deskDeltas[${index}].${delta.op === "upsert" ? "entry" : "replacement"}.identity`,
      ) ?? randomUUID(),
      concernRef: semanticReferenceValue(
        entry.concernRef,
        localAliases,
        referenceAllowlist,
        "concern",
        `deskDeltas[${index}].${delta.op === "upsert" ? "entry" : "replacement"}.concernRef`,
      ),
      body: entry.body,
      authorKind: entry.authorKind,
      sourceRefs: [...entry.sourceRefs],
      ...(entry.supportRefs ? { supportRefs: [...entry.supportRefs] } : {}),
      verbatim: entry.verbatim,
      form: entry.form,
      endorsementRef: semanticReferenceValue(
        entry.endorsementRef,
        localAliases,
        referenceAllowlist,
        undefined,
        `deskDeltas[${index}].${delta.op === "upsert" ? "entry" : "replacement"}.endorsementRef`,
      ),
      audienceScope: { ...entry.audienceScope },
    };
    return delta.op === "upsert"
      ? { op: "upsert", entry: materializedEntry }
      : {
          op: "supersede",
          id: materializeExistingReference(delta.target, referenceAllowlist, "desk", `deskDeltas[${index}].target`),
          replacement: materializedEntry,
        };
  });
  if (semantic.concernDeltas) result.concernDeltas = semantic.concernDeltas.map((delta, index) => delta.op === "resolve"
      ? {
          op: "resolve",
          concernId: materializeExistingReference(
            delta.target,
            referenceAllowlist,
            "concern",
            `concernDeltas[${index}].target`,
          ),
        }
      : {
          op: "upsert",
          record: {
          concernId: semanticReferenceValue(
            delta.record.identity,
            localAliases,
            referenceAllowlist,
            "concern",
            `concernDeltas[${index}].record.identity`,
          ) ?? randomUUID(),
            conversationId,
            statement: delta.record.statement,
            sourceTurnIds: [...delta.record.sourceTurnRefs],
            ...(delta.record.supportRefs ? { supportRefs: [...delta.record.supportRefs] } : {}),
            dimensions: { ...delta.record.dimensions },
            assertionKey: null,
            status: delta.record.status,
            ...(delta.record.objective ? { objective: delta.record.objective } : {}),
          },
        });
  if (semantic.occupancyDeltas) result.occupancyDelta = semantic.occupancyDeltas.map((delta, index) => ({
      op: "set",
      occupancy: {
        conversationId,
        concernId: semanticReferenceValue(
          delta.concernRef,
          localAliases,
          referenceAllowlist,
          "concern",
          `occupancyDeltas[${index}].concernRef`,
        ) ?? randomUUID(),
        status: delta.status,
        priority: delta.priority,
        updatedGeneration: input.generation,
      },
    }));
  if (semantic.futureTriggerDeltas) result.futureTriggers = semantic.futureTriggerDeltas.map((delta, index) => delta.op === "cancel"
      ? { op: "cancel", triggerId: delta.target }
      : (() => {
          const concernId = semanticReferenceValue(
            delta.concernRef,
            localAliases,
            referenceAllowlist,
            "concern",
            `futureTriggerDeltas[${index}].concernRef`,
          );
          if (!concernId) {
            return materializationFailure(
              "future_trigger_snapshot_unavailable",
              `futureTriggerDeltas[${index}].concernRef`,
            );
          }
          const snapshotHash = authoredConcernSnapshots.get(concernId)
            ?? input.concernSnapshots?.[concernId];
          if (!snapshotHash) {
            return materializationFailure(
              "future_trigger_snapshot_unavailable",
              `futureTriggerDeltas[${index}].concernRef`,
            );
          }
          const payload = { purpose: delta.purpose, ...delta.payload };
          const rawEvidenceRefs = (payload as Record<string, unknown>).evidenceRefs;
          const rawTimingPolicy = (payload as Record<string, unknown>).timingPolicyId;
          return {
            op: "create" as const,
            trigger: {
              triggerId: randomUUID(),
              conversationId,
              concernId,
              snapshotHash,
              dueAtMs: delta.dueAtMs,
              ...(normalizeFutureTriggerEvidenceRefs(rawEvidenceRefs).length > 0
                ? { evidenceRefs: normalizeFutureTriggerEvidenceRefs(rawEvidenceRefs) }
                : {}),
              ...(normalizeFutureTriggerTimingPolicy(rawTimingPolicy) !== null
                ? { timingPolicyId: normalizeFutureTriggerTimingPolicy(rawTimingPolicy) }
                : {}),
              payload,
            },
          };
        })());
  if (semantic.subscriptionDeltas) result.subscriptions = semantic.subscriptionDeltas.map((delta, index) => delta.op === "cancel"
      ? { op: "cancel", subscriptionId: delta.target }
      : {
          op: "create",
          authority: "thought_adoption" as const,
          subscription: {
            subscriptionId: randomUUID(),
            conversationId,
            concernId: semanticReferenceValue(
              delta.subscription.concernRef,
              localAliases,
              referenceAllowlist,
              "concern",
              `subscriptionDeltas[${index}].subscription.concernRef`,
            ),
            source: delta.subscription.source,
            scope: delta.subscription.scope,
            topicKeys: [...delta.subscription.topicKeys],
            match: delta.subscription.match,
            expiresAtMs: delta.subscription.expiresAtMs,
            ...(delta.subscription.externalSource ? {
              externalSource: { ...delta.subscription.externalSource },
              pollIntervalMs: delta.subscription.pollIntervalMs,
            } : {}),
          },
        });
  if (semantic.durableNominations) result.durableNominations = semantic.durableNominations.map((nomination, index) => ({
      nominationId: randomUUID(),
      cycleId: input.cycleId,
      generation: input.generation,
      assertionKey: randomUUID(),
      statement: nomination.statement,
      memoryKind: nomination.memoryKind,
      dimensions: { ...nomination.dimensions },
      dataClassification: nomination.dataClassification,
      supersedesAssertionKey: nomination.supersedesRef,
      concernId: semanticReferenceValue(
        nomination.concernRef,
        localAliases,
        referenceAllowlist,
        "concern",
        `durableNominations[${index}].concernRef`,
      ),
      sourceRefs: [...nomination.sourceRefs],
      ...(nomination.supportRefs ? { supportRefs: [...nomination.supportRefs] } : {}),
      ...(nomination.salience === undefined ? {} : { salience: nomination.salience }),
    }));
  if (semantic.reflection) result.reflection = semantic.reflection;
  if (semantic.journal) result.journal = { ...semantic.journal };
  if (semantic.domusAct) result.domusAct = { ...semantic.domusAct };
  if (semantic.intents) result.intents = semantic.intents.map((intent) => ({ ...intent }));
  if (semantic.home) result.home = semantic.home.map((op) => ({ ...op }));
  if (semantic.pursuits) result.pursuits = structuredClone(semantic.pursuits) as typeof result.pursuits;
  if (semantic.nextOwnTime) result.nextOwnTime = { ...semantic.nextOwnTime };
  if (semantic.webPlaces) result.webPlaces = semantic.webPlaces.map((claim) => ({ ...claim }));
  if (semantic.placeRules) result.placeRules = semantic.placeRules.map((claim) => ({ ...claim }));
  if (semantic.contactStop) result.contactStop = semantic.contactStop;
  if (semantic.learned) result.learned = semantic.learned.map((claim) => ({ ...claim }));
  if (semantic.interests) result.interests = semantic.interests.map((touch) => ({ ...touch }));
  (result as ThoughtSettlementDraft).sawSecret = sawSecret;
  if (semantic.growth) result.growth = structuredClone(semantic.growth);
  if (semantic.senses) result.senses = structuredClone(semantic.senses);
  if (semantic.attention) result.attention = structuredClone(semantic.attention);
  if (semantic.night) result.night = structuredClone(semantic.night);
  if (semantic.forget) result.forget = structuredClone(semantic.forget);
  return result as ThoughtSettlementDraft;
}

/**
 * Bounded ordinary write-target window captured with this pass. It is
 * allowlist membership, not inspection authority: an inspect-only ref still
 * satisfies no `existingRef` unless it is separately authorable here or via
 * occupancy/Working Context.
 */
function concernAuthorableTargetIdsForInput(
  input: ThoughtInput | ProjectedThoughtInput,
): string[] {
  const captured = input.sourceCurrentness?.concernAuthorableTargetIds;
  return Array.isArray(captured)
    ? captured.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
}

function semanticReferencesForInput(input: ThoughtInput | ProjectedThoughtInput): string[] {
  const effectRefs = operationalNamespaceForThoughtInput(input).allowedOperationalEffectRefs;
  return [
    ...input.rawConversation.map((row) => row.rowId),
    ...input.workingContext.map((item) => item.id),
    ...(input.deskEntries ?? []).map((item) => item.id),
    ...input.occupancy.map((item) => item.concernId),
    ...concernAuthorableTargetIdsForInput(input),
    ...input.observations.map((item) => item.observationId),
    ...effectRefs,
    ...input.retrieval.hits.flatMap((hit) => "supportRefs" in hit ? [hit.ref, ...hit.supportRefs] : [hit.ref]),
    ...coreProfileKeys(input),
    ...journalReadRefs(input).map((read) => read.observationId),
    input.trigger.ref,
  ];
}

/** A2: the forgets she proposed and the Owner has not answered, on Owner chat turns only. */
function pendingForgetInput(
  sidecar: DatabaseSync,
  conversationId: string,
  options: { ownerTurn: boolean; nowMs: number },
): { pendingForget?: readonly ThoughtPendingForget[] } {
  if (!options.ownerTurn || !isOwnerPrivateConversation(conversationId)) return {};
  expireForgetProposals(sidecar, options.nowMs);
  const pending = pendingForgetsForThought(sidecar, conversationId, options.nowMs);
  return pending.length > 0 ? { pendingForget: pending } : {};
}

function identityStoreFor(nuclear: DatabaseSync, deps: KernelDeps): IdentityStore | null {
  return deps.identityOwnerId ? { nuclear, ownerId: deps.identityOwnerId } : null;
}

/** What the activity journal says Ashley read: citable evidence for "I read…" (plan §5.3). */
function journalReadRefs(input: ThoughtInput | ProjectedThoughtInput): Array<Pick<Observation, "observationId" | "modality">> {
  return (input.activityJournal ?? []).flatMap((entry) => (entry.reads ?? []).flatMap((read) =>
    read.modality === "page" || read.modality === "text"
      ? [{ observationId: read.observationId, modality: read.modality }]
      : []));
}

function coreProfileKeys(input: ThoughtInput | ProjectedThoughtInput): string[] {
  const profile = input.coreProfile;
  return profile ? [...profile.owner, ...profile.self].map((entry) => entry.key) : [];
}

function semanticReferenceTargetsForInput(
  input: ThoughtInput | ProjectedThoughtInput,
): ThoughtReferenceTargetMap {
  const targets = new Map<string, ThoughtReferenceTarget[]>();
  const recordTarget = (value: unknown, target: ThoughtReferenceTarget): void => {
    if (typeof value !== "string" || value.length === 0) return;
    const known = targets.get(value);
    if (known) {
      if (!known.includes(target)) known.push(target);
      return;
    }
    targets.set(value, [target]);
  };

  for (const item of input.workingContext) {
    recordTarget(item.id, "working_context");
    recordTarget(item.concernId, "concern");
  }
  for (const item of input.deskEntries ?? []) recordTarget(item.id, "desk");
  for (const item of input.occupancy) recordTarget(item.concernId, "concern");
  for (const concernId of concernAuthorableTargetIdsForInput(input)) recordTarget(concernId, "concern");
  for (const item of input.observations) recordTarget(item.observationId, "observation");
  for (const read of journalReadRefs(input)) recordTarget(read.observationId, "observation");
  return targets;
}

const thoughtPrefixMeter = createPrefixMeter();

function thoughtPrefixMeterEnabled(): boolean {
  const raw = process.env.ASHLEY_THOUGHT_PREFIX_METER?.trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

function recordThoughtPrefix(
  input: ThoughtInput | ProjectedThoughtInput,
  messages: ChatMessage[] | undefined,
): void {
  try {
    if (!thoughtPrefixMeterEnabled() || messages === undefined) return;
    let profileKey = "unknown";
    try {
      profileKey = thoughtContractProfileKey(thoughtContractProfile(input));
    } catch {
      profileKey = "unknown";
    }
    if (profileKey.length === 0) profileKey = "unknown";
    const report = thoughtPrefixMeter.observe(profileKey, messages);
    if (!report) return;
    const breakPath = report.breakPath.replace(/[\r\n]/g, "");
    const profile = profileKey.replace(/[\r\n]/g, "");
    console.log(`[thought] prefix profile=${profile} stable=${report.stableBytes}/${report.totalBytes} prev=${report.previousTotalBytes} break=${report.breakMessage}:${breakPath}`);
  } catch {
    // Measurement must not affect dispatch.
  }
}

function operationalNamespaceForThoughtInput(
  input: ThoughtInput | ProjectedThoughtInput,
) {
  if (
    "allowedOperationalEffectRefs" in input &&
    Array.isArray(input.allowedOperationalEffectRefs)
  ) {
    return buildOperationalEffectNamespaceFromRefs(input.allowedOperationalEffectRefs);
  }
  return buildOperationalEffectNamespace(
    input.cycleId,
    input.generation,
    input.inFlight.map((item) => ("effectId" in item ? item.effectId : item.effectRef)),
  );
}

export async function runThoughtModel(
  input: ThoughtInput | ProjectedThoughtInput,
  deps: KernelDeps,
  options: {
    pass?: number;
    requestId?: string;
    conversationId?: string;
    wakeId?: string;
    signal?: AbortSignal;
    deadlineAtMs: number;
    structuralFeedback?: StructuralFeedbackInput;
    settlementRevisionFeedback?: SettlementRevisionFeedback;
    /** Host-bound disclosure context; never included in the model projection. */
    audience?: ThoughtInput["audience"];
    /** Optional caller narrowing; it may never widen the Model Fabric policy. */
    maxTokens?: number;
    /** Qualification-only seam for the exact NIM candidate; no fallback is allowed. */
    disableThoughtTransportFailover?: boolean;
    /** W7 exact private-budget reservation bridge for this Thought invocation. */
    privateBudgetBinding?: PrivateBudgetDispatchBinding;
    nowMs?: number;
    concernInspectAuthority?: ConcernInspectAuthority;
    /** Last structural attempt: prune a faulty optional part instead of failing the pass. */
    salvageOnFailure?: boolean;
  },
): Promise<ThoughtInvocation> {
  const pass = options.pass ?? 1;
  const requestId = options.requestId ?? randomUUID();
  const operationalNamespace = operationalNamespaceForThoughtInput(input);
  const dispatchOptions: ThoughtCompleteOptions = {
    attentionDb: deps.attentionDb,
    route: "thought",
    responseFormat: "json_schema",
    structuredOutput: thoughtOutputStructuredRequest(operationalNamespace, thoughtContractProfile(input)),
    thoughtContractPass: thoughtContractProfile(input).pass,
    thoughtTriggerKind: input.trigger?.kind,
    purpose: "thought",
    directCommandCodeThought: true,
    lane: "urgent_grounded",
    ownerId: input.occupantId,
    deadlineAtMs: options.deadlineAtMs,
    maxTokens: options.maxTokens,
    disableThoughtTransportFailover: options.disableThoughtTransportFailover || Boolean(options.privateBudgetBinding),
    privateBudgetBinding: options.privateBudgetBinding,
    temperature: 1.0,
    signal: options.signal,
    requestId,
  };
  let messages: ChatMessage[] | undefined;
  let semanticProjectionHash: string | undefined;
  let dispatchMessagesHash: string | undefined;
  let completionInputTokens: number | undefined;
  let lastCompletion: Awaited<ReturnType<typeof completeChat>> | undefined;
  let dispatchStarted = false;
  let lifeboat: ThoughtInvocation["lifeboat"];
  let sawSecret = false;

  try {
    if (
      "allowedOperationalEffectRefs" in input &&
      Array.isArray(input.allowedOperationalEffectRefs)
    ) {
      messages = thoughtMessagesForProjection(
        input as ProjectedThoughtInput,
        options.structuralFeedback,
      );
      semanticProjectionHash = computeSemanticProjectionHash(input as ProjectedThoughtInput);
      dispatchMessagesHash = computeDispatchMessagesHash(messages);
    } else {
      const allocated = allocateThoughtProjection({
        thoughtInput: input as ThoughtInput,
        requestId,
        structuralFeedback: options.structuralFeedback,
      });
      messages = allocated.messages;
      sawSecret = allocated.projected.sawSecret === true;
      semanticProjectionHash = allocated.hashes.semanticProjectionHash;
      dispatchMessagesHash = allocated.hashes.dispatchMessagesHash;
    }

    sawSecret = sawSecret || (input as ProjectedThoughtInput).sawSecret === true
      || ((input.audience === undefined || input.audience.kind === "owner_private")
        && "allowedOperationalEffectRefs" in input && thoughtInputContainsSecret(input));

    if (options.settlementRevisionFeedback) {
      // Authority revision data, not a structural retry or a host-authored settlement.
      // Include it before dispatch hashing and Attention token estimation.
      messages.push({
        role: "user",
        content: JSON.stringify({
          settlementRevision: {
            ...options.settlementRevisionFeedback,
            constraint: "Use only allowed operational effect references; do not fabricate references. If no operational effect applies, do not emit an operational commitment. Thought must author the replacement settlement; all validation still applies.",
          },
        }),
      });
      dispatchMessagesHash = computeDispatchMessagesHash(messages);
    }
    recordThoughtPrefix(input, messages);
    if (semanticProjectionHash && dispatchMessagesHash) {
      dispatchOptions.projectionIdentity = {
        semanticProjectionHash,
        dispatchMessagesHash,
      };
    }
    semanticProjectionHash ??= dispatchMessagesHash ?? "sha256:unavailable";
    dispatchMessagesHash ??= "sha256:unavailable";
    const estimatedInputTokens = estimateRequestTokens(messages ?? []).estimatedInputTokens;
    const logicalInputBytes = estimateRequestInputBytes(messages ?? []);
    if (
      estimatedInputTokens > TARGET_SEMANTIC_INPUT_ENVELOPE ||
      logicalInputBytes > MAX_LOGICAL_SERIALIZED_INPUT_BYTES
    ) {
      return {
        output: {
          kind: "failure",
          cycleId: input.cycleId,
          generation: input.generation,
          pass,
          requestId,
          occupantId: input.occupantId,
          reason: "capacity_deferred",
        },
        attempts: 0,
        requestId,
        inputTokens: estimatedInputTokens,
        thoughtExecutionProvenance: NOT_SENT_EXECUTION_PROVENANCE,
      };
    }
    const authorityCurrentness = hasAuthorityBarrier(deps.attentionDb)
      ? captureAuthorityCurrentness(deps.attentionDb)
      : undefined;
    const thoughtInvocationContext = {
      invocationId: requestId,
      // Attention assigns the durable allocation immediately before binding.
      // The completed envelope replaces this provisional value with the exact
      // returned allocation ID.
      allocationId: 0,
      cycleId: input.cycleId,
      conversationId: options.conversationId ?? null,
      wakeId: options.wakeId ?? null,
      generation: input.generation,
      semanticPass: pass,
      structuralAttemptOrdinal: options.structuralFeedback ? 1 : 0,
      authorityEpoch: input.authorityEpoch,
      authorityVersionVector: authorityCurrentness?.ownerVersions ?? { authorityEpoch: input.authorityEpoch },
      authorityCurrentness,
      triggerRef: input.trigger.ref,
      semanticProjectionHash,
      dispatchMessagesHash,
      allowlistFingerprint: buildReferenceAllowlist(
        semanticReferencesForInput(input),
        semanticReferenceTargetsForInput(input),
      ).fingerprint,
      absoluteDeadlineAtMs: options.deadlineAtMs,
    };
    dispatchOptions.thoughtInvocationContext = thoughtInvocationContext;

    dispatchStarted = true;
    let completion: Awaited<ReturnType<typeof completeChat>>;
    const ownModelId = thoughtModelForTrigger(input.trigger?.kind);
    const lifeboatLaunchBlocked = () =>
      options.signal?.aborted === true
      || options.disableThoughtTransportFailover === true
      || options.deadlineAtMs - Date.now() < THOUGHT_LIFEBOAT_MIN_REMAINING_MS;
    const armLifeboat = (
      record: NonNullable<ThoughtInvocation["lifeboat"]>,
      primaryCapture: ThoughtProviderFailureCapture,
    ) => {
      lifeboat = record;
      console.warn(`[thought] lifeboat from=${record.fromModelId} class=${record.primaryFailureClass} to=${record.toModelId} effort=${record.toEffort}`);
      if (deps.observabilityDb) {
        try {
          recordDiagnostic(deps.observabilityDb, {
            cycleId: input.cycleId,
            generation: input.generation,
            requestId,
            pass,
            // Frozen CHECK on thought_dispatch_diagnostics.code has no circuit_open.
            code: "provider_unavailable",
            stage: "provider_dispatch",
            dispatchTruth: primaryCapture.dispatchTruth,
            semanticProjectionHash,
            dispatchMessagesHash,
            primaryProvider: "command_code",
            primaryAttemptId: record.primaryAttemptId,
            primaryDispatchTruth: primaryCapture.dispatchTruth,
            fallbackAttemptOrdinal: 2,
            fallbackFromAttemptId: record.primaryAttemptId,
            providerFailure: primaryCapture,
            createdAtMs: deps.nowMs(),
          });
        } catch {
          // Observability persistence must not change the pass.
        }
      }
      dispatchOptions.thoughtLifeboat = true;
      // Attention binds thought_invocation_id uniquely. The lifeboat is its own allocation.
      dispatchOptions.thoughtInvocationContext = {
        ...thoughtInvocationContext,
        invocationId: randomUUID(),
      };
    };
    // The lifeboat dispatch itself is never consulted against the breaker.
    if (thoughtModelCircuit.isOpen(ownModelId, deps.nowMs()) && !lifeboatLaunchBlocked()) {
      const target = thoughtLifeboatForTrigger(input.trigger?.kind);
      const primaryCapture: ThoughtProviderFailureCapture = {
        dispatchTruth: "not_sent",
        parserStatus: "not_run",
        validatorStatus: "not_run",
        failureClass: "circuit_open",
        structuralRetryStatus: "not_applicable",
      };
      armLifeboat({
        fromModelId: ownModelId,
        toModelId: target.modelId,
        toEffort: target.effort,
        primaryFailureClass: "circuit_open",
        primaryDispatchTruth: "not_sent",
        primaryAttemptId: null,
        primaryProviderAttempts: 0,
      }, primaryCapture);
      completion = await invokeThoughtComplete(messages, dispatchOptions, deps.completeChat);
    } else try {
      completion = await invokeThoughtComplete(messages, dispatchOptions, deps.completeChat);
      if (thoughtModelCircuit.noteSuccess(ownModelId, deps.nowMs())) {
        console.warn(`[thought] circuit closed model=${ownModelId}`);
      }
    } catch (primaryError) {
      const qualifies = lifeboatQualifies(primaryError);
      if (thoughtModelCircuit.noteFailure(ownModelId, qualifies, deps.nowMs())) {
        console.warn(`[thought] circuit open model=${ownModelId} for=${THOUGHT_MODEL_CIRCUIT_MS / 60_000}m`);
      }
      if (lifeboatLaunchBlocked() || !qualifies) throw primaryError;
      const target = thoughtLifeboatForTrigger(input.trigger?.kind);
      const primaryCapture = providerFailureCaptureForError(primaryError, dispatchOptions, undefined, true);
      const primaryEvidence = commandCodeThoughtEvidenceFromError(primaryError);
      const primaryProvenance = executionProvenanceForError(primaryError, undefined);
      armLifeboat({
        fromModelId: ownModelId,
        toModelId: target.modelId,
        toEffort: target.effort,
        primaryFailureClass: primaryCapture.failureClass ?? "provider_unavailable",
        primaryDispatchTruth: primaryCapture.dispatchTruth,
        primaryAttemptId: primaryEvidence?.providerAttemptId ?? null,
        primaryProviderAttempts: primaryProvenance.providerAttempts,
      }, primaryCapture);
      completion = await invokeThoughtComplete(messages, dispatchOptions, deps.completeChat);
    }
    lastCompletion = completion;
    completionInputTokens = completion.usage?.promptTokens ?? estimatedInputTokens;
    if (options.signal?.aborted) {
      return {
        output: {
          kind: "failure",
          cycleId: input.cycleId,
          generation: input.generation,
          pass,
          requestId,
          occupantId: input.occupantId,
          reason: "cancelled",
        },
        attempts: 1,
        requestId,
        cancelled: true,
        inputTokens: completion.usage?.promptTokens ?? estimatedInputTokens,
        thoughtExecutionProvenance: withLifeboatAttempts(executionProvenanceForCompletion(completion), lifeboat),
        ...(lifeboat ? { lifeboat } : {}),
      };
    }
    const semanticReferences = new Set(semanticReferencesForInput(input));
    const semanticParseOptions = {
      concernInspectRefs: (options.concernInspectAuthority ?? concernInspectRefsForInput(input)).refs,
      concernDiscoverAllowed: (options.concernInspectAuthority ?? concernInspectRefsForInput(input)).discoverAllowed === true,
    };
    let semanticResult = parseThoughtSemanticOutput(
      completion.text,
      semanticReferences,
      semanticParseOptions,
    );
    if (!semanticResult.ok && options.salvageOnFailure === true) {
      const firstFailure = semanticResult;
      const salvaged = salvageSettlement(completion.text, firstFailure, (candidate) =>
        parseThoughtSemanticOutput(candidate, semanticReferences, semanticParseOptions));
      if (salvaged.ok) {
        const reparsed = parseThoughtSemanticOutput(salvaged.text, semanticReferences, semanticParseOptions);
        if (reparsed.ok) {
          console.warn(`[thought] salvaged code=${firstFailure.code} dropped=${salvaged.dropped.join(",")} model=${completion.providerModel ?? "-"}`);
          completion = { ...completion, text: salvaged.text };
          semanticResult = reparsed;
        }
      }
    }
    if (!semanticResult.ok) {
      const diagnosticCode = semanticResult.code as ThoughtParserFailureCode;
      const shape = describeFieldShape(completion.text, semanticResult.field, semanticReferences);
      // The field path names a contract field, never her words; it is what a fix needs.
      console.warn(`[thought] parse failure code=${diagnosticCode} field=${semanticResult.field ?? "-"} model=${completion.providerModel ?? "-"} shape=${shape}`);
      const previousFeedback = typeof options.structuralFeedback === "string"
        ? null
        : options.structuralFeedback;
      const structuralFeedback = createThoughtStructuralFeedback({
        code: diagnosticCode,
        field: semanticResult.field,
        epistemicRepairs: semanticResult.epistemicRepairs,
        allowlistedReferences: semanticReferencesForInput(input),
        previousCandidate: previousFeedback?.previousCandidate
          ?? parseThoughtStructuralCandidate(completion.text),
      });
      const output: ThoughtStepOutput = {
        kind: "failure",
        cycleId: input.cycleId,
        generation: input.generation,
        pass,
        requestId,
        occupantId: input.occupantId,
        reason: "malformed",
        diagnosticCode,
        diagnosticField: semanticResult.field,
      };
      return {
        output,
        attempts: 1,
        requestId,
        malformed: true,
        structuralFeedback,
        inputTokens: completion.usage?.promptTokens ?? estimatedInputTokens,
        providerFailureCapture: providerFailureCaptureForCompletion(
          completion,
          dispatchOptions,
          {
            parserStatus: "failed",
            validatorStatus: "not_run",
            failureClass: semanticResult.code,
            structuralRetryStatus: "not_scheduled",
            },
          ),
        thoughtExecutionProvenance: withLifeboatAttempts(executionProvenanceForCompletion(completion), lifeboat),
        ...(lifeboat ? { lifeboat } : {}),
      };
    }
    const semantic = semanticResult.value;
    const correctionValidation = options.structuralFeedback
      ? validateThoughtStructuralCorrectionScope(options.structuralFeedback, completion.text)
      : { ok: true as const };
    if (!correctionValidation.ok) {
      const output: ThoughtStepOutput = {
        kind: "failure",
        cycleId: input.cycleId,
        generation: input.generation,
        pass,
        requestId,
        occupantId: input.occupantId,
        reason: "malformed",
        correctionFailureCode: correctionValidation.violation.code,
      };
      return {
        output,
        attempts: 1,
        requestId,
        correctionScopeViolation: correctionValidation.violation,
        inputTokens: completion.usage?.promptTokens ?? estimatedInputTokens,
        providerFailureCapture: providerFailureCaptureForCompletion(
          completion,
          dispatchOptions,
          {
            parserStatus: "passed",
            validatorStatus: "failed",
            failureClass: correctionValidation.violation.code,
            structuralRetryStatus: "not_scheduled",
            },
          ),
        thoughtExecutionProvenance: withLifeboatAttempts(executionProvenanceForCompletion(completion), lifeboat),
        ...(lifeboat ? { lifeboat } : {}),
      };
    }
    const kernelEnvelope = completion.capturedAttemptIdentity
      ? buildKernelEnvelope({
          context: {
            ...thoughtInvocationContext,
            allocationId: completion.capturedAttemptIdentity.allocationId,
          },
          attempt: completion.capturedAttemptIdentity,
          response: semantic,
          parserValidatorIdentity: THOUGHT_SEMANTIC_PARSER_ID,
          runtimeArtifactIdentity: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
        })
      : undefined;
    const output: ThoughtStepOutput = semantic.kind === "settlement"
      ? {
          kind: "settlement",
          cycleId: input.cycleId,
          generation: input.generation,
          pass,
          requestId,
          occupantId: input.occupantId,
          settlement: materializeSemanticSettlement(
            semantic,
            input,
            deps?.loadAuthorityPacks ? deps.loadAuthorityPacks().receipt.receiptsByEffectId : undefined,
            sawSecret,
          ),
        }
      : semantic.kind === "observation_intent"
        ? (() => {
            const inspectAuthority = options.concernInspectAuthority ?? concernInspectRefsForInput(input);
            const inspectExpectation = semantic.operationKind === "concern.inspect"
              && typeof (semantic.request as Record<string, unknown>).concernRef === "string"
              ? inspectAuthority.expectations[(semantic.request as Record<string, string>).concernRef]
              : undefined;
            const bound = bindObservationIntent({
              intent: semantic,
              cycleId: input.cycleId,
              generation: input.generation,
              parentDeadlineAtMs: options.deadlineAtMs,
              nowMs: options.nowMs ?? Date.now(),
              authorityCurrentness,
              audience: input.audience,
              ...(inspectExpectation === undefined ? {} : { concernInspectExpectation: inspectExpectation }),
            });
            return {
              kind: "observation_request" as const,
              cycleId: input.cycleId,
              generation: input.generation,
              pass,
              requestId,
              occupantId: input.occupantId,
              observationRequest: {
                requestId: bound.requestId,
                cycleId: bound.cycleId,
                generation: bound.generation,
                kind: bound.kind,
                 request: bound.request,
                 replaySafe: true as const,
                 audience: bound.audience,
                 authorityCurrentness: bound.authorityCurrentness,
                ...(bound.concernInspectionBinding === undefined
                  ? {}
                  : { concernInspectionBinding: bound.concernInspectionBinding }),
              },
              correlationId: bound.correlationId,
              expectedResultType: "observation" as const,
              deadlineAtMs: bound.deadlineAtMs,
            };
          })()
        : semantic.kind === "effect_intent"
          ? (() => {
              const bound = bindEffectIntent({
                intent: semantic,
                cycleId: input.cycleId,
                generation: input.generation,
                authorityEpoch: input.authorityEpoch,
                parentDeadlineAtMs: options.deadlineAtMs,
                nowMs: options.nowMs ?? Date.now(),
                authorityCurrentness,
              });
              return {
                kind: "effect_proposal" as const,
                cycleId: input.cycleId,
                generation: input.generation,
                pass,
                requestId,
                occupantId: input.occupantId,
                effectProposal: {
                  effectId: bound.effectId,
                  cycleId: bound.cycleId,
                  generation: bound.generation,
                  idempotencyKey: bound.idempotencyKey,
                  kind: bound.kind,
                  purpose: semantic.purpose,
                  request: bound.request,
                  audienceScope: options.audience ?? null,
                  authorityEpoch: bound.authorityEpoch,
                  authorityCurrentness: bound.authorityCurrentness,
                },
                correlationId: bound.correlationId,
                expectedResultType: "effect_receipt" as const,
                deadlineAtMs: bound.deadlineAtMs,
              };
            })()
          : {
              kind: "abstain" as const,
              cycleId: input.cycleId,
              generation: input.generation,
              pass,
              requestId,
              occupantId: input.occupantId,
              abstain: semantic,
            };
    return {
      output,
      semantic,
      attempts: 1,
      requestId,
      malformed: false,
      inputTokens: completion.usage?.promptTokens ?? estimatedInputTokens,
      ...(kernelEnvelope ? { kernelEnvelope } : {}),
      providerUsageCapture: providerFailureCaptureForCompletion(
        completion,
        dispatchOptions,
        {
          // The model answered in-contract: parse passed and correction scope
          // passed or was vacuous, so no failure class applies.
          parserStatus: "passed",
          validatorStatus: "passed",
          structuralRetryStatus: "not_applicable",
        },
      ),
      thoughtExecutionProvenance: withLifeboatAttempts(executionProvenanceForCompletion(completion), lifeboat),
      ...(lifeboat ? { lifeboat } : {}),
    };
  } catch (error) {
    const cancelled = options.signal?.aborted === true
      || (error instanceof Error && error.name === "AbortError");
    if (error instanceof ThoughtMaterializationError) {
      return {
        output: {
          kind: "failure",
          cycleId: input.cycleId,
          generation: input.generation,
          pass,
          requestId,
          occupantId: input.occupantId,
          reason: "malformed",
          diagnosticCode: error.code,
          diagnosticField: error.field,
        },
        attempts: 1,
        requestId,
        malformed: true,
        inputTokens: completionInputTokens,
        ...(lastCompletion
          ? {
              providerFailureCapture: providerFailureCaptureForCompletion(
                lastCompletion,
                dispatchOptions,
                {
                  parserStatus: "passed",
                  validatorStatus: "failed",
                  failureClass: error.code,
                  structuralRetryStatus: "not_scheduled",
                },
              ),
            }
          : {}),
        thoughtExecutionProvenance: withLifeboatAttempts(
          lastCompletion
            ? executionProvenanceForCompletion(lastCompletion)
            : UNKNOWN_EXECUTION_PROVENANCE,
          lifeboat,
        ),
        ...(lifeboat ? { lifeboat } : {}),
      };
    }
    const executionProvenance = withLifeboatAttempts(
      !dispatchStarted && !lastCompletion
        ? NOT_SENT_EXECUTION_PROVENANCE
        : executionProvenanceForError(error, lastCompletion),
      lifeboat,
    );
    // AppError code "timeout" is minted only by the dispatch deadline branch;
    // the shared Model Fabric classifier maps it (and raw deadline
    // TimeoutErrors) to the internal timeout code. A received provider
    // response excludes deadline truth.
    const thoughtDeadline = (
      metadataFromError(error)?.failure?.code === "timeout"
      || (error as { code?: unknown } | null)?.code === "timeout"
    ) && executionProvenance.dispatchTruth !== "sent";
    const providerCapture = !cancelled
      ? providerFailureCaptureForError(error, dispatchOptions, lastCompletion, dispatchStarted)
      : undefined;
    if (!cancelled && providerCapture && deps.observabilityDb) {
      try {
        const mfMeta = metadataFromError(error);
        if (mfMeta && mfMeta.failoverSuppressed === "transport_failover_unavailable_for_projection") {
          const receipt = mfMeta.receipt;
          const resolvedReceipt = receipt && receipt.receiptStage === "resolved" ? receipt : null;
          const primaryAttempt = resolvedReceipt && resolvedReceipt.attempts.length > 0 ? resolvedReceipt.attempts[0] : null;
          const primaryAttemptId = resolvedReceipt ? resolvedReceipt.finalAttemptId : (primaryAttempt ? primaryAttempt.attemptId : null);
          const primaryProvider = mfMeta.resolvedRoute?.provider ?? (primaryAttempt ? primaryAttempt.provider : null);
          recordDiagnostic(deps.observabilityDb, {
            cycleId: input.cycleId,
            generation: input.generation,
            requestId,
            pass,
            code: "transport_failover_unavailable_for_projection",
            stage: "provider_dispatch",
            dispatchTruth: "not_sent",
            quotaBucket: mfMeta.suppressedBucket ?? (mfMeta.resolvedRoute ? mfMeta.resolvedRoute.quotaClass : null),
            semanticProjectionHash: mfMeta.semanticProjectionHash ?? semanticProjectionHash,
            dispatchMessagesHash: mfMeta.dispatchMessagesHash ?? dispatchMessagesHash,
            primaryProvider,
            primaryAttemptId,
            primaryDispatchTruth: "sent",
            suppressedProvider: mfMeta.suppressedProvider ?? "groq",
            fallbackAttemptOrdinal: 2,
            fallbackFromAttemptId: primaryAttemptId,
            secondaryDispatchTruth: "not_sent",
            providerFailure: providerCapture,
            createdAtMs: deps.nowMs(),
          });
        } else if ((error as { code?: string })?.code === "request_exceeds_tpm_budget") {
          recordDiagnostic(deps.observabilityDb, {
            cycleId: input.cycleId,
            generation: input.generation,
            requestId,
            pass,
            code: "request_exceeds_tpm_budget",
            stage: "attention_admission",
            dispatchTruth: "not_sent",
            semanticProjectionHash,
            dispatchMessagesHash,
            createdAtMs: deps.nowMs(),
          });
        } else if (providerCapture.dispatchTruth !== "not_sent") {
          recordDiagnostic(deps.observabilityDb, {
            cycleId: input.cycleId,
            generation: input.generation,
            requestId,
            pass,
            code: thoughtDeadline ? "attention_deadline" : "provider_unavailable",
            stage: "provider_dispatch",
            dispatchTruth: providerCapture.dispatchTruth,
            semanticProjectionHash,
            dispatchMessagesHash,
            providerFailure: providerCapture,
            createdAtMs: deps.nowMs(),
          });
        }
      } catch {
        // Observability DB persistence failures must not block thought execution
      }
    }
    const attentionErr = error as { code?: string; nextEligibleAtMs?: number } | undefined;
    const isCapacityDeferred =
      !cancelled &&
      attentionErr?.code === "attention_deadline" &&
      typeof attentionErr.nextEligibleAtMs === "number";

    if (isCapacityDeferred) {
      return {
        output: {
          kind: "failure",
          cycleId: input.cycleId,
          generation: input.generation,
          pass,
          requestId,
          occupantId: input.occupantId,
          reason: "capacity_deferred",
        },
        attempts: 1,
        requestId,
        unavailable: false,
        cancelled: false,
        deferred: true,
        nextEligibleAtMs: attentionErr.nextEligibleAtMs,
        thoughtExecutionProvenance: executionProvenance,
        ...(lifeboat ? { lifeboat } : {}),
      };
    }

    return {
      output: {
        kind: "failure",
        cycleId: input.cycleId,
        generation: input.generation,
        pass,
        requestId,
        occupantId: input.occupantId,
        reason: cancelled ? "cancelled" : "unavailable",
      },
      attempts: 1,
      requestId,
      unavailable: !cancelled,
      cancelled,
      thoughtDeadline,
      ...(providerCapture ? { providerFailureCapture: providerCapture } : {}),
      thoughtExecutionProvenance: executionProvenance,
      ...(lifeboat ? { lifeboat } : {}),
    };
  }
}

function payloadRecord(event: InboxEvent): Record<string, unknown> {
  return typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

type OwnerAttachmentSource = { sourceMessageEntityUuid: string; attachments: readonly unknown[] };

/**
 * Attachment refs for every Owner utterance in this cycle: the triggering
 * event first, then fragments absorbed while the cycle was thinking. Absorbed
 * fragments carry their own attachment refs on their own inbox events.
 */
export function ownerAttachmentSources(
  sidecar: DatabaseSync,
  event: InboxEvent,
  payload: Record<string, unknown>,
  cycle: { cycleId: string; conversationId: string },
): OwnerAttachmentSource[] {
  const sourceOf = (id: string, record: Record<string, unknown>): OwnerAttachmentSource | null => {
    const attachments = Array.isArray(record.attachments) ? record.attachments : [];
    if (attachments.length === 0) return null;
    const evidenceRowId = typeof record.evidenceRowId === "string" ? record.evidenceRowId.trim() : "";
    return { sourceMessageEntityUuid: evidenceRowId || id, attachments };
  };
  const sources: OwnerAttachmentSource[] = [];
  const seen = new Set<string>([event.id]);
  const trigger = sourceOf(event.id, payload);
  if (trigger) sources.push(trigger);
  for (const absorbed of listCycleOwnerUtterances(sidecar, cycle.conversationId, cycle.cycleId)) {
    if (seen.has(absorbed.id)) continue;
    seen.add(absorbed.id);
    const source = sourceOf(absorbed.id, payloadRecord(absorbed));
    if (source) sources.push(source);
  }
  return sources;
}

/** Owner rows this cycle is answering: the trigger plus absorbed fragments. */
function cycleOwnerRowIds(
  sidecar: DatabaseSync,
  payload: Record<string, unknown>,
  cycle: { cycleId: string; conversationId: string },
): string[] {
  const ids = typeof payload.evidenceRowId === "string" ? [payload.evidenceRowId] : [];
  for (const absorbed of listCycleOwnerUtterances(sidecar, cycle.conversationId, cycle.cycleId)) {
    const rowId = payloadRecord(absorbed).evidenceRowId;
    if (typeof rowId === "string") ids.push(rowId);
  }
  return ids;
}

/** Build the semantic cause record without composing a new future-trigger purpose. */
export function buildThoughtWakeCauses(
  sidecar: DatabaseSync,
  event: InboxEvent,
  wake: { sourceKind: string },
  cycle: { triggerRef: string },
  triggerKind: CycleTriggerKind,
): ThoughtWakeCause[] {
  const payload = payloadRecord(event);
  if (triggerKind === "future_trigger_due" || wake.sourceKind === "future_trigger") {
    const triggerId = typeof payload.triggerId === "string" && payload.triggerId.trim()
      ? payload.triggerId.trim()
      : cycle.triggerRef;
    const futureCause = futureTriggerWakeContext(sidecar, triggerId);
    if (futureCause) return [futureCause];
  }
  if (triggerKind === "commitment_due") {
    const triggerRef = typeof payload.commitmentId === "string" && payload.commitmentId.trim()
      ? payload.commitmentId.trim()
      : cycle.triggerRef || event.id;
    return [{
      sourceKind: "commitment",
      triggerRef,
      purpose: null,
      purposeStatus: "absent",
    }];
  }
  return [{
    sourceKind: wake.sourceKind,
    triggerRef: cycle.triggerRef || event.id,
    purpose: null,
    purposeStatus: "absent",
  }];
}

function rememberDirective(payload: Record<string, unknown>): RememberDirective | null {
  if (
    payload.rememberRequested !== true ||
    typeof payload.evidenceLineageId !== "string" ||
    typeof payload.evidenceRowId !== "string"
  ) return null;
  const classification = payload.dataClassification;
  if (
    classification !== "ordinary" &&
    classification !== "sensitive" &&
    classification !== "never_public" &&
    classification !== "secret"
  ) return null;
  return {
    rememberRequested: true,
    evidenceLineageId: payload.evidenceLineageId,
    evidenceRowId: payload.evidenceRowId,
    dataClassification: classification,
  };
}

function suppliedObservations(
  payload: Record<string, unknown>,
  cycle: { cycleId: string; generation: number },
): Observation[] {
  if (!Array.isArray(payload.observations)) return [];
  const modalities = new Set<Observation["modality"]>([
    "text", "image", "page", "tool", "subscription", "receipt",
  ]);
  return payload.observations.flatMap((value): Observation[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const observationId = typeof item.observationId === "string" ? item.observationId : "";
    const provenance = typeof item.provenance === "string" ? item.provenance : "";
    const modality = item.modality;
    if (!observationId || !provenance || !modalities.has(modality as Observation["modality"])) return [];
    const classification = item.dataClassification;
    if (
      classification !== "ordinary" &&
      classification !== "sensitive" &&
      classification !== "never_public" &&
      classification !== "secret"
    ) return [];
    let view: Observation["view"] | null = null;
    if (item.view !== undefined) {
      try {
        view = canonicalObservationView(item.view);
      } catch {
        return [];
      }
      if (view === null) return [];
    }
    return [{
      observationId,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      derived: item.derived === true,
      replaySafe: item.replaySafe === true,
      modality: modality as Observation["modality"],
      payload: item.payload,
      provenance,
      ...(view === null ? {} : { view }),
      ...(typeof item.rawOutranksDerivedOf === "string"
        ? { rawOutranksDerivedOf: item.rawOutranksDerivedOf }
        : {}),
      dataClassification: classification,
      secretOmitted: item.secretOmitted === true,
    }];
  });
}

function triggerKind(value: unknown): CycleTriggerKind {
  switch (value) {
    case "owner_message":
    case "external_message":
    case "idle_opportunity":
    case "commitment_due":
    case "subscription_item":
    case "future_trigger_due":
    case "observation_or_receipt":
    case "self_change_result":
    case "domus_notification":
    case "recovery":
      return value;
    default:
      return "owner_message";
  }
}

export function deliveryIntentFor(
  cycle: { conversationId: string; triggerKind: CycleTriggerKind; occupantId?: string | null },
  payload: Record<string, unknown>,
  purpose: DeliveryIntent["purpose"],
  triggerKind = cycle.triggerKind,
  externalPublication?: DeliveryIntent["externalPublication"],
  socialLifecycle?: DeliveryIntent["socialLifecycle"],
  destinationOverride?: DeliveryIntent["destination"],
  triggerEvidence?: ConversationEvidenceRecord | null,
  continuityRecovery?: ThoughtContinuityRecovery | null,
  sidecar?: DatabaseSync,
): DeliveryIntent {
  const external = triggerKind === "external_message";
  const trigger: DeliveryIntent["trigger"] =
    triggerKind === "self_change_result" ? "self_change_result" :
    triggerKind === "domus_notification" ? "domus_notification" :
    triggerKind === "idle_opportunity" ? "idle" :
      triggerKind === "commitment_due" ? "commitment_due" :
      triggerKind === "subscription_item" ? "subscription" :
        triggerKind === "future_trigger_due" ? "future_trigger" :
          triggerKind === "recovery" ? "recovery" :
            triggerKind === "observation_or_receipt" ? "operation_completion" :
            external ? "external_message" : "owner_message_reactive";
  const predecessorEventId = triggerKind === "observation_or_receipt"
    && typeof payload.originOwnerEventId === "string"
    ? payload.originOwnerEventId
    : undefined;
  const rawOwnerId = resolveCanonicalOwnerPrincipal(sidecar, {
    payload,
    cycle,
    triggerEvidence,
    continuityRecovery,
    predecessorEventId,
  });
  const channel = typeof payload.channel === "string" && payload.channel.trim()
    ? payload.channel
    : "discord";
  const threadId = typeof payload.threadId === "string" && payload.threadId.trim()
    ? payload.threadId
    : cycle.conversationId;
  const rawDestination = payload.externalDestination;
  const destination = purpose === "licensed_speech"
    ? external && typeof rawDestination === "object" && rawDestination !== null && !Array.isArray(rawDestination)
      ? rawDestination as DeliveryIntent["destination"]
      : destinationOverride
    : undefined;

  let ownerId: string;
  const isOwnerPrivateLicensedSpeech = purpose === "licensed_speech"
    && !external
    && destination?.kind !== "room"
    && destination?.kind !== "external_dm";

  if (isOwnerPrivateLicensedSpeech) {
    if (!rawOwnerId || !isAuthorizedOwnerId(rawOwnerId)) {
      throw new Error("canonical_owner_principal_unproven");
    }
    ownerId = rawOwnerId;
  } else if (purpose === "licensed_speech") {
    ownerId = rawOwnerId ?? (destination && "principalId" in destination && typeof destination.principalId === "string" ? destination.principalId : cycle.conversationId);
  } else {
    ownerId = rawOwnerId ?? (destination && "principalId" in destination && typeof destination.principalId === "string" ? destination.principalId : cycle.conversationId);
  }
  return {
    ownerId,
    channel,
    threadId,
    conversationId: cycle.conversationId,
    trigger,
    deliveryLane: trigger === "owner_message_reactive" || trigger === "external_message" ? "reactive" : "proactive",
    purpose,
    ...(destination ? { destination } : {}),
    ...(externalPublication ? { externalPublication } : {}),
    ...(socialLifecycle ? { socialLifecycle } : {}),
  };
}

function commitmentDueProjection(
  nuclear: DatabaseSync,
  cycle: { triggerKind: CycleTriggerKind; occupantId: string | null },
  payload: Record<string, unknown>,
): CommitmentDueProjection | undefined {
  if (cycle.triggerKind !== "commitment_due") return undefined;
  const commitmentId = typeof payload.commitmentId === "string" ? payload.commitmentId.trim() : "";
  if (!commitmentId) return undefined;
  const ownerId = typeof payload.ownerId === "string" && payload.ownerId.trim()
    ? payload.ownerId.trim()
    : cycle.occupantId?.trim() || "owner";
  const opportunity = getCommitmentOpportunity(nuclear, { ownerId, commitmentId });
  if (!opportunity) return undefined;
  const rawCompleteness = payload.evidenceCompleteness;
  const evidenceCompleteness: CommitmentEvidenceCompleteness = rawCompleteness === "supported"
    || rawCompleteness === "contradicted"
    || rawCompleteness === "unknown"
    ? rawCompleteness
    : "unknown";
  return {
    commitmentId: opportunity.commitmentId,
    realizationClause: opportunity.realizationClause,
    evidenceCompleteness,
    latenessMs: typeof payload.latenessMs === "number" && Number.isFinite(payload.latenessMs)
      ? Math.max(0, payload.latenessMs)
      : opportunity.latenessMs ?? 0,
    lateBehavior: opportunity.lateBehavior,
    latestUsefulAtMs: opportunity.latestUsefulAtMs,
    requiredPrecisionMs: opportunity.requiredPrecisionMs,
    timezoneId: opportunity.timezoneId,
  };
}

type ExternalSocialDestination = {
  kind: "external_dm";
  principalId: string;
  channelId?: string;
  threadId?: string;
} | {
  kind: "room";
  roomId: string;
  guildId: string;
  channelId: string;
  threadId?: string;
};

function externalDestinationFor(
  payload: Record<string, unknown>,
): ExternalSocialDestination | null {
  const value = payload.externalDestination;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "external_dm" && typeof candidate.principalId === "string" && candidate.principalId.trim()) {
    const channelId = typeof candidate.channelId === "string" && candidate.channelId.trim()
      ? candidate.channelId.trim()
      : undefined;
    return {
      kind: "external_dm",
      principalId: candidate.principalId.trim(),
      ...(channelId ? { channelId } : {}),
      ...(typeof candidate.threadId === "string" && candidate.threadId.trim()
        ? { threadId: candidate.threadId.trim() }
        : {}),
    };
  }
  if (candidate.kind !== "room"
    || typeof candidate.roomId !== "string"
    || typeof candidate.guildId !== "string"
    || typeof candidate.channelId !== "string"
    || candidate.roomId !== roomIdentity(candidate.guildId, candidate.channelId)) {
    return null;
  }
  return {
    kind: "room",
    roomId: candidate.roomId,
    guildId: candidate.guildId,
    channelId: candidate.channelId,
    ...(typeof candidate.threadId === "string" && candidate.threadId.trim()
      ? { threadId: candidate.threadId.trim() }
      : {}),
  };
}

function recordRequest(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** A delegation reference is Host-derived from a same-conversation concern. */
function delegationRefForRequest(
  sidecar: DatabaseSync,
  request: unknown,
  conversationId: string,
): string | null {
  const record = recordRequest(request);
  const concernRef = typeof record?.concernRef === "string" ? record.concernRef.trim() : "";
  if (!concernRef) return null;
  const concern = getConcern(sidecar, concernRef);
  if (!concern || concern.conversationId !== conversationId) return null;
  const ref = concern.objective?.delegationRef;
  return typeof ref === "string" && ref.trim() ? ref.trim() : null;
}

function withDelegationRef<T extends { delegationRef?: string | null }>(
  value: T,
  delegationRef: string | null,
): T {
  return delegationRef === null ? value : { ...value, delegationRef };
}

/** Build the room target for authenticated Owner speech without making it external. */
export function ownerRoomDestinationFor(
  conversationId: string,
  payload: Record<string, unknown>,
  triggerEvidence: {
    role?: unknown;
    speakerKind?: unknown;
    speakerPrincipalId?: unknown;
  } | null,
): OwnerRoomDestination | null {
  if (!triggerEvidence || triggerEvidence.role !== "owner" || triggerEvidence.speakerKind !== "owner") {
    return null;
  }
  const context = payload.ownerRoomContext;
  if (typeof context !== "object" || context === null || Array.isArray(context)) return null;
  const candidate = context as Record<string, unknown>;
  if (typeof candidate.guildId !== "string" || typeof candidate.channelId !== "string") return null;
  const guildId = candidate.guildId.trim();
  const channelId = candidate.channelId.trim();
  const speakerPrincipalId = typeof triggerEvidence.speakerPrincipalId === "string"
    ? triggerEvidence.speakerPrincipalId.trim()
    : "";
  if (!guildId || !channelId || !speakerPrincipalId) return null;
  const ownerId = typeof payload.ownerId === "string" ? payload.ownerId.trim() : "";
  if (ownerId && ownerId !== speakerPrincipalId) return null;
  const roomId = roomIdentity(guildId, channelId);
  if (conversationId !== roomId) return null;
  return { kind: "room", roomId, guildId, channelId, ownerRoom: true };
}

/**
 * Bounded Owner-private cross-surface recall scope. Resolves only when the
 * current cycle uses the default Owner-private audience (no room/external
 * destination) AND the cycle owner re-verifies as the authorized trust-root.
 * Room identities come from canonical trusted-room authority for that same
 * Owner. Anything else yields no scope, so room and external cycles can
 * never receive one.
 */
function ownerPrivateCrossSurfaceScope(
  nuclear: DatabaseSync,
  options: { thoughtAudience?: unknown; ownerId?: unknown },
): string[] | undefined {
  if (options.thoughtAudience !== undefined) return undefined;
  const ownerId = typeof options.ownerId === "string" ? options.ownerId : null;
  if (!ownerId || !isAuthorizedOwnerId(ownerId)) return undefined;
  let rooms: readonly string[];
  try {
    rooms = listOwnerTrustedRoomConversationIds(nuclear, ownerId);
  } catch {
    return undefined;
  }
  return rooms.length > 0 ? [...rooms] : undefined;
}

type ObservationPersistenceInput = {
  cycleId: string;
  generation: number;
  observations: Observation[];
};

function storeObservations(db: DatabaseSync, input: ObservationPersistenceInput, nowMs: number): void {
  for (const observation of input.observations) {
    persistOrVerifyObservation(db, {
      ...observation,
      cycleId: input.cycleId,
      generation: input.generation,
    }, nowMs);
  }
}

function storeThoughtStep(
  db: DatabaseSync,
  output: ThoughtStepOutput,
  nowMs: number,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO thought_steps
       (request_id, cycle_id, generation, pass, kind, payload_json, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    output.requestId,
    output.cycleId,
    output.generation,
    output.pass,
    output.kind,
    JSON.stringify(output),
    nowMs,
  );
}

function captureProjectedThoughtDebug(input: {
  db?: DatabaseSync;
  occurrenceId: string;
  projected: unknown;
  code: string;
  providerFailure?: ThoughtProviderFailureCapture | null;
  nowMs: number;
}): void {
  if (!input.db) return;
  try {
    const projectedDebugJson = JSON.stringify(input.projected);
    if (typeof projectedDebugJson !== "string") return;
    captureThoughtDebug(input.db, {
      occurrenceId: input.occurrenceId,
      projectedDebugJson,
      code: input.code,
      providerFailure: input.providerFailure,
      nowMs: input.nowMs,
    });
  } catch {
    // Debug capture is diagnostic-only and must never affect cognition.
  }
}

function persistedMalformedRetries(
  db: DatabaseSync,
  cycleId: string,
  generation: number,
  pass: number,
): number {
  let count = 0;
  for (const row of db.prepare(
    `SELECT payload_json
       FROM thought_steps
      WHERE cycle_id = ? AND generation = ? AND pass = ? AND kind = 'failure'`,
  ).all(cycleId, generation, pass) as Array<Record<string, unknown>>) {
    try {
      const payload = JSON.parse(String(row.payload_json ?? "")) as { reason?: unknown };
      if (payload.reason === "malformed") count += 1;
    } catch {
      /* A malformed failure row is not evidence of a structural retry. */
    }
  }
  return count;
}

/** The rows an afterglow reflects on, as they stand now; forgotten rows stay out. */
function afterglowInnerPass(sidecar: DatabaseSync, pass: AfterglowPass): import("../types.js").ThoughtInnerPass {
  if (pass.diary) return { kind: "afterglow", mode: "diary", diary: domusDiaryForThought(sidecar, pass.diary) };
  if (pass.session) return { kind: "afterglow", mode: "session", session: domusSessionForThought(sidecar, pass.session) };
  return {
    kind: "afterglow",
    mode: pass.mode === "rolling" ? "rolling" : "silence",
    rows: loadAfterglowRows(sidecar, pass.rowIds)
      .filter((row) => !row.redacted)
      .map((row) => ({ rowId: row.rowId, role: row.role, text: row.text, atMs: row.createdAtMs })),
  };
}

function publishedSettlement(
  draft: ThoughtSettlementDraft,
  settlementId: string,
  finalLicensedText: string | null,
): PublishedCognitiveSettlement {
  const speech = draft.speech;
  return {
    ...draft,
    settlementId,
    speech: {
      ...speech,
      finalLicensedText,
    },
  } as PublishedCognitiveSettlement;
}

function resultWithCounters(
  cycleId: string,
  generation: number,
  notice: string | null,
  counters: ThoughtAttemptCounters,
  options: {
    thoughtExecutionProvenance?: ThoughtExecutionProvenance;
    publicationReason?: PublicationRejectionReason;
    ownerObligationResolution?: OwnerObligationResolution;
    ownerSupersession?: Extract<import("../types.js").HandlerResult, { kind: "superseded" }>;
    effectContinuationId?: string;
  } = {},
): KernelRunResult {
  return {
    cycleId,
    generation,
    published: false,
    outboxId: null,
    infrastructureNotice: notice,
    thoughtModelAttempts: counters.thoughtModelAttempts,
    acceptedThoughtPasses: counters.acceptedThoughtPasses,
    composeCancelledAttempts: counters.composeCancelledAttempts,
    acceptedSettlements: 0,
    ...(options.thoughtExecutionProvenance
      ? { thoughtExecutionProvenance: options.thoughtExecutionProvenance }
      : {}),
    ...(options.publicationReason ? { publicationReason: options.publicationReason } : {}),
    ...(options.ownerObligationResolution
      ? { ownerObligationResolution: options.ownerObligationResolution }
      : {}),
    ...(options.effectContinuationId ? { effectContinuationId: options.effectContinuationId } : {}),
    ...(options.ownerSupersession
      ? { ownerSupersession: options.ownerSupersession }
      : {}),
  };
}

function currentGenerationIs(
  db: DatabaseSync,
  cycle: { cycleId: string; conversationId: string; generation: number },
): boolean {
  const current = getCurrentCycle(db, cycle.conversationId, { includeIdle: true });
  return current?.cycleId === cycle.cycleId && current.generation === cycle.generation;
}

type AttemptLifecycleBinding = {
  attemptId: string | null;
  attemptInputBasis: AttemptInputBasis | null;
};

function socialAttemptLifecycle(
  cycle: { triggerKind: CycleTriggerKind },
  eventKind: InboxEvent["kind"],
): boolean {
  // Owner room cycles retain the ordinary Owner lifecycle. An external
  // utterance absorbed into that cycle still owns the social attempt/basis
  // contract.
  return cycle.triggerKind === "external_message" || eventKind === "external_utterance";
}

function currentLifecycleIs(
  db: DatabaseSync,
  cycle: { cycleId: string; conversationId: string; generation: number },
  attemptBinding: AttemptLifecycleBinding | null,
  allowDetachedCompletionQueue = false,
): boolean {
  if (!currentGenerationIs(db, cycle)) {
    return allowDetachedCompletionQueue && activeThoughtMayFinishWhileDetachedCompletionQueued(db, cycle);
  }
  if (!attemptBinding) return true;
  if (!attemptBinding.attemptId || !attemptBinding.attemptInputBasis) return false;
  return currentAttemptIs(db, {
    cycleId: cycle.cycleId,
    generation: cycle.generation,
    attemptId: attemptBinding.attemptId,
    attemptInputBasis: attemptBinding.attemptInputBasis,
  });
}

function continuationTargetMatches(
  target: Readonly<Record<string, string>>,
  request: unknown,
): boolean {
  if (typeof request !== "object" || request === null || Array.isArray(request)) return false;
  const value = request as Record<string, unknown>;
  const nested = typeof value.request === "object" && value.request !== null && !Array.isArray(value.request)
    ? value.request as Record<string, unknown>
    : value;
  let matched = false;
  for (const key of ["projectId", "workspaceId"] as const) {
    const expected = target[key];
    if (!expected) continue;
    const actual = nested[key];
    if (typeof actual === "string") {
      if (actual !== expected) return false;
      matched = true;
    }
  }
  return matched;
}

function authorityDbForPacks(
  deps: KernelDeps,
  packs: import("../types.js").AuthorityPacks,
): DatabaseSync | undefined {
  return packs.currentness.binding ? deps.attentionDb : undefined;
}

const REVISABLE_AUTHORITY_CODES = new Set<AuthorityCode>([
  "CURRENTNESS_UNVERIFIED",
  "RECEIPT_REQUIRED",
  "RECEIPT_CONTRADICTS_CLAIM",
  "IN_FLIGHT_UNKNOWN",
  "STALE_STATE",
  "DRAFT_COMMITMENT_CONFLICT",
  "EMPTY_COMMITMENTS_WITH_DRAFT",
  "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN",
  "commitment_contract_failure",
]);

function revisable(codes: readonly string[]): boolean {
  return codes.length > 0 && codes.every((code) => REVISABLE_AUTHORITY_CODES.has(code as AuthorityCode));
}

function uniqueAuthorityCodes(codes: readonly string[]): AuthorityCode[] {
  return [...new Set(codes)].filter((code): code is AuthorityCode =>
    REVISABLE_AUTHORITY_CODES.has(code as AuthorityCode),
  );
}

/**
 * Production-parity export seam (behavior-identical).
 * Exposes the existing production Authority-revision policy so qualification
 * can derive revisability and objection codes from the canonical predicate
 * instead of duplicating the revisable-code list. No production behavior
 * changes: both helpers delegate to the exact production predicate/set above.
 */
export function isRevisableAuthorityRejection(codes: readonly string[]): boolean {
  return revisable(codes);
}

/** Production-parity export seam (behavior-identical): canonical objection projection. */
export function productionAuthorityObjectionCodes(codes: readonly string[]): AuthorityCode[] {
  return uniqueAuthorityCodes(codes);
}

/** Phase 02 kernel slice: assemble, perceive, run one Thought pass, validate, publish. */
export async function runCognitiveCycle(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  event: InboxEvent,
  deps: KernelDeps,
  options: { privateBudgetBinding?: PrivateBudgetDispatchBinding } = {},
): Promise<KernelRunResult> {
  const payload = payloadRecord(event);
  const afterglowPass = afterglowPassFromPayload(payload);
  const awakePass = awakePassFromPayload(payload);
  const nightPass = nightPassFromPayload(payload);
  const ownerCoverage = event.dispatchCoverage ?? captureOwnerDispatchCoverage(sidecar, event);
  const ownerResolutionFor = (
    attemptOutcome: OwnerObligationAttemptOutcome,
    options: Omit<Parameters<typeof resolveOwnerObligation>[0], "eventId" | "eventKind" | "coverage" | "attemptOutcome"> = {},
  ): OwnerObligationResolution => resolveOwnerObligation({
    eventId: event.id,
    eventKind: event.kind,
    coverage: ownerCoverage,
    attemptOutcome,
    ...options,
  });
  const directive = rememberDirective(payload);
  const rawCapacityWait = typeof payload.capacityWait === "object"
    && payload.capacityWait !== null
    && !Array.isArray(payload.capacityWait)
    ? payload.capacityWait as Record<string, unknown>
    : null;
  const capacityWait = rawCapacityWait
    && typeof rawCapacityWait.operationId === "string"
    && typeof rawCapacityWait.reason === "string"
    && typeof rawCapacityWait.waitStartedAtMs === "number"
    ? {
        operationId: rawCapacityWait.operationId,
        reason: rawCapacityWait.reason,
        waitStartedAtMs: rawCapacityWait.waitStartedAtMs,
        nextProbeAtMs: typeof rawCapacityWait.nextProbeAtMs === "number" ? rawCapacityWait.nextProbeAtMs : null,
        ...(typeof rawCapacityWait.exactDetail === "object"
          && rawCapacityWait.exactDetail !== null
          && !Array.isArray(rawCapacityWait.exactDetail)
          ? { exactDetail: rawCapacityWait.exactDetail as Record<string, string | number | null> }
          : {}),
      }
    : undefined;
  // Recovery/turn preflight is bounded and allowlist-gated. Admission errors
  // remain fail-soft: the durable nomination is retried on the next cycle.
  if (deps.origin !== "shadow") {
    try {
      runGovernedAdmissionCatchup(sidecar, { nowMs: deps.nowMs(), limit: 64 });
    } catch (error) {
      // The authoritative nomination remains durable and unadmitted.
      logMemoryAdmissionError(error);
    }
  }
  const requestedCycleId = typeof payload.cycleId === "string" ? payload.cycleId : null;
  const wake = getWake(sidecar, event.wakeId);
  if (!wake) throw new Error("wake_missing");
  // Periodic events carry the schedule occurrence explicitly. Other cycles
  // use the existing wake occurrence as the opaque Gate-A key.
  const debugOccurrenceId = typeof payload.periodicScheduleOccurrenceId === "string"
    && payload.periodicScheduleOccurrenceId.trim()
    ? payload.periodicScheduleOccurrenceId.trim()
    : wake.occurrenceId;
  const existingCycle = requestedCycleId ? getCycle(sidecar, requestedCycleId) : getCycle(sidecar, wake.cycleId) ?? getCurrentCycle(sidecar, event.conversationId);
  if (existingCycle && existingCycle.wakeId !== wake.wakeId) throw new Error("wake_cycle_conflict");
  let cycle = existingCycle ?? admitCycle(sidecar, {
      wakeId: wake.wakeId,
      conversationId: event.conversationId,
      triggerKind: triggerKind(event.kind),
      triggerRef: typeof payload.triggerRef === "string" ? payload.triggerRef : event.id,
      occupantId: typeof payload.occupantId === "string" ? payload.occupantId : null,
      authorityEpoch: typeof payload.authorityEpoch === "number" ? payload.authorityEpoch : 1,
      nowMs: deps.nowMs(),
    });
  const hasEffectContinuationCompletion = Object.prototype.hasOwnProperty.call(payload, "effectContinuationId");
  const effectContinuationCompletion = hasEffectContinuationCompletion
    ? effectContinuationFromCompletion(sidecar, {
        eventId: event.id,
        conversationId: event.conversationId,
        payload,
      })
    : null;
  if (hasEffectContinuationCompletion && !effectContinuationCompletion) {
    throw new Error("effect_completion_binding_invalid");
  }
  if (effectContinuationCompletion) {
    if (cycle.cycleId === effectContinuationCompletion.cycleId
      || cycle.generation <= effectContinuationCompletion.generation) {
      throw new Error("effect_completion_cycle_binding_invalid");
    }
    seedThoughtAttemptCountersEffectRounds(
      sidecar,
      cycle.cycleId,
      cycle.generation,
      MAX_EFFECT_ROUNDS - effectContinuationCompletion.remainingEffectRounds,
    );
  }
  const originProfile = resolveOriginProfile(sidecar, event, cycle);
  if (!originProfile) throw new Error("origin_profile_unavailable");
  const dueCommitment = commitmentDueProjection(nuclear, cycle, payload);
  const publicPresenceEnabled = isAutonomousPublicPresenceOpportunity({
    cycleTriggerKind: cycle.triggerKind,
    wakeSourceKind: wake.sourceKind,
    eventKind: event.kind,
    channel: payload.channel,
    occupantId: cycle.occupantId,
    configuredOwnerId: payload.ownerId,
    reconciling: wake.state === "reconciling",
    passKind: afterglowPass ? "afterglow" : awakePass ? "awake" : nightPass ? "night" : null,
  });
  const publicPresence = publicPresenceEnabled
    ? readPublicPresenceContext(sidecar, deps.nowMs())
    : undefined;
  let triggerEvidence = typeof payload.evidenceRowId === "string"
    ? getConversationEvidence(sidecar, payload.evidenceRowId)
    : null;
  if (triggerEvidence) cycle = appendCycleLogIds(sidecar, cycle.cycleId, [triggerEvidence.rowId], deps.nowMs());
  // R1 continuity recovery: a repair event carries no new Owner message. When
  // it carries validated recovery references, project the mechanical frame
  // into Thought input and cycle coverage, and address the primary
  // outstanding row as the current trigger. The Host states only the factual
  // continuity situation; Thought authors all meaning and response. Legacy
  // repairs without references run as plain recovery triggers (unchanged).
  let continuityRecovery: ThoughtContinuityRecovery | null = null;
  if (event.kind === "repair") {
    const resolved = resolveRepairContinuityRecovery(sidecar, event);
    continuityRecovery = resolved.frame;
    cycle = appendCycleLogIds(
      sidecar,
      cycle.cycleId,
      resolved.evidence.map((item) => item.rowId),
      deps.nowMs(),
    );
    triggerEvidence = resolved.primary;
  }
  const externalCycle = cycle.triggerKind === "external_message" || event.kind === "external_utterance";
  const externalDestination = externalCycle ? externalDestinationFor(payload) : null;
  const ownerRoomContextPresent = Object.prototype.hasOwnProperty.call(payload, "ownerRoomContext");
  const ownerRoomDestination = !externalCycle
    ? ownerRoomDestinationFor(cycle.conversationId, payload, triggerEvidence)
    : null;
  if (ownerRoomContextPresent && !ownerRoomDestination) {
    throw new Error("owner_room_context_invalid");
  }
  const externalAudience = externalDestination
    ? externalDestination.kind === "external_dm"
      ? { kind: "dm" as const, principalId: externalDestination.principalId }
      : { kind: "room" as const, roomId: externalDestination.roomId }
    : undefined;
  const thoughtAudience = ownerRoomDestination
    ? { kind: "room" as const, roomId: ownerRoomDestination.roomId }
    : externalAudience;
  const effectiveThoughtAudience = thoughtAudience ?? { kind: "owner_private" as const };
  const ownerRoomOwnerId = ownerRoomDestination && typeof triggerEvidence?.speakerPrincipalId === "string"
    ? triggerEvidence.speakerPrincipalId.trim()
    : "";
  const availableDestinations = ownerRoomDestination && ownerRoomOwnerId
    ? listAvailableSocialDestinations(nuclear, { nowMs: deps.nowMs(), ownerId: ownerRoomOwnerId })
    : externalCycle
      ? listAvailableSocialDestinations(nuclear, { nowMs: deps.nowMs() })
      : undefined;
  const botParticipantId = externalCycle
    && triggerEvidence?.speakerKind === "external_bot"
    && typeof triggerEvidence.speakerPrincipalId === "string"
    && triggerEvidence.speakerPrincipalId.trim()
    ? triggerEvidence.speakerPrincipalId.trim()
    : null;
  const externalParticipantId = externalDestination?.kind === "external_dm"
    ? externalDestination.principalId
    : typeof triggerEvidence?.speakerPrincipalId === "string"
      && (triggerEvidence.speakerKind === "external_human" || triggerEvidence.speakerKind === "external_bot")
      ? triggerEvidence.speakerPrincipalId.trim()
      : null;
  const externalOwnerId = typeof payload.ownerId === "string" && payload.ownerId.trim()
    ? payload.ownerId.trim()
    : cycle.occupantId?.trim() || undefined;
  const delegatedClassFor = (
    operationKind: string,
    request: unknown,
  ) => {
    const record = recordRequest(request);
    if (operationKind !== "evidence.read") {
      return socialOperationClassForOperation(operationKind);
    }
    const artifactId = typeof record?.artifactId === "string" ? record.artifactId.trim() : "";
    const representationId = typeof record?.representationId === "string" ? record.representationId.trim() : "";
    if (!artifactId || !representationId) return null;
    const source = socialEvidenceSourceForConversation(nuclear, sidecar, {
      artifactId,
      representationId,
      conversationId: cycle.conversationId,
    });
    return socialOperationClassForOperation(operationKind, source ?? undefined);
  };
  const enforceExternalDelegation = (
    operationKind: string,
    request: unknown,
    delegationRef: string | null,
  ): void => {
    if (!externalCycle) return;
    const operationClass = delegatedClassFor(operationKind, request);
    if (!externalParticipantId || !operationClass) {
      throw new CapabilityUnavailableError("social_operation_delegation_required");
    }
    const result = recheckSocialOperationDelegation(nuclear, {
      ownerId: externalOwnerId,
      principalId: externalParticipantId,
      conversationId: cycle.conversationId,
      operationClass,
      delegationRef,
      nowMs: deps.nowMs(),
    });
    if (!result.ok) {
      throw new CapabilityUnavailableError(`social_delegation_${result.reason}`);
    }
  };
  const executeDelegatedObservation = async (request: import("../types.js").ObservationRequest): Promise<Observation> => {
    const delegationRef = delegationRefForRequest(sidecar, request.request, cycle.conversationId);
    const bound = withDelegationRef(request, delegationRef);
    enforceExternalDelegation(bound.kind, bound.request, bound.delegationRef ?? null);
    return deps.executeObservation(bound);
  };
  const executeDelegatedEffect = async (
    proposal: EffectProposal,
    control?: EffectExecutionControl,
  ): Promise<EffectReceipt> => {
    const delegationRef = delegationRefForRequest(sidecar, proposal.request, cycle.conversationId);
    const bound = withDelegationRef(proposal, delegationRef);
    enforceExternalDelegation(bound.kind, bound.request, bound.delegationRef ?? null);
    return deps.executeEffect(bound, control);
  };
  const socialResourcePrecheck = botParticipantId
    ? SOCIAL_RESOURCE_FUSE.admit({
        conversationKey: cycle.conversationId,
        consequenceChainId: wake.consequenceChainId ?? `wake:${wake.wakeId}`,
        lifecycleId: `${cycle.cycleId}:${cycle.generation}`,
        botParticipantId,
        roomId: externalDestination?.kind === "room" ? externalDestination.roomId : undefined,
        nowMs: deps.nowMs(),
        usage: { computeMs: 0, outputTokens: 0, networkRequests: 0 },
      })
    : null;
  let externalBinding:
    | ReturnType<typeof buildExternalDmAuthorityBinding>
    | ReturnType<typeof buildRoomAuthorityBinding>
    | null = null;
  if (externalDestination) {
    try {
      externalBinding = externalDestination.kind === "external_dm"
        ? buildExternalDmAuthorityBinding(nuclear, {
          principalId: externalDestination.principalId,
          channelId: externalDestination.channelId ?? event.conversationId,
          nowMs: deps.nowMs(),
        })
        : buildRoomAuthorityBinding(nuclear, {
          ownerId: typeof payload.ownerId === "string" && payload.ownerId.trim()
            ? payload.ownerId
            : cycle.conversationId,
          roomId: externalDestination.roomId,
          guildId: externalDestination.guildId,
          channelId: externalDestination.channelId,
          nowMs: deps.nowMs(),
        });
    } catch {
      // The final publication path remains fail-closed if the coherent bundle
      // cannot be reconstructed from the current authority owner.
      externalBinding = null;
    }
  }
  cycle = updateCycleState(sidecar, cycle.cycleId, "assembling", deps.nowMs());
  const admittedCycle = cycle;
  let attemptLifecycleBinding: AttemptLifecycleBinding | null = null;
  if (socialAttemptLifecycle(admittedCycle, event.kind)) {
    const freshness = getCycleFreshnessState(sidecar, admittedCycle.cycleId);
    attemptLifecycleBinding = {
      attemptId: freshness.attemptId,
      attemptInputBasis: freshness.attemptInputBasis,
    };
  }
  const hasDurableObservationBinding = typeof payload.periodicScheduleOccurrenceId === "string"
    || Object.prototype.hasOwnProperty.call(payload, "observationsCapture");
  const durableObservations = hasDurableObservationBinding
    ? resolveObservationBinding(sidecar, payload, admittedCycle)
    : null;
  if (durableObservations?.kind === "unknown") {
    // A periodic/recovery binding is an explicit durable input contract. Do
    // not turn an unknown binding into an empty set or reacquire observations.
    throw new Error(`observation_binding_unknown:${durableObservations.reason}`);
  }
  const boundObservations = durableObservations?.kind === "known"
    ? durableObservations.observations
    : null;
  const existingPublication = getPublishedSettlementIdentity(
    sidecar,
    admittedCycle.cycleId,
    admittedCycle.generation,
  );
  if (existingPublication) {
    const counters = getThoughtAttemptCounters(sidecar, admittedCycle.cycleId, admittedCycle.generation);
    const stored = sidecar.prepare(
      "SELECT settlement_id, payload_json FROM settlements WHERE cycle_id = ? AND generation = ? LIMIT 1",
    ).get(admittedCycle.cycleId, admittedCycle.generation) as { settlement_id?: unknown; payload_json?: unknown } | undefined;
    let storedSpeechMode: "none" | "draft" | undefined;
    let storedCommitments: ConversationalCommitment[] | undefined;
    let storedRemainingConsequence = false;
    try {
      const value = JSON.parse(String(stored?.payload_json ?? "")) as Record<string, unknown>;
      const speech = value.speech as Record<string, unknown> | undefined;
      if (speech?.mode === "none" || speech?.mode === "draft") storedSpeechMode = speech.mode;
      const commitments = value.commitments as Record<string, unknown> | undefined;
      if (Array.isArray(commitments?.conversational)) {
        storedCommitments = commitments.conversational.filter((item): item is ConversationalCommitment =>
          item === "answer" || item === "ask" || item === "acknowledge"
            || item === "disagree" || item === "hold" || item === "silence",
        );
      }
      const operations = value.operations as Record<string, unknown> | undefined;
      storedRemainingConsequence = Array.isArray(operations?.intentsStillInFlight)
        && operations.intentsStillInFlight.length > 0;
    } catch {
      // A malformed historical settlement cannot manufacture an Owner claim.
    }
    const ownerObligationResolution = ownerResolutionFor("published", {
      speechMode: storedSpeechMode,
      conversationalCommitments: storedCommitments,
      settlementId: typeof stored?.settlement_id === "string" ? stored.settlement_id : null,
      outboxId: existingPublication.outboxId,
      deliveryOwnerExists: existingPublication.outboxId !== null && Boolean(sidecar.prepare(
        "SELECT outbox_id FROM speech_outbox WHERE outbox_id = ?",
      ).get(existingPublication.outboxId)),
      remainingConsequence: storedRemainingConsequence,
    });
    return {
      cycleId: admittedCycle.cycleId,
      generation: admittedCycle.generation,
      published: true,
      outboxId: existingPublication.outboxId,
      infrastructureNotice: null,
      thoughtModelAttempts: counters.thoughtModelAttempts,
      acceptedThoughtPasses: counters.acceptedThoughtPasses,
      composeCancelledAttempts: counters.composeCancelledAttempts,
      acceptedSettlements: 0,
      thoughtExecutionProvenance: UNKNOWN_EXECUTION_PROVENANCE,
      ownerObligationResolution,
    };
  }
  let cycleExecutionProvenance: ThoughtExecutionProvenance | null = null;
  const currentExecutionProvenance = (): ThoughtExecutionProvenance =>
    cycleExecutionProvenance ?? UNKNOWN_EXECUTION_PROVENANCE;
  const staleOwnerResultOptions = () => {
    const ownerSupersession = proveExactOwnerSupersession(sidecar, event, ownerCoverage);
    return {
      thoughtExecutionProvenance: currentExecutionProvenance(),
      ownerObligationResolution: ownerResolutionFor("failed"),
      ...(ownerSupersession ? { ownerSupersession } : {}),
    };
  };
  const emitFailure = async (
    reason: string,
    failureCode?: string | null,
    terminal?: ThoughtTerminalDescriptor,
  ): Promise<KernelRunResult> => {
    const counters = getThoughtAttemptCounters(sidecar, admittedCycle.cycleId, admittedCycle.generation);
    if (!currentLifecycleIs(sidecar, admittedCycle, attemptLifecycleBinding, deps.origin !== "shadow")) {
      return resultWithCounters(
        admittedCycle.cycleId,
        admittedCycle.generation,
        null,
        counters,
        staleOwnerResultOptions(),
      );
    }
    recordInfrastructureFailureDiagnostic(sidecar, {
      ownerId: typeof payload.ownerId === "string" ? payload.ownerId : admittedCycle.occupantId,
      channel: typeof payload.channel === "string" ? payload.channel : "discord",
      threadId: typeof payload.threadId === "string" ? payload.threadId : admittedCycle.conversationId,
      conversationId: admittedCycle.conversationId,
      cycleId: admittedCycle.cycleId,
      generation: admittedCycle.generation,
      reason,
      failureCode,
      // Typed terminal drives Owner presentation; reason preserves exact
      // legacy C3/key behavior. C3 input below intentionally stays on the
      // pre-existing reason string: no C3 admission expansion.
      ...(terminal ? { terminal } : {}),
      origin: deps.origin,
      trigger: deliveryIntentFor(admittedCycle, payload, "system_notice", originProfile.triggerKind, undefined, undefined, undefined, triggerEvidence, continuityRecovery, sidecar).trigger,
      deliveryLane: deliveryIntentFor(admittedCycle, payload, "system_notice", originProfile.triggerKind, undefined, undefined, undefined, triggerEvidence, continuityRecovery, sidecar).deliveryLane,
    });
    // This is attempt diagnostics only. Durable owner recovery decides later
    // whether a terminal Owner-facing notice is warranted.
    updateCycleState(sidecar, admittedCycle.cycleId, "silent", deps.nowMs());
    return resultWithCounters(admittedCycle.cycleId, admittedCycle.generation, null, counters, {
      thoughtExecutionProvenance: currentExecutionProvenance(),
      ownerObligationResolution: ownerResolutionFor("failed"),
    });
  };

  const invocationLicenses = externalBinding?.licenseRefs ?? [];
  const currentCapabilityReality = (): CapabilityReality => withPublicPresenceCapability(
    deps.refreshCapabilityReality?.({
      audience: effectiveThoughtAudience,
      licenses: invocationLicenses,
      nowMs: deps.nowMs(),
    }) ?? deps.capabilityReality,
    publicPresenceEnabled,
  );
  let ownerMessage = originProfile.triggerKind === "self_change_result" || originProfile.triggerKind === "domus_notification" ? "" : typeof payload.ownerMessage === "string"
    ? payload.ownerMessage
    : triggerEvidence?.text ?? listConversationEvidence(sidecar, cycle.conversationId, { limit: 1 }).at(-1)?.text ?? "";
  const perceive = async (): Promise<Observation[]> => {
    if (boundObservations) return boundObservations;
    const resolveAttachments = deps.resolveAttachmentObservations ?? resolveAttachmentObservations;
    const attachmentSources = event.kind === "owner_utterance"
      ? ownerAttachmentSources(sidecar, event, payload, cycle)
      : [];
    const attachmentCapabilityReality = attachmentSources.length > 0 ? currentCapabilityReality() : null;
    const attachmentObservations: Observation[] = [];
    if (attachmentCapabilityReality) {
      for (const source of attachmentSources) {
        attachmentObservations.push(...await resolveAttachments({
          nuclear,
          ownerId: typeof payload.ownerId === "string" && payload.ownerId.trim()
            ? payload.ownerId.trim()
            : cycle.occupantId,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          sourceMessageEntityUuid: source.sourceMessageEntityUuid,
          deliveryReservationEntityUuid: event.id,
          attachments: source.attachments,
          attachmentTextEnabled: attachmentCapabilityReality.attachmentText,
          visionAccess: attachmentCapabilityReality.vision,
          imageTransport: deps.visionTransport,
          observationDb: sidecar,
        }));
      }
    }
    try {
      const perceived = await adaptPerception({
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        ownerMessage,
        runPerception: deps.runPerception,
      });
      return [...suppliedObservations(payload, cycle), ...attachmentObservations, ...perceived];
    } catch {
      return [...suppliedObservations(payload, cycle), ...attachmentObservations];
    }
  };
  let observationsForThought = await perceive();
  let inFlight = listInFlightForThoughtCycle(sidecar, cycle.cycleId);
  let counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
  let pass = counters.acceptedThoughtPasses + 1;
  let structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
  let authorityObjections: AuthorityCode[] = [];
  let settlementRevisionFeedback: SettlementRevisionFeedback | undefined;
  let thoughtDeadlineAtMs = deps.nowMs() + ORDINARY_THOUGHT_BUDGET_MS;
  const beginThoughtLeg = () => {
    thoughtDeadlineAtMs = deps.nowMs() + ORDINARY_THOUGHT_BUDGET_MS;
  };
  let structuralFeedback: ThoughtStructuralFeedback | null = null;
  const projectionCache = new ProjectionCache<AllocatedThoughtProjection>();
  let cycleTokenMetrics = createThoughtCycleTokenMetrics();
  let lastThoughtRequestId: string = randomUUID();
  let lastThoughtPass = pass;
  let lastDispatchTruth: ThoughtExecutionDispatchTruth = "unknown";
  const discoveredAuthorableConcernIds = new Set<string>();

  try {
    for (;;) {
    counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
    const zeroBudgetEffectCompletion = effectContinuationCompletion?.remainingEffectRounds === 0;
    const completionVerificationUsed = zeroBudgetEffectCompletion && inFlight.some((item) =>
      item.operationKind === "workspace.verify" || item.operationKind === "candidate_verification",
    );
    const effectContinuationInput = zeroBudgetEffectCompletion
      ? {
          effectId: effectContinuationCompletion.effectId,
          purpose: effectContinuationCompletion.purpose,
          target: effectContinuationCompletion.target,
          terminalClass: effectContinuationCompletion.terminalClass ?? "UNKNOWN",
          effectTruth: effectContinuationCompletion.effectTruth ?? "unknown",
          deadlineAtMs: effectContinuationCompletion.deadlineAtMs,
          remainingEffectRounds: effectContinuationCompletion.remainingEffectRounds,
          allowVerification: !completionVerificationUsed,
        }
      : undefined;
    const settlementOnly = counters.effectRounds >= MAX_EFFECT_ROUNDS && !zeroBudgetEffectCompletion;
    structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
    if (deps.renewConversationCognition && !deps.renewConversationCognition()) {
      // The conversation cognition holder was lost (expiry + takeover by a
      // newer turn). Stop at once: no further provider work may dispatch
      // under a lost holder. The winning turn owns the conversation now.
      throw new Error(CONVERSATION_COGNITION_OCCUPIED);
    }
    if (!currentLifecycleIs(sidecar, cycle, attemptLifecycleBinding, deps.origin !== "shadow")) {
      return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, staleOwnerResultOptions());
    }
    if (socialResourcePrecheck && !socialResourcePrecheck.accepted) {
      const fact: OperationalExhaustion = socialResourcePrecheck.fact;
      return emitFailure(
        `social_${fact.operational}`,
        null,
        makeThoughtTerminal("budget_exhausted", {
          codes: [fact.operational],
          stage: "social_resource_fuse",
        }),
      );
    }
    if (deps.nowMs() >= thoughtDeadlineAtMs) {
      return emitFailure(
        "thought_deadline",
        undefined,
        makeThoughtTerminal("thought_deadline", { codes: ["thought_deadline"], stage: "cycle_deadline" }),
      );
    }
    if (counters.acceptedThoughtPasses >= MAX_THOUGHT_PASSES || counters.thoughtModelAttempts >= MAX_THOUGHT_MODEL_ATTEMPTS) {
      return emitFailure(
        "pass_exhausted",
        undefined,
        makeThoughtTerminal("budget_exhausted", { codes: ["pass_exhausted"], stage: "cycle_budget" }),
      );
    }
    const rawConversationIds = listConversationEvidence(sidecar, cycle.conversationId, { limit: 12 }).map((r) => r.rowId);
    // Bounded Owner-private cross-surface recall: trusted-room evidence for
    // the same authenticated Owner becomes a retrieval candidate. Room and
    // external cycles never receive a scope (see ownerPrivateCrossSurfaceScope).
    const crossSurfaceScope = ownerPrivateCrossSurfaceScope(nuclear, {
      thoughtAudience,
      ownerId: typeof payload.ownerId === "string" ? payload.ownerId : cycle.occupantId,
    });
    inFlight = listInFlightForThoughtCycle(sidecar, cycle.cycleId);
    const invocationCapabilityReality = currentCapabilityReality();
    // A5: the vector recall tier needs the query embedded locally first.
    const queryVector = deps.embedQuery && typeof ownerMessage === "string" && ownerMessage.trim()
      ? await deps.embedQuery(ownerMessage).catch(() => null)
      : null;
    const senseOptions = { nowMs: deps.nowMs(), conversationId: cycle.conversationId, dataDir: deps.dataDir };
    const ownerWeather = effectiveThoughtAudience.kind === "owner_private" && !externalCycle
      ? await ownerWeatherForPass({ nowMs: deps.nowMs() })
      : undefined;
    const sensedFacts = effectiveThoughtAudience.kind === "owner_private" && !externalCycle ? readSenseFacts(sidecar, senseOptions) : [];
    const senseBands = senseBandsForDeclines(sensedFacts);
    let shownReactionIds: string[] = [];
    const thoughtInputOptions = {
      sidecar,
      cycle,
      triggerKindOverride: originProfile.triggerKind,
      ...(originProfile.triggerKind === "self_change_result" ? { selfChangeResult: selfChangeResultForThought(sidecar, event, originProfile.originCycleId) } : {}),
      ...(originProfile.triggerKind === "domus_notification" && effectiveThoughtAudience.kind === "owner_private"
        ? (() => {
            const home = domusHomeFor(sidecar, event, originProfile.originCycleId);
            const gameOnly = domusGameOnlyFor(sidecar, event, originProfile.originCycleId);
            return { domus: domusForThought(sidecar, event, originProfile.originCycleId, { enabled: env.domusActEnabled, nowMs: deps.nowMs() }),
              ...(home && !gameOnly ? { homeConversationId: home } : {}), ...(gameOnly ? { domusGameOnly: true } : {}) };
          })() : {}),
      ...(effectiveThoughtAudience.kind === "owner_private" && !externalCycle && originProfile.triggerKind !== "domus_notification"
        ? (() => {
            const nowMs = deps.nowMs();
            const game = domusNowForThought(sidecar, nowMs);
            const places = thoughtPlaces(sidecar, nuclear, { nowMs, ...(originProfile.triggerKind === "owner_message" ? { here: "owner_dm" as const } : {}),
              ...(deps.dataDir ? { vaultDir: vaultDirFor(deps.dataDir) } : {}),
              ...(game ? { game: { world: game.world, live: game.live } } : {}) });
            const home = deps.dataDir ? homeForThought(sidecar, homeRootFor(deps.dataDir), nowMs) : undefined;
            const will = willForThought(sidecar, nowMs);
            return { ...(places ? { places } : {}), ...(home ? { home } : {}), ...(will ? { will } : {}) };
          })() : {}),
      ...(ownerWeather ? { ownerWeather } : {}),
      ...(externalCycle && externalParticipantId ? (() => {
        const teacher = teacherForThought(sidecar, externalParticipantId);
        return teacher ? { teacher } : {};
      })() : {}),
      triggerText: ownerMessage,
      triggerEvidence,
      ...(continuityRecovery ? { continuityRecovery } : {}),
      constitution: deps.readConstitution?.() ?? deps.constitution,
      capabilityReality: invocationCapabilityReality,
      wakeCauses: buildThoughtWakeCauses(sidecar, event, wake, cycle, originProfile.triggerKind),
      previousInvocationDelta: "unknown",
      thoughtLegDeadlineAtMs: thoughtDeadlineAtMs,
      clock: {
        nowMs: deps.nowMs(),
        timeZone: env.ownerTimeZone,
        currentRowIds: cycleOwnerRowIds(sidecar, payload, cycle),
      },
      claimQuietFacts: deps.origin !== "shadow",
      ...(afterglowPass ? { innerPass: afterglowInnerPass(sidecar, afterglowPass) } : {}),
      ...(awakePass ? { innerPass: { kind: "awake" as const, agenda: buildInnerAgenda(sidecar, awakePass, deps.nowMs(),
        effectiveThoughtAudience.kind === "owner_private" && !externalCycle && deps.origin !== "shadow" && deps.identityOwnerId
          ? { cycleId: cycle.cycleId, ownerId: deps.identityOwnerId } : undefined) } } : {}),
      ...(nightPass ? {
        innerPass: {
          kind: "night" as const,
          agenda: buildNightAgenda(sidecar, { pass: nightPass, identityStore: identityStoreFor(nuclear, deps), nowMs: deps.nowMs() }),
        },
      } : {}),
      ...(effectiveThoughtAudience.kind === "owner_private" && !externalCycle
        ? { growth: growthForThought(sidecar, identityStoreFor(nuclear, deps), deps.nowMs()), senses: sensesForThought(sidecar, {...senseOptions,ownerId:deps.identityOwnerId}, sensedFacts),
            ...(deps.identityOwnerId ? { attention: readThoughtAttention(sidecar,deps.identityOwnerId,cycle.cycleId,deps.nowMs()) } : {}) }
        : {}),
      ...(externalCycle && deps.identityOwnerId ? {attention:readThoughtAttention(sidecar,deps.identityOwnerId,cycle.cycleId,deps.nowMs(),false)}:{}),
      ...pendingForgetInput(sidecar, cycle.conversationId, {
        ownerTurn: effectiveThoughtAudience.kind === "owner_private" && !externalCycle
          && !afterglowPass && !awakePass && !nightPass && triggerEvidence?.role === "owner",
        nowMs: deps.nowMs(),
      }),
      ...(() => {
        const gameOnlySurface = originProfile.triggerKind === "domus_notification"
          && domusGameOnlyFor(sidecar, event, originProfile.originCycleId);
        if (effectiveThoughtAudience.kind !== "owner_private" || externalCycle || gameOnlySurface) return {};
        const surface: {
          reactions?: ReturnType<typeof unshownOwnerBubbleReactions>["facts"];
          returning?: NonNullable<ReturnType<typeof returningForThought>>;
        } = {};
        const pending = unshownOwnerBubbleReactions(nuclear, sidecar);
        if (pending.facts.length > 0) {
          shownReactionIds = pending.ids;
          surface.reactions = pending.facts;
        }
        const nowMs = deps.nowMs();
        const returning = afterglowPass
          ? returningForThought(sidecar, { mode: "afterglow", conversationId: cycle.conversationId, nowMs })
          : !awakePass && !nightPass && originProfile.triggerKind === "owner_message"
            ? returningForThought(sidecar, {
              mode: "owner_message",
              conversationId: cycle.conversationId,
              currentRowId: triggerEvidence?.rowId ?? null,
              nowMs,
            })
            : null;
        if (returning) surface.returning = returning;
        return surface;
      })(),
      ...(settlementOnly ? { settlementOnly: true } : {}),
      ...(effectContinuationInput ? { effectContinuation: effectContinuationInput } : {}),
      ...(capacityWait ? { capacityWait } : {}),
      ...(publicPresence === undefined ? {} : { publicPresence }),
      observations: observationsForThought,
      inFlight,
      runtimeCondition: { thoughtUnavailable: false },
      ...(queryVector ? { queryVector } : {}),
      rememberDirective: directive,
      authorityObjections,
      derivedStore: deps.derivedStore,
      authorityDb: deps.attentionDb,
      audience: effectiveThoughtAudience,
      ...(ownerRoomDestination ? { authenticatedOwner: true } : {}),
      ...(crossSurfaceScope ? { crossSurfaceConversationIds: crossSurfaceScope } : {}),
      ...(availableDestinations === undefined ? {} : { availableDestinations }),
      licenses: [...invocationLicenses],
      ...(dueCommitment ? { commitmentDue: dueCommitment } : {}),
      ...(discoveredAuthorableConcernIds.size > 0
        ? { concernAuthorableTargetAppend: [...discoveredAuthorableConcernIds] }
        : {}),
    };
    const sourceCapture = captureThoughtSourcePackage(thoughtInputOptions);
    const sourceCurrentness = sourceCapture.sourceCurrentness;
    const passKey = semanticPassKey({
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      pass,
      observationsCount: observationsForThought.length,
      inFlightCount: inFlight.length,
      authorityObjectionsHash: hashAuthorityObjections(authorityObjections),
      composeLogIds: rawConversationIds,
      rememberDirectivePresent: Boolean(directive),
      sourceCurrentnessKey: hashThoughtSourceCurrentness(sourceCurrentness),
      settlementOnly,
    });

    let allocated: AllocatedThoughtProjection;
    try {
      if (structuralFeedback && projectionCache.has(passKey)) {
        const cached = projectionCache.get(passKey)!;
        const messages = thoughtMessagesForProjection(cached.projected, structuralFeedback);
        allocated = {
          ...cached,
          messages,
        };
      } else {
        const input = buildThoughtInput({ ...thoughtInputOptions, sourceCapture });
        storeObservations(sidecar, input, deps.nowMs());
        allocated = allocateThoughtProjection({
          sidecar,
          continuityDb: getContinuityFor(nuclear),
          thoughtInput: input,
          requestId: randomUUID(),
          structuralFeedback: structuralFeedback ?? undefined,
          observabilityDb: deps.observabilityDb,
        });
        projectionCache.set(passKey, allocated);
      }
      if (shownReactionIds.length > 0 && allocated.projected.reactions !== undefined) {
        markOwnerBubbleReactionsShown(nuclear, shownReactionIds);
      }
    } catch (err) {
      if (err instanceof RequiredOverflowError) {
        const tokenFailure = err.failure?.unit === "tokens";
        if (deps.observabilityDb) {
          try {
            recordDiagnostic(deps.observabilityDb, {
              cycleId: cycle.cycleId,
              generation: cycle.generation,
              requestId: randomUUID(),
              pass,
              code: "context_allocation_required_overflow",
              stage: "allocation",
              dispatchTruth: "not_sent",
              requiredOverflowSection: err.section,
              allocationFailure: err.failure,
              estimatedInputTokens: tokenFailure ? err.estimatedInputTokens : null,
              semanticBudgetTokens: tokenFailure ? err.semanticBudgetTokens : null,
              overflowTokens: tokenFailure
                ? Math.max(0, err.estimatedInputTokens - err.semanticBudgetTokens)
                : null,
              createdAtMs: deps.nowMs(),
            });
          } catch {
            // ignore
          }
        }
        cycleExecutionProvenance = mergeExecutionProvenance(
          cycleExecutionProvenance,
          NOT_SENT_EXECUTION_PROVENANCE,
        );
        lastDispatchTruth = cycleExecutionProvenance.dispatchTruth;
        return emitFailure(
          "context_allocation_required_overflow",
          undefined,
          makeThoughtTerminal("allocation", {
            codes: ["context_allocation_required_overflow"],
            stage: "allocation",
          }),
        );
      }
      throw err;
    }

    cycle = updateCycleState(sidecar, cycle.cycleId, "thinking", deps.nowMs());
    if (counters.thoughtModelAttempts >= MAX_THOUGHT_MODEL_ATTEMPTS) {
      return emitFailure(
        "pass_exhausted",
        undefined,
        makeThoughtTerminal("budget_exhausted", { codes: ["pass_exhausted"], stage: "cycle_budget" }),
      );
    }
    const controller = new AbortController();
    const activeThought = registerActiveThought(cycle.conversationId, cycle.cycleId, cycle.generation, controller);
    incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "thoughtModelAttempts");
    const structuralRetryWouldSchedule =
      structuralRetriesForPass < 2 && counters.thoughtModelAttempts < MAX_THOUGHT_MODEL_ATTEMPTS;
    const invocation = await runThoughtModel(allocated.projected, deps, {
      pass,
      signal: activeThought.signal,
      deadlineAtMs: thoughtDeadlineAtMs,
      structuralFeedback: structuralFeedback ?? undefined,
      settlementRevisionFeedback,
      audience: effectiveThoughtAudience,
      maxTokens: structuralFeedback
        ? STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS
        : undefined,
      nowMs: deps.nowMs(),
      conversationId: cycle.conversationId,
      wakeId: cycle.wakeId,
      privateBudgetBinding: options.privateBudgetBinding,
      concernInspectAuthority: {
        refs: new Set(Object.keys(sourceCapture.concernInspectDependencies)),
        expectations: sourceCapture.concernInspectDependencies,
        discoverAllowed: thoughtAudience === undefined,
      },
      salvageOnFailure: !structuralRetryWouldSchedule,
    });
    lastThoughtRequestId = invocation.requestId;
    lastThoughtPass = pass;
    cycleExecutionProvenance = mergeExecutionProvenance(
      cycleExecutionProvenance,
      invocation.thoughtExecutionProvenance ?? UNKNOWN_EXECUTION_PROVENANCE,
    );
    lastDispatchTruth = cycleExecutionProvenance.dispatchTruth;
    if (typeof invocation.inputTokens === "number") {
      cycleTokenMetrics = observeThoughtCycleInput(cycleTokenMetrics, invocation.inputTokens);
    }
    const cancellationReason = activeThought.cancellationReason;
    activeThought.unregister();
    const nowAfterThoughtMs = deps.nowMs();
    storeThoughtStep(sidecar, invocation.output, nowAfterThoughtMs);
    const providerCapture = invocation.providerFailureCapture ?? invocation.providerUsageCapture;
    const debugCode = cancellationReason || invocation.cancelled
      ? "cancelled"
      : invocation.correctionScopeViolation || invocation.malformed
        ? "parser_malformed"
        : invocation.thoughtDeadline
          ? "attention_deadline"
          : invocation.unavailable
            ? "provider_unavailable"
            : invocation.providerUsageCapture && invocation.output.kind !== "failure"
              ? "provider_returned"
              : null;
    if (debugCode) {
      captureProjectedThoughtDebug({
        db: deps.observabilityDb,
        occurrenceId: debugOccurrenceId,
        projected: allocated.projected,
        code: debugCode,
        providerFailure: providerCapture,
        nowMs: nowAfterThoughtMs,
      });
    }

    if (cancellationReason || invocation.cancelled) {
      if (cancellationReason === "compose" && currentGenerationIs(sidecar, cycle)) {
        incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "composeCancelledAttempts");
        cycle = getCycle(sidecar, cycle.cycleId) ?? cycle;
        if (attemptLifecycleBinding) {
          const freshness = getCycleFreshnessState(sidecar, cycle.cycleId);
          attemptLifecycleBinding = {
            attemptId: freshness.attemptId,
            attemptInputBasis: freshness.attemptInputBasis,
          };
        }
        const latest = listConversationEvidence(sidecar, cycle.conversationId, { limit: 1000 }).at(-1);
        triggerEvidence = latest ?? triggerEvidence;
        ownerMessage = latest?.text ?? ownerMessage;
        observationsForThought = await perceive();
        inFlight = listInFlightForThoughtCycle(sidecar, cycle.cycleId);
        authorityObjections = [];
        settlementRevisionFeedback = undefined;
        structuralFeedback = null;
        counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
        pass = counters.acceptedThoughtPasses + 1;
        structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
        continue;
      }
      counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
      return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, staleOwnerResultOptions());
    }

    if (invocation.correctionScopeViolation) {
      if (deps.observabilityDb && invocation.providerFailureCapture) {
        try {
          recordDiagnostic(deps.observabilityDb, {
            cycleId: cycle.cycleId,
            generation: cycle.generation,
            requestId: invocation.output.requestId,
            pass,
            code: "parser_malformed",
            stage: "parser",
            dispatchTruth: invocation.providerFailureCapture.dispatchTruth,
            semanticProjectionHash: allocated.hashes.semanticProjectionHash,
            dispatchMessagesHash: allocated.hashes.dispatchMessagesHash,
            providerFailure: invocation.providerFailureCapture,
            providerDiagnostics: buildProviderS5(invocation.providerFailureCapture, {
              dispatchMessagesHash: allocated.hashes.dispatchMessagesHash,
              estimate: { input: invocation.inputTokens ?? null },
              policy: { id: allocated.receipt.policyId, version: allocated.receipt.policyVersion },
            }),
            createdAtMs: deps.nowMs(),
          });
        } catch {
          // Observability persistence must not change the terminal outcome.
        }
      }
      return emitFailure(
        invocation.correctionScopeViolation.code,
        undefined,
        makeThoughtTerminal("structural_invalid", {
          codes: [invocation.correctionScopeViolation.code],
          stage: "parser",
        }),
      );
    }

    if (invocation.malformed) {
      structuralFeedback = invocation.structuralFeedback
        ?? createThoughtStructuralFeedback({
          code: invocation.output.kind === "failure"
            ? invocation.output.diagnosticCode ?? "other"
            : "other",
          field: invocation.output.kind === "failure" ? invocation.output.diagnosticField : undefined,
          allowlistedReferences: semanticReferencesForInput(allocated.projected),
        });
      const retryScheduled = structuralRetryWouldSchedule;
      const providerFailure = invocation.providerFailureCapture
        ? {
            ...invocation.providerFailureCapture,
            structuralRetryStatus: retryScheduled ? "scheduled" as const : "exhausted" as const,
          }
        : undefined;
      if (deps.observabilityDb) {
        try {
          recordDiagnostic(deps.observabilityDb, {
            cycleId: cycle.cycleId,
            generation: cycle.generation,
            requestId: invocation.output.requestId,
            pass,
            code: "parser_malformed",
            stage: "parser",
            dispatchTruth: providerFailure?.dispatchTruth ?? "unknown",
            semanticProjectionHash: allocated.hashes.semanticProjectionHash,
            dispatchMessagesHash: allocated.hashes.dispatchMessagesHash,
            providerFailure,
            providerDiagnostics: buildProviderS5(providerFailure, {
              dispatchMessagesHash: allocated.hashes.dispatchMessagesHash,
              estimate: { input: invocation.inputTokens ?? null },
              policy: { id: allocated.receipt.policyId, version: allocated.receipt.policyVersion },
            }),
            createdAtMs: deps.nowMs(),
          });
        } catch {
          // ignore
        }
      }
      if (settlementOnly) {
        return emitFailure(
          "settlement_only_required",
          undefined,
          makeThoughtTerminal("budget_exhausted", {
            codes: ["settlement_only_required"],
            stage: "effect_rounds_finalization",
          }),
        );
      }
      if (retryScheduled) {
        structuralRetriesForPass += 1;
        incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "structuralRetries");
        continue;
      }
      // Proven structural exhaustion: bounded retries were scheduled and are
      // now exhausted (persisted count + attempt budget). This is the only
      // malformed path that may truthfully claim retry exhaustion.
      return emitFailure(
        "malformed",
        undefined,
        makeThoughtTerminal("structural_exhausted", {
          codes: [
            "malformed",
            ...(invocation.output.kind === "failure" && invocation.output.diagnosticCode
              ? [invocation.output.diagnosticCode]
              : []),
          ],
          stage: "parser",
        }),
      );
    }
    if (invocation.deferred && typeof invocation.nextEligibleAtMs === "number") {
      const latestRowId = triggerEvidence?.rowId ?? cycle.composeLogIds.at(-1) ?? "unknown";
      return {
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        published: false,
        outboxId: null,
        infrastructureNotice: null,
        thoughtModelAttempts: counters.thoughtModelAttempts,
        acceptedThoughtPasses: counters.acceptedThoughtPasses,
        composeCancelledAttempts: counters.composeCancelledAttempts,
        acceptedSettlements: 0,
        deferred: true,
        nextEligibleAtMs: invocation.nextEligibleAtMs,
        conversationId: cycle.conversationId,
        latestEvidenceRowId: latestRowId,
        thoughtExecutionProvenance: currentExecutionProvenance(),
        ownerObligationResolution: ownerResolutionFor("deferred"),
      };
    }
    if (invocation.providerUsageCapture && invocation.output.kind !== "failure" && deps.observabilityDb) {
      try {
        recordDiagnostic(deps.observabilityDb, {
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          requestId: invocation.output.requestId,
          pass,
          code: "provider_returned",
          stage: "provider_dispatch",
          dispatchTruth: invocation.providerUsageCapture.dispatchTruth,
          semanticProjectionHash: allocated.hashes.semanticProjectionHash,
          dispatchMessagesHash: allocated.hashes.dispatchMessagesHash,
          estimatedInputTokens: invocation.inputTokens,
          providerFailure: invocation.providerUsageCapture,
          ...(invocation.lifeboat ? {
            primaryProvider: "command_code",
            primaryAttemptId: invocation.lifeboat.primaryAttemptId,
            primaryDispatchTruth: invocation.lifeboat.primaryDispatchTruth,
            fallbackAttemptOrdinal: 2,
            fallbackFromAttemptId: invocation.lifeboat.primaryAttemptId,
          } : {}),
          providerDiagnostics: buildProviderS5(invocation.providerUsageCapture, {
            dispatchMessagesHash: allocated.hashes.dispatchMessagesHash,
            estimate: { input: invocation.inputTokens ?? null },
            policy: { id: allocated.receipt.policyId, version: allocated.receipt.policyVersion },
          }),
          createdAtMs: deps.nowMs(),
        });
      } catch {
        // Observability persistence must not change the terminal outcome.
      }
    }
    if (invocation.thoughtDeadline) {
      // Local absolute deadline with no provider response observed
      // (dispatchTruth !== "sent" proven by the invocation flag). Provider
      // dispatch/outcome truth stays independent; never PROVIDER_UNAVAILABLE.
      return emitFailure(
        "thought_deadline",
        undefined,
        makeThoughtTerminal("thought_deadline", { codes: ["thought_deadline"], stage: "provider_dispatch" }),
      );
    }
    if (invocation.unavailable) {
      return emitFailure(
        "unavailable",
        invocation.providerFailureCapture?.failureClass,
        makeThoughtTerminal("provider", {
          codes: invocation.providerFailureCapture?.failureClass
            ? [invocation.providerFailureCapture.failureClass]
            : [],
          stage: "provider_dispatch",
          providerFailureClass: invocation.providerFailureCapture?.failureClass,
        }),
      );
    }

    structuralFeedback = null;
    settlementRevisionFeedback = undefined;

    incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "acceptedThoughtPasses");
    counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);

    if (settlementOnly && invocation.output.kind !== "settlement") {
      return emitFailure(
        "settlement_only_required",
        undefined,
        makeThoughtTerminal("budget_exhausted", {
          codes: ["settlement_only_required"],
          stage: "effect_rounds_finalization",
        }),
      );
    }

    if (invocation.output.kind === "observation_request") {
      if (effectContinuationCompletion?.remainingEffectRounds === 0) {
        const request = invocation.output.observationRequest;
        const inspectionTargetMatches = request.kind === "project.inspect"
          && continuationTargetMatches(effectContinuationCompletion.target, request.request);
        if (request.kind !== "concern.inspect" && !inspectionTargetMatches) {
          return emitFailure(
            "completion_effect_target_mismatch",
            undefined,
            makeThoughtTerminal("operation_dispatch", {
              codes: ["completion_effect_target_mismatch"],
              stage: "effect_continuation",
            }),
          );
        }
      }
      const packs = deps.loadAuthorityPacks();
      const verdict = deps.checkAuthority("proposal", {
        proposal: invocation.output.observationRequest,
        packs,
        authorityEpoch: cycle.authorityEpoch,
        authorityDb: authorityDbForPacks(deps, packs),
        expectedCurrentness: invocation.kernelEnvelope?.authorityCurrentness,
      });
      if (!verdict.ok) {
        if (revisable(verdict.codes)) {
          if (counters.authorityRevisions >= MAX_AUTHORITY_REVISIONS) {
            return emitFailure(
              "revision_exhausted",
              undefined,
              makeThoughtTerminal("budget_exhausted", {
                codes: ["revision_exhausted", ...verdict.codes],
                stage: "authority_proposal",
              }),
            );
          }
          authorityObjections = uniqueAuthorityCodes(verdict.codes);
          incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
          pass += 1;
          structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
          continue;
        }
        return emitFailure(
          verdict.codes.join(",") || "authority_rejected",
          undefined,
          makeThoughtTerminal("authority", { codes: verdict.codes, stage: "authority_proposal" }),
        );
      }
      if (counters.observationRounds >= MAX_OBSERVATION_ROUNDS) {
        return emitFailure(
          "pass_exhausted",
          undefined,
          makeThoughtTerminal("budget_exhausted", { codes: ["pass_exhausted"], stage: "observation_rounds" }),
        );
      }
      const projectInspectionWorkerRequired = invocation.output.observationRequest.kind === "project.inspect"
        && (
          routeProjectInspectionRequest(invocation.output.observationRequest.request) === "worker"
          || deps.canOfferDirectProjectInspection?.() === false
        );
      if (
        projectInspectionWorkerRequired
        && invocation.semantic?.kind === "observation_intent"
      ) {
        const ownerOrigin = event.kind === "owner_message"
          || event.kind === "owner_utterance"
          || cycle.triggerKind === "owner_message"
          || Boolean(continuityRecovery);
        const commitmentOrigin = !ownerOrigin && cycle.triggerKind === "commitment_due";
        const originKind = ownerOrigin
          ? "OWNER_REQUEST" as const
          : commitmentOrigin
            ? "ASHLEY_COMMITMENT" as const
            : "ASHLEY_CURIOSITY" as const;
        const originRef = continuityRecovery
          ? continuityRecovery.primaryPredecessorEventId
          : ownerOrigin
            ? event.id
            : commitmentOrigin
              ? (typeof payload.commitmentId === "string" && payload.commitmentId.trim()
                ? payload.commitmentId.trim()
                : cycle.triggerRef)
              : (cycle.triggerRef || event.id);
        const originOwnerEventId = continuityRecovery
          ? continuityRecovery.primaryPredecessorEventId
          : (ownerOrigin ? event.id : null);
        const candidateOwnerId = resolveCanonicalOwnerPrincipal(sidecar, {
          payload,
          cycle,
          triggerEvidence,
          continuityRecovery,
        });

        let ownerId: string;
        if (originKind === "OWNER_REQUEST") {
          if (!candidateOwnerId || !isAuthorizedOwnerId(candidateOwnerId)) {
            throw new Error("canonical_owner_principal_unproven");
          }
          ownerId = candidateOwnerId;
        } else {
          ownerId = candidateOwnerId ?? cycle.occupantId?.trim() ?? cycle.conversationId;
        }
        const originEvidenceRowId = triggerEvidence?.rowId ?? cycle.composeLogIds.at(-1) ?? null;

        // The global queue is the production seam. Thought yields after
        // durable queue admission and never invokes a worker directly.
        if (deps.enqueueWorkerUndertaking) {
          let queued: import("../operation/dispatch.js").EnqueueWorkerUndertakingResult;
          try {
            queued = deps.enqueueWorkerUndertaking({
              semanticKind: "project.inspect",
              intent: invocation.semantic,
              origin: {
                kind: originKind,
                ref: originRef,
                ownerEventId: originOwnerEventId,
                evidenceRowId: originEvidenceRowId,
              },
              ownerId,
              conversationId: cycle.conversationId,
              originCycleId: cycle.cycleId,
              originGeneration: cycle.generation,
              request: invocation.semantic.request,
              purpose: invocation.semantic.purpose,
              evidenceNeed: invocation.semantic.evidenceNeed,
              nowMs: deps.nowMs(),
            });
          } catch {
            queued = { queued: false, reason: "queue_admission_failed" };
          }
          if (queued.queued) {
            if (queued.acknowledgementId != null && deps.projectInterim) {
              try {
                await deps.projectInterim(queued.acknowledgementId);
              } catch {
                // Queue ownership stands even when acknowledgement projection
                // is retried by the normal interim recovery path.
              }
            }
            updateCycleState(sidecar, cycle.cycleId, "silent", deps.nowMs());
            return {
              cycleId: cycle.cycleId,
              generation: cycle.generation,
              published: false,
              outboxId: null,
              infrastructureNotice: null,
              thoughtModelAttempts: counters.thoughtModelAttempts,
              acceptedThoughtPasses: counters.acceptedThoughtPasses,
              composeCancelledAttempts: counters.composeCancelledAttempts,
              acceptedSettlements: 0,
              deferred: false,
              workerUndertakingId: queued.undertaking.undertakingId,
              conversationId: cycle.conversationId,
              latestEvidenceRowId: triggerEvidence?.rowId ?? cycle.composeLogIds.at(-1) ?? "unknown",
              thoughtExecutionProvenance: currentExecutionProvenance(),
              ownerObligationResolution: ownerResolutionFor("deferred", {
                workerUndertakingId: queued.undertaking.undertakingId,
                interimSpeechAuthored: queued.acknowledgementAuthored,
              }),
            };
          }
          return emitFailure(
            "observation_unavailable",
            undefined,
            makeThoughtTerminal("operation_dispatch", {
              codes: [queued.reason],
              stage: "observation_dispatch",
            }),
          );
        }

        // Worker-required work has no synchronous Thought fallback. A host
        // without the global queue seam fails closed before observation.
        return emitFailure(
          "observation_unavailable",
          undefined,
          makeThoughtTerminal("operation_dispatch", { codes: ["worker_queue_unavailable"], stage: "observation_dispatch" }),
        );
      }
      if (
        invocation.output.observationRequest.kind.startsWith("project.")
        && invocation.output.observationRequest.kind !== "project.inspect"
      ) {
        return emitFailure(
          "observation_unavailable",
          undefined,
          makeThoughtTerminal("operation_dispatch", {
            codes: ["operation_not_registered"],
            stage: "observation_dispatch",
          }),
        );
      }
      incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "observationRounds");
      updateCycleState(sidecar, cycle.cycleId, "awaiting_operation", deps.nowMs());
      try {
        const observed = await executeDelegatedObservation(invocation.output.observationRequest);
        const normalized: Observation = {
          ...observed,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          derived: observed.derived === true,
          replaySafe: observed.replaySafe === true,
          dataClassification: observed.dataClassification ?? "never_public",
          secretOmitted: observed.secretOmitted === true,
        };
        observationsForThought = [...observationsForThought, normalized];
        storeObservations(sidecar, {
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          observations: [normalized],
        }, deps.nowMs());
        const discoverPayload = normalized.provenance === "sidecar:concern.inspect"
          && typeof normalized.payload === "object"
          && normalized.payload !== null
          && (normalized.payload as { result?: unknown }).result === "page"
          && Array.isArray((normalized.payload as { concerns?: unknown }).concerns)
          ? normalized.payload as { concerns: Array<Record<string, unknown>> }
          : null;
        if (discoverPayload) {
          for (const item of discoverPayload.concerns) {
            const concernId = typeof item.concernId === "string" ? item.concernId : "";
            if (!concernId) continue;
            const cognitiveStatus = typeof item.cognitiveStatus === "string" ? item.cognitiveStatus : null;
            const quarantineKind = typeof item.quarantineKind === "string" ? item.quarantineKind : null;
            if (concernDiscoverItemAuthorable({ cognitiveStatus, quarantineKind })) {
              discoveredAuthorableConcernIds.add(concernId);
            }
          }
        }
      } catch (error) {
        if (error instanceof CapabilityUnavailableError) {
          return emitFailure(
            error.code,
            undefined,
            makeThoughtTerminal("operation_dispatch", {
              codes: [error.code, error.reasonCode],
              stage: "observation_dispatch",
            }),
          );
        }
        return emitFailure(
          "observation_unavailable",
          undefined,
          makeThoughtTerminal("operation_dispatch", { codes: ["observation_unavailable"], stage: "observation_dispatch" }),
        );
      }
      beginThoughtLeg();
      pass += 1;
      structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
      continue;
    }

    if (invocation.output.kind === "effect_proposal") {
      const completionVerification = effectContinuationCompletion?.remainingEffectRounds === 0
        && !completionVerificationUsed
        && invocation.output.effectProposal.kind === "workspace.verify"
        && continuationTargetMatches(
          effectContinuationCompletion.target,
          invocation.output.effectProposal.request,
        );
      if (effectContinuationCompletion?.remainingEffectRounds === 0 && !completionVerification) {
        return emitFailure(
          "completion_verification_only",
          undefined,
          makeThoughtTerminal("operation_dispatch", {
            codes: ["completion_verification_only"],
            stage: "effect_continuation",
          }),
        );
      }
      const packs = deps.loadAuthorityPacks();
      const verdict = deps.checkAuthority("proposal", {
        proposal: invocation.output.effectProposal,
        packs,
        authorityEpoch: cycle.authorityEpoch,
        authorityDb: authorityDbForPacks(deps, packs),
        expectedCurrentness: invocation.kernelEnvelope?.authorityCurrentness,
      });
      if (!verdict.ok) {
        if (revisable(verdict.codes)) {
          if (counters.authorityRevisions >= MAX_AUTHORITY_REVISIONS) {
            return emitFailure(
              "revision_exhausted",
              undefined,
              makeThoughtTerminal("budget_exhausted", {
                codes: ["revision_exhausted", ...verdict.codes],
                stage: "authority_proposal",
              }),
            );
          }
          authorityObjections = uniqueAuthorityCodes(verdict.codes);
          incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
          pass += 1;
          structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
          continue;
        }
        return emitFailure(
          verdict.codes.join(",") || "effect_not_authorized",
          undefined,
          makeThoughtTerminal("authority", { codes: verdict.codes, stage: "authority_proposal" }),
        );
      }
      if (counters.effectRounds >= MAX_EFFECT_ROUNDS && !completionVerification) {
        return emitFailure(
          "pass_exhausted",
          undefined,
          makeThoughtTerminal("budget_exhausted", { codes: ["pass_exhausted"], stage: "effect_rounds" }),
        );
      }
      if (!completionVerification) {
        counters = incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "effectRounds");
      }
      updateCycleState(sidecar, cycle.cycleId, "awaiting_operation", deps.nowMs());
      const effectDeadlineAtMs = deps.nowMs() + LONG_OPERATION_HORIZON_MS;
      const proposal = {
        ...invocation.output.effectProposal,
        originEventId: event.id,
        originAttemptId: event.durableAttemptId ?? null,
        ...(delegationRefForRequest(sidecar, invocation.output.effectProposal.request, cycle.conversationId) === null
          ? {}
          : {
              delegationRef: delegationRefForRequest(
                sidecar,
                invocation.output.effectProposal.request,
                cycle.conversationId,
              ),
            }),
      };
      const detachedDevelop = proposal.kind === "candidate.develop"
        && typeof deps.acceptEffectContinuation === "function"
        && typeof deps.superviseEffectExecution === "function";
      let continuationLease: { effectId: string; leaseToken: string } | null = null;
      const reloadDispatchState = () => {
        const currentPacks = deps.loadAuthorityPacks();
        const current = getCurrentCycle(sidecar, cycle.conversationId, { includeIdle: true });
        return {
          authorityEpoch: currentPacks.stateEpoch.authorityEpoch,
          generation: current?.generation,
          packs: currentPacks,
          authorityDb: authorityDbForPacks(deps, currentPacks),
        };
      };
      const executeEffect = deps.superviseEffectExecution
        ? (effectProposal: EffectProposal) => deps.superviseEffectExecution!({
            proposal: effectProposal,
            deadlineAtMs: effectDeadlineAtMs,
            isCurrent: () => currentLifecycleIs(
              sidecar,
              cycle,
              attemptLifecycleBinding,
              deps.origin !== "shadow",
            ),
            isAuthorized: () => {
              const packs = deps.loadAuthorityPacks();
              const currentAuthorityEpoch = packs.stateEpoch.authorityEpoch;
              return deps.checkAuthority("dispatch", {
                proposal: effectProposal,
                packs,
                authorityEpoch: currentAuthorityEpoch,
                authorityDb: authorityDbForPacks(deps, packs),
              }).ok;
            },
            execute: (control) => executeDelegatedEffect(effectProposal, control),
            ...(continuationLease ? { continuationLease } : {}),
          })
        : executeDelegatedEffect;
      const dispatch = await dispatchEffect(
        sidecar,
        proposal,
        { ...reloadDispatchState(), reload: reloadDispatchState },
        executeEffect,
        undefined,
        detachedDevelop
          ? {
              detachAfterAdmission: true,
              onAccepted: () => {
                continuationLease = deps.acceptEffectContinuation!({
                  proposal,
                  deadlineAtMs: effectDeadlineAtMs,
                  remainingEffectRounds: MAX_EFFECT_ROUNDS - counters.effectRounds,
                });
              },
              onTerminal: (receipt) => {
                if (!continuationLease) throw new Error("effect_continuation_lease_missing");
                const terminalClass = typeof receipt.claims.terminationClass === "string"
                  ? receipt.claims.terminationClass
                  : receipt.outcome === "succeeded" ? "SUCCESS" : "FAILED";
                const effectTruth = typeof receipt.claims.executionTruth === "string"
                  ? receipt.claims.executionTruth
                  : "unknown";
                const state = terminalClass === "CANCELLED"
                  ? "cancelled" as const
                  : receipt.outcome === "succeeded"
                    ? "succeeded" as const
                    : receipt.outcome === "outcome_unknown"
                      ? "outcome_unknown" as const
                      : "failed" as const;
                if (!finishEffectContinuation(sidecar, {
                  effectId: continuationLease.effectId,
                  leaseToken: continuationLease.leaseToken,
                  state,
                  terminalClass,
                  effectTruth,
                  nowMs: Math.max(deps.nowMs(), receipt.atMs),
                })) throw new Error("effect_continuation_terminal_write_failed");
                const completion = produceOperationCompletion(sidecar, continuationLease.effectId, {
                  nowMs: Math.max(deps.nowMs(), receipt.atMs),
                });
                if (!completion.ok) throw new Error(`effect_completion_failed:${completion.reason}`);
              },
            }
          : undefined,
      );
      if (!dispatch.dispatched) {
        if (dispatch.origin === "fenced" || dispatch.codes.includes("STALE_GENERATION")) {
          counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
          return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, staleOwnerResultOptions());
        }
        // Classify from the producer-proven origin, never from child
        // strings: IN_FLIGHT_UNKNOWN is polysemous (also a genuine
        // AuthorityCode), so only an authority-originated dispatch verdict
        // is AUTHORITY_REJECTED. Dispatch-mechanics refusal (e.g. an
        // occupied idempotency key) is an operation-dispatch failure.
        const dispatchTerminal = dispatch.origin === "authority"
          ? makeThoughtTerminal("authority", { codes: dispatch.codes, stage: "effect_dispatch" })
          : makeThoughtTerminal("operation_dispatch", { codes: dispatch.codes, stage: "effect_dispatch" });
        return emitFailure(
          dispatch.codes.join(",") || "effect_unavailable",
          undefined,
          dispatchTerminal,
        );
      }
      if ("pending" in dispatch && dispatch.pending) {
        updateCycleState(sidecar, cycle.cycleId, "silent", deps.nowMs());
        counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
        return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, {
          thoughtExecutionProvenance: currentExecutionProvenance(),
          ownerObligationResolution: ownerResolutionFor("deferred", {
            effectContinuationId: dispatch.effectId,
          }),
          effectContinuationId: dispatch.effectId,
        });
      }
      inFlight = listInFlightForThoughtCycle(sidecar, cycle.cycleId);
      pass += 1;
      structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
      continue;
    }

    if (invocation.output.kind === "abstain") {
      updateCycleState(sidecar, cycle.cycleId, "silent", deps.nowMs());
      return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, {
        thoughtExecutionProvenance: currentExecutionProvenance(),
        ownerObligationResolution: ownerResolutionFor("abstained"),
      });
    }
    if (invocation.output.kind !== "settlement") {
      const leftover = invocation.output.reason;
      // Leftover ThoughtFailureStep passthrough. Inner revision/pass are
      // never produced here (dead for reachability), but stay total.
      // capacity_deferred without nextEligible is envelope overflow (local
      // allocation), not a silent deferral (deferred with nextEligible
      // returned earlier). unavailable without provider detail is genuinely
      // insufficient evidence -> foreign/UNKNOWN.
      const leftoverTerminal = leftover === "malformed"
        ? makeThoughtTerminal("structural_invalid", { codes: ["malformed"], stage: "settlement" })
        : leftover === "revision_exhausted" || leftover === "pass_exhausted"
          ? makeThoughtTerminal("budget_exhausted", { codes: [leftover], stage: "settlement" })
          : leftover === "capacity_deferred"
            ? makeThoughtTerminal("allocation", { codes: ["capacity_deferred"], stage: "allocation" })
            : leftover === "cancelled"
              ? makeThoughtTerminal("cancelled", { codes: ["cancelled"], stage: "settlement" })
              : makeThoughtTerminal("foreign", { codes: [leftover], stage: "settlement" });
      return emitFailure(invocation.output.reason, undefined, leftoverTerminal);
    }
    const operationalNamespace = buildOperationalEffectNamespace(
      cycle.cycleId,
      cycle.generation,
      inFlight.map((item) => item.effectId),
    );
    const effectAllowlist = new Set(operationalNamespace.allowedOperationalEffectRefs);
    const validation = validateThoughtSettlementDraft(invocation.output.settlement, {
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      occupantId: cycle.occupantId,
      authorityEpoch: cycle.authorityEpoch,
      consumedEffectIds: inFlight.filter((item) => item.status === "receipted").map((item) => item.effectId),
      effectAllowlist,
      triggerKind: cycle.triggerKind,
      dueCommitmentPresent: dueCommitment !== undefined && dueCommitment !== null,
      continuityRepairPresent: continuityRecovery !== null && continuityRecovery !== undefined,
    });
    if (!validation.ok) {
      if (validation.kind === "stale") {
        counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
        return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, staleOwnerResultOptions());
      }
      if (validation.kind === "conflict" && revisable(validation.codes)) {
        if (counters.authorityRevisions >= MAX_AUTHORITY_REVISIONS) {
          return emitFailure(
            "revision_exhausted",
            undefined,
            makeThoughtTerminal("budget_exhausted", {
              codes: ["revision_exhausted", ...validation.codes],
              stage: "settlement_validation",
            }),
          );
        }
        authorityObjections = uniqueAuthorityCodes(validation.codes);
        if (validation.codes.includes("OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN")) {
          settlementRevisionFeedback = {
            failureCode: "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN",
            invalidEffectRefs: [...new Set((invocation.output.settlement.commitments?.operational ?? [])
              .map((item) => item.effectRef).filter((ref) => !effectAllowlist.has(ref)))],
            allowedEffectRefs: [...operationalNamespace.allowedOperationalEffectRefs],
          };
        }
        incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
        pass += 1;
        structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
        continue;
      }
      // Validation malformed without independently proven retry exhaustion is
      // structured-output-invalid, not retry-exhausted. Exact validation
      // codes are retained in the terminal descriptor; C3 still sees the
      // legacy "malformed" marker (behavior preserved).
      return emitFailure(
        "malformed",
        undefined,
        makeThoughtTerminal("structural_invalid", { codes: validation.codes, stage: "settlement_validation" }),
      );
    }
    const packs = deps.loadAuthorityPacks();
    const currentnessPack = {
      ...packs.currentness,
      observedObservationIds: observationsForThought.map((item) => item.observationId),
    };
    const authority = deps.checkAuthority("settlement", {
      settlement: validation.draft,
      packs: {
        ...packs,
        currentness: currentnessPack,
      },
      authorityEpoch: cycle.authorityEpoch,
      authorityDb: authorityDbForPacks(deps, packs),
      expectedCurrentness: invocation.kernelEnvelope?.authorityCurrentness,
      activeEffects: inFlight,
    });
    if (!authority.ok) {
      if (revisable(authority.codes)) {
        if (counters.authorityRevisions >= MAX_AUTHORITY_REVISIONS) {
          return emitFailure(
            "revision_exhausted",
            undefined,
            makeThoughtTerminal("budget_exhausted", {
              codes: ["revision_exhausted", ...authority.codes],
              stage: "authority_settlement",
            }),
          );
        }
        authorityObjections = uniqueAuthorityCodes(authority.codes);
        incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
        pass += 1;
        structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
        continue;
      }
      return emitFailure(
        authority.codes.join(",") || "authority_rejected",
        undefined,
        makeThoughtTerminal("authority", { codes: authority.codes, stage: "authority_settlement" }),
      );
    }

    let commitmentBindings: CommitmentRealizationBinding[] = [];
    const commitmentProposals = validation.draft.commitments?.commitmentProposals ?? [];
    if (commitmentProposals.length > 0) {
      // TX-B1/TX-B2 are deliberately before Expression and before the
      // publication transaction. A rejected promise returns to Thought and
      // cannot become speech or an outbox row.
      const settlementRef = `cycle:${cycle.cycleId}:generation:${cycle.generation}:pass:${pass}`;
      try {
        persistCommitmentProposals(nuclear, settlementRef, commitmentProposals);
        const admission = settlePersistedCommitmentProposals(nuclear, settlementRef, {
          ownerId: typeof payload.ownerId === "string" && payload.ownerId.trim()
            ? payload.ownerId
            : cycle.occupantId,
          nowMs: deps.nowMs(),
          enabled: isCommitmentsEnabled(),
        });
        const rejected = admission.filter((item) => item.settled !== true || item.admitted !== true);
        if (rejected.length > 0 || admission.length !== commitmentProposals.length) {
          if (counters.authorityRevisions >= MAX_AUTHORITY_REVISIONS) {
            return emitFailure(
              "revision_exhausted",
              undefined,
              makeThoughtTerminal("budget_exhausted", {
                codes: ["revision_exhausted", "commitment_contract_failure"],
                stage: "commitment_admission",
              }),
            );
          }
          authorityObjections = uniqueAuthorityCodes(["commitment_contract_failure"]);
          incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
          pass += 1;
          structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
          continue;
        }
        commitmentBindings = commitmentBindingsForSettlement(nuclear, settlementRef);
        if (commitmentBindings.length !== commitmentProposals.length) {
          authorityObjections = uniqueAuthorityCodes(["commitment_contract_failure"]);
          incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
          pass += 1;
          structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
          continue;
        }
      } catch (error) {
        return emitFailure(
          error instanceof Error ? error.message : "commitment_admission_failed",
          undefined,
          makeThoughtTerminal("authority", { codes: ["commitment_contract_failure"], stage: "commitment_admission" }),
        );
      }
    }

    let speechText = validation.draft.speech.surfaceDraft;
    if (
      deps.expressionEnabled &&
      deps.adaptExpression &&
      validation.draft.speech.mode === "draft" &&
      speechText !== null
    ) {
      try {
        speechText = await deps.adaptExpression({
          draft: speechText,
          commitments: validation.draft.commitments,
          commitmentBindings,
          stance: validation.draft.commitments?.stance,
          directives: validation.draft.speech.presentationDirectives ?? [],
          profile: "default",
          medium: "discord",
        });
      } catch {
        speechText = validation.draft.speech.surfaceDraft;
      }
    }
    const fidelity = fidelityCheck({
      mode: validation.draft.speech.mode,
      draft: speechText,
      mustSay: validation.draft.speech.mustSay ?? [],
      mustNot: validation.draft.speech.mustNot ?? [],
      commitments: validation.draft.commitments,
      commitmentBindings,
      commitmentRealizationClauses: commitmentProposals.map((proposal) => proposal.realizationClause),
      observations: [...observationsForThought, ...journalReadRefs(allocated.projected)],
    });
    if (!fidelity.ok) {
      if (REVISABLE_AUTHORITY_CODES.has(fidelity.code as AuthorityCode)) {
        if (counters.authorityRevisions >= MAX_AUTHORITY_REVISIONS) {
          return emitFailure(
            "revision_exhausted",
            undefined,
            makeThoughtTerminal("budget_exhausted", {
              codes: ["revision_exhausted", fidelity.code],
              stage: "fidelity",
            }),
          );
        }
        authorityObjections = uniqueAuthorityCodes([fidelity.code]);
        incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
        pass += 1;
        continue;
      }
      // All final speech-fidelity rejections map publicly to
      // SPEECH_FIDELITY_REJECTED. Exact internal fidelity code is retained
      // in the terminal descriptor (and legacy reason for C3/key).
      return emitFailure(
        fidelity.code,
        undefined,
        makeThoughtTerminal("fidelity", { codes: [fidelity.code], stage: "fidelity" }),
      );
    }
    if (!currentLifecycleIs(sidecar, cycle, attemptLifecycleBinding, deps.origin !== "shadow")) {
      counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
      return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, staleOwnerResultOptions());
    }
    const finalText = validation.draft.speech.mode === "draft"
      ? renderForTransport(speechText ?? "")
      : null;
    const settlement = publishedSettlement({
      ...validation.draft,
      speech: { ...validation.draft.speech, surfaceDraft: speechText },
    }, randomUUID(), finalText);
    if (commitmentBindings.length > 0) settlement.commitmentBindings = [...commitmentBindings];
    let externalPublication: DeliveryIntent["externalPublication"] | undefined;
    // G1: a contact's stop holds even when she answers nothing. It binds only to the human who sent
    // the message that started this turn, in a DM with them.
    if (externalCycle && deps.origin !== "shadow" && settlement.contactStop && externalDestination?.kind === "external_dm"
      && triggerEvidence?.speakerKind === "external_human" && triggerEvidence.rowId
      && triggerEvidence.speakerPrincipalId?.trim() === externalDestination.principalId && externalOwnerId) {
      try {
        applyContactStop(nuclear, { ownerId: externalOwnerId, principalId: externalDestination.principalId,
          stop: settlement.contactStop, sourceMessageRef: triggerEvidence.rowId, nowMs: deps.nowMs() });
      } catch (error) {
        console.warn("[contact-stop] not recorded", error instanceof Error ? error.message : error);
      }
    }
    // T: what she kept from this person's teaching, bound to the human whose message started the turn.
    if (externalCycle && deps.origin !== "shadow" && settlement.learned?.length && externalDestination
      && triggerEvidence?.speakerKind === "external_human" && triggerEvidence.speakerPrincipalId?.trim()) {
      try {
        recordLessons(sidecar, { cycleId: cycle.cycleId, fromPrincipal: triggerEvidence.speakerPrincipalId.trim(),
          placeRef: externalDestination.kind === "external_dm" ? `contact:${externalDestination.principalId}` : externalDestination.roomId,
          claims: settlement.learned, nowMs: deps.nowMs() });
      } catch (error) {
        console.warn("[lessons] not kept", error instanceof Error ? error.message : error);
      }
    }
    if (externalCycle) {
      const blockExternalCycle = (): KernelRunResult => {
        sidecar.prepare(
          "UPDATE cycle_records SET state = 'silent', disposition = 'blocked_at_dispatch', updated_at_ms = ? WHERE cycle_id = ?",
        ).run(deps.nowMs(), cycle.cycleId);
        return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, {
          thoughtExecutionProvenance: currentExecutionProvenance(),
        });
      };
      const dmDestination = externalDestination?.kind === "external_dm" ? externalDestination : null;
      const roomDestination = externalDestination?.kind === "room" ? externalDestination : null;
      const dmClosed = !dmDestination
        || !isExternalDmCognitionEnabled()
        || !isExternalDmPublicationEnabled()
        || !externalDmPrincipalAllowed(dmDestination.principalId);
      const roomClosed = !roomDestination
        || !isRoomPublicationEnabled(process.env, roomDestination.channelId);
      if ((dmDestination ? dmClosed : roomClosed) || !externalDestination || settlement.speech.mode !== "draft") {
        return blockExternalCycle();
      }
      const freshness = getCycleFreshnessState(sidecar, cycle.cycleId);
      const basis = freshness.attemptInputBasis;
      if (!basis || !externalBinding || externalBinding.licenseRefs.length === 0) {
        return blockExternalCycle();
      }
      if (settlement.interactionIntent !== "continue" && settlement.interactionIntent !== "initiate") {
        return blockExternalCycle();
      }
      if (roomDestination && settlement.interactionIntent !== "continue") {
        return blockExternalCycle();
      }
      if (botParticipantId) {
        const resourceDecision = SOCIAL_RESOURCE_FUSE.admitAndRecord({
          conversationKey: cycle.conversationId,
          consequenceChainId: wake.consequenceChainId ?? `wake:${wake.wakeId}`,
          lifecycleId: `${cycle.cycleId}:${cycle.generation}`,
          botParticipantId,
          roomId: roomDestination?.roomId,
          nowMs: deps.nowMs(),
          usage: {
            computeMs: Math.max(0, deps.nowMs() - admittedCycle.admittedAtMs),
            outputTokens: speechText?.length ?? 0,
            networkRequests: 1,
          },
        });
        if (!resourceDecision.accepted) {
          return emitFailure(
            `social_${resourceDecision.fact.operational}`,
            null,
            makeThoughtTerminal("budget_exhausted", {
              codes: [resourceDecision.fact.operational],
              stage: "social_resource_fuse",
            }),
          );
        }
      }
      externalPublication = {
        destination: externalDestination,
        attemptInputBasis: basis,
        hardDependencyBundle: externalBinding.bundle,
        interactionIntent: settlement.interactionIntent,
        licenseRefs: [...externalBinding.licenseRefs],
      };
    }
    if (
      !externalCycle
      && settlement.speech.mode === "draft"
      && isUnsolicitedTriggerKind(cycle.triggerKind)
      && unsolicitedFuseTripped(sidecar, deps.nowMs())
    ) {
      // Runaway fuse (plan §5.5): a mechanical ceiling, never a judgement of
      // whether the message was worth sending.
      return emitFailure(
        "unsolicited_fuse",
        null,
        makeThoughtTerminal("budget_exhausted", { codes: ["unsolicited_fuse"], stage: "reach_out_fuse" }),
      );
    }
    const quietPublication = deps.origin === "shadow"
      ? { kind: "allow" as const }
      : quietPublicationFor(sidecar, {
          nowMs: deps.nowMs(),
          external: externalCycle,
          ownerPrivate: effectiveThoughtAudience.kind === "owner_private",
          speechMode: settlement.speech.mode,
          triggerKind: cycle.triggerKind,
          interactionIntent: settlement.interactionIntent ?? null,
          draftText: speechText ?? "",
        });
    if (quietPublication.kind === "hold") {
      holdQuietDraft(sidecar, quietPublication.text, deps.nowMs());
      recordQuietRefusal(sidecar, deps.nowMs());
      return emitFailure(
        "quiet_held",
        null,
        makeThoughtTerminal("budget_exhausted", { codes: ["quiet_held"], stage: "quiet_gate" }),
      );
    }
    const quietSilent = quietPublication.kind === "silent";
    // R13: the inner-life records of an Owner-private settlement are owed from
    // the moment it publishes, so publication itself records them as pending.
    const aftermathContext: AftermathContext | null = deps.origin !== "shadow" && !externalCycle
      && effectiveThoughtAudience.kind === "owner_private"
      ? {
          conversationId: cycle.conversationId,
          ownerPrivate: true,
          passKind: afterglowPass ? "afterglow"
            : awakePass ? "awake"
            : nightPass ? "night"
            : isUnsolicitedTriggerKind(cycle.triggerKind)
              ? cycle.triggerKind === "future_trigger_due" ? "future_trigger" : "private"
              : null,
          nightPass: nightPass ?? null,
          ...(originProfile.triggerKind === "domus_notification" ? domusChannelFor(sidecar, event, originProfile.originCycleId) : {}),
          ...(allocated.projected.domus?.changes?.quiet === true ? { domusQuiet: true as const } : {}),
          ...(allocated.projected.places ? { placesSeen: placesSeenMarks(allocated.projected.places.list) } : {}),
          // A recovery repairs an unanswered Owner message: it is the Owner's turn too (live 2026-10-06).
          ...(originProfile.triggerKind === "owner_message" ? { ownerTurn: true as const, ...(triggerEvidence?.rowId ? { ownerEvidenceRowId: triggerEvidence.rowId } : {}) } : {}),
          ...(originProfile.triggerKind === "domus_notification" && env.domusActEnabled
            ? (() => { const binding = domusActBindingFor(sidecar, event, originProfile.originCycleId); return binding ? { domusAct: binding } : {}; })()
            : {}),
          senseBands,
        }
      : deps.origin!=="shadow" && externalCycle && settlement.attention?.wakeWorth
        ? {conversationId:cycle.conversationId,ownerPrivate:false,timingOnly:true,passKind:null,nightPass:null} : null;
    const publication = publishSemanticTransaction(sidecar, settlement, {
      ...(aftermathContext ? { aftermath: aftermathContext } : {}),
      nowMs: deps.nowMs(),
      triggerKind: cycle.triggerKind,
      fidelity: validation.draft.speech.mode === "draft" ? "passed" : "skipped",
      origin: deps.origin,
      deliveryIntent: {
        ...deliveryIntentFor(
          cycle,
          payload,
          "licensed_speech",
          originProfile.triggerKind,
          externalPublication,
          externalCycle
            ? {
                consequenceChainId: wake.consequenceChainId ?? `wake:${wake.wakeId}`,
                attemptId: attemptLifecycleBinding?.attemptId ?? null,
              }
            : undefined,
          ownerRoomDestination ?? undefined,
          triggerEvidence,
          continuityRecovery,
          sidecar,
        ),
        ...(quietSilent ? { silent: true as const } : {}),
      },
      authorityDb: authorityDbForPacks(deps, packs),
      expectedCurrentness: invocation.kernelEnvelope?.authorityCurrentness ?? packs.currentness.binding,
      currentness: currentnessPack,
      sourceCurrentness: allocated.projected.sourceCurrentness,
      wakeId: cycle.wakeId,
      wakeLeaseToken: event.claimToken,
      semanticPass: pass,
      allowQueuedDetachedCompletion: deps.origin !== "shadow",
    });
    if (!publication.published) {
      counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
      const thoughtExecutionProvenance = currentExecutionProvenance();
      const publicationReason = publication.reason;
      if (deps.observabilityDb && publicationReason) {
        try {
          recordDiagnostic(deps.observabilityDb, {
            cycleId: cycle.cycleId,
            generation: cycle.generation,
            requestId: invocation.output.requestId,
            pass,
            code: "publication_rejected",
            stage: "publication",
            dispatchTruth: thoughtExecutionProvenance.dispatchTruth,
            semanticProjectionHash: allocated.hashes.semanticProjectionHash,
            dispatchMessagesHash: allocated.hashes.dispatchMessagesHash,
            publicationReason,
            createdAtMs: deps.nowMs(),
          });
        } catch {
          const diagnosticFailure = await emitFailure(
            "publication_rejected_diagnostic_persistence_failed",
            "diagnostic_persistence_failed",
            makeThoughtTerminal("publication_persistence", {
              codes: ["publication_rejected_diagnostic_persistence_failed"],
              stage: "publication",
            }),
          );
          return {
            ...diagnosticFailure,
            publicationReason,
            thoughtExecutionProvenance,
          };
        }
      }
      return resultWithCounters(cycle.cycleId, cycle.generation, null, counters, {
        thoughtExecutionProvenance,
        ownerObligationResolution: ownerResolutionFor("rejected"),
        ...(publicationReason ? { publicationReason } : {}),
      });
    }
    if (publication.published && !publication.replayed && quietSilent) {
      noteQuietSilentSent(sidecar, deps.nowMs());
    }
    if (publication.settlementId !== null) {
      const memoryPass = afterglowPass ? "afterglow" : awakePass ? "awake" : nightPass ? "night" : "turn";
      logMemorySettlement(publication.settlementId, memoryPass, settlement.durableNominations);
    }
    if (deps.origin !== "shadow" && publication.settlementId !== null) {
      try {
        // C1 observes only the accepted native settlement and the exact
        // allocated projection already used by Thought. It has no authority
        // over publication, delivery, or cognition, and failures remain
        // observational.
        recordC1V021NativeShadowWitness(nuclear, {
          ownerId: settlement.occupantId,
          acceptedResult: {
            settlementId: publication.settlementId,
            cycleId: settlement.cycleId,
            generation: settlement.generation,
            triggerKind: originProfile.triggerKind,
            semanticResultHash: c1V021SemanticResultHash(
              settlement,
              publication.settlementId,
            ),
          },
          providerBasis: c1V021ProviderBoundBasisFromProjection(
            allocated.projected,
            allocated.hashes,
            pass,
          ),
          observedAt: new Date(deps.nowMs()).toISOString(),
        }, new Date(deps.nowMs()));
      } catch {
        // Publication is authoritative. C1 qualification observation must
        // never mutate or invalidate an otherwise accepted Thought result.
      }
    }
    if (deps.origin !== "shadow" && publication.settlementId !== null && !publication.replayed) {
      try {
        // Growth V1 memory strength: every memory in this Thought's input was
        // recalled; the ones its settlement cites were used.
        const recalled = [
          ...allocated.projected.retrieval.hits.flatMap((hit) =>
            hit.sourceStore === "live_memory" || hit.sourceStore === "quarantined_memory" ? [hit.ref] : []),
          ...coreProfileKeys(allocated.projected),
        ];
        recordMemoryRecall(sidecar, recalled, deps.nowMs());
        const recalledSet = new Set(recalled);
        recordMemoryUse(
          sidecar,
          (settlement.operations.retrievalRefsUsed ?? []).filter((ref) => recalledSet.has(ref)),
          deps.nowMs(),
        );
      } catch {
        // Strength is ranking metadata; it never disturbs publication.
      }
    }
    if (deps.origin !== "shadow" && afterglowPass && publication.settlementId !== null) {
      try {
        completeAfterglow(sidecar, {
          conversationId: cycle.conversationId,
          cycleId: cycle.cycleId,
          pass: afterglowPass,
          reflection: settlement.reflection,
          nowMs: deps.nowMs(),
        });
      } catch (error) {
        // Publication is authoritative. The watermark stays put, so the next
        // afterglow attempt covers these rows again.
        console.warn("[cognitive-v021] afterglow_completion_deferred", error);
      }
    }
    if (aftermathContext && publication.settlementId !== null) {
      try {
        recordSettlementAftermath(sidecar, publication.settlementId, {
          identityStore: identityStoreFor(nuclear, deps),
          timeZone: env.ownerTimeZone || DEFAULT_OWNER_TIME_ZONE,
          dataDir: deps.dataDir,
          nowMs: deps.nowMs(),
        });
      } catch (error) {
        // Publication is authoritative and recorded the aftermath as pending;
        // recovery replays it from the stored settlement.
        console.warn("[cognitive-v021] aftermath_deferred", error);
      }
    }
    // A /remember directive decides its settlement's nominations; the grounded
    // catch-up decides only the rest, so each nomination logs one decision.
    let directiveDecided = false;
    if (directive && deps.origin !== "shadow") {
      const currentnessEntitled = hasStructuredCurrentnessEntitlement(
        settlement,
        currentnessPack,
      );
      const evidence = getConversationEvidence(sidecar, directive.evidenceRowId);
      if (evidence && evidence.lineageId === directive.evidenceLineageId) {
        directiveDecided = true;
        const directiveResults = [];
        for (const nomination of (settlement.durableNominations ?? [])) {
          directiveResults.push(admitOwnerSuppliedClaim(sidecar, {
            settlementId: settlement.settlementId,
            nominationId: nomination.nominationId,
            evidence,
            evidenceRowId: directive.evidenceRowId,
            currentnessEntitled,
            nowMs: deps.nowMs(),
          }));
        }
        logMemoryAdmission(admissionTickFromResults(directiveResults));
      }
    }
    if (!directiveDecided && deps.origin !== "shadow" && (settlement.durableNominations ?? []).length > 0) {
      try {
        runGovernedAdmissionCatchup(sidecar, {
          nowMs: deps.nowMs(),
          nominationIds: (settlement.durableNominations ?? []).map((nomination) => nomination.nominationId),
          limit: (settlement.durableNominations ?? []).length,
        });
      } catch (error) {
        // Publication is authoritative. A transient admission failure is
        // recovered by the next bounded lifecycle catch-up.
        logMemoryAdmissionError(error);
      }
    }
    if (settlement.forget && deps.origin !== "shadow" && publication.settlementId !== null) {
      // A2: only an Owner chat turn in an Owner-private conversation can
      // propose or answer a forget; applySemanticForget refuses the rest.
      try {
        const outcome = applySemanticForget({
          sidecar,
          nuclear,
          continuity: getContinuityFor(nuclear),
          ownerId: env.discordOwnerId,
          ...(deps.identityOwnerId ? { identityOwnerId: deps.identityOwnerId } : {}),
          conversationId: cycle.conversationId,
          settlementId: publication.settlementId,
          triggerCreatedAtMs: triggerEvidence?.role === "owner" ? triggerEvidence.createdAtMs : null,
          ownerTurn: !externalCycle && !afterglowPass && !awakePass && !nightPass && triggerEvidence?.role === "owner",
          nowMs: deps.nowMs(),
        }, settlement.forget);
        if (outcome.kind === "refused") console.warn(`[cognitive-v021] forget_refused reason=${outcome.reason}`);
      } catch (error) {
        console.warn("[cognitive-v021] forget_deferred", error);
      }
    }
    if (publication.outboxId !== null) await deps.projectOutbox(publication.outboxId);
    const activeFrontier = getActiveDeferredFrontier(sidecar, cycle.conversationId);
    if (activeFrontier) {
      resolveDeferredFrontier(sidecar, activeFrontier.frontierId, deps.nowMs());
    }
    const ownerObligationResolution = ownerResolutionFor("published", {
      speechMode: settlement.speech.mode,
      conversationalCommitments: settlement.commitments?.conversational,
      settlementId: settlement.settlementId,
      outboxId: publication.outboxId,
      deliveryOwnerExists: publication.outboxId !== null && Boolean(sidecar.prepare(
        "SELECT outbox_id FROM speech_outbox WHERE outbox_id = ?",
      ).get(publication.outboxId)),
      remainingConsequence: settlement.operations.intentsStillInFlight.length > 0
        || inFlight.some((item) => item.status === "in_flight" || item.status === "unknown"),
    });
    return {
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      published: true,
      outboxId: publication.outboxId,
      infrastructureNotice: null,
      thoughtModelAttempts: counters.thoughtModelAttempts,
      acceptedThoughtPasses: counters.acceptedThoughtPasses,
      composeCancelledAttempts: counters.composeCancelledAttempts,
      acceptedSettlements: publication.replayed ? 0 : 1,
      thoughtExecutionProvenance: currentExecutionProvenance(),
      initiativePreference: settlement.initiativePreference?.stance ?? "absent",
      ownerObligationResolution,
    };
    }
  } finally {
    if (deps.observabilityDb && cycleTokenMetrics.request_count > 0) {
      try {
        recordThoughtCycleMetrics(deps.observabilityDb, {
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          requestId: lastThoughtRequestId,
          pass: lastThoughtPass,
          metrics: cycleTokenMetrics,
          dispatchTruth: lastDispatchTruth,
          nowMs: deps.nowMs(),
        });
      } catch {
        // Cycle diagnostics are best-effort and must not change settlement truth.
      }
    }
  }
}
