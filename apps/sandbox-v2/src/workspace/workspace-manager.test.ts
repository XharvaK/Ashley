import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { WorkspaceManager, type AuthorizedProjectExecutionContext } from "./workspace-manager.js";

describe("Stage 2 — WorkspaceManager Lifecycle", () => {
  let testRoot: string;
  let managedRoot: string;
  let sourceRoot: string;
  let manager: WorkspaceManager;

  beforeEach(() => {
    testRoot = join(tmpdir(), `ashley-ws-test-${randomBytes(8).toString("hex")}`);
    managedRoot = join(testRoot, "managed-workspaces");
    sourceRoot = join(testRoot, "mock-project");

    mkdirSync(managedRoot, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });

    // Seed mock project files
    writeFileSync(join(sourceRoot, "package.json"), '{"name": "test-project"}', "utf8");
    mkdirSync(join(sourceRoot, "src"), { recursive: true });
    writeFileSync(join(sourceRoot, "src", "index.ts"), 'console.log("hello");', "utf8");

    manager = new WorkspaceManager({ managedRoot });
  });

  afterEach(() => {
    try {
      if (existsSync(testRoot)) {
        rmSync(testRoot, { recursive: true, force: true });
      }
    } catch {}
  });

  const context: AuthorizedProjectExecutionContext = {
    projectId: "project-ashley",
    canonicalRoot: "", // filled in tests
  };

  it("creates a candidate workspace failure-atomically from sanitized source projection", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const result = await manager.acquireWorkspace(ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.isNew).toBe(true);
    expect(result.workspaceId).toBeTruthy();
    expect(result.manifest.schemaVersion).toBe(2);
    expect(result.manifest.projectId).toBe("project-ashley");
    expect(result.manifest.workspaceId).toBe(result.workspaceId);
    expect(result.manifest.sourceSnapshotId).toMatch(/^snap_/);
    // Provenance must NEVER expose a host filesystem path
    expect(result.manifest.sourceSnapshotId).not.toContain(sourceRoot);
    expect(result.manifest.sourceSnapshotId).not.toContain("mock-project");

    // Verify filesystem layout
    const workspaceDir = join(managedRoot, result.workspaceId);
    expect(existsSync(workspaceDir)).toBe(true);
    expect(existsSync(join(workspaceDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(workspaceDir, "tree"))).toBe(true);
    expect(existsSync(join(workspaceDir, "tree", "package.json"))).toBe(true);
    expect(existsSync(join(workspaceDir, "tree", "src", "index.ts"))).toBe(true);

    // Verify manifest is outside tree
    expect(existsSync(join(workspaceDir, "tree", "manifest.json"))).toBe(false);
  });

  it("resumes an existing candidate workspace with valid lineage", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const createResult = await manager.acquireWorkspace(ctx);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const workspaceId = createResult.workspaceId;

    // Mutate a file in the workspace tree to verify state is preserved
    writeFileSync(join(createResult.workspaceTreeRoot, "src", "index.ts"), 'console.log("mutated");', "utf8");

    // Resume workspace
    const resumeResult = await manager.acquireWorkspace(ctx, workspaceId);
    expect(resumeResult.ok).toBe(true);
    if (!resumeResult.ok) return;

    expect(resumeResult.isNew).toBe(false);
    expect(resumeResult.workspaceId).toBe(workspaceId);
    expect(resumeResult.manifest.workspaceId).toBe(workspaceId);
    expect(readFileSync(join(resumeResult.workspaceTreeRoot, "src", "index.ts"), "utf8")).toBe('console.log("mutated");');
  });

  it("resumeExistingWorkspace never creates a missing workspace", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const created = await manager.acquireWorkspace(ctx);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const missing = manager.resumeExistingWorkspace(ctx, "nonexistent-workspace-id");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("workspace_not_found");

    const resumed = manager.resumeExistingWorkspace(ctx, created.workspaceId);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.isNew).toBe(false);
    expect(resumed.workspaceId).toBe(created.workspaceId);
  });

  it("fails closed on non-existent workspace resume", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const result = await manager.acquireWorkspace(ctx, "nonexistent-workspace-id");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("workspace_not_found");
  });

  it("fails closed on cross-project workspace resume (project lineage mismatch)", async () => {
    const ctx1 = { ...context, projectId: "project-1", canonicalRoot: sourceRoot };
    const createResult = await manager.acquireWorkspace(ctx1);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Attempt to resume project-1's workspace under project-2
    const ctx2 = { ...context, projectId: "project-2", canonicalRoot: sourceRoot };
    const resumeResult = await manager.acquireWorkspace(ctx2, createResult.workspaceId);
    expect(resumeResult.ok).toBe(false);
    if (resumeResult.ok) return;
    expect(resumeResult.error).toBe("workspace_project_mismatch");
  });

  it("fails closed on corrupt manifest or missing tree", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const createResult = await manager.acquireWorkspace(ctx);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const workspaceDir = join(managedRoot, createResult.workspaceId);

    // 1. Corrupt manifest JSON
    writeFileSync(join(workspaceDir, "manifest.json"), "invalid json", "utf8");
    const res1 = await manager.acquireWorkspace(ctx, createResult.workspaceId);
    expect(res1.ok).toBe(false);
    if (res1.ok) return;
    expect(res1.error).toBe("workspace_corrupt");

    // 2. Missing tree directory
    writeFileSync(join(workspaceDir, "manifest.json"), JSON.stringify(createResult.manifest), "utf8");
    rmSync(join(workspaceDir, "tree"), { recursive: true, force: true });
    const res2 = await manager.acquireWorkspace(ctx, createResult.workspaceId);
    expect(res2.ok).toBe(false);
    if (res2.ok) return;
    expect(res2.error).toBe("workspace_corrupt");
  });

  it("rejects malicious workspaceId attempts escaping managed root", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const res = await manager.acquireWorkspace(ctx, "../../../etc/passwd");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("invalid_workspace_id");
  });

  it("source drift does not invalidate or alter candidate workspace", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const createResult = await manager.acquireWorkspace(ctx);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Simulate upstream repository drift
    writeFileSync(join(sourceRoot, "src", "new_source.ts"), "export const drift = true;", "utf8");

    // Resume candidate workspace
    const resumeResult = await manager.acquireWorkspace(ctx, createResult.workspaceId);
    expect(resumeResult.ok).toBe(true);
    if (!resumeResult.ok) return;

    // Upstream drift must NOT have leaked into or invalidated candidate workspace
    expect(existsSync(join(resumeResult.workspaceTreeRoot, "src", "new_source.ts"))).toBe(false);
  });

  it("lists project workspaces with newest lastUsedAt first", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const older = await manager.acquireWorkspace(ctx);
    expect(older.ok).toBe(true);
    if (!older.ok) return;
    const newer = await manager.acquireWorkspace(ctx);
    expect(newer.ok).toBe(true);
    if (!newer.ok) return;
    const listed = manager.listProjectWorkspaces("project-ashley");
    expect(listed.map((row) => row.workspaceId)).toEqual([
      newer.workspaceId,
      older.workspaceId,
    ]);
    expect(manager.listProjectWorkspaces("other-project")).toEqual([]);
  });

  it("skips corrupt manifests and never creates during list", async () => {
    const ctx = { ...context, canonicalRoot: sourceRoot };
    const created = await manager.acquireWorkspace(ctx);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = manager.listProjectWorkspaces("project-ashley").length;
    mkdirSync(join(managedRoot, "not-a-valid-id"), { recursive: true });
    writeFileSync(
      join(managedRoot, created.workspaceId, "manifest.json.bak"),
      "{}",
      "utf8",
    );
    const bogusDir = join(managedRoot, "AAAAAAAAAAAAAAAAAAAAAA");
    mkdirSync(bogusDir, { recursive: true });
    writeFileSync(
      join(bogusDir, "manifest.json"),
      JSON.stringify({
        schemaVersion: 2,
        workspaceId: "AAAAAAAAAAAAAAAAAAAAAA",
        projectId: "project-ashley",
        createdAt: "2026-01-01T00:00:00.000Z",
        sourceSnapshotId: "snap",
      }),
      "utf8",
    );
    const listed = manager.listProjectWorkspaces("project-ashley");
    expect(listed.map((row) => row.workspaceId)).toEqual([created.workspaceId]);
    expect(listed).toHaveLength(before);
    expect(existsSync(join(bogusDir, "tree"))).toBe(false);
  });
});
