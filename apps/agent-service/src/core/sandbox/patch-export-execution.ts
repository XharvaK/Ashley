/**
 * M7 patch_export adapter. Capability, destination grant, and sealed M5
 * artifact identity are independent. This copies a sealed patch to the
 * operator review location. It does not apply, merge, commit, or deploy.
 */

import { isPatchExportAllowed } from "@composer-assistant/sandbox-policy";
import {
  isPatchExportResult,
  SandboxV2Dispatcher,
  WorkspaceManager,
  validateRecordedGitBase,
  type SandboxV2Result,
} from "@composer-assistant/sandbox-v2";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { env } from "../../env.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import type { CognitionMode, CognitionPatchExportRequest } from "../types.js";
import {
  isVerifiedPatchExportClaimEffect,
  type OperationalClaimLicense,
} from "./engineering-types.js";
import { persistPatchExportRecord } from "./patch-export-store.js";
import { getChangeSet, getSealedGitProvenance } from "./changeset-store.js";
import { getSuccessfulVerificationReceiptForCandidate } from "./verification-receipt-store.js";
import { loadOperatorProjectReadRegistry } from "./project-registry.js";
import { isSandboxV2Available } from "./v2-execution.js";
import type { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";

export type ExecutePatchExportV2Input = {
  request: CognitionPatchExportRequest;
  ownerId: string;
  messageEntityUuid?: string;
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  skipCapabilityGate?: boolean;
  registry?: V2ProjectReadRegistry;
  dispatcher?: SandboxV2Dispatcher;
  workspaceManager?: import("@composer-assistant/sandbox-v2").WorkspaceManager;
  envOverrides?: {
    sandboxEngineeringLifecycleEnabled?: boolean;
    sandboxAvailable?: () => boolean;
    registry?: V2ProjectReadRegistry;
  };
};

export type ExecutePatchExportV2Result = {
  license: OperationalClaimLicense;
};

function none(
  error: string,
  extras?: Partial<OperationalClaimLicense>,
  messageEntityUuid?: string,
): ExecutePatchExportV2Result {
  return {
    license: {
      state: ["witness_mismatch", "manifest_witness_mismatch", "export_pair_incomplete"].includes(error) ? "outcome_unknown" : "none",
      profile: "patch_export",
      error,
      ...(messageEntityUuid ? { sourceMessageEntityUuid: messageEntityUuid } : {}),
      ...extras,
    },
  };
}

export async function executePatchExportV2(
  input: ExecutePatchExportV2Input,
): Promise<ExecutePatchExportV2Result> {
  const { request, messageEntityUuid } = input;
  let taskId: string | undefined;

  if (request.adjudication !== "accept") {
    return none("thought_adjudication_required", { taskId }, messageEntityUuid);
  }

  if (input.db && !input.skipCapabilityGate) {
    try {
      if (!capabilityCanInfluence(input.db, "patch_export", input.masterMode)) {
        return none("patch_export_gate_denied", { taskId }, messageEntityUuid);
      }
    } catch {
      return none("patch_export_gate_denied", { taskId }, messageEntityUuid);
    }
  }

  const lifecycleEnabled =
    input.envOverrides?.sandboxEngineeringLifecycleEnabled !== undefined
      ? input.envOverrides.sandboxEngineeringLifecycleEnabled
      : env.sandboxEngineeringLifecycleEnabled;
  if (!lifecycleEnabled) {
    return none("sandbox_lifecycle_disabled", { taskId }, messageEntityUuid);
  }

  if (!input.ownerId) {
    return none("owner_id_required", { taskId }, messageEntityUuid);
  }

  const registry =
    input.registry ??
    input.envOverrides?.registry ??
    loadOperatorProjectReadRegistry();

  const resolved = registry.resolveReadRoot(request.projectId);
  if (!resolved.ok) {
    return none("patch_export_not_allowed", { taskId }, messageEntityUuid);
  }
  if (!isPatchExportAllowed(resolved.entry) || !resolved.entry.exportDestinationCanonicalRoot) {
    return none("patch_export_not_allowed", { taskId }, messageEntityUuid);
  }
  const destinationRoot = resolved.entry.exportDestinationCanonicalRoot;

  const isCustomSeam =
    input.dispatcher !== undefined ||
    input.envOverrides?.sandboxAvailable !== undefined;
  const substrateAvailable =
    input.envOverrides?.sandboxAvailable !== undefined
      ? input.envOverrides.sandboxAvailable()
      : isSandboxV2Available();
  if (!isCustomSeam && !substrateAvailable) {
    return none("sandbox_unavailable", { taskId }, messageEntityUuid);
  }

  if (!input.db) {
    return none("changeset_missing", { taskId }, messageEntityUuid);
  }

  const changeset = getChangeSet(input.db, request.changesetId);
  if (!changeset) {
    return none("changeset_missing", { taskId }, messageEntityUuid);
  }
  if (changeset.owner_id !== input.ownerId) {
    return none("changeset_not_exportable", { taskId }, messageEntityUuid);
  }
  if (changeset.project_id !== request.projectId) {
    return none("changeset_project_mismatch", { taskId }, messageEntityUuid);
  }
  if (
    changeset.status !== "proposed" ||
    !changeset.artifact_ref ||
    !changeset.patch_sha256
  ) {
    return none("changeset_not_exportable", { taskId }, messageEntityUuid);
  }
  if (input.workspaceManager?.isInquiryExperimentWorkspace(changeset.workspace_id)) {
    return none("inquiry_workspace_forbidden", { taskId }, messageEntityUuid);
  }
  if (!changeset.candidate_tree_hash) {
    return none("verification_receipt_required", { taskId }, messageEntityUuid);
  }
  const verificationReceipt = getSuccessfulVerificationReceiptForCandidate(input.db, {
    ownerId: input.ownerId,
    workspaceId: changeset.workspace_id,
    candidateTreeHash: changeset.candidate_tree_hash,
  });
  if (!verificationReceipt) {
    return none("verification_receipt_required", { taskId }, messageEntityUuid);
  }

  if (!changeset.base_commit || !changeset.base_tree_hash) return none("sealed_git_provenance_required", { taskId }, messageEntityUuid);
  const git = getSealedGitProvenance(input.db, { ownerId: input.ownerId, changesetId: request.changesetId,
    patchSha256: changeset.patch_sha256, candidateTreeHash: changeset.candidate_tree_hash,
    baseTreeHash: changeset.base_tree_hash, baseCommit: changeset.base_commit });
  if (!git) return none("sealed_git_provenance_required", { taskId }, messageEntityUuid);
  const manager = input.workspaceManager ?? new WorkspaceManager();
  const manifest = manager.getWorkspaceManifest(changeset.workspace_id);
  if (!manifest || manifest.projectId !== request.projectId || manifest.sourceSnapshotId !== changeset.source_snapshot_id) return none("recorded_base_required", { taskId }, messageEntityUuid);
  const base = validateRecordedGitBase({ sourceRoot: resolved.entry.canonicalRoot, workspaceRoot: join(manager.managedRoot, changeset.workspace_id),
    record: manifest.gitBase, workspaceId: changeset.workspace_id, projectId: request.projectId, sourceSnapshotId: changeset.source_snapshot_id });
  if (!base.ok) return none(base.error, { taskId }, messageEntityUuid);
  if (base.record.baseCommit !== git.baseCommit || base.record.sourceTree !== git.sourceGitTree || base.record.sanitizedTree !== git.baseGitTree) return none("recorded_base_mismatch", { taskId }, messageEntityUuid);
  let evidenceRefs: string[];
  try {
    const refs: unknown = JSON.parse(changeset.evidence_refs_json);
    if (!Array.isArray(refs) || !refs.every(ref => typeof ref === "string")) return none("manifest_binding_invalid", { taskId }, messageEntityUuid);
    evidenceRefs = refs;
  } catch { return none("manifest_binding_invalid", { taskId }, messageEntityUuid); }
  const manifestUtf8 = JSON.stringify({ version: 1, projectId: request.projectId, changesetId: request.changesetId,
    baseCommit: git.baseCommit, baseTree: git.sourceGitTree, sanitizedBaseTree: git.baseGitTree, candidateTree: git.candidateGitTree,
    candidateContentHash: changeset.candidate_tree_hash, rationale: changeset.rationale, evidenceRefs,
    // Existing reference ontology; these are Thought's declared refs, never a Host interpretation or verification claim.
    frictionRefs: evidenceRefs.filter(ref => ref.startsWith("friction:")),
    m4Receipt: { taskId: verificationReceipt.taskId, workspaceId: verificationReceipt.workspaceId,
      recipeId: verificationReceipt.recipeId, recipeVersion: verificationReceipt.recipeVersion,
      snapshotId: verificationReceipt.snapshotId, candidateTreeHash: verificationReceipt.candidateTreeHash,
      baseTreeHash: verificationReceipt.baseTreeHash, outcome: verificationReceipt.outcome,
      verificationOutcome: "verified_success", settledAt: verificationReceipt.settledAt }, patchSha256: changeset.patch_sha256 }) + "\n";
  const manifestSha256 = createHash("sha256").update(manifestUtf8, "utf8").digest("hex");
  taskId = `v2-export:${request.changesetId}:${changeset.patch_sha256}:${manifestSha256}`;

  try {
    const dispatcher =
      input.dispatcher ??
      new SandboxV2Dispatcher({
        env: {
          registry,
          workspaceManager: input.workspaceManager,
        },
      });

    const res: SandboxV2Result = await dispatcher.dispatch({
      version: 2,
      operation: "patch_export",
      projectId: request.projectId,
      changesetId: request.changesetId,
      artifactRef: changeset.artifact_ref,
      expectedSha256: changeset.patch_sha256,
      destinationRoot,
      manifestUtf8,
      expectedManifestSha256: manifestSha256,
    });

    const receipt =
      res.outcome === "succeeded" && isPatchExportResult(res.result)
        ? res.result
        : undefined;

    const error =
      res.outcome === "unavailable"
        ? (res.error ?? "sandbox_unavailable")
        : res.outcome === "failed"
          ? (res.error ?? "patch_export_failed")
          : receipt
            ? receipt.projectId === request.projectId && receipt.changesetId === request.changesetId
              && receipt.patchSha256 === changeset.patch_sha256 && receipt.witnessedSha256 === changeset.patch_sha256
              && receipt.artifactRef === changeset.artifact_ref
              && receipt.destinationPath === join(destinationRoot, `${request.changesetId}.patch`)
              && receipt.manifestSha256 === manifestSha256 && receipt.witnessedManifestSha256 === manifestSha256
              && receipt.manifestDestinationPath === join(destinationRoot, `${request.changesetId}.manifest.json`) ? null : "manifest_witness_mismatch"
            : "missing_receipt";

    const status =
      error && ["witness_mismatch", "manifest_witness_mismatch", "export_pair_incomplete"].includes(error)
        ? "outcome_unknown"
        : error
          ? "failed"
          : "succeeded";

    persistPatchExportRecord(input.db, {
      ownerId: input.ownerId,
      taskId,
      projectId: request.projectId,
      changesetId: request.changesetId,
      artifactRef: changeset.artifact_ref,
      destinationPath: receipt?.destinationPath ?? destinationRoot,
      expectedSha256: changeset.patch_sha256,
      witnessSha256: receipt?.witnessedSha256 ?? null,
      bytesWritten: receipt?.bytesWritten ?? null,
      status,
      errorCode: error,
    });

    if (!receipt || error) {
      return none(error ?? "patch_export_failed", { taskId }, messageEntityUuid);
    }

    const patchExportClaimEffect = {
      verified: true as const,
      projectId: receipt.projectId,
      changesetId: receipt.changesetId,
      destinationRelativeName: receipt.destinationRelativeName,
      patchSha256: receipt.patchSha256,
      witnessedSha256: receipt.witnessedSha256,
      manifestSha256: receipt.manifestSha256,
      witnessedManifestSha256: receipt.witnessedManifestSha256,
      manifestRelativeName: `${request.changesetId}.manifest.json`,
      bytesWritten: receipt.bytesWritten,
      applied: false as const,
      liveUnwritten: true as const,
      gitUnwritten: true as const,
      protocolState: "admitted" as const,
      witnessState: "digest_readback" as const,
      completedAtMs: receipt.completedAtMs,
    };
    if (!isVerifiedPatchExportClaimEffect(patchExportClaimEffect)) {
      return none("missing_receipt", { taskId }, messageEntityUuid);
    }

    return {
      license: {
        state: "succeeded",
        taskId,
        profile: "patch_export",
        patchExportClaimEffect,
        receiptRef: receipt.destinationRelativeName,
        executionTruth: "effect_verified",
        ...(messageEntityUuid ? { sourceMessageEntityUuid: messageEntityUuid } : {}),
      },
    };
  } catch {
    return none("internal_error", { taskId }, messageEntityUuid);
  }
}
