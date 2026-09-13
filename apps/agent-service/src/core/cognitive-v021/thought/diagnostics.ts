import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  AllocationDiagnostics,
  AllocationReceipt,
  AllocationTokenBreakdown,
} from "./projection-allocator/receipt.js";
import { DEFAULT_SEMANTIC_PROJECTION_ENVELOPE, type SemanticProjectionEnvelope } from "./projection-allocator/budget.js";
import type { RetrievalQuery } from "../retrieval/query.js";
import type {
  PublicationRejectionReason,
  RetrievalInfrastructureState,
} from "../types.js";
import { getPrivateBudgetProjection, type PrivateBudgetProjection } from "../private-budget/ledger.js";
import { sha256, stableJson } from "../../model-fabric/hash.js";
import { thoughtResourcePolicyIdentity } from "../../model-fabric/capability-identity.js";
import { CREDENTIAL_OMITTED_PLACEHOLDER, detectCredentialShape } from "../../privacy/secrets.js";

export type ThoughtDispatchDiagnosticCode =
  | "request_exceeds_tpm_budget"
  | "context_allocation_required_overflow"
  | "context_allocation_optional_degradation"
  | "transport_failover_unavailable_for_projection"
  | "provider_not_sent"
  | "provider_sent"
  | "provider_returned"
  | "parser_malformed"
  | "attention_deadline"
  | "cancelled"
  | "provider_unavailable"
  | "agent_not_ready"
  | "publication_rejected";

export type ThoughtCycleTokenMetrics = {
  first_pass_total_input_tokens: number;
  total_cycle_input_tokens_including_retries: number;
  retry_amplification_ratio: number;
  request_count: number;
};

export type ThoughtProviderFailureCapture = Readonly<{
  /** Provider identity from the resolved Model Fabric attempt. */
  provider?: string;
  /** Configured model identity; provider-reported identity is separate. */
  model?: string;
  providerModel?: string;
  modelFabricInvocationId?: string;
  modelFabricAttemptId?: string;
  attemptOrdinal?: number;
  dispatchSequence?: number;
  attentionRequestId?: number;
  canonicalSchemaFingerprint?: string;
  wireSchemaFingerprint?: string;
  wireBindingId?: string;
  wireFormat?: string;
  wireBodyDigest?: string;
  maxTokens?: number;
  reasoningConfiguration?: string;
  reasoningBudgetTokens?: number;
  temperature?: number;
  topP?: number;
  deadlineAtMs?: number;
  requestStartedAtMs?: number;
  responseAtMs?: number;
  elapsedMs?: number;
  remainingDeadlineMs?: number;
  finishReason?: string;
  inputTokens?: number;
  completionTokens?: number;
  requestWireBytes?: number;
  requestWireAdditionalBytes?: number;
  providerHttpStatus?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  /** Provider-reported Cloudflare neuron usage, when supplied. */
  neuronUsage?: number;
  /** Provider request identifier, when the provider returns one (P3 S5). */
  providerRequestId?: string;
  /** Cloudflare cf-ray response identifier, when returned (P3 S5, new read). */
  cfRay?: string;
  /** Provider-reported total tokens, when supplied (P3 S5). */
  totalTokens?: number;
  /**
   * Where the cached-token count was observed (P3 S5). 'provider_usage'
   * when cachedInputTokens came from provider usage; absent = UNKNOWN.
   */
  cachedSource?: string;
  contentBytes?: number;
  reasoningContentBytes?: number;
  contentHash?: string;
  reasoningHash?: string;
  /** Bounded abort reason observed at the provider boundary; never prose. */
  abortReasonName?: "TimeoutError" | "AbortError" | "none";
  /** True when the attempt ended with no provider HTTP response observed. */
  noHttpResponse?: boolean;
  /** True only when an affinity header was intentionally sent (currently never). */
  sessionAffinityApplied?: boolean;
  /** Non-secret stable affinity policy identity for cross-turn comparison. */
  affinityPolicy?: string;
  dispatchTruth: "not_sent" | "sent" | "unknown";
  parserStatus: "not_run" | "passed" | "failed";
  validatorStatus: "not_run" | "passed" | "failed";
  failureClass?: string;
  structuralRetryStatus: "not_applicable" | "not_scheduled" | "scheduled" | "exhausted";
}>;

export type ThoughtDispatchDiagnostic = {
  cycleId: string;
  generation: number;
  requestId: string;
  pass: number;
  code: ThoughtDispatchDiagnosticCode;
  stage: "allocation" | "attention_admission" | "provider_dispatch" | "parser" | "publication";
  dispatchTruth: "not_sent" | "sent" | "unknown";
  quotaBucket?: string | null;
  estimatedInputTokens?: number | null;
  totalDemandTokens?: number | null;
  semanticProjectionHash?: string | null;
  dispatchMessagesHash?: string | null;
  primaryProvider?: string | null;
  primaryAttemptId?: string | null;
  primaryDispatchTruth?: "sent" | "not_sent" | "unknown" | null;
  suppressedProvider?: string | null;
  fallbackAttemptOrdinal?: number | null;
  fallbackFromAttemptId?: string | null;
  secondaryDispatchTruth?: "not_sent" | null;
  requiredOverflowSection?: string | null;
  semanticBudgetTokens?: number | null;
  overflowTokens?: number | null;
  cycleMetrics?: ThoughtCycleTokenMetrics | null;
  publicationReason?: PublicationRejectionReason | null;
  /** Failure-oriented provider boundary evidence; raw content is prohibited. */
  providerFailure?: ThoughtProviderFailureCapture | null;
  createdAtMs?: number;
  /**
   * P3 S5 provider-diagnostic detail (additive, nullable). Attached by
   * capture sites; Gate B (developmental_observability mode) decides at
   * record time whether it persists. Missing = UNKNOWN, never zero.
   */
  providerDiagnostics?: ThoughtProviderS5Diagnostics | null;
};

/**
 * P3 S5 provider-diagnostic persistence (R7 §19). Every field is nullable:
 * missing numeric provider evidence is UNKNOWN, never coerced to 0.
 */
export type ThoughtProviderS5Diagnostics = Readonly<{
  providerRequestId?: string | null;
  cfRay?: string | null;
  totalTokens?: number | null;
  cachedSource?: string | null;
  cachedTokens?: number | null;
  messagesFingerprint?: string | null;
  paramsFingerprint?: string | null;
  affinityFingerprint?: string | null;
  affinityApplied?: boolean | null;
  estimatorInputTokens?: number | null;
  estimatorOutputTokens?: number | null;
  estimatorTotalTokens?: number | null;
  /** No estimator version exists in source; always UNKNOWN (null). */
  estimatorVersion?: string | null;
  policyId?: string | null;
  policyVersion?: number | null;
  outputTokenLimit?: number | null;
  resourcePolicyFingerprint?: string | null;
  modelId?: string | null;
  attemptOrdinal?: number | null;
  latencyMs?: number | null;
  finishReason?: string | null;
  errorCode?: string | null;
}>;

function finiteS5Number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerS5Number(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function textS5String(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * Builds the S5 detail from a provider-boundary capture plus site evidence.
 * Returns undefined when no capture exists (columns stay NULL = UNKNOWN).
 * Never throws: telemetry construction failure yields undefined, never a
 * cognition block (existing swallow discipline at call sites).
 */
export function buildProviderS5(
  capture: ThoughtProviderFailureCapture | null | undefined,
  extras?: {
    dispatchMessagesHash?: string | null;
    estimate?: { input?: number | null; output?: number | null; total?: number | null } | null;
    policy?: { id?: string | null; version?: number | null } | null;
  },
): ThoughtProviderS5Diagnostics | undefined {
  if (!capture) return undefined;
  try {
    const params = {
      maxTokens: capture.maxTokens ?? null,
      temperature: capture.temperature ?? null,
      topP: capture.topP ?? null,
      reasoningConfiguration: capture.reasoningConfiguration ?? null,
      reasoningBudgetTokens: capture.reasoningBudgetTokens ?? null,
    };
    const hasObservedParams = Object.values(params).some((value) => value !== null);
    const paramsFingerprint = hasObservedParams
      ? `sha256:${sha256(stableJson(params))}`
      : null;
    const estimateInput = extras?.estimate?.input ?? capture.inputTokens ?? null;
    const estimateOutput = extras?.estimate?.output ?? capture.completionTokens ?? null;
    const estimateTotal = extras?.estimate?.total ?? null;
    let resourcePolicyFingerprint: string | null = null;
    try {
      resourcePolicyFingerprint = thoughtResourcePolicyIdentity().fingerprint;
    } catch {
      resourcePolicyFingerprint = null;
    }
    return {
      providerRequestId: textS5String(capture.providerRequestId, 128),
      cfRay: textS5String(capture.cfRay, 64),
      totalTokens: integerS5Number(capture.totalTokens),
      cachedSource: textS5String(capture.cachedSource, 32),
      // Strict guard: 0 = observed zero, missing/non-numeric = UNKNOWN.
      cachedTokens: integerS5Number(capture.cachedInputTokens),
      messagesFingerprint: textS5String(extras?.dispatchMessagesHash, 128),
      paramsFingerprint,
      affinityFingerprint: textS5String(capture.affinityPolicy, 64)
        ? `sha256:${sha256(stableJson({ affinityPolicy: capture.affinityPolicy }))}`
        : null,
      affinityApplied: typeof capture.sessionAffinityApplied === "boolean" ? capture.sessionAffinityApplied : null,
      estimatorInputTokens: finiteS5Number(estimateInput),
      estimatorOutputTokens: finiteS5Number(estimateOutput),
      estimatorTotalTokens: finiteS5Number(estimateTotal),
      estimatorVersion: null,
      policyId: textS5String(extras?.policy?.id, 96),
      policyVersion: integerS5Number(extras?.policy?.version),
      outputTokenLimit: integerS5Number(capture.maxTokens),
      resourcePolicyFingerprint,
      modelId: textS5String(capture.model, 160),
      attemptOrdinal: integerS5Number(capture.attemptOrdinal),
      latencyMs: finiteS5Number(capture.elapsedMs),
      finishReason: textS5String(capture.finishReason, 64),
      errorCode: textS5String(capture.failureClass, 128)
        ?? (capture.abortReasonName === "TimeoutError" || capture.abortReasonName === "AbortError"
          ? capture.abortReasonName
          : null),
    };
  } catch {
    return undefined;
  }
}

/**
 * Attaches S5 detail to a diagnostic under construction (capture-point
 * check ONLY — no dispatch/projection behavior change). Gate B enforcement
 * happens centrally at record time.
 */
export function attachProviderS5(
  diag: ThoughtDispatchDiagnostic,
  input: {
    capture?: ThoughtProviderFailureCapture | null;
    dispatchMessagesHash?: string | null;
    estimate?: { input?: number | null; output?: number | null; total?: number | null } | null;
    policy?: { id?: string | null; version?: number | null } | null;
  } = {},
): ThoughtDispatchDiagnostic {
  return {
    ...diag,
    providerDiagnostics: buildProviderS5(input.capture, {
      dispatchMessagesHash: input.dispatchMessagesHash ?? diag.dispatchMessagesHash ?? null,
      estimate: input.estimate ?? {
        input: diag.estimatedInputTokens ?? null,
        output: null,
        total: diag.totalDemandTokens ?? null,
      },
      policy: input.policy ?? null,
    }),
  };
}

/** P3 Gate B source: developmental_observability collection mode. */
export type ObservabilityCollectionMode = "rich" | "sampled" | "off";

/**
 * Fail-closed mode resolution (frozen): absent/malformed/read-failure ⇒
 * off. Read fresh at each capture point (mode changes need no restart).
 * Raw debug additionally requires Gate A per occurrence — rich NEVER
 * globally enables raw debug.
 */
export function readObservabilityMode(env: NodeJS.ProcessEnv = process.env): ObservabilityCollectionMode {
  try {
    const raw = env.ASHLEY_OBSERVABILITY_MODE;
    if (typeof raw !== "string") return "off";
    const normalized = raw.trim().toLowerCase();
    if (normalized === "rich") return "rich";
    if (normalized === "sampled") return "sampled";
    return "off";
  } catch {
    return "off";
  }
}

/**
 * Success-path diagnostic codes: everything else in the frozen CHECK
 * vocabulary is incident truth. No new failure vocabulary is invented.
 */
const NON_INCIDENT_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "provider_sent",
  "provider_returned",
  "context_allocation_optional_degradation",
]);

/**
 * Middle-mode mechanic (frozen, no percentage): INCIDENT_TRUTH = existing
 * NON-SUCCESS execution truth — failure_class present and/or terminal-
 * failure disposition, evaluated at the capture point. An ordinary
 * successful terminal/completed occurrence is NOT an incident.
 */
export function isIncidentDiagnostic(
  code: ThoughtDispatchDiagnosticCode | string,
  providerFailure?: ThoughtProviderFailureCapture | null,
): boolean {
  if (!NON_INCIDENT_DIAGNOSTIC_CODES.has(code)) return true;
  if (!providerFailure) return false;
  if (providerFailure.failureClass) return true;
  if (providerFailure.noHttpResponse === true) return true;
  if (providerFailure.abortReasonName === "TimeoutError" || providerFailure.abortReasonName === "AbortError") return true;
  if (typeof providerFailure.providerHttpStatus === "number" && providerFailure.providerHttpStatus >= 400) return true;
  return false;
}

/**
 * Gate B over the reducible semantic-diagnostic tier (evidence detail,
 * settlement deltas, per-attempt usage/fingerprints/provider detail, raw
 * debug): rich ⇒ collect; middle (sampled) ⇒ incident-truth occurrences
 * only; off ⇒ collect nothing reducible. Accountability-tier persistence
 * (identities/truth/failure-class via the v1 columns incl. code) is never
 * gated by this mode.
 */
export function resolveReducibleCollection(input: {
  mode: ObservabilityCollectionMode;
  code: ThoughtDispatchDiagnosticCode | string;
  providerFailure?: ThoughtProviderFailureCapture | null;
}): boolean {
  if (input.mode === "rich") return true;
  if (input.mode === "sampled") return isIncidentDiagnostic(input.code, input.providerFailure);
  return false;
}

function emptyTokenBreakdown(): AllocationTokenBreakdown {
  return {
    static_contract_tokens: 0,
    conversation_tokens: 0,
    working_context_tokens: 0,
    identity_kernel_tokens: 0,
    domain_pointer_tokens: 0,
    learned_self_tokens: 0,
    retrieval_tokens: 0,
    observations_tokens: 0,
    in_flight_effect_tokens: 0,
    authority_revision_feedback_tokens: 0,
    omitted_for_budget_tokens: 0,
    omitted_for_budget_count: 0,
    required_overflow_count: 0,
  };
}

function receiptDecisionEnvelope(receipt: AllocationReceipt): Record<string, unknown> {
  return {
    ...receipt.decision,
    __semanticProjectionEnvelope: receipt.semanticProjectionEnvelope,
    __tokenBreakdown: receipt.tokenBreakdown,
    ...(receipt.diagnostics ? { __allocationDiagnostics: receipt.diagnostics } : {}),
  };
}

function parseCycleMetrics(value: unknown): ThoughtCycleTokenMetrics | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ThoughtCycleTokenMetrics>;
    if (
      typeof parsed.first_pass_total_input_tokens !== "number" ||
      typeof parsed.total_cycle_input_tokens_including_retries !== "number" ||
      typeof parsed.retry_amplification_ratio !== "number" ||
      typeof parsed.request_count !== "number"
    ) return null;
    return {
      first_pass_total_input_tokens: parsed.first_pass_total_input_tokens,
      total_cycle_input_tokens_including_retries: parsed.total_cycle_input_tokens_including_retries,
      retry_amplification_ratio: parsed.retry_amplification_ratio,
      request_count: parsed.request_count,
    };
  } catch {
    return null;
  }
}

type RequiredOverflowDiagnosticDetails = {
  requiredOverflowSection: string | null;
  semanticBudgetTokens: number | null;
  overflowTokens: number | null;
};

function requiredOverflowPayload(diag: ThoughtDispatchDiagnostic): Record<string, unknown> | null {
  const hasDetails = diag.requiredOverflowSection !== undefined
    || diag.semanticBudgetTokens !== undefined
    || diag.overflowTokens !== undefined;
  if (!hasDetails) return null;
  return {
    required_overflow_section: diag.requiredOverflowSection ?? null,
    estimated_input_tokens: diag.estimatedInputTokens ?? null,
    semantic_budget_tokens: diag.semanticBudgetTokens ?? null,
    overflow_tokens: diag.overflowTokens ?? null,
  };
}

function parseRequiredOverflowDetails(value: unknown): RequiredOverflowDiagnosticDetails | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const hasDetails = typeof parsed.required_overflow_section === "string"
      || typeof parsed.semantic_budget_tokens === "number"
      || typeof parsed.overflow_tokens === "number";
    if (!hasDetails) return null;
    return {
      requiredOverflowSection: typeof parsed.required_overflow_section === "string"
        ? parsed.required_overflow_section
        : null,
      semanticBudgetTokens: typeof parsed.semantic_budget_tokens === "number"
        ? parsed.semantic_budget_tokens
        : null,
      overflowTokens: typeof parsed.overflow_tokens === "number"
        ? parsed.overflow_tokens
        : null,
    };
  } catch {
    return null;
  }
}

function diagnosticPayload(diag: ThoughtDispatchDiagnostic): string | null {
  const overflowPayload = requiredOverflowPayload(diag);
  if (overflowPayload) return JSON.stringify(overflowPayload);
  return diag.cycleMetrics ? JSON.stringify(diag.cycleMetrics) : null;
}

const PUBLICATION_REJECTION_REASONS = new Set<PublicationRejectionReason>([
  "stale_generation",
  "authority_transition",
  "authority_vector_stale",
  "source_currentness_stale",
  "wake_missing",
  "wake_terminal",
  "wake_reconciliation_required",
  "consequence_exists",
  "future_trigger_snapshot_conflict",
]);

function boundedPublicationReason(
  value: PublicationRejectionReason | null | undefined,
): PublicationRejectionReason | null {
  return value && PUBLICATION_REJECTION_REASONS.has(value) ? value : null;
}

function boundedCaptureString(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined;
}

function finiteCaptureNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerCaptureNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/**
 * Serialize an explicit allowlist only. This keeps accidental raw provider
 * payloads or hidden reasoning out of the diagnostic sidecar.
 */
function providerFailurePayload(
  capture: ThoughtProviderFailureCapture | null | undefined,
): string | null {
  if (!capture) return null;
  const value: Record<string, unknown> = {
    dispatchTruth: capture.dispatchTruth,
    parserStatus: capture.parserStatus,
    validatorStatus: capture.validatorStatus,
    structuralRetryStatus: capture.structuralRetryStatus,
  };
  const strings: Array<[keyof ThoughtProviderFailureCapture, number]> = [
    ["provider", 64],
    ["model", 160],
    ["providerModel", 160],
    ["modelFabricInvocationId", 128],
    ["modelFabricAttemptId", 128],
    ["canonicalSchemaFingerprint", 128],
    ["wireSchemaFingerprint", 128],
    ["wireBindingId", 160],
    ["wireFormat", 96],
    ["wireBodyDigest", 128],
    ["reasoningConfiguration", 128],
    ["finishReason", 64],
    ["contentHash", 128],
    ["reasoningHash", 128],
    ["affinityPolicy", 64],
    ["failureClass", 128],
  ];
  for (const [key, maxLength] of strings) {
    const safe = boundedCaptureString(capture[key], maxLength);
    if (safe !== undefined) value[key] = safe;
  }
  const abortReasonName = capture.abortReasonName;
  if (abortReasonName === "TimeoutError" || abortReasonName === "AbortError" || abortReasonName === "none") {
    value.abortReasonName = abortReasonName;
  }
  const booleans: Array<keyof ThoughtProviderFailureCapture> = [
    "noHttpResponse",
    "sessionAffinityApplied",
  ];
  for (const key of booleans) {
    if (typeof capture[key] === "boolean") value[key] = capture[key];
  }
  const numbers: Array<[keyof ThoughtProviderFailureCapture, "finite" | "integer"]> = [
    ["attemptOrdinal", "integer"],
    ["dispatchSequence", "integer"],
    ["attentionRequestId", "integer"],
    ["maxTokens", "integer"],
    ["reasoningBudgetTokens", "integer"],
    ["temperature", "finite"],
    ["topP", "finite"],
    ["deadlineAtMs", "integer"],
    ["requestStartedAtMs", "integer"],
    ["responseAtMs", "integer"],
    ["elapsedMs", "finite"],
    ["remainingDeadlineMs", "finite"],
    ["inputTokens", "finite"],
    ["completionTokens", "finite"],
    ["requestWireBytes", "finite"],
    ["requestWireAdditionalBytes", "finite"],
    ["providerHttpStatus", "integer"],
    ["reasoningTokens", "integer"],
    ["cachedInputTokens", "integer"],
    ["neuronUsage", "integer"],
    ["contentBytes", "finite"],
    ["reasoningContentBytes", "finite"],
  ];
  for (const [key, kind] of numbers) {
    const number = kind === "integer"
      ? integerCaptureNumber(capture[key])
      : finiteCaptureNumber(capture[key]);
    if (number !== undefined) value[key] = number;
  }
  return JSON.stringify(value);
}

function captureStatus<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T
    : fallback;
}

function parseProviderFailureCapture(value: unknown): ThoughtProviderFailureCapture | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const dispatchTruth = captureStatus(
      parsed.dispatchTruth,
      ["not_sent", "sent", "unknown"] as const,
      "unknown",
    );
    const parserStatus = captureStatus(
      parsed.parserStatus,
      ["not_run", "passed", "failed"] as const,
      "not_run",
    );
    const validatorStatus = captureStatus(
      parsed.validatorStatus,
      ["not_run", "passed", "failed"] as const,
      "not_run",
    );
    const structuralRetryStatus = captureStatus(
      parsed.structuralRetryStatus,
      ["not_applicable", "not_scheduled", "scheduled", "exhausted"] as const,
      "not_applicable",
    );
    const capture: ThoughtProviderFailureCapture = {
      dispatchTruth,
      parserStatus,
      validatorStatus,
      structuralRetryStatus,
    };
    const strings: Array<[keyof ThoughtProviderFailureCapture, number]> = [
      ["provider", 64], ["model", 160], ["providerModel", 160],
      ["modelFabricInvocationId", 128], ["modelFabricAttemptId", 128],
      ["canonicalSchemaFingerprint", 128], ["wireSchemaFingerprint", 128],
      ["wireBindingId", 160], ["wireFormat", 96], ["wireBodyDigest", 128],
      ["reasoningConfiguration", 128], ["finishReason", 64],
      ["contentHash", 128], ["reasoningHash", 128], ["affinityPolicy", 64],
      ["failureClass", 128],
    ];
    for (const [key, maxLength] of strings) {
      const safe = boundedCaptureString(parsed[key], maxLength);
      if (safe !== undefined) (capture as Record<string, unknown>)[key] = safe;
    }
    const abortReasonName = captureStatus(
      parsed.abortReasonName,
      ["TimeoutError", "AbortError", "none"] as const,
      "none",
    );
    if (parsed.abortReasonName !== undefined) {
      (capture as Record<string, unknown>).abortReasonName = abortReasonName;
    }
    for (const key of ["noHttpResponse", "sessionAffinityApplied"] as const) {
      if (typeof parsed[key] === "boolean") (capture as Record<string, unknown>)[key] = parsed[key];
    }
    const numbers: Array<[keyof ThoughtProviderFailureCapture, "finite" | "integer"]> = [
      ["attemptOrdinal", "integer"], ["dispatchSequence", "integer"],
      ["attentionRequestId", "integer"], ["maxTokens", "integer"],
      ["reasoningBudgetTokens", "integer"], ["temperature", "finite"],
      ["topP", "finite"], ["deadlineAtMs", "integer"],
      ["requestStartedAtMs", "integer"], ["responseAtMs", "integer"],
      ["elapsedMs", "finite"], ["remainingDeadlineMs", "finite"],
      ["inputTokens", "finite"], ["completionTokens", "finite"],
      ["requestWireBytes", "finite"], ["requestWireAdditionalBytes", "finite"],
      ["providerHttpStatus", "integer"],
      ["reasoningTokens", "integer"], ["cachedInputTokens", "integer"],
      ["neuronUsage", "integer"],
      ["contentBytes", "finite"], ["reasoningContentBytes", "finite"],
    ];
    for (const [key, kind] of numbers) {
      const number = kind === "integer"
        ? integerCaptureNumber(parsed[key])
        : finiteCaptureNumber(parsed[key]);
      if (number !== undefined) (capture as Record<string, unknown>)[key] = number;
    }
    return capture;
  } catch {
    return null;
  }
}

export function defaultObservabilityDbPath(): string {
  return join(homedir(), ".composer-assistant", "cognitive-v021-observability.db");
}

const OBSERVABILITY_SCHEMA_VERSION = 2;
const REQUIRED_DIAGNOSTIC_COLUMNS = [
  "id", "cycle_id", "generation", "request_id", "pass", "code", "stage",
  "dispatch_truth", "quota_bucket", "estimated_input_tokens", "total_demand_tokens",
  "semantic_projection_hash", "dispatch_messages_hash", "primary_provider",
  "primary_attempt_id", "primary_dispatch_truth", "suppressed_provider",
  "fallback_attempt_ordinal", "fallback_from_attempt_id", "secondary_dispatch_truth",
  "cycle_metrics_json", "provider_failure_json", "publication_reason", "created_at_ms",
] as const;
/**
 * P3 S5 additive columns (v2): all nullable, missing = UNKNOWN, no backfill.
 * Row-preserving discipline: legacy rows keep every v1 value byte-identical.
 */
const S5_DIAGNOSTIC_COLUMN_TYPES: Readonly<Record<string, "TEXT" | "INTEGER">> = {
  provider_request_id: "TEXT",
  cf_ray: "TEXT",
  total_tokens: "INTEGER",
  cached_source: "TEXT",
  cached_tokens: "INTEGER",
  messages_fingerprint: "TEXT",
  params_fingerprint: "TEXT",
  affinity_fingerprint: "TEXT",
  affinity_applied: "INTEGER",
  estimator_input_tokens: "INTEGER",
  estimator_output_tokens: "INTEGER",
  estimator_total_tokens: "INTEGER",
  estimator_version: "TEXT",
  policy_id: "TEXT",
  policy_version: "INTEGER",
  output_token_limit: "INTEGER",
  resource_policy_fingerprint: "TEXT",
  model_id: "TEXT",
  attempt_ordinal: "INTEGER",
  latency_ms: "INTEGER",
  finish_reason: "TEXT",
  error_code: "TEXT",
};
const S5_DIAGNOSTIC_COLUMNS = Object.keys(S5_DIAGNOSTIC_COLUMN_TYPES);
const LEGACY_DIAGNOSTIC_COLUMNS = REQUIRED_DIAGNOSTIC_COLUMNS.filter(
  (column) => column !== "publication_reason",
);

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { present?: number } | undefined;
  return Number(row?.present ?? 0) === 1;
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

function diagnosticColumns(db: DatabaseSync): string[] {
  return (db.prepare("PRAGMA table_info(thought_dispatch_diagnostics)").all() as Array<{ name?: string }>)
    .flatMap((item) => typeof item.name === "string" ? [item.name] : []);
}

function currentDiagnosticSchema(db: DatabaseSync): boolean {
  const columns = new Set(diagnosticColumns(db));
  const sql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'thought_dispatch_diagnostics'",
  ).get() as { sql?: string } | undefined;
  return REQUIRED_DIAGNOSTIC_COLUMNS.every((column) => columns.has(column))
    && S5_DIAGNOSTIC_COLUMNS.every((column) => columns.has(column))
    && tableExists(db, "thought_debug_captures")
    && REQUIRED_DEBUG_CAPTURE_COLUMNS.every((column) => tableColumns(db, "thought_debug_captures").has(column))
    && typeof sql?.sql === "string"
    && sql.sql.includes("publication_rejected")
    && sql.sql.includes("'publication'");
}

const REQUIRED_DEBUG_CAPTURE_COLUMNS = [
  "occurrence_id",
  "enabled_at_ms",
  "expires_at_ms",
  "enabled_by",
  "capture_mode",
  "projected_debug_json",
] as const;

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
    .flatMap((item) => typeof item.name === "string" ? [item.name] : []));
}

function createObservabilityTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS allocation_receipts (
      request_id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      policy_id TEXT NOT NULL,
      policy_version INTEGER NOT NULL,
      quota_bucket TEXT NOT NULL,
      hard_tpm INTEGER NOT NULL,
      max_output_tokens INTEGER NOT NULL,
      estimated_input_tokens INTEGER NOT NULL,
      estimated_output_tokens INTEGER NOT NULL,
      total_demand_tokens INTEGER NOT NULL,
      headroom_tokens INTEGER NOT NULL,
      compression INTEGER NOT NULL,
      required_overflow INTEGER NOT NULL,
      included_wire_bytes INTEGER NOT NULL,
      decision_json TEXT NOT NULL,
      semantic_projection_hash TEXT NOT NULL,
      dispatch_messages_hash TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thought_dispatch_diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      pass INTEGER NOT NULL,
      code TEXT NOT NULL CHECK(code IN (
        'request_exceeds_tpm_budget',
        'context_allocation_required_overflow',
        'context_allocation_optional_degradation',
        'transport_failover_unavailable_for_projection',
        'provider_not_sent',
        'provider_sent',
        'provider_returned',
        'parser_malformed',
        'attention_deadline',
        'cancelled',
        'provider_unavailable',
        'agent_not_ready',
        'publication_rejected'
      )),
      stage TEXT NOT NULL CHECK(stage IN ('allocation', 'attention_admission', 'provider_dispatch', 'parser', 'publication')),
      dispatch_truth TEXT NOT NULL CHECK(dispatch_truth IN ('not_sent', 'sent', 'unknown')),
      quota_bucket TEXT,
      estimated_input_tokens INTEGER,
      total_demand_tokens INTEGER,
      semantic_projection_hash TEXT,
      dispatch_messages_hash TEXT,
      primary_provider TEXT,
      primary_attempt_id TEXT,
      primary_dispatch_truth TEXT CHECK(primary_dispatch_truth IS NULL OR primary_dispatch_truth IN ('sent', 'not_sent', 'unknown')),
      suppressed_provider TEXT,
      fallback_attempt_ordinal INTEGER,
      fallback_from_attempt_id TEXT,
      secondary_dispatch_truth TEXT CHECK(secondary_dispatch_truth IS NULL OR secondary_dispatch_truth IN ('not_sent')),
      cycle_metrics_json TEXT,
      provider_failure_json TEXT,
      publication_reason TEXT CHECK(
        publication_reason IS NULL OR publication_reason IN (
          'stale_generation',
          'authority_transition',
          'authority_vector_stale',
          'source_currentness_stale',
          'wake_missing',
          'wake_terminal',
          'wake_reconciliation_required',
          'consequence_exists',
          'future_trigger_snapshot_conflict'
        )
      ),
      provider_request_id TEXT,
      cf_ray TEXT,
      total_tokens INTEGER,
      cached_source TEXT,
      cached_tokens INTEGER,
      messages_fingerprint TEXT,
      params_fingerprint TEXT,
      affinity_fingerprint TEXT,
      affinity_applied INTEGER,
      estimator_input_tokens INTEGER,
      estimator_output_tokens INTEGER,
      estimator_total_tokens INTEGER,
      estimator_version TEXT,
      policy_id TEXT,
      policy_version INTEGER,
      output_token_limit INTEGER,
      resource_policy_fingerprint TEXT,
      model_id TEXT,
      attempt_ordinal INTEGER,
      latency_ms INTEGER,
      finish_reason TEXT,
      error_code TEXT,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thought_debug_captures (
      occurrence_id TEXT PRIMARY KEY,
      enabled_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      enabled_by TEXT NOT NULL,
      capture_mode TEXT NOT NULL,
      projected_debug_json TEXT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alloc_receipts_cycle
      ON allocation_receipts (cycle_id, generation);

    CREATE INDEX IF NOT EXISTS idx_tdd_cycle
      ON thought_dispatch_diagnostics (cycle_id, generation);

    CREATE INDEX IF NOT EXISTS idx_tdd_code
      ON thought_dispatch_diagnostics (code, stage);

    CREATE INDEX IF NOT EXISTS idx_thought_debug_expires
      ON thought_debug_captures (expires_at_ms);
  `);
}

function migrateDiagnosticTable(db: DatabaseSync): void {
  const columns = new Set(diagnosticColumns(db));
  if (LEGACY_DIAGNOSTIC_COLUMNS.some((column) => !columns.has(column))) {
    throw new Error("observability_schema_incompatible");
  }
  const indexes = (db.prepare(
    `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND tbl_name = 'thought_dispatch_diagnostics'
         AND sql IS NOT NULL`,
  ).all() as Array<{ name?: string; sql?: string }>).flatMap((item) =>
    typeof item.sql === "string" ? [item.sql] : [],
  );
  const triggers = (db.prepare(
    `SELECT sql FROM sqlite_master
       WHERE type = 'trigger' AND tbl_name = 'thought_dispatch_diagnostics'
         AND sql IS NOT NULL`,
  ).all() as Array<{ sql?: string }>).flatMap((item) =>
    typeof item.sql === "string" ? [item.sql] : [],
  );
  const preservedColumns = LEGACY_DIAGNOSTIC_COLUMNS.join(", ");
  const oldRows = db.prepare(
    `SELECT ${preservedColumns} FROM thought_dispatch_diagnostics ORDER BY id ASC`,
  ).all();

  db.exec(`
    CREATE TABLE thought_dispatch_diagnostics_v1 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      pass INTEGER NOT NULL,
      code TEXT NOT NULL CHECK(code IN (
        'request_exceeds_tpm_budget',
        'context_allocation_required_overflow',
        'context_allocation_optional_degradation',
        'transport_failover_unavailable_for_projection',
        'provider_not_sent',
        'provider_sent',
        'provider_returned',
        'parser_malformed',
        'attention_deadline',
        'cancelled',
        'provider_unavailable',
        'agent_not_ready',
        'publication_rejected'
      )),
      stage TEXT NOT NULL CHECK(stage IN ('allocation', 'attention_admission', 'provider_dispatch', 'parser', 'publication')),
      dispatch_truth TEXT NOT NULL CHECK(dispatch_truth IN ('not_sent', 'sent', 'unknown')),
      quota_bucket TEXT,
      estimated_input_tokens INTEGER,
      total_demand_tokens INTEGER,
      semantic_projection_hash TEXT,
      dispatch_messages_hash TEXT,
      primary_provider TEXT,
      primary_attempt_id TEXT,
      primary_dispatch_truth TEXT CHECK(primary_dispatch_truth IS NULL OR primary_dispatch_truth IN ('sent', 'not_sent', 'unknown')),
      suppressed_provider TEXT,
      fallback_attempt_ordinal INTEGER,
      fallback_from_attempt_id TEXT,
      secondary_dispatch_truth TEXT CHECK(secondary_dispatch_truth IS NULL OR secondary_dispatch_truth IN ('not_sent')),
      cycle_metrics_json TEXT,
      provider_failure_json TEXT,
      publication_reason TEXT CHECK(
        publication_reason IS NULL OR publication_reason IN (
          'stale_generation',
          'authority_transition',
          'authority_vector_stale',
          'source_currentness_stale',
          'wake_missing',
          'wake_terminal',
          'wake_reconciliation_required',
          'consequence_exists',
          'future_trigger_snapshot_conflict'
        )
      ),
      created_at_ms INTEGER NOT NULL
    );
    INSERT INTO thought_dispatch_diagnostics_v1 (
      id, cycle_id, generation, request_id, pass, code, stage,
      dispatch_truth, quota_bucket, estimated_input_tokens, total_demand_tokens,
      semantic_projection_hash, dispatch_messages_hash, primary_provider,
      primary_attempt_id, primary_dispatch_truth, suppressed_provider,
      fallback_attempt_ordinal, fallback_from_attempt_id, secondary_dispatch_truth,
      cycle_metrics_json, provider_failure_json, publication_reason, created_at_ms
    )
    SELECT id, cycle_id, generation, request_id, pass, code, stage,
      dispatch_truth, quota_bucket, estimated_input_tokens, total_demand_tokens,
      semantic_projection_hash, dispatch_messages_hash, primary_provider,
      primary_attempt_id, primary_dispatch_truth, suppressed_provider,
      fallback_attempt_ordinal, fallback_from_attempt_id, secondary_dispatch_truth,
      cycle_metrics_json, provider_failure_json, NULL, created_at_ms
    FROM thought_dispatch_diagnostics;
    DROP TABLE thought_dispatch_diagnostics;
    ALTER TABLE thought_dispatch_diagnostics_v1 RENAME TO thought_dispatch_diagnostics;
  `);
  for (const sql of indexes) db.exec(sql);
  for (const sql of triggers) db.exec(sql);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tdd_cycle
      ON thought_dispatch_diagnostics (cycle_id, generation);
    CREATE INDEX IF NOT EXISTS idx_tdd_code
      ON thought_dispatch_diagnostics (code, stage);
  `);
  const newRows = db.prepare(
    `SELECT ${preservedColumns} FROM thought_dispatch_diagnostics ORDER BY id ASC`,
  ).all();
  if (JSON.stringify(oldRows) !== JSON.stringify(newRows)) {
    throw new Error("observability_row_preservation_failed");
  }
  db.exec("UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM thought_dispatch_diagnostics) WHERE name = 'thought_dispatch_diagnostics'");
}

/**
 * P3 v1→v2 migration (ONE version bump carries BOTH payloads): additive
 * nullable S5 columns (missing = UNKNOWN, no backfill) AND the new
 * thought_debug_captures table + expiry index. Row-preserving discipline
 * reuses the oldRows/newRows preservation assert on the v1 column set.
 */
function migrateObservabilityV1ToV2(db: DatabaseSync): void {
  const columns = new Set(diagnosticColumns(db));
  if (REQUIRED_DIAGNOSTIC_COLUMNS.some((column) => !columns.has(column))) {
    throw new Error("observability_schema_incompatible");
  }
  const oldRows = db.prepare(
    `SELECT ${REQUIRED_DIAGNOSTIC_COLUMNS.join(", ")} FROM thought_dispatch_diagnostics ORDER BY id ASC`,
  ).all();
  const oldCount = (db.prepare("SELECT COUNT(*) AS count FROM thought_dispatch_diagnostics").get() as { count?: number }).count;
  for (const column of S5_DIAGNOSTIC_COLUMNS) {
    if (!columns.has(column)) {
      db.exec(`ALTER TABLE thought_dispatch_diagnostics ADD COLUMN ${column} ${S5_DIAGNOSTIC_COLUMN_TYPES[column] ?? "TEXT"}`);
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS thought_debug_captures (
      occurrence_id TEXT PRIMARY KEY,
      enabled_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      enabled_by TEXT NOT NULL,
      capture_mode TEXT NOT NULL,
      projected_debug_json TEXT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thought_debug_expires
      ON thought_debug_captures (expires_at_ms);
  `);
  const newRows = db.prepare(
    `SELECT ${REQUIRED_DIAGNOSTIC_COLUMNS.join(", ")} FROM thought_dispatch_diagnostics ORDER BY id ASC`,
  ).all();
  if (JSON.stringify(oldRows) !== JSON.stringify(newRows)) {
    throw new Error("observability_row_preservation_failed");
  }
  const newCount = (db.prepare("SELECT COUNT(*) AS count FROM thought_dispatch_diagnostics").get() as { count?: number }).count;
  if (newCount !== oldCount) throw new Error("observability_row_preservation_failed");
}

export function initObservabilitySchema(db: DatabaseSync): void {
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = userVersion(db);
    if (version > OBSERVABILITY_SCHEMA_VERSION) throw new Error("observability_schema_unsupported");
    if (version === OBSERVABILITY_SCHEMA_VERSION) {
      if (!tableExists(db, "thought_dispatch_diagnostics") || !currentDiagnosticSchema(db)) {
        throw new Error("observability_schema_incompatible");
      }
    } else if (tableExists(db, "thought_dispatch_diagnostics")) {
      // Stepwise: legacy (no publication_reason) → v1 shape, then v1 → v2.
      const columns = new Set(diagnosticColumns(db));
      if (LEGACY_DIAGNOSTIC_COLUMNS.some((column) => !columns.has(column))) {
        throw new Error("observability_schema_incompatible");
      }
      if (!columns.has("publication_reason")) migrateDiagnosticTable(db);
      migrateObservabilityV1ToV2(db);
    } else {
      createObservabilityTables(db);
    }
    db.exec(`PRAGMA user_version = ${OBSERVABILITY_SCHEMA_VERSION}`);
    if (!currentDiagnosticSchema(db)) throw new Error("observability_schema_incompatible");
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the schema failure */ }
    throw error;
  }
}

export class ObservabilityStore {
  readonly db: DatabaseSync;
  private readonly dbPath: string;

  constructor(dbOrPath?: string | DatabaseSync) {
    if (typeof dbOrPath === "object" && dbOrPath !== null) {
      this.db = dbOrPath;
      this.dbPath = ":memory:";
    } else {
      this.dbPath = dbOrPath ?? defaultObservabilityDbPath();
      if (this.dbPath !== ":memory:") {
        const parent = dirname(this.dbPath);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
    }
    initObservabilitySchema(this.db);
  }

  recordReceipt(receipt: AllocationReceipt, nowMs = Date.now()): void {
    const stmt = this.db.prepare(`
      INSERT INTO allocation_receipts (
        request_id, cycle_id, generation, policy_id, policy_version,
        quota_bucket, hard_tpm, max_output_tokens, estimated_input_tokens,
        estimated_output_tokens, total_demand_tokens, headroom_tokens,
        compression, required_overflow, included_wire_bytes, decision_json,
        semantic_projection_hash, dispatch_messages_hash, created_at_ms
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(request_id) DO UPDATE SET
        estimated_input_tokens = excluded.estimated_input_tokens,
        total_demand_tokens = excluded.total_demand_tokens,
        headroom_tokens = excluded.headroom_tokens,
        decision_json = excluded.decision_json,
        dispatch_messages_hash = excluded.dispatch_messages_hash
    `);

    stmt.run(
      receipt.requestId,
      receipt.cycleId,
      receipt.generation,
      receipt.policyId,
      receipt.policyVersion,
      receipt.quotaBucket,
      receipt.hardTpm,
      receipt.maxOutputTokens,
      receipt.estimatedInputTokens,
      receipt.estimatedOutputTokens,
      receipt.totalDemandTokens,
      receipt.headroomTokens,
      receipt.compression ? 1 : 0,
      receipt.requiredOverflow ? 1 : 0,
      receipt.decision.includedWireBytes,
      JSON.stringify(receiptDecisionEnvelope(receipt)),
      receipt.semanticProjectionHash,
      receipt.dispatchMessagesHash,
      nowMs,
    );
  }

  recordDiagnostic(diag: ThoughtDispatchDiagnostic, nowMs = Date.now()): void {
    // Gate B is enforced centrally here (single choke point): the
    // reducible S5 tier persists only when the collection mode allows it.
    // Accountability-tier columns persist untouched in every mode.
    const mode = readObservabilityMode();
    const s5 = resolveReducibleCollection({ mode, code: diag.code, providerFailure: diag.providerFailure })
      ? diag.providerDiagnostics ?? buildProviderS5(diag.providerFailure, {
          dispatchMessagesHash: diag.dispatchMessagesHash,
          estimate: {
            input: diag.providerFailure?.inputTokens ?? diag.estimatedInputTokens ?? null,
            output: diag.providerFailure?.completionTokens ?? null,
            total: diag.providerFailure?.totalTokens ?? null,
          },
        }) ?? null
      : null;
    const stmt = this.db.prepare(`
      INSERT INTO thought_dispatch_diagnostics (
        cycle_id, generation, request_id, pass, code, stage,
        dispatch_truth, quota_bucket, estimated_input_tokens,
        total_demand_tokens, semantic_projection_hash, dispatch_messages_hash,
        primary_provider, primary_attempt_id, primary_dispatch_truth,
        suppressed_provider, fallback_attempt_ordinal, fallback_from_attempt_id,
        secondary_dispatch_truth, cycle_metrics_json, provider_failure_json,
        publication_reason,
        provider_request_id, cf_ray, total_tokens, cached_source, cached_tokens,
        messages_fingerprint, params_fingerprint, affinity_fingerprint, affinity_applied,
        estimator_input_tokens, estimator_output_tokens, estimator_total_tokens,
        estimator_version, policy_id, policy_version, output_token_limit,
        resource_policy_fingerprint, model_id, attempt_ordinal, latency_ms,
        finish_reason, error_code,
        created_at_ms
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
    `);

    stmt.run(
      diag.cycleId,
      diag.generation,
      diag.requestId,
      diag.pass,
      diag.code,
      diag.stage,
      diag.dispatchTruth,
      diag.quotaBucket ?? null,
      diag.estimatedInputTokens ?? null,
      diag.totalDemandTokens ?? null,
      diag.semanticProjectionHash ?? null,
      diag.dispatchMessagesHash ?? null,
      diag.primaryProvider ?? null,
      diag.primaryAttemptId ?? null,
      diag.primaryDispatchTruth ?? null,
      diag.suppressedProvider ?? null,
      diag.fallbackAttemptOrdinal ?? null,
      diag.fallbackFromAttemptId ?? null,
      diag.secondaryDispatchTruth ?? null,
      diagnosticPayload(diag),
      providerFailurePayload(diag.providerFailure),
      boundedPublicationReason(diag.publicationReason),
      s5?.providerRequestId ?? null,
      s5?.cfRay ?? null,
      s5?.totalTokens ?? null,
      s5?.cachedSource ?? null,
      s5?.cachedTokens ?? null,
      s5?.messagesFingerprint ?? null,
      s5?.paramsFingerprint ?? null,
      s5?.affinityFingerprint ?? null,
      s5?.affinityApplied === true ? 1 : s5?.affinityApplied === false ? 0 : null,
      s5?.estimatorInputTokens ?? null,
      s5?.estimatorOutputTokens ?? null,
      s5?.estimatorTotalTokens ?? null,
      s5?.estimatorVersion ?? null,
      s5?.policyId ?? null,
      s5?.policyVersion ?? null,
      s5?.outputTokenLimit ?? null,
      s5?.resourcePolicyFingerprint ?? null,
      s5?.modelId ?? null,
      s5?.attemptOrdinal ?? null,
      s5?.latencyMs ?? null,
      s5?.finishReason ?? null,
      s5?.errorCode ?? null,
      diag.createdAtMs ?? nowMs,
    );
  }

  /** Record one cycle aggregate without adding a second telemetry store. */
  recordCycleMetrics(input: {
    cycleId: string;
    generation: number;
    requestId: string;
    pass: number;
    metrics: ThoughtCycleTokenMetrics;
    dispatchTruth?: "not_sent" | "sent" | "unknown";
    nowMs?: number;
  }): void {
    if (input.metrics.request_count < 1) return;
    const existing = this.db.prepare(
      `SELECT id FROM thought_dispatch_diagnostics
        WHERE cycle_id = ? AND generation = ?
          AND stage <> 'publication'
        ORDER BY id DESC LIMIT 1`,
    ).get(input.cycleId, input.generation) as { id?: number } | undefined;
    if (existing?.id !== undefined) {
      this.db.prepare(
        `UPDATE thought_dispatch_diagnostics
            SET cycle_metrics_json = ?,
                estimated_input_tokens = ?,
                total_demand_tokens = ?
          WHERE id = ?`,
      ).run(
        JSON.stringify(input.metrics),
        input.metrics.first_pass_total_input_tokens,
        input.metrics.total_cycle_input_tokens_including_retries,
        existing.id,
      );
      return;
    }
    this.recordDiagnostic({
      cycleId: input.cycleId,
      generation: input.generation,
      requestId: input.requestId,
      pass: input.pass,
      code: "provider_returned",
      stage: "provider_dispatch",
      dispatchTruth: input.dispatchTruth ?? "sent",
      estimatedInputTokens: input.metrics.first_pass_total_input_tokens,
      totalDemandTokens: input.metrics.total_cycle_input_tokens_including_retries,
      cycleMetrics: input.metrics,
      createdAtMs: input.nowMs,
    }, input.nowMs);
  }

  listReceipts(limit = 100): AllocationReceipt[] {
    const rows = this.db.prepare(`
      SELECT * FROM allocation_receipts
      ORDER BY created_at_ms DESC
      LIMIT ?
    `).all(limit) as Array<{
      request_id: string;
      cycle_id: string;
      generation: number;
      policy_id: string;
      policy_version: number;
      quota_bucket: string;
      hard_tpm: number;
      max_output_tokens: number;
      estimated_input_tokens: number;
      estimated_output_tokens: number;
      total_demand_tokens: number;
      headroom_tokens: number;
      compression: number;
      required_overflow: number;
      included_wire_bytes: number;
      decision_json: string;
      semantic_projection_hash: string;
      dispatch_messages_hash: string;
    }>;

    return rows.map((r) => {
      const storedDecision = JSON.parse(r.decision_json) as Record<string, unknown>;
      const semanticProjectionEnvelope = storedDecision.__semanticProjectionEnvelope;
      const tokenBreakdown = storedDecision.__tokenBreakdown;
      const diagnostics = storedDecision.__allocationDiagnostics;
      delete storedDecision.__semanticProjectionEnvelope;
      delete storedDecision.__tokenBreakdown;
      delete storedDecision.__allocationDiagnostics;
      return {
        requestId: r.request_id,
        cycleId: r.cycle_id,
        generation: r.generation,
        policyId: r.policy_id,
        policyVersion: r.policy_version,
        semanticProjectionEnvelope:
          semanticProjectionEnvelope && typeof semanticProjectionEnvelope === "object"
            ? semanticProjectionEnvelope as SemanticProjectionEnvelope
            : DEFAULT_SEMANTIC_PROJECTION_ENVELOPE,
        tokenBreakdown:
          tokenBreakdown && typeof tokenBreakdown === "object"
            ? tokenBreakdown as AllocationTokenBreakdown
            : emptyTokenBreakdown(),
        ...(diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics)
          ? { diagnostics: diagnostics as AllocationDiagnostics }
          : {}),
        quotaBucket: r.quota_bucket,
        hardTpm: r.hard_tpm,
        maxOutputTokens: r.max_output_tokens,
        estimatedInputTokens: r.estimated_input_tokens,
        estimatedOutputTokens: r.estimated_output_tokens,
        totalDemandTokens: r.total_demand_tokens,
        headroomTokens: r.headroom_tokens,
        compression: Boolean(r.compression),
        requiredOverflow: Boolean(r.required_overflow),
        decision: storedDecision as AllocationReceipt["decision"],
        semanticProjectionHash: r.semantic_projection_hash,
        dispatchMessagesHash: r.dispatch_messages_hash,
      };
    });
  }

  listDiagnostics(
    limit = 100,
    filter?: { cycleId?: string; generation?: number },
  ): ThoughtDispatchDiagnostic[] {
    const scoped = filter?.cycleId !== undefined && filter.generation !== undefined;
    const params: SQLInputValue[] = scoped
      ? [filter!.cycleId!, filter!.generation!, limit]
      : [limit];
    const rows = this.db.prepare(`
      SELECT * FROM thought_dispatch_diagnostics
      ${scoped ? "WHERE cycle_id = ? AND generation = ?" : ""}
      ORDER BY created_at_ms DESC
      LIMIT ?
    `).all(...params) as Array<{
      cycle_id: string;
      generation: number;
      request_id: string;
      pass: number;
      code: ThoughtDispatchDiagnosticCode;
      stage: "allocation" | "attention_admission" | "provider_dispatch" | "parser" | "publication";
      dispatch_truth: "not_sent" | "sent" | "unknown";
      quota_bucket: string | null;
      estimated_input_tokens: number | null;
      total_demand_tokens: number | null;
      semantic_projection_hash: string | null;
      dispatch_messages_hash: string | null;
      primary_provider: string | null;
      primary_attempt_id: string | null;
      primary_dispatch_truth: "sent" | "not_sent" | "unknown" | null;
      suppressed_provider: string | null;
      fallback_attempt_ordinal: number | null;
      fallback_from_attempt_id: string | null;
      secondary_dispatch_truth: "not_sent" | null;
      cycle_metrics_json: string | null;
      provider_failure_json: string | null;
      publication_reason: PublicationRejectionReason | null;
      provider_request_id: string | null;
      cf_ray: string | null;
      total_tokens: number | null;
      cached_source: string | null;
      cached_tokens: number | null;
      messages_fingerprint: string | null;
      params_fingerprint: string | null;
      affinity_fingerprint: string | null;
      affinity_applied: number | null;
      estimator_input_tokens: number | null;
      estimator_output_tokens: number | null;
      estimator_total_tokens: number | null;
      estimator_version: string | null;
      policy_id: string | null;
      policy_version: number | null;
      output_token_limit: number | null;
      resource_policy_fingerprint: string | null;
      model_id: string | null;
      attempt_ordinal: number | null;
      latency_ms: number | null;
      finish_reason: string | null;
      error_code: string | null;
      created_at_ms: number;
    }>;

    return rows.map((r) => {
      const overflowDetails = parseRequiredOverflowDetails(r.cycle_metrics_json);
      const hasS5 = S5_DIAGNOSTIC_COLUMNS.some((column) => (r as Record<string, unknown>)[column] !== null && (r as Record<string, unknown>)[column] !== undefined);
      return {
        cycleId: r.cycle_id,
        generation: r.generation,
        requestId: r.request_id,
        pass: r.pass,
        code: r.code,
        stage: r.stage,
        dispatchTruth: r.dispatch_truth,
        quotaBucket: r.quota_bucket,
        estimatedInputTokens: r.estimated_input_tokens,
        totalDemandTokens: r.total_demand_tokens,
        semanticProjectionHash: r.semantic_projection_hash,
        dispatchMessagesHash: r.dispatch_messages_hash,
        primaryProvider: r.primary_provider,
        primaryAttemptId: r.primary_attempt_id,
        primaryDispatchTruth: r.primary_dispatch_truth,
        suppressedProvider: r.suppressed_provider,
        fallbackAttemptOrdinal: r.fallback_attempt_ordinal,
        fallbackFromAttemptId: r.fallback_from_attempt_id,
        secondaryDispatchTruth: r.secondary_dispatch_truth,
        ...(overflowDetails ?? {}),
        cycleMetrics: parseCycleMetrics(r.cycle_metrics_json),
        providerFailure: parseProviderFailureCapture(r.provider_failure_json),
        publicationReason: boundedPublicationReason(r.publication_reason),
        providerDiagnostics: hasS5 ? {
          providerRequestId: r.provider_request_id ?? null,
          cfRay: r.cf_ray ?? null,
          totalTokens: r.total_tokens ?? null,
          cachedSource: r.cached_source ?? null,
          cachedTokens: r.cached_tokens ?? null,
          messagesFingerprint: r.messages_fingerprint ?? null,
          paramsFingerprint: r.params_fingerprint ?? null,
          affinityFingerprint: r.affinity_fingerprint ?? null,
          affinityApplied: r.affinity_applied === 1 ? true : r.affinity_applied === 0 ? false : null,
          estimatorInputTokens: r.estimator_input_tokens ?? null,
          estimatorOutputTokens: r.estimator_output_tokens ?? null,
          estimatorTotalTokens: r.estimator_total_tokens ?? null,
          estimatorVersion: r.estimator_version ?? null,
          policyId: r.policy_id ?? null,
          policyVersion: r.policy_version ?? null,
          outputTokenLimit: r.output_token_limit ?? null,
          resourcePolicyFingerprint: r.resource_policy_fingerprint ?? null,
          modelId: r.model_id ?? null,
          attemptOrdinal: r.attempt_ordinal ?? null,
          latencyMs: r.latency_ms ?? null,
          finishReason: r.finish_reason ?? null,
          errorCode: r.error_code ?? null,
        } : null,
        createdAtMs: r.created_at_ms,
      };
    });
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore close error
    }
  }

  /**
   * P3 Gate A: explicit per-occurrence raw-debug enablement.
   * Enablement = row present AND nowMs < expires_at_ms.
   * TTL clamped at write to <= 28 days (RAW_DEBUG_RETENTION_MAX_MS).
   * Raw projected content only; secret-redacted via detectCredentialShape.
   */
  enableThoughtDebugCapture(input: {
    occurrenceId: string;
    ttlMs?: number;
    enabledBy: string;
    captureMode: string;
    nowMs?: number;
  }): void {
    const nowMs = input.nowMs ?? Date.now();
    const requestedTtlMs = typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs)
      ? Math.floor(input.ttlMs)
      : RAW_DEBUG_RETENTION_MAX_MS;
    const ttlMs = Math.max(0, Math.min(requestedTtlMs, RAW_DEBUG_RETENTION_MAX_MS));
    this.db.prepare(`
      INSERT INTO thought_debug_captures
        (occurrence_id, enabled_at_ms, expires_at_ms, enabled_by, capture_mode, projected_debug_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(occurrence_id) DO UPDATE SET
        enabled_at_ms = excluded.enabled_at_ms,
        expires_at_ms = excluded.expires_at_ms,
        enabled_by = excluded.enabled_by,
        capture_mode = excluded.capture_mode,
        projected_debug_json = NULL
    `).run(
      input.occurrenceId,
      nowMs,
      nowMs + ttlMs,
      input.enabledBy,
      input.captureMode,
      null,
    );
  }

  /**
   * Reads a debug capture for a specific occurrence.
   * Returns null if row is absent or expired (guard denies at/after expires_at_ms).
   */
  getThoughtDebugCapture(occurrenceId: string, nowMs = Date.now()): {
    occurrenceId: string;
    enabledAtMs: number;
    expiresAtMs: number;
    enabledBy: string;
    captureMode: string;
    projectedDebugJson: string | null;
  } | null {
    const row = this.db.prepare(`
      SELECT occurrence_id, enabled_at_ms, expires_at_ms, enabled_by, capture_mode, projected_debug_json
      FROM thought_debug_captures WHERE occurrence_id = ?
    `).get(occurrenceId) as {
      occurrence_id: string;
      enabled_at_ms: number;
      expires_at_ms: number;
      enabled_by: string;
      capture_mode: string;
      projected_debug_json: string | null;
    } | undefined;

    if (!row) return null;
    if (nowMs >= row.expires_at_ms) return null; // Guard denies immediately.
    return {
      occurrenceId: row.occurrence_id,
      enabledAtMs: row.enabled_at_ms,
      expiresAtMs: row.expires_at_ms,
      enabledBy: row.enabled_by,
      captureMode: row.capture_mode,
      projectedDebugJson: row.projected_debug_json,
    };
  }

  /**
   * P3 hard-expiry purge (conservative early delete): deletes ALL rows with
   * expires_at_ms <= nowMs + MAX_SWEEP_INTERVAL_MS (60_000).
   * No row-count LIMIT — a fixed LIMIT cannot prove a hard retention maximum
   * without a matching enablement cardinality bound, and R7 fixes none.
   * While healthy/running, the steady-state purge removes ALL rows satisfying
   * the predicate on every opportunity (post-tick AND in-flight deadline via
   * the injected callback).
   * Called on: startup (before first read), capture path (before write),
   * and EVERY P0 steady-state reconciliation opportunity (post-tick AND
   * in-flight deadline). The same helper implementation is used throughout.
   */
  purgeThoughtDebugCaptures(nowMs: number): number {
    const deleted = this.db.prepare(`
      DELETE FROM thought_debug_captures
      WHERE expires_at_ms <= ?
    `).run(nowMs + 60_000);
    return Number(deleted.changes ?? 0);
  }

}

/**
 * P3 Owner Amendment A1: raw-debug retention maximum changed from 7d to 28d.
 * Applied as pure constant substitution — no mechanism depends on the day count.
 */
export const RAW_DEBUG_RETENTION_MAX_MS = 2_419_200_000 as const; // 28 days
export const RAW_DEBUG_RETENTION_MAX_DAYS = 28 as const;

export function openObservabilityStore(dbOrPath?: string | DatabaseSync): ObservabilityStore {
  return new ObservabilityStore(dbOrPath);
}

/** P3 Gate A read: returns null if absent or expired (guard denies immediately). */
export function getThoughtDebugCapture(db: DatabaseSync, occurrenceId: string, nowMs = Date.now()): {
  occurrenceId: string;
  enabledAtMs: number;
  expiresAtMs: number;
  enabledBy: string;
  captureMode: string;
  projectedDebugJson: string | null;
} | null {
  const store = new ObservabilityStore(db);
  return store.getThoughtDebugCapture(occurrenceId, nowMs);
}

/** P3 hard-expiry purge: single helper called by all sweep paths. */
export function purgeThoughtDebugCaptures(db: DatabaseSync, nowMs = Date.now()): number {
  const store = new ObservabilityStore(db);
  return store.purgeThoughtDebugCaptures(nowMs);
}

/**
 * P3 Gate A/B capture seam. The call is post-projection and stores only the
 * bounded projected representation. Missing enablement, an expired row, or a
 * mode that does not permit reducible collection produces no write.
 */
export function captureThoughtDebug(
  db: DatabaseSync,
  input: {
    occurrenceId: string;
    projectedDebugJson: string;
    code: ThoughtDispatchDiagnosticCode | string;
    providerFailure?: ThoughtProviderFailureCapture | null;
    nowMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): boolean {
  try {
    const nowMs = input.nowMs ?? Date.now();
    const store = new ObservabilityStore(db);
    store.purgeThoughtDebugCaptures(nowMs);
    const mode = readObservabilityMode(input.env);
    if (!resolveReducibleCollection({ mode, code: input.code, providerFailure: input.providerFailure })) return false;
    if (typeof input.projectedDebugJson !== "string" || input.projectedDebugJson.length === 0) return false;
    const enabled = store.getThoughtDebugCapture(input.occurrenceId, nowMs);
    if (!enabled) return false;
    const projectedDebugJson = detectCredentialShape(input.projectedDebugJson).hit
      ? CREDENTIAL_OMITTED_PLACEHOLDER
      : input.projectedDebugJson;
    const updated = db.prepare(`
      UPDATE thought_debug_captures
         SET projected_debug_json = ?
       WHERE occurrence_id = ? AND expires_at_ms > ?
    `).run(projectedDebugJson, input.occurrenceId, nowMs);
    return Number(updated.changes ?? 0) === 1;
  } catch {
    // Debug capture is diagnostic-only and must never affect cognition.
    return false;
  }
}

export function recordAllocationReceipt(db: DatabaseSync, receipt: AllocationReceipt, nowMs = Date.now()): void {
  const store = new ObservabilityStore(db);
  store.recordReceipt(receipt, nowMs);
}

export function recordDiagnostic(db: DatabaseSync, diag: ThoughtDispatchDiagnostic, nowMs = Date.now()): void {
  const store = new ObservabilityStore(db);
  store.recordDiagnostic(diag, nowMs);
}

export function recordThoughtCycleMetrics(
  db: DatabaseSync,
  input: {
    cycleId: string;
    generation: number;
    requestId: string;
    pass: number;
    metrics: ThoughtCycleTokenMetrics;
    dispatchTruth?: "not_sent" | "sent" | "unknown";
    nowMs?: number;
  },
): void {
  const store = new ObservabilityStore(db);
  store.recordCycleMetrics(input);
}

/** Authoritative W7 budget diagnostic. This is a read-only sidecar projection. */
export function getPrivateBudgetDiagnostics(
  sidecar: DatabaseSync,
  input: { conversationId: string; policyId: string; wallClockNowMs?: number },
): PrivateBudgetProjection {
  return getPrivateBudgetProjection(sidecar, input);
}
