import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { DMChannel } from "discord.js";
import type { SoftAct } from "../agent-client.js";
import { loadFaceMemory, saveFaceMemory, emptyFaceMemory, avatarChoice } from "../presence/face-window.js";
import { shapedGapMs, shapedLeadMs, typingLeadMs } from "../chat/pacing.js";
import { performSoftAct, type SoftDeps } from "./soft-pump.js";

type Sent = unknown;

function fakeDm(messages: Record<string, { content: string; pinned?: boolean; mine?: boolean }>) {
  const sent: Sent[] = [];
  const done: string[] = [];
  const dm = {
    id: "dm-1",
    send: async (payload: Sent) => { sent.push(payload); return {}; },
    messages: {
      fetch: async (id: string) => {
        const found = messages[id];
        if (!found) throw new Error("Unknown Message");
        return {
          content: found.content,
          pinned: found.pinned ?? false,
          editable: found.mine ?? false,
          author: { id: found.mine ? "her" : "owner" },
          client: { user: { id: "her" } },
          react: async (emoji: string) => { done.push(`react:${id}:${emoji}`); },
          edit: async (text: string) => { done.push(`edit:${id}:${text}`); },
          pin: async () => { done.push(`pin:${id}`); },
          reply: async (payload: { content: string }) => { done.push(`reply:${id}:${payload.content}`); },
        };
      },
    },
  };
  return { dm: dm as unknown as DMChannel, sent, done };
}

function deps(dm: DMChannel, extra: Partial<SoftDeps> = {}): SoftDeps {
  return {
    ownerDm: async () => dm,
    readArt: () => null,
    setAvatar: async () => undefined,
    searchGif: async () => null,
    gifSearchAvailable: () => false,
    dataDir: mkdtempSync(join(tmpdir(), "soft-")),
    nowMs: () => 1_000_000,
    ...extra,
  };
}

const act = (request: SoftAct["request"]): SoftAct => ({ actId: 1, request });

describe("UX W2 soft acts in the Owner's DM", () => {
  it("reacts, but never echoes the emoji the Owner just used", async () => {
    const { dm, done } = fakeDm({ "900": { content: "haha 😂" }, "901": { content: "look" } });
    assert.deepEqual(await performSoftAct(act({ kind: "touch", emoji: "😂", messageId: "900", meaning: "landed" }), deps(dm)),
      { status: "refused", reason: "mirrors_their_emoji" });
    assert.deepEqual(await performSoftAct(act({ kind: "touch", emoji: "🦦", messageId: "901", meaning: "this_bit" }), deps(dm)), { status: "done" });
    assert.deepEqual(await performSoftAct(act({ kind: "touch", emoji: "🦦", messageId: "999", meaning: "landed" }), deps(dm)),
      { status: "refused", reason: "message_gone" });
    assert.deepEqual(done, ["react:901:🦦"]);
  });

  it("a correction strikes the old text through and adds the new", async () => {
    const { dm, done } = fakeDm({ "901": { content: "otters live in deserts", mine: true }, "900": { content: "hi" } });
    assert.deepEqual(await performSoftAct(act({ kind: "correct", messageId: "901", text: "rivers, I mean" }), deps(dm)), { status: "done" });
    assert.deepEqual(await performSoftAct(act({ kind: "correct", messageId: "900", text: "x" }), deps(dm)),
      { status: "refused", reason: "not_editable" });
    assert.deepEqual(done, ["edit:901:~~otters live in deserts~~ rivers, I mean"]);
  });

  it("a callback replies to where the joke began; a search without a key is refused", async () => {
    const { dm, done, sent } = fakeDm({ "900": { content: "https://tenor.com/view/x-gif-1234567" } });
    assert.deepEqual(await performSoftAct(act({ kind: "callback", url: "https://tenor.com/view/x-gif-1234567", replyTo: "900" }), deps(dm)), { status: "done" });
    assert.deepEqual(await performSoftAct(act({ kind: "callback", gifQuery: "otter" }), deps(dm)),
      { status: "refused", reason: "gif_search_unavailable" });
    assert.deepEqual(await performSoftAct(act({ kind: "callback", gifQuery: "otter" }), deps(dm, {
      gifSearchAvailable: () => true, searchGif: async (query) => `https://gif.example/${query}`,
    })), { status: "done" });
    assert.deepEqual(done, ["reply:900:https://tenor.com/view/x-gif-1234567"]);
    assert.deepEqual(sent, ["https://gif.example/otter"]);
  });

  it("pins once and sends a card as an embed", async () => {
    const { dm, done, sent } = fakeDm({ "900": { content: "a moment" }, "901": { content: "kept", pinned: true } });
    assert.deepEqual(await performSoftAct(act({ kind: "pin", messageId: "900" }), deps(dm)), { status: "done" });
    assert.deepEqual(await performSoftAct(act({ kind: "pin", messageId: "901" }), deps(dm)), { status: "done" });
    assert.deepEqual(done, ["pin:900"]);
    await performSoftAct(act({ kind: "card", cardKind: "question", title: "Why otters?", body: "Keep this one." }), deps(dm));
    const card = sent[0] as { embeds: Array<{ data: { title: string; description: string } }> };
    assert.equal(card.embeds[0]!.data.title, "Why otters?");
    assert.equal(card.embeds[0]!.data.description, "Keep this one.");
  });

  it("her face needs its art, and she wakes into the face she chose", async () => {
    const { dm } = fakeDm({});
    const worn: Buffer[] = [];
    const base = deps(dm, { setAvatar: async (bytes) => { worn.push(bytes); } });
    assert.deepEqual(await performSoftAct(act({ kind: "face", wardrobeId: "weather-rain" }), base),
      { status: "refused", reason: "art_missing" });
    const withArt = { ...base, readArt: (id: string) => (id === "avatar/weather-rain.png" ? Buffer.from("rain") : null) };
    assert.deepEqual(await performSoftAct(act({ kind: "face", wardrobeId: "weather-rain" }), withArt), { status: "done" });
    assert.equal(worn.length, 1);
    const memory = loadFaceMemory(base.dataDir);
    assert.equal(memory.chosenId, "avatar/weather-rain.png");
    assert.deepEqual(avatarChoice("awake", true, memory.chosenId), { id: "avatar/weather-rain.png", sleeping: false });
    saveFaceMemory({ ...emptyFaceMemory(), sleeping: true }, base.dataDir);
    assert.deepEqual(await performSoftAct(act({ kind: "face", wardrobeId: "weather-rain" }), withArt), { status: "done", reason: "worn_at_wake" });
    assert.equal(worn.length, 1, "asleep: chosen now, worn when she wakes");
  });

  it("paces by her shape: an aside comes quickly, a letter takes its time, a burst runs fast", () => {
    assert.equal(shapedLeadMs(undefined, 200), typingLeadMs(200));
    assert.ok(shapedLeadMs("aside", 200) <= 900);
    assert.ok(shapedLeadMs("letter", 600) > typingLeadMs(600));
    assert.ok(shapedLeadMs("letter", 10_000) <= 4_000);
    assert.equal(shapedGapMs("burst", 6_000, 20_000), 1_500);
    assert.equal(shapedGapMs("burst", 6_000, 500), 500);
    assert.equal(shapedGapMs("aside", 6_000, 20_000), 6_000);
  });
});
