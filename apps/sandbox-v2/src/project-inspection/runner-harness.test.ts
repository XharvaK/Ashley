/**
 * VM harness tests for the embedded inspection runner (Sandbox V2 M2).
 *
 * The runner source executes inside `node -e` on the production host. On the
 * Windows dev machine real Bubblewrap is unavailable, so the security-critical
 * runner logic (symlink refusal, canonical-path rules, bounds, truncation,
 * isolation checks) is exercised by executing the very same source text inside
 * a `vm` context with a scripted in-memory filesystem and fake net/process.
 *
 * This is logic testing, not physical qualification: the real boundary
 * (bwrap -> clearenv -> mounts) is covered by the Linux-only integration test
 * and by production qualification on the Mint host.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { SANDBOX_V2_INSPECTION_RUNNER_SOURCE } from "./runner.js";

type FakeEntry =
  | { type: "file"; content: string }
  | { type: "dir" }
  | { type: "symlink"; target: string };

type FakeFsState = {
  entries: Map<string, FakeEntry>;
  fdTargets: Record<string, string>;
  stdout: string;
  exitCode: number | null;
  stderr: string;
};

const HASH_FAKE = "f".repeat(64);

function makeFs(fsState: FakeFsState) {
  const get = (p: string): FakeEntry | undefined => fsState.entries.get(p);
  function failClosed(code: string): never {
    const err = new Error(code) as NodeJS.ErrnoException;
    err.code = code;
    throw err;
  }
  const mustGet = (p: string): FakeEntry => {
    const entry = get(p);
    if (!entry) failClosed("ENOENT");
    return entry;
  };
  const lstat = (p: string) => {
    const entry = mustGet(p);
    const isSymlink = entry.type === "symlink";
    const isDir = entry.type === "dir";
    const isFile = entry.type === "file";
    return {
      isSymbolicLink: () => isSymlink,
      isDirectory: () => isDir,
      isFile: () => isFile,
      size: entry.type === "file" ? Buffer.byteLength(entry.content, "utf8") : 0,
    };
  };
  return {
    accessSync(p: string) {
      mustGet(p);
    },
    lstatSync(p: string) {
      return lstat(p);
    },
    statSync(p: string) {
      const entry = mustGet(p);
      if (entry.type === "symlink") {
        return lstat(entry.target);
      }
      return lstat(p);
    },
    readFileSync(p: string, encoding?: string) {
      const entry = mustGet(p);
      if (entry.type !== "file") failClosed("EISDIR");
      return encoding === "utf8" ? entry.content : Buffer.from(entry.content, "utf8");
    },
    readdirSync(p: string, options?: { withFileTypes?: boolean }) {
      const entry = mustGet(p);
      if (entry.type !== "dir") failClosed("ENOTDIR");
      const prefix = p === "/" ? "/" : p + "/";
      const names = Array.from(fsState.entries.keys())
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((k) => k.slice(prefix.length))
        .sort();
      if (options?.withFileTypes) {
        return names.map((name) => {
          const e = mustGet(prefix + name);
          return {
            name,
            isSymbolicLink: () => e.type === "symlink",
            isDirectory: () => e.type === "dir",
            isFile: () => e.type === "file",
          };
        });
      }
      return names;
    },
    realpathSync(p: string) {
      const fdTarget = fsState.fdTargets[p];
      if (fdTarget !== undefined) return fdTarget;
      const entry = mustGet(p);
      if (entry.type === "symlink") return entry.target;
      return p;
    },
    writeFileSync(p: string) {
      const entry = mustGet(p);
      if (entry.type !== "file") failClosed("EISDIR");
    },
    writeSync(fd: number, data: string) {
      if (fd === 1 && fsState.exitCode === null) {
        fsState.stdout += String(data);
        return String(data).length;
      }
      return 0;
    },
  };
}

function makeNet(fsState: FakeFsState) {
  const failedPorts: number[] = [];
  const connectResults: Record<number, boolean> = {};
  return {
    setFailedPorts(ports: number[]) {
      failedPorts.length = 0;
      failedPorts.push(...ports);
    },
    setConnectResult(port: number, ok: boolean) {
      connectResults[port] = ok;
    },
    Socket: class FakeSocket extends EventEmitter {
      connect(port: number) {
        const ok = connectResults[port] ?? !failedPorts.includes(port);
        if (ok) {
          setImmediate(() => this.emit("connect"));
        } else {
          const err = new Error("unreachable") as NodeJS.ErrnoException;
          err.code = failedPorts.includes(port) ? "ENETUNREACH" : "ECONNREFUSED";
          setImmediate(() => this.emit("error", err));
        }
        return this;
      }
      setTimeout(_ms: number, fn: () => void) {
        this._timer = setTimeout(fn, 50);
        return this;
      }
      destroy() {
        if (this._timer) clearTimeout(this._timer);
      }
      private _timer?: NodeJS.Timeout;
    },
  };
}

type HarnessOptions = {
  request: Record<string, unknown>;
  files?: Record<string, FakeEntry>;
  fdTargets?: Record<string, string>;
  env?: Record<string, string>;
  failedExternalPorts?: number[];
  loopbackOk?: boolean;
  writableProject?: boolean;
};

type HarnessOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function runRunnerInVm(options: HarnessOptions): Promise<HarnessOutput> {
  const fsState: FakeFsState = {
    entries: new Map(
      Object.entries(options.files ?? {}).map(([path, entry]) => [path, entry]),
    ),
    fdTargets: { ...(options.fdTargets ?? {}) },
    stdout: "",
    exitCode: null,
    stderr: "",
  };
  if (options.writableProject) {
    fsState.entries.set("/project/.v2-write-probe", { type: "file", content: "" });
  }

  const net = makeNet(fsState);
  if (options.loopbackOk !== undefined) {
    net.setConnectResult(options.request.probePort as number, options.loopbackOk);
  }
  net.setFailedPorts(options.failedExternalPorts ?? []);

  const stdin = new EventEmitter();
  (stdin as EventEmitter & { setEncoding(): void }).setEncoding = () => {};
  (stdin as EventEmitter & { destroy(): void }).destroy = () => {};
  const fakeProcess = {
    env: { HOME: "/tmp", PATH: "/usr/bin", PWD: "/project", ...(options.env ?? {}) },
    stdin,
    stderr: { write: (s: string) => (fsState.stderr += String(s)) },
    exit(code: number) {
      if (fsState.exitCode === null) {
        fsState.exitCode = code;
      }
    },
    platform: "linux",
  };

  const crypto = {
    createHash: () => ({
      update: () => ({ digest: (enc: string) => (enc === "hex" ? HASH_FAKE : Buffer.from(HASH_FAKE, "hex")) }),
    }),
  };

  const context = {
    require: (name: string) => {
      if (name === "fs") return makeFs(fsState);
      if (name === "net") return net;
      if (name === "crypto") return crypto;
      throw new Error("module-not-found:" + name);
    },
    process: fakeProcess,
  };

  try {
    // eslint-disable-next-line no-new-func
    const vm = await import("node:vm");
    vm.runInNewContext(SANDBOX_V2_INSPECTION_RUNNER_SOURCE, context, {
      filename: "runner.js",
      timeout: 10_000,
    });
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }

  stdin.emit("data", JSON.stringify(options.request));
  stdin.emit("end");

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 60));

  return { exitCode: fsState.exitCode, stdout: fsState.stdout, stderr: fsState.stderr };
}

const BASE_FILES: Record<string, FakeEntry> = {
  "/project": { type: "dir" },
  "/project/src": { type: "dir" },
  "/project/src/main.ts": { type: "file", content: "const x = 1;\nconsole.log(x);\n" },
  "/project/README.md": { type: "file", content: "# Project\nhello world\n" },
  "/project/.env": { type: "file", content: "SECRET=1" },
  "/project/secret.key": { type: "file", content: "key" },
  "/proc/self/fd": { type: "dir" },
};

function baseRequest(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 2,
    operation: "project.read_file",
    path: "src/main.ts",
    probePort: 49123,
    sentinelPath: "/tmp/sentinel/sentinel.txt",
    fdSentinelCanonical: "/tmp/sentinel/sentinel.txt",
    ...overrides,
  };
}

describe("embedded runner (VM harness)", () => {
  it("reads a canonical file with base64 + sha256 + truncation=false", async () => {
    const out = await runRunnerInVm({
      request: baseRequest({}),
      files: BASE_FILES,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.result.kind).toBe("project.read_file");
    expect(parsed.result.path).toBe("src/main.ts");
    expect(parsed.result.bytes).toBe(Buffer.byteLength("const x = 1;\nconsole.log(x);\n", "utf8"));
    expect(Buffer.from(parsed.result.contentBase64, "base64").toString("utf8")).toBe("const x = 1;\nconsole.log(x);\n");
    expect(parsed.result.sha256).toBe(HASH_FAKE);
    expect(parsed.result.truncated).toBe(false);
    expect(parsed.checks.envClean).toBe(true);
    expect(parsed.checks.homeAbsent).toBe(true);
    expect(parsed.checks.runAbsent).toBe(true);
    expect(parsed.checks.hostSentinelAbsent).toBe(true);
    expect(parsed.checks.fdClean).toBe(true);
    expect(parsed.checks.projectReadOnly).toBe(true);
    expect(parsed.checks.loopbackConnectSucceeded).toBe(false);
    expect(parsed.checks.externalIsolated).toBe(true);
  });

  it("refuses absolute paths and traversal escapes", async () => {
    for (const path of ["/project/README.md", "../README.md", "src/../README.md", "a\\b", "C:/x", "src/"]) {
      const out = await runRunnerInVm({
        request: baseRequest({ path }),
        files: BASE_FILES,
        loopbackOk: false,
        failedExternalPorts: [80],
      });
      expect(out.exitCode).toBe(1);
      expect(JSON.parse(out.stdout).code).toBe("invalid_path");
    }
  });

  it("refuses symlink components anywhere in the path (fail closed)", async () => {
    const files: Record<string, FakeEntry> = {
      ...BASE_FILES,
      "/project/link": { type: "symlink", target: "/" },
      "/project/src/evil-link": { type: "symlink", target: "/project/.env" },
    };
    for (const path of ["link", "link/README.md", "src/evil-link"]) {
      const out = await runRunnerInVm({
        request: baseRequest({ path }),
        files,
        loopbackOk: false,
        failedExternalPorts: [80],
      });
      expect(out.exitCode).toBe(1);
      expect(JSON.parse(out.stdout).code).toBe("symlink_forbidden");
    }
  });

  it("refuses a file larger than the read ceiling (no partial reads)", async () => {
    const files: Record<string, FakeEntry> = {
      ...BASE_FILES,
      "/project/big.txt": { type: "file", content: "x".repeat(70_000) },
    };
    const out = await runRunnerInVm({
      request: baseRequest({ path: "big.txt" }),
      files,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.stdout).code).toBe("file_too_large");
  });

  it("lists a directory deterministically with typed entries", async () => {
    const out = await runRunnerInVm({
      request: baseRequest({ operation: "project.list_directory", path: "." }),
      files: BASE_FILES,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.result.entries).toEqual([
      { name: ".env", kind: "file", size: Buffer.byteLength("SECRET=1", "utf8") },
      { name: "README.md", kind: "file", size: Buffer.byteLength("# Project\nhello world\n", "utf8") },
      { name: "secret.key", kind: "file", size: Buffer.byteLength("key", "utf8") },
      { name: "src", kind: "dir", size: 0 },
    ]);
    expect(parsed.result.truncated).toBe(false);
  });

  it("fails when listing a non-directory and when reading a directory", async () => {
    const list = await runRunnerInVm({
      request: baseRequest({ operation: "project.list_directory", path: "README.md" }),
      files: BASE_FILES,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(JSON.parse(list.stdout).code).toBe("not_a_directory");
    const read = await runRunnerInVm({
      request: baseRequest({ path: "src" }),
      files: BASE_FILES,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(JSON.parse(read.stdout).code).toBe("not_a_file");
  });

  it("searches literal substrings, skipping excluded dirs and oversize files, with truncation flags", async () => {
    const files: Record<string, FakeEntry> = {
      "/project": { type: "dir" },
      "/project/node_modules": { type: "dir" },
      "/project/node_modules/dep": { type: "file", content: "hello secret\n" },
      "/project/dist": { type: "dir" },
      "/project/dist/bundle.js": { type: "file", content: "hello secret\n" },
      "/project/src": { type: "dir" },
      "/project/src/a.ts": { type: "file", content: "line1\nhello world\nline3\n" },
      "/project/src/huge.ts": { type: "file", content: "x".repeat(140_000) },
      "/project/src/long.ts": { type: "file", content: "hello " + "y".repeat(600) + "\n" },
      "/proc/self/fd": { type: "dir" },
    };
    const out = await runRunnerInVm({
      request: baseRequest({
        operation: "project.search_text",
        path: ".",
        pattern: "hello",
        maxMatches: 2000,
      }),
      files,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.result.matches).toEqual([
      { path: "src/a.ts", line: 2, text: "hello world" },
      { path: "src/long.ts", line: 1, text: "hello " + "y".repeat(506) },
    ]);
    expect(parsed.result.truncated).toBe(false);
    expect(parsed.result.filesScanned).toBe(3);
  });

  it("flags truncated matches when maxMatches is hit and caps pattern length", async () => {
    const files: Record<string, FakeEntry> = {
      "/project": { type: "dir" },
      "/project/a.txt": { type: "file", content: "hit\nhit\nhit\n" },
      "/proc/self/fd": { type: "dir" },
    };
    const truncated = await runRunnerInVm({
      request: baseRequest({ operation: "project.search_text", path: ".", pattern: "hit", maxMatches: 2 }),
      files,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    const parsedTruncated = JSON.parse(truncated.stdout);
    expect(parsedTruncated.result.matches.length).toBe(2);
    expect(parsedTruncated.result.truncated).toBe(true);

    const badPattern = await runRunnerInVm({
      request: baseRequest({ operation: "project.search_text", path: ".", pattern: "x".repeat(257) }),
      files,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(JSON.parse(badPattern.stdout).code).toBe("bad-request");
  });

  it("fails closed when a symlink is listed (skipped) but loopback connects", async () => {
    const files: Record<string, FakeEntry> = {
      ...BASE_FILES,
      "/project/link": { type: "symlink", target: "/" },
    };
    const out = await runRunnerInVm({
      request: baseRequest({}),
      files,
      loopbackOk: true,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.stdout).code).toBe("loopback-leak");
  });

  it("fails closed when the secret env sentinel is present", async () => {
    const out = await runRunnerInVm({
      request: baseRequest({}),
      files: BASE_FILES,
      env: { ASHLEY_SANDBOX_V2_SECRET_SENTINEL: "leaked" },
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.stdout).code).toBe("check-failed");
  });

  it("fails closed when the host sentinel is reachable inside the sandbox", async () => {
    const files: Record<string, FakeEntry> = {
      ...BASE_FILES,
      "/tmp/sentinel/sentinel.txt": { type: "file", content: "sentinel" },
    };
    const out = await runRunnerInVm({
      request: baseRequest({}),
      files,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.stdout).code).toBe("check-failed");
  });

  it("fails closed when the host fd leaks into the sandbox", async () => {
    const out = await runRunnerInVm({
      request: baseRequest({}),
      files: { ...BASE_FILES, "/proc/self/fd/3": { type: "file", content: "" } },
      fdTargets: { "/proc/self/fd/3": "/tmp/sentinel/sentinel.txt" },
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.stdout).code).toBe("check-failed");
  });

  it("fails closed when /project is writable", async () => {
    const out = await runRunnerInVm({
      request: baseRequest({}),
      files: BASE_FILES,
      writableProject: true,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.stdout).code).toBe("check-failed");
  });

  it("rejects unknown operations and malformed envelopes", async () => {
    const unknown = await runRunnerInVm({
      request: baseRequest({ operation: "project.delete" }),
      files: BASE_FILES,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(JSON.parse(unknown.stdout).code).toBe("unsupported_operation");

    const bad = await runRunnerInVm({
      request: { version: 2, operation: "project.read_file" },
      files: BASE_FILES,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(JSON.parse(bad.stdout).code).toBe("bad-request");
  });

  it("rejects a missing file with not_found", async () => {
    const out = await runRunnerInVm({
      request: baseRequest({ path: "src/missing.ts" }),
      files: BASE_FILES,
      loopbackOk: false,
      failedExternalPorts: [80],
    });
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.stdout).code).toBe("not_found");
  });
});