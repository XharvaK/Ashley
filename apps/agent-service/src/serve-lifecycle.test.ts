import { describe, expect, it, vi } from "vitest";
import { closeStartupResources, shutdownAgent } from "./serve.js";

describe("agent startup failure cleanup", () => {
  it("stops startup loops and closes startup-owned resources", async () => {
    const order: string[] = [];
    const manager = {
      shutdown: vi.fn(async () => {
        order.push("manager.shutdown");
      }),
      logger: {
        close: vi.fn(() => {
          order.push("logger.close");
        }),
      },
      core: {
        getDatabase: vi.fn(() => ({
          close: vi.fn(() => {
            order.push("nuclear.close");
          }),
        })),
      },
    };
    const cognitiveSidecar = {
      close: vi.fn(() => {
        order.push("sidecar.close");
      }),
    };
    const cognitiveConsumer = {
      stop: vi.fn(() => {
        order.push("consumer.stop");
      }),
      done: Promise.resolve().then(() => {
        order.push("consumer.done");
      }),
    };
    const frontierCoordinator = {
      stop: vi.fn(() => {
        order.push("frontier.stop");
      }),
    };
    const derivedStore = {
      close: vi.fn(() => {
        order.push("derived.close");
      }),
    };
    const observabilityDb = {
      close: vi.fn(() => {
        order.push("observability.close");
      }),
    };

    await closeStartupResources(manager as never, {
      cognitiveSidecar: cognitiveSidecar as never,
      cognitiveConsumer: cognitiveConsumer as never,
      frontierCoordinator: frontierCoordinator as never,
      derivedStore: derivedStore as never,
      observabilityDb: observabilityDb as never,
    });

    expect(cognitiveConsumer.stop).toHaveBeenCalledOnce();
    expect(frontierCoordinator.stop).toHaveBeenCalledOnce();
    expect(manager.shutdown).toHaveBeenCalledOnce();
    expect(cognitiveSidecar.close).toHaveBeenCalledOnce();
    expect(derivedStore.close).toHaveBeenCalledOnce();
    expect(observabilityDb.close).toHaveBeenCalledOnce();
    expect(manager.logger.close).toHaveBeenCalledOnce();
    expect(manager.core.getDatabase).toHaveBeenCalledOnce();
    expect(order.indexOf("consumer.done")).toBeGreaterThan(order.indexOf("consumer.stop"));
    expect(order.indexOf("derived.close")).toBeGreaterThan(order.indexOf("consumer.done"));
  });

  it("does not permit a clean marker until the HTTP close callback completes", async () => {
    const order: string[] = [];
    const clean = vi.fn(() => order.push("clean"));
    const exit = vi.fn((code: number) => order.push(`exit:${code}`));
    let closeCallback: ((error?: Error) => void) | undefined;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        order.push("server.close.initiated");
        closeCallback = callback;
      }),
    };
    const manager = {
      beginShutdown: vi.fn(() => order.push("beginShutdown")),
      shutdown: vi.fn(async () => order.push("manager.shutdown")),
      core: { shutdownContinuityClean: clean },
    };
    const consumer = {
      stop: vi.fn(() => order.push("consumer.stop")),
      done: Promise.resolve().then(() => order.push("consumer.done")),
    };
    const frontier = { stop: vi.fn(() => order.push("frontier.stop")) };
    const derived = { close: vi.fn(() => order.push("derived.close")) };
    const observability = { close: vi.fn(() => order.push("observability.close")) };

    const pending = shutdownAgent(
      manager as never,
      { cognitiveConsumer: consumer as never, frontierCoordinator: frontier as never, derivedStore: derived as never, observabilityDb: observability as never },
      server as never,
      "SIGTERM",
      exit,
    );

    await vi.waitFor(() => expect(server.close).toHaveBeenCalledOnce());
    expect(clean).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(order).toEqual([
      "beginShutdown",
      "consumer.stop",
      "consumer.done",
      "frontier.stop",
      "derived.close",
      "observability.close",
      "manager.shutdown",
      "server.close.initiated",
    ]);

    closeCallback?.();
    await pending;

    expect(clean).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(order.at(-2)).toBe("clean");
    expect(order.at(-1)).toBe("exit:0");
  });

  it("does not stamp clean shutdown when HTTP close reports an error", async () => {
    const clean = vi.fn();
    const exit = vi.fn();
    const manager = {
      beginShutdown: vi.fn(),
      shutdown: vi.fn(async () => undefined),
      core: { shutdownContinuityClean: clean },
    };
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => callback(new Error("close_failed"))),
    };

    await shutdownAgent(
      manager as never,
      { cognitiveConsumer: null, frontierCoordinator: null, derivedStore: null, observabilityDb: null },
      server as never,
      "SIGTERM",
      exit,
    );

    expect(clean).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
