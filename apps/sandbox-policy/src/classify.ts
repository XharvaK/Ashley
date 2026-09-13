/**
 * Deterministic authoritative classification of a sandbox operation.
 *
 * The model's risk label is advisory only: it may raise the authoritative
 * result but can never lower it. Classification is a pure function of the
 * requested capability, its registry spec, the canonical target path, the
 * protected-root configuration, and declared operation facts (network,
 * external side effects, persistence).
 */

import {
  classifyProtectedPath,
  type ProtectedPathClass,
  type ProtectedRootsConfig,
} from "./protected-roots.js";
import { isCanonicalForm } from "./canonical-paths.js";
import {
  maxRisk,
  type SandboxCapabilityId,
  type SandboxPathIntent,
  type SandboxRiskClass,
} from "./types.js";

export type CapabilityClass =
  | "delegated_safe"
  | "owner_approvable"
  | "absolute_denial";

export type CapabilitySpec = {
  id: SandboxCapabilityId;
  class: CapabilityClass;
  allowedIntents: readonly SandboxPathIntent[];
  intrinsicRisk: SandboxRiskClass;
  networkRequired: boolean;
  externalSideEffects: boolean;
  secretExposure: boolean;
  recipeBound: boolean;
  executableBound: boolean;
  description: string;
};

const DELEGATED_SAFE_CAPABILITIES: readonly CapabilitySpec[] = [
  {
    id: "approved_project_read",
    class: "delegated_safe",
    allowedIntents: ["read"],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "read files inside an owner-approved project root",
  },
  {
    id: "approved_bounded_log_read",
    class: "delegated_safe",
    allowedIntents: ["read"],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "read bounded non-secret application logs",
  },
  {
    id: "local_health_status_inspection",
    class: "delegated_safe",
    allowedIntents: [],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "inspect local health and status endpoints",
  },
  {
    id: "fixed_test_recipe",
    class: "delegated_safe",
    allowedIntents: [],
    intrinsicRisk: "medium",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: true,
    executableBound: false,
    description: "run a fixed, policy-listed test recipe",
  },
  {
    id: "fixed_build_recipe",
    class: "delegated_safe",
    allowedIntents: [],
    intrinsicRisk: "medium",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: true,
    executableBound: false,
    description: "run a fixed, policy-listed build recipe",
  },
  {
    id: "fixed_lint_verification_recipe",
    class: "delegated_safe",
    allowedIntents: [],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: true,
    executableBound: false,
    description: "run a fixed lint or verification recipe",
  },
  {
    id: "candidate_workspace_create",
    class: "delegated_safe",
    allowedIntents: ["write"],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "create a sanitized disposable candidate workspace",
  },
  {
    id: "candidate_workspace_read_write_delete",
    class: "delegated_safe",
    allowedIntents: ["read", "write", "delete"],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "read, write and delete inside an approved disposable workspace",
  },
  {
    id: "candidate_patch_generate",
    class: "delegated_safe",
    allowedIntents: ["write"],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "generate candidate patches inside the disposable workspace",
  },
  {
    id: "candidate_report_artifact_generate",
    class: "delegated_safe",
    allowedIntents: ["write"],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "generate reports and artifacts inside the disposable workspace",
  },
  {
    id: "bounded_diagnostic_execution",
    class: "delegated_safe",
    allowedIntents: [],
    intrinsicRisk: "medium",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: true,
    description: "run a bounded, policy-listed diagnostic executable",
  },
  {
    id: "engineering_project_read",
    class: "delegated_safe",
    allowedIntents: ["read"],
    intrinsicRisk: "low",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description:
      "bounded read/list/search of an allowlisted project source tree, including read-only git inspection",
  },
  {
    id: "candidate_repository_git_write",
    class: "delegated_safe",
    allowedIntents: ["read", "write", "delete"],
    intrinsicRisk: "medium",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description:
      "local git metadata operations inside a sandbox-owned candidate clone only (status/diff/log/add/commit); push/fetch/remote-rewrite prohibited",
  },
];

const OWNER_APPROVABLE_CAPABILITIES: readonly CapabilitySpec[] = [
  {
    id: "apply_candidate_patch_live",
    class: "owner_approvable",
    allowedIntents: ["write"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "apply a candidate patch to the live checkout",
  },
  {
    id: "write_live_repository",
    class: "owner_approvable",
    allowedIntents: ["write"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "write files in the live repository",
  },
  {
    id: "modify_live_git_metadata",
    class: "owner_approvable",
    allowedIntents: ["write", "delete"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "modify live repository .git metadata",
  },
  {
    id: "commit_merge_workflow",
    class: "owner_approvable",
    allowedIntents: [],
    intrinsicRisk: "consultation",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "approved commit or merge workflow",
  },
  {
    id: "deployment",
    class: "owner_approvable",
    allowedIntents: [],
    intrinsicRisk: "consultation",
    networkRequired: true,
    externalSideEffects: true,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "deploy the project to a host",
  },
  {
    id: "service_restart_management",
    class: "owner_approvable",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: true,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "restart or manage services",
  },
  {
    id: "package_install_remove_upgrade",
    class: "owner_approvable",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: true,
    externalSideEffects: true,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "install, remove or upgrade packages",
  },
  {
    id: "production_configuration_change",
    class: "owner_approvable",
    allowedIntents: ["write"],
    intrinsicRisk: "consultation",
    networkRequired: false,
    externalSideEffects: true,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "change production configuration",
  },
  {
    id: "persistent_deletion",
    class: "owner_approvable",
    allowedIntents: ["delete"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "persistently delete data outside the disposable workspace",
  },
  {
    id: "authenticated_external_action",
    class: "owner_approvable",
    allowedIntents: [],
    intrinsicRisk: "consultation",
    networkRequired: true,
    externalSideEffects: true,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "perform an authenticated external action",
  },
  {
    id: "messaging_file_upload",
    class: "owner_approvable",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: true,
    externalSideEffects: true,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "send messages or upload files externally",
  },
  {
    id: "broader_network_effects",
    class: "owner_approvable",
    allowedIntents: [],
    intrinsicRisk: "consultation",
    networkRequired: true,
    externalSideEffects: true,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "operations with broader network effects",
  },
];

const ABSOLUTE_DENIAL_CAPABILITIES: readonly CapabilitySpec[] = [
  {
    id: "secret_extraction_transmission",
    class: "absolute_denial",
    allowedIntents: ["read"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: true,
    recipeBound: false,
    executableBound: false,
    description: "extract or transmit secrets",
  },
  {
    id: "credential_extraction",
    class: "absolute_denial",
    allowedIntents: ["read"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: true,
    recipeBound: false,
    executableBound: false,
    description: "extract API keys or credentials",
  },
  {
    id: "signing_key_access",
    class: "absolute_denial",
    allowedIntents: ["read", "write"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: true,
    recipeBound: false,
    executableBound: false,
    description: "access signing keys",
  },
  {
    id: "privilege_escalation",
    class: "absolute_denial",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "escalate privileges",
  },
  {
    id: "safeguard_weakening",
    class: "absolute_denial",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "weaken broker safeguards",
  },
  {
    id: "authorization_policy_modification",
    class: "absolute_denial",
    allowedIntents: ["write", "delete"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "modify the active authorization policy",
  },
  {
    id: "trusted_key_configuration_modification",
    class: "absolute_denial",
    allowedIntents: ["write", "delete"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "modify trusted-key configuration",
  },
  {
    id: "host_wiping",
    class: "absolute_denial",
    allowedIntents: ["write", "delete"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "wipe the host or devices",
  },
  {
    id: "destructive_system_operation",
    class: "absolute_denial",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "destructive system operations",
  },
  {
    id: "audit_log_concealment_tampering",
    class: "absolute_denial",
    allowedIntents: ["write", "delete"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "conceal or tamper with audit logs",
  },
  {
    id: "unrestricted_shell",
    class: "absolute_denial",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "unrestricted shell access",
  },
  {
    id: "unrelated_personal_file_access",
    class: "absolute_denial",
    allowedIntents: ["read", "write", "delete"],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "access unrelated personal files",
  },
  {
    id: "data_exfiltration",
    class: "absolute_denial",
    allowedIntents: ["read"],
    intrinsicRisk: "high",
    networkRequired: true,
    externalSideEffects: true,
    secretExposure: true,
    recipeBound: false,
    executableBound: false,
    description: "exfiltrate data",
  },
  {
    id: "controls_bypass",
    class: "absolute_denial",
    allowedIntents: [],
    intrinsicRisk: "high",
    networkRequired: false,
    externalSideEffects: false,
    secretExposure: false,
    recipeBound: false,
    executableBound: false,
    description: "bypass path, recipe, signer, policy or resource controls",
  },
];

export const SANDBOX_CAPABILITIES: readonly CapabilitySpec[] = [
  ...DELEGATED_SAFE_CAPABILITIES,
  ...OWNER_APPROVABLE_CAPABILITIES,
  ...ABSOLUTE_DENIAL_CAPABILITIES,
];

const BY_ID = new Map<string, CapabilitySpec>(
  SANDBOX_CAPABILITIES.map((spec) => [spec.id, spec]),
);

export function capabilitySpec(id: string): CapabilitySpec | undefined {
  return BY_ID.get(id);
}

const POLICY_INTERACTION_IDS = new Set<string>([
  "authorization_policy_modification",
  "trusted_key_configuration_modification",
]);

const SAFEGUARD_INTERACTION_IDS = new Set<string>([
  "safeguard_weakening",
  "controls_bypass",
  "audit_log_concealment_tampering",
]);

export type AuthoritativeOperationFacts = {
  capabilityId: string;
  capabilityClass: CapabilityClass | "unknown";
  intent: SandboxPathIntent | null;
  pathClass: ProtectedPathClass;
  pathMalformed: boolean;
  pathRequired: boolean;
  authoritativeRiskClass: SandboxRiskClass;
  secretExposure: boolean;
  networkRequired: boolean;
  externalSideEffects: boolean;
  policyInteraction: boolean;
  safeguardInteraction: boolean;
  liveCheckoutInteraction: boolean;
  absoluteDenialCondition: boolean;
  reason: string;
};

export function classifySandboxOperation(input: {
  capabilityId: string;
  intent?: SandboxPathIntent;
  targetPath?: string;
  protectedRoots?: ProtectedRootsConfig;
  modelRiskLabel?: SandboxRiskClass;
  networkRequired?: boolean;
  externalSideEffects?: boolean;
}): AuthoritativeOperationFacts {
  const spec = capabilitySpec(input.capabilityId);
  if (!spec) {
    return {
      capabilityId: input.capabilityId,
      capabilityClass: "unknown",
      intent: input.intent ?? null,
      pathClass: { class: "none" },
      pathMalformed: false,
      pathRequired: false,
      authoritativeRiskClass: "high",
      secretExposure: false,
      networkRequired: false,
      externalSideEffects: false,
      policyInteraction: false,
      safeguardInteraction: false,
      liveCheckoutInteraction: false,
      absoluteDenialCondition: false,
      reason: "unknown_capability",
    };
  }

  const protectedRoots: ProtectedRootsConfig = input.protectedRoots ?? {
    delegatedWriteDeniedOwnerApprovable: [],
    absoluteDenial: [],
  };

  let pathMalformed = false;
  let pathClass: ProtectedPathClass = { class: "none" };
  if (input.targetPath !== undefined) {
    pathMalformed = !isCanonicalForm(input.targetPath);
    if (!pathMalformed) {
      pathClass = classifyProtectedPath(protectedRoots, input.targetPath);
    }
  }
  const pathRequired =
    spec.allowedIntents.length > 0 && input.targetPath === undefined;

  const pathSecretExposure = pathClass.class === "absolute_denial";
  const secretExposure = spec.secretExposure || pathSecretExposure;
  const networkRequired =
    spec.networkRequired || input.networkRequired === true;
  const externalSideEffects =
    spec.externalSideEffects || input.externalSideEffects === true;
  const liveCheckoutInteraction =
    pathClass.class === "delegated_write_denied_owner_approvable";

  let authoritativeRiskClass: SandboxRiskClass = spec.intrinsicRisk;
  if (spec.class === "owner_approvable") {
    authoritativeRiskClass = "consultation";
  }
  if (networkRequired) {
    authoritativeRiskClass = "high";
  }
  if (externalSideEffects) {
    authoritativeRiskClass = "consultation";
  }
  if (
    (input.intent === "write" || input.intent === "delete") &&
    liveCheckoutInteraction
  ) {
    authoritativeRiskClass = "consultation";
  }
  if (spec.class === "absolute_denial" || pathSecretExposure || pathMalformed) {
    authoritativeRiskClass = "high";
  }
  authoritativeRiskClass = maxRisk(
    authoritativeRiskClass,
    input.modelRiskLabel ?? authoritativeRiskClass,
  );

  return {
    capabilityId: spec.id,
    capabilityClass: spec.class,
    intent: input.intent ?? null,
    pathClass,
    pathMalformed,
    pathRequired,
    authoritativeRiskClass,
    secretExposure,
    networkRequired,
    externalSideEffects,
    policyInteraction: POLICY_INTERACTION_IDS.has(spec.id),
    safeguardInteraction: SAFEGUARD_INTERACTION_IDS.has(spec.id),
    liveCheckoutInteraction,
    absoluteDenialCondition:
      spec.class === "absolute_denial" || pathSecretExposure,
    reason: spec.class,
  };
}
