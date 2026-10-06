import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { pumpPlacePostsOnce } from "./post-pump.js";
import type { PlacePost, PlacePostReport } from "../agent-client.js";

function fakeClient(sent: string[]): Client {
  return {
    channels: { fetch: async (id: string) => id === "chan-1"
      ? { isTextBased: () => true, guildId: "guild-1", send: async (text: string) => { sent.push(`room:${text}`); return { id: "900" }; } }
      : null },
    users: { fetch: async () => ({ send: async (text: string) => { sent.push(`dm:${text}`); return { id: "901" }; } }) },
  } as unknown as Client;
}

describe("B1 place post pump", () => {
  it("sends exactly the text to the place, then reports each outcome", async () => {
    const sent: string[] = [];
    const calls: PlacePostReport[][] = [];
    const due: PlacePost[] = [
      { intent_id: "i1", target: { kind: "room", guildId: "guild-1", channelId: "chan-1" }, text: "hi all" },
      { intent_id: "i2", target: { kind: "contact", principalId: "p1" }, text: "hey you" },
      { intent_id: "i3", target: { kind: "room", guildId: "guild-1", channelId: "gone" }, text: "lost" },
    ];
    const sync = async (reports: PlacePostReport[]) => { calls.push(reports); return { posts: calls.length === 1 ? due : [] }; };
    assert.equal(await pumpPlacePostsOnce(fakeClient(sent), sync), 3);
    assert.deepEqual(sent, ["room:hi all", "dm:hey you"]);
    assert.deepEqual(calls[1], [
      { intent_id: "i1", outcome: "posted", discord_message_id: "900" },
      { intent_id: "i2", outcome: "posted", discord_message_id: "901" },
      { intent_id: "i3", outcome: "failed", reason: "channel_unavailable" },
    ]);
  });

  it("keeps reports it could not deliver for the next round", async () => {
    let fail = true;
    const seen: PlacePostReport[][] = [];
    const posts: PlacePost[] = [{ intent_id: "i9", target: { kind: "contact", principalId: "p1" }, text: "x" }];
    const sync = async (reports: PlacePostReport[]) => {
      seen.push(reports);
      if (reports.length && fail) { fail = false; throw new Error("agent down"); }
      return { posts: seen.length === 1 ? posts : [] };
    };
    await pumpPlacePostsOnce(fakeClient([]), sync);
    await pumpPlacePostsOnce(fakeClient([]), sync);
    assert.deepEqual(seen.at(-1), [{ intent_id: "i9", outcome: "posted", discord_message_id: "901" }]);
  });
});
