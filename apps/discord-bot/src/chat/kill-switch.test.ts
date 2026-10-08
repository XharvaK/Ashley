import test from "node:test";
import assert from "node:assert/strict";
import { createKillSwitchHandler, readKillSwitch } from "./kill-switch.js";

function harness() {
  const calls: string[] = [];
  const handle = createKillSwitchHandler({
    isOwner: (id) => id === "owner",
    abort: (channelId) => calls.push(`abort:${channelId}`),
    pause: async () => calls.push("pause"),
    resume: async () => calls.push("resume"),
  });
  const message = (authorId: string | undefined, content: string) => ({
    content,
    author: authorId ? { id: authorId } : null,
    channel: { id: "room-1" },
    reply: async (text: string) => calls.push(`reply:${text.length > 0}`),
  });
  return { calls, handle, message };
}

test("bare words still read as the switch", () => {
  assert.equal(readKillSwitch("stop"), "pause");
  assert.equal(readKillSwitch("devam!"), "resume");
  assert.equal(readKillSwitch("stop the retry loop"), null);
});

test("the Owner's stop pauses her and aborts the channel", async () => {
  const { calls, handle, message } = harness();
  assert.equal(await handle(message("owner", "stop")), true);
  assert.deepEqual(calls, ["abort:room-1", "pause", "reply:true"]);
});

test("a guest's stop is ordinary conversation and touches nothing", async () => {
  const { calls, handle, message } = harness();
  assert.equal(await handle(message("guest", "stop")), false);
  assert.equal(await handle(message("guest", "go on")), false);
  assert.equal(await handle(message(undefined, "stop")), false);
  assert.deepEqual(calls, []);
});
