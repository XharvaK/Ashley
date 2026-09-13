import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capabilityProfileFor, currentPortfolio } from "./index.js";
import { qualificationResultUsable } from "./catalog.js";
import { THOUGHT_OUTPUT_SCHEMA_FINGERPRINT } from "../cognitive-v021/thought/output-contract.js";
import { THOUGHT_SEMANTIC_PARSER_ID } from "../cognitive-v021/thought/parse.js";
import { THOUGHT_KERNEL_ENVELOPE_VERSION } from "../cognitive-v021/thought/kernel-envelope.js";
import { sha256Text } from "./hash.js";
import { buildThoughtCapabilityIdentity, thoughtResourcePolicyIdentity } from "./capability-identity.js";
import {
  createThoughtQualificationResult,
  readReleaseTruthArtifact,
  readThoughtQualificationArtifact,
  releaseTruthForRuntime,
  writeReleaseTruthArtifact,
  writeThoughtQualificationArtifact,
} from "./qualification-ledger.js";
import { phase5HealthPredicates } from "./health.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const row = currentPortfolio().rows.find((candidate) => candidate.policyRowId === "mfr_thought_interactive_compat_v1")!;
  const occupant = row.occupants[0]!;
  const profile = capabilityProfileFor(occupant.provider, occupant.configuredModelId);
  const capability = buildThoughtCapabilityIdentity({
    executableBuildIdentity: "build:fixture",
    semanticContractFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
    kernelEnvelopeContractVersion: THOUGHT_KERNEL_ENVELOPE_VERSION,
    parserValidatorFingerprint: `sha256:${sha256Text(THOUGHT_SEMANTIC_PARSER_ID)}`,
    provider: occupant.provider,
    configuredModelId: occupant.configuredModelId,
    occupantId: occupant.occupantId,
    logicalBindingId: "ashley.thought.semantic.v1",
    wireBindingId: "compat:json-object",
    schemaEnforcementMode: "json_object_compatibility",
    resourcePolicyFingerprint: thoughtResourcePolicyIdentity().fingerprint,
    adapterCompatibilityFingerprint: "sha256:" + "d".repeat(64),
  });
  const base = {
    schema: "ashley.evaluation.qualification_result.v1" as const,
    qualificationResultId: "qres_w1_fixture",
    status: "PASS" as const,
    policyRowId: row.policyRowId,
    occupantId: occupant.occupantId,
    subject: { logicalRole: row.logicalRole, seat: row.seat, materialInferenceFingerprint: "sha256:" + "e".repeat(64) },
    profileBinding: {
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      profileFingerprint: profile.profileFingerprint,
      provider: profile.provider,
      configuredModelId: profile.configuredModelId,
    },
    identityContinuityEpoch: null,
    recommendation: "owner_review",
    limitations: [],
    invalidated: false,
    invalidatedBy: null,
  };
  const wireEvidence = {
    adapterId: "ashley.adapter.nim.v1",
    wireFormat: "json_object",
    sanitizedBodyDigest: "sha256:" + "f".repeat(64) as `sha256:${string}`,
    emittedEnforcementMode: "json_object_compatibility",
    providerDeclaredEnforcement: "unavailable" as const,
    bindingId: capability.components.wireBindingId,
  };
  const result = createThoughtQualificationResult({
    base,
    capability,
    logicalEvidence: { contractId: "ashley.thought.semantic.v1", schemaFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT, bindingId: capability.components.logicalBindingId },
    wireEvidence,
    resourceEvidence: { deadlineMs: 180000, maxOutputTokens: 4096, attempts: 1 },
  });
  return { row, occupant, capability, result };
}

describe("W1 immutable qualification ledger", () => {
  it("writes and reads a capability-bound qualification without content", () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-w1-"));
    roots.push(root);
    const { result } = fixture();
    expect(result.schema).toBe("ashley.evaluation.qualification_result.v2");
    writeThoughtQualificationArtifact({ controlDir: root, result, controlRootMode: "fixture" });
    const read = readThoughtQualificationArtifact({ controlDir: root, qualificationResultId: result.qualificationResultId, controlRootMode: "fixture" });
    expect(read?.capability.fingerprint).toBe(result.capability.fingerprint);
    expect(read?.wireEvidence.providerDeclaredEnforcement).toBe("unavailable");
    expect(JSON.stringify(read)).not.toContain("owner message");
  });

  it("keeps legacy profile-only results readable but ineligible for W1", () => {
    const { result, row, occupant } = fixture();
    const legacy = { ...result, schema: "ashley.evaluation.qualification_result.v1" as const };
    expect(qualificationResultUsable({
      result: legacy,
      policyRowId: row.policyRowId,
      occupantId: occupant.occupantId,
      materialInferenceFingerprint: result.subject.materialInferenceFingerprint,
      expectedCapability: result.capability,
    })).toBe(false);
  });

  it("rejects a stronger logical mode when actual wire evidence disagrees", () => {
    const { result, capability } = fixture();
    const {
      capability: _capability,
      logicalEvidence: _logicalEvidence,
      wireEvidence: _wireEvidence,
      resourceEvidence: _resourceEvidence,
      ...base
    } = result;
    expect(() => createThoughtQualificationResult({
      base,
      capability,
      logicalEvidence: {
        contractId: capability.components.logicalBindingId,
        schemaFingerprint: capability.components.semanticContractFingerprint,
        bindingId: capability.components.logicalBindingId,
      },
      wireEvidence: {
        adapterId: "ashley.adapter.nim.v1",
        wireFormat: "json_object",
        sanitizedBodyDigest: "sha256:" + "f".repeat(64) as `sha256:${string}`,
        emittedEnforcementMode: "native_json_schema",
        providerDeclaredEnforcement: "unavailable",
        bindingId: capability.components.wireBindingId,
      },
      resourceEvidence: { deadlineMs: 180000, maxOutputTokens: 4096, attempts: 1 },
    })).toThrow("schema_enforcement_evidence_mismatch");
  });

  it("allows identical immutable artifact bytes and rejects a changed reuse", () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-w1-"));
    roots.push(root);
    const { result } = fixture();
    const first = writeThoughtQualificationArtifact({ controlDir: root, result, controlRootMode: "fixture" });
    const second = writeThoughtQualificationArtifact({ controlDir: root, result, controlRootMode: "fixture" });
    expect(second).toBe(first);
    expect(() => writeThoughtQualificationArtifact({
      controlDir: root,
      result: { ...result, limitations: ["changed"] },
      controlRootMode: "fixture",
    })).toThrow("artifact_immutable");
  });

  it("records release mismatch independently from qualification and transport", () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-w1-"));
    roots.push(root);
    const { capability, result } = fixture();
    const truth = releaseTruthForRuntime({
      releaseTruthId: "rt_w1_fixture",
      observedAt: "2026-08-31T00:00:00.000Z",
      releaseIdClaim: "forged-release",
      processIdentity: { pid: 1, startedAt: "2026-08-31T00:00:00.000Z", executableBuildIdentity: "build:fixture" },
      runtimeCapability: capability,
      qualificationResultId: result.qualificationResultId,
      qualifiedCapability: capability,
      qualificationPresent: true,
      qualificationInvalidated: false,
    });
    expect(truth.matched).toBe(false);
    expect(truth.mismatchCodes).toContain("build_identity_mismatch");
    writeReleaseTruthArtifact({ controlDir: root, result: truth, controlRootMode: "fixture" });
    expect(readReleaseTruthArtifact({ controlDir: root, releaseTruthId: truth.releaseTruthId, controlRootMode: "fixture" })?.matched).toBe(false);
  });

  it("keeps all four W1 health predicates separate", () => {
    expect(phase5HealthPredicates({ transportRouteReady: true, thoughtContractQualified: true, releaseTruthMatched: false, productionAccepted: false, mismatchReasons: ["release_id_missing"] })).toEqual({
      transportRouteReady: true,
      thoughtContractQualified: true,
      releaseTruthMatched: false,
      productionAccepted: false,
      mismatchReasons: ["release_id_missing"],
    });
  });
});
