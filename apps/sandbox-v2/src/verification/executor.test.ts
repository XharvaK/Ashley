import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxV2Dispatcher } from "../dispatch.js";
import { V2ProjectReadRegistry } from "../registry.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { RecipeCatalog, typescriptFixtureCompileV1 } from "./recipe-catalog.js";
import {
  CANDIDATE_GUEST_PATH,
  PROJECTION_GUEST_PATH,
  buildVerificationBwrapArgs,
  executeCandidateVerification,
  type VerificationSpawnInput,
} from "./executor.js";
import { computeProvisionalCandidateTreeHash } from "./snapshot.js";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";
import { isSandboxV2OperationResult } from "../v2-types.js";

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

function fixtureRecipe() {
  return {
    ...typescriptFixtureCompileV1(),
    executableIdentity: "test:fixture-compiler",
    executablePath: "/opt/fixture/compiler",
    argv: ["--compile", "/candidate", "--out", "/output"],
  };
}

async function seedWorkspace(sourceRoot: string, managedRoot: string) {
  mkdirSync(join(sourceRoot, "src"), { recursive: true });
  writeFileSync(join(sourceRoot, "src", "index.ts"), "export const n = 1;\n", "utf8");
  const manager = new WorkspaceManager({ managedRoot });
  const acquired = await manager.acquireWorkspace({
    projectId: "composer-assistant",
    canonicalRoot: sourceRoot,
  });
  if (!acquired.ok) throw new Error(acquired.error);
  return { manager, acquired };
}

function makeHarness() {
  const root = mkdtempSync(join(tmpdir(), "ashley-m4-exec-"));
  tempDirs.push(root);
  const sourceRoot = join(root, "src-project");
  const managedRoot = join(root, "workspaces");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(managedRoot, { recursive: true });
  const registry = new V2ProjectReadRegistry([projectEntry()]);
  const catalog = new RecipeCatalog([fixtureRecipe()]);
  return { root, sourceRoot, managedRoot, registry, catalog };
}

const FORBIDDEN_RECEIPT_KEYS = [
  "verifiedWorkspace",
  "approved",
  "accepted",
  "improved",
  "quality",
  "ready",
  "ok",
  "success",
];

describe("M4 verification bwrap args", () => {
  it("binds candidate read-only, projection writable, network unshared, no shell", () => {
    const args = buildVerificationBwrapArgs({
      candidateRoot: "/managed/ws/tree",
      projectionRoot: "/tmp/proj",
      executablePath: "/opt/node/bin/node",
      argv: ["tsc", "--outDir", "/output"],
      cwdGuest: "/candidate",
    });
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--ro-bind");
    const candidateIdx = args.indexOf("/managed/ws/tree");
    expect(args[candidateIdx - 1]).toBe("--ro-bind");
    expect(args[candidateIdx + 1]).toBe(CANDIDATE_GUEST_PATH);
    const projIdx = args.indexOf("/tmp/proj");
    expect(args[projIdx - 1]).toBe("--bind");
    expect(args[projIdx + 1]).toBe(PROJECTION_GUEST_PATH);
    expect(args).not.toContain("-c");
    expect(args).not.toContain("sh");
    const execIdx = args.indexOf("/opt/node/bin/node");
    expect(execIdx).toBeGreaterThan(0);
    expect(args.slice(execIdx)).toEqual(["/opt/node/bin/node", "tsc", "--outDir", "/output"]);
  });
});

describe("M4 workspace.verify executor — adversarial", () => {
  it("rejects model command/argv/executable before spawn", async () => {
    const h = makeHarness();
    let spawned = false;
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: "abcdefgh",
        recipeId: "typescript_fixture_compile_v1",
        command: "tsc",
        argv: ["-c", "rm -rf /"],
      },
      {
        registry: h.registry,
        recipeCatalog: h.catalog,
        spawnVerification: async () => {
          spawned = true;
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    );
    expect(spawned).toBe(false);
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("request_forbidden_field");
  });

  it("refuses a missing workspace instead of creating one", async () => {
    const h = makeHarness();
    const before = mkdtempSync(join(h.managedRoot, "probe-"));
    rmSync(before, { recursive: true, force: true });
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: "missingid",
        recipeId: "typescript_fixture_compile_v1",
      },
      {
        registry: h.registry,
        recipeCatalog: h.catalog,
        workspaceManager: new WorkspaceManager({ managedRoot: h.managedRoot }),
        spawnVerification: async () => {
          throw new Error("spawn must not run");
        },
      },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("workspace_not_found");
  });

  it("refuses a missing toolchain without fallback to npm or repo scripts", async () => {
    const h = makeHarness();
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: "abcdefgh",
        recipeId: "typescript_fixture_compile_v1",
      },
      {
        registry: h.registry,
        recipeCatalog: h.catalog,
        available: () => true,
      },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("toolchain_unavailable");
  });

  it("does not treat engineeringAllowed as M4 authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-m4-eng-"));
    tempDirs.push(root);
    const managedRoot = join(root, "workspaces");
    mkdirSync(managedRoot, { recursive: true });
    const registry = new V2ProjectReadRegistry([
      projectEntry({ engineeringAllowed: true, candidateWorkspaceAllowed: true }),
    ]);
    const catalog = new RecipeCatalog([fixtureRecipe()]);
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: "missingid",
        recipeId: "typescript_fixture_compile_v1",
      },
      {
        registry,
        recipeCatalog: catalog,
        workspaceManager: new WorkspaceManager({ managedRoot }),
        spawnVerification: async () => {
          throw new Error("spawn must not run");
        },
      },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("workspace_not_found");
  });

  it("fails closed on candidate mutation during the run, not as verified_failure", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
        recipeId: "typescript_fixture_compile_v1",
      },
      {
        registry: h.registry,
        recipeCatalog: h.catalog,
        workspaceManager: manager,
        spawnVerification: async (input: VerificationSpawnInput) => {
          writeFileSync(join(input.candidateRoot, "mutated.ts"), "export const leaked = 1;\n");
          writeFileSync(join(input.projectionRoot, "compile-marker"), "should-not-copy-back");
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toBe("snapshot_mismatch");
      expect(result.verificationReceipt?.protocolState).toBe("sandbox_failure");
      expect(result.verificationReceipt?.verificationOutcome).toBe("outcome_unknown");
      expect(result.verificationReceipt?.candidateUnchanged).toBe(false);
    }
  });
});

describe("M4 workspace.verify executor — fixture compile", () => {
  it("proves protocol success with compile failure is not sandbox failure", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    const beforeHash = computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot);
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
        recipeId: "typescript_fixture_compile_v1",
      },
      {
        registry: h.registry,
        recipeCatalog: h.catalog,
        workspaceManager: manager,
        spawnVerification: async (input) => {
          expect(input.unshareNet).toBe(true);
          expect(input.writableBinds).toEqual(["/output"]);
          expect(input.candidateRoot).toBe(acquired.workspaceTreeRoot);
          expect(input.candidateRoot).not.toBe(h.sourceRoot);
          writeFileSync(join(input.projectionRoot, "compile-marker"), "artifact");
          expect(existsSync(join(input.projectionRoot, "compile-marker"))).toBe(true);
          return {
            exitCode: 1,
            stdout: "error TS2322\n",
            stderr: "",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    );
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded") return;
    expect(result.result.kind).toBe("workspace.verify");
    if (result.result.kind !== "workspace.verify") return;
    expect(result.result.protocolState).toBe("admitted");
    expect(result.result.verificationOutcome).toBe("verified_failure");
    expect(result.result.candidateUnchanged).toBe(true);
    expect(result.result.cleanupCompleted).toBe(true);
    expect(result.result.projectionDiscarded).toBe(true);
    expect(computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot)).toBe(beforeHash);
    expect(existsSync(join(acquired.workspaceTreeRoot, "compile-marker"))).toBe(false);
    expect(isSandboxV2OperationResult(result.result, "workspace.verify")).toBe(true);
    const serialized = JSON.stringify(result.result);
    for (const key of FORBIDDEN_RECEIPT_KEYS) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it("runs the boring fixture compile/typecheck happy path", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    const beforeHash = computeProvisionalCandidateTreeHash(acquired.workspaceTreeRoot);
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
        recipeId: "typescript_fixture_compile_v1",
      },
      {
        registry: h.registry,
        recipeCatalog: h.catalog,
        workspaceManager: manager,
        spawnVerification: async (input) => {
          writeFileSync(join(input.projectionRoot, "index.js"), "export const n = 1;\n");
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    );
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded" || result.result.kind !== "workspace.verify") return;
    expect(result.result.protocolState).toBe("admitted");
    expect(result.result.verificationOutcome).toBe("verified_success");
    expect(result.result.recipeId).toBe("typescript_fixture_compile_v1");
    expect(result.result.recipeDefinitionHash).toHaveLength(64);
    expect(result.result.candidateTreeHash).toBe(beforeHash);
    expect(result.result.candidateTreeHashAfter).toBe(beforeHash);
    expect(readFileSync(join(acquired.workspaceTreeRoot, "src", "index.ts"), "utf8")).toBe(
      "export const n = 1;\n",
    );
  });

  it("records timeout as outcome_unknown, not verified_failure", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    const result = await executeCandidateVerification(
      {
        version: 2,
        operation: "workspace.verify",
        projectId: "composer-assistant",
        workspaceId: acquired.workspaceId,
        recipeId: "typescript_fixture_compile_v1",
      },
      {
        registry: h.registry,
        recipeCatalog: h.catalog,
        workspaceManager: manager,
        spawnVerification: async () => ({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: true,
          stdoutOverflow: false,
          stderrOverflow: false,
        }),
      },
    );
    expect(result.outcome).toBe("succeeded");
    if (result.outcome !== "succeeded" || result.result.kind !== "workspace.verify") return;
    expect(result.result.protocolState).toBe("admitted");
    expect(result.result.verificationOutcome).toBe("outcome_unknown");
    expect(result.result.timedOut).toBe(true);
  });
});

describe("M4 dispatcher routing", () => {
  it("does not fall back to the M3 writable spawn seam", async () => {
    const h = makeHarness();
    const dispatcher = new SandboxV2Dispatcher({
      env: {
        registry: h.registry,
        recipeCatalog: h.catalog,
        sandboxAvailable: () => false,
        spawnWorkspace: async () => {
          throw new Error("M3 spawn must not be used for M4");
        },
        spawnInspection: async () => {
          throw new Error("M2 spawn must not be used for M4");
        },
      },
    });
    const result = await dispatcher.dispatch({
      version: 2,
      operation: "workspace.verify",
      projectId: "composer-assistant",
      workspaceId: "abcdefgh",
      recipeId: "typescript_fixture_compile_v1",
    });
    expect(result.outcome).toBe("unavailable");
  });

  it("routes workspace.verify through the verification executor", async () => {
    const h = makeHarness();
    const { manager, acquired } = await seedWorkspace(h.sourceRoot, h.managedRoot);
    const dispatcher = new SandboxV2Dispatcher({
      env: {
        registry: h.registry,
        recipeCatalog: h.catalog,
        workspaceManager: manager,
        spawnVerification: async (input) => {
          writeFileSync(join(input.projectionRoot, "out.js"), "");
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    });
    const result = await dispatcher.dispatch({
      version: 2,
      operation: "workspace.verify",
      projectId: "composer-assistant",
      workspaceId: acquired.workspaceId,
      recipeId: "typescript_fixture_compile_v1",
    });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") expect(result.result.kind).toBe("workspace.verify");
  });
});
