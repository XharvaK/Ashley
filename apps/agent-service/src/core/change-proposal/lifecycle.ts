import type { DatabaseSync } from "node:sqlite";
import {
  appendChangeProposalEvent,
  getChangeProposalByEntityUuid,
  updateProposalFields,
  updateProposalState,
} from "./store.js";
import { routingPolicy } from "./routing.js";
import type { ChangeProposalState } from "./types.js";

type TransitionResult =
  | { ok: true; state: ChangeProposalState }
  | { ok: false; errorCode: string };

const TRANSITIONS: Record<
  ChangeProposalState,
  Partial<Record<ChangeProposalState, string>>
> = {
  draft: { proposed: "created", quarantined: "secret_quarantined" },
  proposed: {
    awaiting_ashley_position: "created",
    awaiting_doc_decision: "created",
    quarantined: "secret_quarantined",
    expired: "expired",
    superseded: "superseded",
  },
  awaiting_ashley_position: {
    awaiting_doc_decision: "ashley_position_recorded",
    quarantined: "secret_quarantined",
    expired: "expired",
    superseded: "superseded",
  },
  awaiting_doc_decision: {
    approved: "doc_decision_recorded",
    rejected: "doc_decision_recorded",
    deferred: "doc_decision_recorded",
    stale_base: "base_marked_stale",
    quarantined: "secret_quarantined",
    expired: "expired",
    superseded: "superseded",
  },
  approved: { stale_base: "base_marked_stale", superseded: "superseded" },
  rejected: { superseded: "superseded" },
  deferred: { superseded: "superseded", awaiting_doc_decision: "doc_decision_recorded" },
  expired: {},
  stale_base: { superseded: "superseded", proposed: "created" },
  quarantined: { superseded: "superseded" },
  superseded: {},
};

export function transitionProposal(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  nextState: ChangeProposalState,
  actor: string,
  payload: Record<string, unknown> = {},
): TransitionResult {
  const proposal = getChangeProposalByEntityUuid(db, ownerId, entityUuid);
  if (!proposal) {
    return { ok: false, errorCode: "not_found" };
  }
  const allowed = TRANSITIONS[proposal.state]?.[nextState];
  if (!allowed) {
    return { ok: false, errorCode: "invalid_transition" };
  }
  updateProposalState(db, ownerId, entityUuid, nextState);
  appendChangeProposalEvent(db, {
    ownerId,
    proposalEntityUuid: entityUuid,
    eventType: allowed,
    actor,
    payload: { ...payload, brokerState: nextState },
  });
  return { ok: true, state: nextState };
}

export function proposeChange(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
): TransitionResult {
  const proposal = getChangeProposalByEntityUuid(db, ownerId, entityUuid);
  if (!proposal) return { ok: false, errorCode: "not_found" };
  const policy = routingPolicy(proposal.targetCategory);
  if (policy.routeToRevisions || policy.routeToIdentityReview) {
    return transitionProposal(db, ownerId, entityUuid, "proposed", actor);
  }
  const next = policy.requiresAshleyPosition
    ? "awaiting_ashley_position"
    : "awaiting_doc_decision";
  const toProposed = transitionProposal(db, ownerId, entityUuid, "proposed", actor);
  if (!toProposed.ok) return toProposed;
  return transitionProposal(db, ownerId, entityUuid, next, actor);
}

export function recordAshleyPosition(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  position: "affirm" | "object" | "defer",
  actor: string,
): TransitionResult {
  const proposal = getChangeProposalByEntityUuid(db, ownerId, entityUuid);
  if (!proposal) return { ok: false, errorCode: "not_found" };
  updateProposalFields(db, ownerId, entityUuid, {
    ashley_position: position,
    ashley_decided_at: new Date().toISOString(),
  });
  return transitionProposal(
    db,
    ownerId,
    entityUuid,
    "awaiting_doc_decision",
    actor,
    { statusCode: position },
  );
}

export function recordDocDecision(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  decision: "approve" | "reject" | "defer",
  actor: string,
): TransitionResult {
  const proposal = getChangeProposalByEntityUuid(db, ownerId, entityUuid);
  if (!proposal) return { ok: false, errorCode: "not_found" };
  updateProposalFields(db, ownerId, entityUuid, {
    doc_decision: decision,
    doc_decided_at: new Date().toISOString(),
  });
  const next =
    decision === "approve"
      ? "approved"
      : decision === "reject"
        ? "rejected"
        : "deferred";
  return transitionProposal(db, ownerId, entityUuid, next, actor, {
    statusCode: decision,
  });
}

export function markStaleBase(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  actor: string,
  baseCommit: string,
  baseTreeHash: string,
): TransitionResult {
  updateProposalFields(db, ownerId, entityUuid, {
    base_stale: 1,
    base_commit: baseCommit,
    base_tree_hash: baseTreeHash,
  });
  return transitionProposal(db, ownerId, entityUuid, "stale_base", actor, {
    baseCommit,
    baseTreeHash,
  });
}

export function quarantineProposal(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  reason: "secret_detected" | "patch_unsafe" | "archive_too_large",
  actor: string,
): TransitionResult {
  updateProposalFields(db, ownerId, entityUuid, {
    quarantine_reason: reason,
    quarantined_at: new Date().toISOString(),
  });
  return transitionProposal(db, ownerId, entityUuid, "quarantined", actor, {
    errorCode: reason,
  });
}

export function recordExternalOutcome(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  outcome: "committed" | "deployed" | "abandoned",
  actor: string,
  note?: string,
): TransitionResult {
  const proposal = getChangeProposalByEntityUuid(db, ownerId, entityUuid);
  if (!proposal) return { ok: false, errorCode: "not_found" };
  if (proposal.state !== "approved") {
    return { ok: false, errorCode: "invalid_state" };
  }
  updateProposalFields(db, ownerId, entityUuid, {
    external_outcome: outcome,
    external_outcome_at: new Date().toISOString(),
    external_outcome_note: note ?? null,
  });
  appendChangeProposalEvent(db, {
    ownerId,
    proposalEntityUuid: entityUuid,
    eventType: "external_outcome_recorded",
    actor,
    payload: { statusCode: outcome },
  });
  return { ok: true, state: proposal.state };
}
