import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  compareCommandCodeVersions,
  isCommandCodeVersionCompatible,
  readCommandCodeQualificationState,
  resolveCommandCodeRuntime,
  type CommandCodeQualificationState,
  type CommandCodeRuntime,
} from "../sandbox/worker/command-code-worker.js";

export const COMMAND_CODE_PACKAGE_NAME = "command-code" as const;
export const COMMAND_CODE_REGISTRY_URL = "https://registry.npmjs.org/command-code/latest" as const;
export const COMMAND_CODE_LIFECYCLE_SCHEMA = "ashley.command_code.lifecycle.v1" as const;
export const COMMAND_CODE_QUALIFICATION_CONTRACT = "worker-v2-tool-plus-completion-v3" as const;

export type CommandCodeRegistryMetadata = Readonly<{
  name: typeof COMMAND_CODE_PACKAGE_NAME;
  version: string;
  distTarball: string;
  distIntegrity: string | null;
}>;

export type CommandCodeLifecycleState = Readonly<{
  schema: typeof COMMAND_CODE_LIFECYCLE_SCHEMA;
  packageName: typeof COMMAND_CODE_PACKAGE_NAME;
  currentVersion: string | null;
  currentRuntimeRoot: string | null;
  currentQualifiedAt: string | null;
  latestSeenVersion: string | null;
  latestSeenAt: string | null;
  lastUpdateAttempt: string | null;
  lastUpdateResult: string;
  previousKnownGoodVersion: string | null;
  rejectedVersion: string | null;
  rejectionContract: string | null;
  rejectionEvidence: string | null;
  registrySource: typeof COMMAND_CODE_REGISTRY_URL;
  latestDistIntegrity: string | null;
}>;

export type CommandCodeCandidate = Readonly<{
  version: string;
  runtimeRoot: string;
  binaryPath: string;
  nodePath: string;
  runtime: CommandCodeRuntime;
}>;

export type CommandCodeCandidateQualification = Readonly<{
  ok: boolean;
  reason?: string;
}>;

export type CommandCodeLifecycleResult = Readonly<{
  status: "unchanged" | "activated" | "retained" | "blocked" | "suppressed";
  currentVersion: string | null;
  latestVersion: string | null;
  candidateVersion?: string;
  reason?: string;
  state: CommandCodeLifecycleState;
}>;

export type CommandCodeLifecycleConfig = Readonly<{
  baseDir: string;
  activeRootPath: string;
  qualificationStatePath: string;
  lifecycleStatePath?: string;
  minimumVersion: string;
  enabled: boolean;
  apiKeyPresent: boolean;
  now?: () => number;
  fetchLatest?: () => Promise<unknown>;
  installCandidate?: (input: { version: string; baseDir: string }) => Promise<CommandCodeCandidate>;
  qualifyCandidate?: (candidate: CommandCodeCandidate) => Promise<CommandCodeCandidateQualification>;
  nodeExecutable?: string;
  npmExecutable?: string;
}>;

type MutableLifecycleState = {
  schema: typeof COMMAND_CODE_LIFECYCLE_SCHEMA;
  packageName: typeof COMMAND_CODE_PACKAGE_NAME;
  currentVersion: string | null;
  currentRuntimeRoot: string | null;
  currentQualifiedAt: string | null;
  latestSeenVersion: string | null;
  latestSeenAt: string | null;
  lastUpdateAttempt: string | null;
  lastUpdateResult: string;
  previousKnownGoodVersion: string | null;
  rejectedVersion: string | null;
  rejectionContract: string | null;
  rejectionEvidence: string | null;
  registrySource: typeof COMMAND_CODE_REGISTRY_URL;
  latestDistIntegrity: string | null;
};

function nowIso(now: () => number): string {
  return new Date(now()).toISOString();
}

function emptyState(): MutableLifecycleState {
  return {
    schema: COMMAND_CODE_LIFECYCLE_SCHEMA,
    packageName: COMMAND_CODE_PACKAGE_NAME,
    currentVersion: null,
    currentRuntimeRoot: null,
    currentQualifiedAt: null,
    latestSeenVersion: null,
    latestSeenAt: null,
    lastUpdateAttempt: null,
    lastUpdateResult: "never_attempted",
    previousKnownGoodVersion: null,
    rejectedVersion: null,
    rejectionContract: null,
    rejectionEvidence: null,
    registrySource: COMMAND_CODE_REGISTRY_URL,
    latestDistIntegrity: null,
  };
}

function parseState(value: unknown): MutableLifecycleState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Partial<MutableLifecycleState>;
  if (
    input.schema !== COMMAND_CODE_LIFECYCLE_SCHEMA
    || input.packageName !== COMMAND_CODE_PACKAGE_NAME
    || input.registrySource !== COMMAND_CODE_REGISTRY_URL
    || typeof input.lastUpdateResult !== "string"
  ) return null;
  return {
    ...emptyState(),
    ...input,
  } as MutableLifecycleState;
}

export function readCommandCodeLifecycleState(path: string): CommandCodeLifecycleState {
  try {
    const parsed = parseState(JSON.parse(readFileSync(path, "utf8")) as unknown);
    return parsed ?? emptyState();
  } catch {
    return emptyState();
  }
}

function writeJsonAtomic(path: string, value: unknown, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.next-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  renameSync(temporary, path);
}

export function writeCommandCodeQualificationState(
  path: string,
  version: string,
  now = Date.now,
): CommandCodeQualificationState {
  const state: CommandCodeQualificationState = {
    schema: "ashley.command_code.qualification.v1",
    activeVersion: version,
    qualifiedAt: new Date(now()).toISOString(),
    cliWitness: "passed",
    authenticationWitness: "passed",
    sandboxWitness: "passed",
    projectInspectionWitness: "passed",
  };
  writeJsonAtomic(path, state, 0o600);
  return state;
}

function validateVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  return compareCommandCodeVersions(version, "0.0.0") === null ? null : version;
}

export function parseCommandCodeRegistryMetadata(value: unknown): CommandCodeRegistryMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("command_code_registry_metadata_invalid");
  }
  const record = value as Record<string, unknown>;
  const version = validateVersion(record.version);
  const dist = typeof record.dist === "object" && record.dist !== null && !Array.isArray(record.dist)
    ? record.dist as Record<string, unknown>
    : null;
  const tarball = typeof dist?.tarball === "string" ? dist.tarball : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(tarball);
  } catch {
    throw new Error("command_code_registry_tarball_invalid");
  }
  if (
    record.name !== undefined && record.name !== COMMAND_CODE_PACKAGE_NAME
    || !version
    || parsedUrl.protocol !== "https:"
    || parsedUrl.hostname !== "registry.npmjs.org"
  ) throw new Error("command_code_registry_metadata_invalid");
  return {
    name: COMMAND_CODE_PACKAGE_NAME,
    version,
    distTarball: parsedUrl.toString(),
    distIntegrity: typeof dist?.integrity === "string" ? dist.integrity : null,
  };
}

async function fetchRegistryMetadata(): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(COMMAND_CODE_REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`command_code_registry_http_${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function runProcess(
  executable: string,
  args: readonly string[],
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: process.env.HOME ?? "/tmp",
        CI: "1",
        npm_config_registry: "https://registry.npmjs.org/",
        npm_config_audit: "false",
        npm_config_fund: "false",
      },
    });
    let output = "";
    const capture = (chunk: Buffer): void => {
      if (output.length < 4096) output += chunk.toString("utf8").slice(0, 4096 - output.length);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", reject);
    child.once("close", (status) => resolvePromise({ status, output }));
  });
}

async function installCandidateFromNpm(input: {
  version: string;
  baseDir: string;
  nodeExecutable: string;
  npmExecutable: string;
}): Promise<CommandCodeCandidate> {
  const versionRoot = join(input.baseDir, "versions", `${input.version}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  mkdirSync(join(versionRoot, "bin"), { recursive: true, mode: 0o700 });
  const install = await runProcess(input.npmExecutable, [
    "install",
    "--prefix",
    versionRoot,
    `${COMMAND_CODE_PACKAGE_NAME}@${input.version}`,
    "--no-audit",
    "--no-fund",
  ]);
  if (install.status !== 0) throw new Error("command_code_npm_install_failed");
  const nodePath = join(versionRoot, "bin", "node");
  const binaryPath = join(versionRoot, "bin", "command-code");
  copyFileSync(realpathSync(input.nodeExecutable), nodePath);
  symlinkSync("../node_modules/command-code/dist/index.mjs", binaryPath, "file");
  const runtime = resolveCommandCodeRuntime(binaryPath, nodePath);
  if (!runtime || runtime.version !== input.version) throw new Error("command_code_candidate_runtime_invalid");
  return { version: input.version, runtimeRoot: versionRoot, binaryPath, nodePath, runtime };
}

function activeCandidate(config: CommandCodeLifecycleConfig): CommandCodeCandidate | null {
  const binaryPath = join(config.activeRootPath, "bin", "command-code");
  const nodePath = join(config.activeRootPath, "bin", "node");
  const runtime = resolveCommandCodeRuntime(binaryPath, nodePath);
  if (!runtime) return null;
  return {
    version: runtime.version,
    runtimeRoot: runtime.root,
    binaryPath,
    nodePath,
    runtime,
  };
}

function activateCandidate(config: CommandCodeLifecycleConfig, candidate: CommandCodeCandidate): void {
  mkdirSync(config.baseDir, { recursive: true, mode: 0o700 });
  const temporaryLink = join(config.baseDir, `.current-${process.pid}-${randomUUID()}`);
  const target = process.platform === "win32"
    ? resolve(candidate.runtimeRoot)
    : relative(config.baseDir, candidate.runtimeRoot);
  symlinkSync(target, temporaryLink, process.platform === "win32" ? "junction" : "dir");
  try {
    if (existsSync(config.activeRootPath) && !lstatSync(config.activeRootPath).isSymbolicLink()) {
      throw new Error("command_code_active_root_conflict");
    }
    renameSync(temporaryLink, config.activeRootPath);
  } catch (error) {
    try { renameSync(temporaryLink, `${temporaryLink}.abandoned`); } catch { /* preserve evidence */ }
    throw error;
  }
}

function stateWith(state: MutableLifecycleState, patch: Partial<MutableLifecycleState>): MutableLifecycleState {
  return { ...state, ...patch };
}

function persistState(config: CommandCodeLifecycleConfig, state: MutableLifecycleState): CommandCodeLifecycleState {
  writeJsonAtomic(
    config.lifecycleStatePath ?? join(dirname(config.qualificationStatePath), "command-code-lifecycle-state.json"),
    state,
    0o600,
  );
  return state;
}

export async function maintainCommandCode(config: CommandCodeLifecycleConfig): Promise<CommandCodeLifecycleResult> {
  const now = config.now ?? Date.now;
  const lifecycleStatePath = config.lifecycleStatePath ?? join(dirname(config.qualificationStatePath), "command-code-lifecycle-state.json");
  let state = readCommandCodeLifecycleState(lifecycleStatePath) as MutableLifecycleState;
  const active = activeCandidate(config);
  const activeQualification = active
    ? readCommandCodeQualificationState(config.qualificationStatePath, active.version)
    : null;
  if (
    active
    && (
      state.currentVersion !== active.version
      || (activeQualification !== null && state.previousKnownGoodVersion === null)
    )
  ) {
    state = stateWith(state, {
      currentVersion: active.version,
      currentRuntimeRoot: active.runtimeRoot,
      currentQualifiedAt: activeQualification?.qualifiedAt ?? null,
      previousKnownGoodVersion: state.previousKnownGoodVersion ?? activeQualification?.activeVersion ?? null,
    });
  }
  if (!config.enabled) {
    state = stateWith(state, { lastUpdateResult: "disabled" });
    const persisted = persistState(config, state);
    return { status: "retained", currentVersion: active?.version ?? null, latestVersion: null, reason: "update_disabled", state: persisted };
  }

  if (!config.apiKeyPresent) {
    state = stateWith(state, {
      lastUpdateResult: "credentials_missing",
      rejectionEvidence: "command_code_credentials_missing",
    });
    const persisted = persistState(config, state);
    return {
      status: active ? "retained" : "blocked",
      currentVersion: active?.version ?? null,
      latestVersion: null,
      reason: "command_code_credentials_missing",
      state: persisted,
    };
  }

  const attempt = nowIso(now);
  state = stateWith(state, { lastUpdateAttempt: attempt });
  let metadata: CommandCodeRegistryMetadata;
  try {
    const raw = await (config.fetchLatest ?? fetchRegistryMetadata)();
    metadata = parseCommandCodeRegistryMetadata(raw);
  } catch (error) {
    state = stateWith(state, { lastUpdateResult: "registry_failure", rejectionEvidence: error instanceof Error ? error.message : "registry_failure" });
    const persisted = persistState(config, state);
    return {
      status: active ? "retained" : "blocked",
      currentVersion: active?.version ?? null,
      latestVersion: null,
      reason: "latest_version_unavailable",
      state: persisted,
    };
  }

  state = stateWith(state, {
    latestSeenVersion: metadata.version,
    latestSeenAt: attempt,
    latestDistIntegrity: metadata.distIntegrity,
  });
  const currentVersion = active?.version ?? state.currentVersion;
  const currentQualification = activeQualification;
  if (
    currentVersion === metadata.version
    && active !== null
    && currentQualification !== null
    && isCommandCodeVersionCompatible(active.version, config.minimumVersion)
  ) {
    state = stateWith(state, { lastUpdateResult: "unchanged", currentVersion: active.version, currentRuntimeRoot: active.runtimeRoot, currentQualifiedAt: currentQualification.qualifiedAt });
    const persisted = persistState(config, state);
    return { status: "unchanged", currentVersion: active.version, latestVersion: metadata.version, state: persisted };
  }
  if (!isCommandCodeVersionCompatible(metadata.version, config.minimumVersion)) {
    state = stateWith(state, { lastUpdateResult: "latest_incompatible", rejectedVersion: metadata.version, rejectionContract: COMMAND_CODE_QUALIFICATION_CONTRACT, rejectionEvidence: "below_minimum_supported_version" });
    const persisted = persistState(config, state);
    return { status: active ? "retained" : "blocked", currentVersion: currentVersion ?? null, latestVersion: metadata.version, reason: "latest_below_minimum_supported_version", state: persisted };
  }
  if (state.rejectedVersion === metadata.version && state.rejectionContract === COMMAND_CODE_QUALIFICATION_CONTRACT) {
    state = stateWith(state, { lastUpdateResult: "rejected_version_suppressed" });
    const persisted = persistState(config, state);
    return { status: "suppressed", currentVersion: currentVersion ?? null, latestVersion: metadata.version, reason: "rejected_version_suppressed", state: persisted };
  }

  let candidate: CommandCodeCandidate;
  try {
    candidate = await (config.installCandidate ?? ((input) => installCandidateFromNpm({
      ...input,
      nodeExecutable: config.nodeExecutable ?? process.execPath,
      npmExecutable: config.npmExecutable ?? "npm",
    })))( { version: metadata.version, baseDir: config.baseDir } );
  } catch (error) {
    state = stateWith(state, { lastUpdateResult: "stage_failure", rejectedVersion: metadata.version, rejectionContract: COMMAND_CODE_QUALIFICATION_CONTRACT, rejectionEvidence: error instanceof Error ? error.message : "stage_failure" });
    const persisted = persistState(config, state);
    return { status: active ? "retained" : "blocked", currentVersion: currentVersion ?? null, latestVersion: metadata.version, reason: "candidate_stage_failed", state: persisted };
  }

  let qualification: CommandCodeCandidateQualification;
  try {
    qualification = await (config.qualifyCandidate ?? (async () => ({ ok: false, reason: "qualification_not_configured" })))(candidate);
  } catch {
    qualification = { ok: false, reason: "candidate_qualification_exception" };
  }
  if (!qualification.ok) {
    state = stateWith(state, {
      lastUpdateResult: "qualification_failure",
      rejectedVersion: metadata.version,
      rejectionContract: COMMAND_CODE_QUALIFICATION_CONTRACT,
      rejectionEvidence: qualification.reason ?? "candidate_qualification_failed",
    });
    const persisted = persistState(config, state);
    return { status: active ? "retained" : "blocked", currentVersion: currentVersion ?? null, latestVersion: metadata.version, candidateVersion: candidate.version, reason: qualification.reason ?? "candidate_qualification_failed", state: persisted };
  }

  try {
    activateCandidate(config, candidate);
  } catch {
    state = stateWith(state, {
      lastUpdateResult: "activation_failure",
      rejectedVersion: metadata.version,
      rejectionContract: COMMAND_CODE_QUALIFICATION_CONTRACT,
      rejectionEvidence: "candidate_activation_failed",
    });
    const persisted = persistState(config, state);
    return {
      status: active ? "retained" : "blocked",
      currentVersion: currentVersion ?? null,
      latestVersion: metadata.version,
      candidateVersion: candidate.version,
      reason: "candidate_activation_failed",
      state: persisted,
    };
  }
  state = stateWith(state, {
    currentVersion: candidate.version,
    currentRuntimeRoot: candidate.runtimeRoot,
    currentQualifiedAt: readCommandCodeQualificationState(config.qualificationStatePath, candidate.version)?.qualifiedAt ?? null,
    previousKnownGoodVersion: currentVersion,
    rejectedVersion: null,
    rejectionContract: null,
    rejectionEvidence: null,
    lastUpdateResult: "activated",
  });
  const persisted = persistState(config, state);
  return { status: "activated", currentVersion: candidate.version, latestVersion: metadata.version, candidateVersion: candidate.version, state: persisted };
}
