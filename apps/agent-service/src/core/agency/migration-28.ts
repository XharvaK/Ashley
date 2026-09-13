/**
 * Nuclear schema v28 — Bounded Thought validation telemetry.
 *
 * `decision_log.thought_validation_json` holds a bounded forensic envelope
 * (attempt count, provider outcome, output/max tokens, truncation flag, parse
 * and validation outcomes, error code, field/path, parsed operational kind,
 * byte length, sha256 digest) for rejected model-Thought outputs. Raw model
 * text is never persisted; only the digest is retained.
 */
export const MIGRATION_28_THOUGHT_VALIDATION_DDL = `
ALTER TABLE decision_log
  ADD COLUMN thought_validation_json TEXT;
`;
