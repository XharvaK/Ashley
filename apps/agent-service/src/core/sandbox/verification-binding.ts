/**
 * Operator-owned M4 selector binding.
 *
 * Thought may name projectId, workspaceId, and recipeId, but those identifiers
 * are control-plane facts. When the owner asks to verify the current candidate
 * and there is exactly one current workspace plus one allowlisted recipe, the
 * runtime binds them. Thought must not invent ids, and the owner must not be
 * asked for opaque workspaceId/recipeId in that unique case.
 */

import { WorkspaceManager, type WorkspaceManifest } from "@composer-assistant/sandbox-v2";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";
import {
  loadOperatorProjectReadRegistry,
  type V2ProjectReadRegistry,
} from "./project-registry.js";

export type VerificationBindingError =
  | "no_current_workspace"
  | "ambiguous_current_workspace"
  | "no_allowed_recipe"
  | "ambiguous_recipe";

export type VerificationBindingResult =
  | { ok: true; workspaceId: string; recipeId: string }
  | { ok: false; error: VerificationBindingError };

export function uniqueCurrentWorkspaceId(
  workspaces: readonly WorkspaceManifest[],
): { ok: true; workspaceId: string } | { ok: false; error: VerificationBindingError } {
  if (workspaces.length === 0) {
    return { ok: false, error: "no_current_workspace" };
  }
  let latestUsed = workspaces[0]!.lastUsedAt;
  for (const row of workspaces) {
    if (row.lastUsedAt > latestUsed) latestUsed = row.lastUsedAt;
  }
  const ties = workspaces.filter((row) => row.lastUsedAt === latestUsed);
  if (ties.length !== 1) {
    return { ok: false, error: "ambiguous_current_workspace" };
  }
  return { ok: true, workspaceId: ties[0]!.workspaceId };
}

export function uniqueAllowedRecipeId(
  entry: ProjectRootEntry,
): { ok: true; recipeId: string } | { ok: false; error: VerificationBindingError } {
  const ids = entry.allowedRecipeIds ?? [];
  if (ids.length === 0) {
    return { ok: false, error: "no_allowed_recipe" };
  }
  if (ids.length !== 1) {
    return { ok: false, error: "ambiguous_recipe" };
  }
  return { ok: true, recipeId: ids[0]! };
}

export function resolveVerificationBinding(input: {
  projectId: string;
  workspaceId?: string;
  recipeId?: string;
  entry: ProjectRootEntry;
  workspaceManager?: WorkspaceManager;
}): VerificationBindingResult {
  const requestedWorkspace = input.workspaceId?.trim() ?? "";
  const requestedRecipe = input.recipeId?.trim() ?? "";

  let workspaceId = requestedWorkspace;
  if (!workspaceId) {
    const manager = input.workspaceManager ?? new WorkspaceManager();
    const current = uniqueCurrentWorkspaceId(manager.listProjectWorkspaces(input.projectId));
    if (!current.ok) return current;
    workspaceId = current.workspaceId;
  }

  let recipeId = requestedRecipe;
  if (!recipeId) {
    const unique = uniqueAllowedRecipeId(input.entry);
    if (!unique.ok) return unique;
    recipeId = unique.recipeId;
  }

  return { ok: true, workspaceId, recipeId };
}

export type VerificationResolvabilityStatus =
  | "currently_resolvable"
  | "no_current_workspace"
  | "ambiguous_current_workspace"
  | "no_allowed_recipe"
  | "ambiguous_recipe"
  | "verification_not_allowed";

export function assessVerificationResolvability(input: {
  projectId: string;
  entry: ProjectRootEntry;
  workspaceManager?: WorkspaceManager;
}): VerificationResolvabilityStatus {
  if (input.entry.verificationAllowed !== true) return "verification_not_allowed";
  const manager = input.workspaceManager ?? new WorkspaceManager();
  const current = uniqueCurrentWorkspaceId(manager.listProjectWorkspaces(input.projectId));
  if (!current.ok) return current.error;
  const recipe = uniqueAllowedRecipeId(input.entry);
  if (!recipe.ok) return recipe.error;
  return "currently_resolvable";
}

export function describeVerificationGrounding(
  projectIds: readonly string[],
  options?: { registry?: V2ProjectReadRegistry; workspaceManager?: WorkspaceManager },
): string {
  if (projectIds.length === 0) return "";
  const registry = options?.registry ?? loadOperatorProjectReadRegistry();
  const manager = options?.workspaceManager ?? new WorkspaceManager();
  const rows: string[] = [];
  for (const projectId of projectIds) {
    const resolved = registry.resolveReadRoot(projectId);
    if (!resolved.ok || resolved.entry.verificationAllowed !== true) continue;
    const status = assessVerificationResolvability({
      projectId,
      entry: resolved.entry,
      workspaceManager: manager,
    });
    if (status === "currently_resolvable") {
      rows.push(
        `${projectId}: candidate verification is currently resolvable. Emit candidate_verification with projectId only; omit workspaceId and recipeId. Do not ask the owner for control-plane identifiers.`,
      );
      continue;
    }
    if (status === "no_current_workspace") {
      rows.push(`${projectId}: no current candidate workspace exists.`);
      continue;
    }
    if (status === "ambiguous_current_workspace") {
      rows.push(
        `${projectId}: current candidate workspace is ambiguous; do not guess a workspaceId.`,
      );
      continue;
    }
    if (status === "no_allowed_recipe") {
      rows.push(`${projectId}: no mechanical verification recipe is bound.`);
      continue;
    }
    rows.push(
      `${projectId}: several mechanical recipes are bound; ask by recipe purpose, not opaque control-plane ids.`,
    );
  }
  if (rows.length === 0) return "";
  return [
    "Grounded verification resolvability (operator-owned control-plane facts; not owner-supplied magic words; opaque workspaceId/recipeId are not for the owner and need not appear in Thought output when currently resolvable):",
    ...rows,
    "Quality, goodness, or whether a change is 'good' is not mechanical verification. Emit candidate_verification only when mechanical recipe verification is the intended act.",
  ].join(" ");
}
