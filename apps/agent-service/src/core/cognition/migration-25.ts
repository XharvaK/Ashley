/** Nuclear schema v25 — accepted dispatch provenance and monotonic OCI order. */
export const MIGRATION_25_OPEN_COGNITIVE_ORDERING_DDL = `
ALTER TABLE attention_requests
  ADD COLUMN accepted_contract_id TEXT;
ALTER TABLE attention_requests
  ADD COLUMN accepted_build_identity TEXT;
ALTER TABLE open_cognitive_items
  ADD COLUMN generation_order INTEGER NOT NULL DEFAULT 0 CHECK (generation_order >= 0);
`;
