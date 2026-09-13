/**
 * M7 patch_export adapter. Capability, destination grant, and sealed M5
 * artifact identity are independent. This copies a sealed patch to the
 * operator review location. It does not apply, merge, commit, or deploy.
 */

import { isPatchExportAllowed } from "@composer-assistant/sandbox-policy";
import {
  isPatchExportResult,
  SandboxV2Dispatcher,
  type SandboxV2Result,
} from "@composer-assistant/sandbox-v2";
import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import type { CognitionMode, CognitionPatchExportRequest } from "../types.js";
import {
  isVerifiedPatchExportClaimEffect,
  type OperationalClaimLicense,
} from "./engineering-types.js";
import { persistPatchExportRecord } from "./patch-export-store.js";
import { getChangeSet } from "./changeset-store.js";
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
      state: error === "witness_mismatch" ? "outcome_unknown" : "none",
      taskId: extras?.taskId ?? `v2-export-${Date.now()}`,
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
  const taskId = `v2-export-${Date.now()}`;

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

  try {
    const dispatcher =
      input.dispatcher ??
      new SandboxV2Dispatcher({
        env: {
          registry,
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
            ? null
            : "missing_receipt";

    const status =
      error === "witness_mismatch"
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
