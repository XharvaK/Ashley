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

function enabled(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getRaEffectiveConfig(env: RaEnvironment = process.env): RaEffectiveConfig {
  return {
    commitmentsEnabled: enabled(env.RA_COMMITMENTS),
    dmPublicationEnabled: enabled(env.RA_DM_PUBLICATION),
    roomPublicationChannelId: trimmedOrNull(env.RA_ROOM_PUBLICATION),
    roomSeedActive: enabled(env.RA_ROOM_SEED_ACTIVE),
    socialCaptureEnabled: enabled(env.RA_SOCIAL_CAPTURE),
    botDmPrincipal: trimmedOrNull(env.RA_BOT_DM),
    dmPrincipal: trimmedOrNull(env.RA_DM_PRINCIPAL),
    dmCognitionEnabled: enabled(env.RA_DM_COGNITION),
  };
}
