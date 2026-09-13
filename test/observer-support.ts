import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function tempDir(prefix = "observer-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTemp(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can release SQLite handles after the test worker exits.
  }
}

export function writeJsonLines(
  sessionsRoot: string,
  sessionId: string,
  messages: Array<Record<string, unknown>>,
  channel = "discord",
): string {
  const sessionDir = join(sessionsRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, "session.json"),
    JSON.stringify({ session_id: sessionId, channel }) + "\n",
    "utf8",
  );
  const path = join(sessionDir, "messages.jsonl");
  writeFileSync(
    path,
    messages.map((message) => JSON.stringify(message)).join("\n") + "\n",
    "utf8",
  );
  return path;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function createNuclearFixture(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA user_version = 41;
    CREATE TABLE mem_messages (
      id INTEGER PRIMARY KEY,
      thread_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      channel TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data_classification TEXT NOT NULL DEFAULT 'never_public'
    );
    CREATE TABLE capability_contracts (
      contract_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      spec_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL
    );
    CREATE TABLE capability_releases (
      capability TEXT NOT NULL,
      release_id TEXT NOT NULL,
      state TEXT NOT NULL,
      eval_seed_count INTEGER NOT NULL DEFAULT 0,
      qualified_at TEXT,
      promoted_at TEXT,
      rolled_back_at TEXT,
      failure_kind TEXT,
      failure_reason TEXT,
      updated_at TEXT NOT NULL,
      contract_id TEXT,
      build_identity TEXT,
      model_epoch INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (capability, release_id)
    );
    CREATE TABLE capability_events (
      id INTEGER PRIMARY KEY,
      capability TEXT NOT NULL,
      release_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_key TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL,
      contract_id TEXT,
      build_identity TEXT,
      model_epoch INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE memory_contract_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      c1_contract_version INTEGER NOT NULL,
      currentness_authority TEXT NOT NULL,
      cutover_at TEXT,
      applied_c1_authority_exists INTEGER NOT NULL DEFAULT 0,
      correction_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE memory_evidence_qualification_epochs (
      epoch_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      start_request_key TEXT NOT NULL,
      predecessor_epoch_id TEXT,
      owner_id TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      started_build_identity TEXT NOT NULL,
      created_by TEXT NOT NULL,
      started_at TEXT NOT NULL,
      retired_at TEXT,
      eval_seed_count INTEGER NOT NULL DEFAULT 0,
      qualified_at TEXT,
      sealed_at TEXT,
      sealed_release_id TEXT,
      blocked_at TEXT,
      block_code TEXT,
      block_source_key TEXT
    );
    CREATE TABLE memory_evidence_qualification_events (
      epoch_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_key TEXT NOT NULL,
      decision_class TEXT NOT NULL,
      qualifies INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      source_count INTEGER NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      build_identity TEXT NOT NULL,
      PRIMARY KEY (epoch_id, kind, source_key)
    );
    CREATE TABLE recall_qualification_epochs (
      epoch_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      start_request_key TEXT NOT NULL,
      predecessor_epoch_id TEXT,
      contract_id TEXT NOT NULL,
      started_build_identity TEXT NOT NULL,
      created_by TEXT NOT NULL,
      started_at TEXT NOT NULL,
      retired_at TEXT,
      eval_seed_count INTEGER NOT NULL DEFAULT 0,
      qualified_at TEXT,
      model_epoch INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE recall_qualification_events (
      id INTEGER PRIMARY KEY,
      epoch_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_key TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL,
      build_identity TEXT,
      model_epoch INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE recall_live_cutovers (
      owner_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      release_id TEXT NOT NULL,
      cutoff_message_id INTEGER NOT NULL,
      authorized_by TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      build_identity TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE decision_log (
      id INTEGER PRIMARY KEY,
      owner_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      trigger TEXT NOT NULL,
      decision_kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      objective TEXT,
      completion TEXT,
      uncertainty REAL,
      urgency REAL,
      thought_source TEXT
    );
    CREATE TABLE memory_corrections (
      correction_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      lifecycle_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_classification TEXT NOT NULL DEFAULT 'never_public'
    );
    CREATE TABLE delivery_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      delivery_lane TEXT NOT NULL DEFAULT 'reactive',
      state TEXT NOT NULL,
      error_category TEXT,
      finalization_reason TEXT,
      created_at TEXT NOT NULL,
      finalized_at TEXT,
      cognitive_v021_projection_key TEXT
    );
    CREATE TABLE delivery_bubbles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      text TEXT NOT NULL,
      discord_message_id TEXT,
      sent_at TEXT
    );
  `);
  return db;
}

export function createContinuityFixture(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA user_version = 1;
    CREATE TABLE continuity_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE lineage_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lineage_id TEXT NOT NULL,
      nuclear_schema_version INTEGER NOT NULL,
      build_identity TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE runtime_sessions (
      session_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      clean_shutdown_at TEXT,
      build_identity TEXT,
      nuclear_schema_version INTEGER,
      lineage_id TEXT NOT NULL
    );
  `);
  return db;
}
