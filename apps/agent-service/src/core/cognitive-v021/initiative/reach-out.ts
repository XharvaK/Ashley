import type { DatabaseSync } from "node:sqlite";

/**
 * Growth V1 §5.5: reaching out.
 *
 * Ashley decides when a message to the Owner is worth sending. The Host keeps
 * only a runaway fuse (at most 12 unsolicited messages in 24 hours) and hands
 * her the evidence of how her recent messages landed, so her own judgement
 * sets the pace.
 */

export const UNSOLICITED_FUSE_LIMIT = 12;
export const UNSOLICITED_WINDOW_MS = 24 * 60 * 60_000;
export const REACH_OUT_RECENT_LIMIT = 5;
const EXCERPT_MAX_CHARS = 160;

/** Cycles nobody asked for: her own time, her own follow-ups, her subscriptions. */
export const UNSOLICITED_TRIGGER_KINDS = Object.freeze(["idle_opportunity", "future_trigger_due", "subscription_item", "self_change_result", "domus_notification"]);

export function isUnsolicitedTriggerKind(value: string): boolean {
  return (UNSOLICITED_TRIGGER_KINDS as readonly string[]).includes(value);
}

type Row = Record<string, unknown>;

const UNSOLICITED_ROWS = `
  SELECT e.conversation_id, e.text, e.created_at_ms
    FROM conversation_evidence_log e
    JOIN cycle_records c ON c.cycle_id = e.producing_cycle_id
   WHERE e.role = 'ashley'
     AND e.text IS NOT NULL AND e.text != ''
     AND c.trigger_kind IN ('idle_opportunity', 'future_trigger_due', 'subscription_item', 'self_change_result', 'domus_notification')`;

export function countUnsolicited(db: DatabaseSync, nowMs: number): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM (${UNSOLICITED_ROWS} AND e.created_at_ms > ?)`)
    .get(nowMs - UNSOLICITED_WINDOW_MS) as Row | undefined;
  return Number(row?.n ?? 0);
}

export function unsolicitedFuseTripped(db: DatabaseSync, nowMs: number): boolean {
  return countUnsolicited(db, nowMs) >= UNSOLICITED_FUSE_LIMIT;
}

/** How her recent unsolicited messages landed: did the Owner answer, and after how long. */
export function recentUnsolicited(
  db: DatabaseSync,
  limit = REACH_OUT_RECENT_LIMIT,
): Array<{ atMs: number; excerpt: string; ownerRepliedAfterMs: number | null }> {
  return (db.prepare(`${UNSOLICITED_ROWS} ORDER BY e.created_at_ms DESC LIMIT ?`).all(Math.max(1, limit)) as Row[])
    .map((row) => {
      const atMs = Number(row.created_at_ms);
      const reply = db.prepare(
        `SELECT MIN(created_at_ms) AS at_ms FROM conversation_evidence_log
          WHERE conversation_id = ? AND role = 'owner' AND created_at_ms > ?`,
      ).get(String(row.conversation_id), atMs) as Row | undefined;
      const text = String(row.text);
      return {
        atMs,
        excerpt: text.length <= EXCERPT_MAX_CHARS ? text : `${text.slice(0, EXCERPT_MAX_CHARS - 1)}…`,
        ownerRepliedAfterMs: reply?.at_ms == null ? null : Number(reply.at_ms) - atMs,
      };
    });
}
