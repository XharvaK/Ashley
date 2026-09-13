import type { DatabaseSync } from "node:sqlite";

const THOUGHT_COLUMNS = [
  "thought_invocation_id",
  "thought_cycle_id",
  "thought_generation",
  "thought_semantic_pass",
  "thought_structural_attempt",
  "thought_authority_epoch",
  "thought_authority_vector_json",
  "thought_trigger_ref",
  "semantic_projection_hash",
  "dispatch_messages_hash",
  "allowlist_fingerprint",
  "mf_invocation_id",
  "mf_attempt_id",
  "actual_provider",
  "actual_occupant_id",
  "actual_wire_binding_id",
  "schema_enforcement_mode",
  "resource_policy_fingerprint",
  "absolute_deadline_at_ms",
] as const;

const THOUGHT_CONTEXT_COMPLETE = `(
  (NEW.thought_invocation_id IS NULL AND NEW.thought_cycle_id IS NULL
   AND NEW.thought_generation IS NULL AND NEW.thought_semantic_pass IS NULL
   AND NEW.thought_structural_attempt IS NULL AND NEW.thought_authority_epoch IS NULL
   AND NEW.thought_authority_vector_json IS NULL AND NEW.thought_trigger_ref IS NULL
   AND NEW.semantic_projection_hash IS NULL AND NEW.dispatch_messages_hash IS NULL
   AND NEW.allowlist_fingerprint IS NULL AND NEW.mf_invocation_id IS NULL
   AND NEW.mf_attempt_id IS NULL AND NEW.actual_provider IS NULL
   AND NEW.actual_occupant_id IS NULL AND NEW.actual_wire_binding_id IS NULL
   AND NEW.schema_enforcement_mode IS NULL AND NEW.resource_policy_fingerprint IS NULL
   AND NEW.absolute_deadline_at_ms IS NULL)
  OR
  (NEW.thought_invocation_id IS NOT NULL AND NEW.thought_cycle_id IS NOT NULL
   AND NEW.thought_generation IS NOT NULL AND NEW.thought_semantic_pass IS NOT NULL
   AND NEW.thought_structural_attempt IS NOT NULL AND NEW.thought_authority_epoch IS NOT NULL
   AND NEW.thought_authority_vector_json IS NOT NULL AND NEW.thought_trigger_ref IS NOT NULL
   AND NEW.semantic_projection_hash IS NOT NULL AND NEW.dispatch_messages_hash IS NOT NULL
   AND NEW.allowlist_fingerprint IS NOT NULL AND NEW.mf_invocation_id IS NOT NULL
   AND NEW.mf_attempt_id IS NOT NULL AND NEW.actual_provider IS NOT NULL
   AND NEW.actual_occupant_id IS NOT NULL AND NEW.actual_wire_binding_id IS NOT NULL
   AND NEW.schema_enforcement_mode IS NOT NULL AND NEW.resource_policy_fingerprint IS NOT NULL
   AND NEW.absolute_deadline_at_ms IS NOT NULL)
)`;
const THOUGHT_CONTEXT_NUMERICS_VALID = `(
  NEW.thought_generation IS NULL OR (typeof(NEW.thought_generation) = 'integer' AND NEW.thought_generation >= 0)
) AND (
  NEW.thought_semantic_pass IS NULL OR (typeof(NEW.thought_semantic_pass) = 'integer' AND NEW.thought_semantic_pass >= 0)
) AND (
  NEW.thought_structural_attempt IS NULL OR (typeof(NEW.thought_structural_attempt) = 'integer' AND NEW.thought_structural_attempt >= 0)
) AND (
  NEW.thought_authority_epoch IS NULL OR (typeof(NEW.thought_authority_epoch) = 'integer' AND NEW.thought_authority_epoch >= 0)
) AND (
  NEW.absolute_deadline_at_ms IS NULL OR (typeof(NEW.absolute_deadline_at_ms) = 'integer' AND NEW.absolute_deadline_at_ms > 0)
)`;
const THOUGHT_CONTEXT_TRIGGER_WHEN = `NOT ${THOUGHT_CONTEXT_COMPLETE} OR NOT ${THOUGHT_CONTEXT_NUMERICS_VALID}`;

export const MIGRATION_43_THOUGHT_ATTEMPT_DDL = `
ALTER TABLE attention_requests ADD COLUMN thought_invocation_id TEXT;
ALTER TABLE attention_requests ADD COLUMN thought_cycle_id TEXT;
ALTER TABLE attention_requests ADD COLUMN thought_generation INTEGER;
ALTER TABLE attention_requests ADD COLUMN thought_semantic_pass INTEGER;
ALTER TABLE attention_requests ADD COLUMN thought_structural_attempt INTEGER;
ALTER TABLE attention_requests ADD COLUMN thought_authority_epoch INTEGER;
ALTER TABLE attention_requests ADD COLUMN thought_authority_vector_json TEXT;
ALTER TABLE attention_requests ADD COLUMN thought_trigger_ref TEXT;
ALTER TABLE attention_requests ADD COLUMN semantic_projection_hash TEXT;
ALTER TABLE attention_requests ADD COLUMN dispatch_messages_hash TEXT;
ALTER TABLE attention_requests ADD COLUMN allowlist_fingerprint TEXT;
ALTER TABLE attention_requests ADD COLUMN mf_invocation_id TEXT;
ALTER TABLE attention_requests ADD COLUMN mf_attempt_id TEXT;
ALTER TABLE attention_requests ADD COLUMN actual_provider TEXT;
ALTER TABLE attention_requests ADD COLUMN actual_occupant_id TEXT;
ALTER TABLE attention_requests ADD COLUMN actual_wire_binding_id TEXT;
ALTER TABLE attention_requests ADD COLUMN schema_enforcement_mode TEXT;
ALTER TABLE attention_requests ADD COLUMN resource_policy_fingerprint TEXT;
ALTER TABLE attention_requests ADD COLUMN absolute_deadline_at_ms INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS attention_requests_thought_invocation
  ON attention_requests(thought_invocation_id)
  WHERE thought_invocation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attention_requests_mf_attempt
  ON attention_requests(mf_attempt_id)
  WHERE mf_attempt_id IS NOT NULL;
CREATE TRIGGER attention_requests_thought_context_complete_insert
BEFORE INSERT ON attention_requests
WHEN ${THOUGHT_CONTEXT_TRIGGER_WHEN}
BEGIN SELECT RAISE(ABORT, 'thought_attempt_context_incomplete'); END;
CREATE TRIGGER attention_requests_thought_context_complete_update
BEFORE UPDATE OF thought_invocation_id, thought_cycle_id, thought_generation,
  thought_semantic_pass, thought_structural_attempt, thought_authority_epoch,
  thought_authority_vector_json, thought_trigger_ref, semantic_projection_hash,
  dispatch_messages_hash, allowlist_fingerprint, mf_invocation_id, mf_attempt_id,
  actual_provider, actual_occupant_id, actual_wire_binding_id,
  schema_enforcement_mode, resource_policy_fingerprint, absolute_deadline_at_ms
ON attention_requests
WHEN ${THOUGHT_CONTEXT_TRIGGER_WHEN}
BEGIN SELECT RAISE(ABORT, 'thought_attempt_context_incomplete'); END;
`;

function hasColumn(db: DatabaseSync, name: string): boolean {
  return (db.prepare("PRAGMA table_info(attention_requests)").all() as Array<{ name?: string }>)
    .some((row) => row.name === name);
}

function hasObject(db: DatabaseSync, type: string, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
  ).get(type, name));
}

export function ensureNuclearV43Schema(db: DatabaseSync): void {
  const definitions: Record<string, string> = {
    thought_invocation_id: "TEXT",
    thought_cycle_id: "TEXT",
    thought_generation: "INTEGER",
    thought_semantic_pass: "INTEGER",
    thought_structural_attempt: "INTEGER",
    thought_authority_epoch: "INTEGER",
    thought_authority_vector_json: "TEXT",
    thought_trigger_ref: "TEXT",
    semantic_projection_hash: "TEXT",
    dispatch_messages_hash: "TEXT",
    allowlist_fingerprint: "TEXT",
    mf_invocation_id: "TEXT",
    mf_attempt_id: "TEXT",
    actual_provider: "TEXT",
    actual_occupant_id: "TEXT",
    actual_wire_binding_id: "TEXT",
    schema_enforcement_mode: "TEXT",
    resource_policy_fingerprint: "TEXT",
    absolute_deadline_at_ms: "INTEGER",
  };
  for (const column of THOUGHT_COLUMNS) {
    if (!hasColumn(db, column)) {
      db.exec(`ALTER TABLE attention_requests ADD COLUMN ${column} ${definitions[column]}`);
    }
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS attention_requests_thought_invocation
      ON attention_requests(thought_invocation_id)
      WHERE thought_invocation_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS attention_requests_mf_attempt
      ON attention_requests(mf_attempt_id)
      WHERE mf_attempt_id IS NOT NULL;
  `);
  if (!hasObject(db, "trigger", "attention_requests_thought_context_complete_insert")) {
    db.exec(`
      CREATE TRIGGER attention_requests_thought_context_complete_insert
      BEFORE INSERT ON attention_requests
      WHEN ${THOUGHT_CONTEXT_TRIGGER_WHEN}
      BEGIN SELECT RAISE(ABORT, 'thought_attempt_context_incomplete'); END;
    `);
  }
  if (!hasObject(db, "trigger", "attention_requests_thought_context_complete_update")) {
    db.exec(`
      CREATE TRIGGER attention_requests_thought_context_complete_update
      BEFORE UPDATE OF ${THOUGHT_COLUMNS.join(", ")} ON attention_requests
      WHEN ${THOUGHT_CONTEXT_TRIGGER_WHEN}
      BEGIN SELECT RAISE(ABORT, 'thought_attempt_context_incomplete'); END;
    `);
  }
}

export function validateNuclearV43Schema(db: DatabaseSync, version = 43): void {
  for (const column of THOUGHT_COLUMNS) {
    if (!hasColumn(db, column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:attention_requests.${column}`);
    }
  }
  for (const index of ["attention_requests_thought_invocation", "attention_requests_mf_attempt"]) {
    if (!hasObject(db, "index", index)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_index:${index}`);
    }
  }
  for (const trigger of [
    "attention_requests_thought_context_complete_insert",
    "attention_requests_thought_context_complete_update",
  ]) {
    if (!hasObject(db, "trigger", trigger)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_trigger:${trigger}`);
    }
  }
}
