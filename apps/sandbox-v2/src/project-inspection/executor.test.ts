import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeProjectInspection, type InspectionSpawn, type InspectionSpawnInput, type InspectionSpawnOutput } from "./executor.js";
import { V2ProjectReadRegistry } from "../registry.js";
import { V2_SECRET_ENV_KEY } from "../limits.js";
import type {
  ProjectSourceViewResult,
} from "./source-view.js";
import type { ProjectRootEntry } from "@composer-assistant/sandbox-policy";

const CANONICAL_ROOT = "/srv/projects/composer-assistant";

function entry(overrides: Partial<ProjectRootEntry> = {}): ProjectRootEntry {
  return {
    projectId: "composer-assistant",
    canonicalRoot: CANONICAL_ROOT,
    displayName: "Composer Assistant",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: false,
    engineeringAllowed: false,
    ...overrides,
  };
}

const registry = new V2ProjectReadRegistry([entry()]);

const readRequest = {
  version: 2,
  operation: "project.read_file",
  projectId: "composer-assistant",
  path: "src/main.ts",
} as const;

function goodChecks() {
  return {
    envClean: true,
    homeAbsent: true,
    runAbsent: true,
    hostSentinelAbsent: true,
    fdClean: true,
    projectReadOnly: true,
    loopbackConnectSucceeded: false,
    externalIsolated: true,
    externalError: "ENETUNREACH",
  };
}

function makeRunner(evidence: (input: InspectionSpawnInput) => unknown) {
  return async (input: InspectionSpawnInput) => {
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

function makeViewBuilder(realSourceDir: string) {
  return async (options: {
    canonicalRoot: string;
    protectedRoots: unknown;
  }): Promise<ProjectSourceViewResult> => {
    expect(options.canonicalRoot).toBe(CANONICAL_ROOT);
    const viewRoot = mkdtempSync(join(tmpdir(), "ashley-v2-view-"));
    mkdirSync(join(viewRoot, "src"), { recursive: true });
    copyFileSync(join(realSourceDir, "src", "main.ts"), join(viewRoot, "src", "main.ts"));
    return {
      ok: true,
      viewRoot,
      counts: {
        files: 1,
        directories: 1,
        excluded: 0,
        bytes: 10,
        skippedSymlinks: 0,
        hardLinkedFiles: 0,
        specialFiles: 0,
        privilegedFiles: 0,
        caseCollisions: 0,
      },
    };
  };
}

const REAL_PROJECT = mkdtempSync(join(tmpdir(), "ashley-v2-real-"));
mkdirSync(join(REAL_PROJECT, "src"), { recursive: true });
writeFileSync(join(REAL_PROJECT, "src", "main.ts"), "const x = 1;\n", "utf8");

const viewBuilder = makeViewBuilder(REAL_PROJECT);

const usedViews: string[] = [];
const trackingViewBuilder: typeof viewBuilder = async (options) => {
  const result = await viewBuilder(options);
  if (result.ok) usedViews.push(result.viewRoot);
  return result;
};

afterEach(() => {
  for (const view of usedViews.splice(0)) {
    rmSync(view, { recursive: true, force: true });
  }
  delete process.env[V2_SECRET_ENV_KEY];
});

describe("executeProjectInspection", () => {
  it("force-closes cleanup before settlement so continuation keeps its reserve", async () => {
    let nowMs = 1_000;
    let forcedClosures = 0;
    const result = await executeProjectInspection(readRequest, {
      registry,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock: { nowMs: () => nowMs },
      viewBuilder: async (options: Parameters<typeof trackingViewBuilder>[0]) => {
        const view = await trackingViewBuilder(options);
        nowMs = 1_100;
        return view;
      },
      spawnRunner: async (input: InspectionSpawnInput) => {
        nowMs = 1_290;
        return makeRunner(() => ({
          version: 2,
          operation: "project.read_file",
          ok: true,
          result: {
            kind: "project.read_file",
            path: "src/main.ts",
            bytes: 12,
            contentBase64: "Y29uc3QgeCA9IDE7Cg==",
            sha256: "f".repeat(64),
            truncated: false,
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
    } as any);

    expect(result.outcome).toBe("succeeded");
    expect(forcedClosures).toBe(1);
    expect(nowMs).toBeLessThanOrEqual(1_500);
    expect(1_700 - nowMs).toBe(210);
  });

  it("stops an unacknowledged child at termination and cleans up inside settlement", async () => {
    let nowMs = 1_000;
    let dispatches = 0;
    let cleanupStartedAtMs = -1;
    const result = await executeProjectInspection(readRequest, {
      registry,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock: { nowMs: () => nowMs },
      viewBuilder: trackingViewBuilder,
      spawnRunner: async (input) => {
        dispatches += 1;
        expect(input.childTerminationDeadlineAtMs).toBe(1_400);
        expect(input.settlementDeadlineAtMs).toBe(1_500);
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
    });

    expect(dispatches).toBe(1);
    expect(cleanupStartedAtMs).toBe(1_400);
    expect(cleanupStartedAtMs).toBeLessThan(1_500);
    expect(nowMs).toBeLessThan(1_500);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "timeout",
      cancellationRequested: true,
      cancellationAcknowledged: false,
      dispatchAttempted: true,
    });
    expect(1_700 - nowMs).toBe(250);
  });

  it("derives the child timeout from the operation deadline after setup", async () => {
    let nowMs = 1_000;
    let receivedTimeoutMs = -1;
    const result = await executeProjectInspection(readRequest, {
      registry,
      childExecutionDeadlineAtMs: 1_300,
      settlementDeadlineAtMs: 1_500,
      clock: { nowMs: () => nowMs },
      viewBuilder: async (options) => {
        const view = await trackingViewBuilder(options);
        nowMs = 1_100;
        return view;
      },
      spawnRunner: async (input) => {
        receivedTimeoutMs = input.timeoutMs;
        nowMs = 1_400;
        return makeRunner(() => ({
          version: 2,
          operation: "project.read_file",
          ok: true,
          result: {
            kind: "project.read_file",
            path: "src/main.ts",
            bytes: 12,
            contentBase64: "Y29uc3QgeCA9IDE7Cg==",
            sha256: "f".repeat(64),
            truncated: false,
          },
          checks: goodChecks(),
        }))(input);
      },
    });

    expect(receivedTimeoutMs).toBe(200);
    expect(result.outcome).toBe("succeeded");
    expect(usedViews.every((view) => !existsSync(view))).toBe(true);
  });

  it("settles as deadline_exceeded after mandatory cleanup and never returns late evidence", async () => {
    let nowMs = 2_000;
    let dispatches = 0;
    const result = await executeProjectInspection(readRequest, {
      registry,
      childExecutionDeadlineAtMs: 2_300,
      settlementDeadlineAtMs: 2_500,
      clock: { nowMs: () => nowMs },
      viewBuilder: async (options) => {
        const view = await trackingViewBuilder(options);
        nowMs = 2_200;
        return view;
      },
      spawnRunner: async (input) => {
        dispatches += 1;
        nowMs = 2_510;
        return makeRunner(() => ({
          version: 2,
          operation: "project.read_file",
          ok: true,
          result: {
            kind: "project.read_file",
            path: "src/main.ts",
            bytes: 12,
            contentBase64: "Y29uc3QgeCA9IDE7Cg==",
            sha256: "f".repeat(64),
            truncated: false,
          },
          checks: goodChecks(),
        }))(input);
      },
    });

    expect(dispatches).toBe(1);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "settlement_deadline_exceeded",
      lateEvidenceVerified: true,
      dispatchAttempted: true,
    });
    expect(usedViews.every((view) => !existsSync(view))).toBe(true);
  });

  it("succeeds with evidence: scripted runner -> validated evidence -> typed result, view cleaned up", async () => {
    const spawnRunner = makeRunner((input) => ({
      version: 2,
      operation: "project.read_file",
      ok: true,
      result: {
        kind: "project.read_file",
        path: "src/main.ts",
        bytes: 12,
        contentBase64: "Y29uc3QgeCA9IDE7Cg==",
        sha256: "f".repeat(64),
        truncated: false,
      },
      checks: goodChecks(),
    }));

    const result = await executeProjectInspection(readRequest, {
      registry,
      spawnRunner,
      viewBuilder: trackingViewBuilder,
    });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded" && result.result.kind === "project.read_file") {
      expect(result.result.path).toBe("src/main.ts");
    }
    expect(usedViews.length).toBe(1);
    expect(existsSync(usedViews[0])).toBe(false);
  });

  it("fails closed for unknown projects before any view is built", async () => {
    const result = await executeProjectInspection(
      { ...readRequest, projectId: "unknown" },
      { registry, spawnRunner: makeRunner(() => ({})), viewBuilder: trackingViewBuilder },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.error).toBe("unknown_project");
      expect(result.dispatchAttempted).toBe(false);
    }
    expect(usedViews.length).toBe(0);
  });

  it("fails closed for invalid paths before any view is built", async () => {
    const result = await executeProjectInspection(
      { ...readRequest, path: "../escape" },
      { registry, spawnRunner: makeRunner(() => ({})), viewBuilder: trackingViewBuilder },
    );
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("path_invalid");
    expect(usedViews.length).toBe(0);
  });

  it("returns unavailable when the substrate is missing (no custom spawn)", async () => {
    const result = await executeProjectInspection(readRequest, {
      registry,
      available: () => false,
      viewBuilder: trackingViewBuilder,
    });
    expect(result.outcome).toBe("unavailable");
    expect(usedViews.length).toBe(0);
  });

  it("maps runner failure codes, timeouts, and overflows to typed failures", async () => {
    const cases: Array<{ label: string; runner: InspectionSpawn; expected: string }> = [
      {
        label: "runner code",
        runner: async () => ({
          exitCode: 1,
          stdout: JSON.stringify({ code: "not_found" }),
          stderr: "",
          timedOut: false,
          stdoutOverflow: false,
          stderrOverflow: false,
        } as InspectionSpawnOutput),
        expected: "not_found",
      },
      {
        label: "timeout",
        runner: async () => ({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: true,
          stdoutOverflow: false,
          stderrOverflow: false,
        } as InspectionSpawnOutput),
        expected: "timeout",
      },
      {
        label: "stdout overflow",
        runner: async () => ({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          stdoutOverflow: true,
          stderrOverflow: false,
        } as InspectionSpawnOutput),
        expected: "stdout-overflow",
      },
      {
        label: "malformed output",
        runner: async () => ({
          exitCode: 0,
          stdout: "not json",
          stderr: "",
          timedOut: false,
          stdoutOverflow: false,
          stderrOverflow: false,
        } as InspectionSpawnOutput),
        expected: "malformed-output",
      },
    ];
    for (const c of cases) {
      const result = await executeProjectInspection(readRequest, {
        registry,
        spawnRunner: c.runner,
        viewBuilder: trackingViewBuilder,
      });
      expect(result.outcome).toBe("failed");
      if (result.outcome === "failed") expect(result.error).toBe(c.expected);
    }
    expect(usedViews.length).toBe(cases.length);
    expect(usedViews.every((v) => !existsSync(v))).toBe(true);
  });

  it("fails closed when runner evidence is incomplete or checks are false", async () => {
    const broken = await executeProjectInspection(readRequest, {
      registry,
      spawnRunner: makeRunner(() => ({
        version: 2,
        operation: "project.read_file",
        ok: true,
        result: { kind: "project.read_file", path: "src/main.ts", bytes: 1, contentBase64: "eA==", sha256: "f".repeat(64), truncated: false },
        checks: { ...goodChecks(), envClean: false },
      })),
      viewBuilder: trackingViewBuilder,
    });
    expect(broken.outcome).toBe("failed");
    if (broken.outcome === "failed") expect(broken.error).toBe("invalid-result");

    const missingChecks = { ...goodChecks() } as Record<string, unknown>;
    delete missingChecks.envClean;
    const missing = await executeProjectInspection(readRequest, {
      registry,
      spawnRunner: makeRunner(() => ({
        version: 2,
        operation: "project.read_file",
        ok: true,
        result: { kind: "project.read_file", path: "src/main.ts", bytes: 1, contentBase64: "eA==", sha256: "f".repeat(64), truncated: false },
        checks: missingChecks,
      })),
      viewBuilder: trackingViewBuilder,
    });
    expect(missing.outcome).toBe("failed");
    if (missing.outcome === "failed") expect(missing.error).toBe("invalid-result");
  });

  it("fails closed when loopback isolation is not proven (runner connects)", async () => {
    const result = await executeProjectInspection(readRequest, {
      registry,
      spawnRunner: makeRunner(() => ({
        version: 2,
        operation: "project.read_file",
        ok: true,
        result: { kind: "project.read_file", path: "src/main.ts", bytes: 1, contentBase64: "eA==", sha256: "f".repeat(64), truncated: false },
        checks: { ...goodChecks(), loopbackConnectSucceeded: true },
      })),
      viewBuilder: trackingViewBuilder,
    });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("loopback-isolation-failed");
  });

  it("restores the secret env after execution", async () => {
    process.env[V2_SECRET_ENV_KEY] = "previous";
    const result = await executeProjectInspection(readRequest, {
      registry,
      spawnRunner: makeRunner(() => ({
        version: 2,
        operation: "project.read_file",
        ok: true,
        result: { kind: "project.read_file", path: "src/main.ts", bytes: 1, contentBase64: "eA==", sha256: "f".repeat(64), truncated: false },
        checks: goodChecks(),
      })),
      viewBuilder: trackingViewBuilder,
    });
    expect(result.outcome).toBe("succeeded");
    expect(process.env[V2_SECRET_ENV_KEY]).toBe("previous");
  });
});

describe("executeProjectInspection preparation phase", () => {
  let nowMs = 1_000;
  const clock = { nowMs: () => nowMs };
  let spawnCalls = 0;
  const countingSpawn: InspectionSpawn = async (input) => {
    spawnCalls += 1;
    return makeRunner(() => ({
      version: 2,
      operation: "project.read_file",
      ok: true,
      result: {
        kind: "project.read_file",
        path: "src/main.ts",
        bytes: 12,
        contentBase64: "Y29uc3QgeCA9IDE7Cg==",
        sha256: "f".repeat(64),
        truncated: false,
      },
      checks: goodChecks(),
    }))(input);
  };

  function reset(startAtMs = 1_000): void {
    nowMs = startAtMs;
    spawnCalls = 0;
  }

  it("reports preparation expiry at entry with no dispatch and no cancellation semantics", async () => {
    reset();
    const result = await executeProjectInspection(readRequest, {
      registry,
      projectInspectionPreparationDeadlineAtMs: 900,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock,
      spawnRunner: countingSpawn,
      viewBuilder: trackingViewBuilder,
    });

    expect(spawnCalls).toBe(0);
    expect(usedViews.length).toBe(0);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "project_inspection_preparation_deadline_expired",
      dispatchAttempted: false,
    });
    expect(result.cancellationRequested).toBeUndefined();
    expect(result.cancellationAcknowledged).toBeUndefined();
  });

  it("maps mid-view cooperative expiry to the preparation error", async () => {
    reset();
    const result = await executeProjectInspection(readRequest, {
      registry,
      projectInspectionPreparationDeadlineAtMs: 1_200,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock,
      spawnRunner: countingSpawn,
      viewBuilder: async () => ({ ok: false, error: "deadline_exceeded" }),
    });

    expect(spawnCalls).toBe(0);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "project_inspection_preparation_deadline_expired",
      dispatchAttempted: false,
    });
    expect(result.cancellationRequested).toBeUndefined();
    expect(result.cancellationAcknowledged).toBeUndefined();
  });

  it("enforces the final pre-dispatch boundary after the view is built", async () => {
    reset();
    const result = await executeProjectInspection(readRequest, {
      registry,
      projectInspectionPreparationDeadlineAtMs: 1_200,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock,
      spawnRunner: countingSpawn,
      viewBuilder: async (options) => {
        const view = await trackingViewBuilder(options);
        nowMs = 1_250;
        return view;
      },
    });

    expect(spawnCalls).toBe(0);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "project_inspection_preparation_deadline_expired",
      dispatchAttempted: false,
    });
    expect(usedViews.every((view) => !existsSync(view))).toBe(true);
  });

  it("reports explicit dispatch truth when preparation completes in budget", async () => {
    reset();
    const result = await executeProjectInspection(readRequest, {
      registry,
      projectInspectionPreparationDeadlineAtMs: 1_200,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock,
      spawnRunner: async (input) => {
        nowMs = 1_290;
        return countingSpawn(input);
      },
      viewBuilder: async (options) => {
        const view = await trackingViewBuilder(options);
        nowMs = 1_100;
        return view;
      },
    });

    expect(spawnCalls).toBe(1);
    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded") {
      expect(result.dispatchAttempted).toBe(true);
      expect(result.dispatchAttemptedAtMs).toBe(1_100);
      expect(result.dispatchAttemptedAtMs!).toBeLessThanOrEqual(1_200);
    }
  });

  it("rejects a plan whose preparation boundary is not before child execution", async () => {
    reset();
    const result = await executeProjectInspection(readRequest, {
      registry,
      projectInspectionPreparationDeadlineAtMs: 1_300,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock,
      spawnRunner: countingSpawn,
      viewBuilder: trackingViewBuilder,
    });

    expect(spawnCalls).toBe(0);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "invalid_deadline_plan",
      dispatchAttempted: false,
    });
  });

  it("reclassifies preparation-failure cleanup that crosses settlement while retaining the truthful preparation reason", async () => {
    reset();
    const result = await executeProjectInspection(readRequest, {
      registry,
      projectInspectionPreparationDeadlineAtMs: 1_200,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock,
      spawnRunner: countingSpawn,
      viewBuilder: async (options) => {
        const view = await trackingViewBuilder(options);
        // Preparation expires after the view is built, before dispatch.
        nowMs = 1_250;
        return view;
      },
      serverCloser: (server, connections) => {
        // Mandatory settlement cleanup of the partial view overruns
        // T_acquisition_settlement.
        server.close();
        for (const socket of connections) socket.destroy();
        connections.clear();
        nowMs = 1_600;
      },
    });

    expect(spawnCalls).toBe(0);
    expect(result).toMatchObject({
      outcome: "failed",
      error: "settlement_deadline_exceeded",
      dispatchAttempted: false,
      preparationEndedReason: "project_inspection_preparation_deadline_expired",
    });
    expect(result.cancellationRequested).toBeUndefined();
    expect(result.cancellationAcknowledged).toBeUndefined();
    expect(usedViews.every((view) => !existsSync(view))).toBe(true);
  });

  it("reports canonical dispatch truth when a synchronous spawnRunner throw follows the seam invocation", async () => {
    reset();
    const result = await executeProjectInspection(readRequest, {
      registry,
      projectInspectionPreparationDeadlineAtMs: 1_200,
      childExecutionDeadlineAtMs: 1_300,
      childTerminationDeadlineAtMs: 1_400,
      settlementDeadlineAtMs: 1_500,
      clock,
      spawnRunner: () => {
        throw new Error("spawn-seam-boom");
      },
      viewBuilder: async (options) => {
        const view = await trackingViewBuilder(options);
        nowMs = 1_100;
        return view;
      },
    });

    expect(result).toMatchObject({
      outcome: "failed",
      error: "internal-error",
      dispatchAttempted: true,
      dispatchAttemptedAtMs: 1_100,
    });
    expect(result.cancellationRequested).toBeUndefined();
    expect(result.cancellationAcknowledged).toBeUndefined();
    expect(usedViews.every((view) => !existsSync(view))).toBe(true);
  });
});
