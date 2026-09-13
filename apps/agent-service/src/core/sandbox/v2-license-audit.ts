/**
 * Sandbox V2 License Audit Discriminator.
 *
 * Emits a structured, bounded diagnostic record to the process/journal stream
 * at the Expression/honesty boundary when a V2 workspace file roundtrip or
 * project investigation license is processed.
 *
 * Contains safe operational metadata only; strictly avoids logging user messages,
 * prompts, environment values, secrets, file content, search match lines, or source payloads.
 */

import {
  isVerifiedRoundtripEffectEvidence,
  isVerifiedVerificationClaimEffect,
  isVerifiedAuthorshipClaimEffect,
  isVerifiedBoundedOperationClaimEffect,
  isVerifiedPatchExportClaimEffect,
  isVerifiedWorkspaceClaimEffect,
  type OperationalClaimLicense,
} from "./engineering-types.js";
import type {
  ProjectInspectionObservation,
  WorkspaceExperimentObservation,
} from "../types.js";

export type SandboxV2LicenseAuditRecord = {
  discriminator: "ASHLEY_SANDBOX_V2_LICENSE";
  sourceMessageEntityUuid: string | null;
  state: string;
  taskId: string | null;
  profile: string;
  verified: boolean;
  error: string | null;
  refusalReason: string | null;
  effect?: {
    readMatches: boolean;
    deleted: boolean;
    verifiedAbsent: boolean;
    bytesWritten: number;
  } | null;
  workspaceEffect?: {
    projectId: string;
    workspaceId: string;
    operation: string;
    logicalRelativePath: string;
    sourceSnapshotId: string;
    bytesRead?: number;
    bytesWritten?: number;
    beforeSha256?: string;
    afterSha256?: string;
  } | null;
  inspection?: {
    operation?: string;
    projectId?: string;
    targetPath?: string;
    targetPattern?: string;
    truncated?: boolean;
    bytes?: number;
    filesScanned?: number;
    matchCount?: number;
    entryCount?: number;
  } | null;
  verificationEffect?: {
    workspaceId: string;
    snapshotId: string;
    candidateTreeHash: string;
    recipeId: string;
    recipeVersion: string;
    recipeDefinitionHash: string;
    protocolState: string;
    verificationOutcome: string;
  } | null;
  authorshipEffect?: {
    workspaceId: string;
    changesetId: string;
    snapshotId: string;
    candidateTreeHash: string;
    baseTreeHash: string;
    pathCount: number;
    status: string;
    reviewStatus: string;
  } | null;
  boundedOperationEffect?: {
    workspaceId: string;
    stepsExecuted: number;
    maxSteps: number;
    stopReason: string;
    borderState: string;
  } | null;
  patchExportEffect?: {
    changesetId: string;
    destinationRelativeName: string;
    witnessedSha256: string;
    applied: false;
    liveUnwritten: true;
    gitUnwritten: true;
  } | null;
};

export function formatSandboxV2LicenseAudit(
  license?: OperationalClaimLicense | null,
  observation?: ProjectInspectionObservation | WorkspaceExperimentObservation | null,
): SandboxV2LicenseAuditRecord | null {
  if (!license) {
    return null;
  }
  if (
    license.profile !== "sandbox_workspace_file_roundtrip" &&
    license.profile !== "project_investigation" &&
    license.profile !== "project_experimentation" &&
    license.profile !== "candidate_verification" &&
    license.profile !== "candidate_authorship" &&
    license.profile !== "bounded_operation" &&
    license.profile !== "patch_export"
  ) {
    return null;
  }

  if (license.profile === "sandbox_workspace_file_roundtrip") {
    const verified = isVerifiedRoundtripEffectEvidence(license.effectEvidence);
    return {
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: license.sourceMessageEntityUuid ?? null,
      state: license.state,
      taskId: license.taskId ?? null,
      profile: license.profile,
      verified,
      error: license.error ?? null,
      refusalReason: license.refusalReason ?? null,
      effect: license.effectEvidence
        ? {
            readMatches: license.effectEvidence.readMatches === true,
            deleted: license.effectEvidence.deleted === true,
            verifiedAbsent: license.effectEvidence.verifiedAbsent === true,
            bytesWritten:
              typeof license.effectEvidence.bytesWritten === "number"
                ? license.effectEvidence.bytesWritten
                : 0,
          }
        : null,
    };
  }

  if (license.profile === "project_experimentation") {
    const verified =
      license.state === "succeeded" &&
      isVerifiedWorkspaceClaimEffect(license.workspaceClaimEffect);
    return {
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: license.sourceMessageEntityUuid ?? null,
      state: license.state,
      taskId: license.taskId ?? null,
      profile: license.profile,
      verified,
      error: license.error ?? null,
      refusalReason: license.refusalReason ?? null,
      effect: null,
      workspaceEffect: license.workspaceClaimEffect
        ? {
            projectId: license.workspaceClaimEffect.projectId,
            workspaceId: license.workspaceClaimEffect.workspaceId,
            operation: license.workspaceClaimEffect.operation,
            logicalRelativePath: license.workspaceClaimEffect.logicalRelativePath,
            sourceSnapshotId: license.workspaceClaimEffect.sourceSnapshotId,
            bytesRead: license.workspaceClaimEffect.bytesRead,
            bytesWritten: license.workspaceClaimEffect.bytesWritten,
            beforeSha256: license.workspaceClaimEffect.beforeSha256,
            afterSha256: license.workspaceClaimEffect.afterSha256,
          }
        : null,
      inspection: null,
    };
  }

  if (license.profile === "candidate_verification") {
    const verified = isVerifiedVerificationClaimEffect(license.verificationClaimEffect);
    return {
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: license.sourceMessageEntityUuid ?? null,
      state: license.state,
      taskId: license.taskId ?? null,
      profile: license.profile,
      verified,
      error: license.error ?? null,
      refusalReason: license.refusalReason ?? null,
      effect: null,
      workspaceEffect: null,
      inspection: null,
      verificationEffect: license.verificationClaimEffect
        ? {
            workspaceId: license.verificationClaimEffect.workspaceId,
            snapshotId: license.verificationClaimEffect.snapshotId,
            candidateTreeHash: license.verificationClaimEffect.candidateTreeHash,
            recipeId: license.verificationClaimEffect.recipeId,
            recipeVersion: license.verificationClaimEffect.recipeVersion,
            recipeDefinitionHash: license.verificationClaimEffect.recipeDefinitionHash,
            protocolState: license.verificationClaimEffect.protocolState,
            verificationOutcome: license.verificationClaimEffect.verificationOutcome,
          }
        : null,
    };
  }

  if (license.profile === "candidate_authorship") {
    const verified = isVerifiedAuthorshipClaimEffect(license.authorshipClaimEffect);
    return {
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: license.sourceMessageEntityUuid ?? null,
      state: license.state,
      taskId: license.taskId ?? null,
      profile: license.profile,
      verified,
      error: license.error ?? null,
      refusalReason: license.refusalReason ?? null,
      effect: null,
      workspaceEffect: null,
      inspection: null,
      verificationEffect: null,
      authorshipEffect: license.authorshipClaimEffect
        ? {
            workspaceId: license.authorshipClaimEffect.workspaceId,
            changesetId: license.authorshipClaimEffect.changesetId,
            snapshotId: license.authorshipClaimEffect.snapshotId,
            candidateTreeHash: license.authorshipClaimEffect.candidateTreeHash,
            baseTreeHash: license.authorshipClaimEffect.baseTreeHash,
            pathCount: license.authorshipClaimEffect.pathCount,
            status: license.authorshipClaimEffect.status,
            reviewStatus: license.authorshipClaimEffect.reviewStatus,
          }
        : null,
    };
  }

  if (license.profile === "bounded_operation") {
    const verified = isVerifiedBoundedOperationClaimEffect(license.boundedOperationClaimEffect);
    return {
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: license.sourceMessageEntityUuid ?? null,
      state: license.state,
      taskId: license.taskId ?? null,
      profile: license.profile,
      verified,
      error: license.error ?? null,
      refusalReason: license.refusalReason ?? null,
      effect: null,
      workspaceEffect: null,
      inspection: null,
      verificationEffect: null,
      authorshipEffect: null,
      boundedOperationEffect: license.boundedOperationClaimEffect
        ? {
            workspaceId: license.boundedOperationClaimEffect.workspaceId,
            stepsExecuted: license.boundedOperationClaimEffect.stepsExecuted,
            maxSteps: license.boundedOperationClaimEffect.maxSteps,
            stopReason: license.boundedOperationClaimEffect.stopReason,
            borderState: license.boundedOperationClaimEffect.borderState,
          }
        : null,
    };
  }

  if (license.profile === "patch_export") {
    const verified = isVerifiedPatchExportClaimEffect(license.patchExportClaimEffect);
    return {
      discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
      sourceMessageEntityUuid: license.sourceMessageEntityUuid ?? null,
      state: license.state,
      taskId: license.taskId ?? null,
      profile: license.profile,
      verified,
      error: license.error ?? null,
      refusalReason: license.refusalReason ?? null,
      effect: null,
      workspaceEffect: null,
      inspection: null,
      verificationEffect: null,
      authorshipEffect: null,
      boundedOperationEffect: null,
      patchExportEffect: license.patchExportClaimEffect
        ? {
            changesetId: license.patchExportClaimEffect.changesetId,
            destinationRelativeName: license.patchExportClaimEffect.destinationRelativeName,
            witnessedSha256: license.patchExportClaimEffect.witnessedSha256,
            applied: false,
            liveUnwritten: true,
            gitUnwritten: true,
          }
        : null,
    };
  }

  // profile === "project_investigation"
  const obs = observation && "kind" in observation && observation.kind === "workspace_experiment_observation" ? null : (observation as ProjectInspectionObservation | null);
  const verified = license.state === "succeeded" && obs?.verified === true;
  let inspectionMeta: SandboxV2LicenseAuditRecord["inspection"] = null;
  if (obs) {
    inspectionMeta = {
      operation: obs.operation,
      projectId: obs.projectId,
      targetPath: obs.path,
      targetPattern:
        obs.operation === "project.search_text"
          ? obs.pattern
          : undefined,
      truncated: obs.truncated,
      bytes:
        obs.operation === "project.read_file"
          ? obs.bytes
          : undefined,
      filesScanned:
        obs.operation === "project.search_text"
          ? obs.filesScanned
          : undefined,
      matchCount:
        obs.operation === "project.search_text"
          ? obs.matches.length
          : undefined,
      entryCount:
        obs.operation === "project.list_directory"
          ? obs.entries.length
          : undefined,
    };
  }

  return {
    discriminator: "ASHLEY_SANDBOX_V2_LICENSE",
    sourceMessageEntityUuid: license.sourceMessageEntityUuid ?? null,
    state: license.state,
    taskId: license.taskId ?? null,
    profile: license.profile,
    verified,
    error: license.error ?? null,
    refusalReason: license.refusalReason ?? null,
    effect: null,
    inspection: inspectionMeta,
  };
}

export function emitSandboxV2LicenseAudit(
  license?: OperationalClaimLicense | null,
  observationOrSink?: ProjectInspectionObservation | WorkspaceExperimentObservation | null | ((msg: string) => void),
  maybeSink?: (msg: string) => void,
): void {
  let observation: ProjectInspectionObservation | WorkspaceExperimentObservation | null = null;
  let sink: (msg: string) => void = console.info;

  if (typeof observationOrSink === "function") {
    sink = observationOrSink;
  } else if (observationOrSink !== undefined) {
    observation = observationOrSink;
    if (maybeSink) sink = maybeSink;
  }
  const record = formatSandboxV2LicenseAudit(license, observation);
  if (!record) return;
  sink(`[ASHLEY_SANDBOX_V2_LICENSE] ${JSON.stringify(record)}`);
}
