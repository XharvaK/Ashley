import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { WorkspaceManager, type WorkspaceManifest } from "@composer-assistant/sandbox-v2";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";
import {
  describeVerificationGrounding,
  resolveVerificationBinding,
} from "./verification-binding.js";

const RECIPE = "typescript_fixture_compile_v1";

function entry(overrides: Partial<ProjectRootEntry> = {}): ProjectRootEntry {
  return {
    projectId: "project-ashley",
    canonicalRoot: "/tmp/project-ashley",
    displayName: "Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    engineeringAllowed: false,
    verificationAllowed: true,
    allowedRecipeIds: [RECIPE],
    ...overrides,
  };
}

describe("resolveVerificationBinding", () => {
  let testRoot: string;
  let manager: WorkspaceManager;
  let sourceRoot: string;

  beforeEach(() => {
    testRoot = join(tmpdir(), `ashley-bind-${randomBytes(8).toString("hex")}`);
    const managedRoot = join(testRoot, "workspaces");
    sourceRoot = join(testRoot, "project");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "package.json"), "{}", "utf8");
    manager = new WorkspaceManager({ managedRoot });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  it("binds omitted ids to unique last-used workspace and sole allowlisted recipe", async () => {
    const created = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const bound = resolveVerificationBinding({
      projectId: "project-ashley",
      entry: entry(),
      workspaceManager: manager,
    });
    expect(bound).toEqual({
      ok: true,
      workspaceId: created.workspaceId,
      recipeId: RECIPE,
    });
  });

  it("binds omitted workspace to the unique newest lastUsedAt when several historical workspaces exist", async () => {
    const older = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    const newer = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(older.ok && newer.ok).toBe(true);
    if (!older.ok || !newer.ok) return;
    const bound = resolveVerificationBinding({
      projectId: "project-ashley",
      entry: entry(),
      workspaceManager: manager,
    });
    expect(bound).toEqual({
      ok: true,
      workspaceId: newer.workspaceId,
      recipeId: RECIPE,
    });
    expect(bound.ok && bound.workspaceId).not.toBe(older.workspaceId);
  });

  it("does not replace an explicit workspace with a newer sibling", async () => {
    const older = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    const newer = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(older.ok && newer.ok).toBe(true);
    if (!older.ok || !newer.ok) return;
    const bound = resolveVerificationBinding({
      projectId: "project-ashley",
      workspaceId: older.workspaceId,
      entry: entry(),
      workspaceManager: manager,
    });
    expect(bound).toEqual({
      ok: true,
      workspaceId: older.workspaceId,
      recipeId: RECIPE,
    });
  });

  it("refuses omitted workspace when several share the latest lastUsedAt", () => {
    const at = "2026-08-23T20:47:01.875Z";
    const row = (workspaceId: string): WorkspaceManifest => ({
      schemaVersion: 2,
      workspaceId,
      projectId: "project-ashley",
      createdAt: at,
      lastUsedAt: at,
      sourceSnapshotId: "snap",
    });
    const bound = resolveVerificationBinding({
      projectId: "project-ashley",
      entry: entry(),
      workspaceManager: {
        listProjectWorkspaces: () => [row("ws-a"), row("ws-b")],
      } as unknown as WorkspaceManager,
    });
    expect(bound).toEqual({ ok: false, error: "ambiguous_current_workspace" });
  });

  it("refuses omitted workspace when none exist", () => {
    const bound = resolveVerificationBinding({
      projectId: "project-ashley",
      entry: entry(),
      workspaceManager: manager,
    });
    expect(bound).toEqual({ ok: false, error: "no_current_workspace" });
  });

  it("refuses omitted recipe when several recipes are allowlisted", async () => {
    const created = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(created.ok).toBe(true);
    const bound = resolveVerificationBinding({
      projectId: "project-ashley",
      entry: entry({ allowedRecipeIds: [RECIPE, "other_recipe"] }),
      workspaceManager: manager,
    });
    expect(bound).toEqual({ ok: false, error: "ambiguous_recipe" });
  });

  it("passes an explicit unallowlisted recipe through for execute to refuse", async () => {
    const created = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const bound = resolveVerificationBinding({
      projectId: "project-ashley",
      workspaceId: created.workspaceId,
      recipeId: "invented_recipe",
      entry: entry(),
      workspaceManager: manager,
    });
    expect(bound).toEqual({
      ok: true,
      workspaceId: created.workspaceId,
      recipeId: "invented_recipe",
    });
  });

  it("describes unique current workspace and sole recipe for Thought", async () => {
    const created = await manager.acquireWorkspace({
      projectId: "project-ashley",
      canonicalRoot: sourceRoot,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const text = describeVerificationGrounding(["project-ashley"], {
      workspaceManager: manager,
      registry: {
        resolveReadRoot: () => ({ ok: true, entry: entry() }),
      } as never,
    });
    expect(text).not.toContain(created.workspaceId);
    expect(text).not.toContain(RECIPE);
    expect(text).toContain("currently resolvable");
    expect(text).toContain("omit workspaceId and recipeId");
    expect(text).toContain("Do not ask the owner for control-plane identifiers");
  });
});
