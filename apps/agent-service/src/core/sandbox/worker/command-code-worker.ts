import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { OperationalClaimLicense } from "../engineering-types.js";
import type {
  ExecuteProjectInspectionV2Input,
  ExecuteWorkspaceExperimentV2Input,
} from "../v2-execution.js";
import {
  DETACHED_WORKER_MAX_WALL_CLOCK_MS,
  MODE_B_DEVELOP,
  MODE_B_INVESTIGATE,
  WORKER_FINALIZATION_RESERVE_MS,
  WORKER_MODEL_TURN_MAX_MS,
} from "./contracts.js";
import { validateModeBRequest, type ModeBRequest } from "./mode-b-request.js";
import {
  executeWorkerTool,
  type ToolBridgeDispatchers,
  type WorkerToolCall,
  type WorkerToolProfile,
} from "./tool-bridge.js";

export const COMMAND_CODE_WORKER_MODEL_ID = "meta/muse-spark-1.3-contributor";
export const COMMAND_CODE_WORKER_EFFORT = "xhigh" as const;
export const COMMAND_CODE_WORKER_PINNED_VERSION = "1.64.0";
const COMMAND_CODE_RUNTIME_MOUNT = "/opt";
const WORKER_HOME = "/tmp/ashley-worker/home";
const WORKER_TMP = "/tmp/ashley-worker/tmp";
const OUTPUT_MAX_BYTES = 1_048_576;
const ERROR_MESSAGE_MAX = 300;
const WORKER_TOOL_RESULT_MAX_CHARS = 12_000;
const WORKER_TOOL_HISTORY_MAX_CHARS = 24_000;
const TERM_GRACE_MS = 1_000;
const KILL_GRACE_MS = 1_000;

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

export type ModeBWorkerResult = {
  license: OperationalClaimLicense;
  selectedModelId: string | null;
  quotaClass: string | null;
  steps: ModeBWorkerStep[];
  summary: string | null;
  payload: Record<string, unknown>;
};

export type ModeBWorkerStep = {
  operation: string;
  license: OperationalClaimLicense;
  observation?: unknown;
};

export type CommandCodeRuntime = {
  root: string;
  node: string;
  script: string;
  version: string;
};

export type CommandCodeErrorEvidence = {
  statusCode: number | null;
  errorType: string | null;
  message: string | null;
  exitStatus: number | null;
  modelId: string;
};

export type CommandCodeWorkerTurn = {
  text: string;
  status: number | null;
  protocolError?: "malformed_cli_output" | "native_tool_forbidden";
  errorEvidence?: CommandCodeErrorEvidence | null;
};

export type CommandCodeWorkerTransport = {
  complete(input: {
    modelId: string;
    effort: typeof COMMAND_CODE_WORKER_EFFORT;
    prompt: string;
    deadlineAtMs: number;
  }): Promise<CommandCodeWorkerTurn>;
};

export type CommandCodeInvocation = {
  executable: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
};

export type CommandCodeWorkerInput = {
  kind: typeof MODE_B_INVESTIGATE | typeof MODE_B_DEVELOP;
  request: unknown;
  purpose: string;
  apiKey: string;
  binaryPath: string;
  bubblewrapPath: string;
  pinnedVersion: string;
  dispatchers: ToolBridgeDispatchers;
  inspectionBase: Omit<ExecuteProjectInspectionV2Input, "request">;
  workspaceBase: Omit<ExecuteWorkspaceExperimentV2Input, "request">;
  workspaceId?: string;
  nowMs: () => number;
  deadlineAtMs?: number;
  transport?: CommandCodeWorkerTransport;
  workerEnabled: boolean;
  gateOk?: boolean;
  gateError?: string;
};

type CommandCodeInvocationInput = {
  runtime: Pick<CommandCodeRuntime, "root" | "node" | "script">;
  bubblewrapPath: string;
  apiKey: string;
  prompt: string;
};

type TerminationResult = { closed: true } | { closed: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function intValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isPosixPathWithin(root: string, candidate: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith("../") && !path.posix.isAbsolute(relative));
}

function packageRootFor(script: string): { root: string; version: string } | null {
  let directory = path.dirname(script);
  while (true) {
    const packagePath = path.join(directory, "package.json");
    try {
      const record = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
      if (isRecord(record) && record.name === "command-code" && typeof record.version === "string") {
        return { root: directory, version: record.version };
      }
    } catch {
      // The installation root is found by walking parent directories.
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/** Resolve the installed CLI and the Node runtime that will execute its entry point. */
export function resolveCommandCodeRuntime(
  binaryPath: string,
  nodeExecutable = process.execPath,
): CommandCodeRuntime | null {
  try {
    const requestedBinary = binaryPath.trim() || path.join(path.dirname(nodeExecutable), "command-code");
    if (!existsSync(requestedBinary) || !existsSync(nodeExecutable)) return null;
    const node = realpathSync(nodeExecutable);
    const script = realpathSync(requestedBinary);
    const root = path.dirname(path.dirname(node));
    const installed = packageRootFor(script);
    if (!installed || !isPathWithin(root, installed.root) || !isPathWithin(root, script)) return null;
    return { root, node, script, version: installed.version };
  } catch {
    return null;
  }
}

/** Build the isolated CLI invocation; private prompt and API key stay off argv. */
export function buildCommandCodeInvocation(input: CommandCodeInvocationInput): CommandCodeInvocation {
  if (!input.apiKey.trim()) throw new Error("command_code_credentials_missing");
  const runtimeRoot = path.posix.resolve(input.runtime.root);
  const nodePath = path.posix.resolve(input.runtime.node);
  const scriptPath = path.posix.resolve(input.runtime.script);
  if (runtimeRoot === "/" || !isPosixPathWithin(runtimeRoot, nodePath) || !isPosixPathWithin(runtimeRoot, scriptPath)) {
    throw new Error("command_code_runtime_outside_root");
  }
  const relativeNode = path.posix.relative(runtimeRoot, nodePath);
  const relativeScript = path.posix.relative(runtimeRoot, scriptPath);
  const nodeInSandbox = `${COMMAND_CODE_RUNTIME_MOUNT}/${relativeNode}`;
  const scriptInSandbox = `${COMMAND_CODE_RUNTIME_MOUNT}/${relativeScript}`;
  const args = [
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "--new-session",
    "--ro-bind", "/", "/",
    "--ro-bind", runtimeRoot, COMMAND_CODE_RUNTIME_MOUNT,
  ];
  for (const directory of ["/home", "/root", "/tmp"]) {
    args.push("--tmpfs", directory);
  }
  for (const directory of ["/mnt", "/media", "/srv", "/workspace", "/workspaces", "/ashley"]) {
    if (existsSync(directory)) args.push("--tmpfs", directory);
  }
  args.push(
    "--dev", "/dev",
    "--proc", "/proc",
    "--dir", "/tmp/ashley-worker",
    "--dir", WORKER_HOME,
    "--dir", WORKER_TMP,
  );
  args.push(
    "--setenv", "PATH", "/opt/bin:/usr/bin:/bin",
    "--setenv", "HOME", WORKER_HOME,
    "--setenv", "TMPDIR", WORKER_TMP,
    "--setenv", "CI", "1",
    "--setenv", "COMMANDCODE_SKIP_UPDATES", "1",
    "--setenv", "NO_COLOR", "1",
    "--setenv", "TERM", "dumb",
    "--setenv", "TZ", "UTC",
    "--chdir", WORKER_HOME,
    "--",
    nodeInSandbox,
    scriptInSandbox,
    "--model", COMMAND_CODE_WORKER_MODEL_ID,
    "--effort", COMMAND_CODE_WORKER_EFFORT,
    "--max-turns", "64",
    "--output-format", "json",
    "--permission-mode", "plan",
    "--skip-onboarding",
    "--no-skills",
    "--no-auto-update",
    "--no-session",
    "--print",
  );
  return {
    executable: input.bubblewrapPath,
    args,
    env: {
      COMMAND_CODE_API_KEY: input.apiKey,
      COMMANDCODE_SKIP_UPDATES: "1",
      CI: "1",
      HOME: WORKER_HOME,
      TMPDIR: WORKER_TMP,
      PATH: "/opt/bin:/usr/bin:/bin",
      NO_COLOR: "1",
      TERM: "dumb",
      TZ: "UTC",
    },
    stdin: input.prompt,
  };
}

function sanitizeMessage(message: string | null, apiKey: string): string | null {
  if (!message) return null;
  let safe = message.trim();
  if (apiKey) safe = safe.split(apiKey).join("[redacted]");
  safe = safe
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|secret)\b\s*[:=]\s*[^\s,;"']+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s?]+\?[^\s]+/gi, "[redacted-url]");
  return safe.slice(0, ERROR_MESSAGE_MAX);
}

function statusFromText(text: string): number | null {
  const match = text.match(/\b(?:http(?:\s+status)?|status(?:_code| code)?)\s*[:=]?\s*(401|403|429|4\d\d|5\d\d)\b|^\s*(401|403|429|4\d\d|5\d\d)\b/i);
  return match ? Number(match[1] ?? match[2]) : null;
}

export function extractCommandCodeErrorEvidence(
  raw: string,
  input: { modelId: string; exitStatus: number | null; apiKey: string },
): CommandCodeErrorEvidence | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const error = isRecord(parsed.error) ? parsed.error : null;
    const data = error && isRecord(error.data) ? error.data : null;
    const statusCode = intValue(parsed.statusCode)
      ?? intValue(parsed.status_code)
      ?? intValue(parsed.status)
      ?? intValue(error?.statusCode)
      ?? intValue(error?.status)
      ?? intValue(data?.statusCode)
      ?? intValue(data?.status);
    const errorType = stringValue(error?.type)
      ?? stringValue(error?.code)
      ?? stringValue(data?.errorType)
      ?? stringValue(parsed.errorType)
      ?? stringValue(parsed.subtype);
    const message = stringValue(error?.message)
      ?? stringValue(data?.message)
      ?? (typeof parsed.error === "string" ? parsed.error : null)
      ?? (parsed.subtype === "error" ? stringValue(parsed.finalText) : null)
      ?? stringValue(parsed.message);
    if (statusCode === null && !errorType && !message) continue;
    return {
      statusCode,
      errorType,
      message: sanitizeMessage(message, input.apiKey),
      exitStatus: input.exitStatus,
      modelId: input.modelId,
    };
  }
  const statusCode = statusFromText(raw);
  if (statusCode === null) return null;
  const line = raw.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? "";
  return {
    statusCode,
    errorType: null,
    message: sanitizeMessage(line, input.apiKey),
    exitStatus: input.exitStatus,
    modelId: input.modelId,
  };
}

function eventHasNativeTool(event: Record<string, unknown>): boolean {
  const type = typeof event.type === "string" ? event.type : "";
  const subtype = typeof event.subtype === "string" ? event.subtype : "";
  const part = isRecord(event.part) ? event.part : null;
  const partType = part && typeof part.type === "string" ? part.type : "";
  return NATIVE_TOOL_TYPES.has(type) || NATIVE_TOOL_TYPES.has(subtype) || NATIVE_TOOL_TYPES.has(partType);
}

function decodeCommandCodeOutput(
  stdout: string,
  input: { status: number | null; modelId: string; apiKey: string },
): CommandCodeWorkerTurn {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { text: "", status: input.status, protocolError: "malformed_cli_output" };
  }
  const events: Record<string, unknown>[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return { text: "", status: input.status, protocolError: "malformed_cli_output" };
    }
    if (!isRecord(parsed)) return { text: "", status: input.status, protocolError: "malformed_cli_output" };
    events.push(parsed);
  }
  if (events.some(eventHasNativeTool)) {
    return { text: "", status: input.status, protocolError: "native_tool_forbidden" };
  }
  const result = [...events].reverse().find((event) => event.type === "result");
  if (input.status !== 0 || result?.subtype !== "success" || typeof result.finalText !== "string") {
          const errorEvidence = extractCommandCodeErrorEvidence(stdout, {
      modelId: input.modelId,
      exitStatus: input.status,
      apiKey: input.apiKey,
    });
    return {
      text: "",
      status: input.status,
      ...(errorEvidence ? { errorEvidence } : {}),
      ...(!errorEvidence ? { protocolError: "malformed_cli_output" as const } : {}),
    };
  }
  return { text: result.finalText, status: input.status };
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // A signal request is not treated as proof of child termination.
    }
  }
}

function terminateProcessWithEscalation(child: ChildProcess): Promise<TerminationResult> {
  const remembered = child as unknown as { __commandCodeClosed?: boolean };
  if (remembered.__commandCodeClosed) return Promise.resolve({ closed: true });
  return new Promise((resolve) => {
    let closed = false;
    let killTimer: NodeJS.Timeout | null = null;
    const termTimer = setTimeout(() => {
      if (closed) return;
      signalProcessGroup(child, "SIGKILL");
      killTimer = setTimeout(() => {
        if (!closed) resolve({ closed: false });
      }, KILL_GRACE_MS);
    }, TERM_GRACE_MS);
    child.once("close", () => {
      closed = true;
      remembered.__commandCodeClosed = true;
      clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ closed: true });
    });
    signalProcessGroup(child, "SIGTERM");
  });
}

export type SpawnCommandCodeTransportOptions = {
  spawnChild?: typeof spawn;
};

/** Runs one non-interactive CLI turn inside a fresh, project-free mount namespace. */
export function spawnCommandCodeTransport(
  input: {
    runtime: CommandCodeRuntime;
    bubblewrapPath: string;
    apiKey: string;
  },
  options: SpawnCommandCodeTransportOptions = {},
): CommandCodeWorkerTransport {
  const spawnFn = options.spawnChild ?? spawn;
  return {
    complete(turn) {
      const prompt = turn.prompt;
      const invocation = buildCommandCodeInvocation({ ...input, prompt });
      return new Promise((resolve, reject) => {
        const remainingMs = Math.max(1, turn.deadlineAtMs - Date.now());
        const child = spawnFn(invocation.executable, invocation.args, {
          cwd: "/",
          env: invocation.env,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timeoutTimer: NodeJS.Timeout | null = null;
        let stopReason: string | null = null;

        const finishError = (message: string) => {
          if (settled) return;
          settled = true;
          if (timeoutTimer) clearTimeout(timeoutTimer);
          reject(new Error(message));
        };
        const stop = (reason: string) => {
          if (stopReason || settled) return;
          stopReason = reason;
          void terminateProcessWithEscalation(child).then((result) => {
            finishError(result.closed ? reason : "command_code_termination_unconfirmed");
          });
        };
        timeoutTimer = setTimeout(() => stop("command_code_timeout"), remainingMs);
        child.once("close", (status) => {
          (child as unknown as { __commandCodeClosed?: boolean }).__commandCodeClosed = true;
          if (settled) return;
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (stopReason) {
            finishError(stopReason);
            return;
          }
          settled = true;
          const exitStatus = typeof status === "number" ? status : null;
          if (exitStatus !== 0) {
            const errorEvidence = extractCommandCodeErrorEvidence(`${stdout}\n${stderr}`, {
              modelId: turn.modelId,
              exitStatus,
              apiKey: input.apiKey,
            });
            if (errorEvidence) {
              resolve({ text: "", status: exitStatus, errorEvidence });
              return;
            }
          }
          const decoded = decodeCommandCodeOutput(stdout, {
            status: exitStatus,
            modelId: turn.modelId,
            apiKey: input.apiKey,
          });
          if (decoded.errorEvidence) {
            resolve({ ...decoded, errorEvidence: decoded.errorEvidence });
            return;
          }
          if (decoded.protocolError && stderr.trim().length > 0) {
            const errorEvidence = extractCommandCodeErrorEvidence(stderr, {
              modelId: turn.modelId,
              exitStatus,
              apiKey: input.apiKey,
            });
            resolve({ ...decoded, ...(errorEvidence ? { errorEvidence } : {}) });
            return;
          }
          resolve(decoded);
        });
        child.once("error", () => finishError("command_code_process_spawn_failed"));
        child.stdout?.on("data", (chunk: Buffer | string) => {
          const part = chunk.toString();
          if (Buffer.byteLength(stdout) + Buffer.byteLength(part) > OUTPUT_MAX_BYTES) {
            stop("command_code_output_limit");
            return;
          }
          stdout += part;
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          const part = chunk.toString();
          if (Buffer.byteLength(stderr) + Buffer.byteLength(part) > OUTPUT_MAX_BYTES) {
            stop("command_code_output_limit");
            return;
          }
          stderr += part;
        });
        child.stdin?.on("error", () => {
          // A closed stdin pipe is reported by the process result, not logged.
        });
        child.stdin?.end(invocation.stdin);
      });
    },
  };
}

function profileFor(kind: string): WorkerToolProfile {
  return kind === MODE_B_INVESTIGATE ? "read" : "candidate";
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
    "Host, not the worker, executes all requested tools.",
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

function remainingInspectionDeadlines(
  base: CommandCodeWorkerInput["inspectionBase"],
  nowMs: number,
  deadlineAtMs: number,
): CommandCodeWorkerInput["inspectionBase"] {
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
  base: CommandCodeWorkerInput["workspaceBase"],
  nowMs: number,
  deadlineAtMs: number,
): CommandCodeWorkerInput["workspaceBase"] {
  const remaining = Math.max(1, deadlineAtMs - nowMs);
  return {
    ...base,
    deadlineAtMs: nowMs + remaining,
    childExecutionDeadlineAtMs: nowMs + Math.min(20_000, Math.max(1, Math.floor(remaining * 0.5))),
    childTerminationDeadlineAtMs: nowMs + Math.min(35_000, Math.max(1, Math.floor(remaining * 0.75))),
    settlementDeadlineAtMs: nowMs + remaining,
  };
}

function appendToolHistory(history: string, entry: {
  step: number;
  operation: string;
  license: OperationalClaimLicense;
  observation: unknown;
}): string {
  const record = {
    operation: entry.operation,
    state: entry.license.state,
    error: entry.license.error ?? null,
    executionTruth: entry.license.executionTruth ?? null,
    receiptRef: entry.license.receiptRef ?? null,
    observation: entry.observation,
  };
  let serialized: string;
  try {
    const full = JSON.stringify(record);
    serialized = full.length <= WORKER_TOOL_RESULT_MAX_CHARS
      ? full
      : JSON.stringify({
        truncated: true,
        originalCharacters: full.length,
        prefix: full.slice(0, WORKER_TOOL_RESULT_MAX_CHARS - 128),
      });
  } catch {
    serialized = JSON.stringify({ operation: entry.operation, result: "unserializable" });
  }
  const line = `step ${entry.step} host_result ${serialized}`;
  const combined = history ? `${history}\n${line}` : line;
  if (combined.length <= WORKER_TOOL_HISTORY_MAX_CHARS) return combined;
  const marker = "[earlier worker tool results omitted]\n";
  return `${marker}${combined.slice(-(WORKER_TOOL_HISTORY_MAX_CHARS - marker.length))}`;
}

function externalPrerequisite(evidence: CommandCodeErrorEvidence): boolean {
  const hay = `${evidence.errorType ?? ""} ${evidence.message ?? ""}`.toLowerCase();
  return evidence.statusCode === 401
    || evidence.statusCode === 403
    || evidence.statusCode === 429
    || (evidence.statusCode !== null && evidence.statusCode >= 500 && evidence.statusCode <= 599)
    || /account[_ -]?policy|authentication|quota|rate[_ -]?limit|provider[_ -]?refus|service[_ -]?unavailable/.test(hay);
}

function externalError(evidence: CommandCodeErrorEvidence): string {
  if (evidence.statusCode === 429) return "external_service_limited";
  if (evidence.statusCode !== null && evidence.statusCode >= 500) return "external_service_unavailable";
  return "external_service_rejected";
}

export async function executeCommandCodeWorker(input: CommandCodeWorkerInput): Promise<ModeBWorkerResult> {
  const empty = (error: string): ModeBWorkerResult => ({
    license: { state: "none", profile: "command_code_mode_b", error, executionTruth: "no_effect_proven" },
    selectedModelId: null,
    quotaClass: null,
    steps: [],
    summary: null,
    payload: { error },
  });

  if (!input.workerEnabled) return empty("worker_disabled");
  if (input.gateOk === false) return empty(input.gateError ?? "worker_gate_denied");
  if (input.pinnedVersion !== COMMAND_CODE_WORKER_PINNED_VERSION) return empty("command_code_pin_mismatch");
  if (!input.apiKey.trim()) return empty("command_code_credentials_missing");
  const parsed = validateModeBRequest({ kind: input.kind, request: input.request });
  if (!parsed.ok) return empty(parsed.error);
  const workspaceId = parsed.value.kind === MODE_B_DEVELOP
    ? parsed.value.workspaceId ?? input.workspaceId
    : undefined;
  if (parsed.value.kind === MODE_B_DEVELOP && !workspaceId) return empty("missing_workspace");

  let transport = input.transport;
  let commandCodeVersion = input.pinnedVersion;
  if (!transport) {
    const runtime = resolveCommandCodeRuntime(input.binaryPath);
    if (!runtime) return empty("command_code_cli_unavailable");
    if (runtime.version !== input.pinnedVersion) return empty("command_code_version_mismatch");
    if (!existsSync(input.bubblewrapPath)) return empty("worker_isolation_unavailable");
    commandCodeVersion = runtime.version;
    transport = spawnCommandCodeTransport({ runtime, bubblewrapPath: input.bubblewrapPath, apiKey: input.apiKey });
  }

  const base = input.nowMs();
  const deadlineAtMs = input.deadlineAtMs ?? base + DETACHED_WORKER_MAX_WALL_CLOCK_MS;
  const sessionDeadlineAtMs = deadlineAtMs - WORKER_FINALIZATION_RESERVE_MS;
  if (sessionDeadlineAtMs - input.nowMs() <= 0) return empty("deadline_exhausted");

  const steps: ModeBWorkerStep[] = [];
  let summary: string | null = null;
  let terminalError: string | null = null;
  let selectedModelId: string | null = null;
  let failureEvidence: (CommandCodeErrorEvidence & { externalPrerequisite: boolean; commandCodeVersion: string }) | null = null;
  let history = "";
  const taskProfile = profileFor(input.kind);
  const maxSteps = parsed.value.maxSteps;

  for (let step = 0; step < maxSteps; step += 1) {
    if (sessionDeadlineAtMs - input.nowMs() <= 0) {
      terminalError = "deadline_exhausted";
      break;
    }
    const turnDeadlineAtMs = Math.min(sessionDeadlineAtMs, input.nowMs() + WORKER_MODEL_TURN_MAX_MS);
    selectedModelId = COMMAND_CODE_WORKER_MODEL_ID;
    let turn: CommandCodeWorkerTurn;
    try {
      turn = await transport.complete({
        modelId: COMMAND_CODE_WORKER_MODEL_ID,
        effort: COMMAND_CODE_WORKER_EFFORT,
        prompt: hostProtocolPrompt({ request: parsed.value, profile: taskProfile, purpose: input.purpose, history }),
        deadlineAtMs: turnDeadlineAtMs,
      });
    } catch (error) {
      const safeReason = error instanceof Error && [
        "command_code_timeout",
        "command_code_output_limit",
        "command_code_termination_unconfirmed",
      ].includes(error.message)
        ? error.message
        : "command_code_cli_failed";
      terminalError = safeReason;
      break;
    }
    if (turn.errorEvidence) {
      const external = externalPrerequisite(turn.errorEvidence);
      terminalError = external ? externalError(turn.errorEvidence) : "command_code_cli_failed";
      failureEvidence = { ...turn.errorEvidence, externalPrerequisite: external, commandCodeVersion };
      break;
    }
    if (turn.protocolError) {
      terminalError = turn.protocolError;
      failureEvidence = {
        statusCode: null,
        errorType: turn.protocolError,
        message: null,
        exitStatus: turn.status,
        modelId: COMMAND_CODE_WORKER_MODEL_ID,
        externalPrerequisite: false,
        commandCodeVersion,
      };
      break;
    }
    if (turn.status !== 0) {
      terminalError = "command_code_cli_failed";
      failureEvidence = {
        statusCode: null,
        errorType: null,
        message: null,
        exitStatus: turn.status,
        modelId: COMMAND_CODE_WORKER_MODEL_ID,
        externalPrerequisite: false,
        commandCodeVersion,
      };
      break;
    }
    const message = parseWorkerMessage(turn.text);
    if (message.type === "malformed") {
      terminalError = "malformed_worker_output";
      failureEvidence = {
        statusCode: null,
        errorType: "malformed_worker_output",
        message: null,
        exitStatus: turn.status,
        modelId: COMMAND_CODE_WORKER_MODEL_ID,
        externalPrerequisite: false,
        commandCodeVersion,
      };
      break;
    }
    if (message.type === "complete") {
      summary = message.summary;
      break;
    }
    let tool;
    try {
      tool = await executeWorkerTool({
        profile: taskProfile,
        projectId: parsed.value.projectId,
        workspaceId,
        call: message.call,
        dispatchers: input.dispatchers,
        inspectionBase: remainingInspectionDeadlines(input.inspectionBase, input.nowMs(), sessionDeadlineAtMs),
        workspaceBase: remainingWorkspaceDeadlines(input.workspaceBase, input.nowMs(), sessionDeadlineAtMs),
      });
    } catch {
      terminalError = "host_tool_dispatch_failed";
      break;
    }
    if (!tool.ok) {
      steps.push({
        operation: message.call.operation,
        license: { state: "none", profile: "command_code_tool_bridge", error: tool.error, executionTruth: "no_effect_proven" },
      });
      history += `\nstep ${step + 1} ${message.call.operation} error ${tool.error}`;
      continue;
    }
    if (tool.inspection) {
      steps.push({ operation: message.call.operation, license: tool.inspection.license, observation: tool.inspection.observation });
      history = appendToolHistory(history, {
        step: step + 1,
        operation: message.call.operation,
        license: tool.inspection.license,
        observation: tool.inspection.observation,
      });
    } else if (tool.workspace) {
      steps.push({ operation: message.call.operation, license: tool.workspace.license, observation: tool.workspace.observation });
      history = appendToolHistory(history, {
        step: step + 1,
        operation: message.call.operation,
        license: tool.workspace.license,
        observation: tool.workspace.observation,
      });
    }
  }

  if (!terminalError && summary === null) terminalError = "worker_step_limit";
  const childFailed = steps.some((step) => step.license.state === "failed");
  const anyChild = steps.length > 0;
  const lastWorkspace = [...steps].reverse().find((step) => step.license.workspaceClaimEffect);
  const lastObservation = [...steps].reverse().find((step) => step.observation);
  const state: OperationalClaimLicense["state"] = terminalError
    ? (anyChild ? "failed" : "none")
    : childFailed ? "failed" : "succeeded";
  const license: OperationalClaimLicense = {
    state,
    profile: "command_code_mode_b",
    ...(terminalError ? { error: terminalError } : {}),
    executionTruth: anyChild
      ? (state === "succeeded" ? "effect_verified" : "effect_indeterminate")
      : "no_effect_proven",
    ...(lastWorkspace?.license.workspaceClaimEffect
      ? { workspaceClaimEffect: lastWorkspace.license.workspaceClaimEffect }
      : {}),
  };
  const safeFailureEvidence = terminalError
    ? {
      failureClass: terminalError,
      statusCode: failureEvidence?.statusCode ?? null,
      errorType: failureEvidence?.errorType ?? terminalError,
      message: failureEvidence?.message ?? null,
      exitStatus: failureEvidence?.exitStatus ?? null,
      modelId: failureEvidence?.modelId ?? selectedModelId ?? COMMAND_CODE_WORKER_MODEL_ID,
      externalPrerequisite: failureEvidence?.externalPrerequisite ?? false,
      commandCodeVersion: failureEvidence?.commandCodeVersion ?? commandCodeVersion,
    }
    : null;
  return {
    license,
    selectedModelId,
    quotaClass: null,
    steps,
    summary,
    payload: {
      operation: input.kind,
      projectId: parsed.value.projectId,
      selectedModelId,
      summary,
      steps: steps.map((step) => ({
        operation: step.operation,
        state: step.license.state,
        error: step.license.error ?? null,
        observation: step.observation ?? null,
      })),
      lastObservation: lastObservation?.observation ?? null,
      ...(safeFailureEvidence ? { failureEvidence: safeFailureEvidence } : {}),
    },
  };
}

export {
  DETACHED_WORKER_MAX_WALL_CLOCK_MS,
  MODE_B_DEVELOP,
  MODE_B_INVESTIGATE,
  WORKER_FINALIZATION_RESERVE_MS,
  WORKER_MODEL_TURN_MAX_MS,
};
