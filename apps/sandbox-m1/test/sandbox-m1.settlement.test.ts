import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runSandboxM1 } from "../src/sandbox-m1.js";

afterEach(() => {
  vi.useRealTimers();
});

it("synchronously removes the fixed-shape M1 workspace", async () => {
  const sandboxModule = await import("../src/sandbox-m1.js") as Record<string, unknown>;
  const removeWorkspace = sandboxModule.removeBoundedM1Workspace;
  expect(typeof removeWorkspace).toBe("function");
  if (typeof removeWorkspace !== "function") return;

  const workspace = mkdtempSync(join(tmpdir(), "ashley-m1-bounded-cleanup-"));
  writeFileSync(join(workspace, "hello.txt"), "hello", "utf8");

  const removed = (removeWorkspace as (path: string) => boolean)(workspace);

  expect(removed).toBe(true);
  expect(existsSync(workspace)).toBe(false);
});

it("destroys child pipes when the child deadline sends SIGKILL", async () => {
  vi.useFakeTimers();
  const workspace = mkdtempSync(join(tmpdir(), "ashley-m1-timeout-"));
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal: NodeJS.Signals): boolean;
  };
  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  const killSignals: NodeJS.Signals[] = [];
  child.kill = (signal) => {
    killSignals.push(signal);
    return true;
  };
  let spawnCalls = 0;

  const resultPromise = runSandboxM1(
    {
      version: 1,
      kind: "file.roundtrip",
      content: "hello",
      probePort: 3710,
      sentinelPath: "/tmp/sentinel.txt",
      fdSentinelCanonical: "/tmp/sentinel.txt",
    },
    {
      loopbackPositiveControlSucceeded: true,
      hostLoopbackSandboxHits: () => 0,
    },
    {
      timeoutMs: 25,
      settlementDeadlineAtMs: Date.now() + 50,
      clock: { nowMs: () => Date.now() },
      workspaceFactory: async () => workspace,
      spawnChild: (() => {
        spawnCalls += 1;
        return child;
      }),
    } as any,
  );

  for (let i = 0; i < 10 && spawnCalls === 0; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(25);

  expect(spawnCalls).toBe(1);
  expect(killSignals).toEqual(["SIGKILL"]);
  expect(stdin.destroyed).toBe(true);
  expect(stdout.destroyed).toBe(true);
  expect(stderr.destroyed).toBe(true);

  child.emit("close", null);
  const result = await resultPromise;
  expect(result).toMatchObject({
    ok: false,
    code: "timeout",
    cancellationRequested: true,
    cancellationAcknowledged: true,
  });
  expect(existsSync(workspace)).toBe(false);
});

it("stops awaiting child close before settlement so fixed cleanup retains its reserve", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const workspace = mkdtempSync(join(tmpdir(), "ashley-m1-close-bound-"));
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal: NodeJS.Signals): boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let spawnCalls = 0;
  let settled = false;

  const resultPromise = runSandboxM1(
    {
      version: 1,
      kind: "file.roundtrip",
      content: "hello",
      probePort: 3710,
      sentinelPath: "/tmp/sentinel.txt",
      fdSentinelCanonical: "/tmp/sentinel.txt",
    },
    {
      loopbackPositiveControlSucceeded: true,
      hostLoopbackSandboxHits: () => 0,
    },
    {
      timeoutMs: 25,
      childTerminationDeadlineAtMs: 1_030,
      settlementDeadlineAtMs: 1_040,
      clock: { nowMs: () => Date.now() },
      workspaceFactory: async () => workspace,
      spawnChild: (() => {
        spawnCalls += 1;
        return child;
      }),
    } as any,
  );
  void resultPromise.then(() => { settled = true; });

  for (let i = 0; i < 10 && spawnCalls === 0; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(30);

  expect(spawnCalls).toBe(1);
  expect(settled).toBe(true);
  expect(existsSync(workspace)).toBe(false);
  await expect(resultPromise).resolves.toMatchObject({
    ok: false,
    code: "timeout",
    cancellationRequested: true,
    cancellationAcknowledged: false,
  });

  child.emit("close", null);
});

it("repeats termination when close waiting starts at the termination boundary", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "ashley-m1-term-boundary-"));
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal: NodeJS.Signals): boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const killSignals: NodeJS.Signals[] = [];
  child.kill = (signal) => {
    killSignals.push(signal);
    return true;
  };

  const result = await runSandboxM1(
    {
      version: 1,
      kind: "file.roundtrip",
      content: "hello",
      probePort: 3710,
      sentinelPath: "/tmp/sentinel.txt",
      fdSentinelCanonical: "/tmp/sentinel.txt",
    },
    {
      loopbackPositiveControlSucceeded: true,
      hostLoopbackSandboxHits: () => 0,
    },
    {
      timeoutMs: 25,
      childTerminationDeadlineAtMs: 1_030,
      settlementDeadlineAtMs: 1_040,
      clock: { nowMs: () => 1_030 },
      workspaceFactory: async () => workspace,
      spawnChild: (() => child),
    } as any,
  );

  expect(killSignals).toEqual(["SIGKILL"]);
  expect(child.stdin.destroyed).toBe(true);
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
  expect(result).toMatchObject({
    ok: false,
    code: "timeout",
    cancellationRequested: true,
    cancellationAcknowledged: false,
  });
  expect(existsSync(workspace)).toBe(false);
});
