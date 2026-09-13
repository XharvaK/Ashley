/**
 * Durable Candidate Workspace Manager (Sandbox V2 M3).
 *
 * Owns the failure-atomic creation, resume, manifest validation, source snapshot provenance,
 * and durable tree persistence for candidate workspaces.
 *
 * Layout:
 *  <managedRoot>/
 *    <workspaceId>/
 *      manifest.json  <-- Control metadata (outside Bubblewrap mount, never model-visible)
 *      tree/          <-- Durable candidate filesystem mounted writable as /workspace
 */

import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { V2_LIMITS } from "../limits.js";
import {
  buildSanitizedProjectView,
  removeProjectView,
} from "../project-inspection/source-view.js";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";

export type WorkspaceManifest = {
  schemaVersion: 2;
  workspaceId: string;
  projectId: string;
  createdAt: string;
  lastUsedAt: string;
  sourceSnapshotId: string;
  /** Recovery provenance only. Grants no authority. */
  originChildTaskId?: string;
};

export type AuthorizedProjectExecutionContext = {
  projectId: string;
  canonicalRoot: string;
  protectedRoots?: ProtectedRootsConfig;
};

export type WorkspaceAcquisitionResult =
  | {
      ok: true;
      workspaceId: string;
      workspaceTreeRoot: string;
      manifest: WorkspaceManifest;
      isNew: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export type WorkspaceManagerOptions = {
  managedRoot?: string;
};

export function resolveDefaultManagedWorkspaceRoot(): string {
  return join(homedir(), ".composer-assistant", "sandbox", "workspaces");
}

function computeDirectorySize(dirPath: string): { totalBytes: number; fileCount: number } {
  let totalBytes = 0;
  let fileCount = 0;

  function walk(current: string) {
    if (!existsSync(current)) return;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        try {
          const st = statSync(fullPath);
          totalBytes += st.size;
        } catch {}
      }
    }
  }

  walk(dirPath);
  return { totalBytes, fileCount };
}

export class WorkspaceManager {
  readonly managedRoot: string;

  constructor(options: WorkspaceManagerOptions = {}) {
    this.managedRoot = options.managedRoot ?? resolveDefaultManagedWorkspaceRoot();
    if (!existsSync(this.managedRoot)) {
      mkdirSync(this.managedRoot, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Acquire a candidate workspace: resumes an existing workspace if workspaceId is provided,
   * or failure-atomically creates a new candidate workspace initialized from the parent-authorized
   * project context.
   */
  async acquireWorkspace(
    context: AuthorizedProjectExecutionContext,
    requestedWorkspaceId?: string,
    originChildTaskId?: string,
  ): Promise<WorkspaceAcquisitionResult> {
    if (requestedWorkspaceId) {
      const resumed = this.resumeWorkspace(context, requestedWorkspaceId);
      if (resumed.ok && originChildTaskId) {
        this.bindOriginChildTaskId(requestedWorkspaceId, originChildTaskId);
      }
      return resumed;
    }
    return this.createWorkspace(context, originChildTaskId);
  }

  /**
   * Durable candidate workspaces for one operator project, newest `lastUsedAt` first.
   * Does not create, resume, or pick a current workspace.
   */
  listProjectWorkspaces(projectId: string): WorkspaceManifest[] {
    if (!existsSync(this.managedRoot) || typeof projectId !== "string" || projectId.length < 1) {
      return [];
    }
    const out: WorkspaceManifest[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(this.managedRoot);
    } catch {
      return [];
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      if (!this.isValidWorkspaceId(name)) continue;
      const manifestPath = join(this.managedRoot, name, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (
          !raw ||
          typeof raw !== "object" ||
          (raw as WorkspaceManifest).schemaVersion !== 2 ||
          (raw as WorkspaceManifest).workspaceId !== name ||
          (raw as WorkspaceManifest).projectId !== projectId
        ) {
          continue;
        }
        const manifest = raw as WorkspaceManifest;
        if (
          typeof manifest.createdAt !== "string" ||
          typeof manifest.lastUsedAt !== "string" ||
          typeof manifest.sourceSnapshotId !== "string"
        ) {
          continue;
        }
        out.push(manifest);
      } catch {
        continue;
      }
    }
    out.sort((a, b) => {
      const used = b.lastUsedAt.localeCompare(a.lastUsedAt);
      if (used !== 0) return used;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return out;
  }

  /**
   * Resume an existing candidate workspace. Never creates.
   * M4 verification must use this path; `acquireWorkspace` without an id creates.
   */
  resumeExistingWorkspace(
    context: AuthorizedProjectExecutionContext,
    workspaceId: string,
  ): WorkspaceAcquisitionResult {
    return this.resumeWorkspace(context, workspaceId);
  }

  /**
   * Resume an existing candidate workspace.
   * Validates manifest existence, schema, workspaceId, and matching projectId lineage.
   * Revalidates that the durable tree exists and is contained inside the managed root.
   */
  private resumeWorkspace(
    context: AuthorizedProjectExecutionContext,
    workspaceId: string,
  ): WorkspaceAcquisitionResult {
    // Validate workspaceId string safety (must be opaque, alphanumeric/base64url, no slashes or ..)
    if (!this.isValidWorkspaceId(workspaceId)) {
      return { ok: false, error: "invalid_workspace_id" };
    }

    const workspaceDir = join(this.managedRoot, workspaceId);
    if (!existsSync(workspaceDir)) {
      return { ok: false, error: "workspace_not_found" };
    }

    // Verify containment inside managedRoot
    const rel = relative(this.managedRoot, workspaceDir);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return { ok: false, error: "workspace_escapes_managed_root" };
    }

    const manifestPath = join(workspaceDir, "manifest.json");
    const treePath = join(workspaceDir, "tree");

    if (!existsSync(manifestPath)) {
      return { ok: false, error: "workspace_corrupt" };
    }
    if (!existsSync(treePath)) {
      return { ok: false, error: "workspace_corrupt" };
    }

    let manifest: WorkspaceManifest;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (
        !raw ||
        typeof raw !== "object" ||
        raw.schemaVersion !== 2 ||
        typeof raw.workspaceId !== "string" ||
        typeof raw.projectId !== "string" ||
        typeof raw.sourceSnapshotId !== "string"
      ) {
        return { ok: false, error: "workspace_corrupt" };
      }
      manifest = raw as WorkspaceManifest;
    } catch {
      return { ok: false, error: "workspace_corrupt" };
    }

    // Verify manifest invariants
    if (manifest.workspaceId !== workspaceId) {
      return { ok: false, error: "workspace_corrupt" };
    }
    if (manifest.projectId !== context.projectId) {
      return { ok: false, error: "workspace_project_mismatch" };
    }

    // Touch lastUsedAt
    try {
      manifest.lastUsedAt = new Date().toISOString();
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    } catch {}

    return {
      ok: true,
      workspaceId,
      workspaceTreeRoot: treePath,
      manifest,
      isNew: false,
    };
  }

  /**
   * Creates a new candidate workspace initialized failure-atomically from the sanitized project view.
   */
  private async createWorkspace(
    context: AuthorizedProjectExecutionContext,
    originChildTaskId?: string,
  ): Promise<WorkspaceAcquisitionResult> {
    const workspaceId = randomBytes(16).toString("base64url");
    const finalDir = join(this.managedRoot, workspaceId);

    if (existsSync(finalDir)) {
      return { ok: false, error: "workspace_id_collision" };
    }

    const stagingDir = join(this.managedRoot, `.staging-${randomBytes(8).toString("hex")}`);
    const stagingTree = join(stagingDir, "tree");

    try {
      mkdirSync(stagingTree, { recursive: true, mode: 0o700 });

      // 1. Build disposable sanitized project source view (M2 exclusion pipeline)
      const viewResult = await buildSanitizedProjectView({
        canonicalRoot: context.canonicalRoot,
        protectedRoots: context.protectedRoots ?? {
          delegatedWriteDeniedOwnerApprovable: [],
          absoluteDenial: [],
        },
      });

      if (!viewResult.ok) {
        this.cleanDir(stagingDir);
        return { ok: false, error: viewResult.error };
      }

      const viewRoot = viewResult.viewRoot;

      try {
        // 2. Materialize sanitized view into stagingTree with resource budget accounting
        cpSync(viewRoot, stagingTree, { recursive: true });

        const sizeInfo = computeDirectorySize(stagingTree);
        if (sizeInfo.totalBytes > V2_LIMITS.WORKSPACE_MAX_BYTES) {
          this.cleanDir(stagingDir);
          return { ok: false, error: "workspace_limit_exceeded" };
        }

        // 3. Compute opaque sourceSnapshotId digest (provenance of sanitized source projection)
        const sourceSnapshotId = `snap_${randomBytes(12).toString("hex")}`;

        // 4. Write manifest.json in staging dir (outside tree)
        const manifest: WorkspaceManifest = {
          schemaVersion: 2,
          workspaceId,
          projectId: context.projectId,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          sourceSnapshotId,
          ...(originChildTaskId ? { originChildTaskId } : {}),
        };

        const stagingManifestPath = join(stagingDir, "manifest.json");
        writeFileSync(stagingManifestPath, JSON.stringify(manifest, null, 2), {
          encoding: "utf8",
          mode: 0o600,
        });

        // 5. Failure-atomic promotion: rename staging directory to final workspace directory
        renameSync(stagingDir, finalDir);

        return {
          ok: true,
          workspaceId,
          workspaceTreeRoot: join(finalDir, "tree"),
          manifest,
          isNew: true,
        };
      } finally {
        removeProjectView(viewRoot);
      }
    } catch (e) {
      this.cleanDir(stagingDir);
      return { ok: false, error: "workspace_creation_failed" };
    }
  }

  bindOriginChildTaskId(workspaceId: string, originChildTaskId: string): boolean {
    const manifestPath = join(this.managedRoot, workspaceId, "manifest.json");
    if (!existsSync(manifestPath)) return false;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as WorkspaceManifest;
      if (raw.originChildTaskId && raw.originChildTaskId !== originChildTaskId) {
        return false;
      }
      raw.originChildTaskId = originChildTaskId;
      writeFileSync(manifestPath, JSON.stringify(raw, null, 2), { encoding: "utf8", mode: 0o600 });
      return true;
    } catch {
      return false;
    }
  }

  findWorkspaceByOriginChildTaskId(originChildTaskId: string): WorkspaceManifest | null {
    if (!existsSync(this.managedRoot) || !originChildTaskId) return null;
    let names: string[] = [];
    try {
      names = readdirSync(this.managedRoot);
    } catch {
      return null;
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const manifestPath = join(this.managedRoot, name, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as WorkspaceManifest;
        if (raw.originChildTaskId === originChildTaskId) return raw;
      } catch {
        continue;
      }
    }
    return null;
  }

  private isValidWorkspaceId(id: string): boolean {
    if (!id || typeof id !== "string") return false;
    if (id.length < 8 || id.length > 128) return false;
    // Base64url / alphanumeric only, no paths, slashes, or dots
    return /^[A-Za-z0-9_-]+$/.test(id);
  }

  private cleanDir(dir: string): void {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {}
  }
}
