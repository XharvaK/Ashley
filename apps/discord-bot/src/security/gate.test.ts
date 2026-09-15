import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerRoomContextForMessage } from "./gate.js";

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
