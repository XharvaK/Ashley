import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { env } from "./env.js";
import { createServer } from "./server.js";
import type { AgentManager } from "./agent.js";

describe("initiative status authorization", () => {
  it("allows the configured owner and denies a non-owner", async () => {
    const originalDiscordOwnerId = env.discordOwnerId;
    const originalMemoryOwnerId = env.memoryOwnerId;
    const manager = {
      getState: () => "ready",
      getUptimeSec: () => 0,
      getProviderState: () => "unavailable",
      core: {
        getProactiveStatus: () => ({
          enabled: true,
          paused: false,
          sentToday: 0,
          maxPerDay: 10,
          lastSentAt: null,
          lastUserMessageAt: null,
          minIdleHours: 2,
          lastDiagnostic: null,
        }),
        getProactiveOperationalStatus: () => ({
          enabled: true,
          paused: false,
          sentToday: 0,
          maxPerDay: 10,
          lastSentAt: null,
          lastUserMessageAt: null,
          minIdleHours: 2,
          lastDiagnostic: null,
        }),
      },
    } as unknown as AgentManager;

    env.discordOwnerId = "doc";
    env.memoryOwnerId = "doc";
    const app = createServer(manager);
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as AddressInfo;
      const ownerResponse = await fetch(
        `http://127.0.0.1:${address.port}/initiative/status?owner_id=doc`,
      );
      expect(ownerResponse.status).toBe(200);
      expect(await ownerResponse.json()).not.toHaveProperty("cognitiveContinuity");

      const operationalResponse = await fetch(
        `http://127.0.0.1:${address.port}/initiative/operational-status?owner_id=doc`,
      );
      expect(operationalResponse.status).toBe(200);
      const operational = await operationalResponse.json();
      expect(operational).toMatchObject({ paused: false });
      expect(operational.cognitiveContinuity).toBeUndefined();

      const nonOwnerResponse = await fetch(
        `http://127.0.0.1:${address.port}/initiative/status?owner_id=other`,
      );
      expect(nonOwnerResponse.status).toBe(403);
      expect(await nonOwnerResponse.json()).toMatchObject({
        code: "forbidden",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      env.discordOwnerId = originalDiscordOwnerId;
      env.memoryOwnerId = originalMemoryOwnerId;
    }
  });
});
