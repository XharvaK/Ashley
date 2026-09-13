/**
 * Sandbox V2 M4 candidate verification executor.
 *
 * Separate from the M3 writable workspace runner. The durable candidate is a
 * read-only source input. Recipe writes stay in an ephemeral projection that
 * is discarded. Catalog argv is execve'd directly (array, not shell).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V2_HOST_FACTS, V2_LIMITS } from "../limits.js";
import { awaitChildCloseByDeadline, terminateChild } from "../settlement-cleanup.js";
import type { V2ProjectReadRegistry } from "../registry.js";
import {
  WorkspaceManager,
  type AuthorizedProjectExecutionContext,
} from "../workspace/workspace-manager.js";
import {
  RecipeCatalog,
  createFirstSliceRecipeCatalog,
  sha256Hex,
  validateWorkspaceVerifyRequest,
  verifyRecipeIntegrity,
  type RecipeRecord,
} from "./recipe-catalog.js";
import {
  bindCandidateSnapshot,
  computeProvisionalCandidateTreeHash,
} from "./snapshot.js";
import {
  isWorkspaceVerifyResult,
  type SandboxV2OperationResult,
  type SandboxV2Result,
  type SandboxV2WorkspaceVerifyRequest,
  type VerificationOutcome,
  type VerificationProtocolState,
} from "../v2-types.js";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";

export const CANDIDATE_GUEST_PATH = "/candidate";
export const PROJECTION_GUEST_PATH = "/output";

export type VerificationSpawnInput = {
  candidateRoot: string;
  projectionRoot: string;
  executablePath: string;
  argv: readonly string[];
  cwdGuest: "/candidate" | "/output";
  unshareNet: true;
  writableBinds: readonly [typeof PROJECTION_GUEST_PATH];
  timeoutMs: number;
  childTerminationDeadlineAtMs: number;
  settlementDeadlineAtMs: number;
  nowMs: () => number;
};

export type VerificationSpawnOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutOverflow: boolean;
  stderrOverflow: boolean;
};

export type VerificationSpawn = (input: VerificationSpawnInput) => Promise<VerificationSpawnOutput>;

export type CandidateVerificationExecutorOptions = {
  registry: V2ProjectReadRegistry;
  protectedRoots?: ProtectedRootsConfig;
  available?: () => boolean;
  spawnVerification?: VerificationSpawn;
  workspaceManager?: WorkspaceManager;
  managedWorkspaceRoot?: string;
  recipeCatalog?: RecipeCatalog;
  timeoutMs?: number;
  childExecutionDeadlineAtMs?: number;
  childTerminationDeadlineAtMs?: number;
  settlementDeadlineAtMs?: number;
  clock?: { nowMs(): number };
};

export function isV2VerificationAvailable(): boolean {
  return process.platform === "linux" && existsSync(V2_HOST_FACTS.BWRAP);
}

export function buildVerificationBwrapArgs(input: {
  candidateRoot: string;
  projectionRoot: string;
  executablePath: string;
  argv: readonly string[];
  cwdGuest: "/candidate" | "/output";
}): string[] {
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
    "--ro-bind", input.candidateRoot, CANDIDATE_GUEST_PATH,
    "--bind", input.projectionRoot, PROJECTION_GUEST_PATH,
    "--ro-bind", V2_HOST_FACTS.NVM_NODE_PREFIX, "/opt/node",
    "--clearenv",
    "--setenv", "PATH", V2_HOST_FACTS.PATH_VALUE,
    "--setenv", "HOME", V2_HOST_FACTS.HOME_VALUE,
    "--chdir", input.cwdGuest,
    "--die-with-parent",
    "--new-session",
    input.executablePath,
    ...input.argv,
  ];
}

export async function spawnBubblewrapVerification(
  input: VerificationSpawnInput,
): Promise<VerificationSpawnOutput> {
  const args = buildVerificationBwrapArgs({
    candidateRoot: input.candidateRoot,
    projectionRoot: input.projectionRoot,
    executablePath: input.executablePath,
    argv: input.argv,
    cwdGuest: input.cwdGuest,
  });
  const child = spawn(V2_HOST_FACTS.BWRAP, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdin || !stdout || !stderr) {
    child.kill("SIGKILL");
    return {
      exitCode: null,
      stdout: "",
      stderr: "spawn-error",
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    };
  }
  stdin.on("error", () => {});
  stdout.on("error", () => {});
  stderr.on("error", () => {});
  stdin.end();

  let stdoutData = "";
  let stderrData = "";
  let stdoutOverflow = false;
  let stderrOverflow = false;
  stdout.on("data", (chunk: Buffer) => {
    if (stdoutOverflow) return;
    if (stdoutData.length + chunk.length > V2_LIMITS.STDOUT_MAX_BYTES) {
      stdoutOverflow = true;
      terminateChild(child);
      return;
    }
    stdoutData += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    if (stderrOverflow) return;
    if (stderrData.length + chunk.length > V2_LIMITS.STDERR_MAX_BYTES) {
      stderrOverflow = true;
      terminateChild(child);
      return;
    }
    stderrData += chunk.toString("utf8");
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateChild(child);
  }, input.timeoutMs);

  let closeResult: { closed: boolean; exitCode: number | null };
  try {
    closeResult = await awaitChildCloseByDeadline(child, {
      childTerminationDeadlineAtMs: input.childTerminationDeadlineAtMs,
      nowMs: input.nowMs,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!closeResult.closed) timedOut = true;

  return {
    exitCode: closeResult.exitCode,
    stdout: stdoutData,
    stderr: stderrData,
    timedOut,
    stdoutOverflow,
    stderrOverflow,
  };
}

function receiptOf(
  fields: Extract<SandboxV2OperationResult, { kind: "workspace.verify" }>,
): Extract<SandboxV2OperationResult, { kind: "workspace.verify" }> {
  if (!isWorkspaceVerifyResult(fields)) {
    throw new Error("m4_receipt_shape_invalid");
  }
  return fields;
}

export async function executeCandidateVerification(
  request: SandboxV2WorkspaceVerifyRequest | unknown,
  options: CandidateVerificationExecutorOptions,
): Promise<SandboxV2Result> {
  const nowMs = (): number => options.clock?.nowMs() ?? Date.now();
  const executedAtMs = nowMs();
  const failed = (
    error: string,
    extras: {
      verificationReceipt?: Extract<SandboxV2OperationResult, { kind: "workspace.verify" }>;
    } = {},
  ): SandboxV2Result => ({
    outcome: "failed",
    operation: "workspace.verify",
    error,
    executionTruth: "no_effect_proven",
    verificationReceipt: extras.verificationReceipt,
    executedAtMs: nowMs(),
  });

  const validated = validateWorkspaceVerifyRequest(request);
  if (!validated.ok) return failed(validated.error);

  const catalog = options.recipeCatalog ?? createFirstSliceRecipeCatalog();
  const resolved = catalog.resolve(validated.recipeId);
  if (!resolved.ok) return failed(resolved.error);
  const recipe: RecipeRecord = resolved.record;
  const integrity = verifyRecipeIntegrity(recipe);
  if (integrity) return failed(integrity);

  const resolution = options.registry.resolveReadRoot(validated.projectId);
  if (!resolution.ok) return failed(resolution.error);
  const entry = resolution.entry;

  const spawnVerification = options.spawnVerification ?? spawnBubblewrapVerification;
  const isCustomSpawn = options.spawnVerification !== undefined;
  const available = options.available ?? isV2VerificationAvailable;
  if (!isCustomSpawn && !available()) {
    return {
      outcome: "unavailable",
      operation: "workspace.verify",
      error: "sandbox_unavailable",
      executionTruth: "no_effect_proven",
      executedAtMs,
    };
  }
  if (!isCustomSpawn && !existsSync(recipe.executablePath)) {
    return failed("toolchain_unavailable");
  }

  const workspaceManager =
    options.workspaceManager ??
    new WorkspaceManager({ managedRoot: options.managedWorkspaceRoot });
  const context: AuthorizedProjectExecutionContext = {
    projectId: entry.projectId,
    canonicalRoot: entry.canonicalRoot,
    protectedRoots: options.protectedRoots,
  };
  const acquisition = workspaceManager.resumeExistingWorkspace(context, validated.workspaceId);
  if (!acquisition.ok) return failed(acquisition.error);

  const snapshot = bindCandidateSnapshot({
    workspaceId: acquisition.workspaceId,
    projectId: entry.projectId,
    sourceSnapshotId: acquisition.manifest.sourceSnapshotId,
    treeRoot: acquisition.workspaceTreeRoot,
  });

  const operationHardCapMs = Math.min(options.timeoutMs ?? V2_LIMITS.TIMEOUT_MS, recipe.timeoutMs);
  const remainingChildMs =
    options.childExecutionDeadlineAtMs === undefined
      ? operationHardCapMs
      : options.childExecutionDeadlineAtMs - nowMs();
  if (remainingChildMs <= 0) return failed("child_execution_deadline_expired");

  const projectionRoot = mkdtempSync(join(tmpdir(), "ashley-m4-proj-"));
  mkdirSync(projectionRoot, { recursive: true, mode: 0o700 });

  const spawnInput: VerificationSpawnInput = {
    candidateRoot: acquisition.workspaceTreeRoot,
    projectionRoot,
    executablePath: recipe.executablePath,
    argv: recipe.argv,
    cwdGuest: recipe.cwdPolicy,
    unshareNet: true,
    writableBinds: [PROJECTION_GUEST_PATH],
    timeoutMs: Math.min(operationHardCapMs, remainingChildMs),
    childTerminationDeadlineAtMs:
      options.childTerminationDeadlineAtMs ??
      options.settlementDeadlineAtMs ??
      nowMs() + Math.min(operationHardCapMs, remainingChildMs),
    settlementDeadlineAtMs:
      options.settlementDeadlineAtMs ?? nowMs() + Math.min(operationHardCapMs, remainingChildMs),
    nowMs,
  };

  let run: VerificationSpawnOutput;
  let protocolState: VerificationProtocolState = "admitted";
  let spawnError: string | undefined;
  try {
    run = await spawnVerification(spawnInput);
  } catch {
    run = {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    };
    protocolState = "sandbox_failure";
    spawnError = "sandbox_failure";
  }

  const candidateTreeHashAfter = computeProvisionalCandidateTreeHash(acquisition.workspaceTreeRoot);
  const candidateUnchanged = candidateTreeHashAfter === snapshot.candidateTreeHash;

  let cleanupCompleted = false;
  let projectionDiscarded = false;
  try {
    rmSync(projectionRoot, { recursive: true, force: true });
    cleanupCompleted = true;
    projectionDiscarded = !existsSync(projectionRoot);
  } catch {
    cleanupCompleted = false;
    projectionDiscarded = !existsSync(projectionRoot);
  }
  if (!cleanupCompleted || !projectionDiscarded) {
    protocolState = "cleanup_failure";
  } else if (!candidateUnchanged) {
    protocolState = "sandbox_failure";
    spawnError = "snapshot_mismatch";
  }

  let verificationOutcome: VerificationOutcome = "outcome_unknown";
  if (
    protocolState === "admitted" &&
    candidateUnchanged &&
    !run.timedOut &&
    !run.stdoutOverflow &&
    !run.stderrOverflow
  ) {
    verificationOutcome = run.exitCode === 0 ? "verified_success" : "verified_failure";
  }

  let receipt: Extract<SandboxV2OperationResult, { kind: "workspace.verify" }>;
  try {
    receipt = receiptOf({
      kind: "workspace.verify",
      snapshotId: snapshot.snapshotId,
      workspaceId: acquisition.workspaceId,
      projectId: entry.projectId,
      candidateTreeHash: snapshot.candidateTreeHash,
      candidateTreeHashAfter,
      sourceSnapshotId: acquisition.manifest.sourceSnapshotId,
      treeHashAlgorithm: snapshot.treeHashAlgorithm,
      recipeId: recipe.recipeId,
      recipeVersion: recipe.recipeVersion,
      recipeDefinitionHash: recipe.definitionHash,
      executableIdentity: recipe.executableIdentity,
      argvIdentity: recipe.argvIdentity,
      protocolState,
      verificationOutcome,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      stdoutTruncated: run.stdoutOverflow,
      stderrTruncated: run.stderrOverflow,
      stdoutSha256: sha256Hex(run.stdout),
      stderrSha256: sha256Hex(run.stderr),
      cleanupCompleted,
      projectionDiscarded,
      candidateUnchanged,
    });
  } catch {
    return failed("invalid-receipt");
  }

  if (protocolState !== "admitted") {
    return failed(spawnError ?? protocolState, { verificationReceipt: receipt });
  }

  return {
    outcome: "succeeded",
    operation: "workspace.verify",
    result: receipt,
    workspaceId: acquisition.workspaceId,
    sourceSnapshotId: acquisition.manifest.sourceSnapshotId,
    verificationReceipt: receipt,
    executedAtMs: nowMs(),
  };
}
