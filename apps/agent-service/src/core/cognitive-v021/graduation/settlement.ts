// Thought's authored check is recorded as a claim receipt, then as her explicit adjudication.
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
import type { ExpectationCheck } from "../growth/expectations.js";
import { recordObservation } from "./observations.js";
import { latestAdjudication, recordAdjudication, type Disposition } from "./adjudications.js";

const DISPOSITION: Record<ExpectationCheck["outcome"], Disposition> = {
  met: "confirmed", missed: "contradicted", mixed: "partial_support", unknowable: "unresolved",
};
export function recordThoughtCheck(db: DatabaseSync, input: { cycleId: string; check: ExpectationCheck; nowMs: number; dataClassification?: DataClassification }): boolean {
  db.exec("SAVEPOINT graduation_thought_check");
  try {
    const observation = recordObservation(db, {
      expectationId: input.check.expectationId, observableKind: "thought_check",
      observationKind: "receipt_backed", observedValueTyped: { thoughtOutcome: input.check.outcome },
      operationalReceiptType: "thought_settlement", operationalReceiptId: input.cycleId,
      nowMs: input.nowMs, dataClassification: input.dataClassification,
    });
    const latest = latestAdjudication(db, input.check.expectationId);
    recordAdjudication(db, {
      expectationId: input.check.expectationId, observationId: observation.observationId,
      disposition: DISPOSITION[input.check.outcome], proposalOrigin: "model", hostValidationOk: true,
      adjudicationAuthority: "ashley_thought_reflection", adjudicatingCycleId: input.cycleId,
      ...(latest ? { supersedesAdjudicationId: latest.adjudicationId, correctionClass: "TEMPORAL_SUPERSESSION" } : {}),
      nowMs: input.nowMs, dataClassification: input.dataClassification,
    });
    db.exec("RELEASE graduation_thought_check");
    return true;
  } catch {
    db.exec("ROLLBACK TO graduation_thought_check");
    db.exec("RELEASE graduation_thought_check");
    return false;
  }
}
