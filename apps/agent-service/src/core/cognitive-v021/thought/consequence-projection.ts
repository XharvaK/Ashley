import { isVerifiedVerificationClaimEffect, isVerifiedWorkspaceClaimEffect } from "../../sandbox/engineering-types.js";
import { mintEffectRef } from "../effect/effect-ref.js";
import type { InFlightRecord } from "../types.js";
import type { SocialAudience } from "../social/types.js";

export const CONSEQUENCE_AVAILABILITY = [
  "NOT_PROJECTED",
  "NOT_RETAINED",
  "RESTRICTED",
  "NOT_PRODUCED",
] as const;
export type ConsequenceAvailability = typeof CONSEQUENCE_AVAILABILITY[number];

export type ProjectedInFlightRecord = Readonly<{
  effectRef: string;
  operationKind?: string;
  operationKindAvailability?: ConsequenceAvailability;
  status: InFlightRecord["status"];
  receipt?: Readonly<{ outcome: NonNullable<InFlightRecord["receipt"]>["outcome"]; atMs: number }>;
  target?: Readonly<Record<string, string>>;
  targetAvailability?: ConsequenceAvailability;
  licensedProfile?: "candidate_verification";
  provenance?: Readonly<{
    receiptRef: string;
    snapshotId: string;
    recipeId: string;
    recipeVersion: string;
    recipeDefinitionHash: string;
  }>;
  material?: Readonly<{
    snapshotId: string;
    candidateTreeHash: string;
    recipeId: string;
    recipeVersion: string;
    recipeDefinitionHash: string;
    verificationOutcome: "verified_success" | "verified_failure";
    completedAtMs: number;
  }>;
  materialAvailability?: ConsequenceAvailability;
  developEvidence?: Readonly<{
    changedPath: string;
    operation: string;
    beforeSha256?: string;
    afterSha256?: string;
    bytesWritten?: number;
  }>;
  developEvidenceAvailability?: ConsequenceAvailability;
  verificationStatus?: "not_verified";
}>;

const TARGET_FIELDS = [
  "projectId",
  "workspaceId",
  "snapshotId",
  "recipeId",
  "candidateId",
  "path",
  "relativePath",
  "targetPath",
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedTarget(request: unknown): Record<string, string> | undefined {
  const source = record(request);
  if (!source) return undefined;
  const target: Record<string, string> = {};
  for (const key of TARGET_FIELDS) {
    const value = source[key];
    if (typeof value === "string" && value.trim() && [...value].length <= 256) {
      target[key] = value;
    }
  }
  return Object.keys(target).length > 0 ? target : undefined;
}

function hasRedactedMarker(value: unknown): boolean {
  return record(value)?.redacted === true;
}

function materialIsRestricted(item: InFlightRecord, audience: SocialAudience): boolean {
  const receipt = item.receipt;
  if (item.payloadRedacted || hasRedactedMarker(receipt?.claims)) return true;
  if (!receipt) return false;
  if (receipt.dataClassification === "secret") return true;
  return audience.kind !== "owner_private" && receipt.dataClassification === "never_public";
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || [...text].length > maxLength) return undefined;
  return text;
}

function boundedDigest(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text || text.length > 128) return undefined;
  return text;
}

function developEvidenceFromClaims(claims: Record<string, unknown> | undefined): {
  changedPath: string;
  operation: string;
  beforeSha256?: string;
  afterSha256?: string;
  bytesWritten?: number;
} | null {
  const raw = record(claims?.workspaceClaimEffect);
  if (!raw) return null;
  if (!isVerifiedWorkspaceClaimEffect(raw)) return null;
  const changedPath = boundedText(raw.logicalRelativePath, 256);
  const operation = boundedText(raw.operation, 64);
  if (!changedPath || !operation) return null;
  if (!operation.startsWith("workspace.")) return null;
  const evidence: {
    changedPath: string;
    operation: string;
    beforeSha256?: string;
    afterSha256?: string;
    bytesWritten?: number;
  } = { changedPath, operation };
  const before = boundedDigest(raw.beforeSha256);
  const after = boundedDigest(raw.afterSha256);
  if (before) evidence.beforeSha256 = before;
  if (after) evidence.afterSha256 = after;
  if (typeof raw.bytesWritten === "number" && Number.isFinite(raw.bytesWritten) && raw.bytesWritten >= 0) {
    evidence.bytesWritten = raw.bytesWritten;
  }
  return evidence;
}

/**
 * Project one retained effect consequence. Durable IDs and request bodies stay
 * host-side. Only the current cycle/generation ref and bounded licensed facts
 * can enter the model-visible projection.
 */
export function projectInFlightConsequence(
  item: InFlightRecord,
  cycleId: string,
  generation: number,
  audience: SocialAudience = { kind: "owner_private" },
): ProjectedInFlightRecord {
  const projected: {
    effectRef: string;
    operationKind?: string;
    operationKindAvailability?: ConsequenceAvailability;
    status: InFlightRecord["status"];
    receipt?: { outcome: NonNullable<InFlightRecord["receipt"]>["outcome"]; atMs: number };
    target?: Record<string, string>;
    targetAvailability?: ConsequenceAvailability;
    licensedProfile?: "candidate_verification";
    provenance?: {
      receiptRef: string;
      snapshotId: string;
      recipeId: string;
      recipeVersion: string;
      recipeDefinitionHash: string;
    };
    material?: {
      snapshotId: string;
      candidateTreeHash: string;
      recipeId: string;
      recipeVersion: string;
      recipeDefinitionHash: string;
      verificationOutcome: "verified_success" | "verified_failure";
      completedAtMs: number;
    };
    materialAvailability?: ConsequenceAvailability;
    developEvidence?: {
      changedPath: string;
      operation: string;
      beforeSha256?: string;
      afterSha256?: string;
      bytesWritten?: number;
    };
    developEvidenceAvailability?: ConsequenceAvailability;
    verificationStatus?: "not_verified";
  } = {
    effectRef: mintEffectRef(cycleId, generation, item.effectId),
    status: item.status,
  };

  if (item.operationKind) projected.operationKind = item.operationKind;
  else projected.operationKindAvailability = item.payloadRedacted ? "RESTRICTED" : "NOT_RETAINED";

  const receipt = item.receipt;
  if (receipt) projected.receipt = { outcome: receipt.outcome, atMs: receipt.atMs };
  if (item.payloadRedacted) projected.targetAvailability = "RESTRICTED";
  else {
    const target = boundedTarget(item.request);
    if (target) projected.target = target;
  }

  if (!receipt) return projected;

  const claims = receipt.claims;
  if (materialIsRestricted(item, audience)) {
    projected.materialAvailability = "RESTRICTED";
    return projected;
  }

  const claim = record(claims?.verificationClaimEffect);
  if (claims?.profile === "candidate_verification" && isVerifiedVerificationClaimEffect(claim)) {
    projected.licensedProfile = "candidate_verification";
    projected.target = {
      projectId: claim.projectId,
      workspaceId: claim.workspaceId,
    };
    projected.provenance = {
      receiptRef: receipt.receiptId,
      snapshotId: claim.snapshotId,
      recipeId: claim.recipeId,
      recipeVersion: claim.recipeVersion,
      recipeDefinitionHash: claim.recipeDefinitionHash,
    };
    projected.material = {
      snapshotId: claim.snapshotId,
      candidateTreeHash: claim.candidateTreeHash,
      recipeId: claim.recipeId,
      recipeVersion: claim.recipeVersion,
      recipeDefinitionHash: claim.recipeDefinitionHash,
      verificationOutcome: claim.verificationOutcome,
      completedAtMs: claim.completedAtMs,
    };
    delete projected.materialAvailability;
    delete projected.targetAvailability;
    return projected;
  }

  if (claims?.profile === "candidate_verification" || item.operationKind === "workspace.verify") {
    projected.materialAvailability = "NOT_PRODUCED";
  } else if (Object.keys(claims ?? {}).length > 0) {
    projected.materialAvailability = "NOT_PROJECTED";
  } else if (claims && hasRedactedMarker(claims)) {
    projected.materialAvailability = "RESTRICTED";
  }
  if (item.operationKind === "candidate.develop" && receipt.outcome === "succeeded") {
    const evidence = developEvidenceFromClaims(claims);
    if (evidence) {
      projected.developEvidence = evidence;
      projected.verificationStatus = "not_verified";
    } else {
      projected.developEvidenceAvailability = "NOT_PRODUCED";
    }
  }
  return projected;
}
