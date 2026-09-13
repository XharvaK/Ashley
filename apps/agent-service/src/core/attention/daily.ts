import type { DatabaseSync } from "node:sqlite";
import type { AttentionClock } from "./types.js";
import { realClock } from "./types.js";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

/**
 * Idempotent fold of terminal attention rows into attention_daily_usage.
 * Same rows folded twice produce identical totals, not increments.
 */
export function foldAttentionDailyUsage(
  db: DatabaseSync,
  clock: AttentionClock = realClock,
): number {
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db
      .prepare(
        `SELECT * FROM attention_requests
         WHERE state = 'terminal' AND folded_at IS NULL AND ended_at IS NOT NULL`,
      )
      .all() as Row[];

    if (rows.length === 0) {
      db.exec("COMMIT");
      return 0;
    }

    type AggKey = string;
    const aggs = new Map<
      AggKey,
      {
        day: string;
        bucket: string;
        alias: string;
        resolved: string;
        epoch: number;
        completed: number;
        cancelled: number;
        timeout: number;
        rateLimited: number;
        error: number;
        aborted: number;
        interactive: number;
        urgent: number;
        cognition: number;
        curiosity: number;
        actualIn: number;
        actualOut: number;
        unknown: number;
      }
    >();

    for (const row of rows) {
      const ended = String(row.ended_at);
      const day = ended.slice(0, 10);
      const bucket = String(row.quota_bucket);
      const alias = String(row.model_alias);
      const resolved =
        row.resolved_model_id == null ? "" : String(row.resolved_model_id);
      const epoch = Number(row.model_epoch ?? 0);
      const key = `${day}|${bucket}`;
      let agg = aggs.get(key);
      if (!agg) {
        agg = {
          day,
          bucket,
          alias,
          resolved,
          epoch,
          completed: 0,
          cancelled: 0,
          timeout: 0,
          rateLimited: 0,
          error: 0,
          aborted: 0,
          interactive: 0,
          urgent: 0,
          cognition: 0,
          curiosity: 0,
          actualIn: 0,
          actualOut: 0,
          unknown: 0,
        };
        aggs.set(key, agg);
      }
      switch (row.outcome) {
        case "completed":
          agg.completed += 1;
          break;
        case "cancelled":
          agg.cancelled += 1;
          break;
        case "timeout":
          agg.timeout += 1;
          break;
        case "rate_limited":
          agg.rateLimited += 1;
          break;
        case "error":
          agg.error += 1;
          break;
        case "aborted":
          agg.aborted += 1;
          break;
        default:
          break;
      }
      switch (row.lane) {
        case "interactive":
          agg.interactive += 1;
          break;
        case "urgent_grounded":
          agg.urgent += 1;
          break;
        case "exchange_cognition":
          agg.cognition += 1;
          break;
        case "curiosity_maintenance":
          agg.curiosity += 1;
          break;
        default:
          break;
      }
      if (row.actual_input_tokens != null) {
        agg.actualIn += Number(row.actual_input_tokens);
        agg.actualOut += Number(row.actual_output_tokens ?? 0);
      } else if (row.budget_retain_until != null) {
        agg.unknown +=
          Number(row.reserved_input_tokens ?? 0) +
          Number(row.reserved_output_tokens ?? 0);
      }
    }

    // Replace each day's slice for the keys we're folding: load existing folded
    // totals for those keys from already-folded rows would double-count, so we
    // recompute each key from ALL folded+current batch rows with that key.
    const now = new Date(clock.nowMs()).toISOString();
    for (const agg of aggs.values()) {
      const prior = db
        .prepare(
          `SELECT COALESCE(SUM(CASE outcome WHEN 'completed' THEN 1 ELSE 0 END),0) AS completed,
                  COALESCE(SUM(CASE outcome WHEN 'cancelled' THEN 1 ELSE 0 END),0) AS cancelled,
                  COALESCE(SUM(CASE outcome WHEN 'timeout' THEN 1 ELSE 0 END),0) AS timeout,
                  COALESCE(SUM(CASE outcome WHEN 'rate_limited' THEN 1 ELSE 0 END),0) AS rate_limited,
                  COALESCE(SUM(CASE outcome WHEN 'error' THEN 1 ELSE 0 END),0) AS error,
                  COALESCE(SUM(CASE outcome WHEN 'aborted' THEN 1 ELSE 0 END),0) AS aborted,
                  COALESCE(SUM(CASE lane WHEN 'interactive' THEN 1 ELSE 0 END),0) AS interactive,
                  COALESCE(SUM(CASE lane WHEN 'urgent_grounded' THEN 1 ELSE 0 END),0) AS urgent,
                  COALESCE(SUM(CASE lane WHEN 'exchange_cognition' THEN 1 ELSE 0 END),0) AS cognition,
                  COALESCE(SUM(CASE lane WHEN 'curiosity_maintenance' THEN 1 ELSE 0 END),0) AS curiosity,
                  COALESCE(SUM(COALESCE(actual_input_tokens,0)),0) AS actual_in,
                  COALESCE(SUM(COALESCE(actual_output_tokens,0)),0) AS actual_out,
                  COALESCE(SUM(CASE WHEN actual_input_tokens IS NULL AND budget_retain_until IS NOT NULL
                    THEN reserved_input_tokens + reserved_output_tokens ELSE 0 END),0) AS unknown
           FROM attention_requests
           WHERE state = 'terminal'
             AND substr(ended_at, 1, 10) = ?
             AND quota_bucket = ?
             AND (folded_at IS NOT NULL OR id IN (${rows.map(() => "?").join(",")}))`,
        )
        .get(
          agg.day,
          agg.bucket,
          ...rows.map((r) => Number(r.id)),
        );

      const totals = isRow(prior)
        ? {
            completed: Number(prior.completed),
            cancelled: Number(prior.cancelled),
            timeout: Number(prior.timeout),
            rateLimited: Number(prior.rate_limited),
            error: Number(prior.error),
            aborted: Number(prior.aborted),
            interactive: Number(prior.interactive),
            urgent: Number(prior.urgent),
            cognition: Number(prior.cognition),
            curiosity: Number(prior.curiosity),
            actualIn: Number(prior.actual_in),
            actualOut: Number(prior.actual_out),
            unknown: Number(prior.unknown),
          }
        : agg;

      db.prepare(
        `INSERT INTO attention_daily_usage (
           day_utc, quota_bucket, model_alias, resolved_model_id, model_epoch,
           requests_completed, requests_cancelled, requests_timeout,
           requests_rate_limited, requests_error, requests_aborted,
           lane_interactive, lane_urgent_grounded, lane_exchange_cognition,
           lane_curiosity_maintenance, actual_input_tokens, actual_output_tokens,
           unknown_reserved_tokens, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day_utc, quota_bucket) DO UPDATE SET
           requests_completed = excluded.requests_completed,
           requests_cancelled = excluded.requests_cancelled,
           requests_timeout = excluded.requests_timeout,
           requests_rate_limited = excluded.requests_rate_limited,
           requests_error = excluded.requests_error,
           requests_aborted = excluded.requests_aborted,
           lane_interactive = excluded.lane_interactive,
           lane_urgent_grounded = excluded.lane_urgent_grounded,
           lane_exchange_cognition = excluded.lane_exchange_cognition,
           lane_curiosity_maintenance = excluded.lane_curiosity_maintenance,
           actual_input_tokens = excluded.actual_input_tokens,
           actual_output_tokens = excluded.actual_output_tokens,
           unknown_reserved_tokens = excluded.unknown_reserved_tokens,
           updated_at = excluded.updated_at`,
      ).run(
        agg.day,
        agg.bucket,
        agg.alias,
        agg.resolved,
        agg.epoch,
        totals.completed,
        totals.cancelled,
        totals.timeout,
        totals.rateLimited,
        totals.error,
        totals.aborted,
        totals.interactive,
        totals.urgent,
        totals.cognition,
        totals.curiosity,
        totals.actualIn,
        totals.actualOut,
        totals.unknown,
        now,
      );
    }

    const mark = db.prepare(
      `UPDATE attention_requests SET folded_at = ? WHERE id = ? AND folded_at IS NULL`,
    );
    for (const row of rows) {
      mark.run(now, Number(row.id));
    }
    db.exec("COMMIT");
    return rows.length;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function monthlyUsageSummary(
  db: DatabaseSync,
  days = 30,
  clock: AttentionClock = realClock,
): {
  actualInputTokens: number;
  actualOutputTokens: number;
  unknownReservedTokens: number;
  requests: number;
} {
  const cutoff = new Date(clock.nowMs() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const folded = db
    .prepare(
      `SELECT COALESCE(SUM(actual_input_tokens),0) AS ain,
              COALESCE(SUM(actual_output_tokens),0) AS aout,
              COALESCE(SUM(unknown_reserved_tokens),0) AS unk,
              COALESCE(SUM(requests_completed + requests_cancelled + requests_timeout
                + requests_rate_limited + requests_error + requests_aborted),0) AS req
       FROM attention_daily_usage WHERE day_utc >= ?`,
    )
    .get(cutoff);
  const raw = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(actual_input_tokens,0)),0) AS ain,
              COALESCE(SUM(COALESCE(actual_output_tokens,0)),0) AS aout,
              COALESCE(SUM(CASE WHEN actual_input_tokens IS NULL AND budget_retain_until IS NOT NULL
                THEN reserved_input_tokens + reserved_output_tokens ELSE 0 END),0) AS unk,
              COUNT(*) AS req
       FROM attention_requests
       WHERE state = 'terminal' AND folded_at IS NULL
         AND ended_at IS NOT NULL AND substr(ended_at, 1, 10) >= ?`,
    )
    .get(cutoff);
  return {
    actualInputTokens:
      (isRow(folded) ? Number(folded.ain) : 0) +
      (isRow(raw) ? Number(raw.ain) : 0),
    actualOutputTokens:
      (isRow(folded) ? Number(folded.aout) : 0) +
      (isRow(raw) ? Number(raw.aout) : 0),
    unknownReservedTokens:
      (isRow(folded) ? Number(folded.unk) : 0) +
      (isRow(raw) ? Number(raw.unk) : 0),
    requests:
      (isRow(folded) ? Number(folded.req) : 0) +
      (isRow(raw) ? Number(raw.req) : 0),
  };
}
