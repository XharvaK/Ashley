import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import {
  CLASSIFICATION_RANK,
  maxClassification,
  type DataClassification,
} from "../privacy/classification.js";
import { getAssertion } from "../memory/assertions.js";
import { influenceEligibleAt } from "../memory/eligibility.js";
import { assertC3ContractCompatible } from "./contract-state.js";
import type {
  IdentitySeedLineageInput,
  LearnedAdjudicator,
  LearnedAutonomyMode,
  LearnedInfluence,
  LearnedInfluenceCandidateInput,
  LearnedInfluenceEvidence,
  LearnedInfluenceEvidenceInput,
} from "./types.js";

export type { LearnedInfluenceEvidenceInput } from "./types.js";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : number(value);
}

function classification(value: unknown): DataClassification {
  return value === "ordinary" || value === "sensitive" ||
    value === "never_public" || value === "secret"
    ? value
    : "never_public";
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireText(value: unknown, name: string, max = 2000): string {
  const result = text(value).trim();
  if (!result) throw new Error(`learned_influence_${name}_required`);
  if (result.length > max) throw new Error(`learned_influence_${name}_too_long`);
  return result;
}

function mapEvidence(value: unknown): LearnedInfluenceEvidence | null {
  if (!isRow(value)) return null;
  const provenance = value.provenance === "live" || value.provenance === "shadow"
    ? value.provenance
    : null;
  const evidenceType = value.evidence_type === "assertion" ? "assertion" : null;
  const dataClassification = classification(value.data_classification);
  if (!provenance || !evidenceType) return null;
  return {
    id: number(value.id),
    entityUuid: text(value.entity_uuid),
    learnedInfluenceId: number(value.learned_influence_id),
    ownerId: text(value.owner_id),
    evidenceType,
    evidenceId: text(value.evidence_id),
    assertionId: number(value.assertion_id),
    observedAt: text(value.observed_at),
    provenance,
    dataClassification,
    sourceContentHash: nullableText(value.source_content_hash),
    createdAt: text(value.created_at),
  };
}

function mapInfluence(value: unknown): LearnedInfluence | null {
  if (!isRow(value)) return null;
  const kind = value.kind === "interest" ? value.kind : null;
  const subjectFacet = value.subject_facet === "owner_model" ||
    value.subject_facet === "external_verifiable" ||
    value.subject_facet === "ashley_side" || value.subject_facet === "unknown"
    ? value.subject_facet
    : null;
  const lineageKind = value.lineage_kind === "unknown" ||
    value.lineage_kind === "explicit_seed" ||
    value.lineage_kind === "owner_designated" ||
    value.lineage_kind === "observed_overlap" || value.lineage_kind === "ashley_native"
    ? value.lineage_kind
    : null;
  const influenceClass = value.influence_class === "I0" ||
    value.influence_class === "I1" || value.influence_class === "I2" || value.influence_class === "I3"
    ? value.influence_class
    : null;
  const proposalLifecycle = value.proposal_lifecycle === "proposed" ||
    value.proposal_lifecycle === "admitted_to_review" ||
    value.proposal_lifecycle === "withdrawn" ||
    value.proposal_lifecycle === "expired_as_proposal"
    ? value.proposal_lifecycle
    : null;
  const adjudicationState = value.adjudication_state === "pending" ||
    value.adjudication_state === "accepted" || value.adjudication_state === "declined"
    ? value.adjudication_state
    : null;
  const contradictionState = value.contradiction_state === "none" ||
    value.contradiction_state === "contradicted" ||
    value.contradiction_state === "superseded" ||
    value.contradiction_state === "demoted" ||
    value.contradiction_state === "expired" ||
    value.contradiction_state === "owner_corrected"
    ? value.contradiction_state
    : null;
  const adjudicator = value.adjudicator === "thought" || value.adjudicator === "natural_owner"
    ? value.adjudicator
    : null;
  const provenance = value.provenance === "live" || value.provenance === "shadow"
    ? value.provenance
    : null;
  const capabilityModeAtWrite = value.capability_mode_at_write === "observe" ||
    value.capability_mode_at_write === "dark_apply" || value.capability_mode_at_write === "apply"
    ? value.capability_mode_at_write
    : null;
  if (
    !kind || !subjectFacet || !lineageKind || !influenceClass ||
    !proposalLifecycle || !adjudicationState || !contradictionState ||
    !provenance || !capabilityModeAtWrite
  ) return null;
  return {
    id: number(value.id),
    entityUuid: text(value.entity_uuid),
    ownerId: text(value.owner_id),
    kind,
    subjectFacet,
    semanticOwner: ["memory_evidence", "identity", "mind_state", "thought", "agency"]
      .includes(String(value.semantic_owner))
      ? value.semantic_owner as LearnedInfluence["semanticOwner"]
      : "memory_evidence",
    semanticOwnerRef: text(value.semantic_owner_ref),
    lineageKind,
    influenceClass,
    text: text(value.text),
    contentHash: text(value.content_hash),
    proposalLifecycle,
    adjudicationState,
    adjudicator,
    adjudicationDecisionId: nullableText(value.adjudication_decision_id),
    qualifiedAt: nullableText(value.qualified_at),
    contradictionState,
    contradictionReason: nullableText(value.contradiction_reason),
    demotedAt: nullableText(value.demoted_at),
    provenance,
    capabilityModeAtWrite,
    dataClassification: classification(value.data_classification),
    classificationSource: value.classification_source === "copied"
      ? "copied"
      : "derived_most_restrictive",
    classificationInvalidatedAt: nullableText(value.classification_invalidated_at),
    createdAt: text(value.created_at),
    updatedAt: text(value.updated_at),
  };
}

function rowForInfluence(db: DatabaseSync, id: number): LearnedInfluence | null {
  return mapInfluence(db.prepare(
    "SELECT * FROM learned_influences WHERE id = ?",
  ).get(id));
}

export function getLearnedInfluence(
  db: DatabaseSync,
  id: number,
): LearnedInfluence | null {
  assertC3ContractCompatible(db);
  return rowForInfluence(db, id);
}

export function listLearnedInfluences(
  db: DatabaseSync,
  ownerId: string,
): LearnedInfluence[] {
  assertC3ContractCompatible(db);
  return db.prepare(
    `SELECT * FROM learned_influences
     WHERE owner_id = ? ORDER BY id ASC`,
  ).all(ownerId)
    .map(mapInfluence)
    .filter((item): item is LearnedInfluence => item !== null);
}

function normalizeEvidence(
  db: DatabaseSync,
  input: LearnedInfluenceCandidateInput,
  now: string,
): {
  rows: Array<{
    input: LearnedInfluenceEvidenceInput;
    assertionId: number;
    ownerId: string;
    dataClassification: DataClassification;
  }>;
  dataClassification: DataClassification;
} {
  if (!Array.isArray(input.evidence) || input.evidence.length < 2) {
    throw new Error("learned_influence_evidence_minimum");
  }
  const unique = new Map<string, LearnedInfluenceEvidenceInput>();
  for (const item of input.evidence) {
    if (item?.evidenceType !== "assertion") {
      throw new Error("learned_influence_evidence_type_invalid");
    }
    const assertionId = item.assertionId ?? Number(item.evidenceId);
    if (!Number.isSafeInteger(assertionId) || assertionId <= 0) {
      throw new Error("learned_influence_evidence_assertion_required");
    }
    if (item.provenance !== "live") {
      throw new Error("learned_influence_live_evidence_required");
    }
    const observedAt = requireText(item.observedAt, "evidence_observed_at", 100);
    if (!Number.isFinite(Date.parse(observedAt))) {
      throw new Error("learned_influence_evidence_time_invalid");
    }
    const assertion = getAssertion(db, assertionId);
    if (!assertion || assertion.ownerId !== input.ownerId) {
      throw new Error("learned_influence_evidence_assertion_missing");
    }
    if (!influenceEligibleAt(db, assertion.id, now)) {
      throw new Error("learned_influence_evidence_not_current");
    }
    const key = `${item.evidenceType}:${assertionId}`;
    if (!unique.has(key)) unique.set(key, { ...item, assertionId, observedAt });
  }
  if (unique.size < 2) throw new Error("learned_influence_evidence_distinct_required");
  const times = new Set([...unique.values()].map((item) => item.observedAt));
  if (times.size < 2) throw new Error("learned_influence_evidence_temporal_span_required");
  const rows = [...unique.values()].map((item) => {
    const assertion = getAssertion(db, item.assertionId!);
    if (!assertion) throw new Error("learned_influence_evidence_assertion_missing");
    const itemClassification = maxClassification(
      assertion.dataClassification,
      item.dataClassification,
    );
    return {
      input: item,
      assertionId: assertion.id,
      ownerId: assertion.ownerId,
      dataClassification: itemClassification,
    };
  });
  const dataClassification = rows.reduce(
    (current, item) => maxClassification(current, item.dataClassification),
    "ordinary" as DataClassification,
  );
  if (dataClassification === "secret") {
    throw new Error("learned_influence_secret_evidence_refused");
  }
  return { rows, dataClassification };
}

function validateCandidate(
  db: DatabaseSync,
  input: LearnedInfluenceCandidateInput,
  now: string,
): {
  mode: "observe" | "dark_apply";
  evidence: ReturnType<typeof normalizeEvidence>;
  text: string;
  semanticOwnerRef: string;
} {
  assertC3ContractCompatible(db);
  const ownerId = requireText(input.ownerId, "owner_id", 256);
  if (input.kind !== "interest") throw new Error("learned_influence_kind_invalid");
  if (input.subjectFacet !== "owner_model" &&
      input.subjectFacet !== "external_verifiable" &&
      input.subjectFacet !== "ashley_side" && input.subjectFacet !== "unknown") {
    throw new Error("learned_influence_subject_facet_invalid");
  }
  if (input.subjectFacet === "unknown" && input.influenceClass !== "I0") {
    throw new Error("learned_influence_unknown_subject_facet");
  }
  if (!["memory_evidence", "identity", "mind_state", "thought", "agency"].includes(input.semanticOwner)) {
    throw new Error("learned_influence_semantic_owner_invalid");
  }
  const semanticOwnerRef = requireText(input.semanticOwnerRef, "semantic_owner_ref", 500);
  if (input.lineageKind !== "explicit_seed" &&
      input.lineageKind !== "owner_designated" &&
      input.lineageKind !== "ashley_native") {
    throw new Error("learned_influence_lineage_invalid");
  }
  if (input.lineageKind === "explicit_seed") {
    const candidate = input as LearnedInfluenceCandidateInput & { identityEntryId?: number };
    const identityEntryId = Number(candidate.identityEntryId ?? 0);
    const seeded = Number.isSafeInteger(identityEntryId) && identityEntryId > 0
      ? db.prepare(
         `SELECT 1 FROM identity_seed_lineage
         WHERE owner_id = ? AND identity_entry_id = ?
           AND disposition IN ('retained', 'independently_reinterpreted')`,
      ).get(ownerId, identityEntryId)
      : undefined;
    if (!seeded) throw new Error("learned_influence_inherited_lineage_requires_seed");
  }
  if (input.influenceClass !== "I0" && input.influenceClass !== "I1" &&
      input.influenceClass !== "I2" && input.influenceClass !== "I3") {
    throw new Error("learned_influence_class_invalid");
  }
  const requestedMode: LearnedAutonomyMode = input.capabilityMode ?? "observe";
  if (requestedMode === "apply") throw new Error("learned_influence_live_apply_not_authorized");
  const mode = requestedMode === "dark_apply" ? requestedMode : "observe";
  const textValue = requireText(input.text, "text", 1000);
  const evidence = normalizeEvidence(db, { ...input, ownerId }, now);
  return { mode, evidence, text: textValue, semanticOwnerRef };
}

function candidateContentHash(
  input: LearnedInfluenceCandidateInput,
  evidence: ReturnType<typeof normalizeEvidence>,
): string {
  return hash(JSON.stringify({
    ownerId: input.ownerId.trim(),
    kind: input.kind,
    subjectFacet: input.subjectFacet,
    semanticOwner: input.semanticOwner,
    semanticOwnerRef: input.semanticOwnerRef.trim(),
    lineageKind: input.lineageKind,
    influenceClass: input.influenceClass,
    text: input.text.trim(),
    evidence: evidence.rows.map((item) => [
      item.input.evidenceType,
      item.assertionId,
      item.input.observedAt,
    ]),
  }));
}

export function admitLearnedCandidate(
  db: DatabaseSync,
  input: LearnedInfluenceCandidateInput,
  now = new Date(),
): LearnedInfluence {
  const nowIso = now.toISOString();
  const checked = validateCandidate(db, input, nowIso);
  const contentHash = candidateContentHash(input, checked.evidence);
  const existing = db.prepare(
    `SELECT * FROM learned_influences
     WHERE owner_id = ? AND content_hash = ? LIMIT 1`,
  ).get(input.ownerId.trim(), contentHash);
  const existingMapped = mapInfluence(existing);
  if (existingMapped) return existingMapped;

  let transactionOpen = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const result = db.prepare(
      `INSERT INTO learned_influences
         (entity_uuid, owner_id, kind, subject_facet, semantic_owner,
          semantic_owner_ref, lineage_kind, influence_class, text, content_hash,
          proposal_lifecycle, adjudication_state, adjudicator,
          adjudication_decision_id, qualified_at, contradiction_state,
          contradiction_reason, demoted_at, provenance, capability_mode_at_write,
          data_classification, classification_source, classification_invalidated_at,
          created_at, updated_at)
       VALUES (?, ?, 'interest', ?, ?, ?, ?, ?, ?, ?,
           'proposed', 'pending', NULL, NULL, NULL, 'none', NULL, NULL,
           ?, ?, ?, 'derived_most_restrictive', NULL, ?, ?)` ,
    ).run(
      newEntityUuid(),
      input.ownerId.trim(),
      input.subjectFacet,
      input.semanticOwner,
      checked.semanticOwnerRef,
      input.lineageKind,
      input.influenceClass,
      checked.text,
      contentHash,
      checked.mode === "dark_apply" ? "live" : "shadow",
      checked.mode,
      checked.evidence.dataClassification,
      nowIso,
      nowIso,
    );
    const id = Number(result.lastInsertRowid);
    const insertEvidence = db.prepare(
      `INSERT INTO learned_influence_evidence
         (entity_uuid, learned_influence_id, owner_id, evidence_type,
          evidence_id, assertion_id, observed_at, provenance,
          data_classification, source_content_hash, created_at)
       VALUES (?, ?, ?, 'assertion', ?, ?, ?, 'live', ?, ?, ?)` ,
    );
    for (const item of checked.evidence.rows) {
      insertEvidence.run(
        newEntityUuid(),
        id,
        item.ownerId,
        item.input.evidenceId,
        item.assertionId,
        item.input.observedAt,
        item.dataClassification,
        item.input.sourceContentHash ?? null,
        nowIso,
      );
    }
    db.exec("COMMIT");
    transactionOpen = false;
    const learned = rowForInfluence(db, id);
    if (!learned) throw new Error("learned_influence_insert_readback_failed");
    return learned;
  } catch (error) {
    if (transactionOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original admission error */
      }
    }
    throw error;
  }
}

function evidenceForInfluence(
  db: DatabaseSync,
  learnedId: number,
): LearnedInfluenceEvidence[] {
  return db.prepare(
    `SELECT * FROM learned_influence_evidence
     WHERE learned_influence_id = ? ORDER BY observed_at ASC, id ASC`,
  ).all(learnedId)
    .map(mapEvidence)
    .filter((item): item is LearnedInfluenceEvidence => item !== null);
}

export function acceptLearnedInfluence(
  db: DatabaseSync,
  learnedId: number,
  input: {
    adjudicator: LearnedAdjudicator;
    adjudicationDecisionId: string | number;
    capabilityMode: LearnedAutonomyMode;
  },
  now = new Date(),
): LearnedInfluence {
  assertC3ContractCompatible(db);
  if (input.adjudicator !== "thought" && input.adjudicator !== "natural_owner") {
    throw new Error("learned_influence_adjudicator_invalid");
  }
  const decisionId = requireText(input.adjudicationDecisionId, "adjudication_decision_id", 256);
  if (input.capabilityMode === "apply") {
    throw new Error("learned_influence_live_apply_not_authorized");
  }
  if (input.capabilityMode !== "dark_apply") {
    throw new Error("learned_influence_dark_apply_required");
  }
  const existing = rowForInfluence(db, learnedId);
  if (!existing) throw new Error("learned_influence_not_found");
  if (existing.contradictionState !== "none") {
    throw new Error("learned_influence_not_eligible_for_acceptance");
  }
  const evidence = evidenceForInfluence(db, learnedId);
  if (evidence.length < 2 || evidence.some((item) => item.provenance !== "live")) {
    throw new Error("learned_influence_live_evidence_required");
  }
  if (evidence.some((item) => !influenceEligibleAt(db, item.assertionId, now.toISOString()))) {
    throw new Error("learned_influence_evidence_not_current");
  }
  const updatedAt = now.toISOString();
  db.prepare(
    `UPDATE learned_influences
     SET proposal_lifecycle = 'admitted_to_review', adjudication_state = 'accepted',
         adjudicator = ?, adjudication_decision_id = ?, qualified_at = ?,
         provenance = 'live', capability_mode_at_write = 'dark_apply',
         updated_at = ?
     WHERE id = ? AND contradiction_state = 'none'`,
  ).run(input.adjudicator, decisionId, updatedAt, updatedAt, learnedId);
  const accepted = rowForInfluence(db, learnedId);
  if (!accepted) throw new Error("learned_influence_acceptance_readback_failed");
  return accepted;
}

export function demoteLearnedInfluence(
  db: DatabaseSync,
  learnedId: number,
  reason: string,
  now = new Date(),
): LearnedInfluence {
  assertC3ContractCompatible(db);
  const cleanReason = requireText(reason, "demotion_reason", 1000);
  const existing = rowForInfluence(db, learnedId);
  if (!existing) throw new Error("learned_influence_not_found");
  db.prepare(
    `UPDATE learned_influences
     SET contradiction_state = 'demoted', contradiction_reason = ?,
         demoted_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(cleanReason, now.toISOString(), now.toISOString(), learnedId);
  const demoted = rowForInfluence(db, learnedId);
  if (!demoted) throw new Error("learned_influence_demotion_readback_failed");
  return demoted;
}

export function recordIdentitySeedLineage(
  db: DatabaseSync,
  input: IdentitySeedLineageInput,
  now = new Date(),
): number {
  assertC3ContractCompatible(db);
  const ownerId = requireText(input.ownerId, "owner_id", 256);
  if (!Number.isSafeInteger(input.identityEntryId) || input.identityEntryId <= 0) {
    throw new Error("learned_influence_identity_entry_required");
  }
  if (input.disposition !== "retained" &&
      input.disposition !== "independently_reinterpreted" &&
      input.disposition !== "rejected") {
    throw new Error("learned_influence_seed_disposition_invalid");
  }
  if (input.seedSource !== "explicit_seed" &&
      input.seedSource !== "owner_designated" &&
      input.seedSource !== "historical" && input.seedSource !== "historical_source") {
    throw new Error("learned_influence_seed_source_invalid");
  }
  const identity = db.prepare(
    `SELECT 1 FROM identity_entries WHERE id = ? AND owner_id = ?`,
  ).get(input.identityEntryId, ownerId);
  if (!identity) throw new Error("learned_influence_identity_entry_missing");
  db.prepare(
    `INSERT INTO identity_seed_lineage
       (entity_uuid, owner_id, identity_entry_id, disposition, seed_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, identity_entry_id) DO UPDATE SET
       disposition = excluded.disposition, seed_source = excluded.seed_source`,
  ).run(
    newEntityUuid(),
    ownerId,
    input.identityEntryId,
    input.disposition,
    input.seedSource,
    now.toISOString(),
  );
  const row = db.prepare(
    `SELECT id FROM identity_seed_lineage
     WHERE owner_id = ? AND identity_entry_id = ?`,
  ).get(ownerId, input.identityEntryId) as { id?: number } | undefined;
  return Number(row?.id ?? 0);
}

/** Exposed for diagnostics and eligibility without exposing source text. */
export function listLearnedInfluenceEvidence(
  db: DatabaseSync,
  learnedId: number,
): LearnedInfluenceEvidence[] {
  assertC3ContractCompatible(db);
  return evidenceForInfluence(db, learnedId);
}

export function classificationRank(value: DataClassification): number {
  return CLASSIFICATION_RANK[value];
}
