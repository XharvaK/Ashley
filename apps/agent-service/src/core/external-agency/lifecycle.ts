import type { DatabaseSync } from "node:sqlite";
import {
  appendExternalActionEvent,
  createExternalAction,
  getExternalActionByEntityUuid,
  updateExternalActionFields,
  updateExternalActionState,
} from "./store.js";
import type {
  ExternalActionKind,
  ExternalActionRecord,
  ExternalActionState,
  ExternalRiskClass,
} from "./types.js";

type TransitionResult =
  | { ok: true; state: ExternalActionState }
  | { ok: false; errorCode: string };

const TRANSITIONS: Record<
  ExternalActionState,
  Partial<Record<ExternalActionState, string>>
> = {
  drafted: {
    policy_checked: "policy_check_recorded",
    policy_denied: "policy_denied",
    expired: "expired",
  },
  policy_checked: {
    reserved: "reserved",
    policy_denied: "policy_denied",
    expired: "expired",
  },
  policy_denied: {},
  reserved: {
    dispatching: "dispatch_started",
    cancelled: "cancelled",
    expired: "expired",
  },
  dispatching: {
    receipt_received: "receipt_received",
    aborted: "aborted",
    reconciliation_required: "reconciliation_required",
  },
  receipt_received: {
    committed: "committed",
    partially_delivered: "partially_delivered",
  },
  committed: {},
  partially_delivered: {},
  aborted: {},
  cancelled: {},
  expired: {},
  reconciliation_required: {
    committed: "reconciled_committed",
    partially_delivered: "reconciled_partial",
    aborted: "reconciled_aborted",
    reconciliation_expired: "reconciliation_expired",
    outcome_unknown: "outcome_unknown",
  },
  reconciliation_expired: {},
  outcome_unknown: {},
};

function transitionAction(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  nextState: ExternalActionState,
  actor: string,
  payload: Record<string, unknown> = {},
): TransitionResult {
  const action = getExternalActionByEntityUuid(db, ownerId, entityUuid);
  if (!action) {
    return { ok: false, errorCode: "not_found" };
  }
  const allowed = TRANSITIONS[action.state]?.[nextState];
  if (!allowed) {
    return { ok: false, errorCode: "invalid_transition" };
  }
  updateExternalActionState(db, ownerId, entityUuid, nextState);
  appendExternalActionEvent(db, {
    ownerId,
    actionEntityUuid: entityUuid,
    eventType: allowed,
    actor,
    payload: { ...payload, brokerState: nextState },
  });
  return { ok: true, state: nextState };
}

export function draftAction(
  db: DatabaseSync,
  input: {
    ownerId: string;
    adapterId: string;
    destinationId: string;
    actionKind: ExternalActionKind;
    riskClass: ExternalRiskClass;
    idempotencyKey: string;
    accountRef?: string;
    payloadRef?: string;
    payloadHash?: string;
  },
): ExternalActionRecord {
  return createExternalAction(db, input);
}

export function recordPolicyCheck(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  allowed: boolean,
  actor: string,
  fields: Record<string, string | null> = {},
): TransitionResult {
  const action = getExternalActionByEntityUuid(db, ownerId, entityUuid);
  if (!action) return { ok: false, errorCode: "not_found" };
  if (Object.keys(fields).length > 0) {
    updateExternalActionFields(db, ownerId, entityUuid, fields);
  }
  return transitionAction(
    db,
    ownerId,
    entityUuid,
    allowed ? "policy_checked" : "policy_denied",
    actor,
    { statusCode: allowed ? "allow" : "deny" },
  );
}

export function reserveAction(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  reservationExpiresAt: string,
): TransitionResult {
  updateExternalActionFields(db, ownerId, entityUuid, {
    reservation_expires_at: reservationExpiresAt,
  });
  return transitionAction(db, ownerId, entityUuid, "reserved", actor);
}

export function markDispatching(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  input: { dispatchLeaseId: string; dispatchLeaseExpiresAt: string },
): TransitionResult {
  updateExternalActionFields(db, ownerId, entityUuid, {
    dispatch_lease_id: input.dispatchLeaseId,
    dispatch_lease_expires_at: input.dispatchLeaseExpiresAt,
  });
  return transitionAction(db, ownerId, entityUuid, "dispatching", actor);
}

export function recordReceipt(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  input: {
    providerReceiptId: string;
    providerAttemptId?: string;
    deliveredCount?: number;
    plannedCount?: number;
  },
): TransitionResult {
  const action = getExternalActionByEntityUuid(db, ownerId, entityUuid);
  if (!action) return { ok: false, errorCode: "not_found" };
  const receiptIds = [...action.providerReceiptIds, input.providerReceiptId];
  updateExternalActionFields(db, ownerId, entityUuid, {
    provider_receipt_ids_json: JSON.stringify(receiptIds),
    provider_attempt_id: input.providerAttemptId ?? null,
    delivered_count: input.deliveredCount ?? action.deliveredCount,
    planned_count: input.plannedCount ?? action.plannedCount,
  });
  return transitionAction(db, ownerId, entityUuid, "receipt_received", actor, {
    receiptId: input.providerReceiptId,
    deliveredCount: input.deliveredCount ?? action.deliveredCount,
    plannedCount: input.plannedCount ?? action.plannedCount,
  });
}

export function commitAction(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
): TransitionResult {
  return transitionAction(db, ownerId, entityUuid, "committed", actor);
}

export function abortAction(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  terminalReason?: string,
): TransitionResult {
  if (terminalReason) {
    updateExternalActionFields(db, ownerId, entityUuid, {
      terminal_reason: terminalReason,
    });
  }
  const action = getExternalActionByEntityUuid(db, ownerId, entityUuid);
  if (!action) return { ok: false, errorCode: "not_found" };
  if (action.state === "dispatching") {
    return transitionAction(db, ownerId, entityUuid, "aborted", actor, {
      terminalReason: terminalReason ?? "aborted",
    });
  }
  if (action.state === "reconciliation_required") {
    return transitionAction(db, ownerId, entityUuid, "aborted", actor, {
      terminalReason: terminalReason ?? "reconciled_aborted",
    });
  }
  return { ok: false, errorCode: "invalid_transition" };
}

export function enterReconciliation(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  input: { reconciliationRef: string; reconciliationLeaseExpiresAt: string },
): TransitionResult {
  updateExternalActionFields(db, ownerId, entityUuid, {
    reconciliation_ref: input.reconciliationRef,
    reconciliation_lease_expires_at: input.reconciliationLeaseExpiresAt,
    reconciliation_state: "pending",
  });
  return transitionAction(
    db,
    ownerId,
    entityUuid,
    "reconciliation_required",
    actor,
    { reconciliationRef: input.reconciliationRef },
  );
}

export function expireReconciliation(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
): TransitionResult {
  updateExternalActionFields(db, ownerId, entityUuid, {
    reconciliation_state: "expired",
    terminal_reason: "reconciliation_expired",
  });
  return transitionAction(
    db,
    ownerId,
    entityUuid,
    "reconciliation_expired",
    actor,
    { terminalReason: "reconciliation_expired" },
  );
}

export function cancelAction(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  terminalReason?: string,
): TransitionResult {
  if (terminalReason) {
    updateExternalActionFields(db, ownerId, entityUuid, {
      terminal_reason: terminalReason,
    });
  }
  const action = getExternalActionByEntityUuid(db, ownerId, entityUuid);
  if (!action) return { ok: false, errorCode: "not_found" };
  if (action.state !== "reserved") {
    return { ok: false, errorCode: "invalid_transition" };
  }
  return transitionAction(db, ownerId, entityUuid, "cancelled", actor, {
    terminalReason: terminalReason ?? "cancelled",
  });
}

export function reconcileAction(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  outcome: "committed" | "partially_delivered" | "aborted" | "outcome_unknown",
): TransitionResult {
  const action = getExternalActionByEntityUuid(db, ownerId, entityUuid);
  if (!action) return { ok: false, errorCode: "not_found" };
  if (action.state !== "reconciliation_required") {
    return { ok: false, errorCode: "invalid_transition" };
  }
  updateExternalActionFields(db, ownerId, entityUuid, {
    reconciliation_state: outcome === "outcome_unknown" ? "unknown" : "resolved",
    terminal_reason: outcome,
  });
  return transitionAction(db, ownerId, entityUuid, outcome, actor, {
    statusCode: outcome,
  });
}
