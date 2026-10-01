import type { DatabaseSync } from "node:sqlite";
import { recordJournalEntry, type JournalClaim, type JournalPassKind } from "../initiative/journal.js";
import type { NightPass } from "../initiative/inner-pass.js";
import { recordInterestTouches, type InterestTouch } from "../memory/interests.js";
import { recordSenseDeclines, type SenseClaim, type SenseName } from "../senses/senses.js";
import { recordGrowth, type IdentityStore } from "../growth/growth.js";
import type { GrowthClaim } from "../growth/claim.js";
import { recordNight, type NightClaim } from "../growth/night.js";

/**
 * R13: a settlement's inner-life aftermath (its journal entry, interest
 * touches, growth and night records) is written once, atomically, keyed by
 * the settlement. Publication records the pending row in its own
 * transaction, so a crash after publishing can never lose these records:
 * recovery replays whatever is still pending from the stored settlement.
 */
export type AftermathContext = {
  conversationId: string;
  /** Set for private passes: the journal entry to record. */
  passKind: JournalPassKind | null;
  nightPass: NightPass | null;
  senseBands?: Partial<Record<SenseName, string>>;
};

export type AftermathOptions = {
  identityStore: IdentityStore | null;
  dataDir?: string;
  timeZone: string;
  nowMs: number;
};

type Row = Record<string, unknown>;

type StoredSettlement = {
  redacted?: unknown;
  interests?: InterestTouch[];
  journal?: JournalClaim;
  growth?: GrowthClaim;
  senses?: SenseClaim;
  night?: NightClaim;
};

function parse<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Called inside the publication transaction. */
export function recordAftermathPending(
  db: DatabaseSync,
  input: { settlementId: string; cycleId: string; context: AftermathContext; nowMs: number },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO settlement_aftermath (settlement_id, cycle_id, context_json, status, created_at_ms)
     VALUES (?, ?, ?, 'pending', ?)`,
  ).run(input.settlementId, input.cycleId, JSON.stringify(input.context), input.nowMs);
}

/** Write one settlement's aftermath if it is still pending. */
export function recordSettlementAftermath(
  db: DatabaseSync,
  settlementId: string,
  options: AftermathOptions,
): "recorded" | "not_pending" {
  db.exec("BEGIN IMMEDIATE");
  try {
    const pending = db.prepare(
      `SELECT a.cycle_id, a.context_json, a.created_at_ms, s.payload_json,
              EXISTS (SELECT 1 FROM speech_outbox o WHERE o.settlement_id = a.settlement_id) AS queued_speech
         FROM settlement_aftermath a JOIN settlements s ON s.settlement_id = a.settlement_id
        WHERE a.settlement_id = ? AND a.status = 'pending'`,
    ).get(settlementId) as Row | undefined;
    const context = parse<AftermathContext>(pending?.context_json);
    if (!pending || !context) {
      db.exec("ROLLBACK");
      return "not_pending";
    }
    const cycleId = String(pending.cycle_id);
    const settlement = parse<StoredSettlement>(pending.payload_json) ?? {};
    // A forget that redacted this settlement first wins: its claims are not
    // recorded. Open revisions are still checked, so a wait that ran out applies.
    const standing = settlement.redacted !== true;
    const interests = standing ? settlement.interests ?? [] : [];
    if (interests.length > 0) recordInterestTouches(db, interests, options.nowMs);
    if (context.passKind) {
      recordJournalEntry(db, {
        conversationId: context.conversationId,
        cycleId,
        passKind: context.passKind,
        ...(standing && settlement.journal ? { claim: settlement.journal } : {}),
        interests,
        spoke: Number(pending.queued_speech) === 1,
        nowMs: options.nowMs,
      });
    }
    if (standing && settlement.senses) recordSenseDeclines(db, settlement.senses, { nowMs: Number(pending.created_at_ms), conversationId: context.conversationId, dataDir: options.dataDir }, context.senseBands);
    recordGrowth(db, {
      cycleId,
      ...(standing && settlement.growth ? { claim: settlement.growth } : {}),
      identityStore: options.identityStore,
      dataClassification: "ordinary",
      nowMs: options.nowMs,
    });
    if (context.nightPass && standing) {
      recordNight(db, {
        cycleId,
        pass: context.nightPass,
        ...(settlement.night ? { claim: settlement.night } : {}),
        timeZone: options.timeZone,
        dataClassification: "ordinary",
        nowMs: options.nowMs,
      });
    }
    db.prepare("UPDATE settlement_aftermath SET status = 'recorded', recorded_at_ms = ? WHERE settlement_id = ?")
      .run(options.nowMs, settlementId);
    db.exec("COMMIT");
    return "recorded";
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}

/** Replay aftermaths a crash or a transient failure left pending, oldest first. */
export function recoverSettlementAftermath(
  db: DatabaseSync,
  options: AftermathOptions & { limit?: number },
): { recorded: number; failed: number } {
  const pending = (db.prepare(
    "SELECT settlement_id FROM settlement_aftermath WHERE status = 'pending' ORDER BY created_at_ms ASC, settlement_id ASC LIMIT ?",
  ).all(Math.max(1, options.limit ?? 10)) as Row[]).map((row) => String(row.settlement_id));
  const result = { recorded: 0, failed: 0 };
  for (const settlementId of pending) {
    try {
      if (recordSettlementAftermath(db, settlementId, options) === "recorded") result.recorded += 1;
    } catch (error) {
      result.failed += 1;
      console.warn("[cognitive-v021] aftermath_recovery_failed", settlementId, error);
    }
  }
  return result;
}
