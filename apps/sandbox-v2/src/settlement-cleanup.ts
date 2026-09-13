import type { Server, Socket } from "node:net";

type ClosableLoopbackServer = Pick<Server, "close">;
type DestroyableLoopbackSocket = Pick<Socket, "destroy">;
type KillableChild = {
  kill(signal: NodeJS.Signals): boolean;
  stdin: { destroy(): void };
  stdout: { destroy(): void };
  stderr: { destroy(): void };
};
type CloseWaitChild = KillableChild & {
  once(event: "close", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off(event: "close", listener: (code: number | null) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
};

export type ChildCloseDeadlineOptions = {
  childTerminationDeadlineAtMs: number;
  nowMs?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

/**
 * Stop accepting connections and synchronously destroy every connection before
 * the acquisition executor continues into its remaining bounded cleanup.
 */
export function forceCloseLoopbackServer(
  server: ClosableLoopbackServer,
  connections: Set<DestroyableLoopbackSocket>,
): void {
  server.close();
  for (const socket of connections) socket.destroy();
  connections.clear();
}

export function terminateChild(child: KillableChild): void {
  child.kill("SIGKILL");
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

/**
 * Wait for the OS close acknowledgement only until the termination boundary.
 * At the boundary, repeat the strongest available termination action, detach
 * the acknowledgement listeners, and let the owning executor settle.
 */
export function awaitChildCloseByDeadline(
  child: CloseWaitChild,
  options: ChildCloseDeadlineOptions,
): Promise<{ closed: boolean; exitCode: number | null }> {
  const nowMs = options.nowMs ?? Date.now;
  const remainingMs = options.childTerminationDeadlineAtMs - nowMs();
  if (remainingMs <= 0) {
    terminateChild(child);
    return Promise.resolve({ closed: false, exitCode: null });
  }

  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));

  return new Promise((resolve) => {
    let timer: unknown;
    let settled = false;
    const finish = (closed: boolean, exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimer(timer);
      child.off("close", onClose);
      child.off("error", onError);
      resolve({ closed, exitCode });
    };
    const onClose = (code: number | null): void => finish(true, code);
    const onError = (): void => {
      terminateChild(child);
    };

    child.once("close", onClose);
    child.once("error", onError);
    timer = setTimer(() => {
      terminateChild(child);
      finish(false, null);
    }, remainingMs);
  });
}
