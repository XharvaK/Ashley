import test from "node:test";
import assert from "node:assert/strict";
import {
  groupOwnerTransportCaptures,
  reconcileOwnerTransportSurface,
  replayPendingOwnerTransport,
  type OwnerTransportPendingCapture,
  type OwnerTransportRecoveryApi,
} from "./owner-transport-recovery.js";
import { config } from "../config.js";

function capture(
  id: string,
  sentAtMs: number,
  surfaceKey = "owner-dm:channel-1",
): OwnerTransportPendingCapture {
  return {
    discordMessageId: id,
    ownerId: "owner-1",
    surfaceKey,
    channelId: "channel-1",
    guildId: null,
    text: id,
    attachments: [],
    ownerRoomContext: null,
    sentAtMs,
    capturedAtMs: sentAtMs + 1,
    source: "history",
  };
}

test("recovery keeps rapid fragments together and separate historical turns apart", () => {
  const groups = groupOwnerTransportCaptures([
    capture("1", 1_700_000_000_000),
    capture("2", 1_700_000_000_900),
    capture("3", 1_700_000_003_000),
  ]);

  assert.deepEqual(groups.map((group) => group.map((item) => item.discordMessageId)), [
    ["1", "2"],
    ["3"],
  ]);
});

test("recovery never merges captures from different authorized surfaces", () => {
  const groups = groupOwnerTransportCaptures([
    capture("dm-1", 1_700_000_000_000, "owner-dm:dm"),
    capture("room-1", 1_700_000_000_100, "owner-room:guild:room"),
  ]);

  assert.deepEqual(groups.map((group) => group.map((item) => item.discordMessageId)), [
    ["dm-1"],
    ["room-1"],
  ]);
});

test("pending transport replay uses canonical ingress before marking admission", async () => {
  const events: string[] = [];
  let listed = true;
  const pending = [
    capture("1", 1_700_000_000_000),
    capture("2", 1_700_000_000_700),
  ];
  await replayPendingOwnerTransport({
    state: async () => ({ initialized: true, surfaceKey: "owner-dm:channel-1", afterMessageId: "0" }),
    historyPage: async () => ({ accepted: true, surfaceKey: "owner-dm:channel-1", afterMessageId: "1", newlyCaptured: 0, duplicates: 0 }),
    pending: async () => {
      if (!listed) return { captures: [] };
      listed = false;
      return { captures: pending };
    },
    ingress: async (text, options) => {
      events.push(`ingress:${text}:${options?.inboundDiscordMessageIds?.join(",")}`);
    },
    admitted: async (ids) => {
      events.push(`admitted:${ids.join(",")}`);
      return { ok: true, marked: ids.length, alreadyAdmitted: 0 };
    },
    capture: async () => ({ captured: true, duplicate: false, surfaceKey: "owner-dm:channel-1" }),
  });

  assert.deepEqual(events, [
    "ingress:1\n2:1,2",
    "admitted:1,2",
  ]);
});

test("history API failure leaves the durable cursor untouched", async () => {
  const previousOwnerId = config.ownerId;
  config.ownerId = "owner-1";
  let historyPages = 0;
  const message = {
    id: "101",
    content: "missed while offline",
    createdTimestamp: 1_700_000_000_100,
    author: { id: "owner-1", bot: false },
    channel: { id: "dm-channel-1", isDMBased: () => true },
    guild: null,
    attachments: new Map(),
    stickers: new Map(),
    embeds: [],
    mentions: { users: new Map() },
  } as never;
  const client = {
    user: { id: "ashley-bot" },
    users: {
      fetch: async () => ({
        createDM: async () => ({
          id: "dm-channel-1",
          messages: {
            fetch: async () => ({ values: () => [message][Symbol.iterator]() }),
          },
        }),
      }),
    },
  } as never;
  const api: OwnerTransportRecoveryApi = {
    state: async () => ({ initialized: true, surfaceKey: "owner-dm:owner-1:dm-channel-1", afterMessageId: "100" }),
    historyPage: async () => {
      historyPages += 1;
      throw new Error("agent_unavailable");
    },
    pending: async () => ({ captures: [] }),
    admitted: async () => ({ ok: true, marked: 0, alreadyAdmitted: 0 }),
    ingress: async () => undefined,
    capture: async () => ({ captured: true, duplicate: false, surfaceKey: "owner-dm:owner-1:dm-channel-1" }),
  };
  try {
    await assert.rejects(
      reconcileOwnerTransportSurface(client, { channelId: "dm-channel-1" }, api, "test"),
      /agent_unavailable/,
    );
    assert.equal(historyPages, 1);
  } finally {
    config.ownerId = previousOwnerId;
  }
});

test("history reconcile keeps an Owner message that starts with a slash (A6-13)", async () => {
  const captured: string[][] = [];
  const message = {
    id: "slash-history-1",
    content: "/ 2 cents on the rent",
    author: { id: config.ownerId, bot: false },
    channel: { id: "dm-channel" },
    guild: null,
    createdTimestamp: 1_700_000_000_000,
    attachments: new Map(),
    stickers: new Map(),
    embeds: [],
    mentions: { users: new Map() },
  };
  const history = new Map([[message.id, message]]);
  const client = {
    user: { id: "ashley-bot" },
    users: {
      fetch: async () => ({
        createDM: async () => ({ messages: { fetch: async () => history } }),
      }),
    },
  } as never;
  const api: OwnerTransportRecoveryApi = {
    state: async (surface) => ({ initialized: true, surfaceKey: `dm:${surface.channelId}`, afterMessageId: "0" }),
    historyPage: async (input) => {
      captured.push(input.messages.map((item) => item.message));
      return { accepted: true, surfaceKey: "dm", afterMessageId: input.nextAfterMessageId, newlyCaptured: input.messages.length, duplicates: 0 };
    },
    pending: async () => [],
    admitted: async () => ({ ok: true, marked: 0, alreadyAdmitted: 0 }),
    ingress: async () => undefined,
    capture: async () => ({ captured: true, duplicate: false, surfaceKey: "dm" }),
  } as never;

  await reconcileOwnerTransportSurface(client, { channelId: "dm-channel" }, api, "test");

  assert.deepEqual(captured, [["/ 2 cents on the rent"]]);
});
