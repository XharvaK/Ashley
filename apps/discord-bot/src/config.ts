import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ashleyDataDir } from "./data-root.js";

const ENV_PATH =
  process.env.COMPOSER_ENV_FILE ??
  join(ashleyDataDir(), ".env");

function loadDotEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

/** Windows User env — Cursor shells may not inherit tokens saved via setup-api-key.ps1 */
function loadWindowsUserEnvFallback(): void {
  if (process.platform !== "win32") return;
  const keys = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_OWNER_ID",
    "DISCORD_GUILD_ID",
    "DISCORD_ALLOWED_CHANNELS",
  ] as const;
  const missingKeys = keys.filter((key) => !process.env[key]);
  if (missingKeys.length === 0) return;
  try {
    const values = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$keys = @(${missingKeys.map((key) => `'${key}'`).join(",")}); $keys | ForEach-Object { [Environment]::GetEnvironmentVariable($_, 'User') }`,
      ],
      { encoding: "utf-8", timeout: 5000 },
    ).split(/\r?\n/);
    for (const [index, key] of missingKeys.entries()) {
      const value = values[index]?.trim();
      if (value) process.env[key] = value;
    }
  } catch {
    // ignore — validateConfig will surface missing required keys
  }
}

loadWindowsUserEnvFallback();

const numericWarnings: string[] = [];

export type DiscordRaEffectiveConfig = Readonly<{
  commitmentsEnabled: boolean;
  dmPublicationEnabled: boolean;
  roomPublicationChannelId: string | null;
  roomSeedActive: boolean;
  socialCaptureEnabled: boolean;
  botDmPrincipal: string | null;
  dmPrincipal: string | null;
  dmCognitionEnabled: boolean;
}>;

type RaEnvironment = Readonly<Record<string, unknown>>;

const FALSE_FLAG_WORDS = ["false", "0", "no", "off"];
const TRUE_FLAG_WORDS = ["true", "1", "yes", "on"];

/**
 * One boolean reading for every switch in the bot (A11-10): false, 0, no and
 * off are off; true, 1, yes and on are on; anything else (or unset) keeps the
 * default, so a typo never flips a switch silently.
 */
export function readBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  const word = String(value).trim().toLowerCase();
  if (FALSE_FLAG_WORDS.includes(word)) return false;
  if (TRUE_FLAG_WORDS.includes(word)) return true;
  return fallback;
}

function raFlag(value: unknown): boolean {
  return readBooleanFlag(value, false);
}

/** Contact DMs are on unless switched off; the Owner's permit decides who. */
function raOn(value: unknown): boolean {
  return readBooleanFlag(value, true);
}

/**
 * The bot → agent API secret (A13-1). ASHLEY_SERVICE_TOKEN is separate from the
 * Discord login; unset, the bot falls back to DISCORD_BOT_TOKEN for one release.
 */
export function resolveAgentServiceToken(env: Readonly<Record<string, string | undefined>>): {
  token: string;
  fallback: boolean;
} {
  const own = (env.ASHLEY_SERVICE_TOKEN ?? "").trim();
  if (own) return { token: own, fallback: false };
  const bot = (env.DISCORD_BOT_TOKEN ?? "").trim();
  return { token: bot, fallback: Boolean(bot) };
}

function raPrincipal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getRaEffectiveConfig(env: RaEnvironment = process.env): DiscordRaEffectiveConfig {
  return {
    commitmentsEnabled: raFlag(env.RA_COMMITMENTS),
    dmPublicationEnabled: raOn(env.RA_DM_PUBLICATION),
    roomPublicationChannelId: raPrincipal(env.RA_ROOM_PUBLICATION),
    roomSeedActive: raFlag(env.RA_ROOM_SEED_ACTIVE),
    socialCaptureEnabled: raOn(env.RA_SOCIAL_CAPTURE),
    botDmPrincipal: raPrincipal(env.RA_BOT_DM),
    dmPrincipal: raPrincipal(env.RA_DM_PRINCIPAL),
    dmCognitionEnabled: raOn(env.RA_DM_COGNITION),
  };
}

const raEffectiveConfig = getRaEffectiveConfig();

const configuredAllowedChannels = (process.env.DISCORD_ALLOWED_CHANNELS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export class ConfigError extends Error {
  readonly code = "config_missing";
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function numericEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    numericWarnings.push(`${name} invalid; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

const agentServiceToken = resolveAgentServiceToken(process.env);
if (agentServiceToken.fallback) {
  numericWarnings.push(
    "ASHLEY_SERVICE_TOKEN unset; using DISCORD_BOT_TOKEN as the agent service token (deprecated fallback)",
  );
}

export const config = {
  token: process.env.DISCORD_BOT_TOKEN ?? "",
  /** Sent to the agent as X-Ashley-Bot-Service; separate from the Discord login. */
  serviceToken: agentServiceToken.token,
  ownerId: process.env.DISCORD_OWNER_ID ?? "",
  allowedChannels: configuredAllowedChannels,
  guildId: process.env.DISCORD_GUILD_ID ?? "",
  // This is a representation seed only. Owner DMs are not in the channel
  // allowlist and therefore cannot become room rows through this projection.
  trustedRoomSeed: {
    guildId: process.env.DISCORD_GUILD_ID ?? "",
    channelIds: process.env.DISCORD_GUILD_ID ? configuredAllowedChannels : [],
  },
  // External social substrate remains closed unless explicitly activated by
  // the operator. A missing or malformed value is false.
  socialCaptureEnabled: raEffectiveConfig.socialCaptureEnabled,
  // A single Owner-set bot identity may receive person-wide DM admission.
  // The agent-service repeats this check authoritatively.
  botDmPrincipal: raEffectiveConfig.botDmPrincipal ?? "",
  agentUrl: process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:3710",
  proactiveEnabled: readBooleanFlag(process.env.PROACTIVE_ENABLED, true),
  proactiveCheckIntervalMin: numericEnv(
    "PROACTIVE_CHECK_INTERVAL_MIN",
    60,
    1,
    1440,
  ),
  giphyApiKey: process.env.GIPHY_API_KEY ?? "",
  tenorApiKey: process.env.TENOR_API_KEY ?? "",
  gifEnabled: readBooleanFlag(process.env.GIF_ENABLED, true),
  // Slightly under the old 120s default — GIFs were too rare (Alex 2026-08-01).
  gifCooldownSec: numericEnv("GIF_COOLDOWN_SEC", 90, 0, 86_400),
  // Default on for the 3–10s bubble pacing ship; set DISCORD_PACE_ENABLED=false to disable.
  paceEnabled: readBooleanFlag(process.env.DISCORD_PACE_ENABLED, true),
  reactPolicyEnabled: readBooleanFlag(process.env.DISCORD_REACT_POLICY_ENABLED, true),
  presenceIntent: readBooleanFlag(process.env.DISCORD_PRESENCE_INTENT, false),
  ownerPresenceFacts: readBooleanFlag(process.env.ASHLEY_OWNER_PRESENCE_FACTS, false),
};

export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.token) missing.push("DISCORD_BOT_TOKEN");
  if (!config.serviceToken) missing.push("ASHLEY_SERVICE_TOKEN");
  if (!config.ownerId) missing.push("DISCORD_OWNER_ID");
  if (missing.length) {
    throw new ConfigError(`Missing env: ${missing.join(", ")}`);
  }
  for (const warning of numericWarnings) {
    console.warn(`[discord-bot] ${warning}`);
  }
}
