import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMAND_CODE_REGISTRY_URL,
  COMMAND_CODE_QUALIFICATION_CONTRACT,
  maintainCommandCode,
  parseCommandCodeRegistryMetadata,
  readCommandCodeLifecycleState,
  writeCommandCodeQualificationState,
  type CommandCodeCandidate,
} from "./lifecycle.js";

function config(root: string) {
  return {
    baseDir: join(root, "command-code"),
    activeRootPath: join(root, "command-code", "current"),
    qualificationStatePath: join(root, "command-code-state.json"),
    lifecycleStatePath: join(root, "command-code-lifecycle-state.json"),
    minimumVersion: "1.64.0",
    enabled: true,
    apiKeyPresent: true,
    now: () => Date.parse("2026-09-28T06:00:00.000Z"),
  } as const;
}

function createCandidate(root: string, version: string): CommandCodeCandidate {
  const runtimeRoot = join(root, `candidate-${version}`);
  const binRoot = join(runtimeRoot, "bin");
  mkdirSync(binRoot, { recursive: true });
  const nodePath = join(binRoot, "node");
  const binaryPath = join(binRoot, "command-code");
  writeFileSync(nodePath, "node", "utf8");
  writeFileSync(binaryPath, "cli", "utf8");
  writeFileSync(join(binRoot, "package.json"), JSON.stringify({ name: "command-code", version }), "utf8");
  return {
    version,
    runtimeRoot,
    binaryPath,
    nodePath,
    runtime: { root: runtimeRoot, node: nodePath, script: binaryPath, version },
  };
}

function createActiveRuntime(paths: ReturnType<typeof config>, version: string): void {
  mkdirSync(join(paths.activeRootPath, "bin"), { recursive: true });
  writeFileSync(join(paths.activeRootPath, "bin", "node"), "node", "utf8");
  writeFileSync(join(paths.activeRootPath, "bin", "command-code"), "cli", "utf8");
  writeFileSync(join(paths.activeRootPath, "bin", "package.json"), JSON.stringify({ name: "command-code", version }), "utf8");
}

describe("Command Code lifecycle contract", () => {
  it("accepts the canonical registry shape and rejects an untrusted tarball", () => {
    expect(parseCommandCodeRegistryMetadata({
      name: "command-code",
      version: "1.66.0",
      dist: {
        tarball: "https://registry.npmjs.org/command-code/-/command-code-1.66.0.tgz",
        integrity: "sha512-example",
      },
    })).toMatchObject({
      name: "command-code",
      version: "1.66.0",
      distIntegrity: "sha512-example",
    });
    expect(() => parseCommandCodeRegistryMetadata({
      name: "command-code",
      version: "1.66.0",
      dist: { tarball: "https://example.invalid/command-code.tgz" },
    })).toThrow("command_code_registry_metadata_invalid");
  });

  it("retains the current version when registry discovery fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-command-code-lifecycle-"));
    const paths = config(root);
    const packageDir = join(paths.activeRootPath, "bin");
    mkdirSync(join(paths.activeRootPath, "bin"), { recursive: true });
    writeFileSync(join(paths.activeRootPath, "bin", "node"), "node", "utf8");
    writeFileSync(join(paths.activeRootPath, "bin", "command-code"), "cli", "utf8");
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "command-code", version: "1.66.0" }), "utf8");
    writeFileSync(paths.lifecycleStatePath, JSON.stringify({
      schema: "ashley.command_code.lifecycle.v1",
      packageName: "command-code",
      currentVersion: "1.66.0",
      currentRuntimeRoot: "/safe/runtime",
      currentQualifiedAt: "2026-09-28T05:00:00.000Z",
      latestSeenVersion: "1.66.0",
      latestSeenAt: "2026-09-28T05:00:00.000Z",
      lastUpdateAttempt: null,
      lastUpdateResult: "activated",
      previousKnownGoodVersion: null,
      rejectedVersion: null,
      rejectionEvidence: null,
      registrySource: COMMAND_CODE_REGISTRY_URL,
      latestDistIntegrity: "sha512-example",
    }), "utf8");
    const result = await maintainCommandCode({
      ...paths,
      fetchLatest: async () => { throw new Error("network_unavailable"); },
    });
    expect(result.status).toBe("retained");
    expect(result.currentVersion).toBe("1.66.0");
    expect(readCommandCodeLifecycleState(paths.lifecycleStatePath).lastUpdateResult).toBe("registry_failure");
  });

  it("does not stage an update when the qualified current version is latest", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-command-code-lifecycle-"));
    const paths = config(root);
    createActiveRuntime(paths, "1.66.0");
    writeCommandCodeQualificationState(paths.qualificationStatePath, "1.66.0");
    let installs = 0;
    const result = await maintainCommandCode({
      ...paths,
      fetchLatest: async () => ({
        name: "command-code",
        version: "1.66.0",
        dist: { tarball: "https://registry.npmjs.org/command-code/-/command-code-1.66.0.tgz" },
      }),
      installCandidate: async () => {
        installs += 1;
        throw new Error("must_not_install_current_version");
      },
    });
    expect(result.status).toBe("unchanged");
    expect(result.currentVersion).toBe("1.66.0");
    expect(installs).toBe(0);
  });

  it("installs and activates the latest version on a fresh host only after qualification", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-command-code-lifecycle-"));
    const paths = config(root);
    let qualified = 0;
    const result = await maintainCommandCode({
      ...paths,
      fetchLatest: async () => ({
        name: "command-code",
        version: "1.66.0",
        dist: { tarball: "https://registry.npmjs.org/command-code/-/command-code-1.66.0.tgz" },
      }),
      installCandidate: async () => createCandidate(join(paths.baseDir, "versions"), "1.66.0"),
      qualifyCandidate: async (candidate) => {
        qualified += 1;
        writeCommandCodeQualificationState(paths.qualificationStatePath, candidate.version);
        return { ok: true };
      },
    });
    expect(result.status).toBe("activated");
    expect(result.currentVersion).toBe("1.66.0");
    expect(result.state.lastUpdateResult).toBe("activated");
    expect(qualified).toBe(1);
  });

  it.skipIf(process.platform === "win32")("installs a candidate without running upstream install scripts", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-command-code-lifecycle-"));
    const paths = config(root);
    const argsPath = join(root, "npm-args.txt");
    const fakeNpm = join(root, "fake-npm.sh");
    writeFileSync(fakeNpm, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsPath}'\nexit 1\n`, { mode: 0o755 });
    const result = await maintainCommandCode({
      ...paths,
      npmExecutable: fakeNpm,
      fetchLatest: async () => ({
        name: "command-code",
        version: "1.66.0",
        dist: { tarball: "https://registry.npmjs.org/command-code/-/command-code-1.66.0.tgz" },
      }),
    });
    expect(result.reason).toBe("candidate_stage_failed");
    const args = readFileSync(argsPath, "utf8").trim().split("\n");
    expect(args).toContain("--ignore-scripts");
    expect(args).toContain("command-code@1.66.0");
  });

  it("retains the previous known-good runtime when candidate qualification fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-command-code-lifecycle-"));
    const paths = config(root);
    createActiveRuntime(paths, "1.65.0");
    writeCommandCodeQualificationState(paths.qualificationStatePath, "1.65.0");
    const result = await maintainCommandCode({
      ...paths,
      fetchLatest: async () => ({
        name: "command-code",
        version: "1.66.0",
        dist: { tarball: "https://registry.npmjs.org/command-code/-/command-code-1.66.0.tgz" },
      }),
      installCandidate: async () => createCandidate(join(paths.baseDir, "versions"), "1.66.0"),
      qualifyCandidate: async () => ({ ok: false, reason: "worker_qualification_failed" }),
    });
    expect(result.status).toBe("retained");
    expect(result.currentVersion).toBe("1.65.0");
    expect(result.state.previousKnownGoodVersion).toBe("1.65.0");
    expect(result.state.rejectedVersion).toBe("1.66.0");
    expect(result.state.rejectionEvidence).toBe("worker_qualification_failed");
  });

  it("suppresses a previously rejected version instead of reinstalling it", async () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-command-code-lifecycle-"));
    const paths = config(root);
    writeFileSync(paths.lifecycleStatePath, JSON.stringify({
      schema: "ashley.command_code.lifecycle.v1",
      packageName: "command-code",
      currentVersion: null,
      currentRuntimeRoot: null,
      currentQualifiedAt: null,
      latestSeenVersion: "1.66.0",
      latestSeenAt: "2026-09-28T05:00:00.000Z",
      lastUpdateAttempt: null,
      lastUpdateResult: "qualification_failure",
      previousKnownGoodVersion: null,
      rejectedVersion: "1.66.0",
      rejectionContract: COMMAND_CODE_QUALIFICATION_CONTRACT,
      rejectionEvidence: "worker_qualification_failed",
      registrySource: COMMAND_CODE_REGISTRY_URL,
      latestDistIntegrity: "sha512-example",
    }), "utf8");
    let installs = 0;
    const result = await maintainCommandCode({
      ...paths,
      fetchLatest: async () => ({
        name: "command-code",
        version: "1.66.0",
        dist: { tarball: "https://registry.npmjs.org/command-code/-/command-code-1.66.0.tgz" },
      }),
      installCandidate: async () => {
        installs += 1;
        throw new Error("must_not_install_rejected_version");
      },
    });
    expect(result.status).toBe("suppressed");
    expect(result.currentVersion).toBeNull();
    expect(installs).toBe(0);
  });

  it("writes qualification evidence without credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-command-code-lifecycle-"));
    const path = join(root, "qualification.json");
    writeCommandCodeQualificationState(path, "1.66.0", () => Date.parse("2026-09-28T06:00:00.000Z"));
    const raw = readFileSync(path, "utf8");
    expect(raw).toContain("ashley.command_code.qualification.v1");
    expect(raw).not.toContain("COMMAND_CODE_API_KEY");
    expect(raw).not.toContain("secret");
  });
});
