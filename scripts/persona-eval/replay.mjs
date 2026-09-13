#!/usr/bin/env node
// Replay persona probes against an isolated agent and dump raw replies.
// Never point this at the live agent on 3710: every probe archives the active
// thread, which would cut Doc's real conversation in half.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_ROOT, envValue, loadProbes, stamp } from "./lib.mjs";

function parseArgs(argv) {
  const args = { url: "http://127.0.0.1:3712", label: "", tags: "", seeds: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i] ?? args.url;
    else if (a === "--label") args.label = argv[++i] ?? "";
    else if (a === "--tags") args.tags = argv[++i] ?? "";
    else if (a === "--seeds") args.seeds = Number(argv[++i] ?? 1);
  }
  return args;
}

async function post(url, body, maxRateLimitRetries = 5) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (res.ok) return json;
    if (res.status === 429 && attempt < maxRateLimitRetries) {
      const retryAfter = res.headers.get("retry-after");
      const headerSeconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      const bodySeconds = Number(json?.retryAfterSec);
      const seconds = Math.max(
        1,
        Math.min(120, Number.isFinite(headerSeconds)
          ? headerSeconds
          : Number.isFinite(bodySeconds) ? bodySeconds : 30),
      );
      console.log(`[replay] rate limited; retrying in ${seconds}s (${attempt + 1}/${maxRateLimitRetries})`);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      continue;
    }
    const detail = json?.error?.message ?? json?.message ?? text.slice(0, 200);
    throw new Error(`${res.status} ${url}: ${detail}`);
  }
}

async function waitForAgent(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      const health = await res.json();
      if (health.ready) return health;
      last = `state=${health.state}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`agent at ${url} never became ready (${last})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (/:3710(\/|$)/.test(args.url)) {
    console.error(
      "refusing to run against port 3710: probes archive threads and would truncate the live conversation",
    );
    process.exit(2);
  }

  const ownerId = envValue("MEMORY_OWNER_ID", "DISCORD_OWNER_ID");
  if (!ownerId) {
    console.error("MEMORY_OWNER_ID / DISCORD_OWNER_ID not found in env");
    process.exit(2);
  }

  const all = loadProbes();
  const wanted = args.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const probes = wanted.length
    ? all.filter((p) => p.tags.some((t) => wanted.includes(t)))
    : all;

  if (probes.length === 0) {
    console.error(`no probes matched tags: ${args.tags}`);
    process.exit(2);
  }

  const health = await waitForAgent(args.url);
  const label = args.label || `run-${stamp()}`;
  const outDir = join(OUT_ROOT, label);
  mkdirSync(outDir, { recursive: true });

  console.log(
    `[replay] ${probes.length} probes x ${args.seeds} on ${args.url} (${health.mistral?.model})`,
  );

  const results = [];
  for (const probe of probes) {
    for (let seed = 1; seed <= args.seeds; seed++) {
      const runOwnerId = process.env.PERSONA_EVAL_MODE === "true"
        ? `${ownerId}:persona-eval:${label}:${probe.id}:${seed}`
        : ownerId;
      // Fresh thread per run so probes cannot contaminate each other.
      await post(`${args.url}/memory/newthread`, { userId: runOwnerId });
      const turns = [];
      let failed = null;
      for (const message of probe.turns) {
        const startedAt = Date.now();
        try {
          const reply = await post(`${args.url}/chat/text`, {
            message,
            channel: "discord",
            userId: runOwnerId,
          });
          turns.push({
            user: message,
            reply: reply.text ?? "",
            latencyMs: Date.now() - startedAt,
          });
        } catch (err) {
          failed = err instanceof Error ? err.message : String(err);
          turns.push({ user: message, reply: "", latencyMs: Date.now() - startedAt });
          break;
        }
      }
      results.push({
        id: probe.id,
        tags: probe.tags,
        lang: probe.lang,
        // Carried through so the judge sees the pass condition, not just the text.
        note: probe.note ?? "",
        seed,
        turns,
        error: failed,
      });
      const marker = failed ? "FAIL" : "ok";
      console.log(`  ${marker} ${probe.id}${args.seeds > 1 ? ` seed${seed}` : ""}`);
      if (failed) console.log(`     ${failed}`);
    }
  }

  const run = {
    label,
    at: new Date().toISOString(),
    url: args.url,
    model: health.mistral?.model ?? null,
    seeds: args.seeds,
    probeCount: probes.length,
    results,
  };
  writeFileSync(join(outDir, "run.json"), JSON.stringify(run, null, 2), "utf-8");

  const md = [`# ${label}`, "", `Model: ${run.model}  ${run.at}`, ""];
  for (const r of results) {
    md.push(`## ${r.id}${args.seeds > 1 ? ` (seed ${r.seed})` : ""}`);
    md.push(`tags: ${r.tags.join(", ")} | lang: ${r.lang}`, "");
    for (const t of r.turns) {
      md.push(`**Doc:** ${t.user}`, "");
      md.push(`**Ashley** (${t.latencyMs}ms):`, "");
      md.push(t.reply ? t.reply.split("\n").map((l) => `> ${l}`).join("\n") : "> (no reply)");
      md.push("");
    }
    if (r.error) md.push(`ERROR: ${r.error}`, "");
  }
  writeFileSync(join(outDir, "replies.md"), md.join("\n"), "utf-8");

  const failures = results.filter((r) => r.error).length;
  console.log(`[replay] wrote ${outDir}`);
  if (failures) {
    console.log(`[replay] ${failures} probe(s) errored`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
