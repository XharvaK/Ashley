import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const ENV_PATH =
  process.env.COMPOSER_ENV_FILE ??
  join(homedir(), ".composer-assistant", ".env");

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

export const config = {
  token: process.env.DISCORD_BOT_TOKEN ?? "",
  ownerId: process.env.DISCORD_OWNER_ID ?? "",
  allowedChannels: (process.env.DISCORD_ALLOWED_CHANNELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  guildId: process.env.DISCORD_GUILD_ID ?? "",
  agentUrl: process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:3710",
  proactiveEnabled: process.env.PROACTIVE_ENABLED !== "false",
  proactiveCheckIntervalMin: numericEnv(
    "PROACTIVE_CHECK_INTERVAL_MIN",
    60,
    1,
    1440,
  ),
  giphyApiKey: process.env.GIPHY_API_KEY ?? "",
  tenorApiKey: process.env.TENOR_API_KEY ?? "",
  gifEnabled: process.env.GIF_ENABLED !== "false",
  // Slightly under the old 120s default — GIFs were too rare (Doc 2026-08-01).
  gifCooldownSec: numericEnv("GIF_COOLDOWN_SEC", 90, 0, 86_400),
  // Default on for the 3–10s bubble pacing ship; set DISCORD_PACE_ENABLED=false to disable.
  paceEnabled: process.env.DISCORD_PACE_ENABLED !== "false",
  reactPolicyEnabled: process.env.DISCORD_REACT_POLICY_ENABLED !== "false",
};

export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.token) missing.push("DISCORD_BOT_TOKEN");
  if (!config.ownerId) missing.push("DISCORD_OWNER_ID");
  if (missing.length) {
    throw new ConfigError(`Missing env: ${missing.join(", ")}`);
  }
  for (const warning of numericWarnings) {
    console.warn(`[discord-bot] ${warning}`);
  }
}
