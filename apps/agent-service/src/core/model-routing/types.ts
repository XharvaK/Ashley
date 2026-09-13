import type { AttentionLane, AttentionPurpose } from "../attention/types.js";
import type {
  LogicalModelRole,
  ModelFallbackChain,
  ProjectionClassification,
  SpecialistRequirement,
  StructuredOutputRequest,
  TrustedStructuredOutputControl,
} from "../model-fabric/types.js";
import type { ThoughtInvocationContext } from "../cognitive-v021/types.js";

/**
 * Multi-provider model routing types (Wave 1).
 *
 * Route identities, context profiles and quota buckets are shared between
 * the agent service and its provider adapters. Bucket identity is always
 * `provider:configuredApiModelId`; `resolved_model_id` stays continuity-only.
 */

export type ProviderId = "mistral" | "groq" | "nim" | "cloudflare" | "opencode_zen";

/** Non-secret Mistral account seat used only for bounded credential failover. */
export type MistralCredentialSeat = "mistral_primary" | "mistral_secondary";

export type RouteId =
  | "ashley_expression"
  | "ashley_expression_fallback"
  | "thought"
  | "utility_bulk"
  | "sandbox_operator_light"
  | "sandbox_operator_deep"
  | "sandbox_reviewer"
  | "experimental_auditor"
  | "experimental_multimodal";

export type ContextProfile =
  | "full_expression"
  | "minimal_expression_identity"
  | "thought_summary"
  | "utility_redacted"
  | "sandbox_project_only"
  | "experimental_internal_project"
  | "experimental_public";

/** Quota bucket = `providerId:configuredApiModelId`. */
export type QuotaBucket = string;

export type RouteBinding = {
  route: RouteId;
  provider: ProviderId;
  configuredModelId: string;
  contextProfile: ContextProfile;
  enabled: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Inline data:image/...;base64,... URIs only — never Discord HTTPS URLs. */
  imageUrls?: string[];
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  /** Provider-reported total tokens, when supplied. */
  totalTokens?: number;
  /** Provider-reported prompt tokens served from a prefix cache, when available. */
  cachedTokens?: number;
  /** Hidden reasoning tokens when the provider reports them separately. */
  reasoningTokens?: number;
  /** Provider-reported Cloudflare neuron usage, when supplied. */
  neuronUsage?: number;
};

export type ProviderFinishReasonClass =
  | "STOP"
  | "LENGTH"
  | "CONTENT_FILTER"
  | "TOOL"
  | "OTHER"
  | "UNKNOWN";

export type ProviderResponseDiagnostics = Readonly<{
  /** Top-level provider message.content container shape only. */
  contentContainerType: "string" | "array" | "null" | "unknown";
  /** Bounded structural chunk types; chunk content is never retained. */
  contentChunkTypes: readonly string[];
  textChunkCount: number;
  thinkingChunkCount: number;
  finalTextBytes: number;
  finishReason: string | null;
  finishReasonClass: ProviderFinishReasonClass;
  outputTokenLimit: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  /** Bounded UTF-8 byte length of provider-hidden reasoning, when exposed. */
  reasoningContentBytes?: number;
  /** Hash of provider-hidden reasoning, when exposed; reasoning text is never retained. */
  reasoningHash?: `sha256:${string}`;
  /** UTF-8 bytes of the exact serialized provider request body, when measured. */
  requestWireBytes?: number;
  /** Provider-wire bytes outside the logical message text, when measured. */
  requestWireAdditionalBytes?: number;
  extractionFailure:
    | "none"
    | "unknown_chunk_type"
    | "malformed_chunk"
    | "unsupported_container"
    | "missing_content";
}>;

/**
 * Exact timing measured around one provider-adapter invocation. These facts
 * are diagnostic only and never influence Thought semantics or retry policy.
 */
export type ProviderBoundaryTiming = Readonly<{
  requestStartedAtMs: number;
  responseAtMs: number;
  elapsedMs: number;
  remainingDeadlineMs?: number;
  outcome: "response_received" | "error";
}>;

/**
 * Observed provider-transport fact minted at the adapter boundary. Records
 * ONLY whether Ashley attached the intended session-affinity routing header
 * on one provider attempt. It is never semantic state: it proves nothing
 * about provider receipt, routing, cache existence, or cache hits.
 */
export type ProviderBoundaryTransport = Readonly<{
  sessionAffinityApplied: boolean;
  affinityPolicy: "none" | "cloudflare_thought_route_affinity_v1";
}>;

/** Default transport fact when affinity is not applicable or not configured. */
export const PROVIDER_BOUNDARY_TRANSPORT_ABSENT: ProviderBoundaryTransport =
  Object.freeze({ sessionAffinityApplied: false, affinityPolicy: "none" });

const PROVIDER_BOUNDARY_TRANSPORT_KEY = "providerBoundaryTransport" as const;

function isAffinityPolicy(value: unknown): value is ProviderBoundaryTransport["affinityPolicy"] {
  return value === "none" || value === "cloudflare_thought_route_affinity_v1";
}

/**
 * Attach an observed transport fact to a thrown provider error. The fact is
 * non-enumerable so it never leaks into logs or serialized diagnostics; the
 * raw affinity identifier is never attached, only the applied/policy truth.
 */
export function attachProviderBoundaryTransport(
  error: unknown,
  transport: ProviderBoundaryTransport,
): void {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  Object.defineProperty(error, PROVIDER_BOUNDARY_TRANSPORT_KEY, {
    configurable: true,
    enumerable: false,
    value: transport,
    writable: true,
  });
}

/** Recover a validated transport fact from a provider error, if present. */
export function providerBoundaryTransportFromError(
  error: unknown,
): ProviderBoundaryTransport | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[PROVIDER_BOUNDARY_TRANSPORT_KEY];
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionAffinityApplied !== "boolean") return undefined;
  if (!isAffinityPolicy(record.affinityPolicy)) return undefined;
  return {
    sessionAffinityApplied: record.sessionAffinityApplied,
    affinityPolicy: record.affinityPolicy,
  };
}

/**
 * Controls resolved immediately before the provider adapter call. Optional
 * fields stay absent when the current route does not expose them.
 */
export type ProviderBoundaryControls = Readonly<{
  maxTokens?: number;
  reasoningConfiguration?: string;
  reasoningBudgetTokens?: number;
  temperature?: number;
  topP?: number;
  deadlineAtMs?: number;
}>;

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolCallResult = {
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
};

/** @deprecated Use AttentionLane via purpose/lane options. */
export type Lane = "interactive" | "background";

export type CompletionOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  presencePenalty?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** Provider wire format after Model Fabric resolution. */
  responseFormat?: "json_object" | "json_schema";
  /** Code-owned shape request; adapters use only the trusted control below. */
  structuredOutput?: StructuredOutputRequest;
  tools?: ToolDefinition[];
  toolChoice?: string | Record<string, unknown>;
  signal?: AbortSignal;
  /** Legacy two-lane hint; mapped to attention lanes. */
  lane?: Lane | AttentionLane;
  purpose?: AttentionPurpose;
  /** Explicit Ashley-owned semantic role recorded by Model Fabric. */
  logicalRole?: LogicalModelRole;
  /** Projection classification enforced by privacy-aware adapters. */
  projectionClassification?: ProjectionClassification;
  /** Correlation only; MF-M1 does not select a specialist model. */
  specialistRequirement?: SpecialistRequirement | null;
  /** Caller-owned chain for an explicit multi-invocation fallback. */
  modelFallbackChain?: ModelFallbackChain | null;
  /** Qualification-only guard: do not invoke the compatibility Thought fallback. */
  disableThoughtTransportFailover?: boolean;
  /** Explicit route selection; resolved by the router when absent. */
  route?: RouteId;
  deadlineAtMs?: number | null;
  decisionId?: number | null;
  deliveryReservationId?: number | null;
  cognitiveJobId?: number | null;
  ownerId?: string | null;
  ageOriginAtMs?: number;
  providerModel?: string | null;
  /** Provider finish_reason when supplied (stop, length, …). Never a secret. */
  finishReason?: string | null;
  projectionIdentity?: {
    semanticProjectionHash: string;
    dispatchMessagesHash: string;
  };
  /** Trusted kernel-owned Thought context; never populated from model output. */
  thoughtInvocationContext?: Omit<ThoughtInvocationContext, "allocationId">;
};

export type ProviderCompletion = {
  text: string;
  toolCalls?: ToolCallResult[];
  usage?: TokenUsage;
  providerModel?: string | null;
  /** Provider request identifier, when the provider returns one. */
  providerRequestId?: string | null;
  /**
   * Cloudflare cf-ray response identifier, when the provider returns one
   * (P3 S5 provider diagnostic; read-only header surfacing, never sent).
   */
  cfRay?: string | null;
  /** Actual HTTP response status observed at the provider boundary. */
  providerHttpStatus?: number;
  /** Provider finish_reason when supplied (stop, length, …). Never a secret. */
  finishReason?: string | null;
  /** Bounded provider response shape and accounting diagnostics. */
  responseDiagnostics?: ProviderResponseDiagnostics;
  /** Sanitized evidence of the request emitted by the provider adapter. */
  wireEvidence?: WireDispatchEvidence;
  /**
   * Observed transport fact minted by the adapter on the success path
   * (whether the affinity routing header was attached). Absent when the
   * adapter does not report one; never carries the raw identifier.
   */
  providerBoundaryTransport?: ProviderBoundaryTransport;
};

export const PROVIDER_HTTP_STATUS_BOUNDARY = "__ashley_provider_http_status" as const;

export function validateProviderHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

export function attachProviderHttpStatusBoundary(
  error: unknown,
  status: unknown,
): void {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  const providerHttpStatus = validateProviderHttpStatus(status);
  if (providerHttpStatus === undefined) return;
  Object.defineProperty(error, PROVIDER_HTTP_STATUS_BOUNDARY, {
    configurable: true,
    enumerable: false,
    value: providerHttpStatus,
    writable: true,
  });
}

export function providerHttpStatusFromBoundary(
  error: unknown,
): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  return validateProviderHttpStatus(
    (error as Record<string, unknown>)[PROVIDER_HTTP_STATUS_BOUNDARY],
  );
}

/**
 * Causal provenance for a provider-dispatch abort. Node v22
 * `AbortSignal.timeout()` rejects with `TimeoutError`, but the Thought
 * dispatch nests two such signals (attention admission + dispatch), so the
 * dispatcher must consult the dedicated signals — not error prose — to tell
 * a fired Thought deadline from any other abort.
 */
export type DeadlineTimeoutProvenance = {
  /** Outer/caller signal passed into dispatch (may nest the attention deadline). */
  signal?: AbortSignal | null;
  /** Dedicated `AbortSignal.timeout(deadlineAtMs)` owned by the dispatcher, when created. */
  deadlineSignal?: AbortSignal | null;
  /** Absolute dispatch deadline; exact-boundary backstop only. */
  deadlineAtMs?: number | null;
};

function abortReasonName(value: unknown): string | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * True only for a `TimeoutError` with no provider HTTP response whose
 * deadline provenance is mechanically established: the dispatcher's
 * dedicated deadline signal fired, the outer chain aborted with a timeout
 * reason, or the absolute deadline fact is already exhausted. Timeout prose
 * in a message alone never qualifies.
 */
export function isDeadlineTimeoutError(
  error: unknown,
  provenance?: DeadlineTimeoutProvenance | null,
): boolean {
  if (!(error instanceof Error) || error.name !== "TimeoutError") return false;
  if (providerHttpStatusFromBoundary(error) !== undefined) return false;
  if (provenance?.deadlineSignal?.aborted === true) return true;
  const signal = provenance?.signal ?? null;
  if (signal?.aborted === true && abortReasonName(signal.reason) === "TimeoutError") return true;
  const deadlineAtMs = provenance?.deadlineAtMs;
  if (typeof deadlineAtMs === "number" && Number.isFinite(deadlineAtMs) && Date.now() >= deadlineAtMs) {
    return true;
  }
  return false;
}

export type WireDispatchEvidence = Readonly<{
  adapterId: string;
  wireFormat: string;
  sanitizedBodyDigest: `sha256:${string}`;
  emittedEnforcementMode: string;
  providerDeclaredEnforcement: string | "unavailable";
  /** Exact Model Fabric binding used by the adapter, when structured output is active. */
  bindingId?: string | null;
}>;

/**
 * Trusted Model Fabric translation only. Callers must not populate this with
 * raw provider extras; the NIM adapter applies it as already-resolved wire.
 */
export type TrustedReasoningControl =
  | { kind: "reasoning_effort"; value: "none" | "low" | "medium" | "high" }
  | { kind: "chat_template_thinking"; enableThinking: boolean };

export type ProviderDispatchArgs = {
  messages: ChatMessage[];
  /** Configured API model id for the bucket (never resolved_model_id). */
  modelId: string;
  options: CompletionOptions;
  /** Originates from Model Fabric translation, never from cognition callers. */
  fabricReasoning?: TrustedReasoningControl;
  /** Originates from Model Fabric translation, never from cognition callers. */
  fabricStructuredOutput?: TrustedStructuredOutputControl;
  /** Non-secret account seat; meaningful only for Mistral dispatches. */
  credentialSeat?: MistralCredentialSeat;
  signal?: AbortSignal;
};

export type ModelProviderAdapter = {
  provider: ProviderId;
  dispatch(args: ProviderDispatchArgs): Promise<ProviderCompletion>;
};

export function quotaBucketFor(
  provider: ProviderId,
  configuredModelId: string,
): QuotaBucket {
  return `${provider}:${configuredModelId}`;
}
