/**
 * Schema foundation for a future owner-signed delegated sandbox policy.
 *
 * Signature generation and verification are intentionally NOT implemented
 * here. This module defines the deterministic payload shape and validates it
 * structurally so that both agent-service and the broker can trust a policy
 * document before any authorization decision. No secrets belong in the
 * policy, and validation rejects secret-shaped material.
 */

import { canonicalizePath, isCanonicalForm, isWithin } from "./canonical-paths.js";
import { capabilitySpec } from "./classify.js";
import type { ProtectedRootClass, SandboxCapabilityId } from "./types.js";

export const SANDBOX_POLICY_PAYLOAD_VERSION = 1;

export type ResourceCeilings = {
  wallMsMax: number;
  maxProcesses: number;
  maxOutputBytes: number;
  workspaceBytesMax: number;
};

export type SandboxPolicyProtectedRoot = {
  path: string;
  class: ProtectedRootClass;
};

export type SandboxNetworkMode = "none" | "networked";

export type SandboxPolicyDocument = {
  policyId: string;
  policyVersion: number;
  issuedAt: string;
  expiresAt?: string;
  allowedDelegatedSignerKeyIds: string[];
  allowedCapabilities: SandboxCapabilityId[];
  /** Broker session roles the owner explicitly permits under this policy. */
  sessionRoles?: string[];
  readOnlyRoots: string[];
  writableDisposableRoots: string[];
  protectedRoots: SandboxPolicyProtectedRoot[];
  allowedRecipeIds: string[];
  allowedExecutableIds: string[];
  resourceCeilings: ResourceCeilings;
  networkMode: SandboxNetworkMode;
  maxActiveSessions: number;
  payloadVersion: 1;
};

export type PolicyValidationResult =
  | { ok: true; policy: SandboxPolicyDocument }
  | { ok: false; reasons: string[] };

const PRIVATE_KEY_MARKER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidIso(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function uniqueStrings(values: unknown): values is string[] {
  if (!Array.isArray(values)) return false;
  if (!values.every((v) => typeof v === "string" && v.length > 0)) return false;
  return new Set(values).size === values.length;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function canonicalRoots(values: unknown): values is string[] {
  if (!Array.isArray(values)) return false;
  if (!values.every((v) => typeof v === "string")) return false;
  return values.every((v) => {
    const result = canonicalizePath(v);
    return result.ok && isCanonicalForm(v);
  });
}

function looksLikeKeyMaterial(value: string): boolean {
  if (PRIVATE_KEY_MARKER.test(value)) return true;
  return value.length > 200 && /^[A-Za-z0-9+/=_\-]+$/.test(value);
}

export function validateSandboxPolicyDocument(
  value: unknown,
): PolicyValidationResult {
  const reasons: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, reasons: ["policy_not_an_object"] };
  }

  if (value.payloadVersion !== SANDBOX_POLICY_PAYLOAD_VERSION) {
    reasons.push(
      `unsupported_payload_version:${String(value.payloadVersion)}:expected:${SANDBOX_POLICY_PAYLOAD_VERSION}`,
    );
  }
  if (!isNonEmptyString(value.policyId)) reasons.push("policy_id_required");
  if (!isPositiveInteger(value.policyVersion)) {
    reasons.push("policy_version_required");
  }
  if (!isValidIso(value.issuedAt)) reasons.push("issued_at_required");
  if (value.expiresAt !== undefined && !isValidIso(value.expiresAt)) {
    reasons.push("expires_at_invalid");
  }
  if (
    isValidIso(value.issuedAt) &&
    isValidIso(value.expiresAt) &&
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
  ) {
    reasons.push("expires_at_must_exceed_issued_at");
  }
  if (!uniqueStrings(value.allowedDelegatedSignerKeyIds)) {
    reasons.push("delegated_signer_key_ids_must_be_unique_nonempty");
  }
  if (!uniqueStrings(value.allowedRecipeIds)) {
    reasons.push("recipe_ids_must_be_unique_nonempty");
  }
  if (value.sessionRoles !== undefined) {
    if (!uniqueStrings(value.sessionRoles)) {
      reasons.push("session_roles_must_be_unique_nonempty");
    } else if (
      (value.sessionRoles as string[]).some(
        (role) => role.length === 0 || role.length > 64,
      )
    ) {
      reasons.push("session_role_out_of_bounds");
    }
  }
  if (!uniqueStrings(value.allowedExecutableIds)) {
    reasons.push("executable_ids_must_be_unique_nonempty");
  }
  if (!Array.isArray(value.allowedCapabilities)) {
    reasons.push("allowed_capabilities_required");
  } else if (value.allowedCapabilities.length === 0) {
    reasons.push("allowed_capabilities_must_not_be_empty");
  } else {
    const seen = new Set<string>();
    for (const entry of value.allowedCapabilities) {
      if (typeof entry !== "string" || !capabilitySpec(entry)) {
        reasons.push(`unknown_capability:${String(entry)}`);
      } else if (seen.has(entry)) {
        reasons.push(`duplicate_capability:${entry}`);
      }
      seen.add(String(entry));
    }
  }
  if (!canonicalRoots(value.readOnlyRoots)) {
    reasons.push("read_only_roots_must_be_canonical_absolute");
  }
  if (!canonicalRoots(value.writableDisposableRoots)) {
    reasons.push("writable_disposable_roots_must_be_canonical_absolute");
  }
  if (!Array.isArray(value.protectedRoots)) {
    reasons.push("protected_roots_required");
  } else {
    const seen = new Set<string>();
    for (const entry of value.protectedRoots) {
      if (!isRecord(entry)) {
        reasons.push("protected_root_must_be_object");
        continue;
      }
      if (typeof entry.path !== "string") {
        reasons.push("protected_root_path_required");
        continue;
      }
      const canonical = canonicalizePath(entry.path);
      if (!canonical.ok || !isCanonicalForm(entry.path)) {
        reasons.push(`protected_root_not_canonical:${entry.path}`);
        continue;
      }
      if (
        entry.class !== "delegated_write_denied_owner_approvable" &&
        entry.class !== "absolute_denial"
      ) {
        reasons.push(`protected_root_invalid_class:${String(entry.class)}`);
        continue;
      }
      if (seen.has(canonical.value)) {
        reasons.push(`duplicate_protected_root:${canonical.value}`);
      }
      seen.add(canonical.value);
    }
  }
  if (!isRecord(value.resourceCeilings)) {
    reasons.push("resource_ceilings_required");
  } else {
    if (!isPositiveInteger(value.resourceCeilings.wallMsMax)) {
      reasons.push("wall_ms_max_required");
    }
    if (!isPositiveInteger(value.resourceCeilings.maxProcesses)) {
      reasons.push("max_processes_required");
    }
    if (!isNonNegativeInteger(value.resourceCeilings.maxOutputBytes)) {
      reasons.push("max_output_bytes_required");
    }
    if (!isPositiveInteger(value.resourceCeilings.workspaceBytesMax)) {
      reasons.push("workspace_bytes_max_required");
    }
  }
  if (value.networkMode !== "none" && value.networkMode !== "networked") {
    reasons.push("network_mode_must_be_none_or_networked");
  }
  if (!isPositiveInteger(value.maxActiveSessions)) {
    reasons.push("max_active_sessions_required");
  }

  if (
    canonicalRoots(value.readOnlyRoots) &&
    Array.isArray(value.protectedRoots)
  ) {
    const absoluteDenialRoots = (value.protectedRoots as SandboxPolicyProtectedRoot[])
      .filter((entry) => entry.class === "absolute_denial")
      .map((entry) => entry.path);
    for (const root of value.readOnlyRoots as string[]) {
      for (const denied of absoluteDenialRoots) {
        if (isWithin(root, denied) || isWithin(denied, root)) {
          reasons.push(
            `read_root_overlaps_absolute_denial:${root}:${denied}`,
          );
        }
      }
    }
  }
  if (
    canonicalRoots(value.writableDisposableRoots) &&
    Array.isArray(value.protectedRoots)
  ) {
    const protectedPaths = (value.protectedRoots as SandboxPolicyProtectedRoot[]).map(
      (entry) => entry.path,
    );
    for (const root of value.writableDisposableRoots as string[]) {
      for (const protectedPath of protectedPaths) {
        if (isWithin(root, protectedPath) || isWithin(protectedPath, root)) {
          reasons.push(
            `disposable_root_overlaps_protected_root:${root}:${protectedPath}`,
          );
        }
      }
    }
  }

  const stringFields = [
    value.policyId,
    value.issuedAt,
    value.expiresAt,
    ...(Array.isArray(value.allowedDelegatedSignerKeyIds)
      ? value.allowedDelegatedSignerKeyIds
      : []),
  ];
  if (stringFields.some((field) => looksLikeKeyMaterial(String(field)))) {
    reasons.push("policy_must_not_contain_secret_material");
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return {
    ok: true,
    policy: value as unknown as SandboxPolicyDocument,
  };
}

export function parseSandboxPolicyJson(text: string): PolicyValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reasons: ["policy_json_invalid"] };
  }
  return validateSandboxPolicyDocument(parsed);
}
