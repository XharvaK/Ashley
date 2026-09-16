import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  V2ProjectReadRegistry,
  WorkspaceManager,
  type SandboxV2Dispatcher,
  type SandboxV2OperationResult,
  type SandboxV2Result,
} from "@composer-assistant/sandbox-v2";
import { openNuclearDb } from "../db.js";
import {
  capabilityNames,
  currentBuildIdentity,
  currentContractId,
  currentReleaseId,
} from "../rollout/capabilities.js";
import { getCapabilityReality } from "../cognitive-v021/thought/capability-reality.js";
import { executePatchExportV2 } from "./patch-export-execution.js";
import { executeCandidateAuthorshipV2, executeCandidateVerificationV2 } from "./v2-execution.js";
import { persistProposedChangeSet } from "./changeset-store.js";
import { persistVerificationReceipt } from "./verification-receipt-store.js";

const PROJECT_ID = "project-ashley";
const OWNER_ID = "owner-1";
const RECIPE_ID = "typescript_fixture_compile_v1";
const CANDIDATE_TREE_HASH = "ab".repeat(32);
const BASE_TREE_HASH = "cd".repeat(32);
const RECIPE_DEFINITION_HASH = "ef".repeat(32);

function activate(db: DatabaseSync): void {
  const releaseId = currentReleaseId();
  const now = new Date().toISOString();
  for (const capability of capabilityNames) {
    db.prepare(
      `INSERT OR REPLACE INTO capability_releases
        (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
       VALUES (?, ?, 'active', ?, ?, ?, 0)`,
    ).run(capability, releaseId, now, currentContractId(), currentBuildIdentity());
  }
}

function registry(overrides: Record<string, unknown> = {}): V2ProjectReadRegistry {
  return new V2ProjectReadRegistry([{
    projectId: PROJECT_ID,
    canonicalRoot: "/srv/projects/project-ashley",
    displayName: "Project Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    engineeringAllowed: true,
    verificationAllowed: true,
    allowedRecipeIds: [RECIPE_ID],
    authorshipAllowed: true,
    operationAllowed: false,
    patchExportAllowed: true,
    exportDestinationCanonicalRoot: "/srv/review/project-ashley",
    ...overrides,
  }]);
}

function patchExportResult(
  changesetId: string,
  patchSha256: string,
): SandboxV2Result {
  const result: Extract<SandboxV2OperationResult, { kind: "patch_export" }> = {
    kind: "patch_export",
    projectId: PROJECT_ID,
    changesetId,
    destinationRelativeName: `${changesetId}.patch`,
    artifactRef: "/tmp/candidate.patch",
    destinationPath: `/srv/review/project-ashley/${changesetId}.patch`,
    patchSha256,
    witnessedSha256: patchSha256,
    bytesWritten: 16,
    liveUnwritten: true,
    gitUnwritten: true,
    applied: false,
    protocolState: "admitted",
    witnessState: "digest_readback",
    completedAtMs: 42,
  };
  return {
    outcome: "succeeded",
    operation: "patch_export",
    result,
    executedAtMs: 42,
  };
}

function verificationResult(
  workspaceId: string,
  outcome: "verified_success" | "verified_failure",
  candidateTreeHash = CANDIDATE_TREE_HASH,
): SandboxV2Result {
  const receipt = {
    kind: "workspace.verify" as const,
    snapshotId: "snapshot-1",
    workspaceId,
    projectId: PROJECT_ID,
    candidateTreeHash,
    candidateTreeHashAfter: CANDIDATE_TREE_HASH,
    sourceSnapshotId: "source-snapshot-1",
    treeHashAlgorithm: "m4-provisional-tree-v0",
    recipeId: RECIPE_ID,
    recipeVersion: "1",
    recipeDefinitionHash: RECIPE_DEFINITION_HASH,
    executableIdentity: "/usr/bin/tsc",
    argvIdentity: "--noEmit",
    protocolState: "admitted" as const,
    verificationOutcome: outcome,
    exitCode: outcome === "verified_success" ? 0 : 1,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutSha256: CANDIDATE_TREE_HASH,
    stderrSha256: CANDIDATE_TREE_HASH,
    cleanupCompleted: true,
    projectionDiscarded: true,
    candidateUnchanged: true,
  };
  return {
    outcome: "succeeded",
    operation: "workspace.verify",
    result: receipt,
    verificationReceipt: receipt,
    executedAtMs: 42,
  };
}

function candidateFixture(
  db: DatabaseSync,
  root: string,
  workspaceId = "ws-candidate-1",
  candidateTreeHash = CANDIDATE_TREE_HASH,
) {
  const body = "diff --git a/src/a.ts b/src/a.ts\n";
  const artifactRef = join(root, `${workspaceId}.patch`);
  writeFileSync(artifactRef, body, "utf8");
  const patchSha256 = createHash("sha256").update(body, "utf8").digest("hex");
  const changesetId = `cs_${randomBytes(16).toString("hex")}`;
  persistProposedChangeSet(db, {
    ownerId: OWNER_ID,
    changesetId,
    projectId: PROJECT_ID,
    workspaceId,
    sourceSnapshotId: "source-snapshot-1",
    candidateSnapshotId: "candidate-snapshot-1",
    candidateTreeHash,
    baseTreeHash: BASE_TREE_HASH,
    baseCommit: null,
    sourceCleanliness: "clean",
    treeHashAlgorithm: "m4-provisional-tree-v0",
    objective: "bound one candidate change",
    rationale: "the bounded candidate objective is adopted for this fixture",
    riskClass: "low",
    evidenceRefs: ["evidence-1"],
    verificationRecipeIds: [RECIPE_ID],
    intendedPaths: ["src/a.ts"],
    changedPaths: [{ path: "src/a.ts", changeKind: "modified" }],
    linkedVerificationRefs: [],
    patchSha256,
    patchBytes: Buffer.byteLength(body, "utf8"),
    artifactRef,
  });
  return { changesetId, patchSha256, workspaceId };
}

function patchRequest(changesetId: string, adjudication?: string): Record<string, unknown> {
  return {
    operation: "patch_export",
    projectId: PROJECT_ID,
    changesetId,
    ...(adjudication === undefined ? {} : { adjudication }),
  };
}

describe("P-W4-01 proposal-only candidate improvement loop", () => {
  it("exposes M7 only when the active operator registry has a bounded destination", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      activate(db);
      const reality = getCapabilityReality(db, {
        registry: registry(),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      });
      expect(reality.canOfferPatchExport).toBe(true);
      expect(reality.operationCapabilities?.find((item) => item.operationKind === "patch_export"))
        .toMatchObject({
          semanticClass: "effect",
          family: "patch_export",
          readOnly: false,
          requiresProject: true,
          available: true,
          requiredRequestFields: ["projectId", "changesetId", "adjudication"],
          authorizedProjectIds: [PROJECT_ID],
        });

      const denied = getCapabilityReality(db, {
        registry: new V2ProjectReadRegistry([]),
        masterMode: "apply",
        lifecycleEnabled: true,
        substrateAvailable: true,
      });
      expect(denied.canOfferPatchExport).toBe(false);
      expect(denied.operationCapabilities?.find((item) => item.operationKind === "patch_export"))
        .toMatchObject({ available: false, authorizedProjectIds: [] });
    } finally {
      db.close();
    }
  });

  it("requires Thought adjudication and an M4 receipt before M7 dispatch", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const root = mkdtempSync(join(tmpdir(), "ashley-w4-export-"));
    try {
      activate(db);
      const candidate = candidateFixture(db, root);
      let dispatches = 0;
      const dispatcher = {
        dispatch: async () => {
          dispatches += 1;
          return patchExportResult(candidate.changesetId, candidate.patchSha256);
        },
      } as unknown as SandboxV2Dispatcher;

      const missingAdjudication = await executePatchExportV2({
        request: patchRequest(candidate.changesetId) as never,
        ownerId: OWNER_ID,
        db,
        masterMode: "apply",
        registry: registry(),
        dispatcher,
        envOverrides: { sandboxEngineeringLifecycleEnabled: true },
      });
      expect(missingAdjudication.license.error).toBe("thought_adjudication_required");
      expect(dispatches).toBe(0);

      const missingReceipt = await executePatchExportV2({
        request: patchRequest(candidate.changesetId, "accept") as never,
        ownerId: OWNER_ID,
        db,
        masterMode: "apply",
        registry: registry(),
        dispatcher,
        envOverrides: { sandboxEngineeringLifecycleEnabled: true },
      });
      expect(missingReceipt.license.error).toBe("verification_receipt_required");
      expect(dispatches).toBe(0);

      persistVerificationReceipt(db, {
        ownerId: OWNER_ID,
        taskId: "verify-success-1",
        workspaceId: candidate.workspaceId,
        recipeId: RECIPE_ID,
        snapshotId: "snapshot-1",
        candidateTreeHash: CANDIDATE_TREE_HASH,
        baseTreeHash: BASE_TREE_HASH,
        outcome: "succeeded",
        facts: { verificationOutcome: "verified_success" },
      });

      const exported = await executePatchExportV2({
        request: patchRequest(candidate.changesetId, "accept") as never,
        ownerId: OWNER_ID,
        db,
        masterMode: "apply",
        registry: registry(),
        dispatcher,
        envOverrides: { sandboxEngineeringLifecycleEnabled: true },
      });
      expect(exported.license.state).toBe("succeeded");
      expect(exported.license.patchExportClaimEffect).toMatchObject({
        applied: false,
        liveUnwritten: true,
        gitUnwritten: true,
      });
      expect(JSON.stringify(exported.license)).not.toContain("notification");
      expect((db.prepare("SELECT status FROM patch_export_records WHERE changeset_id = ?").get(candidate.changesetId) as { status: string }).status)
        .toBe("succeeded");

      const retried = await executePatchExportV2({
        request: patchRequest(candidate.changesetId, "accept") as never,
        ownerId: OWNER_ID,
        db,
        masterMode: "apply",
        registry: registry(),
        dispatcher,
        envOverrides: { sandboxEngineeringLifecycleEnabled: true },
      });
      expect(retried.license.state).toBe("succeeded");
      expect(retried.license.taskId).toBe(exported.license.taskId);
      expect(retried.license.taskId).toBe(`v2-export:${candidate.changesetId}:${candidate.patchSha256}`);
      const logicalTaskId = exported.license.taskId;
      if (!logicalTaskId) throw new Error("patch_export_task_id_missing");
      expect((db.prepare("SELECT COUNT(*) AS count FROM patch_export_records WHERE task_id = ?").get(logicalTaskId) as { count: number }).count)
        .toBe(1);
      expect(dispatches).toBe(2);
    } finally {
      db.close();
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks only the verified candidate failed after a verified M4 failure", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const root = mkdtempSync(join(tmpdir(), "ashley-w4-failure-"));
    try {
      activate(db);
      const candidate = candidateFixture(db, root, "ws-candidate-failure");
      const sibling = candidateFixture(
        db,
        root,
        candidate.workspaceId,
        "de".repeat(32),
      );
      const result = await executeCandidateVerificationV2({
        request: { projectId: PROJECT_ID, workspaceId: candidate.workspaceId, recipeId: RECIPE_ID },
        ownerId: OWNER_ID,
        taskId: "verify-failure-1",
        db,
        skipCapabilityGate: true,
        registry: registry(),
        dispatcher: {
          dispatch: async () => verificationResult(candidate.workspaceId, "verified_failure"),
        } as unknown as SandboxV2Dispatcher,
        envOverrides: { sandboxEngineeringLifecycleEnabled: true },
      });
      expect(result.license.verificationClaimEffect?.verificationOutcome).toBe("verified_failure");
      expect((db.prepare("SELECT status, review_status FROM candidate_changesets WHERE changeset_id = ?").get(candidate.changesetId) as { status: string; review_status: string | null }))
        .toEqual({ status: "verification_failed", review_status: null });
      expect((db.prepare("SELECT status, review_status FROM candidate_changesets WHERE changeset_id = ?").get(sibling.changesetId) as { status: string; review_status: string | null }))
        .toEqual({ status: "proposed", review_status: "submitted" });
      expect((db.prepare("SELECT event_type FROM candidate_changeset_events WHERE changeset_id = ? ORDER BY id DESC LIMIT 1").get(candidate.changesetId) as { event_type: string }).event_type)
        .toBe("verification_failed");
      expect((db.prepare("SELECT COUNT(*) AS count FROM candidate_changeset_events WHERE changeset_id = ? AND event_type = 'verification_failed'").get(sibling.changesetId) as { count: number }).count)
        .toBe(0);

      const exportAttempt = await executePatchExportV2({
        request: patchRequest(candidate.changesetId, "accept") as never,
        ownerId: OWNER_ID,
        db,
        masterMode: "apply",
        registry: registry(),
        dispatcher: {
          dispatch: async () => {
            throw new Error("m7_dispatch_should_not_run");
          },
        } as unknown as SandboxV2Dispatcher,
        envOverrides: { sandboxEngineeringLifecycleEnabled: true },
      });
      expect(exportAttempt.license.error).toBe("changeset_not_exportable");
    } finally {
      db.close();
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to reuse a P-W3 inquiry workspace for candidate authorship", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-w4-inquiry-"));
    const sourceRoot = join(root, "project");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "package.json"), "{}", "utf8");
    const manager = new WorkspaceManager({ managedRoot: join(root, "workspaces") });
    const inquiry = await manager.acquireInquiryWorkspace(
      { projectId: PROJECT_ID, canonicalRoot: sourceRoot },
      {
        experimentId: "inquiry-1",
        objective: "answer one bounded question",
        budgetDeadlineAtMs: Date.now() + 60_000,
      },
    );
    expect(inquiry.ok).toBe(true);
    if (!inquiry.ok) return;

    let dispatches = 0;
    const result = await executeCandidateAuthorshipV2({
      request: {
        operation: "changeset.author",
        projectId: PROJECT_ID,
        workspaceId: inquiry.workspaceId,
        objective: "adopt one bounded candidate objective",
        rationale: "the candidate scope is explicit",
        riskClass: "low",
      },
      ownerId: OWNER_ID,
      workspaceManager: manager,
      skipCapabilityGate: true,
      registry: registry(),
      dispatcher: {
        dispatch: async () => {
          dispatches += 1;
          return verificationResult(inquiry.workspaceId, "verified_success");
        },
      } as unknown as SandboxV2Dispatcher,
      envOverrides: { sandboxEngineeringLifecycleEnabled: true },
    });

    expect(result.license.error).toBe("inquiry_workspace_forbidden");
    expect(dispatches).toBe(0);
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });
});
