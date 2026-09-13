import { observerError } from "./errors.js";

export const CONTROL_CREDENTIAL_ENV_KEYS = Object.freeze([
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "NIM_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "DISCORD_BOT_TOKEN",
  "GIPHY_API_KEY",
  "TENOR_API_KEY",
  "ASHLEY_BACKUP_TRANSFER_KEY",
]);

export function assertNoAshleyControlCredentials(
  environment: Record<string, string | undefined>,
): void {
  const present = CONTROL_CREDENTIAL_ENV_KEYS.filter((key) => {
    const value = environment[key];
    return typeof value === "string" && value.trim() !== "";
  });
  throwIfPresent(present);
}

function throwIfPresent(present: string[]): void {
  if (present.length > 0) {
    throw observerError(
      "control_credential_present",
      `control_credential_present:${present.join(",")}`,
    );
  }
}

/** Check process environment names without reading credential values. */
export function assertNoAshleyControlCredentialKeys(keys: Iterable<string>): void {
  const names = new Set(keys);
  throwIfPresent(CONTROL_CREDENTIAL_ENV_KEYS.filter((key) => names.has(key)));
}

export function assertNoAshleyProcessControlCredentials(): void {
  assertNoAshleyControlCredentialKeys(Object.keys(process.env));
}
