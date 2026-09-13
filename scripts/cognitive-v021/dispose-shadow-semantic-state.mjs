import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const RESERVED = resolve(homedir(), ".composer-assistant").replaceAll("\\", "/").toLowerCase();

function canonical(input) {
  const absolute = resolve(input);
  let cursor = absolute;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(cursor.slice(parent.length + 1));
    cursor = parent;
  }
  const base = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return `${base}/${suffix.join("/")}`.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function assertIsolated(path) {
  const identity = canonical(path);
  if (identity === RESERVED || identity.startsWith(`${RESERVED}/`)) {
    throw new Error(`RESERVED_PRODUCTION_PATH_REFUSED:${path}`);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sidecarPath = argument("--sidecar");
if (process.argv.includes("--help")) {
  console.log("USAGE: node scripts/cognitive-v021/dispose-shadow-semantic-state.mjs --sidecar <isolated-sidecar>");
  process.exit(0);
}
if (!sidecarPath) {
  console.error("USAGE: node scripts/cognitive-v021/dispose-shadow-semantic-state.mjs --sidecar <isolated-sidecar>");
  process.exitCode = 2;
} else {
  try {
    assertIsolated(sidecarPath);
    if (!existsSync(sidecarPath)) throw new Error(`INPUT_UNREADABLE:${sidecarPath}`);
    const db = new DatabaseSync(sidecarPath);
    try {
      db.exec("BEGIN IMMEDIATE");
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)));
      const semanticTables = [
        "thought_steps", "working_context_items", "concerns", "mind_occupancy", "future_triggers",
        "observation_subscriptions", "observations", "speech_outbox", "system_notice_outbox",
        "in_flight_effects", "effect_receipts", "durable_nominations", "sidecar_memory_assertions",
        "sidecar_memory_supports", "admission_log", "settlements", "causal_ledger", "thought_attempt_counters",
        "inbox_events", "cycle_records",
      ];
      const counts = {};
      for (const table of semanticTables) {
        if (!tables.has(table)) continue;
        const result = db.prepare(`DELETE FROM ${table}`).run();
        counts[table] = Number(result.changes);
      }
      if (tables.has("conversation_evidence_log")) {
        const result = db.prepare(
          `DELETE FROM conversation_evidence_log
             WHERE NOT (role = 'owner' OR (role = 'ashley' AND delivered = 1 AND architecture_epoch = 'legacy'))`,
        ).run();
        counts.conversation_evidence_log = Number(result.changes);
      }
      if (tables.has("conversation_evidence_discord_ids") && tables.has("conversation_evidence_log")) {
        const result = db.prepare(
          `DELETE FROM conversation_evidence_discord_ids
             WHERE lineage_id NOT IN (SELECT lineage_id FROM conversation_evidence_log)`,
        ).run();
        counts.conversation_evidence_discord_ids = Number(result.changes);
      }
      db.exec("COMMIT");
      console.log(JSON.stringify({ ok: true, sidecar: "isolated", counts }));
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
      throw error;
    } finally {
      db.close();
    }
  } catch (error) {
    console.error(JSON.stringify({ code: error instanceof Error ? error.message.split(":", 1)[0] : "DISPOSE_FAILED", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
