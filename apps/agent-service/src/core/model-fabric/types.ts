/**
 * Ashley-owned Model Fabric contracts used by the MF-M1 compatibility seam.
 *
 * These types describe mechanical dispatch facts. They do not grant semantic
 * authority, qualification, promotion, or production activation.
 */

export type ModelPurposeId =
  | "expression"
  | "thought"
  | "thought_observation"
  | "exchange_cognition"
  | "curiosity_consolidation"
  | "maintenance"
  | "expression.primary"
  | "expression.fallback"
  | "thought.decision"
  | "thought.observation"
  | "cognition.exchange"
  | "curiosity.consolidation"
  | "reflection.open_item_review"
  | "execution.action_proposal"
  | "execution.review"
  | "execution.verify";

export type LogicalModelRole =
  | "thought"
  | "expression"
  | "thought_observation"
  | "reflection_initiative"
  | "exchange_cognition"
  | "curiosity_consolidation"
  | "maintenance"
  | "engineering"
  | "research";

export type SpecialistRequirement = {
  seat: string;
  requiredIndependenceGroup?: string;
};

export type ModelRouteId = string & { readonly __brand: "ModelRouteId" };
export type ProviderId = string & { readonly __brand: "ProviderId" };
export type ModelProfileId = string & {
  readonly __brand: "ModelProfileId";
};
export type ModelProfileVersion = number & {
  readonly __brand: "ModelProfileVersion";
};
export type ModelProfileFingerprint = `sha256:${string}` & {
  readonly __brand: "ModelProfileFingerprint";
};
export type ContextPolicyId = string & {
  readonly __brand: "ContextPolicyId";
};
export type ProjectionId = string & { readonly __brand: "ProjectionId" };
export type SpecialistSessionId = string & {
  readonly __brand: "SpecialistSessionId";
};
export type InferencePolicyFingerprint = `sha256:${string}` & {
  readonly __brand: "InferencePolicyFingerprint";
};
export type StructuredOutputSchemaFingerprint = `sha256:${string}` & {
  readonly __brand: "StructuredOutputSchemaFingerprint";
};

export type ModelInputCapabilities = {
  text: true;
  image: "none" | "inline_bytes" | "provider_file";
  document: "none" | "page_images" | "provider_document";
  audio: "none" | "inline_bytes" | "provider_file";
};

export type ModelOutputCapabilities = {
  text: true;
  structured: "none" | "json" | "json_schema";
  toolCalls: boolean;
  streaming: boolean;
};

/** A code-owned structured-output request. The schema constrains shape only. */
export type StructuredOutputRequest = Readonly<{
  contractId: string;
  schemaId: string;
  schemaFingerprint: StructuredOutputSchemaFingerprint;
  schema: Readonly<Record<string, unknown>>;
}>;

/** Exact provider wire binding selected by Model Fabric evidence. */
export type StructuredOutputCapabilityBinding = Readonly<
  | {
      bindingId: string;
      mode: "json_object_compatibility";
    }
  | {
      bindingId: string;
      mode: "native_json_schema";
      wireFormat:
        | "nim_guided_json"
        | "nim_response_format_json_schema"
        | "mistral_response_format_json_schema"
        | "cloudflare_response_format_json_schema";
    }
>;

/** Trusted translation from a resolved Model Fabric binding to an adapter. */
export type TrustedStructuredOutputControl = Readonly<
  | {
      kind: "json_object_compatibility";
      contractId: string;
      schemaId: string;
      schemaFingerprint: StructuredOutputSchemaFingerprint;
      bindingId: string;
    }
  | {
      kind: "native_json_schema";
      contractId: string;
      schemaId: string;
      schemaFingerprint: StructuredOutputSchemaFingerprint;
      bindingId: string;
      wireFormat:
        | "nim_guided_json"
        | "nim_response_format_json_schema"
        | "mistral_response_format_json_schema"
        | "cloudflare_response_format_json_schema";
      schema: Readonly<Record<string, unknown>>;
    }
>;

export type ModelReasoningCapabilities =
  | { mode: "none" }
  | { mode: "fixed" }
  | {
      mode: "configurable";
      efforts: readonly ("none" | "low" | "medium" | "high")[];
    };

export type ModelCapabilityProfileDefinition = {
  profileId: ModelProfileId;
  profileVersion: ModelProfileVersion;
  provider: ProviderId;
  configuredModelId: string;
  input: ModelInputCapabilities;
  output: ModelOutputCapabilities;
  reasoning: ModelReasoningCapabilities;
  cancellation: "abort_signal" | "unsupported";
  limits: {
    contextTokens: number;
    maxOutputTokens: number;
    maxMediaBytes: number | null;
    maxMediaParts: number | null;
  };
  providerOptionsPolicy: {
    allowedKeys: readonly string[];
  };
};

export type ModelCapabilityProfile = Readonly<
  ModelCapabilityProfileDefinition & {
    profileFingerprint: ModelProfileFingerprint;
  }
>;

export type RouteAdmissionBasis =
  | {
      kind: "existing_compatibility";
      compatibilityBindingId: string;
    }
  | {
      kind: "qualification_owner_approved";
      qualificationResultRef: string;
      ownerApprovalRef: string;
    };

export type ReasoningPolicy =
  | "disabled"
  | "economical"
  | "standard"
  | "high"
  | "max_supported";

export type TranslatedWireControl =
  | { kind: "reasoning_effort"; value: "none" | "low" | "medium" | "high" }
  | { kind: "chat_template_thinking"; enableThinking: boolean };

export type ObservedReasoning =
  | { status: "tokens"; reasoningTokens: number }
  | { status: "unknown" }
  | { status: "unavailable" };

export type ModelRoutePolicy = {
  routeId: ModelRouteId;
  logicalRole: LogicalModelRole;
  purposes: readonly ModelPurposeId[];
  specialistRequirement: SpecialistRequirement | null;
  enabled: boolean;
  profileId: ModelProfileId;
  profileVersion: ModelProfileVersion;
  profileFingerprint: ModelProfileFingerprint;
  reasoningPolicy: ReasoningPolicy;
  contextPolicyId: ContextPolicyId;
  quotaClass: string;
  latencyClass: "interactive" | "urgent" | "background" | "batch";
  reliabilityClass: "single_attempt" | "explicit_fallback";
  privacyPolicyId: string;
  permittedSeats: readonly string[];
  fallbackRouteIds: readonly ModelRouteId[];
  admissionBasis: RouteAdmissionBasis;
};

export type ResolvedModelRoute = Readonly<{
  logicalRole: LogicalModelRole;
  requestedPurpose: ModelPurposeId;
  specialistRequirement: SpecialistRequirement | null;
  policyRowId: string;
  occupancyKey: string;
  occupantId: string;
  portfolioRevisionId: string;
  configuredRouteId: ModelRouteId;
  dispatchedRouteId: ModelRouteId;
  routeOverride: string | null;
  modelOverride: string | null;
  profileId: ModelProfileId;
  profileVersion: ModelProfileVersion;
  profileFingerprint: ModelProfileFingerprint;
  provider: ProviderId;
  configuredModelId: string;
  reasoningPolicy: ReasoningPolicy;
  effectiveReasoning: string | null;
  inferencePolicyFingerprint: InferencePolicyFingerprint;
  contextPolicyId: ContextPolicyId;
  quotaClass: string;
  latencyClass: ModelRoutePolicy["latencyClass"];
  reliabilityClass: ModelRoutePolicy["reliabilityClass"];
  privacyPolicyId: string;
  fallbackRouteIds: readonly ModelRouteId[];
  admissionBasis: RouteAdmissionBasis;
  registryVersion: string;
}>;

export type ProjectionClassification =
  | "public"
  | "owner_private"
  | "project_private"
  | "system_private";

export type EvidenceRef = {
  kind: "message" | "episode" | "read" | "artifact" | "task" | "result";
  entityUuid: string;
  provenance: "shadow" | "live" | "external_untrusted" | "system";
};

export type MediaRef = {
  artifactEntityUuid: string;
  contentHash: string;
  mime: string;
  byteSize: number;
  retentionUntilMs: number | null;
  representation: "source_attachment" | "document_page" | "derived_audio";
  parentArtifactEntityUuid: string | null;
};

export type ModelContentPart =
  | {
      kind: "text";
      role: "instruction" | "user" | "assistant" | "evidence";
      text: string;
      classification: ProjectionClassification;
      evidenceRef?: EvidenceRef;
    }
  | {
      kind: "image_ref";
      mediaRef: MediaRef;
      classification: ProjectionClassification;
      evidenceRef?: EvidenceRef;
    }
  | {
      kind: "document_page_ref";
      mediaRef: MediaRef;
      page: number;
      classification: ProjectionClassification;
      evidenceRef?: EvidenceRef;
    }
  | {
      kind: "audio_ref";
      mediaRef: MediaRef;
      classification: ProjectionClassification;
      evidenceRef?: EvidenceRef;
    }
  | {
      kind: "structured_observation";
      schemaId: string;
      value: Readonly<Record<string, unknown>>;
      classification: ProjectionClassification;
      evidenceRefs: readonly EvidenceRef[];
    };

export type ProjectionContentBinding = {
  canonicalization: "context_projection_content_v1";
  algorithm: "sha256";
  value: `sha256:${string}`;
  privacyPolicyId: string;
};

export type ProjectionTelemetryFingerprint = `projection_structure_v1:${string}` & {
  readonly __brand: "ProjectionTelemetryFingerprint";
};

export type ContextProjection = Readonly<{
  projectionId: ProjectionId;
  contextPolicyId: ContextPolicyId;
  purpose: ModelPurposeId;
  parts: readonly ModelContentPart[];
  evidenceRefs: readonly EvidenceRef[];
  contentBinding: ProjectionContentBinding;
  telemetryFingerprint: ProjectionTelemetryFingerprint;
  bounds: Readonly<{
    maxParts: number;
    maxUtf8Bytes: number;
    maxEstimatedTokens: number;
    maxMediaBytes: number;
  }>;
  measured: Readonly<{
    parts: number;
    utf8Bytes: number;
    estimatedTokens: number;
    mediaBytes: number;
  }>;
}>;

export type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens?: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  neuronUsage?: number | null;
  providerReported: boolean;
};

export type DispatchTruth =
  | "not_sent"
  | "sent_outcome_unknown"
  | "response_received";

export type ModelFallbackClass =
  | "none"
  | "transport_failover"
  | "model_substitution"
  | "credential_failover";

export type ModelFallbackChain = {
  chainId: string;
  invocationOrdinal: number;
  fallbackFromInvocationId: string | null;
  fallbackClass: ModelFallbackClass;
};

export type ModelInvocationReceiptBase = {
  invocationId: string;
  sessionId: SpecialistSessionId;
  logicalRole: LogicalModelRole;
  requestedPurpose: ModelPurposeId;
  specialistRequirement: SpecialistRequirement | null;
  latencyMs: number;
  attentionRequestId: number | null;
  traceId: string | null;
  projectionId: ProjectionId | null;
  projectionContentBinding: ProjectionContentBinding | null;
  projectionTelemetryFingerprint: ProjectionTelemetryFingerprint | null;
  fallbackChain: ModelFallbackChain | null;
};

export type ModelPreResolutionInvocationReceipt =
  ModelInvocationReceiptBase & {
    receiptStage: "pre_resolution";
    configuredRouteId: null;
    attempts: readonly [];
  };

export type ModelResolvedDispatchFacts = {
  dispatchedRouteId: ModelRouteId;
  registryVersion: string;
  profileId: ModelProfileId;
  profileVersion: ModelProfileVersion;
  profileFingerprint: ModelProfileFingerprint;
  provider: ProviderId;
  configuredModelId: string;
  contextPolicyId: ContextPolicyId;
  admissionBasis: RouteAdmissionBasis;
  requestedReasoningPolicy: ReasoningPolicy | null;
  effectiveReasoning: string | null;
  translatedWireControl: string | null;
  inferencePolicyFingerprint: InferencePolicyFingerprint | null;
  structuredOutputSchemaFingerprint: StructuredOutputSchemaFingerprint | null;
  /** Non-secret provider account seat, when credential failover is active. */
  credentialSeat?: string | null;
};

export type ModelAttemptReceiptBase = {
  invocationId: string;
  attemptId: string;
  attemptOrdinal: number;
  fallbackFromAttemptId: string | null;
  fallbackClass: ModelFallbackClass;
  providerRequestCount: 0 | 1;
  latencyMs: number;
  projectionId: ProjectionId | null;
  projectionContentBinding: ProjectionContentBinding | null;
  projectionTelemetryFingerprint: ProjectionTelemetryFingerprint | null;
  requestedReasoningPolicy: ReasoningPolicy | null;
  effectiveReasoningSent: string | null;
  translatedWireControl: string | null;
  observedReasoning: ObservedReasoning;
  /** Current backend identity. This is mechanical, not semantic authority. */
  backend: string;
  /** Sanitized terminal error class, when the attempt failed. */
  errorClass?: string | null;
  /** Existing attention outcome when it is available without raw content. */
  outcome?: string | null;
  /** W1 capability identity captured for this exact attempt, when available. */
  capabilityFingerprint?: string | null;
  /** W1 sanitized evidence of the exact emitted provider wire. */
  wireEvidence?: import("../model-routing/types.js").WireDispatchEvidence | null;
};

export type ModelResolvedNotSentReceipt = ModelAttemptReceiptBase &
  ModelResolvedDispatchFacts & {
    receiptStage: "resolved_not_sent";
    providerRequestCount: 0;
    dispatchTruth: "not_sent";
  };

export type ModelDispatchAttemptedReceipt = ModelAttemptReceiptBase &
  ModelResolvedDispatchFacts & {
    receiptStage: "dispatch_attempted";
    providerRequestCount: 1;
    dispatchTruth: "sent_outcome_unknown";
    projectionId: ProjectionId;
    projectionContentBinding: ProjectionContentBinding;
    projectionTelemetryFingerprint: ProjectionTelemetryFingerprint;
  };

export type ModelProviderResponseReceipt = ModelAttemptReceiptBase &
  ModelResolvedDispatchFacts & {
    receiptStage: "provider_response";
    providerRequestCount: 1;
    dispatchTruth: "response_received";
    projectionId: ProjectionId;
    projectionContentBinding: ProjectionContentBinding;
    projectionTelemetryFingerprint: ProjectionTelemetryFingerprint;
    resolvedModelId: string | null;
    providerRequestId: string | null;
    /** Actual HTTP status observed at the provider response boundary. */
    providerHttpStatus?: number;
    finishReason: string | null;
    usage: ModelUsage;
  };

export type ModelAttemptReceipt =
  | ModelResolvedNotSentReceipt
  | ModelDispatchAttemptedReceipt
  | ModelProviderResponseReceipt;

export type ModelResolvedInvocationReceipt = ModelInvocationReceiptBase & {
  receiptStage: "resolved";
  configuredRouteId: ModelRouteId;
  finalDispatchedRouteId: ModelRouteId;
  finalAttemptId: string;
  fallbackClass: ModelFallbackClass;
  attempts: readonly [ModelAttemptReceipt, ...ModelAttemptReceipt[]];
};

export type ModelInvocationReceipt =
  | ModelPreResolutionInvocationReceipt
  | ModelResolvedInvocationReceipt;

export type ModelFailureCode =
  | "route_disabled"
  | "capability_mismatch"
  | "configuration_error"
  | "local_quota_exceeded"
  | "provider_unavailable"
  | "provider_quota"
  | "provider_model_unavailable"
  | "provider_internal"
  | "timeout"
  | "cancelled"
  | "malformed_output"
  | "unsupported_modality"
  | "context_too_large"
  | "budget_exhausted";

export type ModelFailure = {
  code: ModelFailureCode;
  stage:
    | "route_resolution"
    | "projection_validation"
    | "attention_admission"
    | "media_materialization"
    | "provider_dispatch"
    | "output_validation";
  retryability: "never" | "caller_may_retry" | "policy_may_fallback";
  dispatchTruth: DispatchTruth;
  retryAfterMs: number | null;
  sanitizedCauseClass: string | null;
};

export type ModelFabricDispatchMetadata = {
  receipt: ModelInvocationReceipt;
  failure: ModelFailure | null;
  resolvedRoute: ResolvedModelRoute | null;
  failoverSuppressed?: string;
  semanticProjectionHash?: string;
  dispatchMessagesHash?: string;
  suppressedProvider?: string;
  suppressedBucket?: string;
  wireEvidence?: import("../model-routing/types.js").WireDispatchEvidence;
  /** Bounded controls resolved immediately before the adapter call. */
  providerBoundaryControls?: import("../model-routing/types.js").ProviderBoundaryControls;
  /** Timing measured around the adapter call. */
  providerBoundaryTiming?: import("../model-routing/types.js").ProviderBoundaryTiming;
  /**
   * Adapter-observed affinity-transport truth preserved through metadata.
   * Model Fabric never selects affinity; it only carries the observation.
   */
  providerBoundaryTransport?: import("../model-routing/types.js").ProviderBoundaryTransport;
  capabilityIdentity?: import("./capability-identity.js").ThoughtCapabilityIdentity;
};
