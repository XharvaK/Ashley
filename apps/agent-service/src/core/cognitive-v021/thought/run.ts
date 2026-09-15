import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isAuthorizedOwnerId } from "../../../owner-auth.js";
import {
  completeChat,
} from "../../../mistral-client.js";
import type { ChatMessage } from "../../model-routing/types.js";
import {
  ORDINARY_THOUGHT_BUDGET_MS,
  MAX_AUTHORITY_REVISIONS,
  MAX_EFFECT_ROUNDS,
  MAX_OBSERVATION_ROUNDS,
  MAX_THOUGHT_PASSES,
  MAX_THOUGHT_MODEL_ATTEMPTS,
  SETTLEMENT_SCHEMA_VERSION,
  type CycleTriggerKind,
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
  type SemanticRef,
  type Observation,
  type DeliveryIntent,
  type RememberDirective,
  type AuthorityCode,
  type InFlightRecord,
  type EffectReceipt,
  type ThoughtExecutionDispatchTruth,
  type ThoughtExecutionProvenance,
  type PublicationRejectionReason,
  type OwnerObligationAttemptOutcome,
  type OwnerObligationResolution,
  type ConversationalCommitment,
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
} from "../cycle/inbox.js";
import type { AttemptInputBasis } from "../social/types.js";
import type { CommitmentRealizationBinding } from "../social/types.js";
import {
  commitmentBindingsForSettlement,
  isCommitmentsEnabled,
  persistCommitmentProposals,
  settlePersistedCommitmentProposals,
} from "../../relationship/commitment-admission.js";
import { captureOwnerDispatchCoverage, proveExactOwnerSupersession } from "../cycle/owner-coverage.js";
import { getConversationEvidence, listConversationEvidence } from "../evidence/conversation-log.js";
import { listInFlight } from "../effect/in-flight.js";
import { dispatchEffect } from "../effect/proposal.js";
import {
  buildOperationalEffectNamespace,
  buildOperationalEffectNamespaceFromRefs,
} from "../effect/effect-ref.js";
import { registerActiveThought } from "../cycle/active.js";
import { adaptPerception } from "../perception/adapter.js";
import { buildThoughtInput, captureThoughtSourcePackage } from "./input.js";
import { parseThoughtSemanticOutput, THOUGHT_SEMANTIC_PARSER_ID } from "./parse.js";
import {
  buildReferenceAllowlist,
  hasReferenceTarget,
  registerLocalAlias,
  type ThoughtReferenceAllowlist,
  type ThoughtReferenceTarget,
  type ThoughtReferenceTargetMap,
} from "./reference-allowlist.js";
import { bindEffectIntent, bindObservationIntent } from "./operation-binding.js";
import {
  thoughtOutputStructuredRequest,
} from "./output-contract.js";
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
import { admitOwnerSuppliedClaim, runGovernedAdmissionCatchup } from "../memory/admission.js";
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
  emitInfrastructureNotice,
  makeThoughtTerminal,
  type ThoughtTerminalDescriptor,
} from "../speech/infrastructure-notice.js";
import { recordThoughtC3TerminalFailure } from "../failure/c3-recorder.js";
import { renderForTransport } from "../../conversation/rendering.js";
import {
  getThoughtAttemptCounters,
  incrementThoughtAttemptCounter,
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
  CONTROL_INTERPRETATION_SCHEMA,
  CONTROL_INTERPRETATION_SCHEMA_FINGERPRINT,
  parseControlInterpretation,
  type ControlInterpretationResult,
} from "../../relationship/control-admission.js";
import {
  buildExternalDmAuthorityBinding,
  externalDmPrincipal,
  isExternalDmCognitionEnabled,
  isExternalDmPublicationEnabled,
} from "../social/dm-activation.js";
import {
  buildRoomAuthorityBinding,
  isRoomPublicationEnabled,
  roomIdentity,
  type OwnerRoomDestination,
} from "../social/room-activation.js";
import { listAvailableSocialDestinations, listOwnerTrustedRoomConversationIds } from "../../relationship/social-authority.js";
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

export type ControlInterpretationPhaseInput = {
  sourceRef: string;
  messageId: string;
  message: string;
  candidatePrincipalRefs?: readonly Record<string, unknown>[];
  sourceSpan?: { start: number; end: number };
};

export type ControlInterpretationPhaseResult = {
  result: ControlInterpretationResult;
  requestId: string;
  attempts: number;
};

const CONTROL_INTERPRETER_INSTRUCTIONS = [
  "You are Ashley's bounded Owner control interpreter.",
  "Interpret only the authenticated Owner message supplied in the user context.",
  "Return exactly one JSON object: none, ambiguous, or proposals.",
  "Proposals may contain only ordinal, operation, mechanically attributed principalRef, scope, duration, sourceSpan, and thoughtCycle.",
  "The ordinal is the only proposal identity supplied by Thought. Never emit id, proposalId, uuid, transactionId, settlementId, or any other identity field.",
  "Never emit speech, effects, commitments, tools, or ordinary conversational content in this phase.",
  "Quoted, hypothetical, negated, or ambiguous authority must return ambiguous or none according to the supplied semantic reading; the Host does not infer those meanings.",
  "Do not guess a principal from a display name or handle. Use only the supplied exact candidate references.",
].join(" ");

/**
 * Run the dedicated bounded control phase through the existing Thought
 * dispatch owner. This phase has its own schema and is never the ordinary
 * canonical settlement form.
 */
export async function runControlInterpretationPhase(
  input: ControlInterpretationPhaseInput,
  deps: Pick<KernelDeps, "attentionDb" | "completeChat">,
  options: {
    ownerId?: string;
    deadlineAtMs?: number;
    signal?: AbortSignal;
    requestId?: string;
  } = {},
): Promise<ControlInterpretationPhaseResult> {
  if (!input.sourceRef.trim() || !input.messageId.trim() || !input.message.trim()) {
    throw new Error("control_phase_input_required");
  }
  const requestId = options.requestId ?? randomUUID();
  const deadlineAtMs = options.deadlineAtMs ?? Date.now() + 30_000;
  const messages: ChatMessage[] = [
    { role: "system", content: CONTROL_INTERPRETER_INSTRUCTIONS },
    {
      role: "user",
      content: JSON.stringify({
        sourceRef: input.sourceRef,
        messageId: input.messageId,
        message: input.message,
        ...(input.sourceSpan ? { sourceSpan: input.sourceSpan } : {}),
        candidatePrincipalRefs: input.candidatePrincipalRefs ?? [],
      }),
    },
  ];
  const completion = await invokeThoughtComplete(messages, {
    attentionDb: deps.attentionDb,
    route: "thought",
    purpose: "thought",
    lane: "urgent_grounded",
    ownerId: options.ownerId ?? "owner",
    responseFormat: "json_schema",
    structuredOutput: {
      contractId: "ashley.thought.control-interpretation.v1",
      schemaId: "ashley.thought.control-interpretation.v1.schema",
      schemaFingerprint: CONTROL_INTERPRETATION_SCHEMA_FINGERPRINT,
      schema: CONTROL_INTERPRETATION_SCHEMA,
    },
    maxTokens: 2_048,
    temperature: 0,
    deadlineAtMs,
    signal: options.signal,
    requestId,
  }, deps.completeChat);
  return {
    result: parseControlInterpretation(completion.text),
    requestId,
    attempts: 1,
  };
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
export const STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS = 16_384;

/** The single adapter boundary for Thought dispatch. attentionDb is mandatory. */
export async function invokeThoughtComplete(
  messages: ChatMessage[],
  options: ThoughtCompleteOptions,
  invoker: ThoughtCompleteInvoker = completeChat,
): ReturnType<typeof completeChat> {
  if (!options.attentionDb) throw new Error("dispatch_data_plane_missing");
  return invoker(messages, options);
}

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
  const providerHttpStatus = attempt?.receiptStage === "provider_response"
    ? attempt.providerHttpStatus
    : undefined;
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
    ?? capturedAttempt?.provider;
  const model = attempt?.configuredModelId
    ?? capturedAttempt?.configuredModelId
    ?? completion?.modelAlias;
  const providerModel = completion?.providerModel ?? undefined;
  // P3 S5: provider request identity + cache/usage truth. Missing numeric
  // evidence stays absent (UNKNOWN downstream) — never coerced (no Number()
  // wrapping: Number(null) === 0 would launder missingness into observed
  // zero). cachedSource marks WHERE the cached count was observed.
  const providerRequestId = typeof completion?.providerRequestId === "string" && completion.providerRequestId
    ? completion.providerRequestId
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
  const cachedSource = canonicalUsage?.cachedInputTokens !== null && canonicalUsage?.cachedInputTokens !== undefined
    ? "provider_usage"
    : undefined;
  const receipt = metadata?.receipt;
  const attentionRequestId = completion?.attentionRequestId
    ?? (receipt && receipt.attentionRequestId !== null ? receipt.attentionRequestId : undefined);
  const canonicalSchemaFingerprint = capturedAttempt?.semanticSchemaFingerprint
    ?? THOUGHT_OUTPUT_SCHEMA_FINGERPRINT;
  const wireSchemaFingerprint = capturedAttempt?.wireSchemaFingerprint
    ?? attempt?.structuredOutputSchemaFingerprint
    ?? input.options.structuredOutput?.schemaFingerprint;
  const reasoningConfiguration = controls?.reasoningConfiguration
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
      : capturedAttempt?.modelFabricInvocationId
        ? { modelFabricInvocationId: capturedAttempt.modelFabricInvocationId }
      : receipt?.invocationId
        ? { modelFabricInvocationId: receipt.invocationId }
        : {}),
    ...(attempt?.attemptId
      ? { modelFabricAttemptId: attempt.attemptId }
      : capturedAttempt?.modelFabricAttemptId
        ? { modelFabricAttemptId: capturedAttempt.modelFabricAttemptId }
        : {}),
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
    ...(canonicalUsage?.cachedInputTokens !== null
      && canonicalUsage?.cachedInputTokens !== undefined
      ? { cachedInputTokens: canonicalUsage.cachedInputTokens }
      : {}),
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
    executionProvenanceFromMetadata(completion.modelFabric).dispatchTruth;
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
    : executionProvenanceFromMetadata(metadata).dispatchTruth;
  return providerFailureCapture({
    metadata,
    completion,
    options,
    dispatchTruth,
    error,
    status: {
      parserStatus: "not_run",
      validatorStatus: "not_run",
      failureClass: metadata?.failure?.sanitizedCauseClass ?? safeFailureClass(error),
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
): ThoughtSettlementDraft {
  // Local semantic aliases are resolved to ordinary durable IDs in this
  // kernel projection. The aliases themselves never become a lookup namespace.
  const localAliases = new Map<string, LocalAliasBinding>();
  const conversationId = input.rawConversation[0]?.conversationId
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
      dimensions: { ...delta.record.dimensions },
      assertionKey: null,
      status: delta.record.status,
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
            dimensions: { ...delta.record.dimensions },
            assertionKey: null,
            status: delta.record.status,
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
          return {
            op: "create" as const,
            trigger: {
              triggerId: randomUUID(),
              conversationId,
              concernId,
              snapshotHash,
              dueAtMs: delta.dueAtMs,
              payload: { purpose: delta.purpose, ...delta.payload },
            },
          };
        })());
  if (semantic.subscriptionDeltas) result.subscriptions = semantic.subscriptionDeltas.map((delta, index) => delta.op === "cancel"
      ? { op: "cancel", subscriptionId: delta.target }
      : {
          op: "create",
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
    }));
  return result as ThoughtSettlementDraft;
}

function semanticReferencesForInput(input: ThoughtInput | ProjectedThoughtInput): string[] {
  const effectRefs = operationalNamespaceForThoughtInput(input).allowedOperationalEffectRefs;
  return [
    ...input.rawConversation.map((row) => row.rowId),
    ...input.workingContext.map((item) => item.id),
    ...(input.deskEntries ?? []).map((item) => item.id),
    ...input.occupancy.map((item) => item.concernId),
    ...input.observations.map((item) => item.observationId),
    ...effectRefs,
    ...input.retrieval.hits.flatMap((hit) => "supportRefs" in hit ? [hit.ref, ...hit.supportRefs] : [hit.ref]),
    input.trigger.ref,
  ];
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
  for (const item of input.observations) recordTarget(item.observationId, "observation");
  return targets;
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
    signal?: AbortSignal;
    deadlineAtMs: number;
    structuralFeedback?: StructuralFeedbackInput;
    settlementRevisionFeedback?: SettlementRevisionFeedback;
    /** Optional caller narrowing; it may never widen the Model Fabric policy. */
    maxTokens?: number;
    /** Qualification-only seam for the exact NIM candidate; no fallback is allowed. */
    disableThoughtTransportFailover?: boolean;
    /** W7 exact private-budget reservation bridge for this Thought invocation. */
    privateBudgetBinding?: PrivateBudgetDispatchBinding;
    nowMs?: number;
  },
): Promise<ThoughtInvocation> {
  const pass = options.pass ?? 1;
  const requestId = options.requestId ?? randomUUID();
  const operationalNamespace = operationalNamespaceForThoughtInput(input);
  const dispatchOptions: ThoughtCompleteOptions = {
    attentionDb: deps.attentionDb,
    route: "thought",
    responseFormat: "json_schema",
    structuredOutput: thoughtOutputStructuredRequest(operationalNamespace),
    purpose: "thought",
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
      semanticProjectionHash = allocated.hashes.semanticProjectionHash;
      dispatchMessagesHash = allocated.hashes.dispatchMessagesHash;
    }

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
    const completion = await invokeThoughtComplete(
      messages,
      dispatchOptions,
      deps.completeChat,
    );
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
        thoughtExecutionProvenance: executionProvenanceFromMetadata(completion.modelFabric),
      };
    }
    const semanticResult = parseThoughtSemanticOutput(
      completion.text,
      new Set(semanticReferencesForInput(input)),
    );
    if (!semanticResult.ok) {
      const diagnosticCode = semanticResult.code as ThoughtParserFailureCode;
      const previousFeedback = typeof options.structuralFeedback === "string"
        ? null
        : options.structuralFeedback;
      const structuralFeedback = createThoughtStructuralFeedback({
        code: diagnosticCode,
        field: semanticResult.field,
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
        thoughtExecutionProvenance: executionProvenanceFromMetadata(completion.modelFabric),
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
        thoughtExecutionProvenance: executionProvenanceFromMetadata(completion.modelFabric),
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
          ),
        }
      : semantic.kind === "observation_intent"
        ? (() => {
            const bound = bindObservationIntent({
              intent: semantic,
              cycleId: input.cycleId,
              generation: input.generation,
              parentDeadlineAtMs: options.deadlineAtMs,
              nowMs: options.nowMs ?? Date.now(),
              authorityCurrentness,
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
                 authorityCurrentness: bound.authorityCurrentness,
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
                   request: bound.request,
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
      thoughtExecutionProvenance: executionProvenanceFromMetadata(completion.modelFabric),
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
        thoughtExecutionProvenance: lastCompletion
          ? executionProvenanceFromMetadata(lastCompletion.modelFabric)
          : UNKNOWN_EXECUTION_PROVENANCE,
      };
    }
    const executionProvenance = !dispatchStarted && !lastCompletion
      ? NOT_SENT_EXECUTION_PROVENANCE
      : executionProvenanceFromMetadata(
        establishedExecutionMetadata(metadataFromError(error), lastCompletion),
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
    };
  }
}

function payloadRecord(event: InboxEvent): Record<string, unknown> {
  return typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
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
    return [{
      observationId,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      derived: item.derived === true,
      replaySafe: item.replaySafe === true,
      modality: modality as Observation["modality"],
      payload: item.payload,
      provenance,
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
    case "recovery":
      return value;
    default:
      return "owner_message";
  }
}

function deliveryIntentFor(
  cycle: { conversationId: string; triggerKind: CycleTriggerKind },
  payload: Record<string, unknown>,
  purpose: DeliveryIntent["purpose"],
  triggerKind = cycle.triggerKind,
  externalPublication?: DeliveryIntent["externalPublication"],
  socialLifecycle?: DeliveryIntent["socialLifecycle"],
  destinationOverride?: DeliveryIntent["destination"],
): DeliveryIntent {
  const external = triggerKind === "external_message";
  const trigger: DeliveryIntent["trigger"] =
    triggerKind === "idle_opportunity" ? "idle" :
      triggerKind === "commitment_due" ? "commitment_due" :
      triggerKind === "subscription_item" ? "subscription" :
        triggerKind === "future_trigger_due" ? "future_trigger" :
          triggerKind === "recovery" ? "recovery" :
            triggerKind === "observation_or_receipt" ? "operation_completion" :
            external ? "external_message" : "owner_message_reactive";
  const ownerId = typeof payload.ownerId === "string" && payload.ownerId.trim()
    ? payload.ownerId
    : cycle.conversationId;
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
): boolean {
  if (!currentGenerationIs(db, cycle)) return false;
  if (!attemptBinding) return true;
  if (!attemptBinding.attemptId || !attemptBinding.attemptInputBasis) return false;
  return currentAttemptIs(db, {
    cycleId: cycle.cycleId,
    generation: cycle.generation,
    attemptId: attemptBinding.attemptId,
    attemptInputBasis: attemptBinding.attemptInputBasis,
  });
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
  // Recovery/turn preflight is bounded and allowlist-gated. Admission errors
  // remain fail-soft: the durable nomination is retried on the next cycle.
  if (deps.origin !== "shadow") {
    try {
      runGovernedAdmissionCatchup(sidecar, { nowMs: deps.nowMs(), limit: 64 });
    } catch {
      // The authoritative nomination remains durable and unadmitted.
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
  const originProfile = resolveOriginProfile(sidecar, event, cycle);
  if (!originProfile) throw new Error("origin_profile_unavailable");
  const publicPresenceEnabled = isAutonomousPublicPresenceOpportunity({
    cycleTriggerKind: cycle.triggerKind,
    wakeSourceKind: wake.sourceKind,
    eventKind: event.kind,
    channel: payload.channel,
    occupantId: cycle.occupantId,
    configuredOwnerId: payload.ownerId,
    reconciling: wake.state === "reconciling",
  });
  const cycleCapabilityReality = withPublicPresenceCapability(
    deps.capabilityReality,
    publicPresenceEnabled,
  );
  const publicPresence = publicPresenceEnabled
    ? readPublicPresenceContext(sidecar, deps.nowMs())
    : undefined;
  let triggerEvidence = typeof payload.evidenceRowId === "string"
    ? getConversationEvidence(sidecar, payload.evidenceRowId)
    : null;
  if (triggerEvidence) cycle = appendCycleLogIds(sidecar, cycle.cycleId, [triggerEvidence.rowId], deps.nowMs());
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
    if (!currentLifecycleIs(sidecar, admittedCycle, attemptLifecycleBinding)) {
      return resultWithCounters(
        admittedCycle.cycleId,
        admittedCycle.generation,
        null,
        counters,
        staleOwnerResultOptions(),
      );
    }
    const notice = emitInfrastructureNotice(sidecar, {
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
      trigger: deliveryIntentFor(admittedCycle, payload, "system_notice", originProfile.triggerKind).trigger,
      deliveryLane: deliveryIntentFor(admittedCycle, payload, "system_notice", originProfile.triggerKind).deliveryLane,
    });
    // The infrastructure notice is primary terminal output. C3 is a bounded,
    // fail-soft derived projection and never changes the terminal result.
    // Shadow notices remain suppressed evaluations and must not mint a live
    // Ashley C3 experience; recovery also excludes any legacy shadow rows.
    if (deps.origin !== "shadow") {
      recordThoughtC3TerminalFailure(sidecar, {
        noticeKey: notice.noticeKey,
        noticeId: notice.noticeId,
        cycleId: admittedCycle.cycleId,
        generation: admittedCycle.generation,
        occurredAtMs: deps.nowMs(),
        failureClass: reason,
        attemptId: lastThoughtRequestId,
      });
    }
    if (deps.projectSystemNotice) await deps.projectSystemNotice(notice.noticeId);
    updateCycleState(sidecar, admittedCycle.cycleId, "silent", deps.nowMs());
    return resultWithCounters(admittedCycle.cycleId, admittedCycle.generation, notice.noticeText, counters, {
      thoughtExecutionProvenance: currentExecutionProvenance(),
      ownerObligationResolution: ownerResolutionFor("failed"),
    });
  };

  let ownerMessage = typeof payload.ownerMessage === "string"
    ? payload.ownerMessage
    : triggerEvidence?.text ?? listConversationEvidence(sidecar, cycle.conversationId, { limit: 1 }).at(-1)?.text ?? "";
  const perceive = async (): Promise<Observation[]> => {
    if (boundObservations) return boundObservations;
    try {
      const perceived = await adaptPerception({
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        ownerMessage,
        runPerception: deps.runPerception,
      });
      return [...suppliedObservations(payload, cycle), ...perceived];
    } catch {
      return suppliedObservations(payload, cycle);
    }
  };
  let observationsForThought = await perceive();
  let inFlight = listInFlight(sidecar, cycle.cycleId);
  let counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
  let pass = counters.acceptedThoughtPasses + 1;
  let structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
  let authorityObjections: AuthorityCode[] = [];
  let settlementRevisionFeedback: SettlementRevisionFeedback | undefined;
  const thoughtDeadlineAtMs = deps.nowMs() + ORDINARY_THOUGHT_BUDGET_MS;
  let structuralFeedback: ThoughtStructuralFeedback | null = null;
  const projectionCache = new ProjectionCache<AllocatedThoughtProjection>();
  let cycleTokenMetrics = createThoughtCycleTokenMetrics();
  let lastThoughtRequestId: string = randomUUID();
  let lastThoughtPass = pass;
  let lastDispatchTruth: ThoughtExecutionDispatchTruth = "unknown";

  try {
    for (;;) {
    counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
    structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
    if (!currentLifecycleIs(sidecar, cycle, attemptLifecycleBinding)) {
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
    const thoughtInputOptions = {
      sidecar,
      cycle,
      triggerKindOverride: originProfile.triggerKind,
      triggerText: ownerMessage,
      triggerEvidence,
      constitution: deps.constitution,
      capabilityReality: cycleCapabilityReality,
      ...(publicPresence === undefined ? {} : { publicPresence }),
      observations: observationsForThought,
      inFlight,
      runtimeCondition: { thoughtUnavailable: false },
      rememberDirective: directive,
      authorityObjections,
      derivedStore: deps.derivedStore,
      authorityDb: deps.attentionDb,
      ...(thoughtAudience ? { audience: thoughtAudience } : {}),
      ...(ownerRoomDestination ? { authenticatedOwner: true } : {}),
      ...(crossSurfaceScope ? { crossSurfaceConversationIds: crossSurfaceScope } : {}),
      ...(availableDestinations === undefined ? {} : { availableDestinations }),
      ...(externalBinding ? { licenses: [...externalBinding.licenseRefs] } : {}),
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
    } catch (err) {
      if (err instanceof RequiredOverflowError) {
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
              estimatedInputTokens: err.estimatedInputTokens,
              semanticBudgetTokens: err.semanticBudgetTokens,
              overflowTokens: Math.max(0, err.estimatedInputTokens - err.semanticBudgetTokens),
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
    const invocation = await runThoughtModel(allocated.projected, deps, {
      pass,
      signal: activeThought.signal,
      deadlineAtMs: thoughtDeadlineAtMs,
      structuralFeedback: structuralFeedback ?? undefined,
      settlementRevisionFeedback,
      maxTokens: structuralFeedback
        ? STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS
        : undefined,
      nowMs: deps.nowMs(),
      privateBudgetBinding: options.privateBudgetBinding,
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
        inFlight = listInFlight(sidecar, cycle.cycleId);
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
      const retryScheduled =
        structuralRetriesForPass < 2 && counters.thoughtModelAttempts < MAX_THOUGHT_MODEL_ATTEMPTS;
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

    // External social Thought has no instrumental authority. Capability
    // reality is descriptive input, so enforce the boundary before either
    // generic operation executor can be reached.
    if (
      externalCycle
      && (invocation.output.kind === "observation_request" || invocation.output.kind === "effect_proposal")
    ) {
      return emitFailure(
        "external_operation_disabled",
        undefined,
        makeThoughtTerminal("authority", {
          codes: ["CAPABILITY_UNAVAILABLE"],
          stage: "external_operation",
        }),
      );
    }

    if (invocation.output.kind === "observation_request") {
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
      incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "observationRounds");
      updateCycleState(sidecar, cycle.cycleId, "awaiting_operation", deps.nowMs());
      try {
        const observed = await deps.executeObservation(invocation.output.observationRequest);
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
      } catch {
        return emitFailure(
          "observation_unavailable",
          undefined,
          makeThoughtTerminal("operation_dispatch", { codes: ["observation_unavailable"], stage: "observation_dispatch" }),
        );
      }
      pass += 1;
      structuralRetriesForPass = persistedMalformedRetries(sidecar, cycle.cycleId, cycle.generation, pass);
      continue;
    }

    if (invocation.output.kind === "effect_proposal") {
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
      if (counters.effectRounds >= MAX_EFFECT_ROUNDS) {
        return emitFailure(
          "pass_exhausted",
          undefined,
          makeThoughtTerminal("budget_exhausted", { codes: ["pass_exhausted"], stage: "effect_rounds" }),
        );
      }
      incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "effectRounds");
      updateCycleState(sidecar, cycle.cycleId, "awaiting_operation", deps.nowMs());
      const proposal = {
        ...invocation.output.effectProposal,
        originEventId: event.id,
        originAttemptId: null,
      };
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
      const dispatch = await dispatchEffect(
        sidecar,
        proposal,
        { ...reloadDispatchState(), reload: reloadDispatchState },
        deps.executeEffect,
      );
      if (!dispatch.dispatched) {
        if (dispatch.codes.includes("STALE_GENERATION")) {
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
      inFlight = listInFlight(sidecar, cycle.cycleId);
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
      observations: observationsForThought,
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
    if (!currentLifecycleIs(sidecar, cycle, attemptLifecycleBinding)) {
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
      const configuredPrincipal = externalDmPrincipal();
      const dmClosed = !dmDestination
        || !isExternalDmCognitionEnabled()
        || !isExternalDmPublicationEnabled()
        || !configuredPrincipal
        || dmDestination.principalId !== configuredPrincipal;
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
    const publication = publishSemanticTransaction(sidecar, settlement, {
      nowMs: deps.nowMs(),
      triggerKind: cycle.triggerKind,
      fidelity: validation.draft.speech.mode === "draft" ? "passed" : "skipped",
      origin: deps.origin,
      deliveryIntent: deliveryIntentFor(
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
      ),
      authorityDb: authorityDbForPacks(deps, packs),
      expectedCurrentness: invocation.kernelEnvelope?.authorityCurrentness ?? packs.currentness.binding,
      currentness: currentnessPack,
      sourceCurrentness: allocated.projected.sourceCurrentness,
      wakeId: cycle.wakeId,
      wakeLeaseToken: event.claimToken,
      semanticPass: pass,
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
    if (deps.origin !== "shadow" && (settlement.durableNominations ?? []).length > 0) {
      try {
        runGovernedAdmissionCatchup(sidecar, {
          nowMs: deps.nowMs(),
          nominationIds: (settlement.durableNominations ?? []).map((nomination) => nomination.nominationId),
          limit: (settlement.durableNominations ?? []).length,
        });
      } catch {
        // Publication is authoritative. A transient admission failure is
        // recovered by the next bounded lifecycle catch-up.
      }
    }
    if (publication.outboxId !== null) await deps.projectOutbox(publication.outboxId);
    if (directive && deps.origin !== "shadow") {
      const currentnessEntitled = hasStructuredCurrentnessEntitlement(
        settlement,
        currentnessPack,
      );
      const evidence = getConversationEvidence(sidecar, directive.evidenceRowId);
      if (evidence && evidence.lineageId === directive.evidenceLineageId) {
        for (const nomination of (settlement.durableNominations ?? [])) {
          admitOwnerSuppliedClaim(sidecar, {
            settlementId: settlement.settlementId,
            nominationId: nomination.nominationId,
            evidence,
            evidenceRowId: directive.evidenceRowId,
            currentnessEntitled,
            nowMs: deps.nowMs(),
          });
        }
      }
    }
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
