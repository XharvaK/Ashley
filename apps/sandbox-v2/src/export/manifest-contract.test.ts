/** Falsify export manifest binding before any filesystem effect. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validatePatchExportRequest } from "./executor.js";

function request(change: Record<string, unknown> = {}) {
  const manifest = { version: 1, projectId: "project", changesetId: "cs_bound", patchSha256: "a".repeat(64),
    baseCommit: "b".repeat(40), baseTree: "c".repeat(40), sanitizedBaseTree: "d".repeat(40), candidateTree: "e".repeat(40),
    rationale: "Thought authored this repair", frictionRefs: ["friction:record"], candidateContentHash: "f".repeat(64),
    m4Receipt: { taskId: "verified-task", workspaceId: "workspace", outcome: "succeeded", verificationOutcome: "verified_success", candidateTreeHash: "f".repeat(64) }, ...change };
  const manifestUtf8 = JSON.stringify(manifest) + "\n";
  return { version: 2, operation: "patch_export", projectId: "project", changesetId: "cs_bound", artifactRef: "/control/sealed.patch",
    destinationRoot: "/review", expectedSha256: "a".repeat(64), manifestUtf8,
    expectedManifestSha256: createHash("sha256").update(manifestUtf8).digest("hex") };
}

describe("S0 manifest admission", () => {
  it("accepts a bound native Git manifest and successful M4 receipt", () => {
    expect(validatePatchExportRequest(request())).toMatchObject({ ok: true });
  });
  it("refuses absent manifest bytes", () => {
    expect(validatePatchExportRequest({ ...request(), manifestUtf8: undefined })).toMatchObject({ ok: false, error: "export_manifest_required" });
  });
  it("refuses altered manifest bytes without their new digest", () => {
    expect(validatePatchExportRequest({ ...request(), manifestUtf8: request().manifestUtf8 + " " })).toMatchObject({ ok: false, error: "manifest_digest_mismatch" });
  });
  it.each([{ patchSha256: "9".repeat(64) }, { candidateContentHash: "9".repeat(64) }, { rationale: " " }, { baseTree: "unrecorded" }, { m4Receipt: { outcome: "failed" } }])("refuses semantic or mechanical misbinding %j", change => {
    expect(validatePatchExportRequest(request(change))).toMatchObject({ ok: false, error: "manifest_binding_invalid" });
  });
});
