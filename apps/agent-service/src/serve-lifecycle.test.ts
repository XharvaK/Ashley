import { describe, expect, it, vi } from "vitest";
import { closeStartupResources } from "./serve.js";

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
});
