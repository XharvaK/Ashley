import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { OperationalClaimLicense } from "../engineering-types.js";
import type {
  ExecuteProjectInspectionV2Input,
  ExecuteWorkspaceExperimentV2Input,
} from "../v2-execution.js";
import {
  MODE_B_DEVELOP,
  MODE_B_INVESTIGATE,
  type QuotaClass,
  type WorkerTaskClass,
} from "./catalog.js";
import {
  buildWorkerEnv,
  destroyAdmission,
  harvestDurableAuth,
  materializeAdmissionHome,
  type IsolatedOpenCodeLayout,
} from "./isolation.js";
import { validateModeBRequest, type ModeBRequest } from "./mode-b-request.js";
import {
  classifyOpenCodeFailure,
  recordClassAvailable,
  recordClassExhausted,
  type QuotaStateFile,
} from "./quota-state.js";
import {
  routeWorkerTask,
  setModelHealth,
  type QuotaRouter,
  type RouteOk,
} from "./quota-router.js";
import {
  executeWorkerTool,
  type ToolBridgeDispatchers,
  type WorkerToolCall,
  type WorkerToolProfile,
} from "./tool-bridge.js";

export type OpenCodeTurn = {
  text: string;
  status?: number | null;
};

export type OpenCodeTransport = {
  complete(input: {
    modelId: string;
    prompt: string;
    env: Record<string, string>;
    cwd: string;
    deadlineAtMs: number;
    binaryPath: string;
  }): Promise<OpenCodeTurn>;
};

export type ModeBWorkerStep = {
  operation: string;
  license: OperationalClaimLicense;
  observation?: unknown;
};

export type ModeBWorkerResult = {
  license: OperationalClaimLicense;
  selectedModelId: string | null;
  quotaClass: QuotaClass | null;
  steps: ModeBWorkerStep[];
  summary: string | null;
  payload: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = candidate.lastIndexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function parseWorkerMessage(text: string):
  | { type: "tool_request"; call: WorkerToolCall }
  | { type: "complete"; summary: string }
  | { type: "malformed" } {
  const parsed = extractJsonObject(text);
  if (!parsed) return { type: "malformed" };
  if (parsed.type === "complete") {
    return { type: "complete", summary: typeof parsed.summary === "string" ? parsed.summary : "" };
  }
  if (parsed.type === "tool_request") {
    if (typeof parsed.operation !== "string" || !isRecord(parsed.request)) return { type: "malformed" };
    return { type: "tool_request", call: { operation: parsed.operation, request: parsed.request } };
  }
  return { type: "malformed" };
}

function hostProtocolPrompt(input: {
  request: ModeBRequest;
  profile: WorkerToolProfile;
  purpose: string;
  history: string;
}): string {
  const tools = input.profile === "read"
    ? "project.read_file, project.list_directory, project.search_text"
    : "workspace.read_file, workspace.list_directory, workspace.search_text, workspace.write_file, workspace.replace_file, workspace.edit_text, workspace.delete_file, workspace.create_directory";
  return [
    "You are a bounded mechanical worker. You have no authority of your own.",
    "Reply with exactly one JSON object and no other prose.",
    `Allowed tool operations: ${tools}.`,
    "To request a tool: {\"type\":\"tool_request\",\"operation\":\"<operation>\",\"request\":{...}}",
    "To finish: {\"type\":\"complete\",\"summary\":\"<short mechanical summary>\"}.",
    "Do not claim that a file was read or written unless a tool result in this prompt says so.",
    `projectId: ${input.request.projectId}`,
    input.request.focus ? `focus: ${input.request.focus}` : "",
    `purpose: ${input.purpose}`,
    input.history ? `prior_results:\n${input.history}` : "",
  ].filter(Boolean).join("\n");
}

export function spawnOpenCodeTransport(): OpenCodeTransport {
  return {
    complete(input) {
      return new Promise((resolve, reject) => {
        const child = spawn(
          input.binaryPath,
          ["run", "--pure", "--format", "json", "--model", input.modelId, input.prompt],
          {
            cwd: input.cwd,
            env: input.env,
            windowsHide: true,
          },
        );
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("opencode_timeout"));
        }, Math.max(1, input.deadlineAtMs - Date.now()));
        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (status) => {
          clearTimeout(timer);
          resolve({ text: stdout || stderr, status });
        });
      });
    },
  };
}

export function resolveOpenCodeBinary(path: string): string | null {
  if (path && existsSync(path)) return path;
  return null;
}

export type ExecuteModeBWorkerInput = {
  kind: typeof MODE_B_INVESTIGATE | typeof MODE_B_DEVELOP;
  request: unknown;
  purpose: string;
  isolationRoot: string;
  binaryPath: string;
  pinnedVersion: string;
  quotaPath: string;
  router: QuotaRouter;
  persistQuota: (state: QuotaStateFile) => void;
  dispatchers: ToolBridgeDispatchers;
  inspectionBase: Omit<ExecuteProjectInspectionV2Input, "request">;
  workspaceBase: Omit<ExecuteWorkspaceExperimentV2Input, "request">;
  workspaceId?: string;
  pathEnv: string;
  nowMs: () => number;
  deadlineAtMs: number;
  transport?: OpenCodeTransport;
  workerEnabled: boolean;
};

function taskClassFor(kind: string): WorkerTaskClass {
  return kind === MODE_B_INVESTIGATE ? "delegated_read" : "iterative_engineering";
}

function profileFor(kind: string): WorkerToolProfile {
  return kind === MODE_B_INVESTIGATE ? "read" : "candidate";
}

export async function executeModeBWorker(input: ExecuteModeBWorkerInput): Promise<ModeBWorkerResult> {
  const empty = (error: string, extra: Partial<OperationalClaimLicense> = {}): ModeBWorkerResult => ({
    license: { state: "none", profile: "opencode_mode_b", error, executionTruth: "no_effect_proven", ...extra },
    selectedModelId: null,
    quotaClass: null,
    steps: [],
    summary: null,
    payload: { error },
  });

  if (!input.workerEnabled) return empty("worker_disabled");
  if (input.pinnedVersion !== input.router.catalog.pinnedOpenCodeVersion) {
    return empty("opencode_pin_mismatch");
  }
  const parsed = validateModeBRequest({ kind: input.kind, request: input.request });
  if (!parsed.ok) return empty(parsed.error);
  const workspaceId = parsed.value.kind === MODE_B_DEVELOP
    ? parsed.value.workspaceId ?? input.workspaceId
    : undefined;
  if (parsed.value.kind === MODE_B_DEVELOP && !workspaceId) return empty("missing_workspace");

  const task = taskClassFor(input.kind);
  let router = input.router;
  const routed = routeWorkerTask(router, task);
  if (!routed.ok) {
    return empty(routed.reason);
  }

  if (routed.bootstrap) {
    router.inFlightFirstAttempt[routed.quotaClass] = true;
  }

  const admissionId = randomUUID();
  const layout: IsolatedOpenCodeLayout = materializeAdmissionHome({
    root: input.isolationRoot,
    admissionId,
  });
  const env = buildWorkerEnv({ layout, path: input.pathEnv });
  const transport = input.transport ?? spawnOpenCodeTransport();
  const steps: ModeBWorkerStep[] = [];
  let summary: string | null = null;
  let quotaState = router.state;
  let selected: RouteOk = routed;
  let terminalError: string | null = null;
  let history = "";

  try {
    for (let step = 0; step < parsed.value.maxSteps; step += 1) {
      if (input.nowMs() >= input.deadlineAtMs) {
        terminalError = "deadline_exhausted";
        break;
      }
      let turn: OpenCodeTurn;
      try {
        turn = await transport.complete({
          modelId: selected.modelId,
          prompt: hostProtocolPrompt({
            request: parsed.value,
            profile: profileFor(input.kind),
            purpose: input.purpose,
            history,
          }),
          env,
          cwd: layout.workDir,
          deadlineAtMs: input.deadlineAtMs,
          binaryPath: input.binaryPath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "opencode_failed";
        if (message === "opencode_timeout") {
          router = setModelHealth(router, selected.modelId, "temporarily_unavailable");
          terminalError = "model_temporarily_unavailable";
        } else {
          terminalError = "opencode_failed";
        }
        break;
      }
      const evidence = classifyOpenCodeFailure({ status: turn.status, text: turn.text });
      if (evidence === "quota_exhausted") {
        quotaState = recordClassExhausted(quotaState, selected.quotaClass, { nowMs: input.nowMs() });
        terminalError = "worker_capacity_exhausted";
        break;
      }
      quotaState = recordClassAvailable(quotaState, selected.quotaClass);
      const message = parseWorkerMessage(turn.text);
      if (message.type === "malformed") {
        terminalError = "malformed_worker_output";
        break;
      }
      if (message.type === "complete") {
        summary = message.summary;
        break;
      }
      const tool = await executeWorkerTool({
        profile: profileFor(input.kind),
        projectId: parsed.value.projectId,
        workspaceId,
        call: message.call,
        dispatchers: input.dispatchers,
        inspectionBase: input.inspectionBase,
        workspaceBase: input.workspaceBase,
      });
      if (!tool.ok) {
        steps.push({
          operation: message.call.operation,
          license: { state: "none", profile: "opencode_tool_bridge", error: tool.error, executionTruth: "no_effect_proven" },
        });
        history += `\nstep ${step + 1} ${message.call.operation} error ${tool.error}`;
        continue;
      }
      if (tool.inspection) {
        steps.push({
          operation: message.call.operation,
          license: tool.inspection.license,
          observation: tool.inspection.observation,
        });
        history += `\nstep ${step + 1} ${message.call.operation} state ${tool.inspection.license.state}`;
      } else if (tool.workspace) {
        steps.push({
          operation: message.call.operation,
          license: tool.workspace.license,
          observation: tool.workspace.observation,
        });
        history += `\nstep ${step + 1} ${message.call.operation} state ${tool.workspace.license.state}`;
      }
    }
  } finally {
    try {
      harvestDurableAuth(layout);
    } finally {
      destroyAdmission(layout);
    }
    input.persistQuota(quotaState);
    if (selected.bootstrap) delete router.inFlightFirstAttempt[selected.quotaClass];
  }

  const childFailed = steps.some((step) => step.license.state === "failed");
  const anyChild = steps.length > 0;
  const lastWorkspace = [...steps].reverse().find((step) => step.license.workspaceClaimEffect);
  const lastInspect = [...steps].reverse().find((step) => step.observation);
  let state: OperationalClaimLicense["state"];
  if (terminalError === "worker_capacity_exhausted" && anyChild) state = "failed";
  else if (terminalError === "worker_capacity_exhausted") state = "failed";
  else if (terminalError && anyChild) state = "failed";
  else if (terminalError) state = "none";
  else if (childFailed) state = "failed";
  else state = "succeeded";

  const license: OperationalClaimLicense = {
    state,
    profile: "opencode_mode_b",
    ...(terminalError ? { error: terminalError } : {}),
    executionTruth: anyChild
      ? (state === "succeeded" ? "effect_verified" : "effect_indeterminate")
      : "no_effect_proven",
    ...(lastWorkspace?.license.workspaceClaimEffect
      ? { workspaceClaimEffect: lastWorkspace.license.workspaceClaimEffect }
      : {}),
  };

  return {
    license,
    selectedModelId: selected.modelId,
    quotaClass: selected.quotaClass,
    steps,
    summary,
    payload: {
      operation: input.kind,
      projectId: parsed.value.projectId,
      selectedModelId: selected.modelId,
      summary,
      steps: steps.map((step) => ({
        operation: step.operation,
        state: step.license.state,
        error: step.license.error ?? null,
        observation: step.observation ?? null,
      })),
      lastObservation: lastInspect?.observation ?? null,
    },
  };
}
