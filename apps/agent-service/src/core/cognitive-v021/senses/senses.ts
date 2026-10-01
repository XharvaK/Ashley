import type { DataClassification } from "../../privacy/classification.js";
// A sense states the truth at proportionate volume and then stops; a reasoned no quiets it.
import { join } from "node:path";
import { detectCredentialShape } from "../../privacy/secrets.js";
import type { DatabaseSync } from "node:sqlite";
import { readBackupStatus } from "../../../scripts/backup-lib.js";
import { frictionForThought, FRICTION_KINDS } from "../growth/friction.js";
import { listOpenExpectations } from "../growth/expectations.js";
import { listOccupancy } from "../concerns/occupancy.js";
import { getPrivateBudgetProjection, PRIVATE_THOUGHT_POLICY_ID } from "../private-budget/ledger.js";
export const SENSE_NAMES = ["friction", "expectations", "stale_concerns", "delivery_backlog", "private_budget", "backup"] as const;
export type SenseName = typeof SENSE_NAMES[number];
export type SenseClaim = { decline: Array<{ sense: SenseName; rationale: string; untilMs?: number }> };
export type ThoughtSenses = { lines: string[] };
export type SenseOptions = { nowMs: number; conversationId: string; dataDir?: string; dataClassification?: DataClassification };
export type SenseReading = { sense: SenseName; band: string; detail?: string };
const DAY = 86400000;
const DECLINE_MAX_MS = 7 * DAY;
/** Fixed mechanical bands; no interpretation of content or message text. */
export function senseBand(sense: SenseName, amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "unknown";
  switch (sense) {
    case "friction": return amount === 0 ? "none" : amount < 3 ? "low" : amount < 10 ? "moderate" : "high";
    case "expectations": case "stale_concerns": return amount === 0 ? "none" : amount < 3 ? "few" : "many";
    case "delivery_backlog": return amount === 0 ? "clear" : amount < 5 ? "pending" : "backlogged";
    case "private_budget": return amount === 0 ? "empty" : amount < 2 ? "low" : "available";
    case "backup": return amount < DAY ? "fresh" : amount < 3 * DAY ? "aging" : "stale";
  }
}
export function readSenseFacts(db: DatabaseSync, options: SenseOptions): SenseReading[] {
  const friction = frictionForThought(db, options.nowMs).last7d;
  const count = FRICTION_KINDS.reduce((sum, kind) => sum + friction[kind], 0);
  const top = [...FRICTION_KINDS].sort((a,b) => friction[b] - friction[a])[0]!;
  const expectations = listOpenExpectations(db, options.nowMs, Number.MAX_SAFE_INTEGER).length;
  let stale = 0;
  let staleUnknown = false;
  for (const occupied of listOccupancy(db, options.conversationId)) {
    if (occupied.status === "resolved") continue;
    const cycle = db.prepare("SELECT admitted_at_ms FROM cycle_records WHERE cycle_id = ?").get(occupied.updatedCycle);
    if (!cycle) { staleUnknown = true; continue; }
    if (Number(cycle.admitted_at_ms) <= options.nowMs - 7 * DAY) stale++;
  }
  const backlog = Number(db.prepare("SELECT count(*) AS n FROM speech_outbox WHERE origin = 'live' AND suppressed = 0 AND send_status IN ('pending', 'projecting', 'projected', 'sending')").get()!.n);
  const budget = getPrivateBudgetProjection(db, { policyId: PRIVATE_THOUGHT_POLICY_ID, wallClockNowMs: options.nowMs });
  let backupAge: number | null = null;
  if (options.dataDir) {
    const last = readBackupStatus(join(options.dataDir, "backups", "status.json")).last_ok_ms;
    if (typeof last === "number" && Number.isFinite(last) && last >= 0 && last <= options.nowMs) backupAge = options.nowMs - last;
  }
  return [
    { sense: "friction", band: senseBand("friction", count), detail: `7d=${count}; top=${count ? top : "none"}` },
    { sense: "expectations", band: senseBand("expectations", expectations), detail: `open=${expectations}; due=unknown` },
    { sense: "stale_concerns", band: senseBand("stale_concerns", staleUnknown ? null : stale), detail: staleUnknown ? undefined : `count=${stale}` },
    { sense: "delivery_backlog", band: senseBand("delivery_backlog", backlog), detail: `count=${backlog}` },
    { sense: "private_budget", band: senseBand("private_budget", budget.clockState === "clock_reconciliation" ? null : budget.remaining), detail: `left_this_hour=${budget.remaining}` },
    { sense: "backup", band: senseBand("backup", backupAge) },
  ];
}
export function senseBandsForDeclines(readings: readonly SenseReading[]): Partial<Record<SenseName, string>> {
  return Object.fromEntries(readings.map(reading => [reading.sense, reading.band]));
}
/** A projection emits each expired decline once, then stays quiet until a new decline. */
export function sensesForThought(db: DatabaseSync, options: SenseOptions, readings = readSenseFacts(db, options)): ThoughtSenses {
  const lines: string[] = [];
  for (const reading of readings) {
    const decline = db.prepare("SELECT declined_band, until_ms, reraised_at_ms FROM sense_declines WHERE sense = ?").get(reading.sense);
    let suffix = "";
    if (decline) {
      if (decline.reraised_at_ms !== null) continue;
      if (decline.declined_band === reading.band && options.nowMs < Number(decline.until_ms)) continue;
      const changed = db.prepare("UPDATE sense_declines SET reraised_at_ms = ? WHERE sense = ? AND reraised_at_ms IS NULL").run(options.nowMs, reading.sense);
      if (Number(changed.changes) !== 1) continue;
      suffix = "; still declining?";
    }
    lines.push(`${reading.sense}: ${reading.band}${reading.detail ? `; ${reading.detail}` : ""}${suffix}`);
  }
  return { lines: lines.slice(0, 8) };
}
export function recordSenseDeclines(db: DatabaseSync, claim: SenseClaim, options: SenseOptions, bands = senseBandsForDeclines(readSenseFacts(db, options))): void {
  if (!isValidSenseClaim(claim)) return;
  for (const decline of claim.decline) {
    const band = bands[decline.sense];
    if (band === undefined) continue;
    const until = Math.min(options.nowMs + DECLINE_MAX_MS, decline.untilMs ?? Infinity);
    db.prepare(`INSERT INTO sense_declines (sense, rationale, declined_band, declined_at_ms, until_ms, reraised_at_ms, data_classification)
      VALUES (?, ?, ?, ?, ?, NULL, ?) ON CONFLICT(sense) DO UPDATE SET rationale = excluded.rationale, declined_band = excluded.declined_band, declined_at_ms = excluded.declined_at_ms, until_ms = excluded.until_ms, reraised_at_ms = NULL, data_classification = excluded.data_classification`)
      .run(decline.sense, detectCredentialShape(decline.rationale).hit ? "withheld:secret" : decline.rationale, band, options.nowMs, until, options.dataClassification ?? "ordinary");
  }
}
export function isValidSenseClaim(value: unknown): value is SenseClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "decline") || !Array.isArray(record.decline) || record.decline.length === 0 || record.decline.length > 6) return false;
  return record.decline.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const decline = item as Record<string, unknown>;
    return Object.keys(decline).every(key => ["sense", "rationale", "untilMs"].includes(key))
      && SENSE_NAMES.includes(decline.sense as SenseName)
      && typeof decline.rationale === "string" && decline.rationale.trim().length > 0 && decline.rationale.length <= 200
      && (decline.untilMs === undefined || (Number.isSafeInteger(decline.untilMs) && Number(decline.untilMs) >= 0));
  });
}
