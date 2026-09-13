/**
 * M4 candidate-verification license mapping.
 *
 * A license may exist only after the verification executor completed, a
 * receipt exists, protocol state is admitted, and the outcome is a known
 * mechanical result (verified_success or verified_failure).
 *
 * This does not authorize quality, approval, merge, deployment, or
 * self-improvement claims.
 */

import { isWorkspaceVerifyResult } from "@composer-assistant/sandbox-v2";
import {
  isVerifiedVerificationClaimEffect,
  type OperationalClaimLicense,
  type VerificationClaimEffect,
} from "./engineering-types.js";

export type CandidateVerificationRequest = {
  projectId: string;
  workspaceId?: string;
  recipeId?: string;
};

export function issueCandidateVerificationLicense(input: {
  request: CandidateVerificationRequest;
  receipt: unknown;
  executedAtMs?: number;
  messageEntityUuid?: string;
  error?: string | null;
  taskId?: string;
}): OperationalClaimLicense {
  const base: OperationalClaimLicense = {
    state: "none",
    taskId: input.taskId?.trim() || `v2-verify-${input.executedAtMs ?? Date.now()}`,
    profile: "candidate_verification",
    error: input.error ?? null,
    ...(input.messageEntityUuid
      ? { sourceMessageEntityUuid: input.messageEntityUuid }
      : {}),
  };

  if (!isWorkspaceVerifyResult(input.receipt)) {
    return { ...base, error: input.error ?? "missing_receipt" };
  }

  const receipt = input.receipt;
  if (receipt.workspaceId !== input.request.workspaceId) {
    return { ...base, error: "mismatched_snapshot" };
  }
  if (receipt.projectId !== input.request.projectId) {
    return { ...base, error: "mismatched_snapshot" };
  }
  if (receipt.snapshotId.trim().length < 1) {
    return { ...base, error: "mismatched_snapshot" };
  }
  if (receipt.recipeId !== input.request.recipeId) {
    return { ...base, error: "mismatched_recipe" };
  }

  if (receipt.protocolState !== "admitted") {
    return {
      ...base,
      state: receipt.protocolState === "sandbox_failure" ? "failed" : "none",
      error: receipt.protocolState,
    };
  }

  if (receipt.verificationOutcome === "outcome_unknown") {
    return { ...base, state: "outcome_unknown", error: "outcome_unknown" };
  }
  if (
    receipt.verificationOutcome !== "verified_success" &&
    receipt.verificationOutcome !== "verified_failure"
  ) {
    return { ...base, error: "outcome_unknown" };
  }

  const verificationClaimEffect: VerificationClaimEffect = {
    verified: true,
    projectId: receipt.projectId,
    workspaceId: receipt.workspaceId,
    snapshotId: receipt.snapshotId,
    candidateTreeHash: receipt.candidateTreeHash,
    recipeId: receipt.recipeId,
    recipeVersion: receipt.recipeVersion,
    recipeDefinitionHash: receipt.recipeDefinitionHash,
    protocolState: "admitted",
    verificationOutcome: receipt.verificationOutcome,
    completedAtMs: input.executedAtMs ?? Date.now(),
  };

  if (!isVerifiedVerificationClaimEffect(verificationClaimEffect)) {
    return { ...base, error: "missing_receipt" };
  }

  return {
    state: "succeeded",
    taskId: base.taskId,
    profile: "candidate_verification",
    verificationClaimEffect,
    receiptRef: receipt.snapshotId,
    executionTruth: "effect_verified",
    ...(input.messageEntityUuid
      ? { sourceMessageEntityUuid: input.messageEntityUuid }
      : {}),
  };
}
