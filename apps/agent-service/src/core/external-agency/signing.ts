import { createHash, randomBytes } from "node:crypto";
import { EVALUATOR_BUILD_ID } from "./policy.js";
import type { ExternalActionKind, ExternalRiskClass } from "./types.js";

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortValue(record[key]);
    }
    return sorted;
  }
  return value;
}

export function policyDecisionHash(token: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(token)).digest("hex");
}

export function buildPolicyDecisionToken(input: {
  actionKind: ExternalActionKind | string;
  riskClass: ExternalRiskClass;
  destinationId: string;
  adapterId: string;
  capabilityReleaseState?: string;
  explicitDeny?: boolean;
  denyReason?: string;
  deniedActions?: string[];
}): Record<string, unknown> {
  return {
    actionKind: input.actionKind,
    riskClass: input.riskClass,
    destinationId: input.destinationId,
    adapterId: input.adapterId,
    capabilityReleaseState: input.capabilityReleaseState ?? "observe",
    explicitDeny: input.explicitDeny ?? false,
    denyReason: input.denyReason,
    deniedActions: input.deniedActions ?? [],
  };
}

export type PolicyAuthorizeEnvelopeLike = {
  protocolVersion: number;
  keyId: string;
  ownerId: string;
  scope: "external_policy_authorize";
  actionId: string;
  destinationId: string;
  accountRef: string;
  adapterId: string;
  actionKind: ExternalActionKind | string;
  riskClass: ExternalRiskClass;
  requestedScope: string[];
  payloadRef?: string;
  payloadHash?: string;
  policyContractId: string;
  policyContractHash: string;
  capabilityContractId: string;
  capabilityContractHash: string;
  capabilityReleaseId: string;
  evaluatorBuildId: string;
  classificationInputsHash: string;
  thoughtAuthorizationRefs?: string[];
  policyDecisionToken: Record<string, unknown>;
  policyDecisionHash: string;
  publicDisclosureResultHash?: string;
  idempotencyKey: string;
  expiresAt: number;
  nonce: string;
  signature?: string;
};

export function buildPolicyAuthorizeEnvelope(input: {
  ownerId: string;
  actionId: string;
  destinationId: string;
  accountRef: string;
  adapterId: string;
  actionKind: ExternalActionKind | string;
  riskClass: ExternalRiskClass;
  requestedScope?: string[];
  payloadRef?: string;
  payloadHash?: string;
  policyContractId?: string;
  policyContractHash?: string;
  capabilityContractId?: string;
  capabilityContractHash?: string;
  capabilityReleaseId?: string;
  classificationInputsHash?: string;
  thoughtAuthorizationRefs?: string[];
  publicDisclosureResultHash?: string;
  idempotencyKey: string;
  expiresAt?: number;
  capabilityReleaseState?: string;
  policyDecisionToken?: Record<string, unknown>;
}): PolicyAuthorizeEnvelopeLike {
  const policyDecisionToken =
    input.policyDecisionToken ??
    buildPolicyDecisionToken({
      actionKind: input.actionKind,
      riskClass: input.riskClass,
      destinationId: input.destinationId,
      adapterId: input.adapterId,
      capabilityReleaseState: input.capabilityReleaseState,
    });
  const now = Date.now();
  return {
    protocolVersion: 1,
    keyId: "policy-ed25519-v1",
    ownerId: input.ownerId,
    scope: "external_policy_authorize",
    actionId: input.actionId,
    destinationId: input.destinationId,
    accountRef: input.accountRef,
    adapterId: input.adapterId,
    actionKind: input.actionKind,
    riskClass: input.riskClass,
    requestedScope: input.requestedScope ?? ["read"],
    payloadRef: input.payloadRef,
    payloadHash: input.payloadHash,
    policyContractId: input.policyContractId ?? "policy-contract-v1",
    policyContractHash: input.policyContractHash ?? "pch-1",
    capabilityContractId: input.capabilityContractId ?? "ashley-capability-v3",
    capabilityContractHash: input.capabilityContractHash ?? "cch-1",
    capabilityReleaseId: input.capabilityReleaseId ?? "ashley-capability-v3",
    evaluatorBuildId: EVALUATOR_BUILD_ID,
    classificationInputsHash: input.classificationInputsHash ?? "cls-1",
    thoughtAuthorizationRefs: input.thoughtAuthorizationRefs,
    policyDecisionToken,
    policyDecisionHash: policyDecisionHash(policyDecisionToken),
    publicDisclosureResultHash: input.publicDisclosureResultHash,
    idempotencyKey: input.idempotencyKey,
    expiresAt: input.expiresAt ?? now + 60_000,
    nonce: randomBytes(16).toString("base64url"),
  };
}
