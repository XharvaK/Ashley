import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Load ~/.composer-assistant/.env into process.env (no overwrite). */
export function loadComposerEnv() {
  const envPath = join(homedir(), ".composer-assistant", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function requireOwnerId() {
  const ownerId = process.env.DISCORD_OWNER_ID ?? process.env.MEMORY_OWNER_ID;
  if (!ownerId) {
    console.error("DISCORD_OWNER_ID or MEMORY_OWNER_ID missing");
    process.exit(1);
  }
  return ownerId;
}

export const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:3710";
