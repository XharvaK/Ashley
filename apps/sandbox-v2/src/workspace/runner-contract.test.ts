import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as nodeCrypto from "node:crypto";
import * as nodeFs from "node:fs";
import * as nodeVm from "node:vm";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { isWorkspaceReadFileResult } from "../v2-types.js";
import { SANDBOX_V2_WORKSPACE_RUNNER_SOURCE } from "./runner.js";

type RunnerOutput = {
  exitCode: number | null;
  result?: Record<string, unknown>;
  code?: string;
};

function runWorkspaceRunner(
  workspaceRoot: string,
  operation: string,
  fields: Record<string, unknown>,
): Promise<RunnerOutput> {
  const output: RunnerOutput = { exitCode: null };
  const stdin = new EventEmitter() as EventEmitter & {
    setEncoding(encoding: string): void;
    destroy(): void;
  };
  stdin.setEncoding = () => {};
  stdin.destroy = () => {};
  const workspacePath = workspaceRoot.replaceAll("\\", "/");
  const sentinelPath = workspacePath + "/absent-host-sentinel";
  const exitSignal = Object.assign(new Error("runner exit"), { runnerExit: true });
  const isolatedFs = new Proxy(nodeFs, {
    get(target, property) {
      if (property === "accessSync") {
        return (path: string, ...args: unknown[]) => {
          if (path === "/home" || path === "/run" || path === sentinelPath) {
            throw new Error("inaccessible");
          }
          return (target.accessSync as (...items: unknown[]) => unknown)(path, ...args);
        };
      }
      if (property === "writeFileSync") {
        return (path: string, ...args: unknown[]) => {
          if (path === "/usr/.v3-probe") throw new Error("read-only");
          return (target.writeFileSync as (...items: unknown[]) => unknown)(path, ...args);
        };
      }
      if (property === "readdirSync") {
        return (path: string, ...args: unknown[]) => path === "/proc/self/fd"
          ? []
          : (target.readdirSync as (...items: unknown[]) => unknown)(path, ...args);
      }
      if (property === "realpathSync") {
        return (path: string, ...args: unknown[]) =>
          (target.realpathSync as (...items: unknown[]) => string)(path, ...args).replaceAll("\\", "/");
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  class DeniedSocket extends EventEmitter {
    setTimeout(): this {
      return this;
    }
    connect(): this {
      queueMicrotask(() => this.emit("error", Object.assign(new Error("blocked"), { code: "ENETUNREACH" })));
      return this;
    }
    destroy(): this {
      return this;
    }
  }
  const processLike = {
    env: { HOME: "/tmp", PATH: "/usr/bin", PWD: workspacePath },
    stdin,
    stdout: { write: (value: string) => { (output as RunnerOutput & { stdout?: string }).stdout = ((output as RunnerOutput & { stdout?: string }).stdout ?? "") + value; } },
    stderr: { write: (_value: string) => {} },
    platform: "linux",
    pid: 12345,
    exit(code: number) {
      output.exitCode = code;
      throw exitSignal;
    },
  };
  const source = SANDBOX_V2_WORKSPACE_RUNNER_SOURCE
    .replace('var WORKSPACE = "/workspace";', "var WORKSPACE = " + JSON.stringify(workspacePath) + ";")
    .replace(
      'main().catch(function () { fail("internal-error"); });',
      'main().catch(function (error) { if (error && error.runnerExit) return; fail("internal-error"); });',
    );
  const context = {
    require: (name: string) => {
      if (name === "fs") return isolatedFs;
      if (name === "crypto") return nodeCrypto;
      if (name === "net") return { Socket: DeniedSocket };
      throw new Error("unexpected-module:" + name);
    },
    process: processLike,
    Buffer,
    TextDecoder,
    Date,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  };
  nodeVm.runInNewContext(source, context, { filename: "workspace-runner.js", timeout: 10_000 });
  stdin.emit("data", JSON.stringify({
    version: 2,
    operation,
    workspaceId: "workspace-1",
    probePort: 12345,
    sentinelPath,
    fdSentinelCanonical: sentinelPath,
    ...fields,
  }));
  stdin.emit("end");
  return new Promise((resolve) => {
    const check = () => {
      if (output.exitCode !== null) {
        const stdout = (output as RunnerOutput & { stdout?: string }).stdout ?? "";
        const firstLine = stdout.split("\n").find((line) => line.length > 0);
        if (firstLine) {
          const parsed = JSON.parse(firstLine) as Record<string, unknown>;
          if (parsed.ok === true && typeof parsed.result === "object" && parsed.result !== null) {
            output.result = parsed.result as Record<string, unknown>;
          } else if (typeof parsed.code === "string") {
            output.code = parsed.code;
          }
        }
        resolve(output);
        return;
      }
      setTimeout(check, 0);
    };
    check();
  });
}

describe("workspace runner request contract", () => {
  const tempDirs: string[] = [];

  function workspace(): string {
    const root = mkdtempSync(join(tmpdir(), "ashley-workspace-runner-"));
    tempDirs.push(root);
    return root;
  }

  afterEach(() => {
    for (const path of tempDirs) {
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("creates a new file without a mustNotExist selector", async () => {
    const root = workspace();
    const result = await runWorkspaceRunner(root, "workspace.write_file", {
      path: "new.txt",
      content: "new contents",
    });

    expect(result).toMatchObject({ exitCode: 0, result: { kind: "workspace.write_file" } });
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("new contents");
  });

  it("lets a worker read the raw-byte hash and replace that exact file", async () => {
    const root = workspace();
    const bytes = Buffer.from("complete contents", "utf8");
    writeFileSync(join(root, "read.txt"), bytes);

    const result = await runWorkspaceRunner(root, "workspace.read_file", { path: "read.txt" });

    expect(result).toMatchObject({
      exitCode: 0,
      result: {
        contentUtf8: "complete contents",
        encoding: "utf8",
        extent: { startByte: 0, endByteExclusive: bytes.length, totalBytes: bytes.length },
        completeness: "complete",
        afterSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    const afterSha256 = result.result?.afterSha256;
    expect(afterSha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    const replaced = await runWorkspaceRunner(root, "workspace.replace_file", {
      path: "read.txt",
      content: "replacement contents",
      expectedSha256: afterSha256,
    });

    expect(replaced).toMatchObject({ exitCode: 0, result: { kind: "workspace.replace_file" } });
    expect(readFileSync(join(root, "read.txt"), "utf8")).toBe("replacement contents");
  });

  it("accepts an empty complete UTF-8 file", async () => {
    const root = workspace();
    writeFileSync(join(root, "empty.txt"), Buffer.alloc(0));

    const result = await runWorkspaceRunner(root, "workspace.read_file", { path: "empty.txt" });

    expect(result.exitCode).toBe(0);
    expect(isWorkspaceReadFileResult(result.result)).toBe(true);
  });

  it("refuses non-UTF-8 read content without returning replacement characters", async () => {
    const root = workspace();
    writeFileSync(join(root, "binary.dat"), Buffer.from([0x61, 0xff, 0x62]));

    const result = await runWorkspaceRunner(root, "workspace.read_file", { path: "binary.dat" });

    expect(result).toMatchObject({ exitCode: 1, code: "not_utf8" });
    expect(result.result).toBeUndefined();
  });

  it("returns file_exists and preserves bytes when create-only write targets an existing file", async () => {
    const root = workspace();
    writeFileSync(join(root, "existing.txt"), "old contents");

    const result = await runWorkspaceRunner(root, "workspace.write_file", {
      path: "existing.txt",
      content: "replacement",
    });

    expect(result).toMatchObject({ exitCode: 1, code: "file_exists" });
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("old contents");
  });

  it("rejects the removed mustNotExist field before creating the target", async () => {
    const root = workspace();
    const result = await runWorkspaceRunner(root, "workspace.write_file", {
      path: "new.txt",
      content: "new contents",
      mustNotExist: false,
    });

    expect(result).toMatchObject({ exitCode: 1, code: "bad-request" });
    expect(existsSync(join(root, "new.txt"))).toBe(false);
  });

  it("requires a raw-byte hash before replace and leaves the target unchanged", async () => {
    const root = workspace();
    writeFileSync(join(root, "existing.txt"), "old contents");

    const result = await runWorkspaceRunner(root, "workspace.replace_file", {
      path: "existing.txt",
      content: "replacement",
    });

    expect(result).toMatchObject({ exitCode: 1, code: "bad-request" });
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("old contents");
  });

  it("uses the read raw-byte hash to replace an existing file", async () => {
    const root = workspace();
    const before = Buffer.from("old contents", "utf8");
    writeFileSync(join(root, "existing.txt"), before);
    const expectedSha256 = createHash("sha256").update(before).digest("hex");

    const result = await runWorkspaceRunner(root, "workspace.replace_file", {
      path: "existing.txt",
      content: "replacement",
      expectedSha256,
    });

    expect(result).toMatchObject({ exitCode: 0, result: { kind: "workspace.replace_file" } });
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("replacement");
  });

  it("rejects a stale replace hash without changing the target", async () => {
    const root = workspace();
    writeFileSync(join(root, "existing.txt"), "old contents");

    const result = await runWorkspaceRunner(root, "workspace.replace_file", {
      path: "existing.txt",
      content: "replacement",
      expectedSha256: createHash("sha256").update("stale contents").digest("hex"),
    });

    expect(result).toMatchObject({ exitCode: 1, code: "hash_mismatch" });
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("old contents");
  });

  it("rejects an edit whose oldText is ambiguous without changing the target", async () => {
    const root = workspace();
    const before = Buffer.from("same same", "utf8");
    writeFileSync(join(root, "existing.txt"), before);

    const result = await runWorkspaceRunner(root, "workspace.edit_text", {
      path: "existing.txt",
      oldText: "same",
      newText: "other",
      expectedSha256: createHash("sha256").update(before).digest("hex"),
    });

    expect(result).toMatchObject({ exitCode: 1, code: "ambiguous_matches" });
    expect(readFileSync(join(root, "existing.txt"))).toEqual(before);
  });

  it("requires a raw-byte hash before delete and leaves the target unchanged", async () => {
    const root = workspace();
    writeFileSync(join(root, "existing.txt"), "old contents");

    const result = await runWorkspaceRunner(root, "workspace.delete_file", {
      path: "existing.txt",
    });

    expect(result).toMatchObject({ exitCode: 1, code: "bad-request" });
    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("old contents");
  });

  it("reports not_utf8 after matching the raw-byte hash and preserves the file", async () => {
    const root = workspace();
    const before = Buffer.from([0x61, 0xff, 0x62]);
    writeFileSync(join(root, "binary.txt"), before);
    const expectedSha256 = createHash("sha256").update(before).digest("hex");

    const result = await runWorkspaceRunner(root, "workspace.edit_text", {
      path: "binary.txt",
      oldText: "a",
      newText: "A",
      expectedSha256,
    });

    expect(result).toMatchObject({ exitCode: 1, code: "not_utf8" });
    expect(readFileSync(join(root, "binary.txt"))).toEqual(before);
  });

  it("uses the same field table for host and embedded runner request validation", async () => {
    const contract = await import("./worker-contract.js").catch(() => null);
    expect(contract).not.toBeNull();
    if (!contract) return;

    const validateRunner = new Function(
      "Buffer",
      contract.WORKSPACE_RUNNER_REQUEST_VALIDATOR_SOURCE +
        "; return validateWorkspaceRunnerRequest;",
    )(Buffer) as (request: Record<string, unknown>) => boolean;
    const cases: Array<{ operation: string; request: Record<string, unknown>; valid: boolean }> = [
      {
        operation: "workspace.write_file",
        request: { path: "new.txt", content: "new contents" },
        valid: true,
      },
      {
        operation: "workspace.write_file",
        request: { path: "new.txt", content: "new contents", mustNotExist: false },
        valid: false,
      },
      {
        operation: "workspace.write_file",
        request: { path: "new.txt", content: "new contents", toString: "extra" },
        valid: false,
      },
      { operation: "toString", request: {}, valid: false },
      {
        operation: "workspace.replace_file",
        request: { path: "existing.txt", content: "replacement" },
        valid: false,
      },
      {
        operation: "workspace.replace_file",
        request: { path: "existing.txt", content: "replacement", expectedSha256: "a".repeat(64) },
        valid: true,
      },
      {
        operation: "workspace.delete_file",
        request: { path: "existing.txt" },
        valid: false,
      },
      {
        operation: "workspace.replace_file",
        request: { path: "existing.txt", content: "replacement", expectedSha256: "A".repeat(64) },
        valid: false,
      },
      {
        operation: "workspace.write_file",
        request: { path: "new.txt", content: "é".repeat(32_769) },
        valid: false,
      },
      {
        operation: "workspace.search_text",
        request: { pattern: "match" },
        valid: true,
      },
      {
        operation: "workspace.search_text",
        request: { pattern: "match", maxMatches: 2_001 },
        valid: false,
      },
    ];

    for (const testCase of cases) {
      const runnerRequest = {
        version: 2,
        operation: testCase.operation,
        workspaceId: "workspace-1",
        probePort: 12345,
        sentinelPath: "host-sentinel",
        fdSentinelCanonical: "host-sentinel",
        ...testCase.request,
      };
      expect(contract.validateWorkspaceWorkerRequest(testCase.operation, testCase.request).ok)
        .toBe(testCase.valid);
      expect(validateRunner(runnerRequest)).toBe(testCase.valid);
    }
  });
});
