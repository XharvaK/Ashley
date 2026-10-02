/**
 * Sandbox V2 M5 authorship executor.
 *
 * Seals a candidate change-set identity from an existing M3 workspace versus
 * its recorded immutable sanitized base. Does not write the durable
 * candidate, the live repository, or Git refs.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAuthorshipAllowed } from "@composer-assistant/sandbox-policy";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";
import { V2_LIMITS } from "../limits.js";
import type { V2ProjectReadRegistry } from "../registry.js";
import {
  WorkspaceManager,
  resolveDefaultManagedWorkspaceRoot,
} from "../workspace/workspace-manager.js";
import {
  bindCandidateSnapshot,
  computeProvisionalCandidateTreeHash,
  PROVISIONAL_TREE_HASH_ALGORITHM,
} from "../verification/snapshot.js";
import type {
  SandboxV2Result,
  SandboxV2WorkspaceAuthorRequest,
} from "../v2-types.js";
import { candidateContainsGitMetadata, collectTreeRecords } from "./tree.js";
import { diffCandidateAgainstBase } from "./diff.js";
import { validateRecordedGitBase, renderNativeGitPatch } from "./native-git.js";
import { scanAuthorshipText } from "./secret-scan.js";

export type CandidateAuthorshipExecutorOptions = {
  registry: V2ProjectReadRegistry;
  protectedRoots?: ProtectedRootsConfig;
  workspaceManager?: WorkspaceManager;
  managedWorkspaceRoot?: string;
  settlementDeadlineAtMs?: number;
  clock?: { nowMs(): number };
};

const FORBIDDEN_REQUEST_KEYS = [
  "command",
  "argv",
  "executable",
  "env",
  "network",
  "shell",
  "cwd",
  "patch",
  "diff",
  "content",
  "apply",
  "commit",
  "merge",
  "deploy",
] as const;

const ALLOWED_REQUEST_KEYS = new Set([
  "version",
  "operation",
  "projectId",
  "workspaceId",
  "intendedPaths",
]);

function nowMs(clock?: { nowMs(): number }): number {
  return clock?.nowMs() ?? Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateChangesetAuthorRequest(
  value: unknown,
): { ok: true; request: SandboxV2WorkspaceAuthorRequest } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "invalid-request" };
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return { ok: false, error: "unsupported_operation" };
    }
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      return { ok: false, error: "unsupported_operation" };
    }
  }
  if (value.version !== 2) return { ok: false, error: "invalid-request" };
  if (value.operation !== "changeset.author") {
    return { ok: false, error: "unsupported_operation" };
  }
  if (typeof value.projectId !== "string" || value.projectId.length < 1 || value.projectId.length > 128) {
    return { ok: false, error: "invalid-request" };
  }
  if (
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length < 8 ||
    value.workspaceId.length > 128
  ) {
    return { ok: false, error: "invalid-request" };
  }
  let intendedPaths: string[] | undefined;
  if (value.intendedPaths !== undefined) {
    if (!Array.isArray(value.intendedPaths) || value.intendedPaths.length > V2_LIMITS.CHANGESET_MAX_PATHS) {
      return { ok: false, error: "invalid-request" };
    }
    intendedPaths = [];
    for (const item of value.intendedPaths) {
      if (typeof item !== "string" || item.length < 1 || item.length > V2_LIMITS.CHANGESET_PATH_MAX) {
        return { ok: false, error: "invalid-request" };
      }
      if (item.startsWith("/") || item.includes("\\") || item.split("/").includes("..")) {
        return { ok: false, error: "invalid-request" };
      }
      intendedPaths.push(item);
    }
  }
  return {
    ok: true,
    request: {
      version: 2,
      operation: "changeset.author",
      projectId: value.projectId,
      workspaceId: value.workspaceId,
      ...(intendedPaths ? { intendedPaths } : {}),
    },
  };
}

export async function executeCandidateAuthorship(
  request: SandboxV2WorkspaceAuthorRequest,
  options: CandidateAuthorshipExecutorOptions,
): Promise<SandboxV2Result> {
  const executedAtMs = nowMs(options.clock);
  const fail = (error: string): SandboxV2Result => ({
    outcome: "failed",
    operation: "changeset.author",
    error,
    executedAtMs,
  });

  if (
    typeof options.settlementDeadlineAtMs === "number" &&
    options.settlementDeadlineAtMs <= executedAtMs
  ) {
    return fail("deadline_exceeded");
  }

  const parsed = validateChangesetAuthorRequest(request);
  if (!parsed.ok) return fail(parsed.error);

  const resolved = options.registry.resolveReadRoot(parsed.request.projectId);
  if (!resolved.ok) return fail("authorship_not_allowed");
  if (!isAuthorshipAllowed(resolved.entry)) return fail("authorship_not_allowed");

  const manager =
    options.workspaceManager ??
    new WorkspaceManager({
      managedRoot: options.managedWorkspaceRoot ?? resolveDefaultManagedWorkspaceRoot(),
    });
  const acquisition = manager.resumeExistingWorkspace(
    {
      projectId: parsed.request.projectId,
      canonicalRoot: resolved.entry.canonicalRoot,
      protectedRoots: options.protectedRoots,
    },
    parsed.request.workspaceId,
  );
  if (!acquisition.ok) return fail(acquisition.error);

  const treeRoot = acquisition.workspaceTreeRoot;
  if (candidateContainsGitMetadata(treeRoot)) {
    return fail("git_metadata_in_candidate");
  }
  const workspaceRoot = join(manager.managedRoot, acquisition.workspaceId);
  const base = validateRecordedGitBase({ sourceRoot: resolved.entry.canonicalRoot, workspaceRoot,
    record: acquisition.manifest.gitBase, workspaceId: acquisition.workspaceId,
    projectId: parsed.request.projectId, sourceSnapshotId: acquisition.manifest.sourceSnapshotId });
  if (!base.ok) return fail(base.error);

  const beforeHash = computeProvisionalCandidateTreeHash(treeRoot);
  const snapshot = bindCandidateSnapshot({
    workspaceId: acquisition.workspaceId,
    projectId: parsed.request.projectId,
    sourceSnapshotId: acquisition.manifest.sourceSnapshotId,
    treeRoot,
  });
  if (snapshot.candidateTreeHash !== beforeHash) {
    return fail("snapshot_mismatch");
  }

  const viewRoot = base.baseTreeRoot;
  try {
    const baseRecords = collectTreeRecords(viewRoot);
    const candidateRecords = collectTreeRecords(treeRoot);
    const diff = diffCandidateAgainstBase({
      base: baseRecords,
      candidate: candidateRecords,
      intendedPaths: parsed.request.intendedPaths,
    });
    if (!diff.ok) return fail(diff.error);

    // Scan admitted candidate bytes before binary encoding can conceal secret shapes.
    for (const change of diff.changes) {
      for (const root of [viewRoot, treeRoot]) {
        const path = join(root, change.path);
        if (existsSync(path) && scanAuthorshipText(readFileSync(path).toString("utf8")).hit) return fail("secret_detected");
      }
    }
    const native = renderNativeGitPatch({ workspaceRoot, candidateRoot: treeRoot, baseTree: base.record.sanitizedTree });
    const secret = scanAuthorshipText(native.patch.toString("utf8"));
    if (secret.hit) {
      return fail("secret_detected");
    }

    const changesetId = `cs_${randomBytes(16).toString("hex")}`;
    const controlDir = join(manager.managedRoot, "_control", "changesets", changesetId);
    mkdirSync(controlDir, { recursive: true, mode: 0o700 });
    const artifactPath = join(controlDir, "sealed.patch");
    writeFileSync(artifactPath, native.patch, { mode: 0o600 });

    const afterHash = computeProvisionalCandidateTreeHash(treeRoot);
    if (afterHash !== beforeHash) {
      return {
        outcome: "failed",
        operation: "changeset.author",
        error: "candidate_mutated",
        executedAtMs: nowMs(options.clock),
      };
    }
    if (options.settlementDeadlineAtMs !== undefined && nowMs(options.clock) >= options.settlementDeadlineAtMs) return fail("deadline_exceeded");
    const finalBase = validateRecordedGitBase({ sourceRoot: resolved.entry.canonicalRoot, workspaceRoot,
      record: base.record, workspaceId: acquisition.workspaceId, projectId: parsed.request.projectId,
      sourceSnapshotId: acquisition.manifest.sourceSnapshotId });
    if (!finalBase.ok) return fail(finalBase.error);
    if (!existsSync(artifactPath)) {
      return fail("artifact_missing");
    }

    const patchSha256 = createHash("sha256").update(native.patch).digest("hex");
    const baseTreeHash = computeProvisionalCandidateTreeHash(viewRoot);

    return {
      outcome: "succeeded",
      operation: "changeset.author",
      executedAtMs: nowMs(options.clock),
      result: {
        kind: "changeset.author",
        changesetId,
        changesetVersion: 1,
        projectId: parsed.request.projectId,
        workspaceId: acquisition.workspaceId,
        snapshotId: snapshot.snapshotId,
        sourceSnapshotId: acquisition.manifest.sourceSnapshotId,
        candidateTreeHash: beforeHash,
        baseTreeHash,
        baseCommit: base.record.baseCommit,
        sourceCleanliness: "clean",
        baseGitTree: base.record.sanitizedTree,
        sourceGitTree: base.record.sourceTree,
        candidateGitTree: native.candidateGitTree,
        treeHashAlgorithm: PROVISIONAL_TREE_HASH_ALGORITHM,
        changedPaths: diff.changes,
        patchSha256,
        patchBytes: native.patch.length,
        artifactRef: artifactPath,
        candidateUnchanged: true,
        liveUnwritten: true,
        protocolState: "admitted",
        completedAtMs: nowMs(options.clock),
      },
    };
  } catch (error) {
    const known = error instanceof Error && ["candidate_file_type_forbidden", "changeset_too_large"].includes(error.message);
    return fail(known ? (error as Error).message : "native_git_render_failed");
  }
}
