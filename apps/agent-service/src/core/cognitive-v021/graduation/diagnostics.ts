// Owner inspection reports sidecar evidence. It grants no influence or execution authority.
import type { DatabaseSync } from "node:sqlite";
import { assertCompatible } from "./internal.js";
import { classEvidence, eligibleCalibration, mode, openCalibrationProposals } from "./calibration.js";

export function getCognitiveGraduationDiagnostics(db: DatabaseSync, nowMs = Date.now()) {
  assertCompatible(db);
  const state = db.prepare("SELECT actor,at_ms,dark_would_show,record_failures FROM graduation_contract_state WHERE id=1").get()!;
  return {
    mode: mode(db), actor: state.actor, atMs: Number(state.at_ms),
    darkWouldShow: Number(state.dark_would_show), recordFailures: Number(state.record_failures),
    perClass: [...classEvidence(db, nowMs)].map(([cls, rows]) => {
      const contradicted = rows.filter(row => row.disposition === "contradicted").length;
      return { class: cls, confirmed: rows.length - contradicted, contradicted, ratio: contradicted / rows.length };
    }),
    openProposals: openCalibrationProposals(db, nowMs), admittedLines: eligibleCalibration(db, nowMs),
  };
}
export function setGraduationMode(db: DatabaseSync, selectedMode: "observe" | "dark_apply" | "apply", actor: string, nowMs: number): void {
  assertCompatible(db);
  db.prepare("UPDATE graduation_contract_state SET mode=?,actor=?,at_ms=? WHERE id=1").run(selectedMode, actor, nowMs);
}
