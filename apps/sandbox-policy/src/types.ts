/**
 * Core vocabulary for the shared deterministic sandbox-policy module.
 *
 * This module is the policy-decision foundation shared by agent-service
 * (current projection) and sandbox-v2 (final execution). It is deterministic,
 * pure, dependency-free, free of model
 * or provider clients, free of command execution, free of filesystem
 * mutation, and free of secret access.
 *
 * Sandbox authorization never consults identity-governance state: approving
 * an identity proposal does not authorize sandbox execution, and sandbox
 * approval does not authorize identity revision.
 */

export type SandboxRiskClass = "low" | "medium" | "high" | "consultation";

export const SANDBOX_RISK_ORDER: Record<SandboxRiskClass, number> = {
  low: 0,
  medium: 1,
  high: 2,
  consultation: 3,
};

export function maxRisk(
  a: SandboxRiskClass,
  b: SandboxRiskClass,
): SandboxRiskClass {
  return SANDBOX_RISK_ORDER[a] >= SANDBOX_RISK_ORDER[b] ? a : b;
}

export type SandboxPathIntent = "read" | "write" | "delete";

export type ProtectedRootClass =
  | "delegated_write_denied_owner_approvable"
  | "absolute_denial";

export type SignerClass = "delegated" | "owner" | "unsigned";

export type SandboxSigner = {
  class: SignerClass;
  keyId: string | null;
};

/**
 * Typed capability identifiers. Unknown identifiers are rejected at runtime
 * by the capability registry and fail closed.
 */
export type SandboxCapabilityId =
  | "approved_project_read"
  | "approved_bounded_log_read"
  | "local_health_status_inspection"
  | "fixed_test_recipe"
  | "fixed_build_recipe"
  | "fixed_lint_verification_recipe"
  | "candidate_workspace_create"
  | "candidate_workspace_read_write_delete"
  | "candidate_patch_generate"
  | "candidate_report_artifact_generate"
  | "bounded_diagnostic_execution"
  | "engineering_project_read"
  | "candidate_repository_git_write"
  | "apply_candidate_patch_live"
  | "write_live_repository"
  | "modify_live_git_metadata"
  | "commit_merge_workflow"
  | "deployment"
  | "service_restart_management"
  | "package_install_remove_upgrade"
  | "production_configuration_change"
  | "persistent_deletion"
  | "authenticated_external_action"
  | "messaging_file_upload"
  | "broader_network_effects"
  | "secret_extraction_transmission"
  | "credential_extraction"
  | "signing_key_access"
  | "privilege_escalation"
  | "safeguard_weakening"
  | "authorization_policy_modification"
  | "trusted_key_configuration_modification"
  | "host_wiping"
  | "destructive_system_operation"
  | "audit_log_concealment_tampering"
  | "unrestricted_shell"
  | "unrelated_personal_file_access"
  | "data_exfiltration"
  | "controls_bypass";

export type SandboxAuthorizationDecision =
  | {
      decision: "autonomous_safe";
      capability: SandboxCapabilityId;
      policyRuleId: string;
      authoritativeRiskClass: SandboxRiskClass;
    }
  | {
      decision: "owner_approval_required";
      capability: SandboxCapabilityId;
      policyRuleId: string;
      authoritativeRiskClass: SandboxRiskClass;
      reason: string;
    }
  | {
      decision: "denied";
      capability: SandboxCapabilityId;
      policyRuleId: string;
      authoritativeRiskClass: SandboxRiskClass;
      reason: string;
    };
