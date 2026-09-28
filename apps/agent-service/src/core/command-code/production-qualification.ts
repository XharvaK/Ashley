import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  executeProjectInspectionV2,
  type ExecuteProjectInspectionV2Result,
  type ExecuteWorkspaceExperimentV2Result,
} from "../sandbox/v2-execution.js";
import {
  executeCommandCodeWorker,
  COMMAND_CODE_WORKER_EFFORT,
  type CommandCodeWorkerInput,
} from "../sandbox/worker/command-code-worker.js";
import { MODE_B_INVESTIGATE } from "../sandbox/worker/contracts.js";
import {
  canOfferWorkerBackedProjectInspection,
  type V2ProjectReadRegistry,
} from "../sandbox/project-registry.js";
import type { CognitionMode } from "../types.js";
import type { CommandCodeCandidate, CommandCodeCandidateQualification } from "./lifecycle.js";

export type CommandCodeProductionQualificationInput = Readonly<{
  candidate: CommandCodeCandidate;
  apiKey: string;
  bubblewrapPath: string;
  minimumVersion: string;
  registry: V2ProjectReadRegistry;
  nuclear: DatabaseSync;
  sidecar: DatabaseSync;
  ownerId: string;
  masterMode: CognitionMode;
  lifecycleEnabled: boolean;
  substrateAvailable: boolean;
  projectId: string;
}>;

/**
 * Runs the smallest real worker qualification: the candidate CLI must reach
 * Muse through the API, request one Host-mediated read-only project tool, and
 * complete through the actual Sandbox V2 executor. No source mutation,
 * candidate workspace, effect, or fallback path is available to this probe.
 */
export async function qualifyCommandCodeCandidate(
  input: CommandCodeProductionQualificationInput,
): Promise<CommandCodeCandidateQualification> {
  if (!input.apiKey.trim()) return { ok: false, reason: "command_code_credentials_missing" };
  const startedAt = Date.now();
  const deadlineAtMs = startedAt + 120_000;
  const qualificationId = `command-code-qualification:${randomUUID()}`;
  const gateOk = canOfferWorkerBackedProjectInspection({
    registry: input.registry,
    masterMode: input.masterMode,
    lifecycleEnabled: input.lifecycleEnabled,
    substrateAvailable: input.substrateAvailable,
  });
  if (!gateOk) return { ok: false, reason: "worker_project_gate_denied" };

  const workerInput: CommandCodeWorkerInput = {
    kind: MODE_B_INVESTIGATE,
    request: {
      projectId: input.projectId,
      focus: "Use exactly one read-only project.list_directory tool on the authorized project root, then return a short bounded summary.",
      maxSteps: 1,
    },
    purpose: "Host startup compatibility qualification for the Command Code worker runtime",
    apiKey: input.apiKey,
    binaryPath: input.candidate.binaryPath,
    nodeExecutable: input.candidate.nodePath,
    bubblewrapPath: input.bubblewrapPath,
    minimumVersion: input.minimumVersion,
    // The candidate is being qualified before activation. The state file is
    // written only after this complete probe succeeds.
    qualificationStatePath: undefined,
    dispatchers: {
      executeProjectInspectionV2: async (
        inspectionInput,
      ): Promise<ExecuteProjectInspectionV2Result> => executeProjectInspectionV2({
        ...inspectionInput,
        db: input.nuclear,
        registry: input.registry,
        masterMode: input.masterMode,
        skipCapabilityGate: true,
        envOverrides: {
          ...inspectionInput.envOverrides,
          sandboxEngineeringLifecycleEnabled: input.lifecycleEnabled,
        },
      }),
      executeWorkspaceExperimentV2: async (): Promise<ExecuteWorkspaceExperimentV2Result> => ({
        license: { state: "none", profile: "workspace_experiment", error: "qualification_read_only" },
        observation: null,
      }),
    },
    inspectionBase: {
      projectInspectionPreparationDeadlineAtMs: startedAt + 10_000,
      childExecutionDeadlineAtMs: startedAt + 45_000,
      childTerminationDeadlineAtMs: startedAt + 70_000,
      settlementDeadlineAtMs: deadlineAtMs,
      registry: input.registry,
      db: input.nuclear,
      masterMode: input.masterMode,
      messageEntityUuid: qualificationId,
    },
    workspaceBase: {},
    operationId: qualificationId,
    conversationId: qualificationId,
    cycleId: qualificationId,
    generation: 0,
    nowMs: () => Date.now(),
    deadlineAtMs,
    workerEnabled: true,
    gateOk: true,
  };

  const result = await executeCommandCodeWorker(workerInput);
  if (result.license.state !== "succeeded") {
    return { ok: false, reason: result.license.error ?? "worker_qualification_failed" };
  }
  const invocation = result.commandCodeInvocations[0];
  if (
    !invocation
    || invocation.backend !== "command_code_cli"
    || invocation.cliVersion !== input.candidate.version
    || invocation.effort !== COMMAND_CODE_WORKER_EFFORT
    || invocation.outcome !== "completed"
    || result.steps.length === 0
  ) {
    return { ok: false, reason: "worker_qualification_missing_execution_evidence" };
  }
  return { ok: true };
}
