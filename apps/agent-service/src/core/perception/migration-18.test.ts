import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { MIGRATION_18_ATTENTION_BUCKETS } from "./migration-18.js";

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>
  ).map((c) => c.name);
}

function pkColumns(db: DatabaseSync, table: string): string[] {
  return (
    db
      .prepare(`SELECT name FROM pragma_table_info('${table}') WHERE pk > 0 ORDER BY pk`)
      .all() as Array<{ name: string }>
  ).map((c) => c.name);
}

function indexNames(db: DatabaseSync, table: string): string[] {
  return (
    db
      .prepare(`SELECT name FROM pragma_index_list('${table}')`)
      .all() as Array<{ name: string }>
  ).map((i) => i.name);
}

const OLD_ATTENTION_REQUESTS = `
CREATE TABLE attention_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  resolved_model_id TEXT,
  model_epoch INTEGER,
  state TEXT NOT NULL,
  outcome TEXT,
  error_class TEXT,
  queued_at TEXT NOT NULL,
  eligible_at TEXT NOT NULL,
  age_origin_at TEXT NOT NULL,
  deadline_at TEXT,
  reserved_at TEXT,
  dispatch_started_at TEXT,
  ended_at TEXT,
  dispatch_sequence INTEGER,
  lease_expires_at TEXT,
  recovery_class TEXT,
  folded_at TEXT,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_input_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_output_tokens INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens INTEGER,
  actual_output_tokens INTEGER,
  budget_retain_until TEXT,
  delivery_reservation_id INTEGER,
  decision_id INTEGER,
  cognitive_job_id INTEGER,
  owner_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attention_requests_state_lane
  ON attention_requests (state, lane, eligible_at);
CREATE INDEX idx_attention_requests_dispatch_seq
  ON attention_requests (dispatch_sequence);
CREATE INDEX idx_attention_requests_folded
  ON attention_requests (folded_at, ended_at);
CREATE INDEX idx_attention_requests_budget
  ON attention_requests (state, reserved_at, budget_retain_until);
`;

const OLD_DAILY_USAGE = `
CREATE TABLE attention_daily_usage (
  day_utc TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  resolved_model_id TEXT NOT NULL DEFAULT '',
  model_epoch INTEGER NOT NULL DEFAULT 0,
  requests_completed INTEGER NOT NULL DEFAULT 0,
  requests_cancelled INTEGER NOT NULL DEFAULT 0,
  requests_timeout INTEGER NOT NULL DEFAULT 0,
  requests_rate_limited INTEGER NOT NULL DEFAULT 0,
  requests_error INTEGER NOT NULL DEFAULT 0,
  requests_aborted INTEGER NOT NULL DEFAULT 0,
  lane_interactive INTEGER NOT NULL DEFAULT 0,
  lane_urgent_grounded INTEGER NOT NULL DEFAULT 0,
  lane_exchange_cognition INTEGER NOT NULL DEFAULT 0,
  lane_curiosity_maintenance INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens INTEGER NOT NULL DEFAULT 0,
  actual_output_tokens INTEGER NOT NULL DEFAULT 0,
  unknown_reserved_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day_utc, model_alias, resolved_model_id, model_epoch)
);
`;

describe("wave10a migration-18 (model routing buckets)", () => {
  it("builds v18 schema on a fresh database", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    const cols = tableColumns(db, "attention_requests");
    expect(cols).toContain("provider_id");
    expect(cols).toContain("route_alias");
    expect(cols).toContain("quota_bucket");
    expect(indexNames(db, "attention_requests")).toContain(
      "idx_attention_requests_quota_bucket",
    );
    expect(pkColumns(db, "attention_daily_usage")).toEqual([
      "day_utc",
      "quota_bucket",
    ]);
    expect(tableColumns(db, "decision_log")).toContain(
      "expression_fallback_policy",
    );
    db.close();
    continuity.close();
  });

  it("backfills legacy attention rows to the mistral bucket", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT)");
    db.exec(OLD_ATTENTION_REQUESTS);
    db.exec(OLD_DAILY_USAGE);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO attention_requests
         (lane, purpose, model_alias, state, outcome, queued_at, eligible_at,
          age_origin_at, created_at)
      VALUES ('interactive', 'expression', 'm', 'queued', NULL, ?, ?, ?, ?)`,
    ).run(now, now, now, now);
    db.prepare(
      `INSERT INTO attention_daily_usage
         (day_utc, model_alias, resolved_model_id, model_epoch,
          requests_completed, updated_at)
      VALUES (?, 'm', '', 0, 5, ?)`,
    ).run(now.slice(0, 10), now);

    db.exec(MIGRATION_18_ATTENTION_BUCKETS);

    const row = db
      .prepare(
        `SELECT provider_id, route_alias, quota_bucket FROM attention_requests
         WHERE model_alias = 'm'`,
      )
      .get() as
      | { provider_id: string; route_alias: string | null; quota_bucket: string }
      | undefined;
    expect(row).toMatchObject({
      provider_id: "mistral",
      route_alias: null,
      quota_bucket: "mistral:m",
    });
    expect(indexNames(db, "attention_requests")).toContain(
      "idx_attention_requests_quota_bucket",
    );
    expect(pkColumns(db, "attention_daily_usage")).toEqual([
      "day_utc",
      "quota_bucket",
    ]);
    const daily = db.prepare(
      `SELECT quota_bucket, model_alias, requests_completed
       FROM attention_daily_usage WHERE model_alias = 'm'`,
    ).get() as { quota_bucket: string; model_alias: string; requests_completed: number };
    expect(daily).toMatchObject({
      quota_bucket: "mistral:m",
      model_alias: "m",
      requests_completed: 5,
    });
    expect(tableColumns(db, "decision_log")).toContain(
      "expression_fallback_policy",
    );

    db.close();
  });

  it("enforces not-null provider_id and quota_bucket", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT)");
    db.exec(OLD_ATTENTION_REQUESTS);
    db.exec(OLD_DAILY_USAGE);
    db.exec(MIGRATION_18_ATTENTION_BUCKETS);
    const now = new Date().toISOString();
    const cols = tableColumns(db, "attention_requests");
    expect(cols).toContain("provider_id");
    expect(cols).toContain("quota_bucket");
    expect(() =>
      db.prepare(
        `INSERT INTO attention_requests
           (lane, purpose, model_alias, provider_id, route_alias, quota_bucket,
            state, outcome, queued_at, eligible_at, age_origin_at, created_at)
         VALUES ('interactive', 'expression', 'm', 'mistral', NULL, NULL,
                 'queued', NULL, ?, ?, ?, ?)`,
      ).run(now, now, now, now),
    ).toThrow();
    db.close();
  });
});
