import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { getDecision } from "../agency/log.js";
import type { DataClassification } from "../privacy/classification.js";
import {
  assertC5ContractCompatible,
  normalizeC5WriteMode,
  provenanceForC5Mode,
} from "./c5-contract-state.js";
import type { C5Mode, C5Provenance } from "./types.js";

export type RelationalTension = {
  id: number;
  entityUuid: string;
  ownerId: string;
  text: string;
  status: string;
  repairStatus: string;
  dataClassification: DataClassification;
  provenance: C5Provenance;
  partySubjectScope: string;
  decisionId: number | null;
  repairProposalId: number | null;
  sourceEntityType: string;
  sourceEntityUuid: string;
  evidenceRefs: unknown[];
  createdAt: string;
  updatedAt: string;
};

export type RelationalTensionInput = {
  ownerId: string;
  text: string;
  sourceEntityType: string;
  sourceEntityUuid: string;
  decisionId?: number | null;
  evidenceRefs: unknown[];
  hostValidationOk: boolean;
  classification: DataClassification;
  partySubjectScope?: string;
  capabilityMode?: C5Mode;
  mode?: C5Mode;
};

function textHash(text: string): string {
  return createHash("sha256")
    .update(text.normalize("NFC").trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

function parseEvidence(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapTension(row: unknown): RelationalTension | null {
  if (typeof row !== "object" || row === null) return null;
  const source = row as Record<string, unknown>;
  return {
    id: Number(source.id ?? 0),
    entityUuid: String(source.entity_uuid ?? ""),
    ownerId: String(source.owner_id ?? ""),
    text: String(source.text ?? ""),
    status: String(source.status ?? ""),
    repairStatus: String(source.repair_status ?? ""),
    dataClassification: String(source.data_classification ?? "never_public") as DataClassification,
    provenance: String(source.provenance ?? "shadow") as C5Provenance,
    partySubjectScope: String(source.party_subject_scope ?? "owner"),
    decisionId: source.decision_id == null ? null : Number(source.decision_id),
    repairProposalId: source.repair_proposal_id == null ? null : Number(source.repair_proposal_id),
    sourceEntityType: String(source.source_entity_type ?? ""),
    sourceEntityUuid: String(source.source_entity_uuid ?? ""),
    evidenceRefs: parseEvidence(source.evidence_json),
    createdAt: String(source.created_at ?? ""),
    updatedAt: String(source.updated_at ?? ""),
  };
}

/** Record an unresolved relational tension; no model or delivery may close it. */
export function recordRelationalTension(
  db: DatabaseSync,
  input: RelationalTensionInput,
): RelationalTension {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(db, input.capabilityMode ?? input.mode ?? "observe");
  if (!input.hostValidationOk) throw new Error("relationship_host_validation_required");
  const text = input.text.trim().slice(0, 600);
  if (!text) throw new Error("relationship_text_required");
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new Error("relationship_evidence_required");
  }
  if (input.decisionId != null) {
    const decision = getDecision(db, input.decisionId);
    if (!decision || decision.ownerId !== input.ownerId) {
      throw new Error("relationship_decision_owner_mismatch");
    }
  }
  const sourceEntityType = input.sourceEntityType.trim();
  const sourceEntityUuid = input.sourceEntityUuid.trim();
  if (!sourceEntityType || !sourceEntityUuid) throw new Error("relationship_source_required");
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO relational_tensions
       (owner_id, entity_uuid, data_classification, text, status, repair_status,
        linked_withdrawal_entity_uuid, last_repair_decision_id,
        source_entity_type, source_entity_uuid, evidence_json, text_hash,
        created_at, updated_at, provenance, party_subject_scope, decision_id)
     VALUES (?, ?, ?, ?, 'open', 'open', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, source_entity_uuid, text_hash) DO UPDATE SET
       text = excluded.text,
       data_classification = excluded.data_classification,
       evidence_json = excluded.evidence_json,
       updated_at = excluded.updated_at,
       provenance = relational_tensions.provenance,
       party_subject_scope = excluded.party_subject_scope,
       decision_id = excluded.decision_id`,
  ).run(
    input.ownerId,
    assignNewEntityUuid(),
    input.classification,
    text,
    sourceEntityType,
    sourceEntityUuid,
    JSON.stringify(input.evidenceRefs),
    textHash(text),
    now,
    now,
    provenanceForC5Mode(mode),
    (input.partySubjectScope ?? "owner + ashley").trim().slice(0, 200) || "owner + ashley",
    input.decisionId ?? null,
  );
  const direct = mapTension(db.prepare(
    `SELECT * FROM relational_tensions WHERE id = ?`,
  ).get(Number(result.lastInsertRowid)));
  if (direct) return direct;
  const existing = mapTension(db.prepare(
    `SELECT * FROM relational_tensions
     WHERE owner_id = ? AND source_entity_uuid = ? AND text_hash = ?`,
  ).get(input.ownerId, sourceEntityUuid, textHash(text)));
  if (!existing) throw new Error("relational_tension_write_unreadable");
  return existing;
}

export function getRelationalTension(
  db: DatabaseSync,
  entityUuid: string,
): RelationalTension | null {
  assertC5ContractCompatible(db);
  return mapTension(db.prepare(
    `SELECT * FROM relational_tensions WHERE entity_uuid = ?`,
  ).get(entityUuid));
}
