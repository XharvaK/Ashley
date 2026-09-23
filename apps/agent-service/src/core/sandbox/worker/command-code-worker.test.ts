import { describe, expect, it, vi } from "vitest";
import { MODE_B_INVESTIGATE } from "./contracts.js";
import { toSanitizedFailureEvidenceJson } from "../../cognitive-v021/operation/dispatch.js";
import type { ExecuteProjectInspectionV2Result } from "../v2-execution.js";
import {
  buildCommandCodeInvocation,
  COMMAND_CODE_WORKER_EFFORT,
  COMMAND_CODE_WORKER_MODEL_ID,
  extractCommandCodeErrorEvidence,
  executeCommandCodeWorker,
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
    expect(args).toContain("--max-turns 1");
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
