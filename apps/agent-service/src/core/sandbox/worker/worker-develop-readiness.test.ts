import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MODE_B_HOST_MAX_STEPS, MODE_B_INVESTIGATE } from "./contracts.js";
import { validateModeBRequest } from "./mode-b-request.js";
import {
  buildCommandCodeInvocation,
  commandCodeWorkerReadiness,
  COMMAND_CODE_WORKER_MAX_TURNS,
  COMMAND_CODE_WORKER_PINNED_VERSION,
  executeCommandCodeWorker,
  resolveCommandCodeRuntime,
  type CommandCodeWorkerTransport,
} from "./command-code-worker.js";

function fakeRuntimeInstall(pin = COMMAND_CODE_WORKER_PINNED_VERSION) {
  const root = mkdtempSync(join(tmpdir(), "ccw-readiness-"));
  const nodeBin = join(root, "runtime", "bin", "node");
  const packageDir = join(root, "runtime", "lib", "node_modules", "command-code");
  const script = join(packageDir, "dist", "index.mjs");
  mkdirSync(dirname(nodeBin), { recursive: true });
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(nodeBin, "node", "utf8");
  writeFileSync(script, "// cli entry", "utf8");
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "command-code", version: pin }), "utf8");
  const bubblewrap = join(root, "bwrap");
  writeFileSync(bubblewrap, "bwrap", "utf8");
  return {
    binaryPath: script,
    bubblewrapPath: bubblewrap,
    nodeExecutable: nodeBin,
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("commandCodeWorkerReadiness (selected DEVELOP backend owner)", () => {
  it("reports ready only when enabled, keyed, version-pinned, and isolated", () => {
    const install = fakeRuntimeInstall();
    try {
      const ready = commandCodeWorkerReadiness({
        workerEnabled: true,
        apiKey: "key",
        binaryPath: install.binaryPath,
        pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
        bubblewrapPath: install.bubblewrapPath,
        nodeExecutable: install.nodeExecutable,
      });
      expect(ready).toMatchObject({ ready: true, reason: null, enabled: true, apiKeyPresent: true, binaryReady: true, isolationAvailable: true });
      expect(resolveCommandCodeRuntime(install.binaryPath, install.nodeExecutable)?.version).toBe(COMMAND_CODE_WORKER_PINNED_VERSION);
    } finally {
      install.cleanup();
    }
  });

  it("evaluates blockers in order and never fabricates later facts", () => {
    expect(commandCodeWorkerReadiness({
      workerEnabled: false,
      apiKey: "",
      binaryPath: "",
      pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
      bubblewrapPath: "",
    })).toMatchObject({ ready: false, reason: "worker_disabled" });

    expect(commandCodeWorkerReadiness({
      workerEnabled: true,
      apiKey: "  ",
      binaryPath: "",
      pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
      bubblewrapPath: "",
    })).toMatchObject({ ready: false, reason: "credentials_missing" });

    const install = fakeRuntimeInstall();
    try {
      expect(commandCodeWorkerReadiness({
        workerEnabled: true,
        apiKey: "key",
        binaryPath: install.binaryPath,
        pinnedVersion: "0.0.0-wrong",
        bubblewrapPath: install.bubblewrapPath,
        nodeExecutable: install.nodeExecutable,
      })).toMatchObject({ ready: false, reason: "binary_unavailable", binaryReady: false });

      expect(commandCodeWorkerReadiness({
        workerEnabled: true,
        apiKey: "key",
        binaryPath: install.binaryPath,
        pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
        bubblewrapPath: join(install.root, "missing-bwrap"),
        nodeExecutable: install.nodeExecutable,
      })).toMatchObject({ ready: false, reason: "isolation_unavailable", binaryReady: true, isolationAvailable: false });
    } finally {
      install.cleanup();
    }
  });
});

describe("Mode B worker resource policy", () => {
  it("keeps the Host step ceiling at 128 and the CLI turn ceiling at 128 as distinct counters", () => {
    expect(MODE_B_HOST_MAX_STEPS).toBe(128);
    expect(COMMAND_CODE_WORKER_MAX_TURNS).toBe(128);
    const invocation = buildCommandCodeInvocation({
      runtime: {
        root: "/opt/command-code/runtime",
        node: "/opt/command-code/runtime/bin/node",
        script: "/opt/command-code/runtime/lib/node_modules/command-code/dist/index.mjs",
      },
      bubblewrapPath: "/usr/bin/bwrap",
      apiKey: "key",
      prompt: "prompt",
    });
    const turnsIndex = invocation.args.indexOf("--max-turns");
    expect(Number(invocation.args[turnsIndex + 1])).toBe(128);
  });

  it("honors Thought-requested lower maxSteps and clamps only above the ceiling", () => {
    expect(validateModeBRequest({
      kind: MODE_B_INVESTIGATE,
      request: { projectId: "project-ashley", maxSteps: 3 },
    })).toMatchObject({ ok: true, value: { maxSteps: 3 } });
    expect(validateModeBRequest({
      kind: MODE_B_INVESTIGATE,
      request: { projectId: "project-ashley" },
    })).toMatchObject({ ok: true, value: { maxSteps: MODE_B_HOST_MAX_STEPS } });
    expect(validateModeBRequest({
      kind: MODE_B_INVESTIGATE,
      request: { projectId: "project-ashley", maxSteps: 10_000 },
    })).toMatchObject({ ok: true, value: { maxSteps: 128 } });
  });

  it("bounds the host loop by the requested step count while the CLI keeps its own turn ceiling", async () => {
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({
        text: JSON.stringify({ type: "tool_request", operation: "bash", request: { command: "nope" } }),
        status: 0,
      })),
    };
    const dispatchers = {
      executeProjectInspectionV2: vi.fn(),
      executeWorkspaceExperimentV2: vi.fn(),
    };
    const result = await executeCommandCodeWorker({
      kind: MODE_B_INVESTIGATE,
      request: { projectId: "project-ashley", maxSteps: 2 },
      purpose: "counter distinction witness",
      apiKey: "test-key",
      binaryPath: "/opt/command-code/bin/command-code",
      bubblewrapPath: "/usr/bin/bwrap",
      pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
      dispatchers,
      inspectionBase: {
        projectInspectionPreparationDeadlineAtMs: Date.now() + 60_000,
        childExecutionDeadlineAtMs: Date.now() + 60_000,
        childTerminationDeadlineAtMs: Date.now() + 60_000,
        settlementDeadlineAtMs: Date.now() + 120_000,
      },
      workspaceBase: {},
      nowMs: () => Date.now(),
      deadlineAtMs: Date.now() + 120_000,
      workerEnabled: true,
      gateOk: true,
      transport,
    });
    expect(transport.complete).toHaveBeenCalledTimes(2);
    expect(dispatchers.executeProjectInspectionV2).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      license: { state: "failed", error: "worker_step_limit", executionTruth: "effect_indeterminate" },
    });
    const invocation = buildCommandCodeInvocation({
      runtime: {
        root: "/opt/command-code/runtime",
        node: "/opt/command-code/runtime/bin/node",
        script: "/opt/command-code/runtime/lib/node_modules/command-code/dist/index.mjs",
      },
      bubblewrapPath: "/usr/bin/bwrap",
      apiKey: "key",
      prompt: "prompt",
    });
    const turnsIndex = invocation.args.indexOf("--max-turns");
    expect(Number(invocation.args[turnsIndex + 1])).toBe(128);
  });

  it("does not reset the session deadline per step; the wall clock still ends the worker", async () => {
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({
        text: JSON.stringify({ type: "tool_request", operation: "bash", request: { command: "nope" } }),
        status: 0,
      })),
    };
    let clock = 1_000_000;
    const start = clock;
    const result = await executeCommandCodeWorker({
      kind: MODE_B_INVESTIGATE,
      request: { projectId: "project-ashley" },
      purpose: "deadline witness",
      apiKey: "test-key",
      binaryPath: "/opt/command-code/bin/command-code",
      bubblewrapPath: "/usr/bin/bwrap",
      pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
      dispatchers: {
        executeProjectInspectionV2: vi.fn(),
        executeWorkspaceExperimentV2: vi.fn(),
      },
      inspectionBase: {
        projectInspectionPreparationDeadlineAtMs: start + 60_000,
        childExecutionDeadlineAtMs: start + 60_000,
        childTerminationDeadlineAtMs: start + 60_000,
        settlementDeadlineAtMs: start + 120_000,
      },
      workspaceBase: {},
      nowMs: () => (clock += 5_000),
      deadlineAtMs: start + 300_000,
      workerEnabled: true,
      gateOk: true,
      transport,
    });
    expect(result.license.error).toBe("deadline_exhausted");
    expect(vi.mocked(transport.complete).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(transport.complete).mock.calls.length).toBeLessThan(MODE_B_HOST_MAX_STEPS);
  });

  it("fails closed at dispatch when readiness was lost after projection", async () => {
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: "", status: 0 })),
    };
    const disabled = await executeCommandCodeWorker({
      kind: MODE_B_INVESTIGATE,
      request: { projectId: "project-ashley" },
      purpose: "fail-closed witness",
      apiKey: "test-key",
      binaryPath: "/opt/command-code/bin/command-code",
      bubblewrapPath: "/usr/bin/bwrap",
      pinnedVersion: COMMAND_CODE_WORKER_PINNED_VERSION,
      dispatchers: {
        executeProjectInspectionV2: vi.fn(),
        executeWorkspaceExperimentV2: vi.fn(),
      },
      inspectionBase: {
        projectInspectionPreparationDeadlineAtMs: Date.now() + 60_000,
        childExecutionDeadlineAtMs: Date.now() + 60_000,
        childTerminationDeadlineAtMs: Date.now() + 60_000,
        settlementDeadlineAtMs: Date.now() + 120_000,
      },
      workspaceBase: {},
      nowMs: () => Date.now(),
      deadlineAtMs: Date.now() + 120_000,
      workerEnabled: false,
      gateOk: true,
      transport,
    });
    expect(transport.complete).not.toHaveBeenCalled();
    expect(disabled).toMatchObject({
      license: { state: "none", error: "worker_disabled", executionTruth: "no_effect_proven" },
    });
  });
});
