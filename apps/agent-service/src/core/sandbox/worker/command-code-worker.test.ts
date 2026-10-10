import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MODE_B_DEVELOP, MODE_B_INVESTIGATE } from "./contracts.js";
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
    expect(args).toContain("--effort high");
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

  it("uses Muse high for each turn and sends tool requests only through Host dispatch", async () => {
    const outputs = [
      JSON.stringify({ type: "tool_request", operation: "project.read_file", request: { path: "README.md" } }),
      JSON.stringify({ type: "complete", summary: "Read the requested project file." }),
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };
    const input = {
      ...workerInput(transport),
      operationId: "operation:direct-worker-1",
      conversationId: "conversation:direct-worker-1",
      cycleId: "cycle:direct-worker-1",
      generation: 6,
    };

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
      commandCodeInvocations: [
        {
          operationId: "operation:direct-worker-1",
          conversationId: "conversation:direct-worker-1",
          cycleId: "cycle:direct-worker-1",
          generation: 6,
          backend: "command_code_cli",
          configuredModelId: COMMAND_CODE_WORKER_MODEL_ID,
          effort: COMMAND_CODE_WORKER_EFFORT,
          cliVersion: "1.64.0",
          turnIndex: 1,
          processExitStatus: 0,
          resultHash: expect.stringMatching(/^sha256:/),
          returnedModelEvidence: "not_reported_by_cli",
        },
        {
          operationId: "operation:direct-worker-1",
          backend: "command_code_cli",
          configuredModelId: COMMAND_CODE_WORKER_MODEL_ID,
          effort: COMMAND_CODE_WORKER_EFFORT,
          turnIndex: 2,
          processExitStatus: 0,
          resultHash: expect.stringMatching(/^sha256:/),
        },
      ],
    });
  });

  it("keeps proven no-effect tool failures when the final worker message is malformed", async () => {
    const outputs = [
      ...Array.from({ length: 3 }, () => JSON.stringify({
        type: "tool_request",
        operation: "workspace.read_file",
        request: {},
      })),
      "The requested file could not be read.",
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };

    const result = await executeCommandCodeWorker({
      ...workerInput(transport),
      kind: MODE_B_DEVELOP,
      request: { projectId: "project-ashley", maxSteps: 5 },
      workspaceId: "workspace-no-effect",
    });

    expect(result.license).toMatchObject({
      state: "failed",
      error: "malformed_worker_output",
      terminationClass: "MALFORMED_RESULT",
      executionTruth: "no_effect_proven",
    });
    expect(result.steps).toHaveLength(3);
    expect(result.steps.map((step) => step.license.executionTruth)).toEqual([
      "no_effect_proven", "no_effect_proven", "no_effect_proven",
    ]);
    expect(result.steps[0]?.license.fieldErrors?.[0]).toMatchObject({
      fieldPath: "$.path",
      executionStarted: false,
    });
  });

  it("bounds malformed-output diagnostics and records structure without values", async () => {
    const credential = `sk-${"v".repeat(24)}`;
    const malformed = JSON.stringify({
      type: "unknown_message",
      api_key: credential,
      ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`field_${index}`, `private-value-${index}`])),
    });
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: malformed, status: 0 })),
    };

    const result = await executeCommandCodeWorker(workerInput(transport));

    expect(result.license.error).toBe("malformed_worker_output");
    expect(result).toMatchObject({
      diagnostics: {
        malformedWorkerOutput: {
          decoderVersion: "ashley.command_code.worker_message.v1",
          failedPredicate: "supported_message_type",
          envelopeShape: expect.stringContaining("object"),
          byteCount: Buffer.byteLength(malformed, "utf8"),
          excerpt: expect.any(String),
        },
      },
    });
    const diagnostic = JSON.stringify(result.diagnostics);
    expect(result.diagnostics?.malformedWorkerOutput?.excerpt?.length).toBeLessThanOrEqual(256);
    expect(diagnostic).not.toContain(credential);
    expect(diagnostic).not.toContain("private-value-");
  });

  it("preserves the requested maxSteps bound", async () => {
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({
        text: JSON.stringify({
          type: "tool_request",
          operation: "workspace.read_file",
          request: {},
        }),
        status: 0,
      })),
    };

    const result = await executeCommandCodeWorker({
      ...workerInput(transport),
      kind: MODE_B_DEVELOP,
      request: { projectId: "project-ashley", maxSteps: 5 },
      workspaceId: "workspace-max-steps",
    });

    expect(transport.complete).toHaveBeenCalledTimes(5);
    expect(result.steps).toHaveLength(5);
    expect(result.license).toMatchObject({
      error: "worker_step_limit",
      terminationClass: "RESOURCE_EXHAUSTED",
      executionTruth: "no_effect_proven",
    });
  });

  it("keeps unknown child effect truth after a successful worker summary", async () => {
    const outputs = [
      JSON.stringify({ type: "tool_request", operation: "workspace.read_file", request: { path: "README.md" } }),
      JSON.stringify({ type: "complete", summary: "The read request was handled." }),
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };
    const base = workerInput(transport);
    const input = {
      ...base,
      kind: MODE_B_DEVELOP,
      workspaceId: "workspace-unknown-child",
      dispatchers: {
        ...base.dispatchers,
        executeWorkspaceExperimentV2: vi.fn(async () => ({
          license: { state: "succeeded" as const, profile: "workspace_experiment" as const, executionTruth: "effect_unknown" as const },
          observation: null,
        })),
      },
    } as Parameters<typeof executeCommandCodeWorker>[0];

    const result = await executeCommandCodeWorker(input);

    expect(result.license).toMatchObject({
      state: "succeeded",
      terminationClass: "SUCCESS",
      executionTruth: "effect_unknown",
    });
    expect(result.steps[0]?.license.executionTruth).toBe("effect_unknown");
  });

  it("aggregates an earlier verified step and a later unknown step as partial", async () => {
    const outputs = [
      JSON.stringify({ type: "tool_request", operation: "workspace.read_file", request: { path: "README.md" } }),
      JSON.stringify({ type: "tool_request", operation: "workspace.read_file", request: { path: "package.json" } }),
      JSON.stringify({ type: "complete", summary: "Both requests were handled." }),
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };
    const base = workerInput(transport);
    let call = 0;
    const input = {
      ...base,
      kind: MODE_B_DEVELOP,
      workspaceId: "workspace-partial-child",
      dispatchers: {
        ...base.dispatchers,
        executeWorkspaceExperimentV2: vi.fn(async () => ({
          license: {
            state: "succeeded" as const,
            profile: "workspace_experiment" as const,
            executionTruth: (call++ === 0 ? "effect_verified" : "effect_unknown") as "effect_verified" | "effect_unknown",
          },
          observation: null,
        })),
      },
    } as Parameters<typeof executeCommandCodeWorker>[0];

    const result = await executeCommandCodeWorker(input);

    expect(result.license.executionTruth).toBe("effect_partial");
    expect(result.steps.map((step) => step.license.executionTruth)).toEqual(["effect_verified", "effect_unknown"]);
  });

  it("keeps a verified write when the worker's final message is malformed", async () => {
    const outputs = [
      JSON.stringify({
        type: "tool_request",
        operation: "workspace.write_file",
        request: { path: "src/created.ts", content: "export const value = 1;" },
      }),
      "The write was successful.",
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };
    const base = workerInput(transport);
    const afterSha256 = "e".repeat(64);
    const input = {
      ...base,
      kind: MODE_B_DEVELOP,
      workspaceId: "workspace-malformed-final",
      dispatchers: {
        ...base.dispatchers,
        executeWorkspaceExperimentV2: vi.fn(async () => ({
          license: {
            state: "succeeded" as const,
            profile: "workspace_experiment" as const,
            executionTruth: "effect_verified" as const,
            workspaceClaimEffect: {
              projectId: "project-ashley",
              workspaceId: "workspace-malformed-final",
              operation: "workspace.write_file",
              logicalRelativePath: "src/created.ts",
              sourceSnapshotId: "snapshot-1",
              completedAtMs: 1,
              beforeSha256: "f".repeat(64),
              afterSha256,
              verified: true,
            },
          },
          observation: null,
        })),
      },
    } as Parameters<typeof executeCommandCodeWorker>[0];

    const result = await executeCommandCodeWorker(input);

    expect(result.license).toMatchObject({
      error: "malformed_worker_output",
      terminationClass: "MALFORMED_RESULT",
      executionTruth: "effect_verified",
    });
    expect(result.steps[0]?.license.workspaceClaimEffect?.afterSha256).toBe(afterSha256);
  });

  it("shows the prior read hash and field error in the next worker turn", async () => {
    const outputs = [
      JSON.stringify({ type: "tool_request", operation: "workspace.read_file", request: { path: "README.md" } }),
      JSON.stringify({ type: "tool_request", operation: "workspace.write_file", request: { path: "README.md" } }),
      JSON.stringify({ type: "complete", summary: "The request was rejected before a write." }),
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };
    const base = workerInput(transport);
    const afterSha256 = "f".repeat(64);
    const input = {
      ...base,
      kind: MODE_B_DEVELOP,
      workspaceId: "workspace-field-feedback",
      dispatchers: {
        ...base.dispatchers,
        executeWorkspaceExperimentV2: vi.fn(async () => ({
          license: {
            state: "succeeded" as const,
            profile: "workspace_experiment" as const,
            executionTruth: "effect_verified" as const,
            workspaceClaimEffect: {
              projectId: "project-ashley",
              workspaceId: "workspace-field-feedback",
              operation: "workspace.read_file",
              logicalRelativePath: "README.md",
              sourceSnapshotId: "snapshot-1",
              completedAtMs: 1,
              afterSha256,
              verified: true,
            },
          },
          observation: null,
        })),
      },
    } as Parameters<typeof executeCommandCodeWorker>[0];

    const result = await executeCommandCodeWorker(input);

    expect(result.license.terminationClass).toBe("SUCCESS");
    const nextPrompt = vi.mocked(transport.complete).mock.calls[2]?.[0].prompt ?? "";
    expect(nextPrompt).toContain(afterSha256);
    expect(nextPrompt).toContain("$.content");
    expect(nextPrompt).toContain("required_field_missing");
  });

  it("puts the required workspace fields and write/hash semantics in the worker prompt", async () => {
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({
        text: JSON.stringify({ type: "complete", summary: "No workspace operation was needed." }),
        status: 0,
      })),
    };

    await executeCommandCodeWorker({
      ...workerInput(transport),
      kind: MODE_B_DEVELOP,
      workspaceId: "workspace-prompt-test",
    });

    const prompt = vi.mocked(transport.complete).mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("expectedSha256");
    expect(prompt).toContain("raw-byte SHA-256");
    expect(prompt).toContain("create-only");
    expect(prompt).toContain("file_exists");
    expect(prompt).toContain("read_file is limited to 65536 bytes and refuses non-UTF-8");
    expect(prompt).toContain("search_text matches literal substrings within lines");
    expect(prompt).toContain("truncated=true indicates omitted matches or traversal");
    expect(prompt).not.toContain('"request":{...}');
  });

  it("keeps the read hash and target ahead of content truncated from worker history", async () => {
    const content = "x".repeat(20_000);
    const afterSha256 = "b".repeat(64);
    const outputs = [
      JSON.stringify({
        type: "tool_request",
        operation: "workspace.read_file",
        request: { path: "src/large.ts" },
      }),
      JSON.stringify({ type: "complete", summary: "Read the file." }),
    ];
    const transport: CommandCodeWorkerTransport = {
      complete: vi.fn(async () => ({ text: outputs.shift()!, status: 0 })),
    };
    const base = workerInput(transport);
    const input = {
      ...base,
      kind: MODE_B_DEVELOP,
      workspaceId: "workspace-hash-test",
      dispatchers: {
        ...base.dispatchers,
        executeWorkspaceExperimentV2: vi.fn(async () => ({
          license: {
            state: "succeeded" as const,
            profile: "workspace_experiment" as const,
            executionTruth: "effect_verified" as const,
            workspaceClaimEffect: {
              projectId: "project-ashley",
              workspaceId: "workspace-hash-test",
              operation: "workspace.read_file",
              logicalRelativePath: "src/large.ts",
              sourceSnapshotId: "snapshot-1",
              bytesRead: content.length,
              afterSha256,
              completedAtMs: 1,
              verified: true,
              claimEffectId: "effect-1",
            },
          },
          observation: {
            kind: "workspace_experiment_observation" as const,
            projectId: "project-ashley",
            workspaceId: "workspace-hash-test",
            verified: true,
            executedAtMs: 1,
            operation: "workspace.read_file",
            path: "src/large.ts",
            contentUtf8: content,
            afterSha256,
          },
        })),
      },
    } as Parameters<typeof executeCommandCodeWorker>[0];

    await executeCommandCodeWorker(input);

    const nextPrompt = vi.mocked(transport.complete).mock.calls[1]?.[0].prompt ?? "";
    expect(nextPrompt).toContain(afterSha256);
    expect(nextPrompt).toContain("src/large.ts");
    expect(nextPrompt).not.toContain(content);
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
