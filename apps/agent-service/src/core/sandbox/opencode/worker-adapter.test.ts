import { EventEmitter } from "node:events";
import { type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENCODE_CLASS_REJECTION_COOLDOWN_MS, OPENCODE_PINNED_VERSION } from "./catalog.js";
import { createTempIsolationRoot } from "./isolation.js";
import { createQuotaRouter, resetOpenCodeProcessQuotaMemory } from "./quota-router.js";
import { emptyQuotaState, recordClassExhausted } from "./quota-state.js";
import type { ExecuteProjectInspectionV2Input } from "../v2-execution.js";
import {
  classifyOpenCodeErrorEvidence,
  decodeOpenCodeRunStdout,
  executeModeBWorker,
  extractOpenCodeErrorEvidence,
  spawnOpenCodeTransport,
  terminateProcessWithEscalation,
  type OpenCodeTransport,
} from "./worker-adapter.js";

const roots: string[] = [];

afterEach(() => {
  resetOpenCodeProcessQuotaMemory();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function baseInput() {
  const isolationRoot = createTempIsolationRoot();
  roots.push(isolationRoot);
  const quota: { state: ReturnType<typeof emptyQuotaState> } = {
    state: {
      NVIDIA_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
      OTHER_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
    },
  };
  return {
    isolationRoot,
    binaryPath: "opencode",
    pinnedVersion: OPENCODE_PINNED_VERSION,
    quotaPath: `${isolationRoot}/quota.json`,
    persistQuota: (state: typeof quota.state) => {
      quota.state = state;
    },
    quota,
    router: createQuotaRouter({ state: quota.state }),
    dispatchers: {
      executeProjectInspectionV2: async (_input: ExecuteProjectInspectionV2Input) => ({
        license: { state: "succeeded" as const, profile: "project_investigation" },
        observation: null,
        dispatchAttempted: true,
      }),
      executeWorkspaceExperimentV2: async () => ({
        license: {
          state: "succeeded" as const,
          profile: "project_experimentation",
          workspaceClaimEffect: {
            verified: true as const,
            projectId: "project-ashley",
            workspaceId: "ws-1",
            operation: "workspace.write_file",
            logicalRelativePath: "a.ts",
            sourceSnapshotId: "snap",
            completedAtMs: 1,
          },
        },
        observation: null,
      }),
    },
    inspectionBase: {
      projectInspectionPreparationDeadlineAtMs: Date.now() + 5_000,
      childExecutionDeadlineAtMs: Date.now() + 10_000,
      childTerminationDeadlineAtMs: Date.now() + 15_000,
      settlementDeadlineAtMs: Date.now() + 20_000,
    },
    workspaceBase: { deadlineAtMs: Date.now() + 20_000 },
    pathEnv: "/usr/bin",
    nowMs: () => Date.now(),
    deadlineAtMs: Date.now() + 60_000,
    workerEnabled: true,
  };
}

describe("Mode-B worker adapter", () => {
  it("preserves prior V2 receipts when quota exhausts mid-task", async () => {
    const base = baseInput();
    let calls = 0;
    const transport: OpenCodeTransport = {
      async complete() {
        calls += 1;
        if (calls === 1) {
          return {
            text: JSON.stringify({
              type: "tool_request",
              operation: "workspace.write_file",
              request: { path: "a.ts", content: "x" },
            }),
          };
        }
        return { text: "quota exceeded", status: 429 };
      },
    };
    const result = await executeModeBWorker({
      ...base,
      kind: "candidate.develop",
      request: { projectId: "project-ashley", workspaceId: "ws-1" },
      purpose: "edit the candidate",
      transport,
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.license.state).toBe("succeeded");
    expect(result.license.state).toBe("failed");
    expect(result.license.error).toBe("worker_capacity_exhausted");
    expect(result.license.workspaceClaimEffect?.verified).toBe(true);
    expect(result.license.executionTruth).not.toBe("no_effect_proven");
  });

  it("does not treat OpenCode prose as proof of execution", async () => {
    const base = baseInput();
    const transport: OpenCodeTransport = {
      async complete() {
        return { text: "I successfully wrote src/secret.ts and committed the live tree." };
      },
    };
    const result = await executeModeBWorker({
      ...base,
      kind: "candidate.develop",
      request: { projectId: "project-ashley", workspaceId: "ws-1" },
      purpose: "edit the candidate",
      transport,
    });
    expect(result.steps).toHaveLength(0);
    expect(result.license.executionTruth).toBe("no_effect_proven");
    expect(base.dispatchers.executeWorkspaceExperimentV2).toBeDefined();
  });

  it("parses OpenCode JSONL text events into the Host protocol", async () => {
    const decoded = decodeOpenCodeRunStdout([
      JSON.stringify({ type: "step_start" }),
      JSON.stringify({ type: "text", text: "{\"type\":\"complete\",\"summary\":\"done\"}" }),
      JSON.stringify({ type: "step_finish" }),
    ].join("\n"));
    expect(decoded.nativeTool).toBe(false);
    expect(decoded.text).toContain("\"type\":\"complete\"");
  });

  it("parses the Mint 1.18.30 JSONL shape for Host tool_request and complete", () => {
    const tool = decodeOpenCodeRunStdout([
      JSON.stringify({
        type: "step_start",
        timestamp: 1789618041886,
        sessionID: "ses_c1",
        part: { id: "prt_1", messageID: "msg_1", sessionID: "ses_c1", type: "step-start" },
      }),
      JSON.stringify({
        type: "text",
        timestamp: 1789618043631,
        sessionID: "ses_c1",
        part: {
          id: "prt_2",
          messageID: "msg_1",
          sessionID: "ses_c1",
          type: "text",
          text: "{\"type\":\"tool_request\",\"operation\":\"project.list_directory\",\"request\":{\"path\":\".\"}}",
        },
      }),
      JSON.stringify({
        type: "step_finish",
        timestamp: 1789618043631,
        sessionID: "ses_c1",
        part: {
          id: "prt_3",
          reason: "stop",
          messageID: "msg_1",
          sessionID: "ses_c1",
          type: "step-finish",
          tokens: { total: 1, input: 1, output: 1, reasoning: 0, cache: { write: 0, read: 0 } },
          cost: 0,
        },
      }),
    ].join("\n"));
    expect(tool.nativeTool).toBe(false);
    expect(JSON.parse(tool.text)).toEqual({
      type: "tool_request",
      operation: "project.list_directory",
      request: { path: "." },
    });

    const complete = decodeOpenCodeRunStdout(
      JSON.stringify({
        type: "text",
        sessionID: "ses_c1",
        part: { type: "text", text: "{\"type\":\"complete\",\"summary\":\"c1-ok\"}" },
      }),
    );
    expect(JSON.parse(complete.text)).toEqual({ type: "complete", summary: "c1-ok" });
  });

  it("does not treat JSON buried in bash-fenced prose as a Host complete", async () => {
    const base = baseInput();
    const transport: OpenCodeTransport = {
      async complete() {
        return {
          text: [
            JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
            JSON.stringify({
              type: "text",
              part: {
                type: "text",
                text: "Let me start by running the test script.\n```bash\necho '{\"type\":\"complete\",\"summary\":\"c1-ok\"}'\n```",
              },
            }),
            JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
          ].join("\n"),
        };
      },
    };
    const result = await executeModeBWorker({
      ...base,
      kind: "project.investigate",
      request: { projectId: "project-ashley" },
      purpose: "look",
      transport,
    });
    expect(result.steps).toHaveLength(0);
    expect(result.license.error).toBe("malformed_worker_output");
    expect(result.license.executionTruth).toBe("no_effect_proven");
  });

  it("refreshes V2 inspection deadlines at each tool dispatch", async () => {
    const base = baseInput();
    const captured: number[] = [];
    base.inspectionBase = {
      ...base.inspectionBase,
      projectInspectionPreparationDeadlineAtMs: 1,
      childExecutionDeadlineAtMs: 2,
      childTerminationDeadlineAtMs: 3,
      settlementDeadlineAtMs: 4,
    };
    let calls = 0;
    await executeModeBWorker({
      ...base,
      dispatchers: {
        ...base.dispatchers,
        executeProjectInspectionV2: async (input) => {
          captured.push(input.projectInspectionPreparationDeadlineAtMs);
          return {
            license: { state: "succeeded" as const, profile: "project_investigation" },
            observation: null,
            dispatchAttempted: true,
          };
        },
      },
      kind: "project.investigate",
      request: { projectId: "project-ashley" },
      purpose: "look",
      transport: {
        async complete() {
          calls += 1;
          if (calls === 1) {
            return {
              text: JSON.stringify({
                type: "tool_request",
                operation: "project.list_directory",
                request: {},
              }),
            };
          }
          return { text: JSON.stringify({ type: "complete", summary: "done" }) };
        },
      },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBeGreaterThan(Date.now() - 2_000);
  });

  it("does not spawn when V2 gates refuse admission", async () => {
    const base = baseInput();
    let spawned = 0;
    const result = await executeModeBWorker({
      ...base,
      kind: "project.investigate",
      request: { projectId: "project-ashley" },
      purpose: "look",
      gateOk: false,
      gateError: "worker_gate_denied",
      transport: {
        async complete() {
          spawned += 1;
          return { text: "{\"type\":\"complete\",\"summary\":\"no\"}" };
        },
      },
    });
    expect(spawned).toBe(0);
    expect(result.license.error).toBe("worker_gate_denied");
  });

  it("does not mark a quota class available after malformed inference", async () => {
    const base = baseInput();
    base.router = createQuotaRouter({ state: emptyQuotaState() });
    await executeModeBWorker({
      ...base,
      kind: "project.investigate",
      request: { projectId: "project-ashley" },
      purpose: "look",
      transport: {
        async complete() {
          return { text: "not-json", status: 1 };
        },
      },
    });
    expect(base.quota.state.NVIDIA_FREE.capacity).not.toBe("available");
  });

  it("refuses NVIDIA engineering when OTHER_FREE is exhausted before spawn", async () => {
    const base = baseInput();
    base.router = createQuotaRouter({
      state: recordClassExhausted(emptyQuotaState(), "OTHER_FREE", { nowMs: 1, backoffMs: 99_999_999 }),
    });
    let spawned = 0;
    const result = await executeModeBWorker({
      ...base,
      kind: "candidate.develop",
      request: { projectId: "project-ashley", workspaceId: "ws-1" },
      purpose: "edit the candidate",
      transport: {
        async complete() {
          spawned += 1;
          return { text: "{\"type\":\"complete\",\"summary\":\"no\"}" };
        },
      },
    });
    expect(spawned).toBe(0);
    expect(result.license.error).toBe("worker_capacity_exhausted");
    expect(result.selectedModelId).toBeNull();
  });

  describe("provider-error truth (structured envelopes never parse as worker output)", () => {
    const RAW_403 = JSON.stringify({
      type: "error",
      timestamp: 1789868378200,
      sessionID: "ses_probe",
      error: {
        name: "APIError",
        data: {
          message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode",
          statusCode: 403,
          isRetryable: false,
          responseBody: JSON.stringify({
            type: "error",
            error: {
              type: "FreeTierError",
              message: "OpenCode's free tier can only be used from within OpenCode",
            },
          }),
        },
      },
    });
    const RAW_429 = JSON.stringify({
      type: "error",
      timestamp: 1789868378200,
      sessionID: "ses_probe",
      error: {
        name: "APIError",
        data: {
          message: "quota exceeded for free tier",
          statusCode: 429,
          isRetryable: true,
          responseBody: JSON.stringify({
            type: "error",
            error: { type: "RateLimitExceeded", message: "quota exceeded, try again later" },
          }),
        },
      },
    });
    const RAW_500 = JSON.stringify({
      type: "error",
      timestamp: 1789868378200,
      sessionID: "ses_probe",
      error: {
        name: "APIError",
        data: {
          message: "provider internal error",
          statusCode: 500,
          isRetryable: true,
        },
      },
    });

    it("extracts 403 FreeTierError evidence and classifies it class-wide", () => {
      const evidence = extractOpenCodeErrorEvidence(RAW_403, {
        exitStatus: 1,
        modelId: "opencode/nemotron-3.5-lightning-free",
      });
      expect(evidence).toMatchObject({
        statusCode: 403,
        errorName: "APIError",
        errorType: "FreeTierError",
        exitStatus: 1,
        modelId: "opencode/nemotron-3.5-lightning-free",
      });
      expect(evidence?.message).toContain("free tier can only be used from within OpenCode");
      expect(classifyOpenCodeErrorEvidence(evidence!)).toEqual({
        kind: "provider_rejected",
        scope: "class",
      });
    });

    it("classifies 429/quota, 5xx, and 404 envelopes without new vocabulary sprawl", () => {
      const quota = extractOpenCodeErrorEvidence(RAW_429, { exitStatus: 1, modelId: "m" });
      expect(classifyOpenCodeErrorEvidence(quota!)).toEqual({ kind: "quota_exhausted" });
      const unavailable = extractOpenCodeErrorEvidence(RAW_500, { exitStatus: 1, modelId: "m" });
      expect(classifyOpenCodeErrorEvidence(unavailable!)).toEqual({
        kind: "provider_unavailable",
        scope: "model",
      });
      const notFound = extractOpenCodeErrorEvidence(
        JSON.stringify({ type: "error", error: { name: "APIError", data: { statusCode: 404, message: "model not found" } } }),
        { exitStatus: 1, modelId: "m" },
      );
      expect(classifyOpenCodeErrorEvidence(notFound!)).toEqual({
        kind: "provider_rejected",
        scope: "model",
      });
    });

    it("extracts no evidence from assistant text events", () => {
      const raw = [
        JSON.stringify({ type: "step_start" }),
        JSON.stringify({ type: "text", text: "{\"type\":\"complete\",\"summary\":\"done\"}" }),
      ].join("\n");
      expect(extractOpenCodeErrorEvidence(raw, { exitStatus: 0, modelId: "m" })).toBeNull();
      expect(extractOpenCodeErrorEvidence("plain prose", { exitStatus: 0, modelId: "m" })).toBeNull();
    });

    it("7.1: 403 FreeTierError is provider rejection, never malformed, with no sibling carousel", async () => {
      const base = baseInput();
      let calls = 0;
      const result = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            calls += 1;
            return {
              text: "",
              status: 1,
              errorEvidence: extractOpenCodeErrorEvidence(RAW_403, {
                exitStatus: 1,
                modelId: "opencode/nemotron-3.5-lightning-free",
              }),
            };
          },
        },
      });
      expect(calls).toBe(1);
      expect(result.steps).toHaveLength(0);
      expect(result.license.error).toBe("opencode_provider_rejected");
      expect(result.license.state).toBe("none");
      expect(result.license.executionTruth).toBe("no_effect_proven");
      expect(result.summary).toBeNull();
      const failureEvidence = result.payload.failureEvidence as Record<string, unknown>;
      expect(failureEvidence).toMatchObject({
        errorClass: "opencode_provider_rejected",
        statusCode: 403,
        errorType: "FreeTierError",
      });
    });

    it("class-wide 403 recovers: a later task re-probes without restart", async () => {
      const base = baseInput();
      let now = 1_000_000;
      const clock = () => now;
      const rejected = extractOpenCodeErrorEvidence(RAW_403, { exitStatus: 1, modelId: "m" });
      let task1Calls = 0;
      const task1 = await executeModeBWorker({
        ...base,
        nowMs: clock,
        deadlineAtMs: now + 60_000,
        router: createQuotaRouter({ state: base.quota.state, nowMs: now }),
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            task1Calls += 1;
            return { text: "", status: 1, errorEvidence: rejected };
          },
        },
      });
      expect(task1Calls).toBe(1);
      expect(task1.license.error).toBe("opencode_provider_rejected");
      // Past the bounded cooldown the backend is eligible again: no restart,
      // no quota write, and the next task probes the provider directly.
      now += OPENCODE_CLASS_REJECTION_COOLDOWN_MS + 1;
      let task2Calls = 0;
      const task2 = await executeModeBWorker({
        ...base,
        nowMs: clock,
        deadlineAtMs: now + 60_000,
        router: createQuotaRouter({ state: base.quota.state, nowMs: now }),
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            task2Calls += 1;
            return { text: JSON.stringify({ type: "complete", summary: "recovered" }) };
          },
        },
      });
      expect(task2Calls).toBe(1);
      expect(task2.license.state).toBe("succeeded");
      expect(task2.summary).toBe("recovered");
    });

    it("7.2: structured 429 keeps quota/capacity exhaustion behavior", async () => {
      const base = baseInput();
      let calls = 0;
      const result = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            calls += 1;
            return {
              text: "",
              status: 1,
              errorEvidence: extractOpenCodeErrorEvidence(RAW_429, { exitStatus: 1, modelId: "m" }),
            };
          },
        },
      });
      expect(calls).toBe(2);
      expect(result.license.error).toBe("worker_capacity_exhausted");
    });

    it("7.3: 5xx is model-scoped: sibling reroute can still succeed", async () => {
      const base = baseInput();
      let calls = 0;
      const result = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete(input) {
            calls += 1;
            if (calls === 1) {
              return {
                text: "",
                status: 1,
                errorEvidence: extractOpenCodeErrorEvidence(RAW_500, {
                  exitStatus: 1,
                  modelId: input.modelId,
                }),
              };
            }
            return { text: JSON.stringify({ type: "complete", summary: "recovered" }) };
          },
        },
      });
      expect(calls).toBe(2);
      expect(result.license.state).toBe("succeeded");
      expect(result.summary).toBe("recovered");
      expect(result.selectedModelId).toBe("opencode/nemotron-3-ultra-free");
      expect(result.payload.failureEvidence).toBeUndefined();
    });

    it("7.4: nonzero exit + structured error never enters the worker parser", async () => {
      const base = baseInput();
      const result = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            // Text that WOULD parse as a valid complete: the parser must
            // never be consulted once structured error evidence exists.
            return {
              text: JSON.stringify({ type: "complete", summary: "fake" }),
              status: 1,
              errorEvidence: extractOpenCodeErrorEvidence(RAW_403, { exitStatus: 1, modelId: "m" }),
            };
          },
        },
      });
      expect(result.license.error).toBe("opencode_provider_rejected");
      expect(result.summary).toBeNull();
    });

    it("7.5: nonzero exit + no envelope + no worker message is execution failure, not malformed", async () => {
      const base = baseInput();
      const result = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            return { text: "not-json-garbage", status: 1 };
          },
        },
      });
      expect(result.license.error).toBe("opencode_failed");
      expect(result.summary).toBeNull();
      const failureEvidence = result.payload.failureEvidence as Record<string, unknown>;
      expect(failureEvidence).toMatchObject({ errorClass: "opencode_failed", exitStatus: 1 });
    });

    it("7.6/7.7: exit-zero contract violations stay malformed_worker_output", async () => {
      const base = baseInput();
      const prose = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            return { text: "some prose {\"type\":\"complete\",\"summary\":\"x\"} trailing", status: 0 };
          },
        },
      });
      expect(prose.license.error).toBe("malformed_worker_output");
      const empty = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            return { text: "", status: 0 };
          },
        },
      });
      expect(empty.license.error).toBe("malformed_worker_output");
    });

    it("7.8: valid tool_request and complete results remain green", async () => {
      const base = baseInput();
      let calls = 0;
      const result = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport: {
          async complete() {
            calls += 1;
            if (calls === 1) {
              return {
                text: JSON.stringify({
                  type: "tool_request",
                  operation: "project.list_directory",
                  request: {},
                }),
              };
            }
            return { text: JSON.stringify({ type: "complete", summary: "done" }) };
          },
        },
      });
      expect(result.license.state).toBe("succeeded");
      expect(result.summary).toBe("done");
      expect(result.steps).toHaveLength(1);
      expect(result.payload.failureEvidence).toBeUndefined();
    });
  });

  describe("Confirmed direct-child termination contract (V3-1)", () => {
    it("terminateProcessWithEscalation: exit alone does not resolve; only close resolves", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as unknown as ChildProcess & {
        exitCode: number | null;
        kill: (signal?: any) => boolean;
      };
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((sig) => {
        signals.push(String(sig));
        return true;
      });

      let resolved = false;
      const terminationPromise = terminateProcessWithEscalation(mockChild, {
        termGraceMs: 50,
        killGraceMs: 50,
      }).then((res) => {
        resolved = true;
        return res;
      });

      // SIGTERM requested immediately
      expect(signals).toEqual(["SIGTERM"]);
      expect(resolved).toBe(false);

      // Emitting exit alone MUST NOT resolve
      mockChild.emit("exit", 0);
      expect(resolved).toBe(false);

      // Emitting close resolves with closed: true
      mockChild.emit("close", 0);
      const res = await terminationPromise;
      expect(resolved).toBe(true);
      expect(res.closed).toBe(true);
    });

    it("terminateProcessWithEscalation: kill() throwing does not count as success; unconfirmed close after kill grace returns closed: false", async () => {
      const mockChild = new EventEmitter() as unknown as ChildProcess & {
        exitCode: number | null;
        kill: (signal?: any) => boolean;
      };
      mockChild.exitCode = null;
      mockChild.kill = vi.fn(() => {
        throw new Error("ESRCH");
      });

      let resolved = false;
      const terminationPromise = terminateProcessWithEscalation(mockChild, {
        termGraceMs: 20,
        killGraceMs: 20,
      }).then((res) => {
        resolved = true;
        return res;
      });

      // Throwing on kill() did not resolve
      expect(resolved).toBe(false);

      // Wait past termGrace + killGrace without close
      const res = await terminationPromise;
      expect(resolved).toBe(true);
      expect(res.closed).toBe(false);
    });

    it("spawnOpenCodeTransport: exercises real transport timeout lifecycle (timeout -> SIGTERM -> exit does NOT reject -> close rejects opencode_timeout)", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((sig) => {
        signals.push(String(sig));
        return true;
      });

      const transport = spawnOpenCodeTransport({
        termGraceMs: 50,
        killGraceMs: 50,
        spawnChild: (() => mockChild) as any,
      });

      let rejectedError: string | null = null;
      let closedAtTimeOfRejection = false;
      let childIsClosed = false;

      const completePromise = transport.complete({
        modelId: "test-model",
        prompt: "hello",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 10,
        binaryPath: "opencode",
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
        closedAtTimeOfRejection = childIsClosed;
      });

      // 1. Timeout fires -> SIGTERM requested
      await new Promise((r) => setTimeout(r, 20));
      expect(signals).toContain("SIGTERM");
      expect(rejectedError).toBeNull();

      // 2. 'exit' occurs -> promise does NOT reject yet
      mockChild.emit("exit", 0);
      await new Promise((r) => setTimeout(r, 10));
      expect(rejectedError).toBeNull();

      // 3. 'close' occurs -> only then does complete() reject with opencode_timeout
      childIsClosed = true;
      mockChild.emit("close", 0);
      await completePromise;

      expect(rejectedError).toBe("opencode_timeout");
      expect(closedAtTimeOfRejection).toBe(true);
    });

    it("spawnOpenCodeTransport: TERM grace expires -> SIGKILL -> close rejects opencode_timeout", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((sig) => {
        signals.push(String(sig));
        return true;
      });

      const transport = spawnOpenCodeTransport({
        termGraceMs: 20,
        killGraceMs: 50,
        spawnChild: (() => mockChild) as any,
      });

      let rejectedError: string | null = null;
      const completePromise = transport.complete({
        modelId: "test-model",
        prompt: "hello",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 10,
        binaryPath: "opencode",
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
      });

      // Wait for timeout (10ms) + termGrace (20ms) -> escalates to SIGKILL.
      // Deterministically observe the recorded signals instead of sampling at a
      // fixed sleep: Node timers can run late under full-corpus contention.
      await vi.waitFor(() => {
        expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      });
      expect(rejectedError).toBeNull();

      // Close after SIGKILL -> rejects opencode_timeout
      mockChild.emit("close", null);
      await completePromise;
      expect(rejectedError).toBe("opencode_timeout");
    });

    it("spawnOpenCodeTransport: KILL grace expires without close -> rejects opencode_termination_unconfirmed", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((sig) => {
        signals.push(String(sig));
        return true;
      });

      const transport = spawnOpenCodeTransport({
        termGraceMs: 20,
        killGraceMs: 20,
        spawnChild: (() => mockChild) as any,
      });

      let rejectedError: string | null = null;
      const completePromise = transport.complete({
        modelId: "test-model",
        prompt: "hello",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 10,
        binaryPath: "opencode",
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
      });

      // Wait for timeout (10ms) + termGrace (20ms) + killGrace (20ms) + margin
      await completePromise;
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(rejectedError).toBe("opencode_termination_unconfirmed");
    });

    it("executeModeBWorker: opencode_termination_unconfirmed fails immediately and does NOT reroute to sibling model", async () => {
      const base = baseInput();
      let completeCalls = 0;
      const transport: OpenCodeTransport = {
        async complete() {
          completeCalls += 1;
          throw new Error("opencode_termination_unconfirmed");
        },
      };

      const result = await executeModeBWorker({
        ...base,
        kind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "look",
        transport,
      });

      // Strictly 1 attempt, NO sibling attempt
      expect(completeCalls).toBe(1);
      expect(result.license.error).toBe("opencode_termination_unconfirmed");
      expect(result.license.state).toBe("none");
    });

    it("spawnOpenCodeTransport: real process timeout does not leave active children", async () => {
      // Spawn a real node process that sleeps
      const transport = spawnOpenCodeTransport({
        termGraceMs: 50,
        killGraceMs: 50,
      });

      let rejectedError: string | null = null;
      await transport.complete({
        modelId: "test",
        prompt: "test",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 20,
        binaryPath: process.execPath, // Real node executable: will sleep until killed
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
      });

      expect(rejectedError).toBe("opencode_timeout");
    });
  });
});
