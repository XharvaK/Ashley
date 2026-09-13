import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import { sanitizeEventPayload } from "./events.js";
import type {
  ExternalActionEvent,
  ExternalActionKind,
  ExternalActionRecord,
  ExternalActionState,
  ExternalEntityNoteRecord,
  ExternalRiskClass,
  VaultCredentialIndexRecord,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function externalActionId(): string {
  return randomBytes(18).toString("base64url");
}

function mapAction(row: Record<string, unknown>): ExternalActionRecord {
  return {
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    ownerId: String(row.owner_id),
    actionId: String(row.action_id),
    adapterId: String(row.adapter_id),
    destinationId: String(row.destination_id),
    accountRef: row.account_ref == null ? null : String(row.account_ref),
    actionKind: String(row.action_kind) as ExternalActionKind,
    riskClass: String(row.risk_class) as ExternalRiskClass,
    dataClassification: String(row.data_classification),
    retentionClass: String(row.retention_class),
    retentionExpiresAt:
      row.retention_expires_at == null ? null : String(row.retention_expires_at),
    policyAuthorizationRef:
      row.policy_authorization_ref == null
        ? null
        : String(row.policy_authorization_ref),
    ownerApprovalRef:
      row.owner_approval_ref == null ? null : String(row.owner_approval_ref),
    policyDecisionHash:
      row.policy_decision_hash == null ? null : String(row.policy_decision_hash),
    policyContractId:
      row.policy_contract_id == null ? null : String(row.policy_contract_id),
    policyContractHash:
      row.policy_contract_hash == null ? null : String(row.policy_contract_hash),
    capabilityContractHash:
      row.capability_contract_hash == null
        ? null
        : String(row.capability_contract_hash),
    capabilityReleaseId:
      row.capability_release_id == null ? null : String(row.capability_release_id),
    evaluatorBuildId:
      row.evaluator_build_id == null ? null : String(row.evaluator_build_id),
    payloadRef: row.payload_ref == null ? null : String(row.payload_ref),
    payloadHash: row.payload_hash == null ? null : String(row.payload_hash),
    payloadClassification:
      row.payload_classification == null ? null : String(row.payload_classification),
    classificationInputsHash:
      row.classification_inputs_hash == null
        ? null
        : String(row.classification_inputs_hash),
    thoughtAuthorizationRefs: JSON.parse(
      String(row.thought_authorization_refs_json ?? "[]"),
    ) as string[],
    publicDisclosureResultHash:
      row.public_disclosure_result_hash == null
        ? null
        : String(row.public_disclosure_result_hash),
    credentialRef: row.credential_ref == null ? null : String(row.credential_ref),
    credentialLineageRef:
      row.credential_lineage_ref == null
        ? null
        : String(row.credential_lineage_ref),
    state: String(row.state) as ExternalActionState,
    idempotencyKey: String(row.idempotency_key),
    terminalReason: row.terminal_reason == null ? null : String(row.terminal_reason),
    reconciliationState:
      row.reconciliation_state == null ? null : String(row.reconciliation_state),
    reconciliationRef:
      row.reconciliation_ref == null ? null : String(row.reconciliation_ref),
    reconciliationLeaseExpiresAt:
      row.reconciliation_lease_expires_at == null
        ? null
        : String(row.reconciliation_lease_expires_at),
    providerReceiptIds: JSON.parse(
      String(row.provider_receipt_ids_json ?? "[]"),
    ) as string[],
    providerMessageIds: JSON.parse(
      String(row.provider_message_ids_json ?? "[]"),
    ) as string[],
    providerAttemptId:
      row.provider_attempt_id == null ? null : String(row.provider_attempt_id),
    deliveredCount: Number(row.delivered_count ?? 0),
    plannedCount: Number(row.planned_count ?? 0),
    reservationExpiresAt:
      row.reservation_expires_at == null
        ? null
        : String(row.reservation_expires_at),
    dispatchLeaseId:
      row.dispatch_lease_id == null ? null : String(row.dispatch_lease_id),
    dispatchLeaseExpiresAt:
      row.dispatch_lease_expires_at == null
        ? null
        : String(row.dispatch_lease_expires_at),
    externalErasureScope: JSON.parse(
      String(row.external_erasure_scope_json ?? "{}"),
    ) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapEntityNote(row: Record<string, unknown>): ExternalEntityNoteRecord {
  return {
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    ownerId: String(row.owner_id),
    sourceEntityUuid: String(row.source_entity_uuid),
    sourceEntityId:
      row.source_entity_id == null ? null : String(row.source_entity_id),
    channel: String(row.channel) as ExternalEntityNoteRecord["channel"],
    dataClassification: String(row.data_classification),
    retentionClass: String(row.retention_class),
    retentionExpiresAt:
      row.retention_expires_at == null ? null : String(row.retention_expires_at),
    claims: JSON.parse(String(row.claims_json ?? "[]")) as string[],
    verifiedFacts: JSON.parse(String(row.verified_facts_json ?? "[]")) as string[],
    ashleyOpinion: row.ashley_opinion == null ? null : String(row.ashley_opinion),
    evidenceRefs: JSON.parse(String(row.evidence_refs_json ?? "[]")) as string[],
    contentHash: String(row.content_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapVaultCredential(row: Record<string, unknown>): VaultCredentialIndexRecord {
  return {
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    ownerId: String(row.owner_id),
    credentialRef: String(row.credential_ref),
    credentialLineageRef: String(row.credential_lineage_ref),
    destinationId: row.destination_id == null ? null : String(row.destination_id),
    dataClassification: String(row.data_classification),
    retentionClass: String(row.retention_class),
    state: String(row.state) as VaultCredentialIndexRecord["state"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createExternalAction(
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
  const now = nowIso();
  const entityUuid = assignNewEntityUuid();
  const classification = defaultUnclassifiedConversational();
  db.prepare(
    `INSERT INTO external_actions (
      entity_uuid, owner_id, action_id, adapter_id, destination_id, account_ref,
      action_kind, risk_class, data_classification, payload_ref, payload_hash,
      idempotency_key, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', ?, ?)`,
  ).run(
    entityUuid,
    input.ownerId,
    externalActionId(),
    input.adapterId,
    input.destinationId,
    input.accountRef ?? null,
    input.actionKind,
    input.riskClass,
    classification,
    input.payloadRef ?? null,
    input.payloadHash ?? null,
    input.idempotencyKey,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM external_actions WHERE entity_uuid = ?`)
    .get(entityUuid) as Record<string, unknown>;
  return mapAction(row);
}

export function getExternalActionByEntityUuid(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
): ExternalActionRecord | null {
  const row = db
    .prepare(`SELECT * FROM external_actions WHERE owner_id = ? AND entity_uuid = ?`)
    .get(ownerId, entityUuid) as Record<string, unknown> | undefined;
  return row ? mapAction(row) : null;
}

export function getExternalActionByActionId(
  db: DatabaseSync,
  ownerId: string,
  actionId: string,
): ExternalActionRecord | null {
  const row = db
    .prepare(`SELECT * FROM external_actions WHERE owner_id = ? AND action_id = ?`)
    .get(ownerId, actionId) as Record<string, unknown> | undefined;
  return row ? mapAction(row) : null;
}

export function listExternalActions(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): ExternalActionRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM external_actions WHERE owner_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(ownerId, limit) as Array<Record<string, unknown>>;
  return rows.map(mapAction);
}

export function updateExternalActionFields(
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
    `UPDATE external_actions SET ${sets.join(", ")} WHERE owner_id = ? AND entity_uuid = ?`,
  ).run(...values);
}

export function updateExternalActionState(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  state: ExternalActionState,
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
    `UPDATE external_actions SET ${sets.join(", ")} WHERE owner_id = ? AND entity_uuid = ?`,
  ).run(...values);
}

export function appendExternalActionEvent(
  db: DatabaseSync,
  input: {
    ownerId: string;
    actionEntityUuid: string;
    eventType: string;
    actor: string;
    payload?: Record<string, unknown>;
  },
): ExternalActionEvent {
  const payload = sanitizeEventPayload(input.payload ?? {});
  const entityUuid = assignNewEntityUuid();
  const now = nowIso();
  const classification = defaultUnclassifiedConversational();
  db.prepare(
    `INSERT INTO external_action_events (
      entity_uuid, action_entity_uuid, owner_id, event_type, actor,
      payload_json, data_classification, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entityUuid,
    input.actionEntityUuid,
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
    actionEntityUuid: input.actionEntityUuid,
    ownerId: input.ownerId,
    eventType: input.eventType,
    actor: input.actor,
    payload: payload as ExternalActionEvent["payload"],
    dataClassification: classification,
    createdAt: now,
  };
}

export function listExternalActionEvents(
  db: DatabaseSync,
  ownerId: string,
  actionEntityUuid: string,
): ExternalActionEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM external_action_events
       WHERE owner_id = ? AND action_entity_uuid = ?
       ORDER BY id ASC`,
    )
    .all(ownerId, actionEntityUuid) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    actionEntityUuid: String(row.action_entity_uuid),
    ownerId: String(row.owner_id),
    eventType: String(row.event_type),
    actor: String(row.actor),
    payload: JSON.parse(String(row.payload_json ?? "{}")) as ExternalActionEvent["payload"],
    dataClassification: String(row.data_classification),
    createdAt: String(row.created_at),
  }));
}

export function createVaultCredentialIndex(
  db: DatabaseSync,
  input: {
    ownerId: string;
    credentialRef: string;
    credentialLineageRef: string;
    destinationId?: string;
  },
): VaultCredentialIndexRecord {
  const now = nowIso();
  const entityUuid = assignNewEntityUuid();
  const classification = defaultUnclassifiedConversational();
  db.prepare(
    `INSERT INTO vault_credential_index (
      entity_uuid, owner_id, credential_ref, credential_lineage_ref,
      destination_id, data_classification, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    entityUuid,
    input.ownerId,
    input.credentialRef,
    input.credentialLineageRef,
    input.destinationId ?? null,
    classification,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM vault_credential_index WHERE entity_uuid = ?`)
    .get(entityUuid) as Record<string, unknown>;
  return mapVaultCredential(row);
}

export function getVaultCredentialByRef(
  db: DatabaseSync,
  ownerId: string,
  credentialRef: string,
): VaultCredentialIndexRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM vault_credential_index
       WHERE owner_id = ? AND credential_ref = ?`,
    )
    .get(ownerId, credentialRef) as Record<string, unknown> | undefined;
  return row ? mapVaultCredential(row) : null;
}

export function listVaultCredentials(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): VaultCredentialIndexRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM vault_credential_index
       WHERE owner_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(ownerId, limit) as Array<Record<string, unknown>>;
  return rows.map(mapVaultCredential);
}

export function revokeVaultCredential(
  db: DatabaseSync,
  ownerId: string,
  credentialRef: string,
): VaultCredentialIndexRecord | null {
  const now = nowIso();
  db.prepare(
    `UPDATE vault_credential_index
     SET state = 'revoked', updated_at = ?
     WHERE owner_id = ? AND credential_ref = ?`,
  ).run(now, ownerId, credentialRef);
  return getVaultCredentialByRef(db, ownerId, credentialRef);
}

export function createExternalEntityNote(
  db: DatabaseSync,
  input: {
    ownerId: string;
    sourceEntityUuid: string;
    channel: "private" | "public";
    claims: string[];
    verifiedFacts?: string[];
    ashleyOpinion?: string;
    evidenceRefs?: string[];
    sourceEntityId?: string;
    contentHash?: string;
  },
): ExternalEntityNoteRecord {
  const now = nowIso();
  const entityUuid = assignNewEntityUuid();
  const classification = defaultUnclassifiedConversational();
  const contentHash =
    input.contentHash ??
    createHash("sha256")
      .update(
        JSON.stringify({
          claims: input.claims,
          verifiedFacts: input.verifiedFacts ?? [],
          ashleyOpinion: input.ashleyOpinion ?? null,
        }),
      )
      .digest("hex");
  db.prepare(
    `INSERT INTO external_entity_notes (
      entity_uuid, owner_id, source_entity_uuid, source_entity_id, channel,
      data_classification, claims_json, verified_facts_json, ashley_opinion,
      evidence_refs_json, content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entityUuid,
    input.ownerId,
    input.sourceEntityUuid,
    input.sourceEntityId ?? null,
    input.channel,
    classification,
    JSON.stringify(input.claims),
    JSON.stringify(input.verifiedFacts ?? []),
    input.ashleyOpinion ?? null,
    JSON.stringify(input.evidenceRefs ?? []),
    contentHash,
    now,
    now,
  );
  const row = db
    .prepare(`SELECT * FROM external_entity_notes WHERE entity_uuid = ?`)
    .get(entityUuid) as Record<string, unknown>;
  return mapEntityNote(row);
}

export function getExternalEntityNote(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
): ExternalEntityNoteRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM external_entity_notes WHERE owner_id = ? AND entity_uuid = ?`,
    )
    .get(ownerId, entityUuid) as Record<string, unknown> | undefined;
  return row ? mapEntityNote(row) : null;
}

export function listExternalEntityNotes(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): ExternalEntityNoteRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM external_entity_notes
       WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(ownerId, limit) as Array<Record<string, unknown>>;
  return rows.map(mapEntityNote);
}
