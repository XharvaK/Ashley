import type { DatabaseSync } from "node:sqlite";
import {
  canRetryClaim,
  incrementClaimAttempt,
  markClaimOutcome,
  RELATIONSHIP_CLAIM_MAX_ATTEMPTS,
} from "./claims.js";
import { markRepairCommitted } from "./repair.js";
import { updateDocReminderStatus } from "./store.js";
import type { DeliveryState } from "../delivery/types.js";
import type { FinalizeCause } from "../delivery/finalize.js";

function motivationRefsForDecision(
  db: DatabaseSync,
  decisionId: number,
): Array<{ refType: string | null; refId: string | null }> {
  const row = db
    .prepare(
      `SELECT motivation_ids_json FROM decision_log WHERE id = ?`,
    )
    .get(decisionId) as { motivation_ids_json?: string } | undefined;
  if (!row?.motivation_ids_json) return [];
  let ids: number[] = [];
  try {
    ids = JSON.parse(row.motivation_ids_json) as number[];
  } catch {
    return [];
  }
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT ref_type, ref_id FROM motivations
       WHERE id IN (${placeholders})`,
    )
    .all(...ids)
    .map((value) => {
      const item = value as Record<string, unknown>;
      return {
        refType: item.ref_type == null ? null : String(item.ref_type),
        refId: item.ref_id == null ? null : String(item.ref_id),
      };
    });
}

export function applyRelationshipDeliveryOutcome(
  db: DatabaseSync,
  input: {
    ownerId: string;
    decisionId: number | null | undefined;
    cause: FinalizeCause;
    state: DeliveryState;
    receiptCount: number;
    deliveryReceiptId?: string | null;
  },
): void {
  if (!input.decisionId) return;
  const refs = motivationRefsForDecision(db, input.decisionId);
  const committed =
    input.receiptCount > 0 &&
    (input.state === "committed" || input.state === "partially_delivered");
  const retryableFailure =
    input.receiptCount === 0 &&
    (input.cause === "send_failure" || input.cause === "delivery_lease");

  for (const ref of refs) {
    if (!ref.refId) continue;
    if (ref.refType === "doc_reminder") {
      if (committed) {
        updateDocReminderStatus(db, ref.refId, "fulfilled");
        markClaimOutcome(db, ref.refId, "committed");
      } else if (retryableFailure) {
        const attempts = incrementClaimAttempt(db, ref.refId, input.cause);
        if (!canRetryClaim(ref.refId, attempts)) {
          markClaimOutcome(db, ref.refId, "released", "retry_exhausted");
          updateDocReminderStatus(db, ref.refId, "deferred");
        }
      } else if (input.state === "partially_delivered") {
        markClaimOutcome(db, ref.refId, "aborted", "partial_delivery");
      } else if (input.cause === "cancel") {
        markClaimOutcome(db, ref.refId, "released", "cancelled");
      }
    }
    if (ref.refType === "withdrawal" && committed && input.deliveryReceiptId) {
      markRepairCommitted(db, ref.refId, input.deliveryReceiptId);
    }
  }
}

export function markMissedDueReminders(
  db: DatabaseSync,
  ownerId: string,
  nowIso: string,
  graceHours: number,
): number {
  const graceMs = graceHours * 3_600_000;
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return 0;
  const rows = db
    .prepare(
      `SELECT entity_uuid, due_at, status FROM doc_reminders
       WHERE owner_id = ? AND status IN ('pending', 'due', 'motivated')
         AND due_at IS NOT NULL`,
    )
    .all(ownerId) as Array<{
    entity_uuid?: string;
    due_at?: string;
    status?: string;
  }>;
  let missed = 0;
  for (const row of rows) {
    const dueMs = Date.parse(String(row.due_at ?? ""));
    if (!Number.isFinite(dueMs) || nowMs <= dueMs + graceMs) continue;
    const entityUuid = String(row.entity_uuid ?? "");
    if (!entityUuid) continue;
    updateDocReminderStatus(db, entityUuid, "missed");
    markClaimOutcome(db, entityUuid, "released", "missed");
    missed += 1;
  }
  return missed;
}

export { RELATIONSHIP_CLAIM_MAX_ATTEMPTS };
