import { config } from "../config.js";
import type { Message } from "discord.js";

export type GateVerdict = "drop" | "capture_quarantine" | "allow_social";

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
