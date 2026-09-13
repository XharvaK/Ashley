/**
 * Authoritative sandbox authorization.
 *
 * Flow contract: the language model never authorizes or signs an operation.
 * Model output is an untrusted proposal. This module computes the decision
 * for a request that is assumed to be (or to become) properly signed by the
 * identified signer: agent-service uses it for preliminary validation and
 * policy precheck; the broker recomputes it independently and is the final
 * authority. Signature verification, signer mapping and trusted-key
 * configuration are broker-integration concerns outside this module.
 *
 * The owner may not override an absolute denial, and identity proposal
 * approval never authorizes sandbox execution.
 */

import { classifySandboxOperation, capabilitySpec } from "./classify.js";
import { isWithinAny } from "./canonical-paths.js";
import {
  protectedConflictForIntent,
  toProtectedRootsConfig,
  type ProtectedRootsConfig,
} from "./protected-roots.js";
import { validateSandboxPolicyDocument } from "./policy-schema.js";
import type {
  SandboxAuthorizationDecision,
  SandboxCapabilityId,
  SandboxPathIntent,
  SandboxRiskClass,
  SandboxSigner,
} from "./types.js";
import type { ResourceCeilings, SandboxPolicyDocument } from "./policy-schema.js";

export type SandboxAuthorizeInput = {
  capabilityId: SandboxCapabilityId;
  policy: SandboxPolicyDocument | null;
  signer: SandboxSigner;
  intent?: SandboxPathIntent;
  targetPath?: string;
  recipeId?: string;
  executableId?: string;
  networkRequired?: boolean;
  externalSideEffects?: boolean;
  persistence?: boolean;
  modelRiskLabel?: SandboxRiskClass;
  requestedLimits?: Partial<ResourceCeilings>;
  nowIso: string;
};

export function rule(ruleId: string): string {
  return `sandbox-policy/rule/${ruleId}`;
}

function denied(
  ruleId: string,
  reason: string,
  capabilityId: string,
  riskClass: SandboxRiskClass,
): SandboxAuthorizationDecision {
  return {
    decision: "denied",
    capability: capabilityId as SandboxCapabilityId,
    policyRuleId: rule(ruleId),
    authoritativeRiskClass: riskClass,
    reason,
  };
}

function ownerApproval(
  ruleId: string,
  reason: string,
  capabilityId: string,
  riskClass: SandboxRiskClass,
): SandboxAuthorizationDecision {
  return {
    decision: "owner_approval_required",
    capability: capabilityId as SandboxCapabilityId,
    policyRuleId: rule(ruleId),
    authoritativeRiskClass: riskClass,
    reason,
  };
}

function nowMs(nowIso: string): number | null {
  const ms = Date.parse(nowIso);
  return Number.isNaN(ms) ? null : ms;
}

function exceedsCeilings(
  ceilings: ResourceCeilings,
  requested: Partial<ResourceCeilings>,
): boolean {
  if (requested.wallMsMax !== undefined && requested.wallMsMax > ceilings.wallMsMax) {
    return true;
  }
  if (
    requested.maxProcesses !== undefined &&
    requested.maxProcesses > ceilings.maxProcesses
  ) {
    return true;
  }
  if (
    requested.maxOutputBytes !== undefined &&
    requested.maxOutputBytes > ceilings.maxOutputBytes
  ) {
    return true;
  }
  if (
    requested.workspaceBytesMax !== undefined &&
    requested.workspaceBytesMax > ceilings.workspaceBytesMax
  ) {
    return true;
  }
  return false;
}

export function authorizeSandboxOperation(
  input: SandboxAuthorizeInput,
): SandboxAuthorizationDecision {
  const fallbackRisk = (): SandboxRiskClass => {
    const spec = capabilitySpec(input.capabilityId);
    if (!spec) return "high";
    return spec.class === "owner_approvable" ? "consultation" : spec.intrinsicRisk;
  };

  if (input.policy === null) {
    return denied("policy-missing", "no_active_policy", input.capabilityId, fallbackRisk());
  }
  const validated = validateSandboxPolicyDocument(input.policy);
  if (!validated.ok) {
    return denied("policy-invalid", "invalid_policy", input.capabilityId, fallbackRisk());
  }
  const doc = validated.policy;

  const now = nowMs(input.nowIso);
  if (now === null) {
    return denied("invalid-clock", "invalid_now_iso", input.capabilityId, fallbackRisk());
  }
  if (doc.expiresAt !== undefined && Date.parse(doc.expiresAt) < now) {
    return denied("policy-expired", "policy_expired", input.capabilityId, fallbackRisk());
  }
  if (Date.parse(doc.issuedAt) > now) {
    return denied("policy-not-yet-valid", "policy_not_yet_valid", input.capabilityId, fallbackRisk());
  }

  if (
    input.signer.class === "delegated" &&
    (input.signer.keyId === null ||
      !doc.allowedDelegatedSignerKeyIds.includes(input.signer.keyId))
  ) {
    return denied(
      "signer-not-allowed",
      "delegated_signer_key_not_allowed_by_policy",
      input.capabilityId,
      fallbackRisk(),
    );
  }

  const protectedRoots: ProtectedRootsConfig = toProtectedRootsConfig(
    doc.protectedRoots,
  );
  const facts = classifySandboxOperation({
    capabilityId: input.capabilityId,
    intent: input.intent,
    targetPath: input.targetPath,
    protectedRoots,
    modelRiskLabel: input.modelRiskLabel,
    networkRequired: input.networkRequired,
    externalSideEffects: input.externalSideEffects,
  });
  const spec = capabilitySpec(input.capabilityId);

  if (facts.absoluteDenialCondition) {
    return denied("absolute-denial", "absolute_denial", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (facts.capabilityClass === "unknown") {
    return denied("unknown-capability", "unknown_capability", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (facts.pathMalformed) {
    return denied("path-malformed", "path_not_canonical", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (facts.pathRequired) {
    return denied("path-required", "target_path_required", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (facts.capabilityClass === "owner_approvable") {
    return ownerApproval(
      "owner-approval-required",
      "owner_approval_required_for_capability",
      facts.capabilityId,
      facts.authoritativeRiskClass,
    );
  }

  if (!doc.allowedCapabilities.includes(input.capabilityId)) {
    return denied("capability-not-allowed", "capability_not_allowed_by_policy", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (input.intent !== undefined && !spec!.allowedIntents.includes(input.intent)) {
    return denied("intent-not-permitted", "intent_not_permitted_by_capability", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (spec!.recipeBound) {
    if (input.recipeId === undefined || !doc.allowedRecipeIds.includes(input.recipeId)) {
      return denied("recipe-not-allowed", "recipe_not_allowed_by_policy", facts.capabilityId, facts.authoritativeRiskClass);
    }
  }
  if (spec!.executableBound) {
    if (input.executableId === undefined || !doc.allowedExecutableIds.includes(input.executableId)) {
      return denied("executable-not-allowed", "executable_not_allowed_by_policy", facts.capabilityId, facts.authoritativeRiskClass);
    }
  }

  if (input.targetPath !== undefined && input.intent !== undefined) {
    const conflict = protectedConflictForIntent(
      protectedRoots,
      input.targetPath,
      input.intent,
    );
    if (conflict.conflict && conflict.rootClass === "absolute_denial") {
      return denied("absolute-denial", "absolute_denial", facts.capabilityId, facts.authoritativeRiskClass);
    }
    if (
      conflict.conflict &&
      conflict.rootClass === "delegated_write_denied_owner_approvable"
    ) {
      return ownerApproval(
        "owner-approval-escalated",
        "delegated_write_denied_root_requires_owner_approval",
        facts.capabilityId,
        facts.authoritativeRiskClass,
      );
    }
    const readPermitted =
      isWithinAny(doc.readOnlyRoots, input.targetPath) ||
      isWithinAny(doc.writableDisposableRoots, input.targetPath);
    const writeDeletePermitted = isWithinAny(
      doc.writableDisposableRoots,
      input.targetPath,
    );
    const pathPermitted =
      input.intent === "read" ? readPermitted : writeDeletePermitted;
    if (!pathPermitted) {
      return denied("path-not-permitted", "path_outside_permitted_roots", facts.capabilityId, facts.authoritativeRiskClass);
    }
    if (
      input.persistence === true &&
      !isWithinAny(doc.writableDisposableRoots, input.targetPath)
    ) {
      return denied("persistence-outside-disposable", "persistence_requires_disposable_root", facts.capabilityId, facts.authoritativeRiskClass);
    }
  } else if (
    input.targetPath !== undefined &&
    input.intent === undefined &&
    spec!.allowedIntents.length > 0
  ) {
    return denied("intent-required", "path_intent_required", facts.capabilityId, facts.authoritativeRiskClass);
  } else if (
    input.targetPath !== undefined &&
    spec!.allowedIntents.length === 0
  ) {
    const withinDisposable = isWithinAny(doc.writableDisposableRoots, input.targetPath);
    if (!withinDisposable) {
      return denied("path-not-permitted", "recipe_working_directory_outside_disposable_root", facts.capabilityId, facts.authoritativeRiskClass);
    }
  }

  if (facts.networkRequired) {
    return denied("network-required", "network_required_not_delegated_safe", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (facts.externalSideEffects) {
    return denied("external-effects", "external_side_effects_not_delegated_safe", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (facts.secretExposure) {
    return denied("secret-exposure", "secret_exposure_denied", facts.capabilityId, facts.authoritativeRiskClass);
  }
  if (
    input.requestedLimits !== undefined &&
    exceedsCeilings(doc.resourceCeilings, input.requestedLimits)
  ) {
    return denied("resource-ceiling-exceeded", "request_exceeds_policy_ceiling", facts.capabilityId, facts.authoritativeRiskClass);
  }

  return {
    decision: "autonomous_safe",
    capability: facts.capabilityId as SandboxCapabilityId,
    policyRuleId: rule("delegated-autonomy"),
    authoritativeRiskClass: facts.authoritativeRiskClass,
  };
}
