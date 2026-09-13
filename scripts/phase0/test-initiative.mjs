#!/usr/bin/env node
/**
 * Initiative API smoke — evaluate/tick/status (no DM send).
 */
import { loadComposerEnv, requireOwnerId, agentUrl } from "./load-env.mjs";

loadComposerEnv();
const ownerId = requireOwnerId();

const statusRes = await fetch(
  `${agentUrl}/initiative/status?owner_id=${encodeURIComponent(ownerId)}`,
);
const status = await statusRes.json();
if (!statusRes.ok) {
  console.error("FAIL status", status);
  process.exit(1);
}
if (typeof status.sentToday !== "number") {
  console.error("FAIL status shape", status);
  process.exit(1);
}

const evalRes = await fetch(`${agentUrl}/initiative/evaluate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: ownerId }),
});
const evalBody = await evalRes.json();
if (!evalRes.ok) {
  console.error("FAIL evaluate", evalBody);
  process.exit(1);
}
if (typeof evalBody.shouldReachOut !== "boolean") {
  console.error("FAIL evaluate shape", evalBody);
  process.exit(1);
}

const tickRes = await fetch(`${agentUrl}/initiative/tick`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userId: ownerId }),
});
const tick = await tickRes.json();
if (!tickRes.ok) {
  console.error("FAIL tick", tick);
  process.exit(1);
}
if (tick.shouldSend !== true && tick.shouldSend !== false) {
  console.error("FAIL tick shape", tick);
  process.exit(1);
}

const healthRes = await fetch(`${agentUrl}/health`);
const health = await healthRes.json();
if (!health.memory || typeof health.memory.jobsPending !== "number") {
  console.error("FAIL health memory fields", health.memory);
  process.exit(1);
}

console.log(
  "OK initiative",
  "evaluate=" + evalBody.reason,
  "tick=" + (tick.shouldSend ? "send" : tick.reason),
  "jobsPending=" + health.memory?.jobsPending,
);
process.exit(0);
