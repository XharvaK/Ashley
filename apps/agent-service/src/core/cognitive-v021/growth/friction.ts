// The Host records that friction happened; only Thought says what it means.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
export const FRICTION_KINDS = ["owner_correction", "effect_failed", "outcome_unknown", "expectation_missed", "budget_refused", "delivery_failed", "self_reported"] as const;
export type FrictionKind = typeof FRICTION_KINDS[number];
export type ThoughtFriction = { kind: "owner_correction" | "self_reported"; note: string; refs: string[] };
export function recordFriction(db: DatabaseSync, input: { frictionId?: string; kind: FrictionKind; subjectId?: string | null; cycleId?: string | null; nowMs: number; refs?: readonly string[]; note?: string | null; dataClassification: DataClassification }): void {
  db.prepare(`INSERT OR IGNORE INTO friction_events (friction_id, kind, subject_id, occurred_at_ms, evidence_refs_json, note, cycle_id, data_classification) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.frictionId ?? randomUUID(), input.kind, input.subjectId ?? null, input.nowMs, JSON.stringify(input.refs ?? []), input.dataClassification === "secret" ? null : input.note?.slice(0, 300) ?? null, input.cycleId ?? null, input.dataClassification);
}
/** Codes and identifiers only; no caller-supplied content enters the note or log. */
export function recordHostFriction(db: DatabaseSync, kind: FrictionKind, subjectId: string, nowMs: number, cycleId?: string | null): void {
  try { recordFriction(db, { kind, subjectId, nowMs, cycleId, note: kind, refs: [subjectId], dataClassification: "never_public" }); }
  catch { console.warn("[cognitive-v021] friction_record_failed", kind); }
}
export function frictionForThought(db: DatabaseSync, nowMs: number) {
  const last7d = Object.fromEntries(FRICTION_KINDS.map(kind => [kind, 0])) as Record<FrictionKind, number>;
  for (const row of db.prepare("SELECT kind, count(*) AS n FROM friction_events WHERE occurred_at_ms >= ? AND occurred_at_ms <= ? GROUP BY kind").all(nowMs - 7 * 86400000, nowMs)) last7d[row.kind as FrictionKind] = Number(row.n);
  const recent = db.prepare("SELECT kind, note, occurred_at_ms FROM friction_events WHERE data_classification <> 'secret' AND occurred_at_ms <= ? ORDER BY occurred_at_ms DESC, friction_id DESC LIMIT 5").all(nowMs)
    .map(row => ({ kind: row.kind as FrictionKind, note: row.note as string | null, atMs: Number(row.occurred_at_ms) }));
  return { last7d, recent };
}
