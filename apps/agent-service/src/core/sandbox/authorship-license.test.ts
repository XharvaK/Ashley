import { describe, expect, it } from "vitest";
import type { SandboxV2OperationResult } from "@composer-assistant/sandbox-v2";
import { issueCandidateAuthorshipLicense } from "./authorship-license.js";
import { isVerifiedAuthorshipClaimEffect } from "./engineering-types.js";
import { deriveOperationalTruth } from "./operational-truth.js";
import { formatSandboxV2LicenseAudit } from "./v2-license-audit.js";
import { refuseApplyCandidateChangeSet } from "@composer-assistant/sandbox-v2";

const HASH = "ab".repeat(32);

function receipt(
  overrides: Partial<Extract<SandboxV2OperationResult, { kind: "changeset.author" }>> = {},
): Extract<SandboxV2OperationResult, { kind: "changeset.author" }> {
  return {
    kind: "changeset.author",
    changesetId: "cs_" + "11".repeat(16),
    changesetVersion: 1,
    projectId: "project-ashley",
    workspaceId: "ws-m5-01",
    snapshotId: "vsnap_author_1",
    sourceSnapshotId: "snap_src_1",
    candidateTreeHash: HASH,
    baseTreeHash: "cd".repeat(32),
    baseCommit: null,
    sourceCleanliness: "unknown",
    treeHashAlgorithm: "m4-provisional-tree-v0",
    changedPaths: [
      {
        path: "src/a.ts",
        changeKind: "modified",
        beforeSha256: HASH,
        afterSha256: "cd".repeat(32),
      },
    ],
    patchSha256: HASH,
    patchBytes: 64,
    artifactRef: "/tmp/changesets/cs_1/sealed.patch",
    candidateUnchanged: true,
    liveUnwritten: true,
    protocolState: "admitted",
    completedAtMs: 1,
    ...overrides,
  };
}

const request = { projectId: "project-ashley", workspaceId: "ws-m5-01" };

describe("issueCandidateAuthorshipLicense", () => {
  it("rejects a missing receipt", () => {
    const license = issueCandidateAuthorshipLicense({ request, receipt: undefined });
    expect(license.state).toBe("none");
    expect(license.profile).toBe("candidate_authorship");
    expect(license.error).toBe("missing_receipt");
    expect(license.authorshipClaimEffect).toBeUndefined();
  });

  it("rejects a mismatched workspace", () => {
    const license = issueCandidateAuthorshipLicense({
      request,
      receipt: receipt({ workspaceId: "other-ws" }),
    });
    expect(license.error).toBe("mismatched_snapshot");
  });

  it("licenses a sealed advisory change-set and never apply", () => {
    const license = issueCandidateAuthorshipLicense({ request, receipt: receipt() });
    expect(license.state).toBe("succeeded");
    expect(isVerifiedAuthorshipClaimEffect(license.authorshipClaimEffect)).toBe(true);
    const truth = deriveOperationalTruth(license);
    expect(truth.state).toBe("verified_success");
    expect(truth.locked).toBe(true);
    expect(truth.semanticOutput).toContain("has not been applied");
    expect(JSON.stringify(truth).toLowerCase()).not.toMatch(/merged|deployed|improved herself/);
    expect(formatSandboxV2LicenseAudit(license)?.verified).toBe(true);
    expect(refuseApplyCandidateChangeSet().error).toBe("m5_apply_forbidden");
  });
});
