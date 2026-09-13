import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxV2Dispatcher } from "../dispatch.js";
import { V2ProjectReadRegistry } from "../registry.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { computeProvisionalCandidateTreeHash } from "../verification/snapshot.js";
import { isChangesetAuthorResult, isSandboxV2OperationResult } from "../v2-types.js";
import {
  executeCandidateAuthorship,
  validateChangesetAuthorRequest,
} from "./executor.js";
import { refuseApplyCandidateChangeSet } from "./apply.js";
import { scanAuthorshipText } from "./secret-scan.js";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function projectEntry(overrides: Partial<ProjectRootEntry> = {}): ProjectRootEntry {
  return {
    projectId: "composer-assistant",
    canonicalRoot: "/srv/projects/composer-assistant",
    displayName: "Composer Assistant",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: false,
    engineeringAllowed: false,
    ...overrides,
  };
}

function initGit(root: string): string {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=m5@test.invalid",
      "-c",
      "user.name=m5",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "init",
    ],
    { cwd: root, stdio: "ignore" },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

async function seedWorkspace(
  sourceRoot: string,
  managedRoot: string,
  options: { commitGit?: boolean } = {},
) {
  mkdirSync(join(sourceRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRoot, "src", "a.ts"), "export const a = 1;\n", "utf8");
  writeFileSync(join(sourceRoot, "src", "b.ts"), "export const b = 1;\n", "utf8");
  const head = options.commitGit ? initGit(sourceRoot) : null;
  const manager = new WorkspaceManager({ managedRoot });
  const acquired = await manager.acquireWorkspace({
    projectId: "composer-assistant",
    canonicalRoot: sourceRoot,
  });
  if (!acquired.ok) throw new Error(acquired.error);
  return { manager, acquired, head };
}

function makeHarness(overrides: Partial<ProjectRootEntry> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ashley-m5-exec-"));
  tempDirs.push(root);
  const sourceRoot = join(root, "src-project");
  const managedRoot = join(root, "workspaces");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(managedRoot, { recursive: true });
  const registry = new V2ProjectReadRegistry([
    projectEntry({ canonicalRoot: sourceRoot, authorshipAllowed: true, ...overrides }),
  ]);
  return { root, sourceRoot, managedRoot, registry };
}

describe("validateChangesetAuthorRequest", () => {
  it("accepts a minimal valid request", () => {
    expect(
      validateChangesetAuthorRequest({
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: "abcdefgh",
      }),
    ).toEqual({
      ok: true,
      request: {
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: "abcdefgh",
      },
    });
  });

  it.each(["patch", "diff", "content", "argv", "command", "apply", "commit", "merge", "deploy"])(
    "refuses forbidden field %s",
    (field) => {
      const result = validateChangesetAuthorRequest({
        version: 2,
        operation: "changeset.author",
        projectId: "p",
        workspaceId: "abcdefgh",
        [field]: "nope",
      });
      expect(result).toEqual({ ok: false, error: "unsupported_operation" });
    },
  );
});

describe("scanAuthorshipText", () => {
  it("hits a github PAT shape without returning the value", () => {
    const hit = scanAuthorshipText(`token ghp_${"A".repeat(36)}`);
    expect(hit.hit).toBe(true);
    expect(JSON.stringify(hit)).not.toContain("ghp_");
  });

  it("misses ordinary source", () => {
    expect(scanAuthorshipText("export const n = 1;\n")).toEqual({ hit: false });
  });
});

describe("refuseApplyCandidateChangeSet", () => {
  it("is permanently refuse-closed", () => {
    expect(refuseApplyCandidateChangeSet()).toEqual({
      ok: false,
      error: "m5_apply_forbidden",
    });
  });
});

describe("M5 changeset.author executor", () => {
  it("seals a multi-file candidate delta without mutating candidate or live trees", async () => {
    const h = makeHarness();
    const { manager, acquired, head } = await seedWorkspace(h.sourceRoot, h.managedRoot, {
      commitGit: true,
    });
    const liveA = readFileSync(join(h.sourceRoot, "src", "a.ts"), "utf8");
    const liveB = readFileSync(join(h.sourceRoot, "src", "b.ts"), "utf8");
    writeFileSync(join(acquired.workspaceTreeRoot, "src", "a.ts"), "export const a = 2;\n", "utf8");
    writeFileSync(join(acquired.workspaceTreeRoot, "src", "b.ts"), "export const b = 2;\n", "utf8");
    const beforeHash = computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot);

    const dispatcher = new SandboxV2Dispatcher({
      env: { registry: h.registry, workspaceManager: manager, managedWorkspaceRoot: h.managedRoot },
    });
    const result = await dispatcher.dispatch({
      version: 2,
      operation: "changeset.author",
      projectId: "composer-assistant",
      workspaceId: acquired.workspaceId,
    });

    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") return;
    expect(isSandboxV2OperationResult(result.result, "changeset.author")).toBe(true);
    expect(isChangesetAuthorResult(result.result)).toBe(true);
    if (!isChangesetAuthorResult(result.result)) return;
    expect(result.result.changedPaths.map((c) => c.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.result.candidateUnchanged).toBe(true);
    expect(result.result.liveUnwritten).toBe(true);
    expect(result.result.candidateTreeHash).toBe(beforeHash);
    expect(result.result.baseCommit).toBe(head);
    expect(result.result.sourceCleanliness).toBe("clean");
    expect(existsSync(result.result.artifactRef)).toBe(true);
    expect(readFileSync(result.result.artifactRef, "utf8")).toContain("src/a.ts");
    expect(computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot)).toBe(beforeHash);
    expect(readFileSync(join(h.sourceRoot, "src", "a.ts"), "utf8")).toBe(liveA);
    expect(readFileSync(join(h.sourceRoot, "src", "b.ts"), "utf8")).toBe(liveB);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: h.sourceRoot, encoding: "utf8" }).trim()).toBe(head);
    expect(statSync(join(acquired.workspaceTreeRoot, "src", "a.ts")).mtimeMs).toBeGreaterThan(0);
  });

  it("refuses an empty candidate delta", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    const empty = await executeCandidateAuthorship(
      {
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
      },
      { registry: h.registry, workspaceManager: manager, managedWorkspaceRoot: h.managedRoot },
    );
    expect(empty.outcome).toBe("failed");
    if (empty.outcome === "failed") expect(empty.error).toBe("empty_changeset");
  });

  it("refuses actual paths beyond intendedPaths", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    writeFileSync(join(acquired.workspaceTreeRoot, "src", "a.ts"), "export const a = 9;\n", "utf8");
    writeFileSync(join(acquired.workspaceTreeRoot, "src", "b.ts"), "export const b = 9;\n", "utf8");
    const unbounded = await executeCandidateAuthorship(
      {
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
        intendedPaths: ["src/a.ts"],
      },
      { registry: h.registry, workspaceManager: manager, managedWorkspaceRoot: h.managedRoot },
    );
    expect(unbounded.outcome).toBe("failed");
    if (unbounded.outcome === "failed") expect(unbounded.error).toBe("unbounded_path");
  });

  it("refuses a credential-shaped patch without echoing the secret", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    writeFileSync(
      join(acquired.workspaceTreeRoot, "src", "a.ts"),
      `export const token = "ghp_${"A".repeat(36)}";\n`,
      "utf8",
    );
    const secret = await executeCandidateAuthorship(
      {
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
        intendedPaths: ["src/a.ts"],
      },
      { registry: h.registry, workspaceManager: manager, managedWorkspaceRoot: h.managedRoot },
    );
    expect(secret.outcome).toBe("failed");
    if (secret.outcome === "failed") expect(secret.error).toBe("secret_detected");
    expect(JSON.stringify(secret)).not.toMatch(/ghp_/);
  });

  it("refuses git metadata inside the candidate tree", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    writeFileSync(join(acquired.workspaceTreeRoot, "src", "a.ts"), "export const a = 9;\n", "utf8");
    mkdirSync(join(acquired.workspaceTreeRoot, ".git"), { recursive: true });
    writeFileSync(join(acquired.workspaceTreeRoot, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    const gitMeta = await executeCandidateAuthorship(
      {
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
      },
      { registry: h.registry, workspaceManager: manager, managedWorkspaceRoot: h.managedRoot },
    );
    expect(gitMeta.outcome).toBe("failed");
    if (gitMeta.outcome === "failed") expect(gitMeta.error).toBe("git_metadata_in_candidate");
  });

  it("does not treat engineeringAllowed or verificationAllowed as authorship", async () => {
    const h = makeHarness({
      authorshipAllowed: false,
      engineeringAllowed: true,
      verificationAllowed: true,
      allowedRecipeIds: ["typescript_fixture_compile_v1"],
      candidateWorkspaceAllowed: true,
    });
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    writeFileSync(join(acquired.workspaceTreeRoot, "src", "a.ts"), "export const a = 3;\n", "utf8");
    const result = await executeCandidateAuthorship(
      {
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
      },
      { registry: h.registry, workspaceManager: manager, managedWorkspaceRoot: h.managedRoot },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("authorship_not_allowed");
  });

  it("defers apply/merge/commit at the dispatcher", async () => {
    const h = makeHarness();
    const dispatcher = new SandboxV2Dispatcher({ env: { registry: h.registry } });
    for (const operation of ["changeset.apply", "changeset.merge", "git.commit", "git.push"] as const) {
      const result = await dispatcher.dispatch({
        version: 2,
        operation,
        projectId: "composer-assistant",
      });
      expect(result.outcome).toBe("failed");
      if (result.outcome === "failed") {
        expect(result.error).toBe("m5_apply_forbidden");
        expect(result.operation).toBe(operation);
      }
    }
  });

  it("still names git-inspect ops as unsupported rather than apply", async () => {
    const h = makeHarness();
    const dispatcher = new SandboxV2Dispatcher({ env: { registry: h.registry } });
    const result = await dispatcher.dispatch({
      version: 2,
      operation: "inspect_project_git_status",
      projectId: "composer-assistant",
    });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("unsupported_operation");
  });

  it("refuses an empty .git directory inside the candidate tree", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    writeFileSync(join(acquired.workspaceTreeRoot, "src", "a.ts"), "export const a = 9;\n", "utf8");
    mkdirSync(join(acquired.workspaceTreeRoot, ".git"), { recursive: true });
    const gitMeta = await executeCandidateAuthorship(
      {
        version: 2,
        operation: "changeset.author",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
      },
      { registry: h.registry, workspaceManager: manager, managedWorkspaceRoot: h.managedRoot },
    );
    expect(gitMeta.outcome).toBe("failed");
    if (gitMeta.outcome === "failed") expect(gitMeta.error).toBe("git_metadata_in_candidate");
  });
});
