import type { DatabaseSync } from "node:sqlite";
import {
  upsertTrustedRoomInExistingTransaction,
  type TrustedRoom,
} from "./social-authority.js";
import { getRaEffectiveConfig } from "./ra-effective-config.js";

export type OwnerRoomSeedSource = {
  ownerId: string;
  addedBy?: string;
  sourceSpan?: unknown;
};

type SeedEnvironment = {
  RA_ROOM_SEED_ACTIVE?: string | boolean;
  raRoomSeedActive?: string | boolean;
};

export type OwnerRoomSeedConfiguration = {
  guildId: string | null;
  channelIds: readonly string[];
};

function required(value: string, code: string): string {
  const result = value.trim();
  if (!result) throw new Error(code);
  return result;
}

function seedJson(sourceSpan: unknown, ambiguous: boolean): unknown {
  if (!ambiguous) return sourceSpan ?? { source: "owner_config" };
  return {
    ...(typeof sourceSpan === "object" && sourceSpan !== null
      ? sourceSpan as Record<string, unknown>
      : { source: "owner_config" }),
    note: "ambiguous_isolated",
  };
}

/** RA_ROOM_SEED_ACTIVE is deliberately false unless explicitly enabled. */
export function isRoomSeedActive(source: SeedEnvironment = process.env): boolean {
  const raw = source.RA_ROOM_SEED_ACTIVE ?? source.raRoomSeedActive;
  return getRaEffectiveConfig({ RA_ROOM_SEED_ACTIVE: raw }).roomSeedActive;
}

/**
 * Parse the existing Discord configuration representation without importing
 * Discord-bot configuration into the agent service. The representation is
 * seeded whenever channels are configured; RA_ROOM_SEED_ACTIVE remains a
 * separate eligibility gate.
 */
export function readOwnerRoomSeedConfiguration(
  source: NodeJS.ProcessEnv = process.env,
): OwnerRoomSeedConfiguration {
  const guildId = source.DISCORD_GUILD_ID?.trim() || null;
  const channelIds = (source.DISCORD_ALLOWED_CHANNELS ?? "")
    .split(",")
    .map((channelId) => channelId.trim())
    .filter(Boolean);
  return { guildId, channelIds };
}

/**
 * Startup adapter for the existing Owner-config seeder. An explicitly active
 * room-seed gate requires one complete, unambiguous guild/channel
 * representation; otherwise startup fails closed before any partial seed.
 */
export function seedTrustedRoomsFromOwnerEnvironment(
  db: DatabaseSync,
  input: {
    ownerId: string;
    env?: NodeJS.ProcessEnv;
    nowMs?: number;
  },
): TrustedRoom[] {
  const source = input.env ?? process.env;
  const configuration = readOwnerRoomSeedConfiguration(source);
  if (
    isRoomSeedActive(source)
    && (!configuration.guildId || configuration.channelIds.length === 0)
  ) {
    throw new Error("trusted_room_seed_configuration_required");
  }
  if (configuration.channelIds.length === 0) return [];
  return seedTrustedRoomsFromOwnerConfig(db, {
    guildId: configuration.guildId,
    channelIds: configuration.channelIds,
    source: {
      ownerId: input.ownerId,
      addedBy: "owner-config",
      sourceSpan: {
        source: "owner_config",
        guild: "DISCORD_GUILD_ID",
        channels: "DISCORD_ALLOWED_CHANNELS",
      },
    },
    nowMs: input.nowMs,
  });
}

/**
 * Copy only the explicit Owner channel representation into the canonical
 * trusted-room table. Existing canonical rows are never updated or deleted
 * by this seed path, so a later narrowing or disengagement cannot be revived
 * by stale configuration.
 */
export function seedTrustedRoomsFromOwnerConfig(
  db: DatabaseSync,
  input: {
    guildId?: string | null;
    channelIds: readonly string[];
    source: OwnerRoomSeedSource;
    nowMs?: number;
  },
): TrustedRoom[] {
  const ownerId = required(input.source.ownerId, "social_owner_required");
  const addedBy = required(input.source.addedBy ?? ownerId, "trusted_room_added_by_required");
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("social_authority_time_invalid");
  const guildId = input.guildId?.trim() || null;
  const results: TrustedRoom[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const rawChannelId of input.channelIds) {
      const channelId = rawChannelId.trim();
      if (!channelId) throw new Error("trusted_room_channel_unparseable");
      const ambiguous = guildId == null;
      const canonicalGuildId = guildId ?? "ambiguous";
      const existing = db.prepare(
        "SELECT entity_uuid FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get(canonicalGuildId, channelId);
      if (existing) continue;
      results.push(upsertTrustedRoomInExistingTransaction(db, {
        ownerId,
        guildId: canonicalGuildId,
        channelId,
        mode: ambiguous ? "disengaged" : "trusted_social",
        provenance: "seeded_from_owner_config",
        addedBy,
        sourceSpan: seedJson(input.source.sourceSpan, ambiguous),
        nowMs,
      }));
    }
    db.exec("COMMIT");
    return results;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the seed failure */ }
    throw error;
  }
}
