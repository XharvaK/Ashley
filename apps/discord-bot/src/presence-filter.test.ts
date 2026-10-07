import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GatewayIntentBits } from "discord.js";
import { applyOwnerPresence, gatewayIntentList } from "./presence-filter.js";

describe("owner presence filter", () => {
  it("drops a non-Owner presence update before any call or log", async () => {
    const calls: string[] = [];
    await applyOwnerPresence(
      { userId: "guest-1", status: "dnd" },
      {
        ownerId: "owner-1",
        factsEnabled: true,
        nowMs: () => 10,
        postDnd: async () => { calls.push("dnd"); },
        postFact: async () => { calls.push("fact"); },
        log: () => { calls.push("log"); },
      },
    );
    assert.deepEqual(calls, []);
  });

  it("sends Owner DND to the quiet endpoint and skips facts unless opted in", async () => {
    const calls: string[] = [];
    const deps = {
      ownerId: "owner-1",
      factsEnabled: false,
      nowMs: () => 20,
      postDnd: async (on: boolean) => { calls.push(`dnd:${on}`); },
      postFact: async (status: string) => { calls.push(`fact:${status}`); },
      log: () => { calls.push("log"); },
    };
    await applyOwnerPresence({ userId: "owner-1", status: "dnd" }, deps);
    await applyOwnerPresence({ userId: "owner-1", status: "online" }, deps);
    assert.deepEqual(calls, ["dnd:true", "dnd:false"]);

    calls.length = 0;
    await applyOwnerPresence({ userId: "owner-1", status: "idle" }, { ...deps, factsEnabled: true });
    assert.deepEqual(calls, ["dnd:false", "fact:idle"]);
  });

  it("omits GuildPresences unless the intent flag is on", () => {
    assert.equal(gatewayIntentList(false).includes(GatewayIntentBits.GuildPresences), false);
    assert.equal(gatewayIntentList(true).includes(GatewayIntentBits.GuildPresences), true);
  });
});
