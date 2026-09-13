import { describe, expect, it } from "vitest";
import {
  parseSandboxPolicyJson,
  validateSandboxPolicyDocument,
  type SandboxPolicyDocument,
} from "./policy-schema.js";
import { validPolicy } from "./test/fixtures/policy.js";

describe("validateSandboxPolicyDocument", () => {
  it("accepts a valid policy document", () => {
    const result = validateSandboxPolicyDocument(validPolicy());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policy.policyId).toBe("test-policy-1");
    }
  });

  it("rejects an unsupported payload version", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({ payloadVersion: 99 as 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("unsupported_payload_version");
    }
  });

  it("rejects non-canonical roots", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({ readOnlyRoots: ["/srv/ashley/../ashley/live-checkout"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("read_only_roots");
    }
  });

  it("rejects disposable roots that overlap protected roots", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({
        writableDisposableRoots: ["/var/lib/ashley-sandbox"],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("disposable_root_overlaps");
    }
  });

  it("rejects read roots that overlap absolute-denial roots", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({ readOnlyRoots: ["/home/doc/.composer-assistant"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("read_root_overlaps");
    }
  });

  it("rejects unknown capabilities and duplicate ids", () => {
    const unknown = validateSandboxPolicyDocument(
      validPolicy({
        allowedCapabilities: [
          "approved_project_read",
          "made_up_capability",
        ] as SandboxPolicyDocument["allowedCapabilities"],
      }),
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.reasons.join(",")).toContain("unknown_capability");
    }
    const duplicate = validateSandboxPolicyDocument(
      validPolicy({
        allowedCapabilities: [
          "approved_project_read",
          "approved_project_read",
        ] as SandboxPolicyDocument["allowedCapabilities"],
      }),
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.reasons.join(",")).toContain("duplicate_capability");
    }
  });

  it("rejects secret material in the policy", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({
        allowedDelegatedSignerKeyIds: [
          "-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----",
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("secret_material");
    }
  });

  it("rejects an expiry not after the issued time", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({ expiresAt: "2026-08-04T00:00:00.000Z" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("expires_at_must_exceed");
    }
  });

  it("accepts an explicit session role list", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({ sessionRoles: ["sandbox_operator_light"] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policy.sessionRoles).toEqual(["sandbox_operator_light"]);
    }
  });

  it("rejects duplicate session roles", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({
        sessionRoles: ["sandbox_operator_light", "sandbox_operator_light"],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("session_roles");
    }
  });

  it("rejects oversized session role names", () => {
    const result = validateSandboxPolicyDocument(
      validPolicy({ sessionRoles: ["x".repeat(65)] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.join(",")).toContain("session_role_out_of_bounds");
    }
  });
});

describe("parseSandboxPolicyJson", () => {
  it("parses and validates a JSON policy without filesystem access", () => {
    const result = parseSandboxPolicyJson(JSON.stringify(validPolicy()));
    expect(result.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = parseSandboxPolicyJson("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("policy_json_invalid");
    }
  });
});
