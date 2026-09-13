import { describe, expect, it } from "vitest";
import { buildThoughtCapabilityIdentity } from "./capability-identity.js";
import { compareReleaseTruth, releaseTruthForRuntime } from "./release-truth.js";

const components = {
  executableBuildIdentity: "build:fixture", semanticContractFingerprint: "sha256:" + "a".repeat(64),
  kernelEnvelopeContractVersion: "ashley.thought.kernel-envelope.v1", parserValidatorFingerprint: "sha256:" + "b".repeat(64),
  provider: "nim", configuredModelId: "openai/gpt-oss-20b", occupantId: "nim-primary", logicalBindingId: "logical",
  wireBindingId: "wire", schemaEnforcementMode: "guided_json" as const, resourcePolicyFingerprint: "sha256:" + "c".repeat(64),
  adapterCompatibilityFingerprint: "sha256:" + "d".repeat(64),
};

describe("release truth", () => {
  it("keeps release claim, qualification, and computed identity separate", () => {
    const capability = buildThoughtCapabilityIdentity(components);
    expect(compareReleaseTruth({ releaseIdClaim: "build:fixture", runtimeCapability: capability, qualifiedCapability: capability, qualificationPresent: true, qualificationInvalidated: false })).toMatchObject({ matched: true, mismatchCodes: [] });
    expect(compareReleaseTruth({ releaseIdClaim: " ", runtimeCapability: capability, qualifiedCapability: null, qualificationPresent: false, qualificationInvalidated: false })).toMatchObject({ matched: false, mismatchCodes: ["release_id_missing", "qualification_missing"] });
    expect(compareReleaseTruth({ releaseIdClaim: "build:fixture", runtimeCapability: capability, qualifiedCapability: buildThoughtCapabilityIdentity({ ...components, wireBindingId: "wire:other" }), qualificationPresent: true, qualificationInvalidated: false }).mismatchCodes).toContain("wire_binding_mismatch");
  });

  it("does not let a stale process build identity satisfy Release Truth", () => {
    const capability = buildThoughtCapabilityIdentity(components);
    const result = releaseTruthForRuntime({
      releaseTruthId: "rt_process_mismatch",
      observedAt: "2026-08-31T00:00:00.000Z",
      releaseIdClaim: "build:fixture",
      processIdentity: {
        pid: 42,
        startedAt: "2026-08-31T00:00:00.000Z",
        executableBuildIdentity: "build:stale",
      },
      runtimeCapability: capability,
      qualificationResultId: "qres_fixture",
      qualifiedCapability: capability,
      qualificationPresent: true,
      qualificationInvalidated: false,
    });
    expect(result.matched).toBe(false);
    expect(result.mismatchCodes).toContain("build_identity_mismatch");
  });
});
