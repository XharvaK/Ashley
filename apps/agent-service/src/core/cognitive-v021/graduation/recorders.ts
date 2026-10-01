// Only these two automatic recorders compare operational receipts. Neither copies content.
import type { DatabaseSync } from "node:sqlite";
import { recordObservation } from "./observations.js";
import { latestAdjudication, recordAdjudication } from "./adjudications.js";
import type { DataClassification } from "../../privacy/classification.js";

type Prediction = { expectation_id: string; cycle_id: string; conversation_id: string; created_at_ms: number; horizon_hours: number; data_classification: DataClassification };
type Receipt = { id: string; at: number; classification: DataClassification };
function predictions(db: DatabaseSync, kind: string, limit: number, conversationId?: string, cycleId?: string): Prediction[] {
  return db.prepare(`SELECT e.expectation_id,e.cycle_id,c.conversation_id,e.created_at_ms,e.horizon_hours,e.data_classification
    FROM expectations e JOIN cycle_records c ON c.cycle_id=e.cycle_id
    WHERE e.check_kind=? AND e.horizon_hours IS NOT NULL AND e.forgotten_at_ms IS NULL
      AND e.data_classification<>'secret' AND e.graduation_lifecycle<>'abandoned'
      AND (? IS NULL OR c.conversation_id=?) AND (? IS NULL OR e.cycle_id=?)
      AND NOT EXISTS (SELECT 1 FROM graduation_recorder_keys k WHERE k.expectation_id=e.expectation_id AND k.kind=?)
    ORDER BY e.created_at_ms,e.expectation_id LIMIT ?`).all(kind, conversationId ?? null, conversationId ?? null, cycleId ?? null, cycleId ?? null, kind, limit) as Prediction[];
}
function failure(db: DatabaseSync): void {
  try { db.exec("UPDATE graduation_contract_state SET record_failures=record_failures+1 WHERE id=1"); } catch { /* diagnostics must not change the path */ }
}
function record(db: DatabaseSync, prediction: Prediction, kind: "owner_reply" | "delivered", receipt: Receipt | null, observedAt: number, nowMs: number): void {
  db.exec("SAVEPOINT graduation_recorder");
  try {
    if (!db.prepare("SELECT 1 FROM graduation_recorder_keys WHERE expectation_id=? AND kind=?").get(prediction.expectation_id, kind)) {
      const observation = recordObservation(db, {
        expectationId: prediction.expectation_id, observableKind: kind,
        observationKind: receipt ? "receipt_backed" : "missing",
        ...(receipt ? { observedValueTyped: kind === "owner_reply" ? { replied: true } : { delivered: true }, operationalReceiptType: kind === "owner_reply" ? "owner_message" : "delivery_receipt", operationalReceiptId: receipt.id, dataClassification: receipt.classification } : {}),
        nowMs: observedAt,
      });
      const prior = latestAdjudication(db, prediction.expectation_id);
      const adjudication = recordAdjudication(db, {
        expectationId: prediction.expectation_id, observationId: observation.observationId,
        disposition: receipt ? "confirmed" : "contradicted", proposalOrigin: "deterministic_extractor",
        hostValidationOk: true, adjudicationAuthority: "deterministic_compare", comparatorPolicyVersion: `${kind}.v1`,
        ...(prior ? { supersedesAdjudicationId: prior.adjudicationId, correctionClass: "TEMPORAL_SUPERSESSION" as const } : {}), nowMs,
      });
      db.prepare("INSERT INTO graduation_recorder_keys (expectation_id,kind,observation_id,adjudication_id) VALUES (?,?,?,?)").run(prediction.expectation_id, kind, observation.observationId, adjudication.adjudicationId);
    }
    db.exec("RELEASE graduation_recorder");
  } catch {
    db.exec("ROLLBACK TO graduation_recorder; RELEASE graduation_recorder");
    failure(db);
  }
}
export function recordOwnerReply(db: DatabaseSync, nowMs: number, options: { conversationId?: string; dueOnly?: boolean; limit?: number } = {}): void {
  try {
    for (const prediction of predictions(db, "owner_reply", options.limit ?? 50, options.conversationId)) {
      const horizon = prediction.created_at_ms + prediction.horizon_hours * 3_600_000;
      if (options.dueOnly && nowMs < horizon) continue;
      const row = db.prepare(`SELECT v.row_id,v.created_at_ms,v.data_classification FROM inbox_events i
        JOIN conversation_evidence_log v ON v.row_id=json_extract(i.payload_json,'$.evidenceRowId')
        WHERE i.kind='owner_utterance' AND i.conversation_id=? AND v.conversation_id=i.conversation_id
          AND v.role='owner' AND json_extract(i.payload_json,'$.cycleId')<>?
          AND i.created_at_ms>=? AND i.created_at_ms<=? AND i.created_at_ms<=?
        ORDER BY i.created_at_ms,i.rowid LIMIT 1`).get(prediction.conversation_id, prediction.cycle_id, prediction.created_at_ms, horizon, nowMs);
      // Secret content stays omitted; only a protective, never-public receipt identifier is carried.
      const receipt: Receipt | null = row ? { id: String(row.row_id), at: Number(row.created_at_ms), classification: row.data_classification === "secret" ? "never_public" : row.data_classification as DataClassification } : null;
      if (receipt || nowMs >= horizon) record(db, prediction, "owner_reply", receipt, receipt?.at ?? horizon, nowMs);
    }
  } catch { failure(db); }
}
export function recordDelivered(db: DatabaseSync, nuclear: DatabaseSync, nowMs: number, options: { cycleId?: string; dueOnly?: boolean; limit?: number } = {}): void {
  try {
    for (const prediction of predictions(db, "delivered", options.limit ?? 50, undefined, options.cycleId)) {
      const horizon = prediction.created_at_ms + prediction.horizon_hours * 3_600_000;
      if (options.dueOnly && nowMs < horizon) continue;
      const outbox = db.prepare("SELECT nuclear_reservation_id,send_status,nuclear_finalization_reason FROM speech_outbox WHERE cycle_id=? ORDER BY generation DESC,outbox_id DESC LIMIT 1").get(prediction.cycle_id);
      const destination = outbox?.nuclear_reservation_id == null ? null : nuclear.prepare("SELECT id,state,finalized_at FROM delivery_reservations WHERE id=?").get(outbox.nuclear_reservation_id);
      const bubbles = destination ? nuclear.prepare("SELECT ordinal,discord_message_id,sent_at FROM delivery_bubbles WHERE reservation_id=? ORDER BY ordinal").all(destination.id!) : [];
      const complete = destination?.state === "committed" && outbox?.send_status === "delivered" && bubbles.length > 0 && bubbles.every((bubble, i) => Number(bubble.ordinal) === i && typeof bubble.discord_message_id === "string" && bubble.discord_message_id.trim() && Number.isFinite(Date.parse(String(bubble.sent_at))));
      const last = bubbles.at(-1);
      const deliveredAt = complete ? Math.max(...bubbles.map(b => Date.parse(String(b.sent_at)))) : NaN;
      const receipt: Receipt | null = complete && deliveredAt >= prediction.created_at_ms && deliveredAt <= horizon && deliveredAt <= nowMs
        ? { id: String(last!.discord_message_id), at: deliveredAt, classification: prediction.data_classification } : null;
      const failed = destination && outbox?.nuclear_finalization_reason !== "reconciliation_conflict" && ["aborted", "cancelled", "expired", "partially_delivered"].includes(String(destination.state)) && ["send_failure", "partially_delivered"].includes(String(outbox?.send_status));
      const failedAt = destination ? Date.parse(String(destination.finalized_at)) : NaN;
      if (receipt || failed || nowMs >= horizon) record(db, prediction, "delivered", receipt, receipt?.at ?? (failed && Number.isFinite(failedAt) ? Math.min(failedAt, horizon) : horizon), nowMs);
    }
  } catch { failure(db); }
}
