import { config } from "../config.js";
import type { Message } from "discord.js";

export type GateVerdict = "drop" | "capture_quarantine" | "allow_social";

export type OwnerRoomContext = {
  guildId: string;
  channelId: string;
};

export type OwnerIngressRoute =
  | { kind: "private_owner_dm" }
  | { kind: "owner_trusted_room"; context: OwnerRoomContext }
  | { kind: "reject_owner_guild" };

export type SocialSenderClassificationInput = {
  selfLoop: boolean;
  transportValid: boolean;
  socialCaptureEnabled: boolean;
  eligibility?: { authorized: boolean; audienceHint?: "dm" | "room" | "unknown" };
  eligibilityFailed?: boolean;
  externalBot?: boolean;
  botDmConfigured?: boolean;
};

/**
 * Advisory bot-side classification. The service repeats policy admission.
 * A valid attributable contact is never dropped solely because it is unknown
 * or because the advisory query failed.
 */
export function classifySocialSender(
  input: SocialSenderClassificationInput,
): GateVerdict {
  if (input.selfLoop) return "drop";
  if (!input.transportValid) return "drop";
  if (!input.socialCaptureEnabled) return "drop";
  if (input.eligibilityFailed || !input.eligibility) return "capture_quarantine";
  if (
    input.externalBot === true
    && input.eligibility.audienceHint === "dm"
    && input.botDmConfigured !== true
  ) return "capture_quarantine";
  return input.eligibility.authorized ? "allow_social" : "capture_quarantine";
}

export function isOwner(userId: string): boolean {
  return userId === config.ownerId;
}

export function isAllowedMessage(message: Message): boolean {
  if (!isOwner(message.author.id)) {
    console.warn(
      `[discord-bot] ignored message from unauthorized user ${message.author.id}`,
    );
    return false;
  }
  if (!message.guild) return true;
  if (config.allowedChannels.length === 0) return false;
  return config.allowedChannels.includes(message.channel.id);
}

/**
 * Return room context only for an authenticated Owner message in the one
 * explicitly configured and currently staged room. The agent repeats the
 * canonical trusted-room check before admission and publication.
 */
export function ownerRoomContextForMessage(
  message: Message,
  options: {
    ownerId?: string;
    guildId?: string;
    channelIds?: readonly string[];
    roomSeedActive?: boolean;
    publicationChannelId?: string | null;
  } = {},
): OwnerRoomContext | undefined {
  const ownerId = (options.ownerId ?? config.ownerId).trim();
  const guildId = (options.guildId ?? config.trustedRoomSeed.guildId).trim();
  const channelIds = options.channelIds ?? config.trustedRoomSeed.channelIds;
  const roomSeedActive = options.roomSeedActive
    ?? (process.env.RA_ROOM_SEED_ACTIVE === "true" || process.env.RA_ROOM_SEED_ACTIVE === "1");
  const publicationChannelId = options.publicationChannelId === undefined
    ? process.env.RA_ROOM_PUBLICATION?.trim() || null
    : options.publicationChannelId?.trim() || null;
  const messageGuildId = message.guild?.id?.trim();
  const channelId = message.channel?.id?.trim();
  if (!ownerId || !guildId || !roomSeedActive || !publicationChannelId) return undefined;
  if (message.author?.id?.trim() !== ownerId) return undefined;
  if (!messageGuildId || messageGuildId !== guildId || !channelId) return undefined;
  if (!channelIds.some((candidate) => candidate.trim() === channelId)) return undefined;
  if (publicationChannelId !== channelId) return undefined;
  return { guildId, channelId };
}

export function ownerIngressRouteForMessage(
  message: Message,
  options: Parameters<typeof ownerRoomContextForMessage>[1] = {},
): OwnerIngressRoute {
  if (!message.guild) return { kind: "private_owner_dm" };
  const context = ownerRoomContextForMessage(message, options);
  return context
    ? { kind: "owner_trusted_room", context }
    : { kind: "reject_owner_guild" };
}
