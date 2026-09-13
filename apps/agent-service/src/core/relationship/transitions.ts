import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { getDecision } from "../agency/log.js";
import { bilateralRelationshipConsentEligible } from "./consent.js";
import type { DataClassification } from "../privacy/classification.js";
import {
  assertC5ContractCompatible,
  normalizeC5WriteMode,
  provenanceForC5Mode,
} from "./c5-contract-state.js";
import type { C5Mode, MutualCommitmentStatus } from "./types.js";

type C5TransitionOptions = {
  capabilityMode?: C5Mode;
};

function validateDeliveryBinding(
  db: DatabaseSync,
  ownerId: string,
  deliveryEntityUuid: string,
  decisionId?: number,
): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(delivery_reservations)").all() as Array<{ name?: string }>)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
  if (!columns.has("entity_uuid")) {
    throw new Error("relationship_delivery_ledger_unavailable");
  }
  const row = db.prepare(
    `SELECT owner_id, decision_id, state
     FROM delivery_reservations WHERE entity_uuid = ?`,
  ).get(deliveryEntityUuid) as {
    owner_id?: string;
    decision_id?: number | null;
    state?: string;
  } | undefined;
  if (!row) throw new Error("relationship_delivery_reference_unknown");
  if (row.owner_id !== ownerId) throw new Error("relationship_delivery_owner_mismatch");
  if (!["reserved", "sending", "committed", "partially_delivered"].includes(String(row.state))) {
    throw new Error("relationship_delivery_reference_not_authorized");
  }
  if (decisionId != null && Number(row.decision_id ?? 0) !== decisionId) {
    throw new Error("relationship_delivery_decision_mismatch");
  }
}

function textHash(text: string): string {
  return createHash("sha256")
    .update(text.normalize("NFC").trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function proposeMutualCommitment(
  db: DatabaseSync,
  input: {
    ownerId: string;
    text: string;
    sourceEntityType: string;
    sourceEntityUuid: string;
    classification: DataClassification;
    capabilityMode?: C5Mode;
  },
): string {
  assertC5ContractCompatible(db);
  const text = input.text.trim().slice(0, 600);
  if (!text) throw new Error("relationship_text_required");
  const now = new Date().toISOString();
  const c5Mode = normalizeC5WriteMode(db, input.capabilityMode ?? "observe");
  const hash = textHash(text);
  const existing = db
    .prepare(
      `SELECT entity_uuid FROM mutual_commitments
       WHERE owner_id = ? AND source_entity_uuid = ? AND text_hash = ?`,
    )
    .get(input.ownerId, input.sourceEntityUuid, hash) as
    | { entity_uuid?: string }
    | undefined;
  const entityUuid = existing?.entity_uuid ?? assignNewEntityUuid();
  db.prepare(
    `INSERT INTO mutual_commitments
       (owner_id, entity_uuid, data_classification, text, status,
        source_entity_type, source_entity_uuid, text_hash, created_at, updated_at,
        provenance, party_subject_scope)
     VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, source_entity_uuid, text_hash) DO UPDATE SET
       text = excluded.text,
       data_classification = excluded.data_classification,
       updated_at = excluded.updated_at,
       provenance = mutual_commitments.provenance,
       party_subject_scope = excluded.party_subject_scope`,
  ).run(
    input.ownerId,
    entityUuid,
    input.classification,
    text,
    input.sourceEntityType,
    input.sourceEntityUuid,
    hash,
    now,
    now,
    provenanceForC5Mode(c5Mode),
    "owner + ashley",
  );
  return entityUuid;
}

export function confirmMutualDoc(
  db: DatabaseSync,
  entityUuid: string,
  docEvidenceEntityUuid: string,
  options: C5TransitionOptions = {},
): void {
  assertC5ContractCompatible(db);
  normalizeC5WriteMode(db, options.capabilityMode ?? "observe");
  if (!docEvidenceEntityUuid.trim()) throw new Error("mutual_owner_confirmation_evidence_required");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE mutual_commitments
     SET doc_confirmed_at = COALESCE(doc_confirmed_at, ?),
         doc_evidence_entity_uuid = COALESCE(doc_evidence_entity_uuid, ?),
         updated_at = ?
     WHERE entity_uuid = ? AND status = 'proposed'`,
  ).run(now, docEvidenceEntityUuid, now, entityUuid);
}

export function confirmMutualAshleyDelivery(
  db: DatabaseSync,
  entityUuid: string,
  deliveryEntityUuid: string,
  decisionId?: number,
  options: C5TransitionOptions = {},
): void {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(db, options.capabilityMode ?? "observe");
  const now = new Date().toISOString();
  if (!deliveryEntityUuid.trim()) throw new Error("relationship_delivery_reference_required");
  const commitment = db.prepare(
    `SELECT owner_id, status FROM mutual_commitments WHERE entity_uuid = ?`,
  ).get(entityUuid) as { owner_id?: string; status?: string } | undefined;
  if (!commitment || !["proposed", "active"].includes(String(commitment.status))) return;
  validateDeliveryBinding(
    db,
    String(commitment.owner_id ?? ""),
    deliveryEntityUuid.trim(),
    decisionId,
  );
  if (decisionId == null) {
    // Delivery proves expression only. It is deliberately not Ashley
    // confirmation and can never activate a mutual contract by itself.
    db.prepare(
      `UPDATE mutual_commitments
       SET ashley_delivery_entity_uuid = COALESCE(ashley_delivery_entity_uuid, ?),
           updated_at = ?
       WHERE entity_uuid = ? AND status IN ('proposed', 'active')`,
    ).run(deliveryEntityUuid, now, entityUuid);
    return;
  }
  confirmMutualAshleyDecision(db, entityUuid, decisionId, `delivery:${deliveryEntityUuid}`, {
    capabilityMode: mode,
  });
  db.prepare(
    `UPDATE mutual_commitments
     SET ashley_delivery_entity_uuid = ?,
         updated_at = ?
     WHERE entity_uuid = ? AND status IN ('proposed', 'active')`,
  ).run(deliveryEntityUuid, now, entityUuid);
}

/** Record Ashley's exact Thought/Agency commitment decision. */
export function confirmMutualAshleyDecision(
  db: DatabaseSync,
  entityUuid: string,
  decisionId: number,
  confirmationEvidenceRef = `decision:${decisionId}`,
  options: C5TransitionOptions = {},
): void {
  assertC5ContractCompatible(db);
  normalizeC5WriteMode(db, options.capabilityMode ?? "observe");
  const commitment = db.prepare(
    `SELECT owner_id, status FROM mutual_commitments WHERE entity_uuid = ?`,
  ).get(entityUuid) as { owner_id?: string; status?: string } | undefined;
  if (!commitment || !["proposed", "active"].includes(String(commitment.status))) {
    return;
  }
  const decision = getDecision(db, decisionId);
  if (!decision || decision.ownerId !== String(commitment.owner_id ?? "")) {
    throw new Error("mutual_ashley_decision_owner_mismatch");
  }
  if (decision.decisionKind === "silence" || decision.decisionKind === "refuse") {
    throw new Error("mutual_ashley_commitment_decision_invalid");
  }
  if (!confirmationEvidenceRef.trim()) throw new Error("mutual_ashley_confirmation_evidence_required");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE mutual_commitments
     SET ashley_confirmed_at = COALESCE(ashley_confirmed_at, ?),
         ashley_decision_id = COALESCE(ashley_decision_id, ?),
         ashley_confirmation_evidence_ref = COALESCE(ashley_confirmation_evidence_ref, ?),
         updated_at = ?
     WHERE entity_uuid = ? AND status IN ('proposed', 'active')`,
  ).run(now, decisionId, confirmationEvidenceRef.trim(), now, entityUuid);
}

export function tryActivateMutualCommitment(
  db: DatabaseSync,
  entityUuid: string,
  options: C5TransitionOptions = {},
): boolean {
  const mode = normalizeC5WriteMode(db, options.capabilityMode ?? "observe");
  if (mode !== "dark_apply") return false;
  const row = db
    .prepare(
      `SELECT status, doc_confirmed_at, ashley_confirmed_at,
              doc_evidence_entity_uuid, ashley_delivery_entity_uuid,
              ashley_decision_id, ashley_confirmation_evidence_ref,
              provenance
       FROM mutual_commitments WHERE entity_uuid = ?`,
    )
    .get(entityUuid) as Record<string, unknown> | undefined;
  if (!row || String(row.status) !== "proposed") return false;
  if (String(row.provenance ?? "shadow") !== "live") return false;
  const ownerRow = db.prepare(
    `SELECT owner_id FROM mutual_commitments WHERE entity_uuid = ?`,
  ).get(entityUuid) as { owner_id?: string } | undefined;
  if (!ownerRow?.owner_id || !bilateralRelationshipConsentEligible(db, ownerRow.owner_id)) {
    return false;
  }
  const bilaterallyEvidenced =
    row.doc_confirmed_at != null &&
    row.doc_evidence_entity_uuid != null &&
    row.ashley_confirmed_at != null &&
    row.ashley_decision_id != null &&
    row.ashley_confirmation_evidence_ref != null;
  if (!bilaterallyEvidenced) return false;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE mutual_commitments SET status = 'active', updated_at = ?
     WHERE entity_uuid = ? AND status = 'proposed'`,
  ).run(now, entityUuid);
  return true;
}

export const activateMutualCommitment = tryActivateMutualCommitment;

/** Close a mutual contract with separate withdrawal evidence; it cannot revive on restart. */
export function withdrawMutualCommitment(
  db: DatabaseSync,
  entityUuid: string,
  input: { initiator: "doc" | "ashley"; evidenceRef: string },
): void {
  assertC5ContractCompatible(db);
  if (!input.evidenceRef.trim()) throw new Error("mutual_withdrawal_evidence_required");
  const row = db.prepare(
    `SELECT mutual_withdrawal_evidence_json FROM mutual_commitments
     WHERE entity_uuid = ? AND status IN ('proposed', 'active')`,
  ).get(entityUuid) as { mutual_withdrawal_evidence_json?: string } | undefined;
  if (!row) return;
  let refs: unknown[] = [];
  try {
    const parsed = JSON.parse(row.mutual_withdrawal_evidence_json ?? "[]");
    refs = Array.isArray(parsed) ? parsed : [];
  } catch {
    refs = [];
  }
  refs.push({ initiator: input.initiator, evidenceRef: input.evidenceRef.trim() });
  db.prepare(
    `UPDATE mutual_commitments
     SET status = 'released', mutual_withdrawal_evidence_json = ?, updated_at = ?
     WHERE entity_uuid = ? AND status IN ('proposed', 'active')`,
  ).run(JSON.stringify(refs), new Date().toISOString(), entityUuid);
}

export function closeMutualCommitment(
  db: DatabaseSync,
  entityUuid: string,
  status: Extract<MutualCommitmentStatus, "fulfilled" | "released">,
): void {
  db.prepare(
    `UPDATE mutual_commitments SET status = ?, updated_at = ?
     WHERE entity_uuid = ? AND status IN ('proposed', 'active')`,
  ).run(status, new Date().toISOString(), entityUuid);
}
