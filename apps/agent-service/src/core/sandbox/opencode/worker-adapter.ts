import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
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
  OPENCODE_MODEL_TURN_MAX_MS,
  WORKER_FINALIZATION_RESERVE_MS,
  OPENCODE_TERM_GRACE_MS,
  OPENCODE_KILL_GRACE_MS,
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
  rememberBackendRejection,
  rememberClassInFlight,
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
  /**
   * Structured OpenCode/provider error evidence extracted from the raw
   * process capture before assistant-text decoding. Present only when the
   * capture contained a `type:error` protocol event. A turn carrying this
   * evidence must never enter worker-result parsing.
   */
  errorEvidence?: OpenCodeErrorEvidence | null;
};

/**
 * Sanitized, bounded provider/process failure facts. No headers, keys,
 * cookies, or full response bodies are ever captured here — only the
 * event type, error names, numeric status, and a truncated message.
 */
export type OpenCodeErrorEvidence = {
  statusCode: number | null;
  errorName: string | null;
  errorType: string | null;
  message: string | null;
  exitStatus: number | null;
  modelId: string;
};

/** Bounded sanitized diagnostic retained on terminal worker failure. */
export type ModeBFailureEvidence = {
  errorClass: string;
  statusCode: number | null;
  errorType: string | null;
  message: string | null;
  exitStatus: number | null;
  modelId: string | null;
  openCodeVersion: string;
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

const NATIVE_TOOL_TYPES = new Set([
  "tool_use",
  "tool_call",
  "tool",
  "bash",
  "shell",
  "edit",
  "write",
  "patch",
  "webfetch",
]);

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```json\s*([\s\S]*?)```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const ERROR_EVIDENCE_MESSAGE_MAX = 300;

/**
 * Structured OpenCode `type:error` event extraction. Inspects raw process
 * capture (stdout preferred, stderr fallback at the call site) BEFORE
 * assistant-text decoding: error events carry no assistant text, so the
 * decoder would otherwise erase them into an empty string that the strict
 * worker parser then reports as malformed output.
 */
export function extractOpenCodeErrorEvidence(
  raw: string,
  input: { exitStatus: number | null; modelId: string },
): OpenCodeErrorEvidence | null {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(event) || event.type !== "error") continue;
    const err = isRecord(event.error) ? event.error : null;
    const data = err !== null && isRecord(err.data) ? err.data : null;
    const statusCode =
      data !== null && typeof data.statusCode === "number" && Number.isSafeInteger(data.statusCode)
        ? data.statusCode
        : null;
    let bodyType: string | null = null;
    let bodyMessage: string | null = null;
    const rawBody = data !== null ? data.responseBody : undefined;
    if (typeof rawBody === "string" && rawBody.trim().startsWith("{")) {
      try {
        const body = JSON.parse(rawBody) as unknown;
        if (isRecord(body)) {
          const inner = isRecord(body.error) ? body.error : null;
          if (inner !== null && typeof inner.type === "string") bodyType = inner.type;
          const candidate = inner !== null && typeof inner.message === "string"
            ? inner.message
            : typeof body.message === "string" ? body.message : null;
          if (candidate !== null && candidate.trim().length > 0) {
            bodyMessage = candidate.trim().slice(0, ERROR_EVIDENCE_MESSAGE_MAX);
          }
        }
      } catch {
        // Unparseable bodies contribute no evidence; other fields still stand.
      }
    }
    const directMessage = data !== null && typeof data.message === "string"
      && data.message.trim().length > 0
      ? data.message.trim().slice(0, ERROR_EVIDENCE_MESSAGE_MAX)
      : null;
    const errorName = err !== null && typeof err.name === "string" ? err.name : null;
    const errorType = bodyType
      ?? (data !== null && typeof data.errorType === "string" ? data.errorType : null)
      ?? (err !== null && typeof err.code === "string" ? err.code : null);
    return {
      statusCode,
      errorName,
      errorType,
      message: directMessage ?? bodyMessage,
      exitStatus: input.exitStatus,
      modelId: input.modelId,
    };
  }
  return null;
}

export type OpenCodeErrorClass =
  | { kind: "quota_exhausted" }
  | { kind: "provider_rejected"; scope: "class" | "model" }
  | { kind: "provider_unavailable"; scope: "model" };

/**
 * Mechanical classification of structured OpenCode/provider error evidence.
 * A 403 / free-tier gate is a service/client eligibility rejection proven
 * for the whole free backend (observed identically across quota classes),
 * never evidence that one model is unhealthy. 5xx stays model-scoped:
 * ordinary per-model failures must not become class-wide outages.
 */
export function classifyOpenCodeErrorEvidence(
  evidence: OpenCodeErrorEvidence,
): OpenCodeErrorClass | null {
  const hay = `${evidence.errorType ?? ""} ${evidence.message ?? ""}`.toLowerCase();
  if (
    evidence.statusCode === 429
    || /\bquota[-_ ]?(exceeded|exhausted|limit)\b/.test(hay)
    || (/\brate[-_ ]limit\b/.test(hay) && /\bexceeded\b/.test(hay))
  ) {
    return { kind: "quota_exhausted" };
  }
  if (evidence.statusCode === 403 || /free[_-]?tier/.test(hay)) {
    return { kind: "provider_rejected", scope: "class" };
  }
  if (evidence.statusCode !== null && evidence.statusCode >= 500 && evidence.statusCode <= 599) {
    return { kind: "provider_unavailable", scope: "model" };
  }
  if (evidence.statusCode !== null && evidence.statusCode >= 400 && evidence.statusCode <= 499) {
    return { kind: "provider_rejected", scope: "model" };
  }
  return null;
}

export function decodeOpenCodeRunStdout(stdout: string): { text: string; nativeTool: boolean } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return { text: stdout, nativeTool: false };
  let text = "";
  let nativeTool = false;
  let parsedAny = false;
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as unknown;
      if (!isRecord(event)) continue;
      parsedAny = true;
      const type = String(event.type ?? event.kind ?? "");
      const part = isRecord(event.part) ? event.part : null;
      const partType = part && typeof part.type === "string" ? part.type : "";
      if (NATIVE_TOOL_TYPES.has(type) || NATIVE_TOOL_TYPES.has(partType)) nativeTool = true;
      const chunk = typeof event.text === "string"
        ? event.text
        : part && typeof part.text === "string"
          ? part.text
          : "";
      if (chunk) text += chunk;
    } catch {
      // non-JSONL residue is ignored when any event parsed
    }
  }
  if (!parsedAny) return { text: stdout, nativeTool: false };
  if (text.length === 0) {
    const host = extractJsonObject(stdout);
    if (host && (host.type === "tool_request" || host.type === "complete")) {
      return { text: stdout, nativeTool };
    }
  }
  return { text, nativeTool };
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
    "Paths in request must be project-relative with no leading slash and no .. segments.",
    "Do not claim that a file was read or written unless a tool result in this prompt says so.",
    `projectId: ${input.request.projectId}`,
    input.request.focus ? `focus: ${input.request.focus}` : "",
    `purpose: ${input.purpose}`,
    input.history ? `prior_results:\n${input.history}` : "",
  ].filter(Boolean).join("\n");
}

export type TerminateProcessOptions = {
  termGraceMs?: number;
  killGraceMs?: number;
};

export type TerminateProcessResult = {
  closed: boolean;
  closeStatus?: number | null;
};

/**
 * Bounded OpenCode direct-child termination escalation:
 * 1. Request termination (SIGTERM) on direct child process.
 * 2. Wait up to bounded duration (OPENCODE_TERM_GRACE_MS).
 * 3. If still not closed, escalate to SIGKILL.
 * 4. Wait up to bounded confirmation duration (OPENCODE_KILL_GRACE_MS).
 * 5. ONLY direct-child 'close' proves teardown ('exit' alone does not). If
 *    unconfirmed after kill grace, returns { closed: false } leading to
 *    opencode_termination_unconfirmed.
 *
 * The directly spawned OpenCode process is mechanically confirmed closed
 * before timeout-based same-session model fallback is authorized. Process-tree
 * properties beyond the direct child are not established here.
 */
export function terminateProcessWithEscalation(
  child: ChildProcess,
  options: TerminateProcessOptions = {},
): Promise<TerminateProcessResult> {
  return new Promise((resolve) => {
    if ((child as unknown as { __opencodeClosed?: boolean }).__opencodeClosed) {
      resolve({
        closed: true,
        closeStatus: (child as unknown as { __opencodeCloseStatus?: number | null }).__opencodeCloseStatus,
      });
      return;
    }

    const termGraceMs = options.termGraceMs ?? OPENCODE_TERM_GRACE_MS;
    const killGraceMs = options.killGraceMs ?? OPENCODE_KILL_GRACE_MS;

    let closed = false;
    let termTimer: NodeJS.Timeout | null = null;
    let killTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (termTimer) clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
    };

    // ONLY 'close' proves direct-child teardown ('exit' alone does not)
    child.once("close", (status) => {
      if (!closed) {
        closed = true;
        (child as unknown as { __opencodeClosed?: boolean }).__opencodeClosed = true;
        (child as unknown as { __opencodeCloseStatus?: number | null }).__opencodeCloseStatus = status;
        cleanup();
        resolve({ closed: true, closeStatus: status });
      }
    });

    // Request SIGTERM
    try {
      child.kill("SIGTERM");
    } catch {
      // kill() throwing does NOT prove the process is closed.
      // We must still await mechanical 'close'.
    }

    termTimer = setTimeout(() => {
      if (closed) return;
      // If not closed after TERM grace, escalate to SIGKILL
      try {
        child.kill("SIGKILL");
      } catch {
        // Still await mechanical 'close'
      }

      // Bounded KILL/close-confirmation grace
      killTimer = setTimeout(() => {
        if (closed) return;
        cleanup();
        // If close still cannot be confirmed after kill grace, direct-child
        // termination remains unconfirmed.
        resolve({ closed: false });
      }, killGraceMs);
    }, termGraceMs);
  });
}

export type SpawnOpenCodeTransportOptions = {
  termGraceMs?: number;
  killGraceMs?: number;
  spawnChild?: typeof spawn;
};

export function spawnOpenCodeTransport(options: SpawnOpenCodeTransportOptions = {}): OpenCodeTransport {
  const spawnFn = options.spawnChild ?? spawn;
  const termGraceMs = options.termGraceMs ?? OPENCODE_TERM_GRACE_MS;
  const killGraceMs = options.killGraceMs ?? OPENCODE_KILL_GRACE_MS;
  return {
    complete(input) {
      return new Promise((resolve, reject) => {
        const child = spawnFn(
          input.binaryPath,
          ["run", "--pure", "--format", "json", "--model", input.modelId, input.prompt],
          {
            cwd: input.cwd,
            env: input.env,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let closed = false;

        child.on("close", (status) => {
          (child as unknown as { __opencodeClosed?: boolean }).__opencodeClosed = true;
          (child as unknown as { __opencodeCloseStatus?: number | null }).__opencodeCloseStatus = status;
          if (timedOut) return;
          closed = true;
          clearTimeout(timer);
          const decoded = decodeOpenCodeRunStdout(stdout || stderr);
          const errorEvidence = extractOpenCodeErrorEvidence(stdout, {
            exitStatus: typeof status === "number" ? status : null,
            modelId: input.modelId,
          }) ?? extractOpenCodeErrorEvidence(stderr, {
            exitStatus: typeof status === "number" ? status : null,
            modelId: input.modelId,
          });
          resolve({
            text: decoded.nativeTool ? "{\"type\":\"native_tool_forbidden\"}" : decoded.text,
            status,
            ...(errorEvidence ? { errorEvidence } : {}),
          });
        });

        const timer = setTimeout(async () => {
          if (closed) return;
          timedOut = true;
          try {
            const termination = await terminateProcessWithEscalation(child, {
              termGraceMs,
              killGraceMs,
            });
            if (!termination.closed) {
              reject(new Error("opencode_termination_unconfirmed"));
              return;
            }
            reject(new Error("opencode_timeout"));
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg === "opencode_termination_unconfirmed") {
              reject(error);
            } else {
              reject(new Error("opencode_termination_unconfirmed"));
            }
          }
        }, Math.max(1, input.deadlineAtMs - Date.now()));

        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          if (timedOut) return;
          clearTimeout(timer);
          reject(error);
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
  gateOk?: boolean;
  gateError?: string;
};

function taskClassFor(kind: string): WorkerTaskClass {
  return kind === MODE_B_INVESTIGATE ? "delegated_read" : "iterative_engineering";
}

function profileFor(kind: string): WorkerToolProfile {
  return kind === MODE_B_INVESTIGATE ? "read" : "candidate";
}

function remainingDeadlines(
  base: ExecuteModeBWorkerInput["inspectionBase"],
  nowMs: number,
  deadlineAtMs: number,
): ExecuteModeBWorkerInput["inspectionBase"] {
  const remaining = Math.max(1, deadlineAtMs - nowMs);
  return {
    ...base,
    projectInspectionPreparationDeadlineAtMs: nowMs + Math.min(8_000, Math.max(1, Math.floor(remaining * 0.2))),
    childExecutionDeadlineAtMs: nowMs + Math.min(20_000, Math.max(1, Math.floor(remaining * 0.5))),
    childTerminationDeadlineAtMs: nowMs + Math.min(35_000, Math.max(1, Math.floor(remaining * 0.75))),
    settlementDeadlineAtMs: nowMs + remaining,
  };
}

function remainingWorkspaceDeadlines(
  base: ExecuteModeBWorkerInput["workspaceBase"],
  nowMs: number,
  deadlineAtMs: number,
): ExecuteModeBWorkerInput["workspaceBase"] {
  const remaining = Math.max(1, deadlineAtMs - nowMs);
  return {
    ...base,
    deadlineAtMs: nowMs + remaining,
    childExecutionDeadlineAtMs: nowMs + Math.min(20_000, Math.max(1, Math.floor(remaining * 0.5))),
    childTerminationDeadlineAtMs: nowMs + Math.min(35_000, Math.max(1, Math.floor(remaining * 0.75))),
    settlementDeadlineAtMs: nowMs + remaining,
  };
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
  if (input.gateOk === false) return empty(input.gateError ?? "worker_gate_denied");
  if (input.pinnedVersion !== input.router.catalog.pinnedOpenCodeVersion) {
    return empty("opencode_pin_mismatch");
  }
  if (!input.transport && !resolveOpenCodeBinary(input.binaryPath)) {
    return empty("opencode_binary_missing");
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
    rememberClassInFlight(routed.quotaClass, true);
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
  let lastTurnStatus: number | null = null;
  let lastTurnEvidence: OpenCodeErrorEvidence | null = null;
  let history = "";
  const bootstrappedClasses = new Set<QuotaClass>();
  if (routed.bootstrap) bootstrappedClasses.add(routed.quotaClass);

  const rerouteAfterCapacityFailure = (): boolean => {
    router = {
      ...router,
      state: quotaState,
      nowMs: input.nowMs(),
      inFlightFirstAttempt: { ...router.inFlightFirstAttempt, [selected.quotaClass]: false },
    };
    const next = routeWorkerTask(router, task);
    if (!next.ok) {
      terminalError = next.reason;
      return false;
    }
    selected = next;
    if (next.bootstrap) {
      router.inFlightFirstAttempt[next.quotaClass] = true;
      rememberClassInFlight(next.quotaClass, true);
      bootstrappedClasses.add(next.quotaClass);
    }
    return true;
  };

  try {
    for (let step = 0; step < parsed.value.maxSteps; step += 1) {
      if (input.deadlineAtMs - input.nowMs() <= WORKER_FINALIZATION_RESERVE_MS) {
        terminalError = "deadline_exhausted";
        break;
      }
      const turnDeadlineAtMs = Math.min(
        input.deadlineAtMs,
        input.nowMs() + OPENCODE_MODEL_TURN_MAX_MS,
      );
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
          deadlineAtMs: turnDeadlineAtMs,
          binaryPath: input.binaryPath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "opencode_failed";
        if (message === "opencode_timeout") {
          router = setModelHealth(router, selected.modelId, "temporarily_unavailable");
          if (input.deadlineAtMs - input.nowMs() > WORKER_FINALIZATION_RESERVE_MS) {
            if (!rerouteAfterCapacityFailure()) {
              terminalError = "model_temporarily_unavailable";
              break;
            }
            continue;
          }
          terminalError = "deadline_exhausted";
          break;
        } else if (message === "opencode_termination_unconfirmed") {
          terminalError = "opencode_termination_unconfirmed";
          break;
        } else {
          terminalError = "opencode_failed";
          break;
        }
      }
      lastTurnStatus = typeof turn.status === "number" ? turn.status : null;
      lastTurnEvidence = turn.errorEvidence ?? null;
      // Structured OpenCode/provider error envelopes are classified here and
      // never enter worker-result parsing: no worker message was produced.
      if (lastTurnEvidence) {
        const classified = classifyOpenCodeErrorEvidence(lastTurnEvidence);
        if (classified?.kind === "quota_exhausted") {
          quotaState = recordClassExhausted(quotaState, selected.quotaClass, { nowMs: input.nowMs() });
          if (!rerouteAfterCapacityFailure()) break;
          continue;
        }
        if (classified?.kind === "provider_rejected" && classified.scope === "class") {
          // Service/client gate proven for the whole free backend (observed
          // identically across quota classes): bounded process-wide
          // rejection admits no pointless sibling-model carousel here and
          // re-admits probing for future tasks past the horizon. No quota
          // state is written for a client/provider rejection.
          const rejectedUntilMs = rememberBackendRejection(input.nowMs());
          router = { ...router, backendRejectedUntilMs: rejectedUntilMs };
          if (!rerouteAfterCapacityFailure()) {
            terminalError = "opencode_provider_rejected";
            break;
          }
          continue;
        }
        if (classified?.kind === "provider_unavailable") {
          router = setModelHealth(router, selected.modelId, "temporarily_unavailable");
          if (!rerouteAfterCapacityFailure()) {
            terminalError = "model_temporarily_unavailable";
            break;
          }
          continue;
        }
        if (classified?.kind === "provider_rejected") {
          router = setModelHealth(router, selected.modelId, "temporarily_unavailable");
          if (!rerouteAfterCapacityFailure()) {
            terminalError = "opencode_provider_rejected";
            break;
          }
          continue;
        }
        // Structured error envelope with no recognized class: truthful
        // generic execution failure, never worker-output parsing.
        terminalError = "opencode_failed";
        break;
      }
      const evidence = classifyOpenCodeFailure({ status: turn.status, text: turn.text });
      if (evidence === "quota_exhausted") {
        quotaState = recordClassExhausted(quotaState, selected.quotaClass, { nowMs: input.nowMs() });
        if (!rerouteAfterCapacityFailure()) break;
        continue;
      }
      const decoded = decodeOpenCodeRunStdout(turn.text);
      if (decoded.nativeTool) {
        router = setModelHealth(router, selected.modelId, "temporarily_unavailable");
        if (!rerouteAfterCapacityFailure()) {
          terminalError = "native_tool_forbidden";
          break;
        }
        continue;
      }
      const message = parseWorkerMessage(decoded.text);
      if (message.type === "malformed") {
        if (lastTurnStatus !== null && lastTurnStatus !== 0) {
          // The process failed and produced no valid worker message: an
          // execution failure, not a worker-contract violation.
          terminalError = "opencode_failed";
          break;
        }
        router = setModelHealth(router, selected.modelId, "temporarily_unavailable");
        if (!rerouteAfterCapacityFailure()) {
          terminalError = "malformed_worker_output";
          break;
        }
        continue;
      }
      quotaState = recordClassAvailable(quotaState, selected.quotaClass);
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
        inspectionBase: remainingDeadlines(input.inspectionBase, input.nowMs(), input.deadlineAtMs),
        workspaceBase: remainingWorkspaceDeadlines(input.workspaceBase, input.nowMs(), input.deadlineAtMs),
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
    for (const quotaClass of bootstrappedClasses) {
      delete router.inFlightFirstAttempt[quotaClass];
      rememberClassInFlight(quotaClass, false);
    }
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

  // Bounded sanitized diagnostic for the next forensic pass. Present only
  // on terminal failure; success payloads stay byte-identical so failure
  // evidence can never pollute semantic conversation evidence (failure
  // payloads never become observations).
  const failureEvidence: ModeBFailureEvidence | null = terminalError
    ? {
      errorClass: terminalError,
      statusCode: lastTurnEvidence?.statusCode ?? null,
      errorType: lastTurnEvidence?.errorType ?? null,
      message: lastTurnEvidence?.message ?? null,
      exitStatus: lastTurnEvidence?.exitStatus ?? lastTurnStatus,
      modelId: selected.modelId,
      openCodeVersion: input.pinnedVersion,
    }
    : null;

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
      ...(failureEvidence ? { failureEvidence } : {}),
    },
  };
}
