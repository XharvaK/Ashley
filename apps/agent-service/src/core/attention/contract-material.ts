import { createHash } from "node:crypto";

export const LEGACY_CONTRACT_ID = "ashley-capability-v1";
export const LEGACY_CONTRACT_VERSION = "1";

export const LEGACY_V2_CONTRACT_ID = "ashley-capability-v2";
export const LEGACY_V2_CONTRACT_VERSION = "2";

export const DECLARED_CONTRACT_ID = "ashley-capability-v3";
export const DECLARED_CONTRACT_VERSION = "3";

export const V2_CAPABILITY_NAMES = [
  "recall",
  "mind_state",
  "affect",
  "thought",
  "learning",
  "refusal",
  "relational_initiative",
  "relationship_state",
  "reading",
  "curiosity_consolidation",
  "source_discovery",
  "own_time_report",
] as const;

export const V3_ONLY_CAPABILITY_NAMES = [
  "vision",
  "attachment_text",
  "conversational_read",
  "web_search",
] as const;

export const CONTRACT_CAPABILITY_NAMES = [
  ...V2_CAPABILITY_NAMES,
  ...V3_ONLY_CAPABILITY_NAMES,
] as const;

export const V2_MODEL_SENSITIVE_SET = [
  "thought",
  "learning",
  "reading",
  "curiosity_consolidation",
  "source_discovery",
  "own_time_report",
  "affect",
  "relational_initiative",
] as const;

export const V3_MODEL_SENSITIVE_SET = [
  ...V2_MODEL_SENSITIVE_SET,
  "vision",
  "conversational_read",
  "web_search",
] as const;

export function legacyContractMaterial(): unknown {
  return {
    version: LEGACY_CONTRACT_VERSION,
    capabilities: V2_CAPABILITY_NAMES.filter((c) => c !== "relationship_state"),
    dependencies: v2Dependencies(),
    modelSensitive: [...V2_MODEL_SENSITIVE_SET],
    qualification: qualificationBlock(),
    rollback: rollbackBlock(),
    criticalDisable: criticalDisableBlock(),
  };
}

function v2Dependencies(): Record<string, string[]> {
  return {
    recall: [],
    mind_state: ["recall"],
    affect: ["recall"],
    thought: ["recall", "mind_state"],
    learning: ["recall"],
    refusal: ["thought"],
    relational_initiative: ["mind_state", "thought"],
    relationship_state: ["mind_state", "thought"],
    reading: [],
    curiosity_consolidation: ["reading"],
    source_discovery: ["reading"],
    own_time_report: ["thought", "curiosity_consolidation"],
  };
}

function v3Dependencies(): Record<string, string[]> {
  return {
    ...v2Dependencies(),
    vision: ["thought"],
    attachment_text: ["thought"],
    conversational_read: ["reading", "thought"],
    web_search: ["thought"],
  };
}

function qualificationBlock() {
  return {
    isolatedSeeds: 3,
    liveShadowEvents: 25,
    liveShadowMinDays: 7,
  };
}

function rollbackBlock() {
  return { behavioralBreachesInSevenDays: 2 };
}

function criticalDisableBlock() {
  return [
    "security",
    "corruption",
    "deletion_integrity",
    "provenance",
  ];
}

export function legacyContractHash(): string {
  const json = JSON.stringify(legacyContractMaterial());
  return createHash("sha256").update(json).digest("hex");
}

/** v2 contract material — frozen for migration lineage. */
export function v2ContractMaterial(): unknown {
  return {
    version: LEGACY_V2_CONTRACT_VERSION,
    capabilities: [...V2_CAPABILITY_NAMES],
    dependencies: v2Dependencies(),
    modelSensitive: [...V2_MODEL_SENSITIVE_SET],
    qualification: qualificationBlock(),
    rollback: rollbackBlock(),
    criticalDisable: criticalDisableBlock(),
  };
}

export function v2ContractHash(): string {
  const json = JSON.stringify(v2ContractMaterial());
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Canonical rollout behavior contract material. Stable serialization is tested.
 */
export function canonicalContractMaterial(): unknown {
  return {
    version: DECLARED_CONTRACT_VERSION,
    capabilities: [...CONTRACT_CAPABILITY_NAMES],
    dependencies: v3Dependencies(),
    modelSensitive: [...V3_MODEL_SENSITIVE_SET],
    qualification: qualificationBlock(),
    rollback: rollbackBlock(),
    criticalDisable: criticalDisableBlock(),
  };
}

export function declaredContractHash(): string {
  const json = JSON.stringify(canonicalContractMaterial());
  return createHash("sha256").update(json).digest("hex");
}

/** @deprecated use v2ContractHash for v2 lineage checks */
export const MODEL_SENSITIVE_SET_FOR_CONTRACT = V3_MODEL_SENSITIVE_SET;
