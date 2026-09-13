import test from "node:test";
import assert from "node:assert/strict";
import { ChannelQueue } from "../chat/channel-queue.js";
import { createMessageCreateHandler } from "./messageCreate.js";

function message(id: string, content: string) {
  return {
    id,
    content,
    channel: { id: "channel-1" },
    attachments: new Map(),
    stickers: new Map(),
    embeds: [],
  } as never;
}

test("Discord ingress admits B while the first Thought/agent request is pending", async () => {
    let releaseA!: () => void;
    const aFinished = new Promise<void>((resolve) => { releaseA = resolve; });
    const admitted: string[] = [];
    let bResolved = false;
    const handler = createMessageCreateHandler({
      channelQueue: new ChannelQueue(),
      quietMs: 1,
      hardCapMs: 10,
      ingressChat: async (text) => {
        admitted.push(text);
        if (text === "A") await aFinished;
        if (text === "B") bResolved = true;
      },
    });

    await handler.handleMessage(message("d1", "A"));
    void handler.flushForTest("channel-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(admitted, ["A"]);

    await handler.handleMessage(message("d2", "B"));
    await handler.flushForTest("channel-1");
    assert.deepEqual(admitted, ["A", "B"]);
    assert.equal(bResolved, true);

    releaseA();
    await aFinished;
});

test("current ingress fails closed when durable admission fails", async () => {
  const replies: string[] = [];
  const target = message("d4", "must not reach legacy") as {
    reply?: (content: string) => Promise<unknown>;
  };
  target.reply = async (content: string) => {
    replies.push(content);
  };
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async () => {
      throw new Error("sidecar_unavailable");
    },
  });

  await handler.handleMessage(target as never);
  await handler.flushForTest("channel-1");
  assert.equal(replies.length, 1);
});
