/**
 * Host-side strict request validation (Sandbox V2 M2).
 *
 * Pure and dependency-light. Reuses the proven sandbox-policy canonical
 * relative path check (`isCanonicalRelativePath`) so the M2 surface inherits
 * the already-qualified vocabulary rules: no absolute paths, no `..`, no
 * backslash escapes, no NUL, no drive-letter colons.
 */

import { isCanonicalRelativePath } from "@composer-assistant/sandbox-policy";
import { V2_LIMITS } from "./limits.js";
import type {
  SandboxV2ProjectListDirectoryRequest,
  SandboxV2ProjectReadFileRequest,
  SandboxV2ProjectSearchTextRequest,
} from "./v2-types.js";

export type ProjectInspectionValidation =
  | {
      ok: true;
      projectId: string;
      path: string;
      pattern?: string;
      maxMatches?: number;
    }
  | { ok: false; error: string };

function isBoundedString(value: unknown, max: number, min: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

export function validateProjectInspectionRequest(
  request:
    | SandboxV2ProjectReadFileRequest
    | SandboxV2ProjectListDirectoryRequest
    | SandboxV2ProjectSearchTextRequest,
): ProjectInspectionValidation {
  if (!request || typeof request !== "object") {
    return { ok: false, error: "request_invalid" };
  }
  const { projectId } = request;
  if (!isBoundedString(projectId, V2_LIMITS.PROJECT_ID_MAX, 1)) {
    return { ok: false, error: "project_id_invalid" };
  }

  if (request.operation === "project.search_text") {
    const path = request.path ?? ".";
    if (path !== "." && !isCanonicalRelativePath(path)) {
      return { ok: false, error: "path_invalid" };
    }
    if (!isBoundedString(request.pattern, V2_LIMITS.SEARCH_PATTERN_MAX, 1)) {
      return { ok: false, error: "pattern_invalid" };
    }
    let maxMatches: number = V2_LIMITS.SEARCH_MAX_MATCHES;
    if (request.maxMatches !== undefined) {
      const mm = Number(request.maxMatches);
      if (!Number.isInteger(mm) || mm < 1 || mm > V2_LIMITS.SEARCH_MAX_MATCHES) {
        return { ok: false, error: "max_matches_invalid" };
      }
      maxMatches = mm;
    }
    return { ok: true, projectId, path, pattern: request.pattern, maxMatches };
  }

  const { path } = request;
  if (!isBoundedString(path, V2_LIMITS.PATH_MAX, 1)) {
    return { ok: false, error: "path_invalid" };
  }
  if (!isCanonicalRelativePath(path)) {
    return { ok: false, error: "path_invalid" };
  }
  return { ok: true, projectId, path };
}