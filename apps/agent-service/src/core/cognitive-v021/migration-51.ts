import type { DatabaseSync } from "node:sqlite";

const DIRECT_ATTEMPT_COLUMNS = [
  "provider_invocation_id",
  "provider_attempt_id",
] as const;

const THOUGHT_CONTEXT_COMPLETE = `(
  (
    NEW.thought_invocation_id IS NULL AND NEW.thought_cycle_id IS NULL
    AND NEW.thought_generation IS NULL AND NEW.thought_semantic_pass IS NULL
    AND NEW.thought_structural_attempt IS NULL AND NEW.thought_authority_epoch IS NULL
    AND NEW.thought_authority_vector_json IS NULL AND NEW.thought_trigger_ref IS NULL
    AND NEW.semantic_projection_hash IS NULL AND NEW.dispatch_messages_hash IS NULL
    AND NEW.allowlist_fingerprint IS NULL AND NEW.mf_invocation_id IS NULL
    AND NEW.mf_attempt_id IS NULL AND NEW.provider_invocation_id IS NULL
    AND NEW.provider_attempt_id IS NULL AND NEW.actual_provider IS NULL
    AND NEW.actual_occupant_id IS NULL AND NEW.actual_wire_binding_id IS NULL
    AND NEW.schema_enforcement_mode IS NULL AND NEW.resource_policy_fingerprint IS NULL
    AND NEW.absolute_deadline_at_ms IS NULL
  )
  OR
  (
    NEW.thought_invocation_id IS NOT NULL AND NEW.thought_cycle_id IS NOT NULL
    AND NEW.thought_generation IS NOT NULL AND NEW.thought_semantic_pass IS NOT NULL
    AND NEW.thought_structural_attempt IS NOT NULL AND NEW.thought_authority_epoch IS NOT NULL
    AND NEW.thought_authority_vector_json IS NOT NULL AND NEW.thought_trigger_ref IS NOT NULL
    AND NEW.semantic_projection_hash IS NOT NULL AND NEW.dispatch_messages_hash IS NOT NULL
    AND NEW.allowlist_fingerprint IS NOT NULL AND NEW.mf_invocation_id IS NOT NULL
    AND NEW.mf_attempt_id IS NOT NULL AND NEW.provider_invocation_id IS NULL
    AND NEW.provider_attempt_id IS NULL AND NEW.actual_provider IS NOT NULL
    AND NEW.actual_occupant_id IS NOT NULL AND NEW.actual_wire_binding_id IS NOT NULL
    AND NEW.schema_enforcement_mode IS NOT NULL AND NEW.resource_policy_fingerprint IS NOT NULL
    AND NEW.absolute_deadline_at_ms IS NOT NULL
  )
  OR
  (
    NEW.thought_invocation_id IS NOT NULL AND NEW.thought_cycle_id IS NOT NULL
    AND NEW.thought_generation IS NOT NULL AND NEW.thought_semantic_pass IS NOT NULL
    AND NEW.thought_structural_attempt IS NOT NULL AND NEW.thought_authority_epoch IS NOT NULL
    AND NEW.thought_authority_vector_json IS NOT NULL AND NEW.thought_trigger_ref IS NOT NULL
    AND NEW.semantic_projection_hash IS NOT NULL AND NEW.dispatch_messages_hash IS NOT NULL
    AND NEW.allowlist_fingerprint IS NOT NULL AND NEW.mf_invocation_id IS NULL
    AND NEW.mf_attempt_id IS NULL AND NEW.provider_invocation_id IS NOT NULL
    AND NEW.provider_attempt_id IS NOT NULL AND NEW.actual_provider = 'command_code'
    AND NEW.actual_occupant_id IS NOT NULL AND NEW.actual_wire_binding_id IS NOT NULL
    AND NEW.schema_enforcement_mode IS NOT NULL AND NEW.resource_policy_fingerprint IS NOT NULL
    AND NEW.absolute_deadline_at_ms IS NOT NULL
  )
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

const TRIGGER_WHEN = `NOT ${THOUGHT_CONTEXT_COMPLETE} OR NOT ${THOUGHT_CONTEXT_NUMERICS_VALID}`;
const TRIGGER_COLUMNS = [
  "thought_invocation_id", "thought_cycle_id", "thought_generation",
  "thought_semantic_pass", "thought_structural_attempt", "thought_authority_epoch",
  "thought_authority_vector_json", "thought_trigger_ref", "semantic_projection_hash",
  "dispatch_messages_hash", "allowlist_fingerprint", "mf_invocation_id", "mf_attempt_id",
  "provider_invocation_id", "provider_attempt_id", "actual_provider", "actual_occupant_id",
  "actual_wire_binding_id", "schema_enforcement_mode", "resource_policy_fingerprint",
  "absolute_deadline_at_ms",
].join(", ");

function hasColumn(db: DatabaseSync, name: string): boolean {
  return (db.prepare("PRAGMA table_info(attention_requests)").all() as Array<{ name?: string }>)
    .some((row) => row.name === name);
}
function hasObject(db: DatabaseSync, type: string, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?",
  ).get(type, name));
}

function installTriggers(db: DatabaseSync): void {
  db.exec(`
    DROP TRIGGER IF EXISTS attention_requests_thought_context_complete_insert;
    DROP TRIGGER IF EXISTS attention_requests_thought_context_complete_update;
    CREATE TRIGGER attention_requests_thought_context_complete_insert
    BEFORE INSERT ON attention_requests
    WHEN ${TRIGGER_WHEN}
    BEGIN SELECT RAISE(ABORT, 'thought_attempt_context_incomplete'); END;
    CREATE TRIGGER attention_requests_thought_context_complete_update
    BEFORE UPDATE OF ${TRIGGER_COLUMNS} ON attention_requests
    WHEN ${TRIGGER_WHEN}
    BEGIN SELECT RAISE(ABORT, 'thought_attempt_context_incomplete'); END;
  `);
}

/** Add provider-neutral direct attempt IDs while retaining legacy MF rows. */
export function ensureNuclearV51Schema(db: DatabaseSync): void {
  for (const column of DIRECT_ATTEMPT_COLUMNS) {
    if (!hasColumn(db, column)) db.exec(`ALTER TABLE attention_requests ADD COLUMN ${column} TEXT`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS attention_requests_provider_attempt
      ON attention_requests(provider_attempt_id)
      WHERE provider_attempt_id IS NOT NULL;
  `);
  installTriggers(db);
}

export function validateNuclearV51Schema(db: DatabaseSync, version = 51): void {
  for (const column of DIRECT_ATTEMPT_COLUMNS) {
    if (!hasColumn(db, column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:missing_column:attention_requests.${column}`);
    }
  }
  if (!hasObject(db, "index", "attention_requests_provider_attempt")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:missing_index:attention_requests_provider_attempt`);
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

export function requireNoNuclearV51Content(db: DatabaseSync, version = 50): void {
  for (const column of DIRECT_ATTEMPT_COLUMNS) {
    if (hasColumn(db, column)) {
      throw new Error(`nuclear_schema_content_invalid:v${version}:unexpected_column:attention_requests.${column}`);
    }
  }
  if (hasObject(db, "index", "attention_requests_provider_attempt")) {
    throw new Error(`nuclear_schema_content_invalid:v${version}:unexpected_index:attention_requests_provider_attempt`);
  }
}
