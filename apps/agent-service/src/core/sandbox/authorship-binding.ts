/**
 * Operator-owned M5 selector binding.
 *
 * Thought may name projectId, workspaceId, objective, rationale, and riskClass,
 * but workspace identifiers are control-plane facts. When the owner asks to seal
 * the current candidate workspace and there is exactly one current workspace,
 * the runtime binds it. Thought must not invent IDs, and the owner must not be
 * asked for opaque workspaceId in that unique case.
 */

import { WorkspaceManager } from "@composer-assistant/sandbox-v2";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";
import {
  loadOperatorProjectReadRegistry,
  type V2ProjectReadRegistry,
} from "./project-registry.js";
import { uniqueCurrentWorkspaceId } from "./verification-binding.js";

export type AuthorshipBindingError =
  | "no_current_workspace"
  | "ambiguous_current_workspace";

export type AuthorshipBindingResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: AuthorshipBindingError };

export function resolveAuthorshipBinding(input: {
  projectId: string;
  workspaceId?: string;
  entry: ProjectRootEntry;
  workspaceManager?: WorkspaceManager;
}): AuthorshipBindingResult {
  const requestedWorkspace = input.workspaceId?.trim() ?? "";

  let workspaceId = requestedWorkspace;
  if (!workspaceId) {
    const manager = input.workspaceManager ?? new WorkspaceManager();
    const current = uniqueCurrentWorkspaceId(manager.listProjectWorkspaces(input.projectId));
    if (!current.ok) {
      return {
        ok: false,
        error:
          current.error === "ambiguous_current_workspace"
            ? "ambiguous_current_workspace"
            : "no_current_workspace",
      };
    }
    workspaceId = current.workspaceId;
  }

  return { ok: true, workspaceId };
}

export type AuthorshipResolvabilityStatus =
  | "currently_resolvable"
  | "no_current_workspace"
  | "ambiguous_current_workspace"
  | "authorship_not_allowed";

export function assessAuthorshipResolvability(input: {
  projectId: string;
  entry: ProjectRootEntry;
  workspaceManager?: WorkspaceManager;
}): AuthorshipResolvabilityStatus {
  if (input.entry.authorshipAllowed !== true) return "authorship_not_allowed";
  const manager = input.workspaceManager ?? new WorkspaceManager();
  const current = uniqueCurrentWorkspaceId(manager.listProjectWorkspaces(input.projectId));
  if (!current.ok) {
    return current.error === "ambiguous_current_workspace"
      ? "ambiguous_current_workspace"
      : "no_current_workspace";
  }
  return "currently_resolvable";
}

export function describeAuthorshipGrounding(
  projectIds: readonly string[],
  options?: { registry?: V2ProjectReadRegistry; workspaceManager?: WorkspaceManager },
): string {
  if (projectIds.length === 0) return "";
  const registry = options?.registry ?? loadOperatorProjectReadRegistry();
  const manager = options?.workspaceManager ?? new WorkspaceManager();
  const rows: string[] = [];
  for (const projectId of projectIds) {
    const resolved = registry.resolveReadRoot(projectId);
    if (!resolved.ok || resolved.entry.authorshipAllowed !== true) continue;
    const status = assessAuthorshipResolvability({
      projectId,
      entry: resolved.entry,
      workspaceManager: manager,
    });
    if (status === "currently_resolvable") {
      rows.push(
        `${projectId}: candidate authorship is currently resolvable. Emit candidate_authorship with projectId, objective, rationale, and riskClass; omit workspaceId unless targeting an explicit non-current workspace. Do not ask the owner for control-plane identifiers.`,
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
  }
  if (rows.length === 0) return "";
  return [
    "Grounded authorship resolvability (operator-owned control-plane facts; not owner-supplied magic words; opaque workspaceId is not for the owner and need not appear in Thought output when currently resolvable):",
    ...rows,
    "A sealed change-set is advisory candidate work. It is not applied, merged, or Ashley.",
  ].join(" ");
}
