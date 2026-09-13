/**
 * Process-level evaluation-fork / outbound guards.
 * A DB flag alone is insufficient — these must be checked centrally.
 */

let forkMode = false;
let outboundEnabled = true;
let writebackEnabled = true;
let forkTempDir: string | null = null;

export function enterEvalForkMode(tempDir: string): void {
  forkMode = true;
  outboundEnabled = false;
  writebackEnabled = false;
  forkTempDir = tempDir;
}

export function exitEvalForkMode(): void {
  forkMode = false;
  outboundEnabled = true;
  writebackEnabled = true;
  forkTempDir = null;
}

export function isEvalForkMode(): boolean {
  return forkMode;
}

export function assertOutboundAllowed(purpose: string): void {
  if (!outboundEnabled || forkMode) {
    throw new Error(`outbound_blocked:${purpose}`);
  }
  if (process.env.ASHLEY_PHASE0_OFFLINE === "true") {
    throw new Error(`offline_network_blocked:${purpose}`);
  }
}

export function assertWritebackAllowed(purpose: string): void {
  if (!writebackEnabled || forkMode) {
    throw new Error(`writeback_blocked:${purpose}`);
  }
}

export function assertPathInsideForkTemp(resolvedPath: string): void {
  if (!forkTempDir) throw new Error("fork_temp_missing");
  const normalized = resolvedPath.replace(/\\/g, "/").toLowerCase();
  const root = forkTempDir.replace(/\\/g, "/").toLowerCase();
  if (!normalized.startsWith(root.endsWith("/") ? root : `${root}/`) && normalized !== root) {
    throw new Error("fork_path_escape");
  }
}

export function getForkTempDir(): string | null {
  return forkTempDir;
}
