/**
 * M5 candidate-authorship license mapping.
 *
 * A license may exist only after a CandidateChangeSet was sealed, a receipt
 * exists, protocol state is admitted, and candidate/live trees are unchanged.
 * This does not authorize apply, merge, deployment, or self-change.
 */

import { isChangesetAuthorResult } from "@composer-assistant/sandbox-v2";
import {
  isVerifiedAuthorshipClaimEffect,
  type AuthorshipClaimEffect,
  type OperationalClaimLicense,
} from "./engineering-types.js";

export type CandidateAuthorshipRequest = {
  projectId: string;
  workspaceId: string;
};

export function issueCandidateAuthorshipLicense(input: {
  request: CandidateAuthorshipRequest;
  receipt: unknown;
  executedAtMs?: number;
  messageEntityUuid?: string;
  error?: string | null;
  status?: "proposed";
  reviewStatus?: "submitted";
  taskId?: string;
}): OperationalClaimLicense {
  const base: OperationalClaimLicense = {
    state: "none",
    taskId: input.taskId?.trim() || `v2-author-${input.executedAtMs ?? Date.now()}`,
    profile: "candidate_authorship",
    error: input.error ?? null,
    ...(input.messageEntityUuid
      ? { sourceMessageEntityUuid: input.messageEntityUuid }
      : {}),
  };

  if (!isChangesetAuthorResult(input.receipt)) {
    return { ...base, error: input.error ?? "missing_receipt" };
  }

  const receipt = input.receipt;
  if (receipt.workspaceId !== input.request.workspaceId) {
    return { ...base, error: "mismatched_snapshot" };
  }
  if (receipt.projectId !== input.request.projectId) {
    return { ...base, error: "mismatched_snapshot" };
  }
  if (receipt.candidateUnchanged !== true || receipt.liveUnwritten !== true) {
    return { ...base, error: "mutation_detected" };
  }
  if (receipt.protocolState !== "admitted") {
    return { ...base, state: "failed", error: receipt.protocolState };
  }

  const authorshipClaimEffect: AuthorshipClaimEffect = {
    verified: true,
    projectId: receipt.projectId,
    workspaceId: receipt.workspaceId,
    changesetId: receipt.changesetId,
    changesetVersion: 1,
    snapshotId: receipt.snapshotId,
    candidateTreeHash: receipt.candidateTreeHash,
    baseTreeHash: receipt.baseTreeHash,
    pathCount: receipt.changedPaths.length,
    patchSha256: receipt.patchSha256,
    status: "proposed",
    reviewStatus: "submitted",
    candidateUnchanged: true,
    liveUnwritten: true,
    protocolState: "admitted",
    completedAtMs: input.executedAtMs ?? Date.now(),
  };

  if (!isVerifiedAuthorshipClaimEffect(authorshipClaimEffect)) {
    return { ...base, error: "missing_receipt" };
  }

  return {
    state: "succeeded",
    taskId: base.taskId,
    profile: "candidate_authorship",
    authorshipClaimEffect,
    receiptRef: receipt.changesetId,
    executionTruth: "no_effect_proven",
    ...(input.messageEntityUuid
      ? { sourceMessageEntityUuid: input.messageEntityUuid }
      : {}),
  };
}
