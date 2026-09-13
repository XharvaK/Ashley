/**
 * Engineering sandbox action vocabulary and strict validation (Sandbox
 * Autonomous Engineering Workstation wave).
 *
 * This module is the single source of truth for the bounded structured-action
 * vocabulary the model-backed operator may emit. It is pure and
 * dependency-free: no filesystem access, no command execution, no secret
 * access, no model/provider clients. The broker re-validates every action
 * before execution; the agent validates first as a policy precheck.
 *
 * Design invariants (fail-closed):
 *  - closed action vocabulary
 *  - bounded field lengths
 *  - canonical relative paths only (no "/", no "..", no "\\", no NUL)
 *  - no raw absolute model-selected host paths
 *  - no shell fragments / command substitution / raw argv / raw env
 *  - no credential-shaped payloads
 *  - no raw policy / session / signing identifiers from model output
 *  - semantic authority remains broker-final
 */

import type { SandboxCapabilityId } from "./types.js";

export type EngineeringActionType =
  | "inspect_project_file"
  | "list_project_directory"
  | "search_project_text"
  | "inspect_project_git_status"
  | "inspect_project_git_diff"
  | "inspect_project_git_log"
  | "request_workspace"
  | "list_workspace_directory"
  | "read_workspace_file"
  | "search_workspace_text"
  | "write_workspace_file"
  | "apply_workspace_patch"
  | "delete_workspace_file"
  | "execute_recipe"
  | "run_diagnostic"
  | "generate_candidate_patch"
  | "generate_report_artifact"
  | "commit_candidate"
  | "request_owner_approval"
  | "complete"
  | "abort";

export const ENGINEERING_ACTION_TYPES: ReadonlySet<EngineeringActionType> = new Set<EngineeringActionType>([
  "inspect_project_file",
  "list_project_directory",
  "search_project_text",
  "inspect_project_git_status",
  "inspect_project_git_diff",
  "inspect_project_git_log",
  "request_workspace",
  "list_workspace_directory",
  "read_workspace_file",
  "search_workspace_text",
  "write_workspace_file",
  "apply_workspace_patch",
  "delete_workspace_file",
  "execute_recipe",
  "run_diagnostic",
  "generate_candidate_patch",
  "generate_report_artifact",
  "commit_candidate",
  "request_owner_approval",
  "complete",
  "abort",
]);

/** Actions that yield a session terminal transition rather than a tool call. */
export const ENGINEERING_META_ACTIONS: ReadonlySet<EngineeringActionType> = new Set([
  "request_owner_approval",
  "complete",
  "abort",
]);

export type EngineeringAction = {
  type: EngineeringActionType;
  /** Bounded string-map payload. All values validated by `validateEngineeringAction`. */
  fields: Record<string, unknown>;
};

export const ENGINEERING_LIMITS = {
  PROJECT_ID_MAX: 128,
  WORKSPACE_ID_MAX: 64,
  RELATIVE_PATH_MAX: 1024,
  PATTERN_MAX: 256,
  RECIPE_ID_MAX: 128,
  DIAGNOSTIC_ID_MAX: 128,
  MESSAGE_MAX: 2048,
  REASON_MAX: 1024,
  CONTENT_BASE64_MAX: 8 * 1024 * 1024,
  PATCH_BASE64_MAX: 16 * 1024 * 1024,
  MAX_MATCHES_MAX: 10000,
  SUMMARY_MAX: 8192,
} as const;

const SHELL_METACHAR = /[|;&><`$(){}[\]*?!#\n\r\t]/;
// Obvious credential / secret shapes that must never appear in any action field.
const CREDENTIAL_SHAPES =
  /(-----BEGIN[A-Z ]*(PRIVATE|PUBLIC)? ?KEY-----|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer [A-Za-z0-9._-]{10,}|password\s*[:=]|api[_-]?key\s*[:=]|secret[_-]?key\s*[:=]|client[_-]?secret\s*[:=])/i;
const POLICY_ID_SHAPE = /(ASHLEY-SANDBOX|[0-9a-f]{64}|sessionUuid|policyHash|envelope|signingKey|trustedKey)/i;

export type EngineeringActionValidation =
  | { ok: true; capability: SandboxCapabilityId | null }
  | { ok: false; errorCode: string; reason: string };

function isBoundedString(value: unknown, max: number, min = 0): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

/** Canonical relative POSIX path check: no "/", no "..", no "\\", no NUL, no symlink-up. */
export function isCanonicalRelativePath(value: unknown): value is string {
  if (!isBoundedString(value, ENGINEERING_LIMITS.RELATIVE_PATH_MAX)) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (value.includes("..")) return false;
  if (value.includes("\\")) return false;
  if (value.includes("\0")) return false;
  if (value.includes(":")) return false;
  return true;
}

function scanForbiddenMaterial(field: string, allowFreeText: boolean): string | null {
  if (CREDENTIAL_SHAPES.test(field)) return "credential_shaped_payload";
  if (!allowFreeText && POLICY_ID_SHAPE.test(field)) return "policy_or_signing_identifier";
  if (!allowFreeText && SHELL_METACHAR.test(field)) return "shell_metachar_forbidden";
  return null;
}

/** Map a structured action to the capability it consumes (null for meta actions). */
export function engineeringActionCapability(type: EngineeringActionType): SandboxCapabilityId | null {
  switch (type) {
    case "inspect_project_file":
    case "list_project_directory":
    case "search_project_text":
    case "inspect_project_git_status":
    case "inspect_project_git_diff":
    case "inspect_project_git_log":
      return "engineering_project_read";
    case "request_workspace":
      return "candidate_workspace_create";
    case "list_workspace_directory":
    case "read_workspace_file":
    case "search_workspace_text":
    case "write_workspace_file":
    case "delete_workspace_file":
      return "candidate_workspace_read_write_delete";
    case "apply_workspace_patch":
      return "candidate_patch_generate";
    case "execute_recipe":
      return "fixed_build_recipe";
    case "run_diagnostic":
      return "bounded_diagnostic_execution";
    case "generate_candidate_patch":
      return "candidate_patch_generate";
    case "generate_report_artifact":
      return "candidate_report_artifact_generate";
    case "commit_candidate":
      return "candidate_repository_git_write";
    case "request_owner_approval":
    case "complete":
    case "abort":
      return null;
  }
}

/**
 * Strict, fail-closed validation of a single engineering action proposed by the
 * model. Returns the consuming capability for authorization, or an error with a
 * stable errorCode. Free-text fields (reason/message/summary) are allowed to
 * contain prose but still scanned for credential shapes.
 */
export function validateEngineeringAction(action: EngineeringAction): EngineeringActionValidation {
  if (!action || typeof action !== "object") {
    return { ok: false, errorCode: "action_invalid", reason: "action must be an object" };
  }
  if (!ENGINEERING_ACTION_TYPES.has(action.type)) {
    return { ok: false, errorCode: "unknown_action", reason: `unknown action: ${String(action.type)}` };
  }
  if (!action.fields || typeof action.fields !== "object" || Array.isArray(action.fields)) {
    return { ok: false, errorCode: "fields_invalid", reason: "fields must be an object" };
  }
  const f = action.fields;

  const requireProjectId =
    action.type.startsWith("inspect_project") ||
    action.type === "list_project_directory" ||
    action.type === "search_project_text";
  const requireWorkspaceId =
    action.type.startsWith("list_workspace") ||
    action.type.startsWith("read_workspace") ||
    action.type.startsWith("write_workspace") ||
    action.type.startsWith("search_workspace") ||
    action.type === "apply_workspace_patch" ||
    action.type === "generate_candidate_patch";

  if (requireProjectId) {
    if (!isBoundedString(f.projectId, ENGINEERING_LIMITS.PROJECT_ID_MAX)) {
      return { ok: false, errorCode: "project_id_invalid", reason: "projectId required" };
    }
  }
  if (requireWorkspaceId) {
    if (!isBoundedString(f.workspaceId, ENGINEERING_LIMITS.WORKSPACE_ID_MAX)) {
      return { ok: false, errorCode: "workspace_id_invalid", reason: "workspaceId required" };
    }
  }

  const relativePathFields = ["relativePath"];
  for (const key of relativePathFields) {
    if (f[key] !== undefined) {
      if (!isCanonicalRelativePath(f[key])) {
        return {
          ok: false,
          errorCode: "relative_path_invalid",
          reason: `${key} must be a canonical relative path`,
        };
      }
    }
  }

  if (f.pattern !== undefined) {
    if (!isBoundedString(f.pattern, ENGINEERING_LIMITS.PATTERN_MAX)) {
      return { ok: false, errorCode: "pattern_invalid", reason: "pattern out of bounds" };
    }
    const bad = scanForbiddenMaterial(f.pattern, false);
    if (bad) return { ok: false, errorCode: bad, reason: "pattern rejected" };
  }

  if (f.recipeId !== undefined) {
    if (!isBoundedString(f.recipeId, ENGINEERING_LIMITS.RECIPE_ID_MAX)) {
      return { ok: false, errorCode: "recipe_id_invalid", reason: "recipeId out of bounds" };
    }
    const bad = scanForbiddenMaterial(f.recipeId, false);
    if (bad) return { ok: false, errorCode: bad, reason: "recipeId rejected" };
  }

  if (f.diagnosticId !== undefined) {
    if (!isBoundedString(f.diagnosticId, ENGINEERING_LIMITS.DIAGNOSTIC_ID_MAX)) {
      return { ok: false, errorCode: "diagnostic_id_invalid", reason: "diagnosticId out of bounds" };
    }
    const bad = scanForbiddenMaterial(f.diagnosticId, false);
    if (bad) return { ok: false, errorCode: bad, reason: "diagnosticId rejected" };
  }

  if (f.contentBase64 !== undefined) {
    if (
      typeof f.contentBase64 !== "string" ||
      f.contentBase64.length > ENGINEERING_LIMITS.CONTENT_BASE64_MAX
    ) {
      return { ok: false, errorCode: "content_too_large", reason: "contentBase64 out of bounds" };
    }
    if (!/^[A-Za-z0-9+/=\r\n]*$/.test(f.contentBase64)) {
      return { ok: false, errorCode: "content_malformed", reason: "contentBase64 not base64" };
    }
  }

  if (f.patchBase64 !== undefined) {
    if (
      typeof f.patchBase64 !== "string" ||
      f.patchBase64.length > ENGINEERING_LIMITS.PATCH_BASE64_MAX
    ) {
      return { ok: false, errorCode: "patch_too_large", reason: "patchBase64 out of bounds" };
    }
    if (!/^[A-Za-z0-9+/=\r\n@ \-]*$/.test(f.patchBase64)) {
      return { ok: false, errorCode: "patch_malformed", reason: "patchBase64 malformed" };
    }
  }

  if (f.message !== undefined) {
    if (!isBoundedString(f.message, ENGINEERING_LIMITS.MESSAGE_MAX)) {
      return { ok: false, errorCode: "message_invalid", reason: "message out of bounds" };
    }
    const bad = scanForbiddenMaterial(f.message, true);
    if (bad) return { ok: false, errorCode: bad, reason: "message rejected" };
  }

  if (f.reason !== undefined) {
    if (!isBoundedString(f.reason, ENGINEERING_LIMITS.REASON_MAX)) {
      return { ok: false, errorCode: "reason_invalid", reason: "reason out of bounds" };
    }
    const bad = scanForbiddenMaterial(f.reason, true);
    if (bad) return { ok: false, errorCode: bad, reason: "reason rejected" };
  }

  if (f.summary !== undefined) {
    if (!isBoundedString(f.summary, ENGINEERING_LIMITS.SUMMARY_MAX)) {
      return { ok: false, errorCode: "summary_invalid", reason: "summary out of bounds" };
    }
    const bad = scanForbiddenMaterial(f.summary, true);
    if (bad) return { ok: false, errorCode: bad, reason: "summary rejected" };
  }

  if (f.maxMatches !== undefined) {
    const mm = Number(f.maxMatches);
    if (!Number.isInteger(mm) || mm < 1 || mm > ENGINEERING_LIMITS.MAX_MATCHES_MAX) {
      return { ok: false, errorCode: "max_matches_invalid", reason: "maxMatches out of bounds" };
    }
  }

  return { ok: true, capability: engineeringActionCapability(action.type) };
}
