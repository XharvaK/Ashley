import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type {
  ExecuteCandidateVerificationV2Result,
  ExecuteInquiryExperimentV2Result,
  ExecuteProjectInspectionV2Result,
  ExecuteWorkspaceExperimentV2Result,
} from "../../sandbox/v2-execution.js";
import type { ExecutePatchExportV2Result } from "../../sandbox/patch-export-execution.js";
import type { Observation, EffectProposal } from "../types.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { readPublicPresenceState } from "../public-presence.js";
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

  it("routes objective.operate to the inquiry-only coordinator", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executeInquiryExperimentV2 = vi.fn(async (input: unknown): Promise<ExecuteInquiryExperimentV2Result> => {
      expect(input).toMatchObject({
        request: {
          operation: "objective.operate",
          projectId: "project-ashley",
          experimentId: "inquiry-1",
        },
        taskId: "inquiry-effect",
        messageEntityUuid: "cycle-1",
      });
      return {
        state: "succeeded",
        experimentId: "inquiry-1",
        workspaceId: "workspace-1",
        terminalState: "active",
        terminalized: false,
        stepResults: [],
      };
    });
    const executors = createV021LiveOperationExecutors({
      nuclear,
      adapters: { executeInquiryExperimentV2 },
    });

    const receipt = await executors.executeEffect(effectProposal({
      effectId: "inquiry-effect",
      kind: "objective.operate",
      request: {
        operation: "objective.operate",
        projectId: "project-ashley",
        experimentId: "inquiry-1",
        objective: "answer one bounded question",
        steps: [{ kind: "candidate_verification", request: { operation: "workspace.verify", projectId: "project-ashley" } }],
        budget: { maxSteps: 1, deadlineAtMs: Date.now() + 60_000 },
      },
    }));

    expect(receipt).toMatchObject({
      outcome: "succeeded",
      claims: { state: "succeeded", profile: "inquiry_experiment", executionTruth: "effect_verified" },
    });
    expect(executeInquiryExperimentV2).toHaveBeenCalledTimes(1);
    nuclear.close();
  });

  it("preserves per-step unknown truth and verified history in an inquiry receipt", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executeInquiryExperimentV2 = vi.fn(async (): Promise<ExecuteInquiryExperimentV2Result> => ({
      state: "outcome_unknown",
      experimentId: "inquiry-partial",
      workspaceId: "workspace-1",
      terminalState: "active",
      terminalized: false,
      stepResults: [
        {
          index: 0,
          kind: "candidate_workspace_experiment",
          operation: "workspace.write_file",
          license: {
            state: "succeeded",
            profile: "workspace_experiment",
            executionTruth: "effect_verified",
            workspaceClaimEffect: {
              verified: true,
              projectId: "project-ashley",
              workspaceId: "workspace-1",
              operation: "workspace.write_file",
              logicalRelativePath: "src/known.ts",
              sourceSnapshotId: "snapshot-1",
              completedAtMs: 2,
              beforeSha256: "a".repeat(64),
              afterSha256: "b".repeat(64),
            },
          },
          observation: null,
        },
        {
          index: 1,
          kind: "candidate_workspace_experiment",
          operation: "workspace.replace_file",
          license: {
            state: "outcome_unknown",
            profile: "workspace_experiment",
            executionTruth: "effect_unknown",
          },
          observation: null,
        },
      ],
    }));
    const executors = createV021LiveOperationExecutors({ nuclear, adapters: { executeInquiryExperimentV2 } });

    const receipt = await executors.executeEffect(effectProposal({
      effectId: "inquiry-partial-effect",
      kind: "objective.operate",
      request: {
        operation: "objective.operate",
        projectId: "project-ashley",
        experimentId: "inquiry-partial",
        objective: "inspect two bounded workspace paths",
        steps: [
          { kind: "candidate_workspace_experiment", request: { operation: "workspace.write_file", path: "src/known.ts", content: "known" } },
          { kind: "candidate_workspace_experiment", request: { operation: "workspace.replace_file", path: "src/unknown.ts", content: "unknown", expectedSha256: "c".repeat(64) } },
        ],
        budget: { maxSteps: 2, deadlineAtMs: Date.now() + 60_000 },
      },
    }));

    expect(receipt).toMatchObject({
      outcome: "outcome_unknown",
      claims: {
        executionTruth: "effect_partial",
        steps: [
          { operation: "workspace.write_file", executionTruth: "effect_verified" },
          { operation: "workspace.replace_file", executionTruth: "effect_unknown" },
        ],
        knownHashes: [{ step: 1, beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64) }],
        unknownRemainder: [{ step: 2, operation: "workspace.replace_file", executionTruth: "effect_unknown" }],
      },
    });
    nuclear.close();
  });

  it("keeps Mode-B receipt facts while omitting observations and file bodies", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-modeb-receipt",
      conversationId: "thread-modeb-receipt",
      triggerKind: "owner_message",
      triggerRef: "owner-modeb-receipt",
      occupantId: "doc",
      authorityEpoch: 9,
      nowMs: 1,
    });
    sidecar.prepare(
      "INSERT INTO thought_attempt_counters (cycle_id, generation, effect_rounds) VALUES (?, ?, ?)",
    ).run(cycle.cycleId, cycle.generation, 2);
    const fieldErrors = [{
      fieldPath: "$.expectedSha256",
      expectedSchemaId: "ashley.workspace_worker_request.v1",
      preconditionCode: "hash_mismatch",
      executionStarted: false,
      afterSha256: "d".repeat(64),
    }];
    const executeModeBWorker = vi.fn(async () => ({
      license: {
        state: "succeeded",
        profile: "command_code_mode_b",
        executionTruth: "effect_unknown",
        terminationClass: "SUCCESS",
        fieldErrors,
      },
      selectedModelId: "meta/muse-spark-1.3-contributor",
      quotaClass: null,
      commandCodeInvocations: [],
      steps: [],
      summary: null,
      payload: {
        steps: [{
          operation: "workspace.replace_file",
          state: "none",
          error: "invalid_request",
          executionTruth: "effect_unknown",
          fieldErrors,
          workspaceClaimEffect: { beforeSha256: "c".repeat(64), afterSha256: null },
          verificationClaimEffect: null,
          observation: { contentUtf8: "private file body must not enter the receipt" },
        }],
      },
    } as any));
    const executors = createV021LiveOperationExecutors({
      nuclear,
      sidecar,
      adapters: { executeModeBWorker },
    });

    const receipt = await executors.executeEffect(effectProposal({
      effectId: "modeb-continuation-effect",
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      authorityEpoch: 9,
      kind: "candidate.develop",
      request: {
        projectId: "project-ashley",
        workspaceId: "workspace-1",
        delegatedPurpose: "make one bounded edit",
      },
    }));

    expect(receipt).toMatchObject({
      outcome: "succeeded",
      claims: {
        terminationClass: "SUCCESS",
        executionTruth: "effect_unknown",
        delegatedPurpose: "make one bounded edit",
        fieldErrors,
        knownHashes: [{ step: 1, beforeSha256: "c".repeat(64), afterSha256: "d".repeat(64) }],
        unknownRemainder: [{ step: 1, operation: "workspace.replace_file", executionTruth: "effect_unknown" }],
        verificationState: "not_run",
        remainingAuthority: { workerDelegation: "terminated", proposalAuthorityEpoch: 9 },
        remainingEffectRounds: 2,
        summary: null,
        steps: [{ operation: "workspace.replace_file", executionTruth: "effect_unknown", fieldErrors }],
      },
    });
    expect(JSON.stringify(receipt)).not.toContain("private file body must not enter the receipt");
    sidecar.close();
    nuclear.close();
  });

  it("routes Thought-adjudicated patch export without adding a notification effect", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executePatchExportV2 = vi.fn(async (input: unknown): Promise<ExecutePatchExportV2Result> => {
      expect(input).toMatchObject({
        request: {
          operation: "patch_export",
          projectId: "project-ashley",
          changesetId: "cs_candidate-1",
          adjudication: "accept",
        },
        ownerId: "owner-1",
        messageEntityUuid: "cycle-1",
      });
      return {
        license: {
          state: "succeeded",
          profile: "patch_export",
          executionTruth: "effect_verified",
          patchExportClaimEffect: {
            verified: true,
            projectId: "project-ashley",
            changesetId: "cs_candidate-1",
            destinationRelativeName: "cs_candidate-1.patch",
            patchSha256: "a".repeat(64),
            witnessedSha256: "a".repeat(64),
            bytesWritten: 16,
            applied: false,
            liveUnwritten: true,
            gitUnwritten: true,
            protocolState: "admitted",
            witnessState: "digest_readback",
            completedAtMs: 42,
          },
        },
      };
    });
    const executors = createV021LiveOperationExecutors({
      nuclear,
      ownerId: "owner-1",
      adapters: { executePatchExportV2 },
    });

    const receipt = await executors.executeEffect(effectProposal({
      effectId: "patch-export-effect",
      idempotencyKey: "patch-export-idempotency",
      kind: "patch_export",
      request: {
        operation: "patch_export",
        projectId: "project-ashley",
        changesetId: "cs_candidate-1",
        adjudication: "accept",
      },
    }));

    expect(receipt).toMatchObject({
      outcome: "succeeded",
      claims: {
        state: "succeeded",
        profile: "patch_export",
        executionTruth: "effect_verified",
        patchExportClaimEffect: { applied: false, liveUnwritten: true, gitUnwritten: true },
      },
    });
    expect(JSON.stringify(receipt)).not.toContain("notification");
    expect(executePatchExportV2).toHaveBeenCalledTimes(1);
    nuclear.close();
  });

  it("records a pre-M4 patch-export refusal as not attempted", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executePatchExportV2 = vi.fn(async (): Promise<ExecutePatchExportV2Result> => ({
      license: {
        state: "none",
        profile: "patch_export",
        error: "verification_receipt_required",
        executionTruth: "no_effect_proven",
      },
    }));
    const executors = createV021LiveOperationExecutors({
      nuclear,
      ownerId: "owner-1",
      adapters: { executePatchExportV2 },
    });

    const receipt = await executors.executeEffect(effectProposal({
      effectId: "patch-export-not-ready",
      idempotencyKey: "patch-export-not-ready-idempotency",
      kind: "patch_export",
      request: {
        operation: "patch_export",
        projectId: "project-ashley",
        changesetId: "cs_candidate-1",
        adjudication: "accept",
      },
    }));

    expect(receipt).toMatchObject({
      outcome: "not_attempted",
      claims: { state: "none", error: "verification_receipt_required" },
    });
    expect(executePatchExportV2).toHaveBeenCalledTimes(1);
    nuclear.close();
  });

  it("maps the Thought project.inspect objective to one bounded M2 read surface", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const calls: unknown[] = [];
    const executeProjectInspectionV2 = vi.fn(async (input: any): Promise<ExecuteProjectInspectionV2Result> => {
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

    await executors.executeObservation({
      requestId: "inspection-objective-1",
      cycleId: "cycle-inspection-objective",
      generation: 1,
      kind: "project.inspect",
      request: {
        projectId: "project-ashley",
        operation: "project.read_file",
        path: "README.md",
      },
      replaySafe: true,
    });

    expect(calls[0]).toMatchObject({
      request: {
        operation: "project.read_file",
        projectId: "project-ashley",
        path: "README.md",
      },
    });
    nuclear.close();
  });

  it("persists a public presence effect only from the authenticated idle lineage", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-public-presence",
      conversationId: "conversation-public-presence",
      generation: 1,
      triggerKind: "idle_opportunity",
      triggerRef: "event-public-presence",
      occupantId: "owner",
      nowMs: 7_000_000,
    });
    sidecar.prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?").run(
      JSON.stringify({ ownerId: "owner", channel: "discord" }),
      "event-public-presence",
    );
    sidecar.prepare("UPDATE wakes SET source_kind = 'idle' WHERE wake_id = ?").run(cycle.wakeId);
    const executors = createV021LiveOperationExecutors({
      nuclear,
      sidecar,
      ownerId: "owner",
      nowMs: () => 7_000_000,
    });

    const receipt = await executors.executeEffect({
      ...effectProposal({
        effectId: "effect-public-presence",
        idempotencyKey: "idempotency-public-presence",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        kind: "discord.public_presence",
        request: { action: "set", text: "Exact public presence." },
      }),
      originEventId: "event-public-presence",
    });

    expect(receipt).toMatchObject({
      outcome: "succeeded",
      claims: {
        state: "persisted",
        decision: "set",
        audience: "FULLY_PUBLIC",
        text: "Exact public presence.",
        projectionState: "pending",
      },
    });
    expect(readPublicPresenceState(sidecar)).toMatchObject({
      action: "set",
      text: "Exact public presence.",
      sourceEffectId: "effect-public-presence",
    });
    nuclear.close();
    sidecar.close();
  });

  it("routes project.investigate through the Mode-B worker without claiming direct L1", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const workerResult = {
      license: { state: "succeeded" as const, profile: "command_code_mode_b" },
      selectedModelId: "meta/muse-spark-1.3-contributor",
      quotaClass: null,
      commandCodeInvocations: [],
      steps: [{ operation: "project.read_file", license: { state: "succeeded" as const, profile: "project_investigation" } }],
      summary: "worker prose is not proof",
      payload: { steps: 1 },
    };
    const executeModeBWorker = vi.fn(async () => workerResult);
    const onModeBWorkerResult = vi.fn();
    const executors = createV021LiveOperationExecutors({
      nuclear,
      adapters: { executeModeBWorker },
      onModeBWorkerResult,
    });
    const observation = await executors.executeObservation({
      requestId: "investigate-1",
      cycleId: "cycle-1",
      generation: 1,
      kind: "project.investigate",
      request: { projectId: "project-ashley", focus: "what inspection can do" },
      replaySafe: true,
    });
    expect(executeModeBWorker).toHaveBeenCalledTimes(1);
    expect(observation).toMatchObject({
      observationId: "v021:observation:investigate-1",
      provenance: "worker:project.investigate",
      payload: { steps: 1 },
    });
    const observedCalls = onModeBWorkerResult.mock.calls as unknown as Array<[
      Record<string, unknown>,
      Record<string, unknown>,
    ]>;
    const [binding, workerEvidence] = observedCalls[0]!;
    expect(binding).toMatchObject({
      kind: "project.investigate",
      operationId: "investigate-1",
      cycleId: "cycle-1",
      generation: 1,
    });
    expect(binding).not.toHaveProperty("apiKey");
    expect(Object.isFrozen(binding)).toBe(true);
    expect(workerEvidence).toMatchObject({
      license: { state: "succeeded" },
      selectedModelId: "meta/muse-spark-1.3-contributor",
      commandCodeInvocations: [],
    });
    expect(workerEvidence).not.toHaveProperty("payload");
    expect(Object.isFrozen(workerEvidence)).toBe(true);
    expect(Object.isFrozen(workerEvidence.commandCodeInvocations)).toBe(true);
    try {
      (workerEvidence.commandCodeInvocations as unknown[]).push({ backend: "other" });
    } catch {
      // A frozen observer snapshot must not affect the worker return.
    }
    expect(workerResult.commandCodeInvocations).toEqual([]);
    expect(observation).not.toHaveProperty("commandCodeInvocations");
    nuclear.close();
  });

  it("runs Mode-B candidate.develop through the worker adapter and records Host model evidence", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-command-code-binding",
      conversationId: "thread-command-code-binding",
      triggerKind: "owner_message",
      triggerRef: "owner-command-code-binding",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const workerInputs: unknown[] = [];
    const executeModeBWorker = vi.fn(async (input: unknown) => {
      workerInputs.push(input);
      return ({
      license: { state: "succeeded" as const, profile: "command_code_mode_b", executionTruth: "effect_verified" as const },
      selectedModelId: "meta/muse-spark-1.3-contributor",
      quotaClass: null,
      commandCodeInvocations: [],
      steps: [],
      summary: "worker prose is not proof",
      payload: { steps: [] },
      });
    });
    const executors = createV021LiveOperationExecutors({
      nuclear,
      sidecar,
      adapters: { executeModeBWorker },
    });
    const receipt = await executors.executeEffect(effectProposal({
      kind: "candidate.develop",
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      request: { projectId: "project-ashley", workspaceId: "ws-1" },
    }));
    expect(executeModeBWorker).toHaveBeenCalledTimes(1);
    expect(receipt.outcome).toBe("succeeded");
    expect(receipt.claims.selectedModelId).toBe("meta/muse-spark-1.3-contributor");
    expect(receipt.claims.summary).toBe("worker prose is not proof");
    expect(workerInputs[0]).toMatchObject({
      operationId: "effect-1",
      conversationId: cycle.conversationId,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      wakeId: cycle.wakeId,
    });
    nuclear.close();
    sidecar.close();
  });

  it("maps pre-tool worker exhaustion to not_attempted", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const executeModeBWorker = vi.fn(async () => ({
      license: {
        state: "none" as const,
        profile: "command_code_mode_b",
        error: "worker_capacity_exhausted",
        executionTruth: "no_effect_proven" as const,
      },
      selectedModelId: null,
      quotaClass: null,
      commandCodeInvocations: [],
      steps: [],
      summary: null,
      payload: { error: "worker_capacity_exhausted" },
    }));
    const executors = createV021LiveOperationExecutors({
      nuclear,
      adapters: { executeModeBWorker },
    });
    const receipt = await executors.executeEffect(effectProposal({
      kind: "candidate.develop",
      request: { projectId: "project-ashley", workspaceId: "ws-1" },
    }));
    expect(receipt.outcome).toBe("not_attempted");
    nuclear.close();
  });
});
