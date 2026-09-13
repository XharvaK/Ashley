/**
 * Sanitized bounded source view builder (Sandbox V2 M2).
 *
 * The live repository is never ro-bound directly into Bubblewrap: doing so
 * would expose secret-shaped or otherwise excluded material. Instead a
 * disposable sanitized view is materialized with the already-proven
 * mandatory-exclusion contract (env files, key material, credentials,
 * dependency/build output, logs, databases, VCS metadata, broker-reserved
 * names) plus any protected roots strictly inside the source root, using the
 * deterministic lstat-first copy that never follows symlinks.
 *
 * The view is disposable and deleted by the executor in `finally`. Project
 * inspection never mutates the source tree and never writes to the view once
 * mounted (the mount itself is read-only).
 */

import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWorkspaceExclusionSet,
  copySanitizedTree,
  type TreeCopyLimits,
  type WorkspaceCopyCounts,
} from "@composer-assistant/sandbox-tree";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";
import { V2_LIMITS } from "../limits.js";

export const V2_VIEW_COPY_LIMITS: TreeCopyLimits = {
  maxFiles: V2_LIMITS.VIEW_MAX_FILES,
  maxBytes: V2_LIMITS.VIEW_MAX_BYTES,
  maxSingleFileBytes: V2_LIMITS.VIEW_MAX_SINGLE_FILE_BYTES,
  maxPathLength: V2_LIMITS.VIEW_MAX_PATH_LENGTH,
  maxDepth: V2_LIMITS.VIEW_MAX_DEPTH,
  maxExcludedEntries: V2_LIMITS.VIEW_MAX_EXCLUDED_ENTRIES,
};

export type ProjectSourceViewResult =
  | { ok: true; viewRoot: string; counts: WorkspaceCopyCounts }
  | { ok: false; error: string };

export function removeProjectView(viewRoot: string): void {
  try {
    rmSync(viewRoot, { recursive: true, force: true });
  } catch {}
}

/**
 * Materialize the sanitized read-only source view for a resolved project
 * root. The caller must already have resolved the projectId through the
 * operator-owned registry (this function never sees a projectId).
 */
export async function buildSanitizedProjectView(options: {
  canonicalRoot: string;
  protectedRoots: ProtectedRootsConfig;
  limits?: TreeCopyLimits;
  viewBase?: string;
  /** Cooperative absolute preparation cutoff threaded into the tree copier. */
  deadlineAtMs?: number;
  clock?: { nowMs(): number };
}): Promise<ProjectSourceViewResult> {
  const { canonicalRoot, protectedRoots, limits = V2_VIEW_COPY_LIMITS } = options;
  let sourceRoot: string;
  try {
    sourceRoot = realpathSync(canonicalRoot);
  } catch {
    return { ok: false, error: "root_unavailable" };
  }
  try {
    if (!statSync(sourceRoot).isDirectory()) {
      return { ok: false, error: "root_not_directory" };
    }
  } catch {
    return { ok: false, error: "root_unavailable" };
  }

  const viewRoot = mkdtempSync(join(options.viewBase ?? tmpdir(), "ashley-v2-view-"));
  const exclusionSet = buildWorkspaceExclusionSet(protectedRoots, sourceRoot);
  const result = await copySanitizedTree({
    sourceRoot,
    destinationRoot: viewRoot,
    exclusionSet,
    limits,
    symlinkPolicy: "skip",
    digests: false,
    ...(options.deadlineAtMs !== undefined
      ? { deadlineAtMs: options.deadlineAtMs }
      : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });

  if (!result.ok) {
    removeProjectView(viewRoot);
    return { ok: false, error: result.errorCode };
  }
  if (!existsSync(viewRoot)) {
    removeProjectView(viewRoot);
    return { ok: false, error: "view_unavailable" };
  }
  return { ok: true, viewRoot, counts: result.counts };
}