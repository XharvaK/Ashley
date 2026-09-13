#!/usr/bin/env node
/**
 * Verify plan recall prompts: neler hatırlıyorsun x2, hafızanda neler var.
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

function sentenceCount(text) {
  return text.split(/[.!?…]+/).filter((s) => s.trim().length > 3).length;
}

function hasBullets(text) {
  return /^\s*[-*•]\s/m.test(text) || /^\s*\d+\.\s/m.test(text);
}

function hasKravat(text) {
  return /kravat|\*[^*]+\*/i.test(text);
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigramOverlap(a, b) {
  const trigrams = (t) => {
    const n = normalize(t);
    const set = new Set();
    for (let i = 0; i < n.length - 2; i++) set.add(n.slice(i, i + 3));
    return set;
  };
  const sa = trigrams(a);
  const sb = trigrams(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

async function ask(message) {
  const debugRes = await fetch(
    `${agentUrl}/debug/memory-context?owner_id=${encodeURIComponent(ownerId)}&message=${encodeURIComponent(message)}`,
  );
  const debug = await debugRes.json();
  if (debug.queryMode !== "recall") {
    throw new Error(`queryMode=${debug.queryMode} for ${message}`);
  }

  const res = await fetch(`${agentUrl}/chat/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, channel: "discord", userId: ownerId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return String(data.text ?? "");
}

const prompts = ["neler hatırlıyorsun", "neler hatırlıyorsun", "hafızanda neler var"];
const answers = [];

for (const message of prompts) {
  const text = await ask(message);
  answers.push(text);
  if (hasBullets(text)) throw new Error(`bullets in: ${text}`);
  if (hasKravat(text)) throw new Error(`kravat/stage in: ${text}`);
  if (sentenceCount(text) > 3) throw new Error(`too long: ${text}`);
  console.log("OK", message, "->", text.slice(0, 140));
  await new Promise((r) => setTimeout(r, 1200));
}

const overlap = trigramOverlap(answers[0], answers[1]);
console.log("repeat overlap:", overlap.toFixed(2));
if (normalize(answers[0]) === normalize(answers[1])) {
  throw new Error("repeat answers identical");
}
if (overlap > 0.85) {
  throw new Error(`repeat answers too similar: ${overlap.toFixed(2)}`);
}

console.log("OK verify-dm-recall");
process.exit(0);
