/**
 * Nuclear schema v27 — Durable agency effect-intent admission ledger.
 *
 * `sandbox_task_admissions` records deterministic, owner-bound sandbox task
 * admission intents derived from Agency decisions grounded in current, live,
 * owner-bound open cognitive items. Zero-authority ledger: rows are durable
 * bookkeeping of observe-phase derivation; nothing is admitted, scheduled,
 * or executed from a row alone.
 */
export const MIGRATION_27_SANDBOX_TASK_ADMISSIONS_DDL = `
CREATE TABLE IF NOT EXISTS sandbox_task_admissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id         TEXT NOT NULL,
  intent_id        TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('recorded', 'refused')),
  derived_from     TEXT NOT NULL CHECK (derived_from IN ('reactive', 'proactive')),
  decision_id      INTEGER NOT NULL,
  purposes_json    TEXT NOT NULL,
  profile_key      TEXT NOT NULL,
  profile_recipe_ids_json TEXT NOT NULL,
  evidence_refs_json      TEXT NOT NULL,
  refusal_code     TEXT,
  refusal_reason   TEXT,
  build_identity   TEXT NOT NULL,
  model_epoch      INTEGER NOT NULL DEFAULT 0,
  recorded_at      TEXT NOT NULL,
  UNIQUE (owner_id, intent_id)
);
CREATE INDEX IF NOT EXISTS idx_sandbox_task_admissions_owner_status
  ON sandbox_task_admissions (owner_id, status, recorded_at);
CREATE INDEX IF NOT EXISTS idx_sandbox_task_admissions_decision
  ON sandbox_task_admissions (decision_id);
`;
