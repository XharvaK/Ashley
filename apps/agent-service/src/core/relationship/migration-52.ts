import type { DatabaseSync } from "node:sqlite";

const TIMING_COLUMNS = [
  "timing_timezone_id",
  "required_precision_ms",
  "late_behavior",
  "latest_useful_at_ms",
] as const;

const LATE_BEHAVIORS = ["deliver_late", "reconsider", "expire"] as const;

function tableInfo(db: DatabaseSync): Array<{
  name?: string;
  notnull?: number;
  dflt_value?: string | null;
}> {
  return db.prepare("PRAGMA table_info(ashley_self_commitments)").all() as Array<{
    name?: string;
    notnull?: number;
    dflt_value?: string | null;
  }>;
}

function addColumnIfMissing(db: DatabaseSync, column: string, definition: string): void {
  if (!tableInfo(db).some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ashley_self_commitments ADD COLUMN ${column} ${definition}`);
  }
}

/** Add the Host-owned timing contract without rewriting commitment history. */
export function ensureNuclearV52Schema(db: DatabaseSync): void {
  addColumnIfMissing(db, "timing_timezone_id", "TEXT NOT NULL DEFAULT 'UTC'");
  addColumnIfMissing(
    db,
    "required_precision_ms",
    "INTEGER NOT NULL DEFAULT 3600000 CHECK (required_precision_ms > 0)",
  );
  addColumnIfMissing(
    db,
    "late_behavior",
    "TEXT NOT NULL DEFAULT 'reconsider' CHECK (late_behavior IN ('deliver_late','reconsider','expire'))",
  );
  addColumnIfMissing(db, "latest_useful_at_ms", "INTEGER");
  db.prepare(
    `UPDATE ashley_self_commitments
        SET timing_timezone_id = COALESCE(NULLIF(trim(timing_timezone_id), ''), 'UTC'),
            required_precision_ms = CASE
              WHEN required_precision_ms IS NULL OR required_precision_ms <= 0 THEN 3600000
              ELSE required_precision_ms
            END,
            late_behavior = CASE
              WHEN late_behavior IN ('deliver_late', 'reconsider', 'expire') THEN late_behavior
              ELSE 'reconsider'
            END
      WHERE timing_timezone_id IS NULL
         OR trim(timing_timezone_id) = ''
         OR required_precision_ms IS NULL
         OR required_precision_ms <= 0
         OR late_behavior IS NULL
         OR late_behavior NOT IN ('deliver_late', 'reconsider', 'expire')`,
  ).run();
}

export function validateNuclearV52Schema(db: DatabaseSync, version = 52): void {
  const rows = tableInfo(db);
  for (const column of TIMING_COLUMNS) {
    if (!rows.some((row) => row.name === column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:ashley_self_commitments.${column}`);
    }
  }
  const timezone = rows.find((row) => row.name === "timing_timezone_id");
  if (timezone?.notnull !== 1 || timezone.dflt_value !== "'UTC'") {
    throw new Error(`nuclear_schema_content_invalid:v${version}:timing_timezone_contract`);
  }
  const precision = rows.find((row) => row.name === "required_precision_ms");
  if (precision?.notnull !== 1 || precision.dflt_value !== "3600000") {
    throw new Error(`nuclear_schema_content_invalid:v${version}:required_precision_contract`);
  }
  const lateBehavior = rows.find((row) => row.name === "late_behavior");
  if (lateBehavior?.notnull !== 1 || lateBehavior.dflt_value !== "'reconsider'") {
    throw new Error(`nuclear_schema_content_invalid:v${version}:late_behavior_contract`);
  }
  const sql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ashley_self_commitments'",
  ).get() as { sql?: unknown } | undefined;
  const tableSql = typeof sql?.sql === "string" ? sql.sql.toLowerCase() : "";
  for (const value of LATE_BEHAVIORS) {
    if (!tableSql.includes(`'${value}'`)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:late_behavior_value:${value}`);
    }
  }
}

export function requireNoNuclearV52Content(db: DatabaseSync, version = 51): void {
  for (const column of TIMING_COLUMNS) {
    if (tableInfo(db).some((row) => row.name === column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:unexpected_column:ashley_self_commitments.${column}`);
    }
  }
}
