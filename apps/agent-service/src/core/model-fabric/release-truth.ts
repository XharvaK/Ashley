import type { ThoughtCapabilityIdentity } from "./capability-identity.js";
import { sha256Text, stableJson } from "./hash.js";

export type ReleaseTruthMismatchCode =
  | "release_id_missing" | "release_id_malformed" | "qualification_missing" | "qualification_invalidated"
  | "build_identity_mismatch" | "semantic_contract_mismatch" | "kernel_envelope_mismatch" | "parser_validator_mismatch"
  | "occupant_mismatch" | "wire_binding_mismatch" | "schema_enforcement_evidence_mismatch" | "resource_policy_mismatch"
  | "adapter_compatibility_mismatch";

export type ReleaseTruthComparison = Readonly<{ matched: boolean; mismatchCodes: readonly ReleaseTruthMismatchCode[] }>;

export type ReleaseTruthResult = Readonly<{
  schema: "ashley.release_truth.v1";
  releaseTruthId: string;
  observedAt: string;
  releaseIdClaim: string | null;
  processIdentity: { pid: number; startedAt: string; executableBuildIdentity: string };
  runtimeCapabilityFingerprint: string;
  qualificationResultId: string | null;
  qualifiedCapabilityFingerprint: string | null;
  matched: boolean;
  mismatchCodes: readonly ReleaseTruthMismatchCode[];
  contentHash: `sha256:${string}`;
}>;

export function compareReleaseTruth(input: {
  releaseIdClaim: string | null | undefined;
  runtimeCapability: ThoughtCapabilityIdentity;
  qualifiedCapability: ThoughtCapabilityIdentity | null;
  qualificationPresent: boolean;
  qualificationInvalidated: boolean;
}): ReleaseTruthComparison {
  const mismatchCodes: ReleaseTruthMismatchCode[] = [];
  const addMismatch = (code: ReleaseTruthMismatchCode): void => {
    if (!mismatchCodes.includes(code)) mismatchCodes.push(code);
  };
  if (!input.releaseIdClaim?.trim()) addMismatch("release_id_missing");
  else if (!/^[A-Za-z0-9._:-]+$/.test(input.releaseIdClaim)) addMismatch("release_id_malformed");
  else if (input.releaseIdClaim !== input.runtimeCapability.components.executableBuildIdentity) addMismatch("build_identity_mismatch");
  if (!input.qualificationPresent || !input.qualifiedCapability) addMismatch("qualification_missing");
  if (input.qualificationInvalidated) addMismatch("qualification_invalidated");
  const expected = input.qualifiedCapability?.components;
  if (expected) {
    const checks: Array<[keyof typeof expected, ReleaseTruthMismatchCode]> = [
      ["executableBuildIdentity", "build_identity_mismatch"], ["semanticContractFingerprint", "semantic_contract_mismatch"],
      ["kernelEnvelopeContractVersion", "kernel_envelope_mismatch"], ["parserValidatorFingerprint", "parser_validator_mismatch"],
      ["provider", "occupant_mismatch"], ["configuredModelId", "occupant_mismatch"],
      ["occupantId", "occupant_mismatch"], ["logicalBindingId", "wire_binding_mismatch"],
      ["wireBindingId", "wire_binding_mismatch"],
      ["schemaEnforcementMode", "schema_enforcement_evidence_mismatch"], ["resourcePolicyFingerprint", "resource_policy_mismatch"],
      ["adapterCompatibilityFingerprint", "adapter_compatibility_mismatch"],
    ];
    for (const [key, code] of checks) {
      if (input.runtimeCapability.components[key] !== expected[key]) addMismatch(code);
    }
  }
  return Object.freeze({ matched: mismatchCodes.length === 0, mismatchCodes: Object.freeze(mismatchCodes) });
}

export function releaseTruthForRuntime(input: {
  releaseTruthId: string;
  observedAt: string;
  releaseIdClaim: string | null | undefined;
  processIdentity: { pid: number; startedAt: string; executableBuildIdentity: string };
  runtimeCapability: ThoughtCapabilityIdentity;
  qualificationResultId: string | null;
  qualifiedCapability: ThoughtCapabilityIdentity | null;
  qualificationPresent: boolean;
  qualificationInvalidated: boolean;
}): ReleaseTruthResult {
  const comparison = compareReleaseTruth({
    releaseIdClaim: input.releaseIdClaim,
    runtimeCapability: input.runtimeCapability,
    qualifiedCapability: input.qualifiedCapability,
    qualificationPresent: input.qualificationPresent,
    qualificationInvalidated: input.qualificationInvalidated,
  });
  const mismatchCodes = [...comparison.mismatchCodes];
  if (
    input.processIdentity.executableBuildIdentity !==
    input.runtimeCapability.components.executableBuildIdentity
    && !mismatchCodes.includes("build_identity_mismatch")
  ) {
    mismatchCodes.push("build_identity_mismatch");
  }
  const unsigned = {
    schema: "ashley.release_truth.v1" as const,
    releaseTruthId: input.releaseTruthId,
    observedAt: input.observedAt,
    releaseIdClaim: input.releaseIdClaim?.trim() || null,
    processIdentity: { ...input.processIdentity },
    runtimeCapabilityFingerprint: input.runtimeCapability.fingerprint,
    qualificationResultId: input.qualificationResultId,
    qualifiedCapabilityFingerprint: input.qualifiedCapability?.fingerprint ?? null,
    matched: mismatchCodes.length === 0,
    mismatchCodes,
  };
  return Object.freeze({
    ...unsigned,
    contentHash: `sha256:${sha256Text(stableJson(unsigned))}`,
  });
}
