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

export type AshleySelfCommitment = {
  id: number;
  entityUuid: string;
  ownerId: string;
  text: string;
  status: string;
  dataClassification: DataClassification;
  provenance: C5Provenance;
  partySubjectScope: string;
  decisionId: number;
  evidenceRefs: unknown[];
  sourceEntityType: string;
  sourceEntityUuid: string;
  createdAt: string;
  updatedAt: string;
};

export type AshleySelfCommitmentInput = {
  ownerId: string;
  text: string;
  sourceEntityType: string;
  sourceEntityUuid: string;
  decisionId?: number | null;
  evidenceRefs: unknown[];
  hostValidationOk: boolean;
  classification: DataClassification;
  partySubjectScope?: string;
  dueAt?: string | null;
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

function mapCommitment(row: unknown): AshleySelfCommitment | null {
  if (typeof row !== "object" || row === null) return null;
  const source = row as Record<string, unknown>;
  return {
    id: Number(source.id ?? 0),
    entityUuid: String(source.entity_uuid ?? ""),
    ownerId: String(source.owner_id ?? ""),
    text: String(source.text ?? ""),
    status: String(source.status ?? ""),
    dataClassification: String(source.data_classification ?? "never_public") as DataClassification,
    provenance: String(source.provenance ?? "shadow") as C5Provenance,
    partySubjectScope: String(source.party_subject_scope ?? "owner"),
    decisionId: Number(source.decision_id ?? 0),
    evidenceRefs: parseEvidence(source.evidence_json),
    sourceEntityType: String(source.source_entity_type ?? ""),
    sourceEntityUuid: String(source.source_entity_uuid ?? ""),
    createdAt: String(source.created_at ?? ""),
    updatedAt: String(source.updated_at ?? ""),
  };
}

function validateDecision(
  db: DatabaseSync,
  ownerId: string,
  decisionId: number | null | undefined,
): number {
  if (decisionId == null) throw new Error("relationship_decision_required");
  const decision = getDecision(db, decisionId);
  if (!decision || decision.ownerId !== ownerId) {
    throw new Error("relationship_decision_owner_mismatch");
  }
  if (decision.decisionKind === "silence" || decision.decisionKind === "refuse") {
    throw new Error("relationship_commitment_decision_invalid");
  }
  return decisionId;
}

/** Record Ashley's accepted self-commitment only with an exact Thought/Agency decision. */
export function recordAshleySelfCommitment(
  db: DatabaseSync,
  input: AshleySelfCommitmentInput,
): AshleySelfCommitment {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(db, input.capabilityMode ?? input.mode ?? "observe");
  if (!input.hostValidationOk) throw new Error("relationship_host_validation_required");
  const text = input.text.trim().slice(0, 600);
  if (!text) throw new Error("relationship_text_required");
  const decisionId = validateDecision(db, input.ownerId, input.decisionId);
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new Error("relationship_evidence_required");
  }
  const sourceEntityType = input.sourceEntityType.trim();
  const sourceEntityUuid = input.sourceEntityUuid.trim();
  if (!sourceEntityType || !sourceEntityUuid) throw new Error("relationship_source_required");
  const now = new Date().toISOString();
  const status = mode === "dark_apply" ? "active" : "motivated";
  const result = db.prepare(
    `INSERT INTO ashley_self_commitments
       (owner_id, entity_uuid, data_classification, text, status, due_at,
        source_entity_type, source_entity_uuid, evidence_json, text_hash,
        created_at, updated_at, provenance, party_subject_scope, decision_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, source_entity_uuid, text_hash) DO UPDATE SET
       text = excluded.text,
       status = excluded.status,
       due_at = excluded.due_at,
       data_classification = excluded.data_classification,
       evidence_json = excluded.evidence_json,
       updated_at = excluded.updated_at,
       status = ashley_self_commitments.status,
       provenance = ashley_self_commitments.provenance,
       party_subject_scope = excluded.party_subject_scope,
       decision_id = excluded.decision_id`,
  ).run(
    input.ownerId,
    assignNewEntityUuid(),
    input.classification,
    text,
    status,
    input.dueAt ?? null,
    sourceEntityType,
    sourceEntityUuid,
    JSON.stringify(input.evidenceRefs),
    textHash(text),
    now,
    now,
    provenanceForC5Mode(mode),
    (input.partySubjectScope ?? "ashley").trim().slice(0, 200) || "ashley",
    decisionId,
  );
  const row = mapCommitment(db.prepare(
    `SELECT * FROM ashley_self_commitments WHERE id = ?`,
  ).get(Number(result.lastInsertRowid)));
  if (!row) {
    const existing = db.prepare(
      `SELECT * FROM ashley_self_commitments
       WHERE owner_id = ? AND source_entity_uuid = ? AND text_hash = ?`,
    ).get(input.ownerId, sourceEntityUuid, textHash(text));
    const mapped = mapCommitment(existing);
    if (!mapped) throw new Error("ashley_self_commitment_write_unreadable");
    return mapped;
  }
  return row;
}

export function getAshleySelfCommitment(
  db: DatabaseSync,
  entityUuid: string,
): AshleySelfCommitment | null {
  assertC5ContractCompatible(db);
  return mapCommitment(db.prepare(
    `SELECT * FROM ashley_self_commitments WHERE entity_uuid = ?`,
  ).get(entityUuid));
}
