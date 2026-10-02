/** Bind a real recorded Git base and persisted M4 receipt to the host's paired export witness. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceManager, executeCandidateAuthorship, isChangesetAuthorResult, type SandboxV2Dispatcher, type V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import { openNuclearDb } from "../db.js";
import { persistProposedChangeSet } from "./changeset-store.js";
import { persistVerificationReceipt } from "./verification-receipt-store.js";
import { executePatchExportV2 } from "./patch-export-execution.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ashley-s0-host-")); roots.push(root);
  const source = join(root, "source"); mkdirSync(source);
  writeFileSync(join(source, "file.txt"), "before\n");
  for (const args of [["init"], ["add", "."], ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "base"]]) execFileSync("git", args, { cwd: source, stdio: "ignore" });
  const destination = join(root, "review"); mkdirSync(destination);
  // Portable controller seam; production POSIX registry admission remains separately qualified.
  const registry = { resolveReadRoot: () => ({ ok: true, entry: { projectId: "project", canonicalRoot: source,
    enabled: true, readAllowed: true, authorshipAllowed: true, patchExportAllowed: true, exportDestinationCanonicalRoot: destination } }) } as unknown as V2ProjectReadRegistry;
  const manager = new WorkspaceManager({ managedRoot: join(root, "workspaces") });
  const workspace = await manager.acquireWorkspace({ projectId: "project", canonicalRoot: source });
  if (!workspace.ok) throw new Error(workspace.error);
  writeFileSync(join(workspace.workspaceTreeRoot, "file.txt"), "after\n");
  const authored = await executeCandidateAuthorship({ version: 2, operation: "changeset.author", projectId: "project", workspaceId: workspace.workspaceId }, { registry, workspaceManager: manager });
  if (authored.outcome !== "succeeded" || !isChangesetAuthorResult(authored.result)) throw new Error("fixture author failed");
  const a = authored.result;
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  persistProposedChangeSet(db, { ownerId: "owner", changesetId: a.changesetId, projectId: "project", workspaceId: a.workspaceId,
    sourceSnapshotId: a.sourceSnapshotId, candidateSnapshotId: a.snapshotId, candidateTreeHash: a.candidateTreeHash, baseTreeHash: a.baseTreeHash,
    baseCommit: a.baseCommit, sourceCleanliness: "clean", treeHashAlgorithm: a.treeHashAlgorithm, objective: "repair", rationale: "Thought authored rationale",
    riskClass: "low", evidenceRefs: ["friction:declared", "journal:source"], verificationRecipeIds: [], changedPaths: a.changedPaths,
    linkedVerificationRefs: [], patchSha256: a.patchSha256, patchBytes: a.patchBytes, artifactRef: a.artifactRef,
    gitProvenance: { baseCommit: a.baseCommit!, sourceGitTree: a.sourceGitTree!, baseGitTree: a.baseGitTree!, candidateGitTree: a.candidateGitTree! } });
  const verify = () => persistVerificationReceipt(db, { ownerId: "owner", taskId: "actual-m4", workspaceId: a.workspaceId, recipeId: "fixture",
    candidateTreeHash: a.candidateTreeHash, baseTreeHash: a.baseTreeHash, outcome: "succeeded", facts: { verificationOutcome: "verified_success", privateDiagnostic: "must not export" } });
  let captured: any;
  let omitManifestWitness = false;
  const dispatcher = { dispatch: async (r: any) => {
    captured = r;
    return { outcome: "succeeded", operation: "patch_export", executedAtMs: 1, result: { kind: "patch_export", projectId: "project", changesetId: a.changesetId,
      artifactRef: a.artifactRef, destinationRelativeName: `${a.changesetId}.patch`, destinationPath: join(destination, `${a.changesetId}.patch`),
      patchSha256: a.patchSha256, witnessedSha256: a.patchSha256, bytesWritten: a.patchBytes, liveUnwritten: true, gitUnwritten: true, applied: false,
      protocolState: "admitted", witnessState: "digest_readback", completedAtMs: 1,
      ...(!omitManifestWitness ? { manifestDestinationPath: join(destination, `${a.changesetId}.manifest.json`), manifestSha256: r.expectedManifestSha256, witnessedManifestSha256: r.expectedManifestSha256 } : {}) } };
  } } as unknown as SandboxV2Dispatcher;
  const run = () => executePatchExportV2({ request: { operation: "patch_export", projectId: "project", changesetId: a.changesetId, adjudication: "accept" } as never,
    ownerId: "owner", db, skipCapabilityGate: true, registry, workspaceManager: manager, dispatcher, envOverrides: { sandboxEngineeringLifecycleEnabled: true } });
  return { db, a, run, verify, captured: () => captured, omitWitness: () => { omitManifestWitness = true; } };
}

describe("S0 host manifest binding", () => {
  it("exports persisted authored fields and the actual M4 receipt with distinct Git and content identities", async () => {
    const f = await fixture(); try {
      f.verify(); const result = await f.run();
      expect(result.license.state).toBe("succeeded");
      expect(typeof f.captured().manifestUtf8).toBe("string");
      const m = JSON.parse(f.captured().manifestUtf8);
      expect(m).toMatchObject({ rationale: "Thought authored rationale", evidenceRefs: ["friction:declared", "journal:source"], frictionRefs: ["friction:declared"],
        baseCommit: f.a.baseCommit, baseTree: f.a.sourceGitTree, sanitizedBaseTree: f.a.baseGitTree, candidateTree: f.a.candidateGitTree,
        candidateContentHash: f.a.candidateTreeHash, m4Receipt: { taskId: "actual-m4", verificationOutcome: "verified_success" } });
      expect(f.captured().manifestUtf8).not.toContain("privateDiagnostic");
      expect(result.license.patchExportClaimEffect).toMatchObject({ manifestSha256: f.captured().expectedManifestSha256 });
      expect((await f.run()).license.taskId).toBe(result.license.taskId);
    } finally { f.db.close(); }
  });
  it("refuses dispatch without the actual matching successful M4 receipt", async () => {
    const f = await fixture(); try { expect((await f.run()).license.error).toBe("verification_receipt_required"); expect(f.captured()).toBeUndefined(); } finally { f.db.close(); }
  });
  it("refuses success when the dispatcher witnesses only the patch", async () => {
    const f = await fixture(); try { f.verify(); f.omitWitness(); expect((await f.run()).license).toMatchObject({ state: "outcome_unknown", error: "manifest_witness_mismatch" }); } finally { f.db.close(); }
  });
});
