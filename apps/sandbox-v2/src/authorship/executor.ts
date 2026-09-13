/**
 * Sandbox V2 M5 authorship executor.
 *
 * Seals a candidate change-set identity from an existing M3 workspace versus
 * an ephemeral sanitized live projection. Does not write the durable
 * candidate, the live repository, or Git refs.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAuthorshipAllowed } from "@composer-assistant/sandbox-policy";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";
import { V2_LIMITS } from "../limits.js";
import type { V2ProjectReadRegistry } from "../registry.js";
import {
  buildSanitizedProjectView,
  removeProjectView,
} from "../project-inspection/source-view.js";
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
import { readParentGitIdentity } from "./git-identity.js";
import { scanAuthorshipText } from "./secret-scan.js";

export type CandidateAuthorshipExecutorOptions = {
  registry: V2ProjectReadRegistry;
  protectedRoots?: ProtectedRootsConfig;
  workspaceManager?: WorkspaceManager;
  managedWorkspaceRoot?: string;
  viewBuilder?: typeof buildSanitizedProjectView;
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

  const viewBuilder = options.viewBuilder ?? buildSanitizedProjectView;
  let viewRoot: string | undefined;
  try {
    const view = await viewBuilder({
      canonicalRoot: resolved.entry.canonicalRoot,
      protectedRoots: options.protectedRoots ?? {
        delegatedWriteDeniedOwnerApprovable: [],
        absoluteDenial: [],
      },
    });
    if (!view.ok) return fail(view.error);
    viewRoot = view.viewRoot;

    const baseRecords = collectTreeRecords(viewRoot);
    const candidateRecords = collectTreeRecords(treeRoot);
    const diff = diffCandidateAgainstBase({
      base: baseRecords,
      candidate: candidateRecords,
      intendedPaths: parsed.request.intendedPaths,
    });
    if (!diff.ok) return fail(diff.error);

    const secret = scanAuthorshipText(diff.patchUtf8);
    if (secret.hit) {
      return fail("secret_detected");
    }

    const gitIdentity = readParentGitIdentity(resolved.entry.canonicalRoot);
    const changesetId = `cs_${randomBytes(16).toString("hex")}`;
    const controlDir = join(manager.managedRoot, "_control", "changesets", changesetId);
    mkdirSync(controlDir, { recursive: true, mode: 0o700 });
    const artifactPath = join(controlDir, "sealed.patch");
    writeFileSync(artifactPath, diff.patchUtf8, { encoding: "utf8", mode: 0o600 });

    const afterHash = computeProvisionalCandidateTreeHash(treeRoot);
    if (afterHash !== beforeHash) {
      return {
        outcome: "failed",
        operation: "changeset.author",
        error: "candidate_mutated",
        executedAtMs: nowMs(options.clock),
      };
    }
    if (!existsSync(artifactPath)) {
      return fail("artifact_missing");
    }

    const patchSha256 = createHash("sha256").update(diff.patchUtf8, "utf8").digest("hex");
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
        baseCommit: gitIdentity.baseCommit,
        sourceCleanliness: gitIdentity.sourceCleanliness,
        treeHashAlgorithm: PROVISIONAL_TREE_HASH_ALGORITHM,
        changedPaths: diff.changes,
        patchSha256,
        patchBytes: Buffer.byteLength(diff.patchUtf8, "utf8"),
        artifactRef: artifactPath,
        candidateUnchanged: true,
        liveUnwritten: true,
        protocolState: "admitted",
        completedAtMs: nowMs(options.clock),
      },
    };
  } finally {
    if (viewRoot) removeProjectView(viewRoot);
  }
}
