/**
 * Durable allowlisted project-root registry (Autonomous Engineering
 * Workstation wave).
 *
 * Project roots are host/operator configuration. The model can never create or
 * widen a project root. This module is pure: it validates registry shape and
 * classifies access requests against the allowlisted canonical roots. The
 * broker performs the realpath / symlink-escape checks before trusting any
 * path; this classifier only reasons about already-canonical roots.
 */

import { isCanonicalForm, isWithin } from "./canonical-paths.js";

export type ProjectRootEntry = {
  projectId: string;
  canonicalRoot: string;
  displayName: string;
  enabled: boolean;
  readAllowed: boolean;
  candidateWorkspaceAllowed: boolean;
  engineeringAllowed: boolean;
  /**
   * M4 verification grant. Missing/false means verification is refused.
   * Independent of engineeringAllowed. Normalized to false when absent.
   */
  verificationAllowed?: boolean;
  /**
   * Explicit recipe allowlist. Missing or empty means no recipe is admitted.
   * Independent of the operator catalog; a catalog hit is not a project grant.
   */
  allowedRecipeIds?: readonly string[];
  /**
   * M5 authorship grant. Missing/false means candidate change-set sealing is
   * refused. Independent of engineeringAllowed, candidateWorkspaceAllowed, and
   * verificationAllowed.
   */
  authorshipAllowed?: boolean;
  /**
   * M6 bounded-operation grant. Missing/false means an admitted finite
   * M3/M4/M5 sequence is refused. Independent of engineeringAllowed,
   * candidateWorkspaceAllowed, verificationAllowed, and authorshipAllowed.
   */
  operationAllowed?: boolean;
  /**
   * M7 patch_export grant. Missing/false means sealed-artifact export is
   * refused. Independent of authorshipAllowed, operationAllowed, and
   * engineeringAllowed. Requires exportDestinationCanonicalRoot.
   */
  patchExportAllowed?: boolean;
  /**
   * Operator-bound review destination for patch_export. Canonical absolute
   * POSIX directory. The model cannot supply this path.
   */
  exportDestinationCanonicalRoot?: string;
};

export type ProjectRootRegistry = {
  /** Keyed by projectId. */
  entries: ReadonlyMap<string, ProjectRootEntry>;
  /** Precomputed canonical roots for membership checks. */
  roots: ReadonlyArray<string>;
};

export type ProjectRootRegistryResult =
  | { ok: true; registry: ProjectRootRegistry }
  | { ok: false; reasons: string[] };

const FORBIDDEN_ROOT_PATTERNS = [
  "/",
  "/home",
  "/home/",
  "/root",
  "/Users",
  "/home/xarvak",
  "/home/xarvak/",
].filter(Boolean) as string[];

export function validateProjectRootRegistry(
  raw: ReadonlyArray<ProjectRootEntry>,
): ProjectRootRegistryResult {
  const reasons: string[] = [];
  const entries = new Map<string, ProjectRootEntry>();
  const roots: string[] = [];
  for (const entry of raw) {
    if (typeof entry.projectId !== "string" || entry.projectId.length === 0 || entry.projectId.length > 128) {
      reasons.push("project_id_invalid");
      continue;
    }
    if (typeof entry.canonicalRoot !== "string" || !isCanonicalForm(entry.canonicalRoot)) {
      reasons.push(`canonical_root_not_canonical:${String(entry.projectId)}`);
      continue;
    }
    for (const forbidden of FORBIDDEN_ROOT_PATTERNS) {
      if (forbidden && (entry.canonicalRoot === forbidden || isWithin(entry.canonicalRoot, forbidden))) {
        reasons.push(`generic_root_rejected:${entry.canonicalRoot}`);
      }
    }
    if (entries.has(entry.projectId)) {
      reasons.push(`duplicate_project_id:${entry.projectId}`);
      continue;
    }
    if (roots.includes(entry.canonicalRoot)) {
      reasons.push(`duplicate_canonical_root:${entry.canonicalRoot}`);
      continue;
    }
    const allowedRecipeIds = normalizeAllowedRecipeIds(entry.allowedRecipeIds);
    if (!allowedRecipeIds.ok) {
      reasons.push(`allowed_recipe_ids_invalid:${entry.projectId}`);
      continue;
    }
    if (entry.patchExportAllowed === true) {
      if (
        typeof entry.exportDestinationCanonicalRoot !== "string" ||
        !isCanonicalForm(entry.exportDestinationCanonicalRoot)
      ) {
        reasons.push(`export_destination_not_canonical:${String(entry.projectId)}`);
        continue;
      }
      if (FORBIDDEN_ROOT_PATTERNS.includes(entry.exportDestinationCanonicalRoot)) {
        reasons.push(`export_destination_forbidden:${String(entry.projectId)}`);
        continue;
      }
      if (
        entry.exportDestinationCanonicalRoot === entry.canonicalRoot ||
        isWithin(entry.canonicalRoot, entry.exportDestinationCanonicalRoot) ||
        isWithin(entry.exportDestinationCanonicalRoot, entry.canonicalRoot)
      ) {
        reasons.push(`export_destination_overlaps_live_root:${String(entry.projectId)}`);
        continue;
      }
    }
    const normalized: ProjectRootEntry = {
      projectId: entry.projectId,
      canonicalRoot: entry.canonicalRoot,
      displayName: entry.displayName ?? entry.projectId,
      enabled: entry.enabled !== false,
      readAllowed: entry.readAllowed !== false,
      candidateWorkspaceAllowed: entry.candidateWorkspaceAllowed === true,
      engineeringAllowed: entry.engineeringAllowed === true,
      verificationAllowed: entry.verificationAllowed === true,
      allowedRecipeIds: allowedRecipeIds.ids,
      authorshipAllowed: entry.authorshipAllowed === true,
      operationAllowed: entry.operationAllowed === true,
      patchExportAllowed: entry.patchExportAllowed === true,
      ...(entry.patchExportAllowed === true
        ? { exportDestinationCanonicalRoot: entry.exportDestinationCanonicalRoot }
        : {}),
    };
    entries.set(normalized.projectId, normalized);
    roots.push(normalized.canonicalRoot);
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, registry: { entries, roots } };
}

function normalizeAllowedRecipeIds(
  value: unknown,
): { ok: true; ids: readonly string[] } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, ids: Object.freeze([]) };
  }
  if (!Array.isArray(value)) return { ok: false };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length < 1 || item.length > 128) {
      return { ok: false };
    }
    ids.push(item);
  }
  return { ok: true, ids: Object.freeze(ids) };
}

export function isVerificationRecipeAllowed(
  entry: ProjectRootEntry,
  recipeId: string,
): boolean {
  if (entry.verificationAllowed !== true) return false;
  if (typeof recipeId !== "string" || recipeId.length < 1) return false;
  return (entry.allowedRecipeIds ?? []).includes(recipeId);
}

export function isAuthorshipAllowed(entry: ProjectRootEntry): boolean {
  return entry.authorshipAllowed === true;
}

export function isOperationAllowed(entry: ProjectRootEntry): boolean {
  return entry.operationAllowed === true;
}

export function isPatchExportAllowed(entry: ProjectRootEntry): boolean {
  return (
    entry.patchExportAllowed === true &&
    typeof entry.exportDestinationCanonicalRoot === "string" &&
    entry.exportDestinationCanonicalRoot.length > 0
  );
}

export type ProjectRootAccessKind = "read" | "workspace" | "engineering";

/**
 * Classify whether a canonical request path may be accessed under the given
 * intent for the named project. Returns the matched entry or a fail-closed
 * denial. `enabled` gates all access; the specific intent further gates.
 */
export function classifyProjectRootAccess(
  registry: ProjectRootRegistry,
  projectId: string,
  canonicalPath: string,
  kind: ProjectRootAccessKind,
):
  | { ok: true; entry: ProjectRootEntry }
  | { ok: false; reason: string } {
  const entry = registry.entries.get(projectId);
  if (!entry) return { ok: false, reason: "unknown_project" };
  if (!entry.enabled) return { ok: false, reason: "project_disabled" };
  if (!isCanonicalForm(canonicalPath)) return { ok: false, reason: "path_not_canonical" };
  if (!isWithin(entry.canonicalRoot, canonicalPath)) {
    return { ok: false, reason: "path_outside_project_root" };
  }
  if (kind === "read" && !entry.readAllowed) return { ok: false, reason: "read_not_allowed" };
  if (kind === "workspace" && !entry.candidateWorkspaceAllowed) {
    return { ok: false, reason: "workspace_not_allowed" };
  }
  if (kind === "engineering" && !entry.engineeringAllowed) {
    return { ok: false, reason: "engineering_not_allowed" };
  }
  return { ok: true, entry };
}
