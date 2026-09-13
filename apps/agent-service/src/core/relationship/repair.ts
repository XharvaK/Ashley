import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import type {
  SilenceReasonCode,
  WithdrawalScope,
} from "./types.js";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { getDecision } from "../agency/log.js";
import type { DataClassification } from "../privacy/classification.js";
import {
  assertC5ContractCompatible,
  normalizeC5WriteMode,
  provenanceForC5Mode,
} from "./c5-contract-state.js";
import type {
  C5Mode,
  C5Provenance,
  RepairDisposition,
  RepairProposalOrigin,
} from "./types.js";

const SCOPE_PRECEDENCE: WithdrawalScope[] = [
  "boundary_repair",
  "relationship_pause",
  "initiative",
  "topic",
  "turn",
];

export function repairCoolingHours(): number {
  return env.repairCoolingHours;
}

export function activeWithdrawal(
  db: DatabaseSync,
  ownerId: string,
  nowIso = new Date().toISOString(),
): Record<string, unknown> | null {
  const rows = db
    .prepare(
      `SELECT * FROM withdrawal_records
       WHERE owner_id = ? AND status = 'active'
       ORDER BY updated_at DESC`,
    )
    .all(ownerId) as Array<Record<string, unknown>>;
  const active = rows.filter((row) => {
    const expires = row.expires_at ? String(row.expires_at) : null;
    return !expires || expires > nowIso;
  });
  if (active.length === 0) return null;
  active.sort(
    (a, b) =>
      SCOPE_PRECEDENCE.indexOf(String(a.scope) as WithdrawalScope) -
      SCOPE_PRECEDENCE.indexOf(String(b.scope) as WithdrawalScope),
  );
  return active[0] ?? null;
}

export function evaluateWithdrawalSilence(
  db: DatabaseSync,
  ownerId: string,
  cognitionMode: "observe" | "apply",
  topicHint?: string,
  options: { proactive?: boolean } = {},
): SilenceReasonCode | null {
  // An active withdrawal is a denial barrier, not optional relational fuel.
  // Keep the mode parameter for the existing decision API, but do not allow
  // capability rollback to turn an owner's request for silence into speech.
  void cognitionMode;
  const row = activeWithdrawal(db, ownerId);
  if (!row) return null;
  const scope = String(row.scope) as WithdrawalScope;
  if (scope === "turn" && Number(row.turn_consumed ?? 0) === 0) {
    return "withdrawal_turn";
  }
  if (scope === "topic") {
    const hint = String(row.topic_hint ?? "").trim().toLowerCase();
    if (hint && topicHint && topicHint.toLowerCase().includes(hint)) {
      return "withdrawal_topic";
    }
    // A proactive candidate has no owner message from which to derive a
    // reliable topic. A topic withdrawal therefore blocks that candidate
    // conservatively; reactive turns pass their actual message as topicHint.
    if (options.proactive && (!hint || !topicHint)) return "withdrawal_topic";
  }
  if (scope === "initiative") return "withdrawal_initiative";
  if (scope === "relationship_pause") return "withdrawal_pause";
  if (scope === "boundary_repair") return "withdrawal_boundary_repair";
  return null;
}

export function consumeTurnWithdrawal(
  db: DatabaseSync,
  entityUuid: string,
): void {
  db.prepare(
    `UPDATE withdrawal_records
     SET turn_consumed = 1, updated_at = ?
     WHERE entity_uuid = ? AND scope = 'turn' AND turn_consumed = 0`,
  ).run(new Date().toISOString(), entityUuid);
}

export function consumeActiveTurnWithdrawal(
  db: DatabaseSync,
  ownerId: string,
): void {
  const row = activeWithdrawal(db, ownerId);
  if (!row || String(row.scope) !== "turn") return;
  const entityUuid = String(row.entity_uuid ?? "");
  if (!entityUuid) return;
  consumeTurnWithdrawal(db, entityUuid);
}

export function canAttemptRepair(
  db: DatabaseSync,
  ownerId: string,
  now = new Date(),
): boolean {
  const row = activeWithdrawal(db, ownerId, now.toISOString());
  if (!row) return false;
  const repairStatus = String(row.repair_status ?? "none");
  if (repairStatus === "backoff" || repairStatus === "attempted") return false;
  if (repairStatus === "cooling") {
    const until = row.cooling_until ? String(row.cooling_until) : null;
    return until !== null && until <= now.toISOString();
  }
  if (repairStatus === "eligible") return true;
  return false;
}

export function markRepairAttempted(
  db: DatabaseSync,
  withdrawalEntityUuid: string,
  decisionId: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE withdrawal_records
     SET repair_status = 'attempted', repair_decision_id = ?, updated_at = ?
     WHERE entity_uuid = ?`,
  ).run(decisionId, now, withdrawalEntityUuid);
}

export function markRepairBackoff(
  db: DatabaseSync,
  withdrawalEntityUuid: string,
): void {
  db.prepare(
    `UPDATE withdrawal_records
     SET repair_status = 'backoff', updated_at = ?
     WHERE entity_uuid = ?`,
  ).run(new Date().toISOString(), withdrawalEntityUuid);
}

export function markRepairCommitted(
  db: DatabaseSync,
  withdrawalEntityUuid: string,
  deliveryReceiptId: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE withdrawal_records
     SET repair_attempt_count = repair_attempt_count + 1,
         repair_delivery_receipt_id = ?,
         repair_status = 'backoff',
         updated_at = ?
     WHERE entity_uuid = ?`,
  ).run(deliveryReceiptId, now, withdrawalEntityUuid);
}

export type RepairProposal = {
  id: number;
  entityUuid: string;
  ownerId: string;
  tensionId: number | null;
  proposalOrigin: RepairProposalOrigin;
  proposalDecisionId: number | null;
  textHash: string;
  lifecycleState: string;
  dataClassification: DataClassification;
  provenance: C5Provenance;
  partySubjectScope: string;
  evidenceRefs: unknown[];
  repairText: string;
  createdAt: string;
};

export type RepairProposalInput = {
  ownerId: string;
  tensionId?: number | null;
  proposalOrigin: RepairProposalOrigin;
  proposalDecisionId?: number | null;
  text: string;
  evidenceRefs: unknown[];
  classification: DataClassification;
  partySubjectScope?: string;
  capabilityMode?: C5Mode;
  mode?: C5Mode;
};

export type RepairEvidence = {
  id: number;
  entityUuid: string;
  proposalId: number;
  ownerId: string;
  evidenceRefs: unknown[];
  dataClassification: DataClassification;
  provenance: C5Provenance;
  partySubjectScope: string;
  contentBinding: string;
  createdAt: string;
};

export type RepairAdjudication = {
  id: number;
  entityUuid: string;
  proposalId: number;
  ownerId: string;
  adjudicatingDecisionId: number;
  disposition: RepairDisposition;
  hostValidationOk: boolean;
  dataClassification: DataClassification;
  provenance: C5Provenance;
  partySubjectScope: string;
  evidenceRefs: unknown[];
  deliveryReceiptId: string | null;
  supersedesAdjudicationId: number | null;
  createdAt: string;
};

function repairHash(value: string): string {
  return createHash("sha256")
    .update(value.normalize("NFC").trim().toLowerCase())
    .digest("hex")
    .slice(0, 64);
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRepairProposal(row: unknown): RepairProposal | null {
  if (typeof row !== "object" || row === null) return null;
  const source = row as Record<string, unknown>;
  return {
    id: Number(source.id ?? 0),
    entityUuid: String(source.entity_uuid ?? ""),
    ownerId: String(source.owner_id ?? ""),
    tensionId: source.tension_id == null ? null : Number(source.tension_id),
    proposalOrigin: String(source.proposal_origin ?? "model") as RepairProposalOrigin,
    proposalDecisionId: source.proposal_decision_id == null ? null : Number(source.proposal_decision_id),
    textHash: String(source.text_hash ?? ""),
    lifecycleState: String(source.lifecycle_state ?? ""),
    dataClassification: String(source.data_classification ?? "never_public") as DataClassification,
    provenance: String(source.provenance ?? "shadow") as C5Provenance,
    partySubjectScope: String(source.party_subject_scope ?? "owner"),
    evidenceRefs: parseArray(source.evidence_refs_json),
    repairText: String(source.repair_text ?? ""),
    createdAt: String(source.created_at ?? ""),
  };
}

function validateRepairDecision(
  db: DatabaseSync,
  ownerId: string,
  decisionId: number | null | undefined,
): number {
  if (decisionId == null) throw new Error("repair_adjudicating_decision_required");
  const decision = getDecision(db, decisionId);
  if (!decision || decision.ownerId !== ownerId) {
    throw new Error("repair_decision_owner_mismatch");
  }
  return decisionId;
}

function proposalOwner(db: DatabaseSync, proposalId: number): RepairProposal {
  const proposal = mapRepairProposal(db.prepare(
    `SELECT * FROM repair_proposals WHERE id = ?`,
  ).get(proposalId));
  if (!proposal) throw new Error("repair_proposal_unavailable");
  return proposal;
}

/** Record a repair proposal. A proposal is not a repair outcome. */
export function recordRepairProposal(
  db: DatabaseSync,
  input: RepairProposalInput,
): RepairProposal {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(db, input.capabilityMode ?? input.mode ?? "observe");
  const text = input.text.trim().slice(0, 1000);
  if (!text) throw new Error("repair_text_required");
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new Error("repair_evidence_required");
  }
  if (input.proposalDecisionId != null) validateRepairDecision(db, input.ownerId, input.proposalDecisionId);
  if (input.tensionId != null) {
    const tension = db.prepare(
      `SELECT owner_id FROM relational_tensions WHERE id = ?`,
    ).get(input.tensionId) as { owner_id?: string } | undefined;
    if (!tension) throw new Error("repair_tension_unavailable");
    if (tension.owner_id !== input.ownerId) {
      throw new Error("repair_tension_owner_mismatch");
    }
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO repair_proposals
       (entity_uuid, owner_id, tension_id, proposal_origin, proposal_decision_id,
        text_hash, lifecycle_state, data_classification, provenance,
        party_subject_scope, evidence_refs_json, repair_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`,
  ).run(
    assignNewEntityUuid(),
    input.ownerId,
    input.tensionId ?? null,
    input.proposalOrigin,
    input.proposalDecisionId ?? null,
    repairHash(text),
    input.classification,
    provenanceForC5Mode(mode),
    (input.partySubjectScope ?? "owner + ashley").trim().slice(0, 200) || "owner + ashley",
    JSON.stringify(input.evidenceRefs),
    text,
    now,
  );
  const proposal = proposalOwner(db, Number(result.lastInsertRowid));
  recordRepairEvidence(db, {
    ownerId: input.ownerId,
    proposalId: proposal.id,
    evidenceRefs: input.evidenceRefs,
    classification: input.classification,
    partySubjectScope: input.partySubjectScope,
    capabilityMode: mode,
  });
  if (mode === "dark_apply" && input.tensionId != null) {
    db.prepare(
      `UPDATE relational_tensions
       SET repair_status = 'repairing', repair_proposal_id = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND status = 'open'`,
    ).run(proposal.id, now, input.tensionId, input.ownerId);
  }
  return proposalOwner(db, proposal.id);
}

export type RepairEvidenceInput = {
  ownerId: string;
  proposalId: number;
  evidenceRefs: unknown[];
  classification: DataClassification;
  partySubjectScope?: string;
  capabilityMode?: C5Mode;
  mode?: C5Mode;
};

export function recordRepairEvidence(
  db: DatabaseSync,
  input: RepairEvidenceInput,
): RepairEvidence {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(db, input.capabilityMode ?? input.mode ?? "observe");
  const proposal = proposalOwner(db, input.proposalId);
  if (proposal.ownerId !== input.ownerId) throw new Error("repair_proposal_owner_mismatch");
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new Error("repair_evidence_required");
  }
  const contentBinding = repairHash(JSON.stringify(input.evidenceRefs));
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO repair_evidence
       (entity_uuid, proposal_id, owner_id, evidence_refs_json,
        data_classification, provenance, party_subject_scope, content_binding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assignNewEntityUuid(),
    input.proposalId,
    input.ownerId,
    JSON.stringify(input.evidenceRefs),
    input.classification,
    provenanceForC5Mode(mode),
    (input.partySubjectScope ?? proposal.partySubjectScope).trim().slice(0, 200) || "owner + ashley",
    contentBinding,
    now,
  );
  const row = db.prepare(
    `SELECT * FROM repair_evidence WHERE id = ?`,
  ).get(Number(result.lastInsertRowid)) as Record<string, unknown>;
  return {
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    proposalId: Number(row.proposal_id),
    ownerId: String(row.owner_id),
    evidenceRefs: parseArray(row.evidence_refs_json),
    dataClassification: String(row.data_classification) as DataClassification,
    provenance: String(row.provenance) as C5Provenance,
    partySubjectScope: String(row.party_subject_scope),
    contentBinding: String(row.content_binding),
    createdAt: String(row.created_at),
  };
}

export type RepairAdjudicationInput = {
  ownerId: string;
  proposalId: number;
  disposition: RepairDisposition;
  adjudicatingDecisionId?: number | null;
  hostValidationOk: boolean;
  classification: DataClassification;
  evidenceRefs?: unknown[];
  partySubjectScope?: string;
  deliveryReceiptId?: string | null;
  supersedesAdjudicationId?: number | null;
  capabilityMode?: C5Mode;
  mode?: C5Mode;
};

/** Record adjudication with a decision; delivery is retained as an operational reference only. */
export function recordRepairAdjudication(
  db: DatabaseSync,
  input: RepairAdjudicationInput,
): RepairAdjudication {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(db, input.capabilityMode ?? input.mode ?? "observe");
  if (!input.hostValidationOk) throw new Error("repair_host_validation_required");
  const proposal = proposalOwner(db, input.proposalId);
  if (proposal.ownerId !== input.ownerId) throw new Error("repair_proposal_owner_mismatch");
  const evidence = db.prepare(
    `SELECT COUNT(*) AS count FROM repair_evidence WHERE proposal_id = ?`,
  ).get(input.proposalId) as { count?: number };
  if (Number(evidence.count ?? 0) === 0) throw new Error("repair_evidence_required");
  const decisionId = validateRepairDecision(db, input.ownerId, input.adjudicatingDecisionId);
  if (!["repaired", "not_repaired", "unresolved", "withdrawn"].includes(input.disposition)) {
    throw new Error("repair_disposition_invalid");
  }
  if (input.supersedesAdjudicationId != null) {
    const prior = db.prepare(
      `SELECT proposal_id, owner_id FROM repair_adjudications WHERE id = ?`,
    ).get(input.supersedesAdjudicationId) as { proposal_id?: number; owner_id?: string } | undefined;
    if (!prior || Number(prior.proposal_id) !== input.proposalId || prior.owner_id !== input.ownerId) {
      throw new Error("repair_adjudication_supersession_mismatch");
    }
  }
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO repair_adjudications
       (entity_uuid, proposal_id, owner_id, adjudicating_decision_id,
        disposition, host_validation_ok, data_classification, provenance,
        party_subject_scope, evidence_refs_json, delivery_receipt_id,
        supersedes_adjudication_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assignNewEntityUuid(),
    input.proposalId,
    input.ownerId,
    decisionId,
    input.disposition,
    input.hostValidationOk ? 1 : 0,
    input.classification,
    provenanceForC5Mode(mode),
    (input.partySubjectScope ?? proposal.partySubjectScope).trim().slice(0, 200) || "owner + ashley",
    JSON.stringify(input.evidenceRefs ?? proposal.evidenceRefs),
    input.deliveryReceiptId?.trim() || null,
    input.supersedesAdjudicationId ?? null,
    now,
  );
  db.prepare(
    `UPDATE repair_proposals
     SET lifecycle_state = 'adjudicated'
     WHERE id = ? AND owner_id = ?`,
  ).run(input.proposalId, input.ownerId);
  if (proposal.tensionId != null) {
    const tensionState = input.disposition === "repaired"
      ? { status: "resolved", repairStatus: "resolved" }
      : input.disposition === "withdrawn"
        ? { status: "open", repairStatus: "none" }
        : { status: "open", repairStatus: "open" };
    db.prepare(
      `UPDATE relational_tensions
       SET status = ?, repair_status = ?, repair_proposal_id = ?,
           last_repair_decision_id = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    ).run(
      tensionState.status,
      tensionState.repairStatus,
      input.proposalId,
      decisionId,
      now,
      proposal.tensionId,
      input.ownerId,
    );
  }
  const row = db.prepare(
    `SELECT * FROM repair_adjudications WHERE id = ?`,
  ).get(Number(result.lastInsertRowid)) as Record<string, unknown>;
  return {
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    proposalId: Number(row.proposal_id),
    ownerId: String(row.owner_id),
    adjudicatingDecisionId: Number(row.adjudicating_decision_id),
    disposition: String(row.disposition) as RepairDisposition,
    hostValidationOk: Number(row.host_validation_ok) === 1,
    dataClassification: String(row.data_classification) as DataClassification,
    provenance: String(row.provenance) as C5Provenance,
    partySubjectScope: String(row.party_subject_scope),
    evidenceRefs: parseArray(row.evidence_refs_json),
    deliveryReceiptId: row.delivery_receipt_id == null ? null : String(row.delivery_receipt_id),
    supersedesAdjudicationId: row.supersedes_adjudication_id == null ? null : Number(row.supersedes_adjudication_id),
    createdAt: String(row.created_at),
  };
}

export function latestRepairDisposition(
  db: DatabaseSync,
  proposalId: number,
): RepairAdjudication | null {
  assertC5ContractCompatible(db);
  const row = db.prepare(
    `SELECT * FROM repair_adjudications WHERE proposal_id = ? ORDER BY id DESC LIMIT 1`,
  ).get(proposalId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    entityUuid: String(row.entity_uuid),
    proposalId: Number(row.proposal_id),
    ownerId: String(row.owner_id),
    adjudicatingDecisionId: Number(row.adjudicating_decision_id),
    disposition: String(row.disposition) as RepairDisposition,
    hostValidationOk: Number(row.host_validation_ok) === 1,
    dataClassification: String(row.data_classification) as DataClassification,
    provenance: String(row.provenance) as C5Provenance,
    partySubjectScope: String(row.party_subject_scope),
    evidenceRefs: parseArray(row.evidence_refs_json),
    deliveryReceiptId: row.delivery_receipt_id == null ? null : String(row.delivery_receipt_id),
    supersedesAdjudicationId: row.supersedes_adjudication_id == null ? null : Number(row.supersedes_adjudication_id),
    createdAt: String(row.created_at),
  };
}
