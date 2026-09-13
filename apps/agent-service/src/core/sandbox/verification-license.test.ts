import { describe, expect, it } from "vitest";
import type { SandboxV2OperationResult } from "@composer-assistant/sandbox-v2";
import { issueCandidateVerificationLicense } from "./verification-license.js";
import { isVerifiedVerificationClaimEffect } from "./engineering-types.js";
import { deriveOperationalTruth } from "./operational-truth.js";
import { formatSandboxV2LicenseAudit } from "./v2-license-audit.js";

const HASH = "ab".repeat(32);

function receipt(
  overrides: Partial<Extract<SandboxV2OperationResult, { kind: "workspace.verify" }>> = {},
): Extract<SandboxV2OperationResult, { kind: "workspace.verify" }> {
  return {
    kind: "workspace.verify",
    snapshotId: "vsnap_test_1",
    workspaceId: "ws-m4-1",
    projectId: "project-ashley",
    candidateTreeHash: HASH,
    candidateTreeHashAfter: HASH,
    sourceSnapshotId: "snap_src_1",
    treeHashAlgorithm: "m4-provisional-tree-v0",
    recipeId: "typescript_fixture_compile_v1",
    recipeVersion: "1",
    recipeDefinitionHash: HASH,
    executableIdentity: "/usr/bin/tsc",
    argvIdentity: "--noEmit",
    protocolState: "admitted",
    verificationOutcome: "verified_success",
    exitCode: 0,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutSha256: HASH,
    stderrSha256: HASH,
    cleanupCompleted: true,
    projectionDiscarded: true,
    candidateUnchanged: true,
    ...overrides,
  };
}

const request = {
  projectId: "project-ashley",
  workspaceId: "ws-m4-1",
  recipeId: "typescript_fixture_compile_v1",
};

describe("issueCandidateVerificationLicense", () => {
  it("rejects a missing receipt", () => {
    const license = issueCandidateVerificationLicense({ request, receipt: undefined });
    expect(license.state).toBe("none");
    expect(license.profile).toBe("candidate_verification");
    expect(license.error).toBe("missing_receipt");
    expect(license.verificationClaimEffect).toBeUndefined();
    expect(formatSandboxV2LicenseAudit(license)?.verified).toBe(false);
  });

  it("rejects a mismatched snapshot/workspace", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt({ workspaceId: "other-ws" }),
    });
    expect(license.error).toBe("mismatched_snapshot");
    expect(license.verificationClaimEffect).toBeUndefined();
  });

  it("rejects a mismatched recipe", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt({ recipeId: "other_recipe" }),
    });
    expect(license.error).toBe("mismatched_recipe");
    expect(license.verificationClaimEffect).toBeUndefined();
  });

  it("rejects outcome_unknown", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt({ verificationOutcome: "outcome_unknown" }),
    });
    expect(license.state).toBe("outcome_unknown");
    expect(license.error).toBe("outcome_unknown");
    expect(license.verificationClaimEffect).toBeUndefined();
    const truth = deriveOperationalTruth(license);
    expect(truth.state).toBe("outcome_unknown");
    expect(truth.locked).toBe(true);
    expect(truth.semanticOutput).toContain("unknown");
    expect(truth.semanticOutput?.toLowerCase()).not.toContain("failed");
  });

  it("rejects sandbox_failure", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt({
        protocolState: "sandbox_failure",
        verificationOutcome: "outcome_unknown",
      }),
    });
    expect(license.state).toBe("failed");
    expect(license.error).toBe("sandbox_failure");
    expect(license.verificationClaimEffect).toBeUndefined();
    const truth = deriveOperationalTruth(license);
    expect(truth.state).toBe("failed");
    expect(truth.semanticOutput).toContain("sandbox_failure");
    expect(truth.semanticOutput?.toLowerCase()).not.toContain("verified_failure");
  });

  it("rejects cleanup_failure", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt({
        protocolState: "cleanup_failure",
        verificationOutcome: "outcome_unknown",
      }),
    });
    expect(license.error).toBe("cleanup_failure");
    expect(license.verificationClaimEffect).toBeUndefined();
  });

  it("rejects refused protocol state", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt({
        protocolState: "refused",
        verificationOutcome: "outcome_unknown",
      }),
    });
    expect(license.error).toBe("refused");
    expect(license.verificationClaimEffect).toBeUndefined();
  });

  it("accepts verified_success as a mechanical outcome", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt(),
      executedAtMs: 1,
    });
    expect(license.state).toBe("succeeded");
    expect(isVerifiedVerificationClaimEffect(license.verificationClaimEffect)).toBe(true);
    expect(license.verificationClaimEffect?.verificationOutcome).toBe("verified_success");
    expect(formatSandboxV2LicenseAudit(license)?.verified).toBe(true);
  });

  it("accepts verified_failure as a mechanical outcome", () => {
    const license = issueCandidateVerificationLicense({
      request,
      receipt: receipt({ verificationOutcome: "verified_failure", exitCode: 1 }),
      executedAtMs: 2,
    });
    expect(license.state).toBe("succeeded");
    expect(license.verificationClaimEffect?.verificationOutcome).toBe("verified_failure");
    const truth = deriveOperationalTruth(license);
    expect(truth.state).toBe("verified_failure");
    expect(truth.locked).toBe(true);
    expect(truth.snapshotId).toBe("vsnap_test_1");
    expect(truth.recipeId).toBe("typescript_fixture_compile_v1");
    expect(truth.verificationOutcome).toBe("verified_failure");
    expect(truth.semanticOutput).toContain("verified_failure");
    const blob = JSON.stringify(truth).toLowerCase();
    expect(blob).not.toMatch(/quality|approv|merge|deploy|improv|ready|correct/);
  });
});
