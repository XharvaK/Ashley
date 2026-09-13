import { describe, expect, it } from "vitest";
import { authorizeSandboxOperation, rule } from "./authorize.js";
import { validPolicy } from "./test/fixtures/policy.js";
import type { SandboxAuthorizeInput } from "./authorize.js";
import type { SandboxCapabilityId } from "./types.js";

const NOW = "2026-08-05T12:00:00.000Z";
const DELEGATED = { class: "delegated", keyId: "delegated-ed25519-v1" } as const;
const OWNER = { class: "owner", keyId: "owner-ed25519-v1" } as const;

const LIVE_CHECKOUT_FILE = "/srv/ashley/live-checkout/src/core/db.ts";
const LIVE_CHECKOUT_GIT_CONFIG = "/srv/ashley/live-checkout/.git/config";
const DISPOSABLE_WRITE = "/var/lib/ashley-sandbox/work/candidate/notes.md";
const DISPOSABLE_ROOT = "/var/lib/ashley-sandbox/work";
const ENV_FILE = "/home/doc/.composer-assistant/.env";
const KEYS_DIR = "/var/lib/ashley-sandbox/meta/keys/owner";
const POLICY_FILE = "/var/lib/ashley-sandbox/meta/policy/signed.json";

function base(
  overrides: Partial<SandboxAuthorizeInput> = {},
): SandboxAuthorizeInput {
  return {
    capabilityId: "approved_project_read",
    policy: validPolicy(),
    signer: DELEGATED,
    nowIso: NOW,
    ...overrides,
  };
}

function authorize(input: SandboxAuthorizeInput) {
  return authorizeSandboxOperation(input);
}

describe("delegated-safe authorization", () => {
  it("1. classifies a known delegated-safe capability autonomous only when all constraints match", () => {
    const decision = authorize(
      base({
        capabilityId: "approved_project_read",
        intent: "read",
        targetPath: LIVE_CHECKOUT_FILE,
      }),
    );
    expect(decision.decision).toBe("autonomous_safe");
    expect(decision.authoritativeRiskClass).toBe("low");
    expect(decision.policyRuleId).toBe(rule("delegated-autonomy"));
  });

  it("2. denies a delegated-safe capability that is outside the policy", () => {
    const decision = authorize(
      base({
        capabilityId: "candidate_patch_generate",
        intent: "write",
        targetPath: `${DISPOSABLE_ROOT}/patch.diff`,
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "capability_not_allowed_by_policy" });
  });

  it("14. approves project read can be autonomous under an allowed read root", () => {
    const decision = authorize(
      base({
        capabilityId: "approved_project_read",
        intent: "read",
        targetPath: LIVE_CHECKOUT_FILE,
        signer: DELEGATED,
      }),
    );
    expect(decision.decision).toBe("autonomous_safe");
  });

  it("15. approved disposable-workspace write can be autonomous", () => {
    const decision = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: DISPOSABLE_WRITE,
      }),
    );
    expect(decision.decision).toBe("autonomous_safe");
  });

  it("16. denies a write outside the disposable root", () => {
    const decision = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: "/home/doc/other/file.txt",
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "path_outside_permitted_roots" });
  });

  it("17. rejects traversal and non-canonical path claims", () => {
    const traversal = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: `${DISPOSABLE_ROOT}/../escape.txt`,
      }),
    );
    expect(traversal).toMatchObject({ decision: "denied", reason: "path_not_canonical" });
  });

  it("18. containment never uses unsafe prefix matching", () => {
    const decision = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: "/var/lib/ashley-sandbox-work/evil.txt",
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "path_outside_permitted_roots" });
  });

  it("19. root equality follows the explicit policy roots", () => {
    const atRoot = authorize(
      base({
        capabilityId: "candidate_workspace_create",
        intent: "write",
        targetPath: DISPOSABLE_ROOT,
      }),
    );
    expect(atRoot.decision).toBe("autonomous_safe");
    const parent = authorize(
      base({
        capabilityId: "candidate_workspace_create",
        intent: "write",
        targetPath: "/var/lib/ashley-sandbox",
      }),
    );
    expect(parent.decision).toBe("denied");
  });

  it("20. denies a network-requesting command as not delegated-safe", () => {
    const decision = authorize(
      base({
        capabilityId: "bounded_diagnostic_execution",
        executableId: "ashley-tools/check.sh",
        networkRequired: true,
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "network_required_not_delegated_safe" });
  });

  it("denies a bounded diagnostic that requests external side effects", () => {
    const decision = authorize(
      base({
        capabilityId: "bounded_diagnostic_execution",
        executableId: "ashley-tools/check.sh",
        externalSideEffects: true,
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "external_side_effects_not_delegated_safe" });
  });

  it("denies an unlisted recipe for a recipe-bound capability", () => {
    const decision = authorize(
      base({
        capabilityId: "fixed_test_recipe",
        recipeId: "npm:run:evil-script",
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "recipe_not_allowed_by_policy" });
  });

  it("allows a listed recipe when bounded", () => {
    const decision = authorize(
      base({
        capabilityId: "fixed_test_recipe",
        recipeId: "verify:agent-tsc",
      }),
    );
    expect(decision.decision).toBe("autonomous_safe");
  });

  it("denies requests that exceed policy resource ceilings", () => {
    const decision = authorize(
      base({
        capabilityId: "fixed_test_recipe",
        recipeId: "verify:agent-tsc",
        requestedLimits: { wallMsMax: 999_999_999 },
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "request_exceeds_policy_ceiling" });
  });

  it("denies persistence outside the disposable workspace", () => {
    const decision = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: LIVE_CHECKOUT_FILE,
        persistence: true,
      }),
    );
    expect(decision.decision).toBe("owner_approval_required");
  });

  it("denies a delegated signer key not allowed by the policy", () => {
    const decision = authorize(
      base({
        signer: { class: "delegated", keyId: "unknown-delegated-key" },
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "delegated_signer_key_not_allowed_by_policy" });
  });
});

describe("owner-approvable capabilities", () => {
  it("3. owner-approvable capability can never become autonomous", () => {
    const scenarios: Array<{
      capabilityId: SandboxCapabilityId;
      targetPath?: string;
      intent?: "read" | "write" | "delete";
    }> = [
      { capabilityId: "apply_candidate_patch_live", targetPath: LIVE_CHECKOUT_FILE, intent: "write" },
      { capabilityId: "write_live_repository", targetPath: LIVE_CHECKOUT_FILE, intent: "write" },
      { capabilityId: "modify_live_git_metadata", targetPath: LIVE_CHECKOUT_GIT_CONFIG, intent: "write" },
      { capabilityId: "commit_merge_workflow" },
      { capabilityId: "deployment" },
      { capabilityId: "service_restart_management" },
      { capabilityId: "package_install_remove_upgrade" },
      { capabilityId: "production_configuration_change", targetPath: "/srv/ashley/live-checkout/.env.production", intent: "write" },
      { capabilityId: "persistent_deletion", targetPath: "/home/doc/other/data.txt", intent: "delete" },
      { capabilityId: "authenticated_external_action" },
      { capabilityId: "messaging_file_upload" },
      { capabilityId: "broader_network_effects" },
    ];
    for (const { capabilityId, targetPath, intent } of scenarios) {
      const decision = authorize(
        base({ capabilityId, signer: DELEGATED, targetPath, intent }),
      );
      expect(decision.decision).toBe("owner_approval_required");
      expect(decision.policyRuleId).toBe(rule("owner-approval-required"));
    }
  });

  it("8. live-checkout write requires owner approval", () => {
    const explicit = authorize(
      base({
        capabilityId: "write_live_repository",
        intent: "write",
        targetPath: LIVE_CHECKOUT_FILE,
      }),
    );
    expect(explicit.decision).toBe("owner_approval_required");

    const escalated = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: LIVE_CHECKOUT_FILE,
      }),
    );
    expect(escalated.decision).toBe("owner_approval_required");
    expect(escalated.policyRuleId).toBe(rule("owner-approval-escalated"));
    expect(escalated).toMatchObject({
      reason: "delegated_write_denied_root_requires_owner_approval",
    });
  });

  it("9. live .git write requires owner approval", () => {
    const decision = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: LIVE_CHECKOUT_GIT_CONFIG,
      }),
    );
    expect(decision.decision).toBe("owner_approval_required");
  });

  it("22. package installation requires owner approval", () => {
    const decision = authorize(
      base({ capabilityId: "package_install_remove_upgrade" }),
    );
    expect(decision.decision).toBe("owner_approval_required");
  });

  it("23. service restart requires owner approval", () => {
    const decision = authorize(
      base({ capabilityId: "service_restart_management" }),
    );
    expect(decision.decision).toBe("owner_approval_required");
  });

  it("24. persistent deletion requires owner approval", () => {
    const decision = authorize(
      base({
        capabilityId: "persistent_deletion",
        intent: "delete",
        targetPath: "/home/doc/other/data.txt",
      }),
    );
    expect(decision.decision).toBe("owner_approval_required");
  });
});

describe("absolute denial", () => {
  it("4. absolute denial overrides a delegated signer", () => {
    const decision = authorize(
      base({
        capabilityId: "secret_extraction_transmission",
        signer: DELEGATED,
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "absolute_denial" });
    expect(decision.policyRuleId).toBe(rule("absolute-denial"));
  });

  it("5. absolute denial overrides an owner signer", () => {
    const decision = authorize(
      base({ capabilityId: "signing_key_access", signer: OWNER }),
    );
    expect(decision.decision).toBe("denied");
  });

  it("10. signing-key access is absolute denial (capability and path)", () => {
    const byCapability = authorize(
      base({ capabilityId: "signing_key_access" }),
    );
    expect(byCapability.decision).toBe("denied");
    const byPath = authorize(
      base({
        capabilityId: "approved_project_read",
        intent: "read",
        targetPath: `${KEYS_DIR}/owner-ed25519-v1.pub`,
      }),
    );
    expect(byPath).toMatchObject({ decision: "denied", reason: "absolute_denial" });
  });

  it("11. secret-file access is absolute denial even as a read", () => {
    const decision = authorize(
      base({
        capabilityId: "approved_project_read",
        intent: "read",
        targetPath: ENV_FILE,
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "absolute_denial" });
  });

  it("12. active policy modification is absolute denial", () => {
    const byCapability = authorize(
      base({ capabilityId: "authorization_policy_modification" }),
    );
    expect(byCapability.decision).toBe("denied");
    const byPath = authorize(
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: POLICY_FILE,
      }),
    );
    expect(byPath.decision).toBe("denied");
  });

  it("13. broker safeguard modification is absolute denial", () => {
    const decision = authorize(
      base({ capabilityId: "safeguard_weakening" }),
    );
    expect(decision.decision).toBe("denied");
  });

  it("21. unrestricted shell is absolute denial", () => {
    const decision = authorize(base({ capabilityId: "unrestricted_shell" }));
    expect(decision).toMatchObject({ decision: "denied", reason: "absolute_denial" });
  });

  it("denies privilege escalation, host wiping and controls bypass", () => {
    for (const capabilityId of [
      "privilege_escalation",
      "host_wiping",
      "controls_bypass",
      "data_exfiltration",
      "unrelated_personal_file_access",
      "audit_log_concealment_tampering",
    ] as const) {
      const decision = authorize(base({ capabilityId }));
      expect(decision).toMatchObject({ decision: "denied", reason: "absolute_denial" });
    }
  });
});

describe("authoritative risk and fail-closed rules", () => {
  it("6. model-provided low risk cannot lower authoritative high or consultation", () => {
    const denial = authorize(
      base({ capabilityId: "host_wiping", modelRiskLabel: "low" }),
    );
    expect(denial.decision).toBe("denied");
    expect(denial.authoritativeRiskClass).toBe("high");

    const approval = authorize(
      base({
        capabilityId: "deployment",
        signer: DELEGATED,
        modelRiskLabel: "low",
      }),
    );
    expect(approval.decision).toBe("owner_approval_required");
    expect(approval.authoritativeRiskClass).toBe("consultation");
  });

  it("7. unknown capability fails closed", () => {
    const decision = authorize(
      base({
        capabilityId: "future_hypothetical_capability" as SandboxCapabilityId,
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "unknown_capability" });
    expect(decision.policyRuleId).toBe(rule("unknown-capability"));
  });

  it("denies with no active policy", () => {
    const decision = authorize(base({ policy: null }));
    expect(decision).toMatchObject({ decision: "denied", reason: "no_active_policy" });
  });

  it("denies an invalid policy document", () => {
    const policy = validPolicy({ payloadVersion: 99 as 1 });
    const decision = authorize(base({ policy }));
    expect(decision).toMatchObject({ decision: "denied", reason: "invalid_policy" });
  });

  it("denies an expired policy", () => {
    const policy = validPolicy({
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-05T06:00:00.000Z",
    });
    const decision = authorize(base({ policy }));
    expect(decision).toMatchObject({ decision: "denied", reason: "policy_expired" });
  });

  it("denies a policy that is not yet valid", () => {
    const policy = validPolicy({ issuedAt: "2026-08-06T00:00:00.000Z" });
    const decision = authorize(base({ policy }));
    expect(decision).toMatchObject({ decision: "denied", reason: "policy_not_yet_valid" });
  });

  it("denies a path-based capability that omits its target path", () => {
    const decision = authorize(
      base({ capabilityId: "approved_project_read", intent: "read" }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "target_path_required" });
  });

  it("denies an intent the capability does not permit", () => {
    const decision = authorize(
      base({
        capabilityId: "approved_project_read",
        intent: "write",
        targetPath: LIVE_CHECKOUT_FILE,
      }),
    );
    expect(decision).toMatchObject({ decision: "denied", reason: "intent_not_permitted_by_capability" });
  });

  it("28. every result carries a stable policy-rule ID", () => {
    const scenarios: SandboxAuthorizeInput[] = [
      base({
        capabilityId: "approved_project_read",
        intent: "read",
        targetPath: LIVE_CHECKOUT_FILE,
      }),
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: DISPOSABLE_WRITE,
      }),
      base({ capabilityId: "deployment" }),
      base({ capabilityId: "secret_extraction_transmission" }),
      base({ capabilityId: "host_wiping", modelRiskLabel: "low" }),
      base({
        capabilityId: "future_capability" as SandboxCapabilityId,
      }),
      base({ policy: null }),
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: "/home/doc/other",
      }),
      base({
        capabilityId: "candidate_workspace_read_write_delete",
        intent: "write",
        targetPath: `${DISPOSABLE_ROOT}/../escape`,
      }),
      base({ capabilityId: "fixed_test_recipe", recipeId: "verify:agent-tsc" }),
      base({ capabilityId: "unrestricted_shell" }),
    ];
    const ruleIdPattern = /^sandbox-policy\/rule\/[a-z0-9-]+$/;
    for (const scenario of scenarios) {
      const decision = authorize(scenario);
      expect(decision.policyRuleId).toMatch(ruleIdPattern);
      expect(decision.capability).toBe(scenario.capabilityId);
      expect(["low", "medium", "high", "consultation"]).toContain(
        decision.authoritativeRiskClass,
      );
      if (decision.decision === "denied" || decision.decision === "owner_approval_required") {
        expect(decision.reason.length).toBeGreaterThan(0);
      }
    }
  });
});
