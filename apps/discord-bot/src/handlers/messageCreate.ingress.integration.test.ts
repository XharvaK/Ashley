import test from "node:test";
import assert from "node:assert/strict";
import { ChannelQueue } from "../chat/channel-queue.js";
import { createMessageCreateHandler } from "./messageCreate.js";

function message(
  id: string,
  content: string,
  attachments: Array<{
    id: string;
    url: string;
    contentType: string | null;
    name?: string;
  }> = [],
) {
  return {
    id,
    content,
    channel: { id: "channel-1" },
    attachments: new Map(
      attachments.map((attachment) => [
        attachment.id,
        { duration: null, size: 0, ...attachment },
      ]),
    ),
    stickers: new Map(),
    embeds: [],
  } as never;
}

function externalMessage(
  id: string,
  content: string,
  input: {
    authorId: string;
    bot?: boolean;
    channelId?: string;
    guildId?: string;
  },
) {
  return {
    id,
    content,
    author: { id: input.authorId, bot: input.bot ?? false },
    channel: { id: input.channelId ?? "dm-channel" },
    guild: input.guildId ? { id: input.guildId } : null,
    client: { user: { id: "ashley-bot" } },
    attachments: new Map(),
    stickers: new Map(),
    embeds: [],
    mentions: { users: new Map() },
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

test("textless passive text attachment reaches ingress", async () => {
  const admitted: string[] = [];
  const attachment = {
    id: "notes.txt",
    url: "https://cdn.example/notes.txt",
    contentType: "text/plain",
    name: "notes.txt",
  };
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async (text, options) => {
      admitted.push(text);
      assert.equal(options?.hasIngestibleTextAttachment, true);
    },
  });

  await handler.handleMessage(message("d5", "", [attachment]));
  await handler.flushForTest("channel-1");

  assert.equal(admitted.length, 1);
  assert.match(admitted[0]!, /attached text file/);
});

test("empty message without an attachment remains dropped", async () => {
  let calls = 0;
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async () => {
      calls += 1;
    },
  });

  await handler.handleMessage(message("d6", ""));
  await handler.flushForTest("channel-1");

  assert.equal(calls, 0);
});

test("external capture completes before the reference enters the buffer", async () => {
  const events: string[] = [];
  const batches: Array<{ refs: string[]; key: string }> = [];
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async () => {
      throw new Error("external must not use owner ingress");
    },
    captureExternalChat: async (_envelope, _text, options) => {
      events.push(`capture:${options?.gateHint}`);
      return {
        captureRef: "extcap:1",
        conversationKey: "dm:ashley-bot:person-1",
        duplicate: false,
      };
    },
    ingressExternalBatch: async (refs, conversationKey) => {
      events.push("buffered");
      batches.push({ refs, key: conversationKey });
      return { results: [] };
    },
  });

  await handler.handleMessage(
    externalMessage("dm-1", "hello", { authorId: "person-1" }),
    { gateVerdict: "allow_social" },
  );
  assert.deepEqual(events, ["capture:allow_social"]);
  await handler.flushForTest("dm:ashley-bot:person-1");

  assert.deepEqual(events, ["capture:allow_social", "buffered"]);
  assert.deepEqual(batches, [{
    refs: ["extcap:1"],
    key: "dm:ashley-bot:person-1",
  }]);
});

test("valid external empty messages are captured", async () => {
  let capturedText: string | undefined;
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async () => {
      throw new Error("external must not use owner ingress");
    },
    captureExternalChat: async (_envelope, text) => {
      capturedText = text;
      return {
        captureRef: "extcap:empty",
        conversationKey: "dm:ashley-bot:person-1",
        duplicate: false,
      };
    },
  });

  await handler.handleMessage(
    externalMessage("dm-empty", "", { authorId: "person-1" }),
    { gateVerdict: "capture_quarantine" },
  );

  assert.equal(capturedText, "");
});

test("external DMs use separate keys while room messages share the room key", async () => {
  const batches: Array<{ refs: string[]; key: string }> = [];
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async () => {
      throw new Error("external must not use owner ingress");
    },
    captureExternalChat: async (envelope) => {
      const location = envelope.location;
      const conversationKey = location.kind === "external_dm"
        ? `dm:ashley-bot:${location.principalId}`
        : `room:${location.guildId}:${location.channelId}`;
      return {
        captureRef: `extcap:${envelope.discordMessageId}`,
        conversationKey,
        duplicate: false,
      };
    },
    ingressExternalBatch: async (refs, conversationKey) => {
      batches.push({ refs, key: conversationKey });
      return { results: [] };
    },
  });

  await handler.handleMessage(
    externalMessage("dm-1", "one", { authorId: "person-1", channelId: "dm-1" }),
    { gateVerdict: "allow_social" },
  );
  await handler.handleMessage(
    externalMessage("dm-2", "two", { authorId: "person-2", channelId: "dm-2" }),
    { gateVerdict: "allow_social" },
  );
  await handler.flushForTest("dm:ashley-bot:person-1");
  await handler.flushForTest("dm:ashley-bot:person-2");

  await handler.handleMessage(
    externalMessage("room-1", "one", {
      authorId: "person-1",
      channelId: "room-channel",
      guildId: "guild-1",
    }),
    { gateVerdict: "allow_social" },
  );
  await handler.handleMessage(
    externalMessage("room-2", "two", {
      authorId: "room-bot-1",
      bot: true,
      channelId: "room-channel",
      guildId: "guild-1",
    }),
    { gateVerdict: "allow_social" },
  );
  await handler.flushForTest("room:guild-1:room-channel");

  assert.deepEqual(batches, [
    { refs: ["extcap:dm-1"], key: "dm:ashley-bot:person-1" },
    { refs: ["extcap:dm-2"], key: "dm:ashley-bot:person-2" },
    { refs: ["extcap:room-1", "extcap:room-2"], key: "room:guild-1:room-channel" },
  ]);
});

test("capture failure leaves no external reference buffered", async () => {
  let batches = 0;
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async () => {
      throw new Error("external must not use owner ingress");
    },
    captureExternalChat: async () => {
      throw new Error("capture_unavailable");
    },
    ingressExternalBatch: async () => {
      batches += 1;
      return { results: [] };
    },
  });

  await handler.handleMessage(
    externalMessage("dm-fail", "must retry", { authorId: "person-1" }),
    { gateVerdict: "capture_quarantine" },
  );
  await handler.flushForTest("dm:ashley-bot:person-1");
  assert.equal(batches, 0);
});
