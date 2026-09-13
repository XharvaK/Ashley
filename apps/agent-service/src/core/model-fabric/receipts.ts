import { randomUUID } from "node:crypto";
import type { TokenUsage } from "../model-routing/types.js";
import { freezeDeep } from "./hash.js";
import type {
  ContextProjection,
  DispatchTruth,
  ModelAttemptReceipt,
  ModelFailure,
  ModelFailureCode,
  ModelFabricDispatchMetadata,
  ModelFallbackChain,
  ModelFallbackClass,
  ModelInvocationReceipt,
  ModelPreResolutionInvocationReceipt,
  ModelProviderResponseReceipt,
  ModelResolvedDispatchFacts,
  ModelResolvedInvocationReceipt,
  ModelResolvedNotSentReceipt,
  ModelRouteId,
  ModelUsage,
  LogicalModelRole,
  ModelPurposeId,
  ObservedReasoning,
  ResolvedModelRoute,
  RouteAdmissionBasis,
  SpecialistRequirement,
  ReasoningPolicy,
} from "./types.js";
import { observedReasoningFromUsage } from "./reasoning-translation.js";
import type { ThoughtCapabilityIdentity } from "./capability-identity.js";
import type { WireDispatchEvidence } from "../model-routing/types.js";

type AttemptInput = {
  invocationId: string;
  attemptId: string;
  attemptOrdinal: number;
  fallbackFromAttemptId: string | null;
  fallbackClass: ModelFallbackClass;
  facts: ModelResolvedDispatchFacts;
  projection: ContextProjection;
  backend: string;
  requestedReasoningPolicy: ReasoningPolicy | null;
  effectiveReasoningSent: string | null;
  translatedWireControl?: string | null;
  observedReasoning?: ObservedReasoning;
};

export function createModelFallbackChain(
  input: ModelFallbackChain,
): ModelFallbackChain {
  if (!Number.isInteger(input.invocationOrdinal) || input.invocationOrdinal < 1) {
    throw new Error("invalid_model_fallback_chain_ordinal");
  }
  if (input.invocationOrdinal === 1 && input.fallbackFromInvocationId !== null) {
    throw new Error("primary_model_fallback_chain_parent");
  }
  if (input.invocationOrdinal > 1 && !input.fallbackFromInvocationId) {
    throw new Error("fallback_model_fallback_chain_parent");
  }
  return freezeDeep({ ...input });
}

type AttemptBuilder = AttemptInput & {
  startedAtMs: number;
  stage: "resolved_not_sent" | "dispatch_attempted" | "provider_response";
  providerRequestCount: 0 | 1;
  dispatchTruth: DispatchTruth;
  resolvedModelId: string | null;
  providerRequestId: string | null;
  finishReason: string | null;
  usage: ModelUsage;
  observedReasoning: ObservedReasoning;
  errorClass: string | null;
  outcome: string | null;
  providerHttpStatus?: number;
  capabilityIdentity?: ThoughtCapabilityIdentity;
  wireEvidence?: WireDispatchEvidence;
};

export type ModelFabricInvocationRecorder = {
  readonly invocationId: string;
  readonly receiptStage: "pre_resolution" | "resolved";
  beginAttempt(input: AttemptInput): AttemptHandle;
  resolve(configuredRouteId: string): void;
  setResolvedRoute(route: ResolvedModelRoute): void;
  setAttentionRequestId(requestId: number | null): void;
  finalize(fallbackClass?: ModelFallbackClass): ModelFabricDispatchMetadata;
  preResolutionMetadata(failure: ModelFailure | null): ModelFabricDispatchMetadata;
};

export type AttemptHandle = {
  markDispatchAttempted(): void;
  markProviderResponse(input: {
    resolvedModelId: string | null;
    providerRequestId?: string | null;
    finishReason?: string | null;
    usage?: TokenUsage;
    providerHttpStatus?: number;
  }): void;
  setCapabilityIdentity(identity: ThoughtCapabilityIdentity): void;
  setWireEvidence(evidence: WireDispatchEvidence): void;
  markFailure(errorClass: string, outcome?: string | null): void;
  receipt(): ModelAttemptReceipt;
};

function usageFor(usage?: TokenUsage): ModelUsage {
  return {
    inputTokens: usage?.promptTokens ?? null,
    outputTokens: usage?.completionTokens ?? null,
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    cachedInputTokens: usage?.cachedTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    ...(usage?.neuronUsage !== undefined ? { neuronUsage: usage.neuronUsage } : {}),
    providerReported: usage !== undefined,
  };
}

function nullableProjection(
  projection: ContextProjection,
): Pick<
  ModelAttemptReceipt,
  "projectionId" | "projectionContentBinding" | "projectionTelemetryFingerprint"
> {
  return {
    projectionId: projection.projectionId,
    projectionContentBinding: projection.contentBinding,
    projectionTelemetryFingerprint: projection.telemetryFingerprint,
  };
}

function attemptReceipt(builder: AttemptBuilder): ModelAttemptReceipt {
  const common = {
    invocationId: builder.invocationId,
    attemptId: builder.attemptId,
    attemptOrdinal: builder.attemptOrdinal,
    fallbackFromAttemptId: builder.fallbackFromAttemptId,
    fallbackClass: builder.fallbackClass,
    latencyMs: Math.max(0, Date.now() - builder.startedAtMs),
    effectiveReasoningSent: builder.effectiveReasoningSent,
    backend: builder.backend,
    errorClass: builder.errorClass,
    outcome: builder.outcome,
    ...builder.facts,
    translatedWireControl:
      builder.translatedWireControl ?? builder.facts.translatedWireControl ?? null,
    observedReasoning: builder.observedReasoning,
    ...(builder.capabilityIdentity
      ? { capabilityFingerprint: builder.capabilityIdentity.fingerprint }
      : {}),
    ...(builder.wireEvidence ? { wireEvidence: builder.wireEvidence } : {}),
  };
  if (builder.stage === "resolved_not_sent") {
    const receipt: ModelResolvedNotSentReceipt = {
      ...common,
      ...nullableProjection(builder.projection),
      receiptStage: "resolved_not_sent",
      providerRequestCount: 0,
      dispatchTruth: "not_sent",
    };
    return freezeDeep(receipt);
  }
  if (builder.stage === "dispatch_attempted") {
    const receipt: ModelAttemptReceipt = {
      ...common,
      ...nullableProjection(builder.projection),
      receiptStage: "dispatch_attempted",
      providerRequestCount: 1,
      dispatchTruth: "sent_outcome_unknown",
      projectionId: builder.projection.projectionId,
      projectionContentBinding: builder.projection.contentBinding,
      projectionTelemetryFingerprint: builder.projection.telemetryFingerprint,
    };
    return freezeDeep(receipt);
  }
  const receipt: ModelProviderResponseReceipt = {
    ...common,
    receiptStage: "provider_response",
    providerRequestCount: 1,
    dispatchTruth: "response_received",
    projectionId: builder.projection.projectionId,
    projectionContentBinding: builder.projection.contentBinding,
    projectionTelemetryFingerprint: builder.projection.telemetryFingerprint,
    resolvedModelId: builder.resolvedModelId,
    providerRequestId: builder.providerRequestId,
    ...(builder.providerHttpStatus !== undefined
      ? { providerHttpStatus: builder.providerHttpStatus }
      : {}),
    finishReason: builder.finishReason,
    usage: builder.usage,
  };
  return freezeDeep(receipt);
}

function failureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (error instanceof Error && error.name === "AbortError") return "AbortError";
  if (error instanceof Error && error.name) return error.name;
  return "error";
}

function modelFailureCode(
  error: unknown,
  dispatchTruth: DispatchTruth,
): ModelFailureCode {
  const code = failureCode(error);
  if (code === "route_disabled" || code === "operator_disabled") return "route_disabled";
  if (code === "capability_mismatch") return "capability_mismatch";
  if (code === "request_exceeds_tpm_budget") return "local_quota_exceeded";
  if (code === "agent_not_ready") return "configuration_error";
  if (code === "rate_limited" || code === "quota_exhausted") return "provider_quota";
  if (code === "provider_unavailable" || code === "mistral_unavailable") {
    return "provider_unavailable";
  }
  if (code === "attention_deadline" || code === "timeout" || code === "TimeoutError") return "timeout";
  if (code === "AbortError") return "cancelled";
  if (dispatchTruth === "response_received") return "provider_internal";
  return "configuration_error";
}

export function modelFailureFor(
  error: unknown,
  stage: ModelFailure["stage"],
  dispatchTruth: DispatchTruth,
): ModelFailure {
  const code = modelFailureCode(error, dispatchTruth);
  const retryability =
    code === "provider_unavailable" || code === "provider_quota"
      ? "policy_may_fallback"
      : code === "timeout" || code === "cancelled"
        ? "caller_may_retry"
        : "never";
  const retryAfterSec =
    error && typeof error === "object" && "retryAfterSec" in error
      ? Number((error as { retryAfterSec?: unknown }).retryAfterSec)
      : NaN;
  return {
    code,
    stage,
    retryability,
    dispatchTruth,
    retryAfterMs: Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : null,
    sanitizedCauseClass: failureCode(error).slice(0, 64),
  };
}

function fallbackClassFor(
  chain: ModelFallbackChain | null,
): ModelFallbackClass {
  return chain?.fallbackClass ?? "none";
}

export function createModelFabricInvocation(input: {
  logicalRole: LogicalModelRole;
  requestedPurpose: ModelPurposeId;
  specialistRequirement: SpecialistRequirement | null;
  fallbackChain: ModelFallbackChain | null;
  projection: ContextProjection;
}): ModelFabricInvocationRecorder {
  const invocationId = randomUUID();
  const sessionId = randomUUID();
  let configuredRouteId: ModelRouteId | null = null;
  let resolvedRoute: ResolvedModelRoute | null = null;
  let attentionRequestId: number | null = null;
  let resolved = false;
  const attempts: AttemptBuilder[] = [];
  const startedAtMs = Date.now();

  function buildBase(): Omit<ModelPreResolutionInvocationReceipt, "receiptStage" | "configuredRouteId" | "attempts"> {
    return {
      invocationId,
      sessionId: sessionId as ModelPreResolutionInvocationReceipt["sessionId"],
      logicalRole: input.logicalRole,
      requestedPurpose: input.requestedPurpose,
      specialistRequirement: input.specialistRequirement,
      latencyMs: Math.max(0, Date.now() - startedAtMs),
      attentionRequestId,
      traceId: null,
      projectionId: input.projection.projectionId,
      projectionContentBinding: input.projection.contentBinding,
      projectionTelemetryFingerprint: input.projection.telemetryFingerprint,
      fallbackChain: input.fallbackChain,
    };
  }

  return {
    invocationId,
    get receiptStage() {
      return resolved ? "resolved" : "pre_resolution";
    },
    beginAttempt(attemptInput) {
      const builder: AttemptBuilder = {
        ...attemptInput,
        translatedWireControl: attemptInput.translatedWireControl ?? null,
        startedAtMs: Date.now(),
        stage: "resolved_not_sent",
        providerRequestCount: 0,
        dispatchTruth: "not_sent",
        resolvedModelId: null,
        providerRequestId: null,
        finishReason: null,
        usage: usageFor(),
        observedReasoning: { status: "unknown" },
        errorClass: null,
        outcome: null,
      };
      attempts.push(builder);
      return {
        markDispatchAttempted() {
          builder.stage = "dispatch_attempted";
          builder.providerRequestCount = 1;
          builder.dispatchTruth = "sent_outcome_unknown";
        },
        markProviderResponse(response) {
          builder.stage = "provider_response";
          builder.providerRequestCount = 1;
          builder.dispatchTruth = "response_received";
          builder.resolvedModelId = response.resolvedModelId;
          builder.providerRequestId = response.providerRequestId ?? null;
          builder.providerHttpStatus = response.providerHttpStatus;
          builder.finishReason = response.finishReason ?? null;
          builder.usage = usageFor(response.usage);
          builder.observedReasoning = observedReasoningFromUsage(response.usage);
        },
        setCapabilityIdentity(identity) {
          builder.capabilityIdentity = identity;
        },
        setWireEvidence(evidence) {
          builder.wireEvidence = evidence;
        },
        markFailure(errorClass, outcome = null) {
          builder.errorClass = errorClass.slice(0, 64);
          builder.outcome = outcome;
          if (errorClass === "agent_not_ready" && builder.stage === "dispatch_attempted") {
            builder.stage = "resolved_not_sent";
            builder.providerRequestCount = 0;
            builder.dispatchTruth = "not_sent";
          }
        },
        receipt() {
          return attemptReceipt(builder);
        },
      } satisfies AttemptHandle;
    },
    resolve(route) {
      configuredRouteId = route as ModelRouteId;
      resolved = true;
    },
    setResolvedRoute(route) {
      resolvedRoute = route;
    },
    setAttentionRequestId(requestId) {
      attentionRequestId = requestId;
    },
    finalize(fallbackClass = fallbackClassFor(input.fallbackChain)) {
      if (!configuredRouteId || attempts.length === 0) {
        return this.preResolutionMetadata(null);
      }
      const receipt: ModelResolvedInvocationReceipt = {
        ...buildBase(),
        receiptStage: "resolved",
        configuredRouteId,
        finalDispatchedRouteId: attempts[attempts.length - 1]!.facts.dispatchedRouteId,
        finalAttemptId: attempts[attempts.length - 1]!.attemptId,
        fallbackClass,
        attempts: attempts.map((attempt) => attemptReceipt(attempt)) as [
          ModelAttemptReceipt,
          ...ModelAttemptReceipt[],
        ],
      };
      return {
        receipt: freezeDeep(receipt),
        failure: null,
        resolvedRoute,
      };
    },
    preResolutionMetadata(failure) {
      const receipt: ModelPreResolutionInvocationReceipt = {
        ...buildBase(),
        receiptStage: "pre_resolution",
        configuredRouteId: null,
        attempts: [],
      };
      return {
        receipt: freezeDeep(receipt),
        failure,
        resolvedRoute,
      };
    },
  };
}

export function attachModelFabricMetadata(
  error: unknown,
  metadata: ModelFabricDispatchMetadata,
): void {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  Object.defineProperty(error, "modelFabric", {
    configurable: true,
    enumerable: false,
    value: metadata,
    writable: true,
  });
}

export function metadataFromError(
  error: unknown,
): ModelFabricDispatchMetadata | null {
  if (!error || typeof error !== "object") return null;
  const metadata = (error as { modelFabric?: unknown }).modelFabric;
  return metadata && typeof metadata === "object"
    ? metadata as ModelFabricDispatchMetadata
    : null;
}
