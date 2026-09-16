import test from "node:test";
import assert from "node:assert/strict";
import { Events, type Message } from "discord.js";
import { createClient } from "../client.js";
import { createMessageCreateHandler } from "./messageCreate.js";

function fakeMessage(input: {
  id: string;
  content: string;
  authorId: string;
  channelId: string;
  createdTimestamp: number;
  bot?: boolean;
}): Message {
  return {
    id: input.id,
    content: input.content,
    createdTimestamp: input.createdTimestamp,
    author: { id: input.authorId, bot: input.bot ?? false },
    channel: { id: input.channelId },
    attachments: new Map(),
    stickers: new Map(),
    embeds: [],
    mentions: { users: new Map() },
  } as unknown as Message;
}

test("MessageCreate admission keeps the content snapshot after a later edit", async () => {
  const message = fakeMessage({
    id: "message-snapshot-1",
    content: "captured before edit",
    authorId: "owner-1",
    channelId: "channel-1",
    createdTimestamp: 1_700_000_000_000,
  });
  let admittedText: string | undefined;
  let admittedIds: string[] | undefined;
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async (text, options) => {
      admittedText = text;
      admittedIds = options?.inboundDiscordMessageIds;
    },
  });

  await handler.handleMessage(message);
  message.content = "edited after admission";
  message.createdTimestamp = 1_800_000_000_000;
  await handler.flushForTest("channel-1");

  assert.equal(admittedText, "captured before edit");
  assert.deepEqual(admittedIds, ["message-snapshot-1"]);
});

test("external MessageCreate capture keeps the createdTimestamp snapshot", async () => {
  const message = fakeMessage({
    id: "message-snapshot-2",
    content: "external snapshot",
    authorId: "external-1",
    channelId: "channel-2",
    createdTimestamp: 1_700_000_123_000,
  });
  let captured: { sentAtMs: number; discordMessageId: string } | undefined;
  const handler = createMessageCreateHandler({
    captureExternalChat: async (envelope) => {
      captured = {
        sentAtMs: envelope.sentAtMs,
        discordMessageId: envelope.discordMessageId,
      };
      return { captureRef: "capture-1", conversationKey: "dm:bot-1:external-1" };
    },
    ingressExternalBatch: async () => ({ admitted: true, cycleId: null }),
    botId: "bot-1",
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async () => {
      throw new Error("external MessageCreate must not use owner ingress");
    },
  });

  await handler.handleMessage(message, { gateVerdict: "capture_quarantine" });
  message.content = "edited after capture";
  message.createdTimestamp = 1_800_000_123_000;

  assert.deepEqual(captured, {
    sentAtMs: 1_700_000_123_000,
    discordMessageId: "message-snapshot-2",
  });
});

test("createClient registers MessageCreate without MessageUpdate or MessageDelete", () => {
  const client = createClient();
  try {
    assert.equal(client.listenerCount(Events.MessageCreate), 1);
    assert.equal(client.listenerCount(Events.MessageUpdate), 0);
    assert.equal(client.listenerCount(Events.MessageDelete), 0);
  } finally {
    client.destroy();
  }
});
