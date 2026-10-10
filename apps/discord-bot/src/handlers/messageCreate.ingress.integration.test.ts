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

function ownerMessage(
  id: string,
  content: string,
  input: { channelId?: string; guildId?: string },
) {
  return {
    id,
    content,
    author: { id: "owner-1", bot: false },
    channel: { id: input.channelId ?? "channel-1" },
    guild: input.guildId ? { id: input.guildId } : null,
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

test("Owner transport is durably captured before the RAM-only buffer", async () => {
  const events: string[] = [];
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    captureOwnerTransport: async (capture) => {
      events.push(`capture:${capture.discordMessageId}`);
    },
    ingressChat: async (_text, options) => {
      events.push(`ingress:${options?.inboundDiscordMessageIds?.join(",")}`);
    },
  });

  await handler.handleMessage(ownerMessage("owner-capture-1", "captured first", {}));
  await handler.flushForTest("channel-1");

  assert.deepEqual(events, ["capture:owner-capture-1", "ingress:owner-capture-1"]);
});

test("Owner transport is marked admitted only after canonical ingress succeeds", async () => {
  const events: string[] = [];
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    captureOwnerTransport: async () => {
      events.push("capture");
    },
    ingressChat: async () => {
      events.push("ingress");
    },
    markOwnerTransportAdmitted: async (ids) => {
      events.push(`mark:${ids.join(",")}`);
    },
  });

  await handler.handleMessage(ownerMessage("owner-capture-ordered", "ordered", {}));
  await handler.flushForTest("channel-1");

  assert.deepEqual(events, ["capture", "ingress", "mark:owner-capture-ordered"]);
});

test("Owner transport capture failure does not place the message in the RAM-only buffer", async () => {
  let ingresses = 0;
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    captureOwnerTransport: async () => {
      throw new Error("transport_capture_unavailable");
    },
    ingressChat: async () => {
      ingresses += 1;
    },
  });

  await handler.handleMessage(ownerMessage("owner-capture-2", "must recover from history", {}));
  await handler.flushForTest("channel-1");

  assert.equal(ingresses, 0);
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

test("Owner trusted-room context uses Owner ingress and reaches the room-aware options", async () => {
  let captureCalls = 0;
  let admittedOptions: Record<string, unknown> | undefined;
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async (_text, options) => {
      admittedOptions = options as Record<string, unknown>;
    },
    captureExternalChat: async () => {
      captureCalls += 1;
      throw new Error("Owner room must not use external capture");
    },
  });

  await handler.handleMessage(
    ownerMessage("owner-room-1", "hello room", { guildId: "guild-1", channelId: "room-channel" }),
    { ownerRoomContext: { guildId: "guild-1", channelId: "room-channel" } },
  );
  await handler.flushForTest("room-channel");

  assert.equal(captureCalls, 0);
  assert.deepEqual(admittedOptions?.ownerRoomContext, {
    guildId: "guild-1",
    channelId: "room-channel",
  });
});

test("Owner DM remains on the existing private ingress without room context", async () => {
  let admittedOptions: Record<string, unknown> | undefined;
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async (_text, options) => {
      admittedOptions = options as Record<string, unknown>;
    },
  });

  await handler.handleMessage(ownerMessage("owner-dm-1", "hello private", {}));
  await handler.flushForTest("channel-1");

  assert.equal(admittedOptions?.ownerRoomContext, undefined);
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

test("Owner plain text that starts with a slash reaches ingress as text (A6-13)", async () => {
  const admitted: string[] = [];
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async (text) => {
      admitted.push(text);
    },
  });

  await handler.handleMessage(ownerMessage("slash-text-1", "/ 2 cents on the rent", {}));
  await handler.flushForTest("channel-1");

  assert.deepEqual(admitted, ["/ 2 cents on the rent"]);
});

test("the turn's attachment cap counts images only and never drops a text file (A6-8)", async () => {
  let admittedAttachments: Array<{ fileName: string; sourceClass?: string }> = [];
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ingressChat: async (_text, options) => {
      admittedAttachments = (options?.attachments ?? []) as Array<{ fileName: string; sourceClass?: string }>;
    },
  });
  const images = [1, 2, 3, 4, 5].map((n) => ({
    id: `img-${n}`,
    url: `https://cdn.example/img-${n}.png`,
    contentType: "image/png",
    name: `img-${n}.png`,
  }));
  await handler.handleMessage(message("att-cap-2", "look", [
    ...images,
    { id: "notes", url: "https://cdn.example/notes.txt", contentType: "text/plain", name: "notes.txt" },
  ]));
  await handler.flushForTest("channel-1");

  const imageRefs = admittedAttachments.filter((ref) => ref.sourceClass !== undefined);
  const textRefs = admittedAttachments.filter((ref) => ref.sourceClass === undefined);
  assert.equal(imageRefs.length, 4);
  assert.deepEqual(textRefs.map((ref) => ref.fileName), ["notes.txt"]);
});

test("an Owner message held by the pending queue is not buffered and is replayed in order (A6-1)", async () => {
  const { createOwnerCaptureQueue } = await import("../chat/owner-capture-pending.js");
  let agentUp = false;
  const captured: string[] = [];
  let ingresses = 0;
  const queue = createOwnerCaptureQueue<{ discordMessageId: string; message: string }>({
    capture: async (capture) => {
      if (!agentUp) throw new Error("ECONNREFUSED");
      captured.push(capture.discordMessageId);
    },
    store: { load: () => [], save: () => undefined },
    schedule: () => undefined,
    log: { warn: () => undefined, error: () => undefined },
  });
  const handler = createMessageCreateHandler({
    quietMs: 1,
    hardCapMs: 10,
    ownerCapture: queue as never,
    ingressChat: async () => {
      ingresses += 1;
    },
  });

  await handler.handleMessage(ownerMessage("held-1", "first", {}));
  await handler.handleMessage(ownerMessage("held-2", "second", {}));
  await handler.flushForTest("channel-1");
  assert.equal(ingresses, 0);
  assert.equal(queue.pending(), 2);

  agentUp = true;
  await queue.flush();
  assert.deepEqual(captured, ["held-1", "held-2"]);
  assert.equal(ingresses, 0);
});

test("a joined Owner turn over the agent limit is sent in parts it accepts, each id once (A6-7)", async () => {
  const calls: Array<{ text: string; ids: string[] }> = [];
  const handler = createMessageCreateHandler({
    quietMs: 1_000,
    hardCapMs: 5_000,
    ingressChat: async (text, options) => {
      calls.push({ text, ids: options?.inboundDiscordMessageIds ?? [] });
    },
  });

  await handler.handleMessage(ownerMessage("big-1", "a".repeat(2_500), {}));
  await handler.handleMessage(ownerMessage("big-2", "b".repeat(2_500), {}));
  await handler.flushForTest("channel-1");

  assert.ok(calls.length >= 2);
  for (const call of calls) assert.ok(call.text.length <= 4_000);
  assert.deepEqual(calls.flatMap((call) => call.ids), ["big-1", "big-2"]);
  assert.equal(calls.map((call) => call.text).join("").replace(/[^ab]/g, "").length, 5_000);
});
