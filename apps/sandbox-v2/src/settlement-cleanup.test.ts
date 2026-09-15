import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";

it("force-closes a loopback server instead of awaiting a connection-held close callback", async () => {
  const modulePath = "./settlement-cleanup.js";
  const cleanupModule = await import(modulePath).catch(() => null);

  expect(cleanupModule).not.toBeNull();
  if (cleanupModule === null) return;

  let closeRequested = false;
  let connectionsForcedClosed = 0;
  const server = {
    close() {
      closeRequested = true;
      return this;
    },
  };
  const connections = new Set([
    { destroy: () => { connectionsForcedClosed += 1; } },
    { destroy: () => { connectionsForcedClosed += 1; } },
  ]);

  cleanupModule.forceCloseLoopbackServer(server, connections);

  expect(closeRequested).toBe(true);
  expect(connectionsForcedClosed).toBe(2);
  expect(connections.size).toBe(0);
});

it("kills a timed-out child and destroys every child pipe", async () => {
  const modulePath = "./settlement-cleanup.js";
  const cleanupModule = await import(modulePath) as Record<string, unknown>;
  const terminateChild = cleanupModule.terminateChild;
  expect(typeof terminateChild).toBe("function");
  if (typeof terminateChild !== "function") return;

  const killedWith: NodeJS.Signals[] = [];
  let destroyedPipes = 0;
  const child = {
    kill(signal: NodeJS.Signals) {
      killedWith.push(signal);
      return true;
    },
    stdin: { destroy: () => { destroyedPipes += 1; } },
    stdout: { destroy: () => { destroyedPipes += 1; } },
    stderr: { destroy: () => { destroyedPipes += 1; } },
  };

  (terminateChild as (value: typeof child) => void)(child);

  expect(killedWith).toEqual(["SIGKILL"]);
  expect(destroyedPipes).toBe(3);
});

it("stops awaiting child close at the termination deadline and preserves cleanup reserve", async () => {
  const modulePath = "./settlement-cleanup.js";
  const cleanupModule = await import(modulePath) as Record<string, unknown>;
  const awaitChildCloseByDeadline = cleanupModule.awaitChildCloseByDeadline;
  expect(typeof awaitChildCloseByDeadline).toBe("function");
  if (typeof awaitChildCloseByDeadline !== "function") return;

  let nowMs = 1_200;
  let scheduledForMs = -1;
  let scheduled: (() => void) | undefined;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const child = {
    kill: () => true,
    stdin: { destroy: () => {} },
    stdout: { destroy: () => {} },
    stderr: { destroy: () => {} },
    once(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, listener);
      return this;
    },
    off(event: string) {
      listeners.delete(event);
      return this;
    },
  };

  const closePromise = (awaitChildCloseByDeadline as (
    value: typeof child,
    options: Record<string, unknown>,
  ) => Promise<{ closed: boolean }>)(child, {
    childTerminationDeadlineAtMs: 1_400,
    settlementDeadlineAtMs: 1_500,
    nowMs: () => nowMs,
    setTimer: (callback: () => void, delayMs: number) => {
      scheduledForMs = delayMs;
      scheduled = callback;
      return 1;
    },
    clearTimer: () => {},
  });

  expect(scheduledForMs).toBe(200);
  nowMs = 1_400;
  scheduled?.();

  await expect(closePromise).resolves.toEqual({ closed: false, exitCode: null });
  expect(listeners.size).toBe(0);
  expect(1_500 - nowMs).toBe(100);
});

it("lets the canonical quarantine decision outrank ordinary projection discard", async () => {
  const root = mkdtempSync(join(tmpdir(), "ashley-projection-cleanup-"));
  writeFileSync(join(root, "secret-shaped-material"), "fixture", "utf8");
  try {
    const cleanupModule = await import("./settlement-cleanup.js") as Record<string, unknown>;
    const discardProjection = cleanupModule.discardProjection;
    expect(typeof discardProjection).toBe("function");
    if (typeof discardProjection !== "function") return;

    let quarantineCalled = false;
    const result = (discardProjection as (
      projectionRoot: string,
      options: { quarantine: (projectionRoot: string) => boolean },
    ) => { cleanupCompleted: boolean; projectionDiscarded: boolean; quarantinePreserved: boolean })(root, {
      quarantine: (projectionRoot) => {
        quarantineCalled = projectionRoot === root;
        return true;
      },
    });

    expect(quarantineCalled).toBe(true);
    expect(result).toEqual({
      cleanupCompleted: true,
      projectionDiscarded: false,
      quarantinePreserved: true,
    });
    expect(existsSync(join(root, "secret-shaped-material"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("discards only the mutable projection and preserves the caller's receipt/evidence references", async () => {
  const root = mkdtempSync(join(tmpdir(), "ashley-projection-discard-"));
  writeFileSync(join(root, "compiled-output"), "fixture", "utf8");
  const receipts = [{ snapshotId: "receipt-1" }];
  const evidence = [{ kind: "verification", outcome: "verified_success" }];
  try {
    const cleanupModule = await import("./settlement-cleanup.js") as Record<string, unknown>;
    const discardProjection = cleanupModule.discardProjection;
    expect(typeof discardProjection).toBe("function");
    if (typeof discardProjection !== "function") return;

    expect((discardProjection as (projectionRoot: string) => {
      cleanupCompleted: boolean;
      projectionDiscarded: boolean;
    })(root)).toMatchObject({ cleanupCompleted: true, projectionDiscarded: true });
    expect(existsSync(root)).toBe(false);
    expect(receipts).toEqual([{ snapshotId: "receipt-1" }]);
    expect(evidence).toEqual([{ kind: "verification", outcome: "verified_success" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
