import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  isReservedProductionStoragePath,
  type DataPlaneContext,
} from "../data-plane.js";

function continuityError(code: string, message = code): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

export function openContinuityDb(
  existing?: DatabaseSync,
  options: { dataPlane?: DataPlaneContext; migrate?: boolean } = {},
): DatabaseSync {
  if (!existing) {
    throw continuityError("data_plane_required");
  }
  const rows = existing.prepare("PRAGMA database_list").all() as Array<{
    name?: string;
    file?: string;
  }>;
  const main = rows.find((row) => row.name === "main");
  const file = main?.file?.trim() ?? "";
  if (file && isReservedProductionStoragePath(file)) {
    if (options.dataPlane?.kind !== "production") {
      throw continuityError("production_data_plane_required");
    }
  }
  migrateContinuity(existing, { migrate: options.migrate });
  return existing;
}

export const CONTINUITY_SCHEMA_VERSION = 1;

export type NuclearMigrationPhase =
  | "pending"
  | "nuclear_committed"
  | "recovered"
  | "rolled_back";

export type PendingNuclearMigration = {
  from: number;
  to: number;
  lineageId: string;
  buildIdentity: string;
  phase: NuclearMigrationPhase;
};

export type NuclearMigrationDescriptor = Omit<
  PendingNuclearMigration,
  "phase"
>;

const PENDING_NUCLEAR_MIGRATION_KEY = "pending_nuclear_migration";

const CONTINUITY_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS continuity_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lineage_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lineage_id TEXT NOT NULL UNIQUE,
  nuclear_schema_version INTEGER NOT NULL DEFAULT 0,
  build_identity TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lineage_forks (
  fork_id TEXT PRIMARY KEY,
  parent_lineage_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  destroyed_at TEXT,
  outbound_enabled INTEGER NOT NULL DEFAULT 0 CHECK (outbound_enabled = 0),
  writeback_enabled INTEGER NOT NULL DEFAULT 0 CHECK (writeback_enabled = 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'destroyed')),
  temp_dir TEXT
);

CREATE TABLE IF NOT EXISTS continuity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_continuity_events_recent
  ON continuity_events (occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS runtime_sessions (
  session_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  clean_shutdown_at TEXT,
  build_identity TEXT,
  nuclear_schema_version INTEGER,
  lineage_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_open
  ON runtime_sessions (clean_shutdown_at, started_at);

CREATE TABLE IF NOT EXISTS forget_previews (
  preview_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','cancelled','expired')),
  category_counts_json TEXT NOT NULL DEFAULT '{}',
  confirmation_discord_message_id TEXT,
  topic_diagnostic_fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS idx_forget_previews_status
  ON forget_previews (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_forget_previews_discord_msg
  ON forget_previews (owner_id, confirmation_discord_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forget_previews_live_discord
  ON forget_previews (owner_id, confirmation_discord_message_id)
  WHERE status = 'pending' AND confirmation_discord_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS forget_preview_targets (
  preview_id TEXT NOT NULL REFERENCES forget_previews(preview_id),
  entity_type TEXT NOT NULL,
  entity_uuid TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('delete','redact','detach')),
  PRIMARY KEY (preview_id, entity_type, entity_uuid)
);

CREATE TABLE IF NOT EXISTS forget_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  preview_id TEXT,
  receipt_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','applied')),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  category_counts_json TEXT NOT NULL DEFAULT '{}',
  external_non_erasure_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_forget_tombstones_status
  ON forget_tombstones (status, lineage_id);

CREATE TABLE IF NOT EXISTS forget_tombstone_targets (
  tombstone_id TEXT NOT NULL REFERENCES forget_tombstones(tombstone_id),
  entity_type TEXT NOT NULL,
  entity_uuid TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('delete','redact','detach')),
  PRIMARY KEY (tombstone_id, entity_type, entity_uuid)
);

CREATE TABLE IF NOT EXISTS backup_watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  nuclear_hash TEXT,
  continuity_hash TEXT,
  package_hash TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
`;

function userVersion(db: DatabaseSync): number {
  const row: unknown = db.prepare("PRAGMA user_version").get();
  if (typeof row !== "object" || row === null || !("user_version" in row)) {
    return 0;
  }
  const value = (row as { user_version: unknown }).user_version;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function withContinuityTransaction<T>(
  db: DatabaseSync,
  operation: () => T,
): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve the original sidecar failure */
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePendingNuclearMigration(value: string): PendingNuclearMigration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw continuityError("continuity_pending_migration_invalid");
  }
  if (
    !isRecord(parsed) ||
    !Number.isSafeInteger(parsed.from) ||
    !Number.isSafeInteger(parsed.to) ||
    typeof parsed.lineageId !== "string" ||
    parsed.lineageId.trim() === "" ||
    typeof parsed.buildIdentity !== "string" ||
    parsed.buildIdentity.trim() === "" ||
    !["pending", "nuclear_committed", "recovered", "rolled_back"].includes(
      parsed.phase as string,
    )
  ) {
    throw continuityError("continuity_pending_migration_invalid");
  }
  return {
    from: parsed.from as number,
    to: parsed.to as number,
    lineageId: parsed.lineageId as string,
    buildIdentity: parsed.buildIdentity as string,
    phase: parsed.phase as NuclearMigrationPhase,
  };
}

function readPendingNuclearMigration(
  continuity: DatabaseSync,
): PendingNuclearMigration | null {
  const row = continuity
    .prepare(`SELECT value FROM continuity_meta WHERE key = ?`)
    .get(PENDING_NUCLEAR_MIGRATION_KEY) as { value?: string } | undefined;
  if (!row?.value) return null;
  return parsePendingNuclearMigration(row.value);
}

function validateNuclearMigrationDescriptor(
  input: NuclearMigrationDescriptor,
): void {
  if (
    !Number.isSafeInteger(input.from) ||
    input.from < 0 ||
    !Number.isSafeInteger(input.to) ||
    input.to !== input.from + 1 ||
    input.lineageId.trim() === "" ||
    input.buildIdentity.trim() === ""
  ) {
    throw continuityError("continuity_migration_descriptor_invalid");
  }
}

function sameNuclearMigration(
  a: PendingNuclearMigration,
  b: NuclearMigrationDescriptor,
): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.lineageId === b.lineageId &&
    a.buildIdentity === b.buildIdentity
  );
}

function migrationMetaValue(
  input: NuclearMigrationDescriptor,
  phase: NuclearMigrationPhase,
): string {
  return JSON.stringify({ ...input, phase });
}

function lineageState(
  continuity: DatabaseSync,
): { lineageId: string; nuclearSchemaVersion: number } {
  const row = continuity
    .prepare(
      `SELECT lineage_id, nuclear_schema_version
       FROM lineage_state WHERE id = 1`,
    )
    .get() as
    | { lineage_id?: string; nuclear_schema_version?: number }
    | undefined;
  if (
    !row?.lineage_id ||
    typeof row.nuclear_schema_version !== "number" ||
    !Number.isSafeInteger(row.nuclear_schema_version)
  ) {
    throw continuityError("continuity_lineage_missing");
  }
  return {
    lineageId: row.lineage_id,
    nuclearSchemaVersion: row.nuclear_schema_version,
  };
}

/** Read the durable sidecar migration record, if one exists. */
export function getPendingNuclearMigration(
  continuity: DatabaseSync,
): PendingNuclearMigration | null {
  return readPendingNuclearMigration(continuity);
}

/**
 * Commit a migration intent before changing nuclear schema state.
 * The sidecar version must still identify the source schema.
 */
export function beginNuclearMigration(
  continuity: DatabaseSync,
  input: NuclearMigrationDescriptor,
): void {
  validateNuclearMigrationDescriptor(input);
  withContinuityTransaction(continuity, () => {
    const existing = readPendingNuclearMigration(continuity);
    if (existing) {
      throw continuityError("continuity_migration_pending");
    }
    const state = lineageState(continuity);
    if (state.lineageId !== input.lineageId) {
      throw continuityError("continuity_lineage_mismatch");
    }
    if (state.nuclearSchemaVersion !== input.from) {
      throw new Error(
        `continuity_schema_version_mismatch:${state.nuclearSchemaVersion}!=${input.from}`,
      );
    }
    const now = new Date().toISOString();
    continuity
      .prepare(
        `INSERT INTO continuity_meta (key, value)
         VALUES (?, ?)`,
      )
      .run(PENDING_NUCLEAR_MIGRATION_KEY, migrationMetaValue(input, "pending"));
    recordContinuityEvent(continuity, {
      kind: "migration",
      lineageId: input.lineageId,
      occurredAt: now,
      detail: {
        phase: "pending",
        from: input.from,
        to: input.to,
        buildIdentity: input.buildIdentity,
      },
    });
  });
}

/** Mark the nuclear transaction durable while keeping the record recoverable. */
export function markNuclearMigrationCommitted(
  continuity: DatabaseSync,
  input: NuclearMigrationDescriptor,
): void {
  validateNuclearMigrationDescriptor(input);
  withContinuityTransaction(continuity, () => {
    const existing = readPendingNuclearMigration(continuity);
    if (!existing || !sameNuclearMigration(existing, input)) {
      throw continuityError("continuity_migration_pending_mismatch");
    }
    if (existing.phase !== "pending") {
      throw continuityError("continuity_migration_phase_invalid");
    }
    continuity
      .prepare(`UPDATE continuity_meta SET value = ? WHERE key = ?`)
      .run(
        migrationMetaValue(input, "nuclear_committed"),
        PENDING_NUCLEAR_MIGRATION_KEY,
      );
    recordContinuityEvent(continuity, {
      kind: "migration",
      lineageId: input.lineageId,
      detail: {
        phase: "nuclear_committed",
        from: input.from,
        to: input.to,
        buildIdentity: input.buildIdentity,
      },
    });
  });
}

/** Finalize the sidecar after the nuclear schema has reached the target. */
export function finalizeNuclearMigration(
  continuity: DatabaseSync,
  input: NuclearMigrationDescriptor,
  phase: "success" | "recovered" = "success",
): void {
  validateNuclearMigrationDescriptor(input);
  withContinuityTransaction(continuity, () => {
    const existing = readPendingNuclearMigration(continuity);
    if (!existing || !sameNuclearMigration(existing, input)) {
      throw continuityError("continuity_migration_pending_mismatch");
    }
    if (existing.phase !== "pending" && existing.phase !== "nuclear_committed") {
      throw continuityError("continuity_migration_phase_invalid");
    }
    const state = lineageState(continuity);
    if (state.lineageId !== input.lineageId) {
      throw continuityError("continuity_lineage_mismatch");
    }
    const now = new Date().toISOString();
    continuity
      .prepare(
        `UPDATE lineage_state
         SET nuclear_schema_version = ?, build_identity = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(input.to, input.buildIdentity, now);
    recordContinuityEvent(continuity, {
      kind: "migration",
      lineageId: input.lineageId,
      occurredAt: now,
      detail: {
        phase,
        from: input.from,
        to: input.to,
        buildIdentity: input.buildIdentity,
      },
    });
    continuity
      .prepare(`DELETE FROM continuity_meta WHERE key = ?`)
      .run(PENDING_NUCLEAR_MIGRATION_KEY);
  });
}

/** Roll back only the recognized intent when nuclear remains at the source. */
export function rollbackNuclearMigration(
  continuity: DatabaseSync,
  input: NuclearMigrationDescriptor,
): void {
  validateNuclearMigrationDescriptor(input);
  withContinuityTransaction(continuity, () => {
    const existing = readPendingNuclearMigration(continuity);
    if (!existing || !sameNuclearMigration(existing, input)) {
      throw continuityError("continuity_migration_pending_mismatch");
    }
    if (existing.phase !== "pending" && existing.phase !== "nuclear_committed") {
      throw continuityError("continuity_migration_phase_invalid");
    }
    const state = lineageState(continuity);
    if (state.lineageId !== input.lineageId) {
      throw continuityError("continuity_lineage_mismatch");
    }
    if (state.nuclearSchemaVersion !== input.from) {
      throw new Error(
        `continuity_schema_version_mismatch:${state.nuclearSchemaVersion}!=${input.from}`,
      );
    }
    const now = new Date().toISOString();
    recordContinuityEvent(continuity, {
      kind: "migration",
      lineageId: input.lineageId,
      occurredAt: now,
      detail: {
        phase: "rolled_back",
        from: input.from,
        to: input.to,
        buildIdentity: input.buildIdentity,
      },
    });
    continuity
      .prepare(`DELETE FROM continuity_meta WHERE key = ?`)
      .run(PENDING_NUCLEAR_MIGRATION_KEY);
  });
}

export function migrateContinuity(
  db: DatabaseSync,
  options: { migrate?: boolean } = {},
): void {
  const version = userVersion(db);
  if (version > CONTINUITY_SCHEMA_VERSION) {
    throw new Error(
      `unsupported_continuity_schema:${version}>${CONTINUITY_SCHEMA_VERSION}`,
    );
  }
  if (options.migrate === false) {
    return;
  }
  db.exec("PRAGMA foreign_keys = ON");
  if (version < 1) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(CONTINUITY_SCHEMA);
      db.exec(`PRAGMA user_version = ${CONTINUITY_SCHEMA_VERSION}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  // Idempotent index for durable Discord confirmation uniqueness.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_forget_previews_live_discord
      ON forget_previews (owner_id, confirmation_discord_message_id)
      WHERE status = 'pending' AND confirmation_discord_message_id IS NOT NULL;
  `);
}

export function ensureAuthoritativeLineage(
  continuity: DatabaseSync,
  input: {
    nuclearSchemaVersion: number;
    buildIdentity?: string | null;
    /** When true, never create a new lineage — fail if missing (v13+ reopen). */
    adoptIfMissing?: boolean;
  },
): { lineageId: string; adopted: boolean } {
  const adoptIfMissing = input.adoptIfMissing !== false;
  const existing = continuity
    .prepare(`SELECT lineage_id FROM lineage_state WHERE id = 1`)
    .get() as { lineage_id?: string } | undefined;
  if (existing?.lineage_id) {
    continuity
      .prepare(
        `UPDATE lineage_state
         SET nuclear_schema_version = ?, build_identity = COALESCE(?, build_identity),
             updated_at = ?
         WHERE id = 1`,
      )
      .run(
        input.nuclearSchemaVersion,
        input.buildIdentity ?? null,
        new Date().toISOString(),
      );
    return { lineageId: existing.lineage_id, adopted: false };
  }
  if (!adoptIfMissing) {
    throw continuityError("continuity_lineage_missing");
  }
  const lineageId = randomUUID();
  const now = new Date().toISOString();
  continuity
    .prepare(
      `INSERT INTO lineage_state
         (id, lineage_id, nuclear_schema_version, build_identity, updated_at)
       VALUES (1, ?, ?, ?, ?)`,
    )
    .run(
      lineageId,
      input.nuclearSchemaVersion,
      input.buildIdentity ?? null,
      now,
    );
  continuity
    .prepare(
      `INSERT INTO continuity_events (kind, occurred_at, lineage_id, detail_json)
       VALUES ('release', ?, ?, ?)`,
    )
    .run(
      now,
      lineageId,
      JSON.stringify({
        event: "lineage_adoption",
        nuclearSchemaVersion: input.nuclearSchemaVersion,
      }),
    );
  return { lineageId, adopted: true };
}

/**
 * Resolve lineage for a nuclear DB that already has a lineage_mirror (v13+).
 * Never creates a replacement lineage when the nuclear mirror exists.
 */
export function requireSidecarLineageForNuclearMirror(
  continuity: DatabaseSync,
  nuclearMirrorLineageId: string,
  input: {
    nuclearSchemaVersion: number;
    buildIdentity?: string | null;
  },
): string {
  const existing = continuity
    .prepare(`SELECT lineage_id FROM lineage_state WHERE id = 1`)
    .get() as { lineage_id?: string } | undefined;
  if (!existing?.lineage_id) {
    throw continuityError("continuity_lineage_missing");
  }
  if (existing.lineage_id !== nuclearMirrorLineageId) {
    throw continuityError("continuity_lineage_mismatch");
  }
  continuity
    .prepare(
      `UPDATE lineage_state
       SET nuclear_schema_version = ?, build_identity = COALESCE(?, build_identity),
           updated_at = ?
       WHERE id = 1`,
    )
    .run(
      input.nuclearSchemaVersion,
      input.buildIdentity ?? null,
      new Date().toISOString(),
    );
  return existing.lineage_id;
}

export function requireLineageMatch(
  continuity: DatabaseSync,
  nuclearLineageId: string | null | undefined,
): string {
  const row = continuity
    .prepare(`SELECT lineage_id FROM lineage_state WHERE id = 1`)
    .get() as { lineage_id?: string } | undefined;
  if (!row?.lineage_id) {
    throw continuityError("continuity_lineage_missing");
  }
  if (
    nuclearLineageId != null &&
    nuclearLineageId !== "" &&
    nuclearLineageId !== row.lineage_id
  ) {
    throw continuityError("continuity_lineage_mismatch");
  }
  return row.lineage_id;
}

export function recordContinuityEvent(
  continuity: DatabaseSync,
  input: {
    kind: string;
    lineageId: string;
    detail?: Record<string, unknown>;
    sessionId?: string | null;
    occurredAt?: string;
  },
): number {
  const result = continuity
    .prepare(
      `INSERT INTO continuity_events (kind, occurred_at, lineage_id, detail_json, session_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.kind,
      input.occurredAt ?? new Date().toISOString(),
      input.lineageId,
      JSON.stringify(input.detail ?? {}),
      input.sessionId ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function getAuthoritativeLineageId(continuity: DatabaseSync): string {
  const row = continuity
    .prepare(`SELECT lineage_id FROM lineage_state WHERE id = 1`)
    .get() as { lineage_id?: string } | undefined;
  if (!row?.lineage_id) throw continuityError("continuity_lineage_missing");
  return row.lineage_id;
}
