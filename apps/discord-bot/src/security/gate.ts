import { config } from "../config.js";
import type { Message } from "discord.js";

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
