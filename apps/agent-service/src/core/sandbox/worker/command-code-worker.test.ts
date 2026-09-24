import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MODE_B_INVESTIGATE } from "./contracts.js";
import { toSanitizedFailureEvidenceJson } from "../../cognitive-v021/operation/dispatch.js";
import type { ExecuteProjectInspectionV2Result } from "../v2-execution.js";
import {
  buildCommandCodeInvocation,
  COMMAND_CODE_WORKER_EFFORT,
  COMMAND_CODE_WORKER_MAX_TURNS,
  COMMAND_CODE_WORKER_MODEL_ID,
  extractCommandCodeErrorEvidence,
  executeCommandCodeWorker,
  spawnCommandCodeTransport,
  type CommandCodeWorkerTransport,
} from "./command-code-worker.js";

const DEADLINE = Date.now() + 120_000;

function workerInput(transport: CommandCodeWorkerTransport) {
  return {
    kind: MODE_B_INVESTIGATE,
    request: { projectId: "project-ashley", focus: "inspect the requested project" },
    purpose: "P5 worker-route evidence",
    apiKey: "test-command-code-key",
    binaryPath: "/opt/command-code/bin/command-code",
    bubblewrapPath: "/usr/bin/bwrap",
    pinnedVersion: "1.64.0",
    dispatchers: {
      executeProjectInspectionV2: vi.fn(async () => ({
        license: { state: "succeeded" as const, profile: "project_investigation" },
        observation: {
          operation: "project.read_file",
          path: "README.md",
          contentUtf8: "trusted host fixture content",
        } as unknown as NonNullable<ExecuteProjectInspectionV2Result["observation"]>,
        dispatchAttempted: true,
      })),
      executeWorkspaceExperimentV2: vi.fn(async () => ({
        license: { state: "none" as const, profile: "workspace_experiment" },
        observation: null,
      })),
    },
    inspectionBase: {
      projectInspectionPreparationDeadlineAtMs: DEADLINE - 5_000,
      childExecutionDeadlineAtMs: DEADLINE - 4_000,
      childTerminationDeadlineAtMs: DEADLINE - 2_000,
      settlementDeadlineAtMs: DEADLINE,
    },
    workspaceBase: {},
    pathEnv: "/usr/bin:/bin",
    nowMs: () => Date.now(),
    deadlineAtMs: DEADLINE,
    workerEnabled: true,
    gateOk: true,
    transport,
  };
}

describe("command-code-worker", () => {
  it("runs inside the isolated bubblewrap root and keeps the key and prompt out of argv", () => {
    const secret = "command-code-secret-value";
    const prompt = "private host-routed worker prompt";
    const invocation = buildCommandCodeInvocation({
      runtime: {
        root: "/opt/command-code/runtime",
        node: "/opt/command-code/runtime/bin/node",
        script: "/opt/command-code/runtime/lib/node_modules/command-code/dist/index.mjs",
      },
      bubblewrapPath: "/usr/bin/bwrap",
      apiKey: secret,
      prompt,
    });
    const args = invocation.args.join(" ");

    expect(args).toContain("--unshare-all");
    expect(args).toContain("--share-net");
    expect(args).toContain("--ro-bind / /");
    expect(args).toContain("--tmpfs /home");
    expect(args).toContain("--tmpfs /tmp");
    expect(args).toContain("--ro-bind /opt/command-code/runtime /opt");
    expect(args).toContain("--effort xhigh");
    const maxTurnsIndex = invocation.args.indexOf("--max-turns");
    expect(maxTurnsIndex).toBeGreaterThanOrEqual(0);
    expect(Number(invocation.args[maxTurnsIndex + 1])).toBe(COMMAND_CODE_WORKER_MAX_TURNS);
    expect(COMMAND_CODE_WORKER_MAX_TURNS).toBe(128);
    expect(args).toContain("--output-format json");
    expect(args).toContain("--permission-mode plan");
    expect(args).toContain("--no-session");
    expect(args).not.toContain(secret);
    expect(args).not.toContain(prompt);
    expect(invocation.env.COMMAND_CODE_API_KEY).toBe(secret);
    expect(invocation.stdin).toBe(prompt);
  });

  it("uses Muse xhigh for each turn and sends tool requests only through Host dispatch", async () => {
    const outputs = [
      JSON.stringify({ type: "tool_request", operation: "project.read_file", request: { path: "README.md" } }),
      JSON.stringify({ type: "complete", summary: "Read the requested project file." }),
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };
    const input = workerInput(transport);

    const result = await executeCommandCodeWorker(input);

    expect(transport.complete).toHaveBeenCalledTimes(2);
    for (const [turn] of vi.mocked(transport.complete).mock.calls) {
      expect(turn).toMatchObject({
        modelId: COMMAND_CODE_WORKER_MODEL_ID,
        effort: COMMAND_CODE_WORKER_EFFORT,
      });
      expect(turn.prompt).not.toContain(input.apiKey);
    }
    expect(input.dispatchers.executeProjectInspectionV2).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transport.complete).mock.calls[1]?.[0].prompt).toContain("trusted host fixture content");
    expect(result).toMatchObject({
      license: { state: "succeeded", profile: "command_code_mode_b" },
      selectedModelId: COMMAND_CODE_WORKER_MODEL_ID,
      quotaClass: null,
      summary: "Read the requested project file.",
    });
  });

  it("stops after cancellation before dispatching a late worker tool request", async () => {
    const controller = new AbortController();
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async (turn) => {
        expect(turn.signal).toBe(controller.signal);
        controller.abort("preempt");
        return {
          text: JSON.stringify({ type: "tool_request", operation: "project.read_file", request: { path: "README.md" } }),
          status: 0,
        };
      }),
    };
    const input = { ...workerInput(transport), signal: controller.signal };

    const result = await executeCommandCodeWorker(input);

    expect(input.dispatchers.executeProjectInspectionV2).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      license: {
        state: "none",
        error: "command_code_cancelled",
        executionTruth: "no_effect_proven",
      },
      steps: [],
    });
  });

  it("terminates and confirms the Command Code child on cancellation", async () => {
    vi.useFakeTimers();
    try {
      const signals: string[] = [];
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.kill = vi.fn((signal: string) => {
        signals.push(signal);
        return true;
      });
      const transport = spawnCommandCodeTransport({
        runtime: {
          root: "/opt/command-code/runtime",
          node: "/opt/command-code/runtime/bin/node",
          script: "/opt/command-code/runtime/lib/node_modules/command-code/dist/index.mjs",
          version: "1.64.0",
        },
        bubblewrapPath: "/usr/bin/bwrap",
        apiKey: "test-command-code-key",
      }, {
        spawnChild: (() => child) as any,
      });
      const controller = new AbortController();
      const completion = transport.complete({
        modelId: COMMAND_CODE_WORKER_MODEL_ID,
        effort: COMMAND_CODE_WORKER_EFFORT,
        prompt: "bounded task",
        deadlineAtMs: Date.now() + 60_000,
        signal: controller.signal,
      });
      const outcome = completion.then(
        () => ({ resolved: true as const }),
        (error: unknown) => ({ resolved: false as const, error }),
      );

      controller.abort("preempt");
      expect(signals).toEqual(["SIGTERM"]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      child.emit("exit", 0);
      expect(await Promise.race([outcome, Promise.resolve({ pending: true as const })])).toMatchObject({ pending: true });
      child.emit("close", 0);
      await expect(outcome).resolves.toMatchObject({
        resolved: false,
        error: { message: "command_code_cancelled" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records an upstream 403 as an external prerequisite rejection without retrying", async () => {
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({
        text: "",
        status: 1,
        errorEvidence: {
          statusCode: 403,
          errorType: "account_policy",
          message: "Automated-use request rejected.",
          exitStatus: 1,
          modelId: COMMAND_CODE_WORKER_MODEL_ID,
        },
      })),
    };

    const result = await executeCommandCodeWorker(workerInput(transport));

    expect(transport.complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      license: { state: "none", error: "external_service_rejected", executionTruth: "no_effect_proven" },
      payload: {
        failureEvidence: {
          externalPrerequisite: true,
          statusCode: 403,
          modelId: COMMAND_CODE_WORKER_MODEL_ID,
          commandCodeVersion: "1.64.0",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("test-command-code-key");
  });

  it("extracts a provider status and bounded message without retaining the key", () => {
    const evidence = extractCommandCodeErrorEvidence(JSON.stringify({
      type: "result",
      subtype: "error",
      status: 403,
      error: {
        type: "account_policy",
        message: "test-command-code-key was rejected by policy.",
      },
    }), {
      modelId: COMMAND_CODE_WORKER_MODEL_ID,
      exitStatus: 1,
      apiKey: "test-command-code-key",
    });

    expect(evidence).toMatchObject({
      statusCode: 403,
      errorType: "account_policy",
      message: "[redacted] was rejected by policy.",
      exitStatus: 1,
      modelId: COMMAND_CODE_WORKER_MODEL_ID,
    });
    expect(JSON.stringify(evidence)).not.toContain("test-command-code-key");
  });

  it("persists only bounded external classification and the CLI version", () => {
    const serialized = toSanitizedFailureEvidenceJson({
      failureClass: "external_service_rejected",
      externalPrerequisite: true,
      statusCode: 403,
      errorType: "account_policy",
      message: "Automated-use request rejected.",
      exitStatus: 1,
      modelId: COMMAND_CODE_WORKER_MODEL_ID,
      commandCodeVersion: "1.64.0",
      apiKey: "must-not-persist",
    });

    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized!)).toMatchObject({
      failureClass: "external_service_rejected",
      externalPrerequisite: true,
      statusCode: 403,
      commandCodeVersion: "1.64.0",
    });
    expect(serialized).not.toContain("must-not-persist");
  });
});
