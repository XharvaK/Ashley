import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type {
  ExecuteCandidateVerificationV2Result,
  ExecuteProjectInspectionV2Result,
  ExecuteWorkspaceExperimentV2Result,
} from "../../sandbox/v2-execution.js";
import type { Observation, EffectProposal } from "../types.js";
import { createV021LiveOperationExecutors } from "./live-operations.js";

function projectObservation(): NonNullable<ExecuteProjectInspectionV2Result["observation"]> {
  return {
    projectId: "project-ashley",
    operation: "project.read_file",
    path: "README.md",
    verified: true,
    truncated: false,
    executedAtMs: 42,
    contentUtf8: "trusted internal evidence",
    bytes: 25,
    sha256: "a".repeat(64),
  };
}

function effectProposal(overrides: Partial<EffectProposal> = {}): EffectProposal {
  return {
    effectId: "effect-1",
    cycleId: "cycle-1",
    generation: 1,
    idempotencyKey: "idempotency-1",
    kind: "workspace.write_file",
    authorityEpoch: 1,
    request: {
      operation: "workspace.write_file",
      projectId: "project-ashley",
      workspaceId: "workspace-1",
      path: "src/new.ts",
      content: "export const value = 1;\n",
      mustNotExist: true,
    },
    ...overrides,
  };
}

describe("v0.2.1 live Sandbox V2 operation construction", () => {
  it("constructs a project observation through the approved V2 adapter", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const calls: unknown[] = [];
    const executeProjectInspectionV2 = vi.fn(async (input: unknown): Promise<ExecuteProjectInspectionV2Result> => {
      calls.push(input);
      return {
        license: { state: "succeeded", profile: "project_investigation" },
        observation: projectObservation(),
        dispatchAttempted: true,
      };
    });
    const executors = createV021LiveOperationExecutors({
      nuclear,
      adapters: { executeProjectInspectionV2 },
    });

    const request = {
      requestId: "observation-1",
      cycleId: "cycle-1",
      generation: 1,
      kind: "project.read_file",
      request: { projectId: "project-ashley", path: "README.md" },
      replaySafe: true as const,
    };
    const observation = await executors.executeObservation(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      request: { operation: "project.read_file", projectId: "project-ashley", path: "README.md" },
      projectInspectionPreparationDeadlineAtMs: expect.any(Number),
      childExecutionDeadlineAtMs: expect.any(Number),
      childTerminationDeadlineAtMs: expect.any(Number),
      settlementDeadlineAtMs: expect.any(Number),
    });
    expect(observation).toMatchObject<Partial<Observation>>({
      observationId: "v021:observation:observation-1",
      cycleId: "cycle-1",
      generation: 1,
      modality: "tool",
      replaySafe: true,
      provenance: "sandbox-v2:project-inspection",
      dataClassification: "never_public",
    });
    expect(observation.payload).toEqual(projectObservation());
    nuclear.close();
  });

  it("routes workspace effects through the approved V2 adapter and returns a receipt", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executeWorkspaceExperimentV2 = vi.fn(async (): Promise<ExecuteWorkspaceExperimentV2Result> => ({
      license: {
        state: "succeeded",
        profile: "project_experimentation",
        executionTruth: "effect_verified",
        workspaceClaimEffect: {
          verified: true,
          projectId: "project-ashley",
          workspaceId: "workspace-1",
          operation: "workspace.write_file",
          logicalRelativePath: "src/new.ts",
          sourceSnapshotId: "snapshot-1",
          completedAtMs: 42,
        },
      },
      observation: {
        kind: "workspace_experiment_observation",
        projectId: "project-ashley",
        workspaceId: "workspace-1",
        operation: "workspace.write_file",
        verified: true,
        executedAtMs: 42,
        contentUtf8: "must not be copied into the receipt claims",
      },
    }));
    const executors = createV021LiveOperationExecutors({
      nuclear,
      adapters: { executeWorkspaceExperimentV2 },
    });

    const receipt = await executors.executeEffect(effectProposal());

    expect(executeWorkspaceExperimentV2).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ operation: "workspace.write_file", projectId: "project-ashley" }),
      messageEntityUuid: "cycle-1",
    }));
    expect(receipt).toMatchObject({
      receiptId: "v021:effect:effect-1",
      effectId: "effect-1",
      idempotencyKey: "idempotency-1",
      outcome: "succeeded",
      dataClassification: "never_public",
      secretOmitted: true,
      claims: { state: "succeeded", executionTruth: "effect_verified" },
    });
    expect(JSON.stringify(receipt)).not.toContain("must not be copied");
    nuclear.close();
  });

  it("keeps unavailable observation and effect outcomes truthful", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executors = createV021LiveOperationExecutors({
      nuclear,
      adapters: {
        executeProjectInspectionV2: vi.fn(async (): Promise<ExecuteProjectInspectionV2Result> => ({
          license: { state: "none", profile: "project_investigation", error: "sandbox_unavailable" },
          observation: null,
          dispatchAttempted: false,
        })),
        executeWorkspaceExperimentV2: vi.fn(async (): Promise<ExecuteWorkspaceExperimentV2Result> => ({
          license: { state: "none", profile: "project_experimentation", error: "sandbox_unavailable" },
          observation: null,
        })),
      },
    });

    await expect(executors.executeObservation({
      requestId: "observation-1",
      cycleId: "cycle-1",
      generation: 1,
      kind: "project.read_file",
      request: { projectId: "project-ashley", path: "README.md" },
      replaySafe: true,
    })).rejects.toThrow("observation_unavailable");
    const receipt = await executors.executeEffect(effectProposal());
    expect(receipt).toMatchObject({ outcome: "outcome_unknown", claims: { state: "none", error: "sandbox_unavailable" } });
    nuclear.close();
  });

  it("truthfully produces all five-way receipt outcomes from license states", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const makeExecutors = (state: string, error?: string) => createV021LiveOperationExecutors({
      nuclear,
      adapters: {
        executeWorkspaceExperimentV2: vi.fn(async (): Promise<ExecuteWorkspaceExperimentV2Result> => ({
          license: { state: state as any, profile: "project_experimentation", ...(error ? { error } : {}) },
          observation: null,
        })),
      },
    });

    // succeeded -> succeeded
    expect((await makeExecutors("succeeded").executeEffect(effectProposal({ effectId: "e-succ" }))).outcome).toBe("succeeded");

    // failed -> failed
    expect((await makeExecutors("failed", "tool_error").executeEffect(effectProposal({ effectId: "e-fail" }))).outcome).toBe("failed");

    // running -> in_progress
    expect((await makeExecutors("running").executeEffect(effectProposal({ effectId: "e-run" }))).outcome).toBe("in_progress");

    // outcome_unknown -> outcome_unknown
    expect((await makeExecutors("outcome_unknown").executeEffect(effectProposal({ effectId: "e-unk" }))).outcome).toBe("outcome_unknown");

    // proposed / admitted -> not_attempted
    expect((await makeExecutors("proposed").executeEffect(effectProposal({ effectId: "e-prop" }))).outcome).toBe("not_attempted");
    expect((await makeExecutors("admitted").executeEffect(effectProposal({ effectId: "e-adm" }))).outcome).toBe("not_attempted");

    // none with invalid_request -> not_attempted
    expect((await makeExecutors("none", "invalid_request").executeEffect(effectProposal({ effectId: "e-inv" }))).outcome).toBe("not_attempted");

    nuclear.close();
  });

  it("routes candidate verification by the canonical workspace.verify operation", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executeCandidateVerificationV2 = vi.fn(async (input: unknown): Promise<ExecuteCandidateVerificationV2Result> => {
      expect(input).toMatchObject({ request: { projectId: "project-ashley", workspaceId: "workspace-1", recipeId: "recipe-1" } });
      return { license: { state: "failed", profile: "candidate_verification", error: "verification_failed" } };
    });
    const executors = createV021LiveOperationExecutors({ nuclear, adapters: { executeCandidateVerificationV2 } });

    const receipt = await executors.executeEffect(effectProposal({
      effectId: "verify-effect",
      idempotencyKey: "verify-idempotency",
      kind: "workspace.verify",
      request: {
        operation: "workspace.verify",
        projectId: "project-ashley",
        workspaceId: "workspace-1",
        recipeId: "recipe-1",
      },
    }));

    expect(receipt).toMatchObject({ outcome: "failed", claims: { error: "verification_failed" } });
    expect(executeCandidateVerificationV2).toHaveBeenCalledTimes(1);
    nuclear.close();
  });
});
