import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerIngressRouteForMessage, ownerRoomContextForMessage } from "./gate.js";

function discordMessage(input: {
  authorId: string;
  guildId?: string;
  channelId?: string;
  bot?: boolean;
}) {
  return {
    author: { id: input.authorId, bot: input.bot ?? false },
    guild: input.guildId ? { id: input.guildId } : null,
    channel: { id: input.channelId ?? "room-channel" },
  } as never;
}

const roomOptions = {
  ownerId: "owner-1",
  guildId: "guild-1",
  channelIds: ["room-channel"],
  roomSeedActive: true,
  publicationChannelId: "room-channel",
};

test("owner room context requires authenticated Owner and the exact staged room", () => {
  assert.deepEqual(
    ownerRoomContextForMessage(
      discordMessage({ authorId: "owner-1", guildId: "guild-1" }),
      roomOptions,
    ),
    { guildId: "guild-1", channelId: "room-channel" },
  );
  assert.equal(
    ownerRoomContextForMessage(discordMessage({ authorId: "owner-1" }), roomOptions),
    undefined,
  );
  assert.equal(
    ownerRoomContextForMessage(
      discordMessage({ authorId: "owner-1", guildId: "other-guild" }),
      roomOptions,
    ),
    undefined,
  );
  assert.equal(
    ownerRoomContextForMessage(
      discordMessage({ authorId: "person-1", guildId: "guild-1" }),
      roomOptions,
    ),
    undefined,
  );
});

test("Owner ingress distinguishes private DM, active room, and rejected guild routes", () => {
  assert.deepEqual(
    ownerIngressRouteForMessage(discordMessage({ authorId: "owner-1" }), roomOptions),
    { kind: "private_owner_dm" },
  );
  assert.deepEqual(
    ownerIngressRouteForMessage(
      discordMessage({ authorId: "owner-1", guildId: "guild-1" }),
      roomOptions,
    ),
    {
      kind: "owner_trusted_room",
      context: { guildId: "guild-1", channelId: "room-channel" },
    },
  );
  assert.deepEqual(
    ownerIngressRouteForMessage(
      discordMessage({ authorId: "owner-1", guildId: "guild-1" }),
      { ...roomOptions, roomSeedActive: false },
    ),
    { kind: "reject_owner_guild" },
  );
  assert.deepEqual(
    ownerIngressRouteForMessage(
      discordMessage({ authorId: "owner-1", guildId: "other-guild" }),
      roomOptions,
    ),
    { kind: "reject_owner_guild" },
  );
  assert.deepEqual(
    ownerIngressRouteForMessage(
      discordMessage({ authorId: "owner-1", guildId: "guild-1", channelId: "wrong-channel" }),
      roomOptions,
    ),
    { kind: "reject_owner_guild" },
  );
  assert.deepEqual(
    ownerIngressRouteForMessage(
      discordMessage({ authorId: "owner-1", guildId: "guild-1" }),
      { ...roomOptions, publicationChannelId: "other-channel" },
    ),
    { kind: "reject_owner_guild" },
  );
});
