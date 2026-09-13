/**
 * Nuclear schema v21 — Wave 2 provenance / time-shift isolation.
 *
 * Adds a `provenance` column to the five delayed-influence evidence tables
 * (`cur_takes`, `cur_reads`, `episodes`, `learning_revisions`,
 * `cur_source_candidates`). The label is fixed at write time: `live` means
 * the artifact was written while the governing capability held behavioral
 * influence authority; `shadow` means it was recorded in observe. All
 * pre-existing rows backfill to `shadow`, so observe-era evidence can never
 * time-shift into influence after a later master/capability activation.
 *
 * Backfill semantics: for rows created before schema v21, `provenance =
 * 'shadow'` is a conservative authority classification — it is NOT proof
 * that the row was historically generated while the capability was in
 * observe mode. Future audits must not read the backfilled value as
 * historical provenance.
 */

export const MIGRATION_21_PROVENANCE_DDL = `
ALTER TABLE cur_takes ADD COLUMN provenance TEXT NOT NULL DEFAULT 'shadow'
  CHECK (provenance IN ('shadow', 'live'));
ALTER TABLE cur_reads ADD COLUMN provenance TEXT NOT NULL DEFAULT 'shadow'
  CHECK (provenance IN ('shadow', 'live'));
ALTER TABLE episodes ADD COLUMN provenance TEXT NOT NULL DEFAULT 'shadow'
  CHECK (provenance IN ('shadow', 'live'));
ALTER TABLE learning_revisions ADD COLUMN provenance TEXT NOT NULL DEFAULT 'shadow'
  CHECK (provenance IN ('shadow', 'live'));
ALTER TABLE cur_source_candidates ADD COLUMN provenance TEXT NOT NULL DEFAULT 'shadow'
  CHECK (provenance IN ('shadow', 'live'));
CREATE INDEX idx_cur_takes_provenance
  ON cur_takes (provenance, evidence_kind, created_at DESC);
CREATE INDEX idx_cur_reads_provenance
  ON cur_reads (provenance, retrieved_at DESC, id DESC);
CREATE INDEX idx_episodes_provenance
  ON episodes (owner_id, provenance, status, id DESC);
CREATE INDEX idx_learning_revisions_provenance
  ON learning_revisions (owner_id, provenance, status, id DESC);
CREATE INDEX idx_cur_source_candidates_provenance
  ON cur_source_candidates (provenance, status, successful_fetches, updated_at);
`;
