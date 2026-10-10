/** Host-owned effective values for the relationship-admission gates. */
export type RaEnvironment = Readonly<Record<string, unknown>>;

export type RaEffectiveConfig = Readonly<{
  commitmentsEnabled: boolean;
  dmPublicationEnabled: boolean;
  roomPublicationChannelId: string | null;
  roomSeedActive: boolean;
  socialCaptureEnabled: boolean;
  botDmPrincipal: string | null;
  dmPrincipal: string | null;
  dmCognitionEnabled: boolean;
}>;

// The same spelling of a boolean as env.ts and the bot's config (A11-10); anything else keeps the default.
const FALSE_FLAG_WORDS = ["false", "0", "no", "off"];
const TRUE_FLAG_WORDS = ["true", "1", "yes", "on"];

function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  const word = String(value).trim().toLowerCase();
  if (FALSE_FLAG_WORDS.includes(word)) return false;
  if (TRUE_FLAG_WORDS.includes(word)) return true;
  return fallback;
}

function enabled(value: unknown): boolean {
  return flag(value, false);
}

/**
 * Contact DMs are on unless switched off (User 2026-10-06): who may talk with
 * her is the Owner's permit (/contacts), not a deployment switch.
 */
function onUnlessOff(value: unknown): boolean {
  return flag(value, true);
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getRaEffectiveConfig(env: RaEnvironment = process.env): RaEffectiveConfig {
  return {
    commitmentsEnabled: enabled(env.RA_COMMITMENTS),
    dmPublicationEnabled: onUnlessOff(env.RA_DM_PUBLICATION),
    roomPublicationChannelId: trimmedOrNull(env.RA_ROOM_PUBLICATION),
    roomSeedActive: enabled(env.RA_ROOM_SEED_ACTIVE),
    socialCaptureEnabled: onUnlessOff(env.RA_SOCIAL_CAPTURE),
    botDmPrincipal: trimmedOrNull(env.RA_BOT_DM),
    dmPrincipal: trimmedOrNull(env.RA_DM_PRINCIPAL),
    dmCognitionEnabled: onUnlessOff(env.RA_DM_COGNITION),
  };
}
