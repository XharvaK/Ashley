import { describe, expect, it } from "vitest";
import {
  assertThoughtCapabilityEvidence,
  buildThoughtCapabilityIdentity,
  thoughtResourcePolicyIdentity,
  type ThoughtCapabilityComponents,
} from "./capability-identity.js";
import { sha256, sha256Text } from "./hash.js";
import { THOUGHT_KERNEL_ENVELOPE_VERSION } from "../cognitive-v021/thought/kernel-envelope.js";
import { THOUGHT_SEMANTIC_PARSER_ID } from "../cognitive-v021/thought/parse.js";
import { THOUGHT_OUTPUT_SCHEMA_FINGERPRINT } from "../cognitive-v021/thought/output-contract.js";

const base: ThoughtCapabilityComponents = {
  executableBuildIdentity: "build:fixture",
  semanticContractFingerprint: "sha256:" + "a".repeat(64),
  kernelEnvelopeContractVersion: "ashley.thought.kernel-envelope.v1",
  parserValidatorFingerprint: "sha256:" + "b".repeat(64),
  provider: "nim",
  configuredModelId: "openai/gpt-oss-20b",
  occupantId: "nim-primary",
  logicalBindingId: "logical:thought:v1",
  wireBindingId: "wire:nim-guided-json:v1",
  schemaEnforcementMode: "guided_json" as const,
  resourcePolicyFingerprint: "sha256:" + "c".repeat(64),
  adapterCompatibilityFingerprint: "sha256:" + "d".repeat(64),
};

describe("Thought capability identity", () => {
  it("hashes and freezes every required component", () => {
    const identity = buildThoughtCapabilityIdentity(base);
    expect(identity.schema).toBe("ashley.thought.capability_identity.v1");
    expect(identity.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(buildThoughtCapabilityIdentity({ ...base, wireBindingId: "wire:other" }).fingerprint).not.toBe(identity.fingerprint);
  });

  it("binds the frozen resource policy and rejects malformed fingerprints", () => {
    const policy = thoughtResourcePolicyIdentity();
    expect(policy).toMatchObject({
      ordinaryThoughtBudgetMs: 180000,
      interactiveMaxOutput: 16384,
      durableProactiveMaxOutput: 16384,
      structuralRetryMaxOutput: 16384,
      structuralRetriesMaxPerSemanticPass: 2,
    });
    expect(policy.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(policy.fingerprint).not.toBe(`sha256:${sha256({
      ordinaryThoughtBudgetMs: 30_000,
      interactiveMaxOutput: 4_096,
      durableProactiveMaxOutput: 4_096,
      structuralRetryMaxOutput: 2_048,
      structuralRetriesMaxPerSemanticPass: 2,
    })}`);
    expect(() => buildThoughtCapabilityIdentity({ ...base, semanticContractFingerprint: "not-a-fingerprint" })).toThrow("capability_component_invalid");
  });

  it("keeps the resource evidence ceiling narrowable but not exceedable", () => {
    const makeEvidence = (resourceEvidence: { deadlineMs: number; maxOutputTokens: number; attempts: number }) => {
      const capability = buildThoughtCapabilityIdentity({
        ...base,
        semanticContractFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
        kernelEnvelopeContractVersion: THOUGHT_KERNEL_ENVELOPE_VERSION,
        parserValidatorFingerprint: `sha256:${sha256Text(THOUGHT_SEMANTIC_PARSER_ID)}`,
        logicalBindingId: "ashley.thought.semantic.v1",
        resourcePolicyFingerprint: thoughtResourcePolicyIdentity().fingerprint,
      });
      return {
        capability,
        logicalEvidence: {
          contractId: capability.components.logicalBindingId,
          schemaFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
          bindingId: capability.components.logicalBindingId,
        },
        wireEvidence: {
          adapterId: "test-adapter",
          wireFormat: "test-wire",
          sanitizedBodyDigest: `sha256:${"e".repeat(64)}`,
          emittedEnforcementMode: capability.components.schemaEnforcementMode,
          providerDeclaredEnforcement: "unavailable" as const,
          bindingId: capability.components.wireBindingId,
        },
        resourceEvidence,
      };
    };

    expect(() => assertThoughtCapabilityEvidence(makeEvidence({ deadlineMs: 180000, maxOutputTokens: 16384, attempts: 3 }))).not.toThrow();
    expect(() => assertThoughtCapabilityEvidence(makeEvidence({ deadlineMs: 180000, maxOutputTokens: 4096, attempts: 3 }))).not.toThrow();
    expect(() => assertThoughtCapabilityEvidence(makeEvidence({ deadlineMs: 180000, maxOutputTokens: 16385, attempts: 3 }))).toThrow("qualification_resource_evidence_mismatch");
    expect(() => assertThoughtCapabilityEvidence(makeEvidence({ deadlineMs: 180000, maxOutputTokens: 16384, attempts: 4 }))).toThrow("qualification_resource_evidence_mismatch");
    expect(() => assertThoughtCapabilityEvidence(makeEvidence({ deadlineMs: 60000, maxOutputTokens: 16384, attempts: 3 }))).toThrow("qualification_resource_evidence_mismatch");
  });

  it("changes the aggregate fingerprint when any component changes", () => {    const original = buildThoughtCapabilityIdentity(base);
    const variants: ThoughtCapabilityComponents[] = [
      { ...base, executableBuildIdentity: "build:fixture-2" },
      { ...base, semanticContractFingerprint: "sha256:" + "e".repeat(64) },
      { ...base, kernelEnvelopeContractVersion: "ashley.thought.kernel-envelope.v2" },
      { ...base, parserValidatorFingerprint: "sha256:" + "f".repeat(64) },
      { ...base, provider: "groq" },
      { ...base, configuredModelId: "openai/gpt-oss-120b" },
      { ...base, occupantId: "groq-secondary" },
      { ...base, logicalBindingId: "logical:thought:v2" },
      { ...base, wireBindingId: "wire:native-json-schema:v1" },
      { ...base, schemaEnforcementMode: "json_object_compatibility" },
      { ...base, resourcePolicyFingerprint: "sha256:" + "7".repeat(64) },
      { ...base, adapterCompatibilityFingerprint: "sha256:" + "8".repeat(64) },
    ];

    for (const variant of variants) {
      expect(buildThoughtCapabilityIdentity(variant).fingerprint).not.toBe(
        original.fingerprint,
      );
    }
  });

  it("rotates the resource-policy fingerprint across the 8K to 16K era", () => {
    const policy = thoughtResourcePolicyIdentity();
    // Era separation: the 16K rotation must differ from the superseded 8K
    // components (stale ordinaryThoughtBudgetMs metadata now truthful).
    expect(policy.fingerprint).not.toBe(`sha256:${sha256({
      ordinaryThoughtBudgetMs: 60_000,
      interactiveMaxOutput: 8_192,
      durableProactiveMaxOutput: 8_192,
      structuralRetryMaxOutput: 8_192,
      structuralRetriesMaxPerSemanticPass: 2,
    })}`);
    expect(policy.ordinaryThoughtBudgetMs).toBe(180_000);
  });
});
