#!/usr/bin/env node
/**
 * Integration: correction guard blocks denied entities in recall context.
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
  if (!res.ok) throw new Error(JSON.stringify(data));
}

async function chat(message) {
  const res = await fetch(`${agentUrl}/chat/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, channel: "discord", userId: ownerId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return String(data.text ?? "");
}

await freshThread();
await chat(
  "uydurmuşsun — valorant oynamıyorum ve 3-meo içmedim, bunları hatırlama",
);

const debugRes = await fetch(
  `${agentUrl}/debug/memory-context?owner_id=${encodeURIComponent(ownerId)}&message=${encodeURIComponent("neler hatırlıyorsun")}`,
);
const debug = await debugRes.json();
const preview = String(debug.memoryBlockPreview ?? "").toLowerCase();
if (!preview.includes("correction_guard")) {
  console.error("FAIL correction_guard not in memory block");
  process.exit(1);
}

const recall = await chat("neler hatırlıyorsun");
const lower = recall.toLowerCase();
if (/valorant|3[-\s]?meo|sigma-1/i.test(lower)) {
  console.error("FAIL blocked entity in recall:", recall.slice(0, 200));
  process.exit(1);
}

console.log("OK correction-guard", recall.slice(0, 120));
process.exit(0);
