import { readFileSync } from "node:fs";
import { freezeDeep } from "./hash.js";
import { modelFabricConfigFilePath } from "./catalog.js";
import type { ObservedReasoning, ReasoningPolicy, TranslatedWireControl } from "./types.js";
import type { TrustedReasoningControl } from "../model-routing/types.js";

const SCHEMA = "ashley.model_fabric.reasoning_maps.v2";
const SEMANTIC_POLICIES = [
  "disabled",
  "economical",
  "standard",
  "high",
  "max_supported",
] as const satisfies readonly ReasoningPolicy[];

const REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;

export type ReasoningTranslationCode =
  | "unsupported_reasoning_mapping"
  | "lightning_standard_policy_unresolved"
  | "unknown_nemotron_family"
  | "unknown_reasoning_semantic"
  | "invalid_reasoning_maps";

export type ReasoningTranslationResult =
  | { status: "translated"; control: TranslatedWireControl; familyId: string }
  | { status: "unmapped_family" }
  | { status: "unsupported"; code: ReasoningTranslationCode };

type FamilyMatch = {
  provider: string;
  configuredModelId: string;
};

type FamilyPolicyEntry =
  | { kind: "reasoning_effort"; value: "none" | "low" | "medium" | "high" }
  | { kind: "chat_template_thinking"; enableThinking: boolean }
  | { kind: "unsupported"; code: ReasoningTranslationCode };

export type ReasoningFamilyMap = Readonly<{
  familyId: string;
  match: Readonly<FamilyMatch>;
  staleAliases: Readonly<Record<string, ReasoningPolicy>>;
  policies: Readonly<Record<ReasoningPolicy, FamilyPolicyEntry>>;
}>;

export type ReasoningMaps = Readonly<{
  schema: typeof SCHEMA;
  families: readonly ReasoningFamilyMap[];
}>;

let cachedMaps: ReasoningMaps | null = null;

function isReasoningPolicy(value: string): value is ReasoningPolicy {
  return (SEMANTIC_POLICIES as readonly string[]).includes(value);
}

function isEffort(value: unknown): value is "none" | "low" | "medium" | "high" {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isTranslationCode(value: unknown): value is ReasoningTranslationCode {
  return (
    value === "unsupported_reasoning_mapping" ||
    value === "lightning_standard_policy_unresolved" ||
    value === "unknown_nemotron_family" ||
    value === "unknown_reasoning_semantic" ||
    value === "invalid_reasoning_maps"
  );
}

function parsePolicyEntry(
  familyId: string,
  policy: ReasoningPolicy,
  raw: unknown,
): FamilyPolicyEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error(`invalid_reasoning_maps:${familyId}:${policy}`);
  }
  const entry = raw as Record<string, unknown>;
  if (entry.kind === "reasoning_effort") {
    if (!isEffort(entry.value)) {
      throw new Error(`invalid_reasoning_maps:${familyId}:${policy}:effort`);
    }
    return { kind: "reasoning_effort", value: entry.value };
  }
  if (entry.kind === "chat_template_thinking") {
    if (typeof entry.enableThinking !== "boolean") {
      throw new Error(`invalid_reasoning_maps:${familyId}:${policy}:thinking`);
    }
    return { kind: "chat_template_thinking", enableThinking: entry.enableThinking };
  }
  if (entry.kind === "unsupported") {
    if (!isTranslationCode(entry.code)) {
      throw new Error(`invalid_reasoning_maps:${familyId}:${policy}:code`);
    }
    return { kind: "unsupported", code: entry.code };
  }
  throw new Error(`invalid_reasoning_maps:${familyId}:${policy}:kind`);
}

function parseFamily(raw: unknown): ReasoningFamilyMap {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid_reasoning_maps:family");
  }
  const family = raw as Record<string, unknown>;
  if (typeof family.familyId !== "string") {
    throw new Error("invalid_reasoning_maps:familyId");
  }
  const match = family.match;
  if (
    !match ||
    typeof match !== "object" ||
    typeof (match as FamilyMatch).provider !== "string" ||
    typeof (match as FamilyMatch).configuredModelId !== "string"
  ) {
    throw new Error(`invalid_reasoning_maps:${family.familyId}:match`);
  }
  const staleRaw =
    family.staleAliases && typeof family.staleAliases === "object"
      ? (family.staleAliases as Record<string, unknown>)
      : {};
  const staleAliases: Record<string, ReasoningPolicy> = {};
  for (const [alias, mapped] of Object.entries(staleRaw)) {
    if (typeof mapped !== "string" || !isReasoningPolicy(mapped)) {
      throw new Error(`invalid_reasoning_maps:${family.familyId}:stale_alias`);
    }
    staleAliases[alias] = mapped;
  }
  const policiesRaw = family.policies;
  if (!policiesRaw || typeof policiesRaw !== "object") {
    throw new Error(`invalid_reasoning_maps:${family.familyId}:policies`);
  }
  const policies = {} as Record<ReasoningPolicy, FamilyPolicyEntry>;
  for (const policy of SEMANTIC_POLICIES) {
    policies[policy] = parsePolicyEntry(
      family.familyId,
      policy,
      (policiesRaw as Record<string, unknown>)[policy],
    );
  }
  return freezeDeep({
    familyId: family.familyId,
    match: {
      provider: (match as FamilyMatch).provider,
      configuredModelId: (match as FamilyMatch).configuredModelId,
    },
    staleAliases,
    policies,
  });
}

export function parseReasoningMaps(raw: unknown): ReasoningMaps {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid_reasoning_maps");
  }
  const document = raw as Record<string, unknown>;
  if (document.schema !== SCHEMA) {
    throw new Error("invalid_reasoning_maps:schema");
  }
  if (!Array.isArray(document.families) || document.families.length === 0) {
    throw new Error("invalid_reasoning_maps:families");
  }
  return freezeDeep({
    schema: SCHEMA,
    families: document.families.map(parseFamily),
  });
}

export function loadReasoningMaps(): ReasoningMaps {
  if (cachedMaps) return cachedMaps;
  const path = modelFabricConfigFilePath("translation/reasoning-maps.json");
  cachedMaps = parseReasoningMaps(JSON.parse(readFileSync(path, "utf-8")));
  return cachedMaps;
}

export function resetReasoningMapsCache(): void {
  cachedMaps = null;
}

export function findReasoningFamily(
  provider: string,
  configuredModelId: string,
  maps: ReasoningMaps = loadReasoningMaps(),
): ReasoningFamilyMap | null {
  return (
    maps.families.find(
      (family) =>
        family.match.provider === provider &&
        family.match.configuredModelId === configuredModelId,
    ) ?? null
  );
}

function isNemotronModel(configuredModelId: string): boolean {
  return configuredModelId.startsWith("nvidia/nemotron");
}

export function parseSemanticReasoningPolicy(
  value: string | null | undefined,
): ReasoningPolicy | null {
  if (typeof value !== "string") return null;
  return isReasoningPolicy(value) ? value : null;
}

export function resolveOccupantSemanticPolicy(input: {
  provider: string;
  configuredModelId: string;
  reasoningPolicy?: string | null;
  effectiveReasoning?: string | null;
  maps?: ReasoningMaps;
}): { ok: true; policy: ReasoningPolicy } | { ok: false; code: ReasoningTranslationCode } {
  const fromPolicy = parseSemanticReasoningPolicy(input.reasoningPolicy);
  if (fromPolicy) return { ok: true, policy: fromPolicy };
  const fromEffective = parseSemanticReasoningPolicy(input.effectiveReasoning);
  if (fromEffective) return { ok: true, policy: fromEffective };
  const family = findReasoningFamily(
    input.provider,
    input.configuredModelId,
    input.maps ?? loadReasoningMaps(),
  );
  const alias = input.effectiveReasoning?.trim();
  if (alias && family?.staleAliases[alias]) {
    return { ok: true, policy: family.staleAliases[alias]! };
  }
  return { ok: false, code: "unknown_reasoning_semantic" };
}

export function translateReasoningPolicy(input: {
  provider: string;
  configuredModelId: string;
  semanticPolicy: ReasoningPolicy;
  maps?: ReasoningMaps;
}): ReasoningTranslationResult {
  const maps = input.maps ?? loadReasoningMaps();
  const family = findReasoningFamily(input.provider, input.configuredModelId, maps);
  if (!family) {
    if (input.provider === "nim" && isNemotronModel(input.configuredModelId)) {
      return { status: "unsupported", code: "unknown_nemotron_family" };
    }
    return { status: "unmapped_family" };
  }
  const entry = family.policies[input.semanticPolicy];
  if (entry.kind === "unsupported") {
    return { status: "unsupported", code: entry.code };
  }
  if (entry.kind === "reasoning_effort") {
    return {
      status: "translated",
      familyId: family.familyId,
      control: { kind: "reasoning_effort", value: entry.value },
    };
  }
  return {
    status: "translated",
    familyId: family.familyId,
    control: {
      kind: "chat_template_thinking",
      enableThinking: entry.enableThinking,
    },
  };
}

export function formatTranslatedWireControl(
  control: TranslatedWireControl | TrustedReasoningControl | null | undefined,
): string | null {
  if (!control) return null;
  if (control.kind === "reasoning_effort") {
    return `reasoning_effort=${control.value}`;
  }
  return `chat_template_kwargs.enable_thinking=${control.enableThinking ? "true" : "false"}`;
}

export function toTrustedReasoningControl(
  control: TranslatedWireControl,
): TrustedReasoningControl {
  if (control.kind === "reasoning_effort") {
    return { kind: "reasoning_effort", value: control.value };
  }
  return { kind: "chat_template_thinking", enableThinking: control.enableThinking };
}

export function observedReasoningFromUsage(usage?: {
  reasoningTokens?: number;
}): ObservedReasoning {
  if (!usage) return { status: "unknown" };
  if (typeof usage.reasoningTokens === "number" && Number.isFinite(usage.reasoningTokens)) {
    return { status: "tokens", reasoningTokens: usage.reasoningTokens };
  }
  return { status: "unknown" };
}

export function inspectFabricNimRequest(input: {
  provider: string;
  configuredModelId: string;
  reasoningPolicy?: string | null;
  effectiveReasoning?: string | null;
  maxTokens?: number;
  temperature?: number;
  maps?: ReasoningMaps;
}): {
  semanticPolicy: ReasoningPolicy | null;
  translation: ReasoningTranslationResult;
  requestBody: Record<string, unknown> | null;
} {
  const resolved = resolveOccupantSemanticPolicy(input);
  if (!resolved.ok) {
    return {
      semanticPolicy: null,
      translation: { status: "unsupported", code: resolved.code },
      requestBody: null,
    };
  }
  const translation = translateReasoningPolicy({
    provider: input.provider,
    configuredModelId: input.configuredModelId,
    semanticPolicy: resolved.policy,
    maps: input.maps,
  });
  if (translation.status !== "translated") {
    return { semanticPolicy: resolved.policy, translation, requestBody: null };
  }
  const requestBody: Record<string, unknown> = {
    model: input.configuredModelId,
    max_tokens: input.maxTokens ?? 2048,
    temperature: input.temperature ?? 0.7,
  };
  applyTranslatedControlToNimBody(requestBody, input.configuredModelId, translation.control);
  return { semanticPolicy: resolved.policy, translation, requestBody };
}

const ULTRA_ID = "nvidia/nemotron-3-ultra-550b-a55b";
const SUPER_ID = "nvidia/nemotron-3-super-120b-a12b";
const LIGHTNING_ID = "nvidia/nemotron-3.5-lightning-30b-a3b";

export function applyTranslatedControlToNimBody(
  body: Record<string, unknown>,
  configuredModelId: string,
  control: TranslatedWireControl | TrustedReasoningControl,
): void {
  if (control.kind === "chat_template_thinking") {
    if (configuredModelId !== LIGHTNING_ID) {
      throw new Error("nemotron_kwargs_model_mismatch");
    }
    body.chat_template_kwargs = { enable_thinking: control.enableThinking };
    return;
  }
  if (configuredModelId === ULTRA_ID && control.value === "low") {
    throw new Error("ultra_rejects_reasoning_effort_low");
  }
  if (configuredModelId === SUPER_ID && control.value === "medium") {
    throw new Error("super_rejects_reasoning_effort_medium");
  }
  if (configuredModelId === LIGHTNING_ID) {
    throw new Error("lightning_rejects_reasoning_effort");
  }
  body.reasoning_effort = control.value;
  if (configuredModelId === SUPER_ID && control.value === "high") {
    body.reasoning_budget = 1024;
  }
}
