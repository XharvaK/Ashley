import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  classifyEligibility,
  readEligibilityBundle,
  upsertTrustedRoom,
} from "./social-authority.js";
import {
  isRoomSeedActive,
  seedTrustedRoomsFromOwnerConfig,
  seedTrustedRoomsFromOwnerEnvironment,
} from "./room-seeding.js";

const source = {
  ownerId: "owner-1",
  addedBy: "owner-config",
  sourceSpan: { source: "DISCORD_ALLOWED_CHANNELS" },
};

function dbFixture(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

describe("trusted-room owner-config seeding", () => {
  it("does not create room authority when the representation is absent", () => {
    const db = dbFixture();
    try {
      expect(seedTrustedRoomsFromOwnerEnvironment(db, {
        ownerId: "owner-1",
        env: {},
        nowMs: 1_000,
      })).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM trusted_rooms").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("projects the exact configured room at startup and keeps the gate separate", () => {
    const db = dbFixture();
    try {
      const env = {
        DISCORD_GUILD_ID: " guild-1 ",
        DISCORD_ALLOWED_CHANNELS: " , channel-1, ",
        RA_ROOM_SEED_ACTIVE: "false",
      };
      seedTrustedRoomsFromOwnerEnvironment(db, { ownerId: "owner-1", env, nowMs: 1_000 });
      const before = db.prepare(
        "SELECT guild_id, channel_id, mode, provenance FROM trusted_rooms",
      ).all();
      const revisionBeforeReseed = Number((db.prepare(
        "SELECT revision FROM authority_transition_barrier WHERE barrier_id = 'global'",
      ).get() as { revision: number }).revision);

      seedTrustedRoomsFromOwnerEnvironment(db, { ownerId: "owner-1", env, nowMs: 2_000 });
      expect(db.prepare(
        "SELECT guild_id, channel_id, mode, provenance FROM trusted_rooms",
      ).all()).toEqual(before);
      expect(Number((db.prepare(
        "SELECT revision FROM authority_transition_barrier WHERE barrier_id = 'global'",
      ).get() as { revision: number }).revision)).toBe(revisionBeforeReseed);
      expect(before).toEqual([{
        guild_id: "guild-1",
        channel_id: "channel-1",
        mode: "trusted_social",
        provenance: "seeded_from_owner_config",
      }]);

      const bundle = readEligibilityBundle(db, {
        guildId: "guild-1",
        channelId: "channel-1",
        nowMs: 3_000,
      });
      expect(classifyEligibility(bundle, "room").verdict).toBe("capture_quarantine");
    } finally {
      db.close();
    }
  });

  it("fails closed when room seeding is enabled without a complete target", () => {
    const db = dbFixture();
    try {
      expect(() => seedTrustedRoomsFromOwnerEnvironment(db, {
        ownerId: "owner-1",
        env: {
          DISCORD_ALLOWED_CHANNELS: "channel-only",
          RA_ROOM_SEED_ACTIVE: "true",
        },
        nowMs: 1_000,
      })).toThrow("trusted_room_seed_configuration_required");
      expect(() => seedTrustedRoomsFromOwnerEnvironment(db, {
        ownerId: "owner-1",
        env: {
          DISCORD_GUILD_ID: "guild-1",
          DISCORD_ALLOWED_CHANNELS: " , ",
          RA_ROOM_SEED_ACTIVE: "true",
        },
        nowMs: 2_000,
      })).toThrow("trusted_room_seed_configuration_required");
      expect(db.prepare("SELECT COUNT(*) AS count FROM trusted_rooms").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("delegates restart seeding without resurrecting a canonical narrowing", () => {
    const db = dbFixture();
    try {
      const env = {
        DISCORD_GUILD_ID: "guild-1",
        DISCORD_ALLOWED_CHANNELS: "channel-1",
      };
      seedTrustedRoomsFromOwnerEnvironment(db, { ownerId: "owner-1", env, nowMs: 1_000 });
      const room = db.prepare(
        "SELECT entity_uuid FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get("guild-1", "channel-1") as { entity_uuid: string };
      upsertTrustedRoom(db, {
        ownerId: "owner-1",
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "observe_only",
        provenance: "explicit_config",
        addedBy: "owner",
        expectedMode: "trusted_social",
        nowMs: 2_000,
      });

      seedTrustedRoomsFromOwnerEnvironment(db, { ownerId: "owner-1", env, nowMs: 3_000 });
      expect(db.prepare(
        "SELECT entity_uuid, mode FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get("guild-1", "channel-1")).toEqual({
        entity_uuid: room.entity_uuid,
        mode: "observe_only",
      });
    } finally {
      db.close();
    }
  });

  it("is idempotent and preserves canonical narrowing", () => {
    const db = dbFixture();
    try {
      seedTrustedRoomsFromOwnerConfig(db, {
        guildId: "guild-1",
        channelIds: ["channel-1", "channel-2"],
        source,
        nowMs: 1_000,
      });
      const before = db.prepare(
        `SELECT guild_id, channel_id, mode, provenance, source_span_json
           FROM trusted_rooms ORDER BY channel_id`,
      ).all();
      const revisionBeforeReseed = Number((db.prepare(
        "SELECT revision FROM authority_transition_barrier WHERE barrier_id = 'global'",
      ).get() as { revision: number }).revision);

      seedTrustedRoomsFromOwnerConfig(db, {
        guildId: "guild-1",
        channelIds: ["channel-1", "channel-2"],
        source,
        nowMs: 2_000,
      });
      expect(db.prepare(
        `SELECT guild_id, channel_id, mode, provenance, source_span_json
           FROM trusted_rooms ORDER BY channel_id`,
      ).all()).toEqual(before);
      expect(Number((db.prepare(
        "SELECT revision FROM authority_transition_barrier WHERE barrier_id = 'global'",
      ).get() as { revision: number }).revision)).toBe(revisionBeforeReseed);

      const room = db.prepare(
        "SELECT entity_uuid, mode FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get("guild-1", "channel-1") as { entity_uuid: string; mode: string };
      upsertTrustedRoom(db, {
        ownerId: source.ownerId,
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "observe_only",
        provenance: "explicit_config",
        addedBy: "owner",
        expectedMode: "trusted_social",
        sourceSpan: { source: "test-narrow" },
        nowMs: 3_000,
      });
      seedTrustedRoomsFromOwnerConfig(db, {
        guildId: "guild-1",
        channelIds: ["channel-1"],
        source,
        nowMs: 4_000,
      });
      expect(db.prepare(
        "SELECT entity_uuid, mode FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get("guild-1", "channel-1")).toEqual({ entity_uuid: room.entity_uuid, mode: "observe_only" });
    } finally {
      db.close();
    }
  });

  it("does not delete removed canonical rooms or resurrect explicit disengagement", () => {
    const db = dbFixture();
    try {
      seedTrustedRoomsFromOwnerConfig(db, {
        guildId: "guild-2",
        channelIds: ["channel-removed"],
        source,
        nowMs: 1_000,
      });
      const room = db.prepare(
        "SELECT entity_uuid FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get("guild-2", "channel-removed") as { entity_uuid: string };
      upsertTrustedRoom(db, {
        ownerId: source.ownerId,
        guildId: "guild-2",
        channelId: "channel-removed",
        mode: "disengaged",
        provenance: "explicit_config",
        addedBy: "owner",
        expectedMode: "trusted_social",
        nowMs: 2_000,
      });
      seedTrustedRoomsFromOwnerConfig(db, {
        guildId: "guild-2",
        channelIds: [],
        source,
        nowMs: 3_000,
      });
      seedTrustedRoomsFromOwnerConfig(db, {
        guildId: "guild-2",
        channelIds: ["channel-removed"],
        source,
        nowMs: 4_000,
      });
      expect(db.prepare(
        "SELECT entity_uuid, mode FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get("guild-2", "channel-removed")).toEqual({ entity_uuid: room.entity_uuid, mode: "disengaged" });
    } finally {
      db.close();
    }
  });

  it("isolates an ambiguous seed as restricted and defaults the gate off", () => {
    const db = dbFixture();
    try {
      seedTrustedRoomsFromOwnerConfig(db, {
        guildId: "guild-3",
        channelIds: ["channel-3"],
        source,
        nowMs: 500,
      });
      const roomBundle = readEligibilityBundle(db, {
        guildId: "guild-3",
        channelId: "channel-3",
        nowMs: 600,
      });
      expect(classifyEligibility(roomBundle, "room").verdict).toBe("capture_quarantine");
      expect(classifyEligibility(roomBundle, "room", { roomSeedActive: true }).verdict).toBe("allow_social");

      seedTrustedRoomsFromOwnerConfig(db, {
        channelIds: ["ambiguous-channel"],
        source,
        nowMs: 1_000,
      });
      expect(db.prepare(
        "SELECT guild_id, channel_id, mode, source_span_json FROM trusted_rooms WHERE channel_id = ?",
      ).get("ambiguous-channel")).toMatchObject({
        guild_id: "ambiguous",
        channel_id: "ambiguous-channel",
        mode: "disengaged",
      });
      expect(String((db.prepare(
        "SELECT source_span_json FROM trusted_rooms WHERE channel_id = ?",
      ).get("ambiguous-channel") as { source_span_json: string }).source_span_json)).toContain("ambiguous_isolated");
      expect(isRoomSeedActive({})).toBe(false);
      expect(isRoomSeedActive({ RA_ROOM_SEED_ACTIVE: "true" })).toBe(true);
      expect(isRoomSeedActive({ RA_ROOM_SEED_ACTIVE: "1" })).toBe(true);
      expect(isRoomSeedActive({ RA_ROOM_SEED_ACTIVE: "invalid" })).toBe(false);
    } finally {
      db.close();
    }
  });
});
