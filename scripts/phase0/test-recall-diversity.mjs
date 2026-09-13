#!/usr/bin/env node
/**
 * Recall diversity: same recall ask twice should not copy prior phrasing verbatim.
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

const ownerId = process.env.DISCORD_OWNER_ID ?? process.env.MEMORY_OWNER_ID;
const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:3710";

if (!ownerId) {
  console.error("DISCORD_OWNER_ID missing");
  process.exit(1);
}

async function freshThread() {
  const res = await fetch(`${agentUrl}/memory/newthread`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: ownerId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`newthread: ${JSON.stringify(data)}`);
}

await freshThread();

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigramSet(text) {
  const n = normalize(text);
  const set = new Set();
  for (let i = 0; i < n.length - 2; i++) {
    set.add(n.slice(i, i + 3));
  }
  return set;
}

function overlapRatio(a, b) {
  const sa = trigramSet(a);
  const sb = trigramSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }
  return inter / Math.min(sa.size, sb.size);
}

async function ask(message) {
  const res = await fetch(`${agentUrl}/chat/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, channel: "discord", userId: ownerId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return String(data.text ?? "");
}

const recallPrompt = "neler hatırlıyorsun";
const first = await ask(recallPrompt);
await new Promise((r) => setTimeout(r, 1500));
const second = await ask(recallPrompt);

const ratio = overlapRatio(first, second);
console.log("first:", first.slice(0, 140));
console.log("second:", second.slice(0, 140));
console.log("trigram overlap:", ratio.toFixed(2));

const MAX_OVERLAP = 0.85;
if (normalize(first) === normalize(second)) {
  console.error("FAIL identical normalized text");
  process.exit(1);
}
if (ratio > MAX_OVERLAP) {
  console.error(`FAIL overlap ${ratio.toFixed(2)} > ${MAX_OVERLAP}`);
  process.exit(1);
}

console.log("OK recall diversity");
process.exit(0);
