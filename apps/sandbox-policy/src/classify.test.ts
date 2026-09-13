import { describe, expect, it } from "vitest";
import {
  classifySandboxOperation,
  capabilitySpec,
  SANDBOX_CAPABILITIES,
} from "./classify.js";
import { toProtectedRootsConfig } from "./protected-roots.js";
import type { ProtectedRootsConfig } from "./protected-roots.js";

const NO_ROOTS: ProtectedRootsConfig = {
  delegatedWriteDeniedOwnerApprovable: [],
  absoluteDenial: [],
};

const LIVE_ROOTS: ProtectedRootsConfig = toProtectedRootsConfig([
  { path: "/srv/ashley/live-checkout", class: "delegated_write_denied_owner_approvable" },
  { path: "/home/doc/.composer-assistant/.env", class: "absolute_denial" },
  { path: "/var/lib/ashley-sandbox/meta/keys", class: "absolute_denial" },
]);

function classify(input: {
  capabilityId: string;
  intent?: "read" | "write" | "delete";
  targetPath?: string;
  protectedRoots?: ProtectedRootsConfig;
  modelRiskLabel?: "low" | "medium" | "high" | "consultation";
  networkRequired?: boolean;
  externalSideEffects?: boolean;
}) {
  return classifySandboxOperation({ protectedRoots: LIVE_ROOTS, ...input });
}

describe("classifySandboxOperation", () => {
  it("classifies the 11 delegated-safe capabilities as such", () => {
    const ids = [
      "approved_project_read",
      "approved_bounded_log_read",
      "local_health_status_inspection",
      "fixed_test_recipe",
      "fixed_build_recipe",
      "fixed_lint_verification_recipe",
      "candidate_workspace_create",
      "candidate_workspace_read_write_delete",
      "candidate_patch_generate",
      "candidate_report_artifact_generate",
      "bounded_diagnostic_execution",
    ];
    for (const id of ids) {
      const facts = classify({ capabilityId: id });
      expect(facts.capabilityClass, id).toBe("delegated_safe");
    }
  });

  it("classifies the 12 owner-approvable capabilities as such", () => {
    const ids = [
      "apply_candidate_patch_live",
      "write_live_repository",
      "modify_live_git_metadata",
      "commit_merge_workflow",
      "deployment",
      "service_restart_management",
      "package_install_remove_upgrade",
      "production_configuration_change",
      "persistent_deletion",
      "authenticated_external_action",
      "messaging_file_upload",
      "broader_network_effects",
    ];
    for (const id of ids) {
      const facts = classify({ capabilityId: id });
      expect(facts.capabilityClass, id).toBe("owner_approvable");
      expect(facts.authoritativeRiskClass, id).toBe("consultation");
    }
  });

  it("classifies the 14 absolute-denial capabilities as such", () => {
    const ids = [
      "secret_extraction_transmission",
      "credential_extraction",
      "signing_key_access",
      "privilege_escalation",
      "safeguard_weakening",
      "authorization_policy_modification",
      "trusted_key_configuration_modification",
      "host_wiping",
      "destructive_system_operation",
      "audit_log_concealment_tampering",
      "unrestricted_shell",
      "unrelated_personal_file_access",
      "data_exfiltration",
      "controls_bypass",
    ];
    for (const id of ids) {
      const facts = classify({ capabilityId: id });
      expect(facts.capabilityClass, id).toBe("absolute_denial");
      expect(facts.absoluteDenialCondition, id).toBe(true);
      expect(facts.authoritativeRiskClass, id).toBe("high");
    }
  });

  it("fails closed with class unknown for an unrecognized capability", () => {
    const facts = classify({ capabilityId: "not_a_real_capability" });
    expect(facts.capabilityClass).toBe("unknown");
    expect(facts.absoluteDenialCondition).toBe(false);
    expect(facts.authoritativeRiskClass).toBe("high");
  });

  it("flags an absolute-denial path as secret exposure even for reads", () => {
    const facts = classify({
      capabilityId: "approved_project_read",
      intent: "read",
      targetPath: "/home/doc/.composer-assistant/.env",
    });
    expect(facts.absoluteDenialCondition).toBe(true);
    expect(facts.secretExposure).toBe(true);
    expect(facts.authoritativeRiskClass).toBe("high");
  });

  it("flags a non-canonical path as malformed", () => {
    const facts = classify({
      capabilityId: "approved_project_read",
      intent: "read",
      targetPath: "/srv/ashley/live-checkout/../etc/passwd",
    });
    expect(facts.pathMalformed).toBe(true);
    expect(facts.authoritativeRiskClass).toBe("high");
  });

  it("requires a path for path-based capabilities", () => {
    const facts = classify({ capabilityId: "approved_project_read", intent: "read" });
    expect(facts.pathRequired).toBe(true);
  });

  it("model risk label can only raise the authoritative risk class", () => {
    const baseline = classify({ capabilityId: "bounded_diagnostic_execution" });
    const low = classify({
      capabilityId: "bounded_diagnostic_execution",
      modelRiskLabel: "low",
    });
    expect(low.authoritativeRiskClass).toBe(baseline.authoritativeRiskClass);

    const escalated = classify({
      capabilityId: "bounded_diagnostic_execution",
      modelRiskLabel: "consultation",
    });
    expect(escalated.authoritativeRiskClass).toBe("consultation");
  });

  it("network or external-side-effect requests raise the class", () => {
    const network = classify({
      capabilityId: "bounded_diagnostic_execution",
      networkRequired: true,
    });
    expect(network.networkRequired).toBe(true);
    expect(network.authoritativeRiskClass).toBe("high");

    const external = classify({
      capabilityId: "bounded_diagnostic_execution",
      externalSideEffects: true,
    });
    expect(external.externalSideEffects).toBe(true);
    expect(external.authoritativeRiskClass).toBe("consultation");
  });

  it("marks policy and safeguard interaction capabilities", () => {
    const policy = classify({ capabilityId: "authorization_policy_modification" });
    expect(policy.policyInteraction).toBe(true);

    const safeguard = classify({ capabilityId: "safeguard_weakening" });
    expect(safeguard.safeguardInteraction).toBe(true);

    const plain = classify({ capabilityId: "fixed_test_recipe" });
    expect(plain.policyInteraction).toBe(false);
    expect(plain.safeguardInteraction).toBe(false);
  });

  it("treats a path under a denied root without policy roots as unprotected", () => {
    const facts = classifySandboxOperation({
      capabilityId: "approved_project_read",
      intent: "read",
      targetPath: "/srv/ashley/live-checkout/src/core/db.ts",
      protectedRoots: NO_ROOTS,
    });
    expect(facts.pathClass.class).toBe("none");
  });

  it("exposes exactly 39 registered capability specs", () => {
    expect(SANDBOX_CAPABILITIES).toHaveLength(39);
    expect(capabilitySpec("deployment")).toBeDefined();
    expect(capabilitySpec("deployment")?.class).toBe("owner_approvable");
    expect(capabilitySpec("ashley_agent_service_restart")).toBeUndefined();
    expect(capabilitySpec("nope")).toBeUndefined();
    const ids = new Set(SANDBOX_CAPABILITIES.map((spec) => spec.id));
    expect(ids.size).toBe(39);
  });
});
