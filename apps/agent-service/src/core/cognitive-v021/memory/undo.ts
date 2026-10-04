/**
 * Domus span undo. The helper decides that a save reload abandoned a stretch.
 * This pass only marks lineage. It does not delete, redact, or change live rows.
 */
import type { DatabaseSync } from "node:sqlite";
import { REDACTED_MEMORY_STATEMENT } from "./redacted.js";

export type DomusUndoSpan = {
  world: string;
  branch: string;
  session: string;
  afterSourceTimeMs: number;
};

export type DomusUndoResult = {
  observations: number;
  supports: number;
  assertions: number;
  episodes: number;
  journal: number;
};

type IdRow = { observation_id: string; receipt_time_ms: number };
type SupportRow = { support_id: string; assertion_key: string };

function changes(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

export function markDomusSpanUndone(db: DatabaseSync, span: DomusUndoSpan, nowMs: number): DomusUndoResult {
  const result: DomusUndoResult = { observations: 0, supports: 0, assertions: 0, episodes: 0, journal: 0 };
  db.exec("BEGIN IMMEDIATE");
  try {
    const observations = db.prepare(
      `SELECT observation_id, receipt_time_ms FROM domus_observations
        WHERE world = ? AND branch = ? AND session = ? AND source_time_ms > ? AND undone_at_ms IS NULL`,
    ).all(span.world, span.branch, span.session, span.afterSourceTimeMs) as IdRow[];
    if (observations.length === 0) {
      db.exec("COMMIT");
      return result;
    }
    const observationIds = observations.map((row) => row.observation_id);
    const obsPlaceholders = observationIds.map(() => "?").join(", ");
    result.observations = changes(db.prepare(
      `UPDATE domus_observations SET undone_at_ms = ? WHERE observation_id IN (${obsPlaceholders}) AND undone_at_ms IS NULL`,
    ).run(nowMs, ...observationIds));

    const supports = db.prepare(
      `SELECT support_id, assertion_key FROM sidecar_memory_supports
        WHERE lineage_class = 'current'
          AND (source_ref IS NOT NULL OR support_ref_json IS NOT NULL)
          AND json_extract(support_ref_json, '$.kind') = 'domus_observation'
          AND json_extract(support_ref_json, '$.observationId') IN (${obsPlaceholders})`,
    ).all(...observationIds) as SupportRow[];
    const assertionKeys = [...new Set(supports.map((row) => row.assertion_key))];
    if (assertionKeys.length > 0) {
      const keyPlaceholders = assertionKeys.map(() => "?").join(", ");
      const liveKeys = (db.prepare(
        `SELECT assertion_key FROM sidecar_memory_assertions
          WHERE assertion_key IN (${keyPlaceholders})
            AND lineage_class = 'current'
            AND statement <> ?`,
      ).all(...assertionKeys, REDACTED_MEMORY_STATEMENT) as Array<{ assertion_key: string }>).map((row) => row.assertion_key);
      if (liveKeys.length > 0) {
        const livePlaceholders = liveKeys.map(() => "?").join(", ");
        result.assertions = changes(db.prepare(
          `UPDATE sidecar_memory_assertions SET lineage_class = 'undone'
            WHERE assertion_key IN (${livePlaceholders}) AND lineage_class = 'current' AND statement <> ?`,
        ).run(...liveKeys, REDACTED_MEMORY_STATEMENT));
        result.supports = changes(db.prepare(
          `UPDATE sidecar_memory_supports SET lineage_class = 'undone'
            WHERE assertion_key IN (${livePlaceholders})
              AND lineage_class = 'current'
              AND (source_ref IS NOT NULL OR support_ref_json IS NOT NULL)`,
        ).run(...liveKeys));
      }
    }

    // 8d will bind episodes and journal rows to cycles. Until then, a row counts
    // when it was created at or after the earliest receipt of this undone span.
    const earliestReceipt = Math.min(...observations.map((row) => Number(row.receipt_time_ms)));
    const channel = `domus:${span.world}`;
    result.episodes = changes(db.prepare(
      `UPDATE episodes_v2 SET lineage_class = 'undone'
        WHERE channel = ? AND lineage_class = 'current' AND forgotten_at_ms IS NULL AND created_at_ms >= ?`,
    ).run(channel, earliestReceipt));
    result.journal = changes(db.prepare(
      `UPDATE activity_journal SET lineage_class = 'undone'
        WHERE channel = ? AND lineage_class = 'current' AND forgotten_at_ms IS NULL AND created_at_ms >= ?`,
    ).run(channel, earliestReceipt));
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* keep the original error */ }
    throw error;
  }
}
