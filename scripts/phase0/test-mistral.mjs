#!/usr/bin/env node
/**
 * Smoke test: Mistral API key + model reachable.
 * Loads ~/.composer-assistant/.env
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const envPath = join(homedir(), ".composer-assistant", ".env");
if (existsSync(envPath)) {
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

const key = process.env.MISTRAL_API_KEY;
if (!key) {
  console.error("MISTRAL_API_KEY missing");
  process.exit(1);
}

const model = process.env.MISTRAL_MODEL ?? "mistral-medium-latest";

const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
    max_tokens: 16,
    temperature: 0,
  }),
});

if (!res.ok) {
  console.error("Mistral error:", res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const text = data.choices?.[0]?.message?.content ?? "";
console.log("Mistral OK:", text.trim());
process.exit(text.toLowerCase().includes("pong") ? 0 : 1);
