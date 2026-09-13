import { randomUUID } from "node:crypto";
import { sha256, stableJson } from "./hash.js";
import type {
  ContextPolicyId,
  InferencePolicyFingerprint,
  LogicalModelRole,
  ModelCapabilityProfile,
  ModelCapabilityProfileDefinition,
  ModelFallbackClass,
  ModelProfileFingerprint,
  ModelProfileId,
  ModelProfileVersion,
  ModelPurposeId,
  ModelRouteId,
  ProviderId,
  ResolvedModelRoute,
  RouteAdmissionBasis,
  SpecialistRequirement,
  ReasoningPolicy,
  StructuredOutputSchemaFingerprint,
} from "./types.js";

const PROFILE_VERSION = 1 as ModelProfileVersion;

const MODEL_OUTPUT_CEILINGS: Readonly<Record<string, number>> = {
  "nim:openai/gpt-oss-20b": 4096,
  "groq:openai/gpt-oss-20b": 4096,
  "mistral:mistral-small-2603": 4096,
  "nim:nvidia/nemotron-3-super-120b-a12b": 8192,
  "cloudflare:@cf/nvidia/nemotron-3-120b-a12b": 8192,
  "cloudflare:@cf/deepseek-ai/deepseek-v4-flash-0731": 16384,
};

const MODEL_CONTEXT_LIMITS: Readonly<Record<string, number>> = {
  "cloudflare:@cf/deepseek-ai/deepseek-v4-flash-0731": 32768,
};

const MISTRAL_SMALL = "mistral-small-2603";

function maxOutputTokensFor(provider: string, configuredModelId: string): number {
  return MODEL_OUTPUT_CEILINGS[`${provider}:${configuredModelId}`] ?? 2048;
}

function contextTokensFor(provider: string, configuredModelId: string): number {
  return MODEL_CONTEXT_LIMITS[`${provider}:${configuredModelId}`] ?? 0;
}

function profileIdFor(provider: string, model: string): ModelProfileId {
  const safeModel = model.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${provider}.${safeModel}` as ModelProfileId;
}

function mechanicalDefinition(
  provider: string,
  configuredModelId: string,
): ModelCapabilityProfileDefinition {
  const structured =
    provider === "mistral"
      ? configuredModelId === "mistral-small-2603"
        ? "json_schema"
        : "none"
      : ((provider === "nim" && configuredModelId === "nvidia/nemotron-3-super-120b-a12b") ||
        (provider === "cloudflare" && (
          configuredModelId === "@cf/nvidia/nemotron-3-120b-a12b" ||
          configuredModelId === "@cf/deepseek-ai/deepseek-v4-flash-0731"
        )))
        ? "json_schema"
        : "json";
  return {
    profileId: profileIdFor(provider, configuredModelId),
    profileVersion: PROFILE_VERSION,
    provider: provider as ProviderId,
    configuredModelId,
    input: {
      text: true,
      image: "inline_bytes",
      document: "none",
      audio: "none",
    },
    output: {
      text: true,
      structured,
      toolCalls: true,
      streaming: false,
    },
    reasoning: {
      mode: "configurable",
      efforts:
        provider === "mistral" && configuredModelId === MISTRAL_SMALL
          ? ["none", "high"]
          : ["low", "medium", "high"],
    },
    cancellation: "abort_signal",
    limits: {
      // These are the current adapter's bounded request defaults, not a
      // provider entitlement or qualification claim.
      contextTokens: contextTokensFor(provider, configuredModelId),
      maxOutputTokens: maxOutputTokensFor(provider, configuredModelId),
      maxMediaBytes: null,
      maxMediaParts: null,
    },
    providerOptionsPolicy: {
      allowedKeys: [
        "maxTokens",
        "temperature",
        "presencePenalty",
        "reasoningEffort",
        "responseFormat",
        "tools",
        "toolChoice",
      ],
    },
  };
}

/**
 * Returns only mechanical facts for the exact current adapter binding.
 * Qualification and promotion are intentionally absent.
 */
export function capabilityProfileFor(
  provider: string,
  configuredModelId: string,
): ModelCapabilityProfile {
  const definition = mechanicalDefinition(provider, configuredModelId);
  const profile = {
    ...definition,
    profileFingerprint: `sha256:${sha256(definition)}` as ModelProfileFingerprint,
  } satisfies ModelCapabilityProfile;
  return Object.freeze({
    ...profile,
    input: Object.freeze({ ...profile.input }),
    output: Object.freeze({ ...profile.output }),
    reasoning: Object.freeze({
      ...profile.reasoning,
      ...(profile.reasoning.mode === "configurable"
        ? { efforts: Object.freeze([...profile.reasoning.efforts]) }
        : {}),
    }),
    limits: Object.freeze({ ...profile.limits }),
    providerOptionsPolicy: Object.freeze({
      allowedKeys: Object.freeze([...profile.providerOptionsPolicy.allowedKeys]),
    }),
  });
}

export function normalizeReasoningPolicy(
  value: string | null | undefined,
): ReasoningPolicy {
  switch (value) {
    case "none":
      return "disabled";
    case "low":
      return "economical";
    case "medium":
      return "standard";
    case "high":
      return "high";
    case "max_supported":
      return "max_supported";
    default:
      return "standard";
  }
}

export function wireReasoningFor(
  provider: string,
  model: string,
  requested: string | null | undefined,
): string | null {
  if (!requested) return null;
  if ((provider === "groq" || provider === "nim") && model.startsWith("openai/gpt-oss")) {
    return requested === "none" ? "low" : requested;
  }
  return requested;
}

export type InferencePolicyInput = {
  provider: string;
  configuredModelId: string;
  reasoningEffort?: string | null;
  translatedWireControl?: string | null;
  temperature?: number | null;
  topP?: number | null;
  maxTokens?: number | null;
  presencePenalty?: number | null;
  responseFormat?: string | null;
  structuredOutputContractId?: string | null;
  structuredOutputMode?: string | null;
  structuredOutputBindingId?: string | null;
  structuredOutputSchemaFingerprint?: StructuredOutputSchemaFingerprint | null;
  toolCount?: number;
  toolNames?: readonly string[];
};

/** Fingerprints material provider options, never prompt or output content. */
export function createInferencePolicyFingerprint(
  input: InferencePolicyInput,
): InferencePolicyFingerprint {
  const material = {
    provider: input.provider,
    configuredModelId: input.configuredModelId,
    reasoningEffort: input.reasoningEffort ?? null,
    temperature: input.temperature ?? null,
    topP: input.topP ?? null,
    maxTokens: input.maxTokens ?? null,
    presencePenalty: input.presencePenalty ?? null,
    responseFormat: input.responseFormat ?? null,
    ...(input.structuredOutputContractId !== undefined
      ? { structuredOutputContractId: input.structuredOutputContractId }
      : {}),
    ...(input.structuredOutputMode !== undefined
      ? { structuredOutputMode: input.structuredOutputMode }
      : {}),
    ...(input.structuredOutputBindingId !== undefined
      ? { structuredOutputBindingId: input.structuredOutputBindingId }
      : {}),
    ...(input.structuredOutputSchemaFingerprint !== undefined
      ? { structuredOutputSchemaFingerprint: input.structuredOutputSchemaFingerprint }
      : {}),
    toolCount: input.toolCount ?? 0,
    toolNames: input.toolNames ? [...input.toolNames].sort() : [],
    ...(input.translatedWireControl
      ? { translatedWireControl: input.translatedWireControl }
      : {}),
  };
  return `sha256:${sha256(material)}` as InferencePolicyFingerprint;
}

export function createCompatibilityBindingId(input: {
  logicalRole: LogicalModelRole;
  requestedPurpose: ModelPurposeId;
  configuredRouteId: string;
  dispatchedRouteId: string;
  provider: string;
  configuredModelId: string;
  fallbackTopology: string;
  inferencePolicyFingerprint: InferencePolicyFingerprint;
}): string {
  return `existing-compatibility:${sha256(input)}`;
}

export function backendFor(provider: string): string {
  switch (provider) {
    case "mistral":
      return "mistral_direct";
    case "groq":
      return "groq";
    case "nim":
      return "nim";
    case "cloudflare":
      return "cloudflare";
    default:
      return provider;
  }
}

export function resolvedRouteFor(input: {
  logicalRole: LogicalModelRole;
  requestedPurpose: ModelPurposeId;
  specialistRequirement: SpecialistRequirement | null;
  policyRowId: string;
  occupancyKey: string;
  occupantId: string;
  portfolioRevisionId: string;
  configuredRouteId: string;
  dispatchedRouteId: string;
  routeOverride: string | null;
  modelOverride: string | null;
  provider: string;
  configuredModelId: string;
  contextPolicyId: string;
  reasoningPolicy: ReasoningPolicy;
  effectiveReasoning: string | null;
  inferencePolicyFingerprint: InferencePolicyFingerprint;
  fallbackClass: ModelFallbackClass;
  admissionBasis: RouteAdmissionBasis;
  registryVersion: string;
}): ResolvedModelRoute {
  const profile = capabilityProfileFor(input.provider, input.configuredModelId);
  // MF-M1 preserves caller-owned fallback topology. It does not introduce a
  // route-policy fallback registry, so current route IDs remain empty here.
  const fallbackRouteIds: ModelRouteId[] = [];
  const route = {
    logicalRole: input.logicalRole,
    requestedPurpose: input.requestedPurpose,
    specialistRequirement: input.specialistRequirement,
    policyRowId: input.policyRowId,
    occupancyKey: input.occupancyKey,
    occupantId: input.occupantId,
    portfolioRevisionId: input.portfolioRevisionId,
    configuredRouteId: input.configuredRouteId as ResolvedModelRoute["configuredRouteId"],
    dispatchedRouteId: input.dispatchedRouteId as ResolvedModelRoute["dispatchedRouteId"],
    routeOverride: input.routeOverride,
    modelOverride: input.modelOverride,
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    profileFingerprint: profile.profileFingerprint,
    provider: profile.provider,
    configuredModelId: input.configuredModelId,
    reasoningPolicy: input.reasoningPolicy,
    effectiveReasoning: input.effectiveReasoning,
    inferencePolicyFingerprint: input.inferencePolicyFingerprint,
    contextPolicyId: input.contextPolicyId as ContextPolicyId,
    quotaClass: `${input.provider}:${input.configuredModelId}`,
    latencyClass: input.requestedPurpose === "expression" || input.requestedPurpose === "thought"
      ? "interactive"
      : "background",
    reliabilityClass: input.fallbackClass === "none" ? "single_attempt" : "explicit_fallback",
    privacyPolicyId: input.contextPolicyId,
    fallbackRouteIds,
    admissionBasis: input.admissionBasis,
    registryVersion: input.registryVersion,
  } satisfies ResolvedModelRoute;
  return Object.freeze({
    ...route,
    fallbackRouteIds: Object.freeze([...route.fallbackRouteIds]),
  });
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function profileDefinitionJson(
  profile: ModelCapabilityProfile,
): string {
  return stableJson({
    ...profile,
    profileFingerprint: undefined,
  });
}
