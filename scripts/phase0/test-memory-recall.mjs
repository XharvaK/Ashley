#!/usr/bin/env node
/**
 * Smoke: recall-query detection via /chat/text (requires agent-service + keys).
 */
import { loadComposerEnv, requireOwnerId, agentUrl } from "./load-env.mjs";

loadComposerEnv();
const ownerId = requireOwnerId();

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

function looksConfabulated(text) {
  const lower = text.toLowerCase();
  const emptyHint =
    /nothing|blank|empty|fikrim yok|not much|no pinned|kayıtlı|uzun dönem|stored|hatırlamıyorum|yok/i.test(
      lower,
    );
  const risky =
    /valorant|factory deploy|psychonaut|coffee habit|3[-\s]?meo/i.test(lower);
  return risky && !emptyHint;
}

const prompts = [
  "what do you remember about me?",
  "ne biliyorsun benden?",
  "neler hatırlıyorsun",
  "hafızanda neler var",
];

let ok = 0;
for (const message of prompts) {
  const debugRes = await fetch(
    `${agentUrl}/debug/memory-context?owner_id=${encodeURIComponent(ownerId)}&message=${encodeURIComponent(message)}`,
  );
  const debug = await debugRes.json();
  if (debug.queryMode !== "recall") {
    console.error("FAIL queryMode", message, "->", debug.queryMode);
    continue;
  }

  const res = await fetch(`${agentUrl}/chat/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, channel: "discord", userId: ownerId }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("FAIL", message, data);
    continue;
  }

  const text = String(data.text ?? "");
  if (looksConfabulated(text)) {
    console.error("CONFAB?", message, text.slice(0, 200));
    continue;
  }
  if (hasBullets(text)) {
    console.error("BULLETS?", message, text.slice(0, 200));
    continue;
  }
  if (hasKravat(text)) {
    console.error("KRAVAT?", message, text.slice(0, 200));
    continue;
  }
  if (sentenceCount(text) > 2) {
    console.error("TOO LONG?", message, text.slice(0, 200));
    continue;
  }

  console.log("OK", message, "->", text.slice(0, 120));
  ok++;
}

process.exit(ok === prompts.length ? 0 : 1);
