import { freezeDeep, sha256, sha256Text } from "./hash.js";
import { THOUGHT_KERNEL_ENVELOPE_VERSION } from "../cognitive-v021/thought/kernel-envelope.js";
import { THOUGHT_SEMANTIC_PARSER_ID } from "../cognitive-v021/thought/parse.js";
import { THOUGHT_OUTPUT_SCHEMA_FINGERPRINT } from "../cognitive-v021/thought/output-contract.js";

export type ThoughtCapabilityComponents = Readonly<{
  executableBuildIdentity: string;
  semanticContractFingerprint: string;
  kernelEnvelopeContractVersion: string;
  parserValidatorFingerprint: string;
  provider: string;
  configuredModelId: string;
  occupantId: string;
  logicalBindingId: string;
  wireBindingId: string;
  schemaEnforcementMode: "native_json_schema" | "guided_json" | "json_object_compatibility";
  resourcePolicyFingerprint: string;
  adapterCompatibilityFingerprint: string;
}>;

export type ThoughtCapabilityIdentity = Readonly<{
  schema: "ashley.thought.capability_identity.v1";
  components: ThoughtCapabilityComponents;
  fingerprint: `sha256:${string}`;
}>;

const THOUGHT_RESOURCE_POLICY_COMPONENTS = Object.freeze({
  ordinaryThoughtBudgetMs: 180_000 as const,
  interactiveMaxOutput: 16_384 as const,
  durableProactiveMaxOutput: 16_384 as const,
  structuralRetryMaxOutput: 16_384 as const,
  structuralRetriesMaxPerSemanticPass: 2 as const,
});

type ThoughtResourcePolicyComponents = typeof THOUGHT_RESOURCE_POLICY_COMPONENTS;

export type ThoughtResourcePolicyIdentity = Readonly<
  ThoughtResourcePolicyComponents & {
    fingerprint: `sha256:${string}`;
  }
>;

export type ThoughtCapabilityEvidence = Readonly<{
  capability: ThoughtCapabilityIdentity;
  logicalEvidence: Readonly<{
    contractId: string;
    schemaFingerprint: string;
    bindingId: string;
  }>;
  wireEvidence: Readonly<{
    adapterId: string;
    wireFormat: string;
    sanitizedBodyDigest: string;
    emittedEnforcementMode: string;
    providerDeclaredEnforcement: string | "unavailable";
    bindingId?: string | null;
  }>;
  resourceEvidence: Readonly<{
    deadlineMs: number;
    maxOutputTokens: number;
    attempts: number;
  }>;
}>;

function required(value: string, code: string): string {
  if (!value.trim()) throw new Error(code);
  return value;
}

function fingerprint(value: string, code: string): string {
  required(value, code);
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error("capability_component_invalid");
  return value;
}

export function buildThoughtCapabilityIdentity(input: ThoughtCapabilityComponents): ThoughtCapabilityIdentity {
  const components = {
    executableBuildIdentity: required(input.executableBuildIdentity, "capability_component_missing"),
    semanticContractFingerprint: fingerprint(input.semanticContractFingerprint, "capability_component_missing"),
    kernelEnvelopeContractVersion: required(input.kernelEnvelopeContractVersion, "capability_component_missing"),
    parserValidatorFingerprint: fingerprint(input.parserValidatorFingerprint, "capability_component_missing"),
    provider: required(input.provider, "capability_component_missing"),
    configuredModelId: required(input.configuredModelId, "capability_component_missing"),
    occupantId: required(input.occupantId, "capability_component_missing"),
    logicalBindingId: required(input.logicalBindingId, "capability_component_missing"),
    wireBindingId: required(input.wireBindingId, "capability_component_missing"),
    schemaEnforcementMode: input.schemaEnforcementMode,
    resourcePolicyFingerprint: fingerprint(input.resourcePolicyFingerprint, "capability_component_missing"),
    adapterCompatibilityFingerprint: fingerprint(input.adapterCompatibilityFingerprint, "capability_component_missing"),
  } satisfies ThoughtCapabilityComponents;
  return freezeDeep({
    schema: "ashley.thought.capability_identity.v1" as const,
    components,
    fingerprint: `sha256:${sha256(components)}` as `sha256:${string}`,
  });
}

export function thoughtResourcePolicyIdentity(): ThoughtResourcePolicyIdentity {
  const components = THOUGHT_RESOURCE_POLICY_COMPONENTS;
  return freezeDeep({
    ...components,
    fingerprint: `sha256:${sha256(components)}` as `sha256:${string}`,
  });
}

export function assertThoughtCapabilityEvidence(input: ThoughtCapabilityEvidence): void {
  const canonicalCapability = buildThoughtCapabilityIdentity(input.capability.components);
  if (
    input.capability.schema !== "ashley.thought.capability_identity.v1" ||
    canonicalCapability.fingerprint !== input.capability.fingerprint
  ) {
    throw new Error("qualification_capability_identity_invalid");
  }
  required(input.logicalEvidence.contractId, "qualification_logical_evidence_missing");
  required(input.logicalEvidence.schemaFingerprint, "qualification_logical_evidence_missing");
  required(input.logicalEvidence.bindingId, "qualification_logical_evidence_missing");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.logicalEvidence.schemaFingerprint)) {
    throw new Error("qualification_logical_evidence_invalid");
  }
  if (
    input.logicalEvidence.contractId !== input.capability.components.logicalBindingId ||
    input.logicalEvidence.bindingId !== input.capability.components.logicalBindingId ||
    input.logicalEvidence.schemaFingerprint !== input.capability.components.semanticContractFingerprint
  ) {
    throw new Error("qualification_logical_evidence_mismatch");
  }
  if (input.capability.components.kernelEnvelopeContractVersion !== THOUGHT_KERNEL_ENVELOPE_VERSION) {
    throw new Error("qualification_kernel_envelope_mismatch");
  }
  if (input.capability.components.semanticContractFingerprint !== THOUGHT_OUTPUT_SCHEMA_FINGERPRINT) {
    throw new Error("qualification_semantic_contract_mismatch");
  }
  if (input.capability.components.parserValidatorFingerprint !== `sha256:${sha256Text(THOUGHT_SEMANTIC_PARSER_ID)}`) {
    throw new Error("qualification_parser_validator_mismatch");
  }
  required(input.wireEvidence.adapterId, "wire_evidence_unavailable");
  required(input.wireEvidence.wireFormat, "wire_evidence_unavailable");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.wireEvidence.sanitizedBodyDigest)) {
    throw new Error("wire_evidence_unavailable");
  }
  required(input.wireEvidence.emittedEnforcementMode, "wire_evidence_unavailable");
  required(input.wireEvidence.providerDeclaredEnforcement, "wire_evidence_unavailable");
  if (input.wireEvidence.emittedEnforcementMode !== input.capability.components.schemaEnforcementMode) {
    throw new Error("schema_enforcement_evidence_mismatch");
  }
  if (
    input.wireEvidence.bindingId !== undefined &&
    input.wireEvidence.bindingId !== null &&
    input.wireEvidence.bindingId !== input.capability.components.wireBindingId
  ) {
    throw new Error("wire_binding_evidence_mismatch");
  }
  const resourcePolicy = thoughtResourcePolicyIdentity();
  if (input.capability.components.resourcePolicyFingerprint !== resourcePolicy.fingerprint) {
    throw new Error("qualification_resource_policy_mismatch");
  }
  if (
    !Number.isInteger(input.resourceEvidence.deadlineMs) || input.resourceEvidence.deadlineMs < 1 ||
    !Number.isInteger(input.resourceEvidence.maxOutputTokens) || input.resourceEvidence.maxOutputTokens < 1 ||
    !Number.isInteger(input.resourceEvidence.attempts) || input.resourceEvidence.attempts < 1
  ) {
    throw new Error("qualification_resource_evidence_invalid");
  }
  if (
    input.resourceEvidence.deadlineMs !== resourcePolicy.ordinaryThoughtBudgetMs ||
    input.resourceEvidence.maxOutputTokens > resourcePolicy.interactiveMaxOutput ||
    input.resourceEvidence.attempts > 1 + resourcePolicy.structuralRetriesMaxPerSemanticPass
  ) {
    throw new Error("qualification_resource_evidence_mismatch");
  }
}
