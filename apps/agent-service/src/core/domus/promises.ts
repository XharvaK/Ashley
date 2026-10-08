// DASK: a promise she makes the Owner about her life in the house, in her own words. Her Owner turn keeps
// it once; her game passes see it as domus.promises (the open ones, oldest first) until she keeps it or lets
// it go. The Host never writes its text. An open promise older than a day expires when it is next read, and
// at most five are open at once. Her game passes never see the Owner's own words here; this is hers.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** An open promise older than this expires when it is next read. */
export const DOMUS_PROMISE_TTL_MS = 24 * 60 * 60_000;
/** At most this many promises are open at once; a further one is refused and nothing is recorded. */
export const DOMUS_PROMISE_OPEN_MAX = 5;
export const DOMUS_PROMISE_TEXT_MAX = 120;
/** Her settlements of promises in one pass: at most this many. */
export const DOMUS_PROMISE_SETTLE_MAX = 3;
export const DOMUS_PROMISE_OUTCOMES = ["kept", "let_go"] as const;

export type DomusPromiseClaim = { text: string };
export type DomusPromiseOutcome = (typeof DOMUS_PROMISE_OUTCOMES)[number];
export type DomusPromiseSettlement = { id: string; outcome: DomusPromiseOutcome };
export type DomusPromiseFact = { id: string; text: string; since: string };

type Row = Record<string, unknown>;

/** Characters as a person counts them (an emoji is one). */
function charCount(text: string): number {
  return Array.from(text).length;
}

/** A settlement's promise: one text, 1 to 120 characters once trimmed; anything else is not a promise. */
export function isDomusPromiseClaim(value: unknown): value is DomusPromiseClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "text")) return false;
  if (typeof record.text !== "string") return false;
  const length = charCount(record.text.trim());
  return length >= 1 && length <= DOMUS_PROMISE_TEXT_MAX;
}

/** Her settlements of promises: 1 to 3 items, each an id and kept or let_go; anything else is not a settlement. */
export function isDomusPromiseSettlements(value: unknown): value is DomusPromiseSettlement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DOMUS_PROMISE_SETTLE_MAX) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== "id" && key !== "outcome")) return false;
    return typeof record.id === "string" && record.id.length >= 1 && record.id.length <= 64
      && (record.outcome === "kept" || record.outcome === "let_go");
  });
}

/** Open promises past their day expire here, whichever pass reads them first. */
function expireDomusPromises(db: DatabaseSync, nowMs: number): void {
  db.prepare(`UPDATE domus_promises SET status = 'expired', settled_at_ms = ?
    WHERE status = 'open' AND created_at_ms < ?`).run(nowMs, nowMs - DOMUS_PROMISE_TTL_MS);
}

/**
 * Her promise, kept once per settled pass. Null when that pass already kept one, or when the open ones are
 * at the limit (the refusal is logged and nothing is recorded).
 */
export function recordDomusPromise(db: DatabaseSync, input: {
  claim: DomusPromiseClaim; cycleId: string; nowMs: number;
}): string | null {
  if (db.prepare("SELECT promise_id FROM domus_promises WHERE cycle_id = ?").get(input.cycleId)) return null;
  expireDomusPromises(db, input.nowMs);
  const open = Number((db.prepare("SELECT COUNT(*) AS n FROM domus_promises WHERE status = 'open'").get() as Row).n);
  if (open >= DOMUS_PROMISE_OPEN_MAX) {
    console.log("[domus] promise refused reason=too_many_open");
    return null;
  }
  const promiseId = randomUUID();
  db.prepare(`INSERT INTO domus_promises (promise_id, cycle_id, text, status, created_at_ms)
    VALUES (?, ?, ?, 'open', ?)`).run(promiseId, input.cycleId, input.claim.text.trim(), input.nowMs);
  return promiseId;
}

/**
 * Her settlement of promises she was shown: an open one becomes kept or let_go. An unknown id, or one that
 * is no longer open (settled or expired), is ignored. Returns how many changed.
 */
export function settleDomusPromises(db: DatabaseSync, input: { settlements: DomusPromiseSettlement[]; nowMs: number }): number {
  expireDomusPromises(db, input.nowMs);
  const mark = db.prepare(`UPDATE domus_promises SET status = ?, settled_at_ms = ? WHERE promise_id = ? AND status = 'open'`);
  let changed = 0;
  for (const item of input.settlements) {
    if (Number(mark.run(item.outcome, input.nowMs, item.id).changes) === 1) changed += 1;
  }
  return changed;
}

/** What she has promised and not yet settled, oldest first, with the time she made each (her words, nothing added). */
export function domusPromisesOpen(db: DatabaseSync, nowMs: number): DomusPromiseFact[] {
  expireDomusPromises(db, nowMs);
  const rows = db.prepare(`SELECT promise_id, text, created_at_ms FROM domus_promises WHERE status = 'open'
    ORDER BY created_at_ms, promise_id`).all() as Row[];
  return rows.map(row => ({
    id: String(row.promise_id),
    text: String(row.text),
    since: new Date(Number(row.created_at_ms)).toISOString(),
  }));
}
