// The Host counts outcome evidence and proposes bounded calibration; a later Thought pass decides.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { maxClassification, type DataClassification } from "../../privacy/classification.js";
import { assertCompatible, boundedText } from "./internal.js";

export const CALIBRATION_MIN_ADJUDICATIONS = 4;
export const CALIBRATION_WINDOW_DAYS = 30;
export const CALIBRATION_INCREASE_AT = 0.5;
export const CALIBRATION_DECREASE_AT = 0.15;
export type CalibrationPosition = { calibrationId: string; position: "admit" | "decline"; rationale: string };
export type CalibrationLine = { class: string; adjustment: string; sinceMs: number };
export type CalibrationProposal = { calibrationId: string; class: string; adjustment: string };
type Row = Record<string, unknown>;
const WINDOW_MS = CALIBRATION_WINDOW_DAYS * 86_400_000;

export function mode(db: DatabaseSync): "observe" | "dark_apply" | "apply" {
  assertCompatible(db);
  const value = db.prepare("SELECT mode FROM graduation_contract_state WHERE id=1").get()?.mode;
  return value === "apply" || value === "dark_apply" ? value : "observe";
}
/** The newest adjudication by time, then insertion order, is the counting authority. */
export function classEvidence(db: DatabaseSync, nowMs: number): Map<string, Row[]> {
  assertCompatible(db);
  const rows = db.prepare(`WITH latest AS (
    SELECT a.*, row_number() OVER (PARTITION BY a.expectation_id ORDER BY a.created_at_ms DESC,a.rowid DESC) AS rank
    FROM graduation_adjudications a WHERE a.created_at_ms<=?
  ) SELECT a.*,e.judgment_class,e.data_classification AS prediction_classification
    FROM latest a JOIN expectations e ON e.expectation_id=a.expectation_id
    WHERE a.rank=1 AND a.created_at_ms>=? AND e.forgotten_at_ms IS NULL
      AND e.judgment_class IS NOT NULL AND e.data_classification!='secret' AND a.data_classification!='secret'
      AND a.disposition IN ('confirmed','contradicted') ORDER BY a.adjudication_id`).all(nowMs, nowMs - WINDOW_MS);
  const classes = new Map<string, Row[]>();
  for (const row of rows) {
    const cls = String(row.judgment_class);
    const group = classes.get(cls) ?? [];
    group.push(row); classes.set(cls, group);
  }
  return classes;
}
export function proposeCalibration(db: DatabaseSync, input: { cycleId: string; nowMs: number; dataClassification: DataClassification }): string[] {
  assertCompatible(db);
  if (input.dataClassification === "secret") return [];
  const ids: string[] = [];
  for (const [cls, evidence] of classEvidence(db, input.nowMs)) {
    if (evidence.length < CALIBRATION_MIN_ADJUDICATIONS) continue;
    const ratio = evidence.filter(row => row.disposition === "contradicted").length / evidence.length;
    const adjustment = ratio >= CALIBRATION_INCREASE_AT ? "increase_caution" : ratio <= CALIBRATION_DECREASE_AT ? "decrease_caution" : null;
    if (!adjustment) continue;
    const basis = JSON.stringify(evidence.map(row => String(row.adjudication_id)).sort());
    if (db.prepare("SELECT 1 FROM graduation_calibration WHERE judgment_class=? AND (lifecycle_state='proposed' OR (basis_json=? AND lifecycle_state!='rolled_back'))").get(cls, basis)) continue;
    const classification = maxClassification(input.dataClassification, ...evidence.flatMap(row => [row.data_classification as DataClassification, row.prediction_classification as DataClassification]));
    const id = randomUUID();
    db.prepare(`INSERT INTO graduation_calibration (calibration_id,judgment_class,adjustment,lifecycle_state,proposed_cycle_id,data_classification,created_at_ms,expires_at_ms,basis_json)
      VALUES (?,?,?,'proposed',?,?,?,NULL,?)`).run(id, cls, adjustment, input.cycleId, classification, input.nowMs, basis);
    ids.push(id);
  }
  return ids;
}
function basisCurrent(db: DatabaseSync, row: Row): boolean {
  let ids: unknown;
  try { ids = JSON.parse(String(row.basis_json)); } catch { return false; }
  if (!Array.isArray(ids) || ids.length < CALIBRATION_MIN_ADJUDICATIONS || ids.some(id => typeof id !== "string")) return false;
  return ids.every(id => db.prepare(`SELECT 1 FROM graduation_adjudications a JOIN expectations e ON e.expectation_id=a.expectation_id
    WHERE a.adjudication_id=? AND e.forgotten_at_ms IS NULL AND e.data_classification!='secret' AND a.data_classification!='secret'
      AND NOT EXISTS (SELECT 1 FROM graduation_adjudications newer WHERE newer.expectation_id=a.expectation_id AND (newer.created_at_ms>a.created_at_ms OR (newer.created_at_ms=a.created_at_ms AND newer.rowid>a.rowid)))`).get(id));
}
function expireIntervals(db: DatabaseSync, nowMs: number): void {
  db.prepare("UPDATE graduation_calibration SET lifecycle_state='expired' WHERE expires_at_ms IS NOT NULL AND expires_at_ms<=? AND lifecycle_state IN ('proposed','admitted','eligible_for_future_thought')").run(nowMs);
}
export function recordCalibrationPositions(db: DatabaseSync, input: { cycleId: string; positions: readonly CalibrationPosition[]; nowMs: number; dataClassification: DataClassification }): Array<{ calibrationId: string; code: string }> {
  assertCompatible(db);
  const results: Array<{ calibrationId: string; code: string }> = [];
  const currentMode = mode(db);
  for (const position of input.positions.slice(0, 3)) {
    const reject = (code: string) => { results.push({ calibrationId: position.calibrationId, code }); };
    if (currentMode !== "apply") { reject("graduation_observe"); continue; }
    if (input.dataClassification === "secret") { reject("graduation_secret_evidence"); continue; }
    const row = db.prepare("SELECT * FROM graduation_calibration WHERE calibration_id=? AND lifecycle_state='proposed'").get(position.calibrationId);
    if (!row) { reject("graduation_proposal_missing"); continue; }
    const cycle = db.prepare("SELECT admitted_at_ms FROM cycle_records WHERE cycle_id=?").get(input.cycleId);
    if (!cycle || row.proposed_cycle_id === input.cycleId || Number(cycle.admitted_at_ms) <= Number(row.created_at_ms)) { reject("graduation_later_pass_required"); continue; }
    if (row.expires_at_ms != null && Number(row.expires_at_ms) <= input.nowMs) { reject("graduation_proposal_expired"); continue; }
    if (!basisCurrent(db, row)) { reject("graduation_basis_superseded"); continue; }
    let rationale: string;
    try { rationale = boundedText(position.rationale, "rationale", 200); } catch { reject("graduation_rationale_refused"); continue; }
    if (position.position !== "admit" && position.position !== "decline") { reject("graduation_position_invalid"); continue; }
    const classification = maxClassification(row.data_classification as DataClassification, input.dataClassification);
    if (position.position === "admit") {
      db.prepare("UPDATE graduation_calibration SET lifecycle_state='demoted' WHERE judgment_class=? AND lifecycle_state='eligible_for_future_thought'").run(String(row.judgment_class));
      db.prepare("UPDATE graduation_calibration SET lifecycle_state='admitted',admitting_cycle_id=?,position='admit',rationale=?,data_classification=?,since_ms=? WHERE calibration_id=?").run(input.cycleId, rationale, classification, input.nowMs, position.calibrationId);
      db.prepare("UPDATE graduation_calibration SET lifecycle_state='eligible_for_future_thought' WHERE calibration_id=?").run(position.calibrationId);
    } else {
      db.prepare("UPDATE graduation_calibration SET lifecycle_state='demoted',admitting_cycle_id=?,position='decline',rationale=?,data_classification=? WHERE calibration_id=?").run(input.cycleId, rationale, classification, position.calibrationId);
    }
    reject(position.position === "admit" ? "graduation_admitted" : "graduation_declined");
  }
  return results;
}
export function eligibleCalibration(db: DatabaseSync, nowMs: number): CalibrationLine[] {
  assertCompatible(db);
  return db.prepare("SELECT * FROM graduation_calibration WHERE lifecycle_state='eligible_for_future_thought' AND data_classification!='secret' AND since_ms<=? AND (expires_at_ms IS NULL OR expires_at_ms>?) ORDER BY since_ms DESC,rowid DESC").all(nowMs, nowMs)
    .filter(row => basisCurrent(db, row)).slice(0, 5).map(row => ({ class: String(row.judgment_class), adjustment: String(row.adjustment), sinceMs: Number(row.since_ms) }));
}
export function openCalibrationProposals(db: DatabaseSync, nowMs: number): CalibrationProposal[] {
  assertCompatible(db);
  return db.prepare("SELECT * FROM graduation_calibration WHERE lifecycle_state='proposed' AND data_classification!='secret' AND created_at_ms<=? AND (expires_at_ms IS NULL OR expires_at_ms>?) ORDER BY created_at_ms,rowid").all(nowMs, nowMs)
    .filter(row => basisCurrent(db, row))
    .map(row => ({ calibrationId: String(row.calibration_id), class: String(row.judgment_class), adjustment: String(row.adjustment) }));
}
export function graduationForThought(db: DatabaseSync, nowMs: number): { calibrationProposals?: CalibrationProposal[]; calibration?: CalibrationLine[] } {
  const currentMode = mode(db);
  expireIntervals(db, nowMs);
  if (currentMode === "observe") return {};
  const proposals = openCalibrationProposals(db, nowMs);
  const lines = eligibleCalibration(db, nowMs);
  if (currentMode === "dark_apply") {
    db.prepare("UPDATE graduation_contract_state SET dark_would_show=dark_would_show+? WHERE id=1").run(proposals.length + lines.length);
    return {};
  }
  return { ...(proposals.length ? { calibrationProposals: proposals } : {}), ...(lines.length ? { calibration: lines } : {}) };
}
/** Rollback preserves history and disables all currently eligible future influence. */
export function rollbackCognitiveGraduation(db: DatabaseSync): number {
  assertCompatible(db);
  return Number(db.prepare("UPDATE graduation_calibration SET lifecycle_state='rolled_back' WHERE lifecycle_state='eligible_for_future_thought'").run().changes);
}
