import type { DatabaseSync } from "node:sqlite";
import {
  capabilityCanInfluence,
  type CapabilityName,
} from "../rollout/capabilities.js";
import { getEmergencyStop } from "./emergency-stop.js";
import type { ExternalActionKind, ExternalRiskClass } from "./types.js";
import { HARD_DENY_ACTION_KINDS } from "./types.js";

export const EVALUATOR_BUILD_ID = "external-evaluator-v1";

export type ExternalActionPolicyInput = {
  db: DatabaseSync;
  ownerId: string;
  actionKind: ExternalActionKind | string;
  riskClass: ExternalRiskClass;
  destinationId: string;
  adapterId: string;
  policyDecisionHash?: string | null;
  policyAuthorizationRef?: string | null;
  ownerApprovalRef?: string | null;
  publicDisclosureResultHash?: string | null;
  docDecision?: string | null;
};

export type ExternalActionPolicyResult = {
  allowed: boolean;
  reason: string;
  capability: CapabilityName;
};

function capabilityForRisk(riskClass: ExternalRiskClass): CapabilityName {
  switch (riskClass) {
    case "observe":
      return "external_observe";
    case "prepare":
      return "external_prepare";
    case "reversible_private":
      return "external_private";
    case "public":
    case "irreversible":
      return "external_public";
    default: {
      const _exhaustive: never = riskClass;
      return _exhaustive;
    }
  }
}

export function docDecisionAuthorizesExternalDispatch(
  _decision: string | null | undefined,
): boolean {
  return false;
}

export function evaluateExternalActionPolicy(
  input: ExternalActionPolicyInput,
): ExternalActionPolicyResult {
  const capability = capabilityForRisk(input.riskClass);

  if (HARD_DENY_ACTION_KINDS.includes(input.actionKind as (typeof HARD_DENY_ACTION_KINDS)[number])) {
    return { allowed: false, reason: "hard_deny_lifecycle", capability };
  }

  if (getEmergencyStop(input.db, input.ownerId)) {
    return { allowed: false, reason: "emergency_stop_active", capability };
  }

  if (docDecisionAuthorizesExternalDispatch(input.docDecision)) {
    return { allowed: false, reason: "doc_decision_not_dispatch_authority", capability };
  }

  if (!input.policyDecisionHash || !input.policyAuthorizationRef) {
    return { allowed: false, reason: "unsigned_policy_authorization", capability };
  }

  if (input.riskClass === "irreversible") {
    return { allowed: false, reason: "irreversible_denied_by_default", capability };
  }

  if (
    (input.riskClass === "reversible_private" || input.riskClass === "public") &&
    !input.ownerApprovalRef
  ) {
    return { allowed: false, reason: "owner_approval_required", capability };
  }

  if (input.riskClass === "public" && !input.publicDisclosureResultHash) {
    return { allowed: false, reason: "public_disclosure_required", capability };
  }

  if (!capabilityCanInfluence(input.db, capability)) {
    return { allowed: false, reason: "capability_not_active", capability };
  }

  return { allowed: true, reason: "ok", capability };
}
