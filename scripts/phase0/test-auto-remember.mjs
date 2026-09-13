#!/usr/bin/env node
/**
 * Agent integration: explicit pin via auto-remember lands in /memory/summary.
 * Requires running agent-service + MISTRAL_API_KEY.
 */
import { loadEnv } from "./load-env.mjs";

loadEnv();

const AGENT = process.env.AGENT_URL ?? "http://127.0.0.1:3710";
const OWNER = process.env.DISCORD_OWNER_ID ?? process.env.MEMORY_OWNER_ID;

if (!OWNER) {
  console.error("DISCORD_OWNER_ID or MEMORY_OWNER_ID required");
  process.exit(1);
}

async function chat(message) {
  const res = await fetch(`${AGENT}/chat/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      channel: "discord",
      userId: OWNER,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? res.statusText);
  }
  return body;
}

const health = await fetch(`${AGENT}/health`).then((r) => r.json());
if (!health.ready) {
  console.error("Agent not ready");
  process.exit(1);
}

const pinMsg = "bunu hatırla: auto-remember integration test";
await chat(pinMsg);

const summaryRes = await fetch(
  `${AGENT}/memory/summary?owner_id=${encodeURIComponent(OWNER)}`,
);
const summary = await summaryRes.json();
const found = summary.facts?.some((f) =>
  String(f.value).includes("auto-remember integration test"),
);
if (!found) {
  console.error("FAIL: pinned fact not in /memory/summary");
  process.exit(1);
}
console.log("OK: fact visible in memory summary");
console.log("test-auto-remember.mjs passed");
