import type { DatabaseSync } from "node:sqlite";
import { c4CapabilityState, c4ContractVersion, assertC4ContractCompatible } from "./contract-state.js";
import { listEligibleThoughtCalibration, listThoughtCalibrationAdjustments } from "./calibration.js";

export type CognitiveGraduationDiagnostics = {
  contractVersion: number | null;
  capabilityState: "observe" | "dark_apply" | "apply";
  counts: {
    predictionsRecorded: number;
    predictionsSelected: number;
    observationsRecorded: number;
    observationsReceiptBacked: number;
    observationsMissing: number;
    observationsOutcomeUnknown: number;
    adjudicationsRecorded: number;
    adjudicationsConfirmed: number;
    adjudicationsContradicted: number;
    adjudicationsPartialSupport: number;
    adjudicationsUnresolved: number;
    experienceLinksActive: number;
    experienceLinksInvalidated: number;
    calibrationsRecorded: number;
    calibrationsEligibleForFutureThought: number;
  };
  influence: {
    authorized: false;
    executed: false;
    delivered: false;
    observed: boolean;
  };
  unknownCompleteness: boolean;
};

function count(db: DatabaseSync, sql: string, ...params: (string | number)[]): number {
  const row = db.prepare(sql).get(...params) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

export function getCognitiveGraduationDiagnostics(
  db: DatabaseSync,
  ownerId: string,
): CognitiveGraduationDiagnostics {
  assertC4ContractCompatible(db);
  const recorded = count(db, `SELECT COUNT(*) AS count FROM cognitive_predictions WHERE owner_id = ?`, ownerId);
  const selected = count(db, `SELECT COUNT(*) AS count FROM cognitive_predictions WHERE owner_id = ? AND selected = 1`, ownerId);
  const receiptBacked = count(db, `SELECT COUNT(*) AS count FROM cognitive_outcome_observations o JOIN cognitive_predictions p ON p.id = o.prediction_id WHERE p.owner_id = ? AND o.observation_kind = 'receipt_backed'`, ownerId);
  const missing = count(db, `SELECT COUNT(*) AS count FROM cognitive_outcome_observations o JOIN cognitive_predictions p ON p.id = o.prediction_id WHERE p.owner_id = ? AND o.observation_kind = 'missing'`, ownerId);
  const unknown = count(db, `SELECT COUNT(*) AS count FROM cognitive_outcome_observations o JOIN cognitive_predictions p ON p.id = o.prediction_id WHERE p.owner_id = ? AND o.observation_kind = 'outcome_unknown'`, ownerId);
  const adjudication = (disposition: string) => count(db, `SELECT COUNT(*) AS count FROM cognitive_outcome_adjudications a JOIN cognitive_predictions p ON p.id = a.prediction_id WHERE p.owner_id = ? AND a.disposition = ?`, ownerId, disposition);
  const activeExperience = count(db, `SELECT COUNT(*) AS count FROM lived_experience_links WHERE owner_id = ? AND validity_state = 'active'`, ownerId);
  const invalidExperience = count(db, `SELECT COUNT(*) AS count FROM lived_experience_links WHERE owner_id = ? AND validity_state = 'invalidated'`, ownerId);
  const calibrations = listThoughtCalibrationAdjustments(db, ownerId);
  const eligible = listEligibleThoughtCalibration(db, ownerId, { mode: "dark_apply" });
  return {
    contractVersion: c4ContractVersion(db),
    capabilityState: c4CapabilityState(db),
    counts: {
      predictionsRecorded: recorded,
      predictionsSelected: selected,
      observationsRecorded: receiptBacked + missing + unknown,
      observationsReceiptBacked: receiptBacked,
      observationsMissing: missing,
      observationsOutcomeUnknown: unknown,
      adjudicationsRecorded: adjudication("confirmed") + adjudication("contradicted") + adjudication("partial_support") + adjudication("unresolved"),
      adjudicationsConfirmed: adjudication("confirmed"),
      adjudicationsContradicted: adjudication("contradicted"),
      adjudicationsPartialSupport: adjudication("partial_support"),
      adjudicationsUnresolved: adjudication("unresolved"),
      experienceLinksActive: activeExperience,
      experienceLinksInvalidated: invalidExperience,
      calibrationsRecorded: calibrations.length,
      calibrationsEligibleForFutureThought: eligible.length,
    },
    influence: {
      authorized: false,
      executed: false,
      delivered: false,
      observed: receiptBacked + missing + unknown > 0,
    },
    unknownCompleteness: unknown > 0 || missing > 0,
  };
}
