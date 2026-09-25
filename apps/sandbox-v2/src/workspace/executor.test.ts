import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { executeWorkspaceExperiment, type WorkspaceExperimentSpawnInput } from "./executor.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { V2ProjectReadRegistry } from "../registry.js";
import { V2_LIMITS } from "../limits.js";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";

const CANONICAL_ROOT = "/srv/projects/composer-assistant";

function entry(overrides: Partial<ProjectRootEntry> = {}): ProjectRootEntry {
  return {
    projectId: "composer-assistant",
    canonicalRoot: CANONICAL_ROOT,
    displayName: "Composer Assistant",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    engineeringAllowed: false,
    ...overrides,
  };
}

function goodChecks() {
  return {
    envClean: true,
    homeAbsent: true,
    runAbsent: true,
    hostSentinelAbsent: true,
    fdClean: true,
    workspaceWritable: true,
    usrReadOnly: true,
    loopbackConnectSucceeded: false,
    externalIsolated: true,
    externalError: "ENETUNREACH",
  };
}

function makeRunner(evidence: (input: WorkspaceExperimentSpawnInput) => unknown) {
  return async (input: WorkspaceExperimentSpawnInput) => {
    const stdout = JSON.stringify(evidence(input));
    return {
      exitCode: 0,
      stdout,
      stderr: "",
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    };
  };
}

function makeRunnerFailure(code: string) {
  return async (input: WorkspaceExperimentSpawnInput) => {
    const request = JSON.parse(input.requestJson) as { operation: string };
    return {
      exitCode: 1,
      stdout: JSON.stringify({ version: 2, operation: request.operation, ok: false, code, executionStarted: false }),
      stderr: "",
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    };
  };
}

describe("Stage 2 — Workspace Experiment Executor", () => {
  const tempDirs: string[] = [];

  function createTestSetup(): {
    registry: V2ProjectReadRegistry;
    manager: WorkspaceManager;
    treeRoot: string;
  } {
    const root = mkdtempSync(join(tmpdir(), "ashley-exec-test-"));
    tempDirs.push(root);
    const treeRoot = join(root, "tree");
    mkdirSync(treeRoot, { recursive: true });
    writeFileSync(join(treeRoot, "README.md"), "# Mock", "utf8");

    const reg = new V2ProjectReadRegistry([
      entry({ canonicalRoot: CANONICAL_ROOT, candidateWorkspaceAllowed: true }),
      entry({ projectId: "disallowed-project", canonicalRoot: "/srv/projects/disallowed", candidateWorkspaceAllowed: false }),
    ]);

    const fakeManager = {
      managedRoot: root,
      acquireWorkspace: async (ctx: any, reqId?: string) => ({
        ok: true,
        workspaceId: reqId ?? "ws-test-1",
        workspaceTreeRoot: treeRoot,
        manifest: {
          schemaVersion: 2 as const,
          workspaceId: reqId ?? "ws-test-1",
          projectId: ctx.projectId,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          sourceSnapshotId: "snap_mock_12345",
        },
        isNew: !reqId,
      }),
    } as unknown as WorkspaceManager;

    return { registry: reg, manager: fakeManager, treeRoot };
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs.length = 0;
  });

  it("force-closes M3 cleanup before settlement without redispatch or truth loss", async () => {
    const { registry, manager } = createTestSetup();
    let nowMs = 1_000;
    let dispatches = 0;
    let forcedClosures = 0;
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "witness.txt",
        content: "witness-data",
      },
      {
        registry,
        workspaceManager: manager,
        childExecutionDeadlineAtMs: 1_300,
        childTerminationDeadlineAtMs: 1_400,
        settlementDeadlineAtMs: 1_500,
        clock: { nowMs: () => nowMs },
        spawnRunner: async (input: WorkspaceExperimentSpawnInput) => {
          dispatches += 1;
          nowMs = 1_290;
          return makeRunner(() => ({
            version: 2,
            operation: "workspace.write_file",
            ok: true,
            result: {
              kind: "workspace.write_file",
              path: "witness.txt",
              bytesWritten: 12,
              contentHash: "a".repeat(64),
              readMatches: true,
              deleted: false,
              verifiedAbsent: false,
              completedAtMs: nowMs,
            },
            checks: goodChecks(),
          }))(input);
        },
        serverCloser: ((server: import("node:net").Server, connections: Set<import("node:net").Socket>) => {
          forcedClosures += 1;
          server.close();
          for (const socket of connections) socket.destroy();
          connections.clear();
          nowMs = 1_490;
        }),
      } as any,
    );

    expect(dispatches).toBe(1);
    expect(forcedClosures).toBe(1);
    expect(result).toMatchObject({
      outcome: "succeeded",
      executionTruth: "effect_verified",
    });
    expect(nowMs).toBeLessThanOrEqual(1_500);
    expect(1_700 - nowMs).toBe(210);
  });

  it("maps unacknowledged mutating termination to unknown truth without redispatch", async () => {
    const { registry, manager } = createTestSetup();
    let nowMs = 1_000;
    let dispatches = 0;
    let cleanupStartedAtMs = -1;
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "witness.txt",
        content: "witness-data",
      },
      {
        registry,
        workspaceManager: manager,
        childExecutionDeadlineAtMs: 1_300,
        childTerminationDeadlineAtMs: 1_400,
        settlementDeadlineAtMs: 1_500,
        clock: { nowMs: () => nowMs },
        spawnRunner: async (input) => {
          dispatches += 1;
          expect(input.childTerminationDeadlineAtMs).toBe(1_400);
          nowMs = 1_400;
          return {
            exitCode: null,
            stdout: "",
            stderr: "",
            timedOut: true,
            stdoutOverflow: false,
            stderrOverflow: false,
            cancellationRequested: true,
            cancellationAcknowledged: false,
          };
        },
        serverCloser: ((server: import("node:net").Server, connections: Set<import("node:net").Socket>) => {
          cleanupStartedAtMs = nowMs;
          server.close();
          for (const socket of connections) socket.destroy();
          connections.clear();
          nowMs = 1_450;
        }),
      },
    );

    expect(dispatches).toBe(1);
    expect(cleanupStartedAtMs).toBe(1_400);
    expect(nowMs).toBeLessThan(1_500);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "timeout",
      executionTruth: "effect_unknown",
      cancellationRequested: true,
      cancellationAcknowledged: false,
    });
  });

  it("classifies a pre-dispatch acquisition timeout as no_effect_proven", async () => {
    const { registry, manager } = createTestSetup();
    let nowMs = 1_000;
    let dispatches = 0;
    const slowManager = {
      acquireWorkspace: async (...args: Parameters<WorkspaceManager["acquireWorkspace"]>) => {
        const acquired = await manager.acquireWorkspace(...args);
        nowMs = 1_600;
        return acquired;
      },
    } as WorkspaceManager;

    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "witness.txt",
        content: "witness-data",
      },
      {
        registry,
        workspaceManager: slowManager,
        spawnRunner: async () => {
          dispatches += 1;
          throw new Error("must not dispatch");
        },
        childExecutionDeadlineAtMs: 1_300,
        settlementDeadlineAtMs: 1_500,
        clock: { nowMs: () => nowMs },
      },
    );

    expect(dispatches).toBe(0);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "settlement_deadline_exceeded",
      executionTruth: "no_effect_proven",
    });
  });

  it.each([
    ["C2 replace_file", "workspace.replace_file", "bad-request"],
    ["C2 write_file", "workspace.write_file", "file_exists"],
    ["C2 edit_text", "workspace.edit_text", "bad-request"],
    ["C3 write_file", "workspace.write_file", "bad-request"],
    ["C3 write_file existing target", "workspace.write_file", "file_exists"],
    ["C3 edit_text", "workspace.edit_text", "bad-request"],
    ["C3 replace_file", "workspace.replace_file", "bad-request"],
  ] as const)("proves recovered %s pre-write rejection had no effect without reconstructing its request body", async (_name, operation, code) => {
    const { registry, manager } = createTestSetup();
    let dispatches = 0;
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation,
        projectId: "composer-assistant",
        path: "src/ledger.ts",
      } as Parameters<typeof executeWorkspaceExperiment>[0],
      {
        registry,
        workspaceManager: manager,
        spawnRunner: async (input) => {
          dispatches += 1;
          const request = JSON.parse(input.requestJson) as Record<string, unknown>;
          expect(request.operation).toBe(operation);
          expect(request).not.toHaveProperty("content");
          expect(request).not.toHaveProperty("oldText");
          expect(request).not.toHaveProperty("newText");
          expect(request).not.toHaveProperty("expectedSha256");
          return makeRunnerFailure(code)(input);
        },
      },
    );

    expect(dispatches).toBe(1);
    expect(result).toMatchObject({
      outcome: "failed",
      error: code,
      executionTruth: "no_effect_proven",
    });
  });

  it("exposes only the current raw-byte hash for a hash precondition rejection", async () => {
    const { registry, manager } = createTestSetup();
    const afterSha256 = "a".repeat(64);
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.replace_file",
        projectId: "composer-assistant",
        path: "src/ledger.ts",
        content: "replacement-content",
        expectedSha256: "b".repeat(64),
      },
      {
        registry,
        workspaceManager: manager,
        spawnRunner: async (input) => {
          const request = JSON.parse(input.requestJson) as { operation: string };
          return {
            exitCode: 1,
            stdout: JSON.stringify({
              version: 2,
              operation: request.operation,
              ok: false,
              code: "hash_mismatch",
              executionStarted: false,
              afterSha256,
            }),
            stderr: "",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    );

    expect(result).toMatchObject({ outcome: "failed", error: "hash_mismatch", executionTruth: "no_effect_proven" });
    if (result.outcome === "failed") {
      expect(result.fieldErrors).toEqual([{
        fieldPath: "$.expectedSha256",
        expectedSchemaId: "ashley.workspace_worker_request.v1",
        preconditionCode: "hash_mismatch",
        executionStarted: false,
        afterSha256,
      }]);
      expect(JSON.stringify(result)).not.toContain("replacement-content");
    }
  });

  it.each([
    ["cleanup completed and existing bytes stayed unchanged", {
      cleanupComplete: true,
      beforeSha256: "a".repeat(64),
      afterSha256: "a".repeat(64),
      targetWasAbsent: false,
      targetAbsent: false,
      targetUnchanged: true,
    }, "a".repeat(64), "no_effect_proven"],
    ["cleanup failed", {
      cleanupComplete: false,
      beforeSha256: "a".repeat(64),
      afterSha256: "a".repeat(64),
      targetWasAbsent: false,
      targetAbsent: false,
      targetUnchanged: true,
    }, "a".repeat(64), "effect_unknown"],
    ["target bytes changed", {
      cleanupComplete: true,
      beforeSha256: "a".repeat(64),
      afterSha256: "b".repeat(64),
      targetWasAbsent: false,
      targetAbsent: false,
      targetUnchanged: false,
    }, "b".repeat(64), "effect_unknown"],
  ] as const)("classifies write_failed only when %s", async (_name, effectProof, afterSha256, expectedTruth) => {
    const { registry, manager } = createTestSetup();
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.replace_file",
        projectId: "composer-assistant",
        path: "src/ledger.ts",
        content: "replacement-content",
        expectedSha256: "a".repeat(64),
      },
      {
        registry,
        workspaceManager: manager,
        spawnRunner: async (input) => {
          const request = JSON.parse(input.requestJson) as { operation: string };
          return {
            exitCode: 1,
            stdout: JSON.stringify({
              version: 2,
              operation: request.operation,
              ok: false,
              code: "write_failed",
              executionStarted: true,
              afterSha256,
              effectProof,
            }),
            stderr: "",
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    );

    expect(result).toMatchObject({ outcome: "failed", error: "write_failed", executionTruth: expectedTruth });
  });

  it("classifies oversized write content (> 64 KiB) as content_too_large and no_effect_proven before dispatch", async () => {
    const { registry, manager } = createTestSetup();
    let dispatches = 0;
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "oversized.txt",
        content: "x".repeat(V2_LIMITS.M3_WRITE_MAX_BYTES + 100),
      },
      {
        registry,
        workspaceManager: manager,
        spawnRunner: async () => {
          dispatches += 1;
          throw new Error("must not dispatch");
        },
      },
    );

    expect(dispatches).toBe(0);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "content_too_large",
      executionTruth: "no_effect_proven",
    });
  });

  it("keeps a successful rename unknown when the runner times out before returning evidence", async () => {
    const { registry, manager, treeRoot } = createTestSetup();
    let nowMs = 2_000;
    let dispatches = 0;
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "witness.txt",
        content: "witness-data",
      },
      {
        registry,
        workspaceManager: manager,
        childExecutionDeadlineAtMs: 2_300,
        settlementDeadlineAtMs: 2_500,
        clock: { nowMs: () => nowMs },
        spawnRunner: async (input) => {
          dispatches += 1;
          expect(input.timeoutMs).toBe(300);
          const temporaryPath = join(treeRoot, "witness.tmp");
          writeFileSync(temporaryPath, "witness-data", "utf8");
          renameSync(temporaryPath, join(treeRoot, "witness.txt"));
          nowMs = 2_310;
          return {
            exitCode: null,
            stdout: "",
            stderr: "",
            timedOut: true,
            stdoutOverflow: false,
            stderrOverflow: false,
          };
        },
      },
    );

    expect(dispatches).toBe(1);
    expect(readFileSync(join(treeRoot, "witness.txt"), "utf8")).toBe("witness-data");
    expect(result).toMatchObject({
      outcome: "failed",
      error: "timeout",
      executionTruth: "effect_unknown",
    });
  });

  it("fails closed when candidateWorkspaceAllowed is false", async () => {
    const { registry, manager } = createTestSetup();
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.read_file",
        projectId: "disallowed-project",
        path: "README.md",
      },
      {
        registry,
        workspaceManager: manager,
        available: () => true,
      },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toBe("workspace_not_allowed");
    }
  });

  it("fails closed with request_too_large when inbound request exceeds 128 KiB", async () => {
    const { registry, manager } = createTestSetup();
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "large.txt",
        content: "x".repeat(130 * 1024), // 130 KiB
      },
      {
        registry,
        workspaceManager: manager,
        available: () => true,
      },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toBe("request_too_large");
    }
  });

  it("executes workspace.write_file and returns verified safe facts with provenance", async () => {
    const { registry, manager } = createTestSetup();
    const spawnRunner = makeRunner((input) => {
      const parsedReq = JSON.parse(input.requestJson);
      expect(parsedReq.operation).toBe("workspace.write_file");
      expect(parsedReq.path).toBe("witness.txt");
      expect(parsedReq).not.toHaveProperty("mustNotExist");
      return {
        version: 2,
        operation: "workspace.write_file",
        ok: true,
        result: {
          kind: "workspace.write_file",
          path: "witness.txt",
          bytesWritten: 12,
          contentHash: "a".repeat(64),
          readMatches: true,
          deleted: false,
          verifiedAbsent: false,
          completedAtMs: Date.now(),
        },
        checks: goodChecks(),
      };
    });

    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "witness.txt",
        content: "witness-data",
      },
      {
        registry,
        workspaceManager: manager,
        available: () => true,
        spawnRunner,
      },
    );

    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.executionTruth).toBe("effect_verified");
      expect(result.operation).toBe("workspace.write_file");
      expect(result.workspaceId).toBeTruthy();
      expect(result.sourceSnapshotId).toMatch(/^snap_/);
      expect(result.result).toMatchObject({
        kind: "workspace.write_file",
        path: "witness.txt",
        bytesWritten: 12,
      });
    }
  });

  it("preserves verified effect truth when valid M3 evidence settles too late for continuation", async () => {
    const { registry, manager } = createTestSetup();
    let nowMs = 3_000;
    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.write_file",
        projectId: "composer-assistant",
        path: "witness.txt",
        content: "witness-data",
      },
      {
        registry,
        workspaceManager: manager,
        childExecutionDeadlineAtMs: 3_300,
        settlementDeadlineAtMs: 3_500,
        clock: { nowMs: () => nowMs },
        spawnRunner: async (input) => {
          nowMs = 3_510;
          return makeRunner(() => ({
            version: 2,
            operation: "workspace.write_file",
            ok: true,
            result: {
              kind: "workspace.write_file",
              path: "witness.txt",
              bytesWritten: 12,
              contentHash: "a".repeat(64),
              readMatches: true,
              deleted: false,
              verifiedAbsent: false,
              completedAtMs: nowMs,
            },
            checks: goodChecks(),
          }))(input);
        },
      },
    );

    expect(result).toMatchObject({
      outcome: "failed",
      error: "settlement_deadline_exceeded",
      executionTruth: "effect_verified",
      lateEvidenceVerified: true,
    });
  });

  it("executes workspace.search_text with default path .", async () => {
    const { registry, manager } = createTestSetup();
    const spawnRunner = makeRunner((input) => {
      const parsedReq = JSON.parse(input.requestJson);
      expect(parsedReq.operation).toBe("workspace.search_text");
      expect(parsedReq.path).toBeUndefined(); // or default handled by runner
      expect(parsedReq.pattern).toBe("search-term");
      return {
        version: 2,
        operation: "workspace.search_text",
        ok: true,
        result: {
          kind: "workspace.search_text",
          path: ".",
          matches: [{ path: "README.md", line: 1, text: "search-term matched" }],
          truncated: false,
          filesScanned: 1,
        },
        checks: goodChecks(),
      };
    });

    const result = await executeWorkspaceExperiment(
      {
        version: 2,
        operation: "workspace.search_text",
        projectId: "composer-assistant",
        pattern: "search-term",
      },
      {
        registry,
        workspaceManager: manager,
        available: () => true,
        spawnRunner,
      },
    );

    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.result).toMatchObject({
        kind: "workspace.search_text",
        matches: [{ path: "README.md", line: 1 }],
      });
    }
  });

  it("ensures SANDBOX_V2_WORKSPACE_RUNNER_SOURCE compiles cleanly without syntax errors", async () => {
    const { SANDBOX_V2_WORKSPACE_RUNNER_SOURCE } = await import("./runner.js");
    expect(() => {
      new Function(SANDBOX_V2_WORKSPACE_RUNNER_SOURCE);
    }).not.toThrow();
  });

  it("ensures buildBwrapArgs establishes canonical merged-/usr projection and preserves isolation invariants", async () => {
    const { buildBwrapArgs } = await import("./executor.js");
    const args = buildBwrapArgs("/mock/workspace/tree");

    // Merged-/usr projection symlinks
    expect(args).toContain("--ro-bind");
    const roBindIndex = args.indexOf("--ro-bind");
    expect(args[roBindIndex + 1]).toBe("/usr");
    expect(args[roBindIndex + 2]).toBe("/usr");

    expect(args).toContain("--symlink");
    expect(args).toContain("usr/lib");
    expect(args).toContain("/lib");
    expect(args).toContain("usr/lib64");
    expect(args).toContain("/lib64");
    expect(args).toContain("usr/bin");
    expect(args).toContain("/bin");
    expect(args).toContain("usr/sbin");
    expect(args).toContain("/sbin");

    // Workspace bind
    expect(args).toContain("--bind");
    const bindIndex = args.indexOf("--bind");
    expect(args[bindIndex + 1]).toBe("/mock/workspace/tree");
    expect(args[bindIndex + 2]).toBe("/workspace");

    // Isolation invariants
    expect(args).toContain("--unshare-user");
    expect(args).toContain("--unshare-pid");
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--unshare-ipc");
    expect(args).toContain("--unshare-uts");
    expect(args).toContain("--clearenv");

    // Prohibited exposures
    expect(args.includes("/home")).toBe(false);
    expect(args.includes("/run")).toBe(false);
    expect(args.includes("/home/xarvak")).toBe(false);
  });
});
