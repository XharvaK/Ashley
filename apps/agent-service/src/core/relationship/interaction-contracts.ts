import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { getDecision } from "../agency/log.js";
import { listIdentity } from "../identity/store.js";
import type { DataClassification } from "../privacy/classification.js";
import {
  assertC5ContractCompatible,
  normalizeC5WriteMode,
  provenanceForC5Mode,
} from "./c5-contract-state.js";
import type {
  C5Mode,
  C5Provenance,
  InteractionContractKind,
  InteractionContractLifecycle,
} from "./types.js";

export type InteractionContractEvidenceRef = {
  type: string;
  id: string | number;
};

export type InteractionContract = {
  id: number;
  entityUuid: string;
  ownerId: string;
  kind: InteractionContractKind;
  lifecycleState: InteractionContractLifecycle;
  dataClassification: DataClassification;
  provenance: C5Provenance;
  partySubjectScope: string;
  evidenceRefs: InteractionContractEvidenceRef[];
  effectiveFrom: string;
  effectiveTo: string | null;
  scope: string | null;
  audience: string | null;
  withdrawalRefs: unknown[];
  correctionRefs: unknown[];
  supersessionRefs: unknown[];
  identityEntryId: number | null;
  identityIntervalVersion: string | null;
  proposalId: string | null;
  ownerConfirmationEvidenceRef: string | null;
  ashleyConfirmationEvidenceRef: string | null;
  ashleyDecisionId: number | null;
  deliveryReference: string | null;
  typedEvidence: Record<string, unknown>;
  uncertainty: number | null;
  adaptationPolicy: string | null;
  textHash: string | null;
  createdAt: string;
};

export type InteractionContractInput = {
  ownerId: string;
  kind: InteractionContractKind;
  lifecycleState?: InteractionContractLifecycle;
  classification: DataClassification;
  partySubjectScope?: string;
  evidenceRefs: InteractionContractEvidenceRef[];
  effectiveFrom?: string;
  effectiveTo?: string | null;
  scope?: string | null;
  audience?: string | null;
  withdrawalRefs?: unknown[];
  correctionRefs?: unknown[];
  supersessionRefs?: unknown[];
  identityEntryId?: number | null;
  identityIntervalVersion?: string | null;
  proposalId?: string | null;
  ownerConfirmationEvidenceRef?: string | null;
  ashleyConfirmationEvidenceRef?: string | null;
  ashleyDecisionId?: number | null;
  deliveryReference?: string | null;
  typedEvidence?: Record<string, unknown>;
  uncertainty?: number | null;
  adaptationPolicy?: string | null;
  text?: string | null;
  capabilityMode?: C5Mode;
  mode?: C5Mode;
};

const LIFECYCLES = new Set<InteractionContractLifecycle>([
  "recorded", "in_force", "withdrawn", "superseded", "proposed",
  "bilaterally_evidenced", "hypothesis",
]);

function textHash(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text
    ? createHash("sha256").update(text.normalize("NFC").toLowerCase()).digest("hex").slice(0, 64)
    : null;
}

function jsonObject(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;
  return value as Record<string, unknown>;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rowToContract(row: unknown): InteractionContract | null {
  if (typeof row !== "object" || row === null) return null;
  const source = row as Record<string, unknown>;
  const kind = String(source.kind ?? "");
  const lifecycleState = String(source.lifecycle_state ?? "");
  if (!["owner_standing_instruction", "ashley_standing_boundary", "mutual_contract", "implicit_hypothesis"].includes(kind)) return null;
  if (!LIFECYCLES.has(lifecycleState as InteractionContractLifecycle)) return null;
  let evidenceRefs: InteractionContractEvidenceRef[] = [];
  try {
    const parsed: unknown = JSON.parse(String(source.evidence_refs_json ?? "[]"));
    if (Array.isArray(parsed)) {
      evidenceRefs = parsed.filter((item): item is InteractionContractEvidenceRef =>
        typeof item === "object" && item !== null &&
        typeof (item as Record<string, unknown>).type === "string" &&
        (typeof (item as Record<string, unknown>).id === "string" ||
          typeof (item as Record<string, unknown>).id === "number"),
      );
    }
  } catch {
    evidenceRefs = [];
  }
  const parseArray = (name: string): unknown[] => {
    try { return jsonArray(JSON.parse(String(source[name] ?? "[]"))); } catch { return []; }
  };
  const parseObject = (name: string): Record<string, unknown> => {
    try { return jsonObject(JSON.parse(String(source[name] ?? "{}"))); } catch { return {}; }
  };
  return {
    id: Number(source.id ?? 0),
    entityUuid: String(source.entity_uuid ?? ""),
    ownerId: String(source.owner_id ?? ""),
    kind: kind as InteractionContractKind,
    lifecycleState: lifecycleState as InteractionContractLifecycle,
    dataClassification: String(source.data_classification ?? "never_public") as DataClassification,
    provenance: String(source.provenance ?? "shadow") as C5Provenance,
    partySubjectScope: String(source.party_subject_scope ?? "owner"),
    evidenceRefs,
    effectiveFrom: String(source.effective_from ?? ""),
    effectiveTo: source.effective_to == null ? null : String(source.effective_to),
    scope: source.scope == null ? null : String(source.scope),
    audience: source.audience == null ? null : String(source.audience),
    withdrawalRefs: parseArray("withdrawal_refs_json"),
    correctionRefs: parseArray("correction_refs_json"),
    supersessionRefs: parseArray("supersession_refs_json"),
    identityEntryId: source.identity_entry_id == null ? null : Number(source.identity_entry_id),
    identityIntervalVersion: source.identity_interval_version == null ? null : String(source.identity_interval_version),
    proposalId: source.proposal_id == null ? null : String(source.proposal_id),
    ownerConfirmationEvidenceRef: source.owner_confirmation_evidence_ref == null ? null : String(source.owner_confirmation_evidence_ref),
    ashleyConfirmationEvidenceRef: source.ashley_confirmation_evidence_ref == null ? null : String(source.ashley_confirmation_evidence_ref),
    ashleyDecisionId: source.ashley_decision_id == null ? null : Number(source.ashley_decision_id),
    deliveryReference: source.delivery_reference == null ? null : String(source.delivery_reference),
    typedEvidence: parseObject("typed_evidence_json"),
    uncertainty: source.uncertainty == null ? null : Number(source.uncertainty),
    adaptationPolicy: source.adaptation_policy == null ? null : String(source.adaptation_policy),
    textHash: source.text_hash == null ? null : String(source.text_hash),
    createdAt: String(source.created_at ?? ""),
  };
}

function validateDecisionOwner(db: DatabaseSync, ownerId: string, decisionId: number): void {
  const decision = getDecision(db, decisionId);
  if (!decision || decision.ownerId !== ownerId) {
    throw new Error("relationship_decision_owner_mismatch");
  }
}

function validateMutualDecision(db: DatabaseSync, ownerId: string, decisionId: number): void {
  const decision = getDecision(db, decisionId);
  if (!decision || decision.ownerId !== ownerId) {
    throw new Error("relationship_decision_owner_mismatch");
  }
  if (decision.decisionKind === "silence" || decision.decisionKind === "refuse") {
    throw new Error("mutual_contract_decision_invalid");
  }
}

function validateKindInput(db: DatabaseSync, input: InteractionContractInput): InteractionContractLifecycle {
  const defaults: Record<InteractionContractKind, InteractionContractLifecycle> = {
    owner_standing_instruction: "recorded",
    ashley_standing_boundary: "in_force",
    mutual_contract: "proposed",
    implicit_hypothesis: "hypothesis",
  };
  const lifecycle = input.lifecycleState ?? defaults[input.kind];
  if (!LIFECYCLES.has(lifecycle)) throw new Error("interaction_contract_lifecycle_invalid");
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0) {
    throw new Error("interaction_contract_evidence_required");
  }
  if (input.kind === "implicit_hypothesis") {
    if (lifecycle !== "hypothesis") throw new Error("implicit_hypothesis_cannot_bind");
    if (input.uncertainty == null || input.uncertainty < 0 || input.uncertainty > 1) {
      throw new Error("implicit_hypothesis_uncertainty_required");
    }
    const influenceClass = String(input.typedEvidence?.influenceClass ?? "I2");
    if (!("I0" === influenceClass || "I1" === influenceClass || "I2" === influenceClass)) {
      throw new Error("implicit_hypothesis_influence_class_too_high");
    }
  }
  if (input.kind === "owner_standing_instruction") {
    if (!input.ownerConfirmationEvidenceRef?.trim()) {
      throw new Error("owner_standing_instruction_evidence_required");
    }
    if (!input.scope?.trim() || !input.audience?.trim()) {
      throw new Error("owner_standing_instruction_scope_required");
    }
  }
  if (input.kind === "ashley_standing_boundary") {
    if (input.identityEntryId == null || !input.identityIntervalVersion?.trim()) {
      throw new Error("ashley_boundary_identity_pointer_required");
    }
    const identity = listIdentity(db, input.ownerId, { limit: 100, seed: false })
      .find((entry) => entry.id === input.identityEntryId);
    if (!identity) throw new Error("ashley_boundary_identity_pointer_invalid");
  }
  if (input.kind === "mutual_contract" && ["bilaterally_evidenced", "in_force"].includes(lifecycle)) {
    if (!input.proposalId?.trim() || !input.ownerConfirmationEvidenceRef?.trim() ||
        !input.ashleyConfirmationEvidenceRef?.trim() || input.ashleyDecisionId == null) {
      throw new Error("mutual_contract_bilateral_evidence_required");
    }
    validateMutualDecision(db, input.ownerId, input.ashleyDecisionId);
  }
  if (input.kind === "mutual_contract" && !input.proposalId?.trim()) {
    throw new Error("mutual_contract_proposal_required");
  }
  if (input.ashleyDecisionId != null) validateDecisionOwner(db, input.ownerId, input.ashleyDecisionId);
  return lifecycle;
}

/** Record a typed interaction contract. Implicit hypotheses remain hypotheses forever. */
export function recordInteractionContract(
  db: DatabaseSync,
  input: InteractionContractInput,
): InteractionContract {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(db, input.capabilityMode ?? input.mode ?? "observe");
  if (!Array.isArray(input.evidenceRefs)) throw new Error("interaction_contract_evidence_required");
  const lifecycle = validateKindInput(db, input);
  const now = new Date().toISOString();
  const effectiveFrom = input.effectiveFrom ?? now;
  if (input.effectiveTo != null && effectiveFrom >= input.effectiveTo) {
    throw new Error("interaction_contract_effective_interval_invalid");
  }
  const result = db.prepare(
    `INSERT INTO interaction_contracts
       (entity_uuid, owner_id, kind, lifecycle_state, data_classification,
        provenance, party_subject_scope, evidence_refs_json, effective_from,
        effective_to, scope, audience, withdrawal_refs_json, correction_refs_json,
        supersession_refs_json, identity_entry_id, identity_interval_version,
        proposal_id, owner_confirmation_evidence_ref, ashley_confirmation_evidence_ref,
        ashley_decision_id, delivery_reference, typed_evidence_json, uncertainty,
        adaptation_policy, text_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assignNewEntityUuid(),
    input.ownerId,
    input.kind,
    lifecycle,
    input.classification,
    provenanceForC5Mode(mode),
    (input.partySubjectScope ?? "owner + ashley").trim().slice(0, 200) || "owner + ashley",
    JSON.stringify(input.evidenceRefs),
    effectiveFrom,
    input.effectiveTo ?? null,
    input.scope?.trim() || null,
    input.audience?.trim() || null,
    JSON.stringify(input.withdrawalRefs ?? []),
    JSON.stringify(input.correctionRefs ?? []),
    JSON.stringify(input.supersessionRefs ?? []),
    input.identityEntryId ?? null,
    input.identityIntervalVersion?.trim() || null,
    input.proposalId?.trim() || null,
    input.ownerConfirmationEvidenceRef?.trim() || null,
    input.ashleyConfirmationEvidenceRef?.trim() || null,
    input.ashleyDecisionId ?? null,
    input.deliveryReference?.trim() || null,
    JSON.stringify(input.typedEvidence ?? {}),
    input.uncertainty ?? null,
    input.adaptationPolicy?.trim() || null,
    textHash(input.text),
    now,
  );
  const contract = rowToContract(db.prepare(
    `SELECT * FROM interaction_contracts WHERE id = ?`,
  ).get(Number(result.lastInsertRowid)));
  if (!contract) throw new Error("interaction_contract_write_unreadable");
  return contract;
}

export function getInteractionContract(db: DatabaseSync, id: number): InteractionContract | null {
  assertC5ContractCompatible(db);
  return rowToContract(db.prepare(
    `SELECT * FROM interaction_contracts WHERE id = ?`,
  ).get(id));
}

const TRANSITIONS: Record<InteractionContractKind, Partial<Record<InteractionContractLifecycle, InteractionContractLifecycle[]>>> = {
  owner_standing_instruction: { recorded: ["in_force"], in_force: ["withdrawn", "superseded"] },
  ashley_standing_boundary: { in_force: ["withdrawn", "superseded"] },
  mutual_contract: { proposed: ["bilaterally_evidenced", "withdrawn"], bilaterally_evidenced: ["in_force", "withdrawn"], in_force: ["withdrawn"] },
  implicit_hypothesis: { hypothesis: [] },
};

export function transitionInteractionContract(
  db: DatabaseSync,
  id: number,
  next: InteractionContractLifecycle,
  options: { effectiveTo?: string } = {},
): InteractionContract {
  assertC5ContractCompatible(db);
  const current = getInteractionContract(db, id);
  if (!current) throw new Error("interaction_contract_unavailable");
  if (current.kind === "implicit_hypothesis") {
    throw new Error("implicit_hypothesis_cannot_bind");
  }
  if (!LIFECYCLES.has(next) || !(TRANSITIONS[current.kind][current.lifecycleState] ?? []).includes(next)) {
    throw new Error("interaction_contract_transition_invalid");
  }
  if (current.kind === "mutual_contract" && ["bilaterally_evidenced", "in_force"].includes(next)) {
    if (!current.proposalId || !current.ownerConfirmationEvidenceRef ||
        !current.ashleyConfirmationEvidenceRef || current.ashleyDecisionId == null) {
      throw new Error("mutual_contract_bilateral_evidence_required");
    }
    validateMutualDecision(db, current.ownerId, current.ashleyDecisionId);
  }
  const effectiveTo = options.effectiveTo ?? (next === "withdrawn" || next === "superseded"
    ? transitionEndFor(current.effectiveFrom)
    : current.effectiveTo);
  if (effectiveTo != null && current.effectiveFrom >= effectiveTo) {
    throw new Error("interaction_contract_effective_interval_invalid");
  }
  db.prepare(
    `UPDATE interaction_contracts SET lifecycle_state = ?, effective_to = ? WHERE id = ?`,
  ).run(next, effectiveTo, id);
  const updated = getInteractionContract(db, id);
  if (!updated) throw new Error("interaction_contract_transition_unreadable");
  return updated;
}

function transitionEndFor(effectiveFrom: string): string {
  const now = Date.now();
  const start = Date.parse(effectiveFrom);
  return new Date(Number.isFinite(start) ? Math.max(now, start + 1) : now).toISOString();
}

export function listInteractionContracts(
  db: DatabaseSync,
  ownerId: string,
  kind?: InteractionContractKind,
): InteractionContract[] {
  assertC5ContractCompatible(db);
  const rows = kind === undefined
    ? db.prepare(`SELECT * FROM interaction_contracts WHERE owner_id = ? ORDER BY id ASC`).all(ownerId)
    : db.prepare(`SELECT * FROM interaction_contracts WHERE owner_id = ? AND kind = ? ORDER BY id ASC`).all(ownerId, kind);
  return rows.map(rowToContract).filter((row): row is InteractionContract => row !== null);
}
