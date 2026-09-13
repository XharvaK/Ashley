/**
 * Ashley Sandbox V2 M1 — host launcher for the single exported operation
 * `file.roundtrip`.
 *
 * Shape (locked): host launcher -> real /usr/bin/bwrap (frozen fail-closed
 * profile) -> fixed inline node runner -> disposable mkdtemp workspace ->
 * stdin JSON request -> raw evidence on stdout -> host validation ->
 * canonical SandboxM1Result -> workspace cleanup.
 *
 * Host-only evidence (loopback positive control + host listener hit count)
 * is supplied by the caller and combined here: the launcher owns the final
 * loopbackIsolated verdict (LOOPBACK_FINAL_VERDICT_OWNER=host_launcher).
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SANDBOX_M1_RUNNER_SOURCE } from "./sandbox-m1-runner.js";

export type SandboxM1Request = {
  version: 1;
  kind: "file.roundtrip";
  content: string;
  probePort: number;
  sentinelPath: string;
  fdSentinelCanonical: string;
};

export type SandboxM1HostEvidence = {
  loopbackPositiveControlSucceeded: boolean;
  hostLoopbackSandboxHits: () => number;
};

export type SandboxM1Checks = {
  roundtrip: boolean;
  deleted: boolean;
  absent: boolean;
  homeAbsent: boolean;
  runAbsent: boolean;
  hostSentinelAbsent: boolean;
  envClean: boolean;
  loopbackIsolated: boolean;
  externalIsolated: boolean;
  fdClean: boolean;
};

export type SandboxM1Result =
  (
    | { version: 1; kind: "file.roundtrip"; ok: true; checks: SandboxM1Checks }
    | { version: 1; kind: "file.roundtrip"; ok: false; code: string }
  ) & {
    cancellationRequested?: boolean;
    cancellationAcknowledged?: boolean;
  };

const CHECK_KEYS = [
  "roundtrip",
  "deleted",
  "absent",
  "homeAbsent",
  "runAbsent",
  "hostSentinelAbsent",
  "envClean",
  "loopbackIsolated",
  "externalIsolated",
  "fdClean",
] as const;

/** Fail-closed result guard: every named check key must be present and true. */
export function isCompleteSuccessResult(
  value: unknown,
): value is Extract<SandboxM1Result, { ok: true }> {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.version !== 1 || r.kind !== "file.roundtrip" || r.ok !== true) return false;
  const checks = r.checks as Record<string, unknown> | undefined;
  if (typeof checks !== "object" || checks === null) return false;
  return CHECK_KEYS.every((key) => checks[key] === true);
}

type SandboxM1RunnerEvidence = {
  version: 1;
  kind: "file.roundtrip";
  ok: true;
  checks: {
    roundtrip: boolean;
    deleted: boolean;
    absent: boolean;
    homeAbsent: boolean;
    runAbsent: boolean;
    hostSentinelAbsent: boolean;
    envClean: boolean;
    fdClean: boolean;
  };
  loopbackConnectSucceeded: boolean;
  loopbackError: string;
  externalIsolated: boolean;
  externalError: string;
};

const RUNNER_CHECK_KEYS = [
  "roundtrip",
  "deleted",
  "absent",
  "homeAbsent",
  "runAbsent",
  "hostSentinelAbsent",
  "envClean",
  "fdClean",
] as const;

function isRunnerEvidence(value: unknown): value is SandboxM1RunnerEvidence {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.version !== 1 || r.kind !== "file.roundtrip" || r.ok !== true) return false;
  if (typeof r.loopbackConnectSucceeded !== "boolean") return false;
  if (typeof r.loopbackError !== "string") return false;
  if (r.externalIsolated !== true) return false;
  if (typeof r.externalError !== "string") return false;
  const checks = r.checks as Record<string, unknown> | undefined;
  if (typeof checks !== "object" || checks === null) return false;
  return RUNNER_CHECK_KEYS.every((key) => checks[key] === true);
}

// Frozen M0-resolved host facts (do not broaden filesystem exposure).
const BWRAP = "/usr/bin/bwrap";
const NODE_BIN = "/opt/node/bin/node";
const NVM_NODE_PREFIX = "/home/xarvak/.nvm/versions/node/v22.23.2";
const WORKSPACE_MOUNT = "/workspace";
const PATH_VALUE = "/usr/bin";
const HOME_VALUE = "/tmp";
const REQUEST_MAX_BYTES = 4096;
const STDOUT_MAX_BYTES = 64 * 1024;
const STDERR_MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 30_000;

export type SandboxM1ExecutionOptions = {
  /** Child cap supplied by the owning phase plan. It can only reduce the frozen 30s cap. */
  timeoutMs?: number;
  /** Absolute cutoff for awaiting child termination acknowledgement. */
  childTerminationDeadlineAtMs?: number;
  /** Absolute settlement cutoff owned by the selected turn branch. */
  settlementDeadlineAtMs?: number;
  clock?: { nowMs(): number };
  /** Deterministic test seam for the fixed Bubblewrap child. */
  spawnChild?: typeof spawn;
  /** Deterministic test seam for the disposable workspace. */
  workspaceFactory?: (prefix: string) => Promise<string>;
};

type CloseWaitChild = {
  kill(signal: NodeJS.Signals): boolean;
  stdin: { destroy(): void };
  stdout: { destroy(): void };
  stderr: { destroy(): void };
  once(event: "close", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off(event: "close", listener: (code: number | null) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
};

function awaitChildCloseByDeadline(
  child: CloseWaitChild,
  childTerminationDeadlineAtMs: number,
  nowMs: () => number,
): Promise<{ closed: boolean; exitCode: number | null }> {
  const remainingMs = childTerminationDeadlineAtMs - nowMs();
  const terminate = (): void => {
    child.kill("SIGKILL");
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  };
  if (remainingMs <= 0) {
    terminate();
    return Promise.resolve({ closed: false, exitCode: null });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean, exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      child.off("error", onError);
      resolve({ closed, exitCode });
    };
    const onClose = (code: number | null): void => finish(true, code);
    const onError = (): void => terminate();
    child.once("close", onClose);
    child.once("error", onError);
    const timer = setTimeout(() => {
      terminate();
      finish(false, null);
    }, remainingMs);
  });
}

function buildBwrapArgs(workspace: string): string[] {
  return [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-net",
    "--unshare-ipc",
    "--unshare-uts",
    "--ro-bind", "/usr", "/usr",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64",
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/sbin", "/sbin",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--bind", workspace, WORKSPACE_MOUNT,
    "--clearenv",
    "--setenv", "PATH", PATH_VALUE,
    "--setenv", "HOME", HOME_VALUE,
    "--chdir", WORKSPACE_MOUNT,
    "--die-with-parent",
    "--new-session",
    "--ro-bind", NVM_NODE_PREFIX, "/opt/node",
    NODE_BIN, "-e", SANDBOX_M1_RUNNER_SOURCE,
  ];
}

function failure(
  code: string,
  cancellation?: {
    cancellationRequested: boolean;
    cancellationAcknowledged: boolean;
  },
): SandboxM1Result {
  return { version: 1, kind: "file.roundtrip", ok: false, code, ...cancellation };
}

function isValidRequest(request: SandboxM1Request): boolean {
  return (
    request.version === 1 &&
    request.kind === "file.roundtrip" &&
    typeof request.content === "string" &&
    typeof request.probePort === "number" &&
    Number.isInteger(request.probePort) &&
    request.probePort > 0 &&
    typeof request.sentinelPath === "string" &&
    typeof request.fdSentinelCanonical === "string"
  );
}

function parseSingleJson(output: string): unknown | null {
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function removeBoundedM1Workspace(workspace: string): boolean {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    return false;
  }
  return !existsSync(workspace);
}

/**
 * Run the file.roundtrip vertical slice. Returns the canonical result.
 * Workspace cleanup runs in finally{} (launcher-process SIGKILL/OOM cleanup
 * is explicitly not guaranteed in M1).
 */
export async function runSandboxM1(
  request: SandboxM1Request,
  hostEvidence: SandboxM1HostEvidence,
  options: SandboxM1ExecutionOptions = {},
): Promise<SandboxM1Result> {
  const nowMs = (): number => options.clock?.nowMs() ?? Date.now();
  let workspace: string | undefined;
  try {
    if (!isValidRequest(request)) return failure("bad-request");

    workspace = await (options.workspaceFactory ?? mkdtemp)(join(tmpdir(), "ashley-m1-"));

    const child = (options.spawnChild ?? spawn)(BWRAP, buildBwrapArgs(workspace), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdin || !stdout || !stderr) return failure("spawn-error");
    stdin.on("error", () => {});
    stdout.on("error", () => {});
    stderr.on("error", () => {});

    const terminateChild = (): void => {
      child.kill("SIGKILL");
      stdin.destroy();
      stdout.destroy();
      stderr.destroy();
    };

    let stdoutData = "";
    let stderrData = "";
    let stdoutOverflow = false;
    let stderrOverflow = false;
    stdout.on("data", (chunk: Buffer) => {
      if (stdoutOverflow) return;
      if (stdoutData.length + chunk.length > STDOUT_MAX_BYTES) {
        stdoutOverflow = true;
        terminateChild();
        return;
      }
      stdoutData += chunk.toString("utf8");
    });
    stderr.on("data", (chunk: Buffer) => {
      if (stderrOverflow) return;
      if (stderrData.length + chunk.length > STDERR_MAX_BYTES) {
        stderrOverflow = true;
        terminateChild();
        return;
      }
      stderrData += chunk.toString("utf8");
    });

    const requestJson = JSON.stringify(request);
    if (Buffer.byteLength(requestJson, "utf8") > REQUEST_MAX_BYTES) {
      terminateChild();
      return failure("bad-request");
    }
    stdin.write(requestJson);
    stdin.end();

    let timedOut = false;
    const suppliedTimeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    if (!Number.isFinite(suppliedTimeoutMs) || suppliedTimeoutMs <= 0) {
      terminateChild();
      return failure("timeout");
    }
    const effectiveTimeoutMs = Math.min(TIMEOUT_MS, suppliedTimeoutMs);
    const settlementDeadlineAtMs =
      options.settlementDeadlineAtMs ?? nowMs() + effectiveTimeoutMs;
    const childTerminationDeadlineAtMs =
      options.childTerminationDeadlineAtMs ?? settlementDeadlineAtMs;
    if (
      options.childTerminationDeadlineAtMs !== undefined &&
      childTerminationDeadlineAtMs >= settlementDeadlineAtMs
    ) {
      terminateChild();
      return failure("invalid-deadline-plan");
    }
    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, effectiveTimeoutMs);

    let closeResult: { closed: boolean; exitCode: number | null };
    try {
      closeResult = await awaitChildCloseByDeadline(
        child,
        childTerminationDeadlineAtMs,
        nowMs,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!closeResult.closed) timedOut = true;

    if (timedOut) {
      return failure("timeout", {
        cancellationRequested: true,
        cancellationAcknowledged: closeResult.closed,
      });
    }
    if (stdoutOverflow) return failure("stdout-overflow");
    if (stderrOverflow) return failure("stderr-overflow");

    const parsed = parseSingleJson(stdoutData);
    if (parsed === null) {
      return failure(closeResult.exitCode === 0 ? "malformed-output" : "runner-error");
    }
    if (closeResult.exitCode !== 0) {
      const asRecord = parsed as Record<string, unknown>;
      return failure(typeof asRecord.code === "string" ? asRecord.code : "runner-error");
    }
    if (!isRunnerEvidence(parsed)) return failure("invalid-result");
    const runner = parsed;

    const loopbackIsolated =
      hostEvidence.loopbackPositiveControlSucceeded === true &&
      runner.loopbackConnectSucceeded === false &&
      hostEvidence.hostLoopbackSandboxHits() === 0;
    if (!loopbackIsolated) return failure("loopback-isolation-failed");

    const result: SandboxM1Result = {
      version: 1,
      kind: "file.roundtrip",
      ok: true,
      checks: {
        roundtrip: true,
        deleted: true,
        absent: true,
        homeAbsent: true,
        runAbsent: true,
        hostSentinelAbsent: true,
        envClean: true,
        loopbackIsolated: true,
        externalIsolated: true,
        fdClean: true,
      },
    };
    if (!isCompleteSuccessResult(result)) return failure("invalid-result");

    if (!removeBoundedM1Workspace(workspace)) return failure("cleanup-failed");
    return result;
  } catch {
    return failure("internal-error");
  } finally {
    if (workspace !== undefined) removeBoundedM1Workspace(workspace);
  }
}
