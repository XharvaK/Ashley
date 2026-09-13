import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxV2Dispatcher, type SandboxV2Environment } from "./dispatch.js";
import { V2ProjectReadRegistry } from "./registry.js";
import { V2_SECRET_ENV_KEY } from "./limits.js";
import type { SandboxM1Result } from "@composer-assistant/sandbox-m1";

const CANONICAL_ROOT = "/srv/projects/composer-assistant";

const registry = new V2ProjectReadRegistry([
  {
    projectId: "composer-assistant",
    canonicalRoot: CANONICAL_ROOT,
    displayName: "Composer Assistant",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: false,
    engineeringAllowed: false,
  },
]);

const usedViews: string[] = [];

function viewBuilder(options: { canonicalRoot: string; protectedRoots: unknown }) {
  const viewRoot = mkdtempSync(join(tmpdir(), "ashley-v2-view-"));
  usedViews.push(viewRoot);
  mkdirSync(join(viewRoot, "src"), { recursive: true });
  copyFileSync(
    join(PROJECT_SOURCE, "src", "main.ts"),
    join(viewRoot, "src", "main.ts"),
  );
  return Promise.resolve({
    ok: true as const,
    viewRoot,
    counts: {
      files: 1,
      directories: 1,
      excluded: 0,
      bytes: 10,
      skippedSymlinks: 0,
      hardLinkedFiles: 0,
      specialFiles: 0,
      privilegedFiles: 0,
      caseCollisions: 0,
    },
  });
}

function inspectionRunner() {
  return async (input: { requestJson: string }) => {
    const request = JSON.parse(input.requestJson);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        version: 2,
        operation: request.operation,
        ok: true,
        result: {
          kind: request.operation,
          path: request.path ?? ".",
          entries:
            request.operation === "project.list_directory"
              ? [{ name: "main.ts", kind: "file", size: 12 }]
              : undefined,
          matches: request.operation === "project.search_text" ? [] : undefined,
          bytes: request.operation === "project.read_file" ? 12 : undefined,
          contentBase64: request.operation === "project.read_file" ? "Y29uc3QgeCA9IDE7Cg==" : undefined,
          sha256: request.operation === "project.read_file" ? "f".repeat(64) : undefined,
          truncated: false,
          filesScanned: 0,
        },
        checks: {
          envClean: true,
          homeAbsent: true,
          runAbsent: true,
          hostSentinelAbsent: true,
          fdClean: true,
          projectReadOnly: true,
          loopbackConnectSucceeded: false,
          externalIsolated: true,
          externalError: "ENETUNREACH",
        },
      }),
      stderr: "",
      timedOut: false,
      stdoutOverflow: false,
      stderrOverflow: false,
    };
  };
}

const completeM1: Extract<SandboxM1Result, { ok: true }> = {
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

function env(overrides: Partial<SandboxV2Environment> = {}): SandboxV2Environment {
  return {
    registry,
    spawnInspection: inspectionRunner(),
    roundtripExecutor: async () => completeM1,
    viewBuilder: viewBuilder,
    ...overrides,
  };
}

const PROJECT_SOURCE = mkdtempSync(join(tmpdir(), "ashley-v2-src-"));
mkdirSync(join(PROJECT_SOURCE, "src"), { recursive: true });
writeFileSync(join(PROJECT_SOURCE, "src", "main.ts"), "const x = 1;\n", "utf8");

afterEach(() => {
  for (const view of usedViews.splice(0)) {
    rmSync(view, { recursive: true, force: true });
  }
  delete process.env[V2_SECRET_ENV_KEY];
});

describe("SandboxV2Dispatcher", () => {
  it("routes project inspection operations to the inspection executor", async () => {
    const dispatcher = new SandboxV2Dispatcher({ env: env() });
    for (const operation of [
      "project.read_file",
      "project.list_directory",
      "project.search_text",
    ] as const) {
      const request =
        operation === "project.read_file" || operation === "project.list_directory"
          ? { version: 2, operation, projectId: "composer-assistant", path: "." }
          : { version: 2, operation, projectId: "composer-assistant", path: ".", pattern: "x" };
      const result = await dispatcher.dispatch(request);
      expect(result.outcome).toBe("succeeded");
      if (result.outcome === "succeeded") expect(result.operation).toBe(operation);
    }
    expect(usedViews.length).toBe(3);
  });

  it("routes file.roundtrip to the frozen M1 adapter", async () => {
    const dispatcher = new SandboxV2Dispatcher({ env: env() });
    const result = await dispatcher.dispatch({
      version: 2,
      operation: "file.roundtrip",
      content: "hello",
    });
    expect(result.outcome).toBe("succeeded");
    if (result.outcome === "succeeded" && result.result.kind === "file.roundtrip") {
      expect(result.result.contentHash).toHaveLength(64);
    }
  });

  it("fails closed for unknown operations", async () => {
    const dispatcher = new SandboxV2Dispatcher({ env: env() });
    const result = await dispatcher.dispatch({ version: 2, operation: "project.delete" });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("unknown_operation");
  });

  it("does not admit M6 composition or unadmitted M7 profiles as dispatcher effects", async () => {
    const dispatcher = new SandboxV2Dispatcher({ env: env() });
    const operate = await dispatcher.dispatch({ version: 2, operation: "objective.operate" });
    expect(operate.outcome).toBe("failed");
    if (operate.outcome === "failed") expect(operate.error).toBe("unknown_operation");
    const live = await dispatcher.dispatch({ version: 2, operation: "live_apply" });
    expect(live.outcome).toBe("failed");
    if (live.outcome === "failed") expect(live.error).toBe("m7_profile_forbidden");
    const gitCommit = await dispatcher.dispatch({ version: 2, operation: "git_commit" });
    expect(gitCommit.outcome).toBe("failed");
    if (gitCommit.outcome === "failed") expect(gitCommit.error).toBe("m7_profile_forbidden");
    const patch = await dispatcher.dispatch({ version: 2, operation: "patch_export" });
    expect(patch.outcome).toBe("failed");
    if (patch.outcome === "failed") expect(patch.error).toBe("missing_project");
  });

  it("fails closed for deferred git operations", async () => {
    const dispatcher = new SandboxV2Dispatcher({ env: env() });
    const result = await dispatcher.dispatch({
      version: 2,
      operation: "inspect_project_git_status",
      projectId: "composer-assistant",
    });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("unsupported_operation");
  });

  it("fails closed for malformed envelopes", async () => {
    const dispatcher = new SandboxV2Dispatcher({ env: env() });
    expect((await dispatcher.dispatch(null)).outcome).toBe("failed");
    expect((await dispatcher.dispatch({ version: 1 })).outcome).toBe("failed");
    expect((await dispatcher.dispatch("junk")).outcome).toBe("failed");
  });

  it("propagates project resolution failures from the registry", async () => {
    const dispatcher = new SandboxV2Dispatcher({ env: env() });
    const result = await dispatcher.dispatch({
      version: 2,
      operation: "project.read_file",
      projectId: "not-registered",
      path: "a.ts",
    });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") expect(result.error).toBe("unknown_project");
  });
});