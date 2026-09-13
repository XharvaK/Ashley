import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import { sanitizeEventPayload } from "./events.js";
import type {
  ChangeProposalEvent,
  ChangeProposalRecord,
  ChangeProposalState,
  ChangeProposalTargetCategory,
  TestReceiptRef,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function externalProposalId(): string {
  return randomBytes(18).toString("base64url");
}

function mapProposal(row: Record<string, unknown>): ChangeProposalRecord {
  return {
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    ownerId: String(row.owner_id),
    proposalId: String(row.proposal_id),
    proposer: row.proposer as ChangeProposalRecord["proposer"],
    targetCategory: String(row.target_category) as ChangeProposalTargetCategory,
    objective: String(row.objective),
    rationale: String(row.rationale),
    riskClass: row.risk_class as ChangeProposalRecord["riskClass"],
    dataClassification: String(row.data_classification),
    state: String(row.state) as ChangeProposalState,
    baseCommit: row.base_commit == null ? null : String(row.base_commit),
    baseTreeHash: row.base_tree_hash == null ? null : String(row.base_tree_hash),
    baseStale: Number(row.base_stale) === 1,
    testReceiptRefs: JSON.parse(String(row.test_receipt_refs_json ?? "[]")) as TestReceiptRef[],
    consultationRequired: Number(row.consultation_required) === 1,
    ashleyPosition:
      row.ashley_position == null
        ? null
        : (String(row.ashley_position) as ChangeProposalRecord["ashleyPosition"]),
    docDecision:
      row.doc_decision == null
        ? null
        : (String(row.doc_decision) as ChangeProposalRecord["docDecision"]),
    linkedRevisionEntityUuid:
      row.linked_revision_entity_uuid == null
        ? null
        : String(row.linked_revision_entity_uuid),
    linkedIdentityReviewEntityUuid:
      row.linked_identity_review_entity_uuid == null
        ? null
        : String(row.linked_identity_review_entity_uuid),
    quarantineReason:
      row.quarantine_reason == null ? null : String(row.quarantine_reason),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createChangeProposal(
  db: DatabaseSync,
  input: {
    ownerId: string;
    proposer: "ashley" | "operator";
    targetCategory: ChangeProposalTargetCategory;
    objective: string;
    rationale: string;
    riskClass: ChangeProposalRecord["riskClass"];
    expiresAt: string;
    baseCommit?: string;
    baseTreeHash?: string;
    repositoryIdentity?: string;
    sourceCleanliness?: string;
    linkedRevisionEntityUuid?: string;
    linkedIdentityReviewEntityUuid?: string;
    consultationRequired?: boolean;
    consultationClause?: string;
  },
): ChangeProposalRecord {
  const now = nowIso();
  const entityUuid = assignNewEntityUuid();
  const classification = defaultUnclassifiedConversational();
  db.prepare(
    `INSERT INTO change_proposals (
      entity_uuid, owner_id, proposal_id, proposer, target_category,
      objective, rationale, risk_class, data_classification,
      base_commit, base_tree_hash, repository_identity, source_cleanliness,
      linked_revision_entity_uuid, linked_identity_review_entity_uuid,
      consultation_required, consultation_clause, state, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).run(
    entityUuid,
    input.ownerId,
    externalProposalId(),
    input.proposer,
    input.targetCategory,
    input.objective,
    input.rationale,
    input.riskClass,
    classification,
    input.baseCommit ?? null,
    input.baseTreeHash ?? null,
    input.repositoryIdentity ?? null,
    input.sourceCleanliness ?? null,
    input.linkedRevisionEntityUuid ?? null,
    input.linkedIdentityReviewEntityUuid ?? null,
    input.consultationRequired ? 1 : 0,
    input.consultationClause ?? null,
    input.expiresAt,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM change_proposals WHERE entity_uuid = ?`)
    .get(entityUuid) as Record<string, unknown>;
  return mapProposal(row);
}

export function getChangeProposalByEntityUuid(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
): ChangeProposalRecord | null {
  const row = db
    .prepare(`SELECT * FROM change_proposals WHERE owner_id = ? AND entity_uuid = ?`)
    .get(ownerId, entityUuid) as Record<string, unknown> | undefined;
  return row ? mapProposal(row) : null;
}

export function listChangeProposals(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): ChangeProposalRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM change_proposals WHERE owner_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(ownerId, limit) as Array<Record<string, unknown>>;
  return rows.map(mapProposal);
}

export function updateProposalFields(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  fields: Record<string, string | number | null>,
): void {
  const sets = ["updated_at = ?"];
  const values: Array<string | number | null> = [nowIso()];
  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  values.push(ownerId, entityUuid);
  db.prepare(
    `UPDATE change_proposals SET ${sets.join(", ")} WHERE owner_id = ? AND entity_uuid = ?`,
  ).run(...values);
}

export function updateProposalState(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  state: ChangeProposalState,
  extra: Record<string, string | number | null> = {},
): void {
  const sets = ["state = ?", "updated_at = ?"];
  const values: Array<string | number | null> = [state, nowIso()];
  for (const [key, value] of Object.entries(extra)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }
  values.push(ownerId, entityUuid);
  db.prepare(
    `UPDATE change_proposals SET ${sets.join(", ")} WHERE owner_id = ? AND entity_uuid = ?`,
  ).run(...values);
}

export function appendChangeProposalEvent(
  db: DatabaseSync,
  input: {
    ownerId: string;
    proposalEntityUuid: string;
    eventType: string;
    actor: string;
    payload?: Record<string, unknown>;
  },
): ChangeProposalEvent {
  const payload = sanitizeEventPayload(input.payload ?? {});
  const entityUuid = assignNewEntityUuid();
  const now = nowIso();
  const classification = defaultUnclassifiedConversational();
  db.prepare(
    `INSERT INTO change_proposal_events (
      entity_uuid, proposal_entity_uuid, owner_id, event_type, actor,
      payload_json, data_classification, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entityUuid,
    input.proposalEntityUuid,
    input.ownerId,
    input.eventType,
    input.actor,
    JSON.stringify(payload),
    classification,
    now,
  );
  return {
    id: Number(db.prepare("SELECT last_insert_rowid() AS id").get()!.id),
    entityUuid,
    proposalEntityUuid: input.proposalEntityUuid,
    eventType: input.eventType,
    actor: input.actor,
    payload: payload as ChangeProposalEvent["payload"],
    createdAt: now,
  };
}

export function listChangeProposalEvents(
  db: DatabaseSync,
  ownerId: string,
  proposalEntityUuid: string,
): ChangeProposalEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM change_proposal_events
       WHERE owner_id = ? AND proposal_entity_uuid = ?
       ORDER BY id ASC`,
    )
    .all(ownerId, proposalEntityUuid) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    proposalEntityUuid: String(row.proposal_entity_uuid),
    eventType: String(row.event_type),
    actor: String(row.actor),
    payload: JSON.parse(String(row.payload_json ?? "{}")) as ChangeProposalEvent["payload"],
    createdAt: String(row.created_at),
  }));
}

export function setTestReceiptRefs(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  refs: TestReceiptRef[],
): void {
  db.prepare(
    `UPDATE change_proposals
     SET test_receipt_refs_json = ?, updated_at = ?
     WHERE owner_id = ? AND entity_uuid = ?`,
  ).run(JSON.stringify(refs), nowIso(), ownerId, entityUuid);
}
