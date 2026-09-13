import { describe, expect, it } from "vitest";
import {
  resolveAuthorshipBinding,
  assessAuthorshipResolvability,
  describeAuthorshipGrounding,
} from "./authorship-binding.js";
import { WorkspaceManager, type WorkspaceManifest } from "@composer-assistant/sandbox-v2";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";
import type { V2ProjectReadRegistry } from "./project-registry.js";

function makeEntry(overrides?: Partial<ProjectRootEntry>): ProjectRootEntry {
  return {
    projectId: "project-ashley",
    canonicalRoot: "/srv/ashley",
    displayName: "Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    verificationAllowed: true,
    authorshipAllowed: true,
    engineeringAllowed: false,
    allowedRecipeIds: ["typescript_fixture_compile_v1"],
    ...overrides,
  };
}

function makeManifest(id: string, projectId = "project-ashley", lastUsedMs = 1000): WorkspaceManifest {
  return {
    schemaVersion: 2,
    workspaceId: id,
    projectId,
    sourceSnapshotId: "snap-1",
    createdAt: new Date(100).toISOString(),
    lastUsedAt: new Date(lastUsedMs).toISOString(),
  };
}

describe("authorship-binding", () => {
  it("resolves the unique current workspace when workspaceId is omitted", () => {
    const manager = new WorkspaceManager();
    manager.listProjectWorkspaces = () => [makeManifest("ws_unique_current_001", "project-ashley", 2000)];

    const res = resolveAuthorshipBinding({
      projectId: "project-ashley",
      entry: makeEntry(),
      workspaceManager: manager,
    });

    expect(res).toEqual({
      ok: true,
      workspaceId: "ws_unique_current_001",
    });
  });

  it("selects the newest workspace when multiple workspaces have distinct timestamps", () => {
    const manager = new WorkspaceManager();
    manager.listProjectWorkspaces = () => [
      makeManifest("ws_old_000000001", "project-ashley", 1000),
      makeManifest("ws_new_000000002", "project-ashley", 5000),
      makeManifest("ws_mid_000000003", "project-ashley", 3000),
    ];

    const res = resolveAuthorshipBinding({
      projectId: "project-ashley",
      entry: makeEntry(),
      workspaceManager: manager,
    });

    expect(res).toEqual({
      ok: true,
      workspaceId: "ws_new_000000002",
    });
  });

  it("fails closed when no candidate workspace exists", () => {
    const manager = new WorkspaceManager();
    manager.listProjectWorkspaces = () => [];

    const res = resolveAuthorshipBinding({
      projectId: "project-ashley",
      entry: makeEntry(),
      workspaceManager: manager,
    });

    expect(res).toEqual({
      ok: false,
      error: "no_current_workspace",
    });
  });

  it("fails closed when current workspace timestamp has a tie", () => {
    const manager = new WorkspaceManager();
    manager.listProjectWorkspaces = () => [
      makeManifest("ws_tie_000000001", "project-ashley", 5000),
      makeManifest("ws_tie_000000002", "project-ashley", 5000),
    ];

    const res = resolveAuthorshipBinding({
      projectId: "project-ashley",
      entry: makeEntry(),
      workspaceManager: manager,
    });

    expect(res).toEqual({
      ok: false,
      error: "ambiguous_current_workspace",
    });
  });

  it("preserves an explicit valid workspace ID", () => {
    const res = resolveAuthorshipBinding({
      projectId: "project-ashley",
      workspaceId: "ws_explicit_001",
      entry: makeEntry(),
    });

    expect(res).toEqual({
      ok: true,
      workspaceId: "ws_explicit_001",
    });
  });

  describe("assessAuthorshipResolvability", () => {
    it("reports currently_resolvable when authorshipAllowed and unique workspace exists", () => {
      const manager = new WorkspaceManager();
      manager.listProjectWorkspaces = () => [makeManifest("ws_active_001", "project-ashley", 1000)];

      const status = assessAuthorshipResolvability({
        projectId: "project-ashley",
        entry: makeEntry({ authorshipAllowed: true }),
        workspaceManager: manager,
      });

      expect(status).toBe("currently_resolvable");
    });

    it("reports authorship_not_allowed when entry.authorshipAllowed is false", () => {
      const status = assessAuthorshipResolvability({
        projectId: "project-ashley",
        entry: makeEntry({ authorshipAllowed: false }),
      });

      expect(status).toBe("authorship_not_allowed");
    });
  });

  describe("describeAuthorshipGrounding", () => {
    it("produces clear grounding text for resolvable projects", () => {
      const manager = new WorkspaceManager();
      manager.listProjectWorkspaces = () => [makeManifest("ws_active_001", "project-ashley", 1000)];

      const registry: V2ProjectReadRegistry = {
        resolveReadRoot: (id: string) =>
          id === "project-ashley"
            ? { ok: true, entry: makeEntry({ authorshipAllowed: true }) }
            : { ok: false, error: "project_not_found" },
      } as unknown as V2ProjectReadRegistry;

      const text = describeAuthorshipGrounding(["project-ashley"], {
        registry,
        workspaceManager: manager,
      });

      expect(text).toContain("candidate authorship is currently resolvable");
      expect(text).toContain("omit workspaceId");
    });
  });
});
