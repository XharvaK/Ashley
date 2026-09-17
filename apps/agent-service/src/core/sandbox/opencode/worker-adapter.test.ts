import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { OPENCODE_PINNED_VERSION } from "./catalog.js";
import { createTempIsolationRoot } from "./isolation.js";
import { createQuotaRouter, resetOpenCodeProcessQuotaMemory } from "./quota-router.js";
import { emptyQuotaState, recordClassExhausted } from "./quota-state.js";
import { decodeOpenCodeRunStdout, executeModeBWorker, type OpenCodeTransport } from "./worker-adapter.js";

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
      executeProjectInspectionV2: async () => ({
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
    deadlineAtMs: Date.now() + 30_000,
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
});
