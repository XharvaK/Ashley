import { SANDBOX_POLICY_PAYLOAD_VERSION } from "../../policy-schema.js";
import type { SandboxPolicyDocument } from "../../policy-schema.js";

export function validPolicy(
  overrides: Partial<SandboxPolicyDocument> = {},
): SandboxPolicyDocument {
  return {
    policyId: "test-policy-1",
    policyVersion: 1,
    issuedAt: "2026-08-05T00:00:00.000Z",
    allowedDelegatedSignerKeyIds: ["delegated-ed25519-v1"],
    allowedCapabilities: [
      "approved_project_read",
      "approved_bounded_log_read",
      "fixed_test_recipe",
      "fixed_build_recipe",
      "candidate_workspace_create",
      "candidate_workspace_read_write_delete",
      "bounded_diagnostic_execution",
    ],
    readOnlyRoots: ["/srv/ashley/live-checkout"],
    writableDisposableRoots: ["/var/lib/ashley-sandbox/work"],
    protectedRoots: [
      {
        path: "/srv/ashley/live-checkout/.git",
        class: "delegated_write_denied_owner_approvable",
      },
      {
        path: "/srv/ashley/live-checkout",
        class: "delegated_write_denied_owner_approvable",
      },
      {
        path: "/home/doc/.composer-assistant/.env",
        class: "absolute_denial",
      },
      {
        path: "/var/lib/ashley-sandbox/meta/keys",
        class: "absolute_denial",
      },
      {
        path: "/var/lib/ashley-sandbox/meta/policy",
        class: "absolute_denial",
      },
      {
        path: "/var/lib/ashley-sandbox/meta/audit",
        class: "absolute_denial",
      },
    ],
    allowedRecipeIds: ["verify:agent-tsc", "test:broker-smoke"],
    allowedExecutableIds: ["ashley-tools/check.sh"],
    resourceCeilings: {
      wallMsMax: 120_000,
      maxProcesses: 16,
      maxOutputBytes: 4_194_304,
      workspaceBytesMax: 2_000_000_000,
    },
    networkMode: "none",
    maxActiveSessions: 1,
    payloadVersion: SANDBOX_POLICY_PAYLOAD_VERSION,
    ...overrides,
  };
}
