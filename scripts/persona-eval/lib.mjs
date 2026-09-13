// Shared bits for the persona eval scripts: env reading, paths, timestamps.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = join(homedir(), ".composer-assistant");
export const OUT_ROOT = join(DATA_DIR, "persona-eval");
export const PROBES_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "probes.json",
);

export function loadProbes() {
  return JSON.parse(readFileSync(PROBES_PATH, "utf-8")).probes;
}

/** Read a value out of the shared .env without pulling in a dotenv dep. */
export function envValue(...keys) {
  const path = process.env.COMPOSER_ENV_FILE ?? join(DATA_DIR, ".env");
  const content = existsSync(path) ? readFileSync(path, "utf-8") : "";
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim().replace(/^\uFEFF/, "");
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  return "";
}

export function stamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "_")
    .slice(0, 15);
}

export function loadRun(labelOrPath) {
  const path = labelOrPath.endsWith(".json")
    ? labelOrPath
    : join(OUT_ROOT, labelOrPath, "run.json");
  if (!existsSync(path)) throw new Error(`no run at ${path}`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Stable per-pair coin flip, so A is not always the same run to the judge. */
export function stableFlip(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 1_000_003;
  return h % 2 === 1;
}
