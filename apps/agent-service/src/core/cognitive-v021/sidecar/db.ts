import { DatabaseSync } from "node:sqlite";
import {
  isReservedProductionStoragePath,
  type DataPlaneContext,
} from "../../data-plane.js";
import {
  ARCHITECTURE_EPOCH,
  COGNITIVE_SIDECAR_SCHEMA_VERSION,
  IMPLEMENTATION_SPEC_VERSION,
  THOUGHT_CONTRACT_VERSION,
} from "../types.js";
import { stableJson } from "../../model-fabric/hash.js";
import type { AuthorityVersionVector } from "../types.js";
import {
  COGNITIVE_SIDECAR_SCHEMA_V1,
  COGNITIVE_SIDECAR_SCHEMA_V2,
  COGNITIVE_SIDECAR_SCHEMA_V3,
  COGNITIVE_SIDECAR_SCHEMA_V4,
  COGNITIVE_SIDECAR_SCHEMA_V5,
  COGNITIVE_SIDECAR_SCHEMA_V6,
  COGNITIVE_SIDECAR_SCHEMA_V7,
  COGNITIVE_SIDECAR_SCHEMA_V8,
  COGNITIVE_SIDECAR_SCHEMA_V9,
  COGNITIVE_SIDECAR_SCHEMA_V10,
  COGNITIVE_SIDECAR_SCHEMA_V11,
  COGNITIVE_SIDECAR_SCHEMA_V12,
  COGNITIVE_SIDECAR_SCHEMA_V13,
  COGNITIVE_SIDECAR_SCHEMA_V14,
  COGNITIVE_SIDECAR_SCHEMA_V15,
  COGNITIVE_SIDECAR_SCHEMA_V16,
} from "./schema.js";
import { recoverCognitiveSidecar } from "./recovery.js";
import { cycleIdFor, occurrenceIdFor, wakeIdFor } from "../wake/identity.js";

export type CognitiveSidecarDataPlane = Pick<DataPlaneContext, "kind">;

export type CognitiveSidecarDbOptions = {
  dataPlane: CognitiveSidecarDataPlane;
  migrate?: boolean;
};

export type CognitiveSidecarMeta = {
  id: 1;
  schema_version: number;
  architecture_epoch: string;
  implementation_spec_version: string;
  thought_contract_version: number;
  authority_epoch: number;
  projection_barrier_revision?: number;
  projection_vector_json?: string;
  projection_state?: "current" | "reconciling";
};

function sidecarError(code: string, message = code): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function databaseMainFile(existing: DatabaseSync): string {
  const rows = existing.prepare("PRAGMA database_list").all() as Array<{
    name?: string;
    file?: string;
  }>;
  return rows.find((row) => row.name === "main")?.file?.trim() ?? "";
}

function userVersion(existing: DatabaseSync): number {
  const row = existing.prepare("PRAGMA user_version").get() as {
    user_version?: number;
  };
  return Number(row.user_version ?? 0);
}

function ensureMeta(existing: DatabaseSync): void {
  const row = existing
    .prepare("SELECT * FROM cognitive_sidecar_meta WHERE id = 1")
    .get() as Partial<CognitiveSidecarMeta> | undefined;
  if (!row) {
    existing
      .prepare(
        `INSERT INTO cognitive_sidecar_meta
           (id, schema_version, architecture_epoch, implementation_spec_version,
            thought_contract_version, authority_epoch)
         VALUES (1, ?, ?, ?, ?, 1)`,
      )
      .run(
        COGNITIVE_SIDECAR_SCHEMA_VERSION,
        ARCHITECTURE_EPOCH,
        IMPLEMENTATION_SPEC_VERSION,
        THOUGHT_CONTRACT_VERSION,
      );
    return;
  }
  if (
    Number(row.schema_version) !== COGNITIVE_SIDECAR_SCHEMA_VERSION ||
    row.architecture_epoch !== ARCHITECTURE_EPOCH ||
    row.implementation_spec_version !== IMPLEMENTATION_SPEC_VERSION ||
    Number(row.thought_contract_version) !== THOUGHT_CONTRACT_VERSION
  ) {
    throw sidecarError("cognitive_sidecar_meta_invalid");
  }
}

function foreignKeysEnabled(existing: DatabaseSync): number {
  const row = existing.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: unknown };
  return Number(row.foreign_keys ?? 0);
}

const WAKE_COLUMNS = [
  "wake_id",
  "occurrence_id",
  "trigger_ref",
  "source_kind",
  "conversation_id",
  "cycle_id",
  "state",
  "terminal_reason",
  "captured_trigger_generation",
  "captured_authority_revision",
  "consequence_chain_id",
  "lease_owner",
  "lease_token",
  "lease_expires_at_ms",
  "cancellation_id",
  "created_at_ms",
  "updated_at_ms",
] as const;

function migrateWakeTerminalVocabulary(existing: DatabaseSync): void {
  let transactionOpen = false;
  let migrationFailure: unknown = null;
  let restoreFailure: unknown = null;
  try {
    // SQLite ignores PRAGMA foreign_keys changes inside a transaction. This
    // is deliberately outside BEGIN IMMEDIATE and restored in finally.
    existing.exec("PRAGMA foreign_keys = OFF");
    if (foreignKeysEnabled(existing) !== 0) throw sidecarError("wake_v12_foreign_keys_disable_failed");
    existing.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    existing.exec(COGNITIVE_SIDECAR_SCHEMA_V12);
    const oldCount = Number((existing.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count?: unknown }).count ?? -1);
    const newCount = Number((existing.prepare("SELECT COUNT(*) AS count FROM wakes_v12").get() as { count?: unknown }).count ?? -1);
    if (oldCount !== newCount) throw sidecarError("wake_v12_row_count_mismatch");
    const columnSql = WAKE_COLUMNS.join(", ");
    const oldRows = existing.prepare(`SELECT ${columnSql} FROM wakes ORDER BY wake_id`).all();
    const newRows = existing.prepare(`SELECT ${columnSql} FROM wakes_v12 ORDER BY wake_id`).all();
    if (stableJson(oldRows) !== stableJson(newRows)) throw sidecarError("wake_v12_row_content_mismatch");

    existing.exec(`
      DROP INDEX IF EXISTS idx_wakes_claim;
      DROP INDEX IF EXISTS idx_wakes_conversation;
      DROP TABLE wakes;
      ALTER TABLE wakes_v12 RENAME TO wakes;
      CREATE INDEX idx_wakes_claim ON wakes(state, lease_expires_at_ms, created_at_ms, wake_id);
      CREATE INDEX idx_wakes_conversation ON wakes(conversation_id, state, created_at_ms);
    `);
    const foreignKeyViolations = existing.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) throw sidecarError("wake_v12_foreign_key_check_failed");
    existing.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 12 WHERE id = 1").run();
    existing.exec("PRAGMA user_version = 12");
    existing.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    migrationFailure = error;
    if (transactionOpen) {
      try { existing.exec("ROLLBACK"); } catch { /* preserve the migration error */ }
      transactionOpen = false;
    }
  } finally {
    try {
      existing.exec("PRAGMA foreign_keys = ON");
      if (foreignKeysEnabled(existing) !== 1) throw sidecarError("wake_v12_foreign_keys_restore_failed");
    } catch (error) {
      restoreFailure = error;
    }
  }
  if (migrationFailure) throw migrationFailure;
  if (restoreFailure) throw restoreFailure;
}

type LegacyRow = Record<string, unknown>;

function legacyText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function legacyNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function legacySourceKind(triggerKind: string): "inbox" | "future_trigger" | "idle" | "subscription" {
  if (triggerKind === "future_trigger_due") return "future_trigger";
  if (triggerKind === "idle_opportunity") return "idle";
  if (triggerKind === "subscription_item") return "subscription";
  return "inbox";
}

function quarantineLegacyRow(
  db: DatabaseSync,
  tableName: string,
  rowKey: string,
  reason: string,
  nowMs: number,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO wake_legacy_quarantine
       (quarantine_id, table_name, row_key, reason, payload_json, quarantined_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    `legacy-quarantine:${tableName}:${rowKey}`,
    tableName,
    rowKey,
    reason,
    JSON.stringify({ tableName, rowKey, reason }),
    nowMs,
  );
}

function insertLegacyWakeForCycle(db: DatabaseSync, row: LegacyRow, nowMs: number): string | null {
  const cycleId = legacyText(row.cycle_id);
  const conversationId = legacyText(row.conversation_id);
  if (!cycleId || !conversationId) return null;
  const triggerKind = legacyText(row.trigger_kind) || "owner_message";
  const triggerRef = legacyText(row.trigger_ref) || `legacy-cycle:${cycleId}`;
  const sourceKind = legacySourceKind(triggerKind);
  const occurrenceId = occurrenceIdFor({
    sourceKind,
    triggerRef: `legacy-cycle:${cycleId}:${triggerRef}`,
    conversationId,
  });
  const wakeId = wakeIdFor(occurrenceId);
  db.prepare(
    `INSERT OR IGNORE INTO wakes
       (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
        state, terminal_reason, captured_trigger_generation, captured_authority_revision,
        created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?)`,
  ).run(
    wakeId,
    occurrenceId,
    triggerRef,
    sourceKind,
    conversationId,
    cycleId,
    row.generation == null ? null : legacyNumber(row.generation),
    0,
    nowMs,
    nowMs,
  );
  db.prepare("UPDATE cycle_records SET wake_id = ? WHERE cycle_id = ? AND wake_id IS NULL").run(wakeId, cycleId);
  return wakeId;
}

function classifyLegacySidecarRows(db: DatabaseSync): void {
  const nowMs = Date.now();
  const cycles = db.prepare("SELECT * FROM cycle_records WHERE wake_id IS NULL ORDER BY admitted_at_ms ASC, cycle_id ASC").all() as LegacyRow[];
  for (const cycle of cycles) {
    const wakeId = insertLegacyWakeForCycle(db, cycle, nowMs);
    if (!wakeId) quarantineLegacyRow(db, "cycle_records", legacyText(cycle.cycle_id), "legacy_ambiguous", nowMs);
  }

  const firedTriggers = db.prepare("SELECT * FROM future_triggers WHERE status = 'fired' AND wake_id IS NULL ORDER BY due_at_ms ASC, trigger_id ASC").all() as LegacyRow[];
  for (const trigger of firedTriggers) {
    const triggerId = legacyText(trigger.trigger_id);
    const conversationId = legacyText(trigger.conversation_id);
    if (!triggerId || !conversationId) {
      quarantineLegacyRow(db, "future_triggers", triggerId || "unknown", "legacy_ambiguous", nowMs);
      continue;
    }
    const occurrenceId = occurrenceIdFor({ sourceKind: "future_trigger", triggerRef: triggerId, conversationId });
    const wakeId = wakeIdFor(occurrenceId);
    const cycleId = cycleIdFor(wakeId);
    db.prepare(
      `INSERT OR IGNORE INTO wakes
         (wake_id, occurrence_id, trigger_ref, source_kind, conversation_id, cycle_id,
          state, terminal_reason, captured_trigger_generation, captured_authority_revision,
          created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'future_trigger', ?, ?, 'pending', NULL, NULL, 0, ?, ?)`,
    ).run(wakeId, occurrenceId, triggerId, conversationId, cycleId, nowMs, nowMs);
    const maxGeneration = db.prepare(
      "SELECT MAX(generation) AS generation FROM cycle_records WHERE conversation_id = ?",
    ).get(conversationId) as LegacyRow | undefined;
    db.prepare(
      `INSERT OR IGNORE INTO cycle_records
         (cycle_id, conversation_id, generation, wake_id, state, trigger_kind, trigger_ref,
          occupant_id, authority_epoch, architecture_epoch, admitted_at_ms, updated_at_ms,
          compose_log_ids_json, preempted_generation)
       VALUES (?, ?, ?, ?, 'admitted', 'future_trigger_due', ?, NULL, 1, ?, ?, ?, '[]', NULL)`,
    ).run(
      cycleId,
      conversationId,
      legacyNumber(maxGeneration?.generation) + 1,
      wakeId,
      triggerId,
      ARCHITECTURE_EPOCH,
      nowMs,
      nowMs,
    );
    db.prepare("UPDATE future_triggers SET wake_id = ? WHERE trigger_id = ? AND wake_id IS NULL").run(wakeId, triggerId);
  }

  const inboxRows = db.prepare("SELECT id, payload_json FROM inbox_events WHERE wake_id IS NULL ORDER BY created_at_ms ASC, id ASC").all() as LegacyRow[];
  for (const row of inboxRows) {
    const eventId = legacyText(row.id);
    let payload: LegacyRow = {};
    try {
      const parsed = JSON.parse(legacyText(row.payload_json));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = parsed as LegacyRow;
    } catch { /* classify as ambiguous below */ }
    const cycleId = legacyText(payload.cycleId);
    const cycle = cycleId ? db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = ?").get(cycleId) as LegacyRow | undefined : undefined;
    const wakeId = legacyText(cycle?.wake_id);
    if (wakeId) {
      db.prepare("UPDATE inbox_events SET wake_id = ? WHERE id = ? AND wake_id IS NULL").run(wakeId, eventId);
    } else {
      quarantineLegacyRow(db, "inbox_events", eventId, "legacy_ambiguous", nowMs);
      db.prepare("UPDATE inbox_events SET status = 'failed_terminal', last_error = 'legacy_ambiguous' WHERE id = ? AND wake_id IS NULL").run(eventId);
    }
  }

  for (const table of ["settlements", "in_flight_effects"] as const) {
    const key = table === "settlements" ? "settlement_id" : "effect_id";
    const rows = db.prepare(`SELECT ${key}, cycle_id FROM ${table} WHERE wake_id IS NULL`).all() as LegacyRow[];
    for (const row of rows) {
      const rowKey = legacyText(row[key]);
      const cycle = db.prepare("SELECT wake_id FROM cycle_records WHERE cycle_id = ?").get(legacyText(row.cycle_id)) as LegacyRow | undefined;
      const wakeId = legacyText(cycle?.wake_id);
      if (wakeId) {
        db.prepare(`UPDATE ${table} SET wake_id = ? WHERE ${key} = ? AND wake_id IS NULL`).run(wakeId, rowKey);
      } else {
        quarantineLegacyRow(db, table, rowKey, "legacy_ambiguous", nowMs);
        if (table === "in_flight_effects") db.prepare("UPDATE in_flight_effects SET state = 'unknown' WHERE effect_id = ?").run(rowKey);
      }
    }
  }
}

/**
 * Open an already-created SQLite handle on the explicitly selected data
 * plane. Sidecar schema application is isolated from nuclear migrations.
 */
export function openCognitiveSidecarDb(
  existing: DatabaseSync,
  options: CognitiveSidecarDbOptions,
): DatabaseSync {
  if (!existing) throw sidecarError("data_plane_required");
  const file = databaseMainFile(existing);
  if (file && isReservedProductionStoragePath(file)) {
    if (options.dataPlane?.kind !== "production") {
      throw sidecarError("production_data_plane_required");
    }
  }

  const version = userVersion(existing);
  if (version > COGNITIVE_SIDECAR_SCHEMA_VERSION) {
    throw sidecarError(
      `unsupported_cognitive_sidecar_schema:${version}>${COGNITIVE_SIDECAR_SCHEMA_VERSION}`,
    );
  }
  if (options.migrate === false) return existing;

  existing.exec("PRAGMA foreign_keys = ON");
  const migrateLegacy = (): void => {
    existing.exec("BEGIN IMMEDIATE");
    try {
      existing.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
      if (version < 2) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V2);
      if (version < 3) {
        existing.exec(COGNITIVE_SIDECAR_SCHEMA_V3);
        classifyLegacySidecarRows(existing);
      }
      if (version < 4) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V4);
      if (version < 5) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V5);
      if (version < 6) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V6);
      if (version < 7) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V7);
      if (version < 8) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V8);
      if (version < 9) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V9);
      if (version < 10) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V10);
      if (version < 11) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V11);
      if (version < 12) existing.exec("PRAGMA user_version = 11");
      existing.exec("COMMIT");
    } catch (error) {
      try { existing.exec("ROLLBACK"); } catch { /* preserve original schema error */ }
      throw error;
    }
  };

  if (version < 12) {
    migrateLegacy();
    migrateWakeTerminalVocabulary(existing);
    existing.exec("BEGIN IMMEDIATE");
    try {
      existing.exec(COGNITIVE_SIDECAR_SCHEMA_V13);
      existing.exec(COGNITIVE_SIDECAR_SCHEMA_V14);
      existing.exec(COGNITIVE_SIDECAR_SCHEMA_V15);
      existing.exec(COGNITIVE_SIDECAR_SCHEMA_V16);
      existing.exec("PRAGMA user_version = 16");
      existing.exec("COMMIT");
    } catch (error) {
      try { existing.exec("ROLLBACK"); } catch { /* preserve original schema error */ }
      throw error;
    }
  } else {
    existing.exec("BEGIN IMMEDIATE");
    try {
      existing.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
      if (version < 13) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V13);
      if (version < 14) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V14);
      if (version < 15) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V15);
      if (version < 16) existing.exec(COGNITIVE_SIDECAR_SCHEMA_V16);
      existing.exec(`PRAGMA user_version = ${COGNITIVE_SIDECAR_SCHEMA_VERSION}`);
      ensureMeta(existing);
      existing.exec("COMMIT");
    } catch (error) {
      try { existing.exec("ROLLBACK"); } catch { /* preserve original schema error */ }
      throw error;
    }
  }
  ensureMeta(existing);
  recoverCognitiveSidecar(existing);
  return existing;
}

export function readCognitiveSidecarMeta(
  sidecar: DatabaseSync,
): CognitiveSidecarMeta {
  const row = sidecar
    .prepare("SELECT * FROM cognitive_sidecar_meta WHERE id = 1")
    .get() as CognitiveSidecarMeta | undefined;
  if (!row) throw sidecarError("cognitive_sidecar_meta_missing");
  return row;
}

export function updateCognitiveAuthorityEpoch(
  sidecar: DatabaseSync,
  authorityEpoch: number,
): void {
  const result = sidecar
    .prepare(
      "UPDATE cognitive_sidecar_meta SET authority_epoch = ? WHERE id = 1",
    )
    .run(authorityEpoch);
  if (Number(result.changes) !== 1) {
    throw sidecarError("cognitive_sidecar_meta_missing");
  }
}

export type CognitiveSidecarProjectionState = Readonly<{
  barrierRevision: number;
  ownerVersions: AuthorityVersionVector;
  state: "current" | "reconciling";
}>;

export function readCognitiveProjectionState(
  sidecar: DatabaseSync,
): CognitiveSidecarProjectionState {
  const row = sidecar.prepare(
    `SELECT projection_barrier_revision, projection_vector_json, projection_state
       FROM cognitive_sidecar_meta WHERE id = 1`,
  ).get() as {
    projection_barrier_revision?: unknown;
    projection_vector_json?: unknown;
    projection_state?: unknown;
  } | undefined;
  if (!row) throw sidecarError("cognitive_sidecar_meta_missing");
  const state = row.projection_state === "current" || row.projection_state === "reconciling"
    ? row.projection_state
    : null;
  if (!state) throw sidecarError("cognitive_sidecar_projection_state_invalid");
  let vector: AuthorityVersionVector;
  try {
    const parsed = JSON.parse(String(row.projection_vector_json ?? "{}"));
    const values = parsed as Record<string, unknown>;
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("invalid");
    const owners = ["nuclear", "continuity", "cognitive_sidecar"] as const;
    if (state === "reconciling" && Object.keys(values).length === 0) {
      vector = { nuclear: 0, continuity: 0, cognitive_sidecar: 0 };
    } else if (owners.some((owner) => !Number.isInteger(Number(values[owner])) || Number(values[owner]) < 0)) {
      throw new Error("invalid");
    } else {
      vector = { nuclear: Number(values.nuclear), continuity: Number(values.continuity), cognitive_sidecar: Number(values.cognitive_sidecar) };
    }
  } catch {
    throw sidecarError("cognitive_sidecar_projection_vector_invalid");
  }
  return {
    barrierRevision: Number(row.projection_barrier_revision ?? 0),
    ownerVersions: vector,
    state,
  };
}

export function updateCognitiveProjectionState(
  sidecar: DatabaseSync,
  barrierRevision: number,
  ownerVersions: AuthorityVersionVector,
  state: "current" | "reconciling",
): void {
  if (!Number.isInteger(barrierRevision) || barrierRevision < 0) {
    throw sidecarError("cognitive_sidecar_projection_revision_invalid");
  }
  const result = sidecar.prepare(
    `UPDATE cognitive_sidecar_meta
        SET projection_barrier_revision = ?, projection_vector_json = ?,
            projection_state = ?
      WHERE id = 1`,
  ).run(barrierRevision, stableJson(ownerVersions), state);
  if (Number(result.changes) !== 1) throw sidecarError("cognitive_sidecar_meta_missing");
}
