import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import type { DataClassification } from "../privacy/classification.js";
import {
  assertC5ContractCompatible,
  normalizeC5WriteMode,
  provenanceForC5Mode,
} from "./c5-contract-state.js";
import type {
  C5Mode,
  ConsentEventKind,
  ConsentGrantorRole,
} from "./types.js";

/** Stable, narrow consent scope for private C5 relationship projections. */
export const RELATIONSHIP_CONSENT_SCOPE = "private_relationship_projection";
const LEGACY_RELATIONSHIP_CONSENT_SCOPE = "relationship_projection";

export type ConsentRecord = {
  id: number;
  entityUuid: string;
  ownerId: string;
  grantorIdentityRole: ConsentGrantorRole;
  granteeOrConsumer: string;
  scope: string;
  purpose: string;
  evidenceOrDecisionRef: string;
  classification: DataClassification;
  grantedAt: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  expiresAt: string | null;
  eventKind: ConsentEventKind;
  supersedesConsentId: number | null;
  createdAt: string;
};

export type ConsentRecordInput = {
  ownerId: string;
  grantorIdentityRole: ConsentGrantorRole;
  granteeOrConsumer: string;
  scope: string;
  purpose: string;
  evidenceOrDecisionRef: string;
  classification: DataClassification;
  eventKind: ConsentEventKind;
  supersedesConsentId?: number | null;
  grantedAt?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  expiresAt?: string | null;
  capabilityMode?: C5Mode;
  mode?: C5Mode;
};

function stringRequired(value: string | undefined, code: string, max: number): string {
  const clean = value?.trim() ?? "";
  if (!clean) throw new Error(code);
  return clean.slice(0, max);
}

function rowToConsent(row: unknown): ConsentRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const source = row as Record<string, unknown>;
  const role = String(source.grantor_identity_role ?? "");
  const eventKind = String(source.event_kind ?? "");
  if (!(["doc", "ashley"] as string[]).includes(role)) return null;
  if (!(["grant", "revoke", "expire", "supersede"] as string[]).includes(eventKind)) return null;
  return {
    id: Number(source.id ?? 0),
    entityUuid: String(source.entity_uuid ?? ""),
    ownerId: String(source.owner_id ?? ""),
    grantorIdentityRole: role as ConsentGrantorRole,
    granteeOrConsumer: String(source.grantee_or_consumer ?? ""),
    scope: String(source.scope ?? ""),
    purpose: String(source.purpose ?? ""),
    evidenceOrDecisionRef: String(source.evidence_or_decision_ref ?? ""),
    classification: String(source.classification ?? "never_public") as DataClassification,
    grantedAt: String(source.granted_at ?? ""),
    effectiveFrom: String(source.effective_from ?? ""),
    effectiveTo: source.effective_to == null ? null : String(source.effective_to),
    expiresAt: source.expires_at == null ? null : String(source.expires_at),
    eventKind: eventKind as ConsentEventKind,
    supersedesConsentId: source.supersedes_consent_id == null
      ? null
      : Number(source.supersedes_consent_id),
    createdAt: String(source.created_at ?? ""),
  };
}

function supersededByEvent(
  db: DatabaseSync,
  recordId: number,
  at: string,
): boolean {
  const events = db.prepare(
    `SELECT id, event_kind, supersedes_consent_id, effective_from
     FROM consent_records WHERE effective_from <= ? ORDER BY id ASC`,
  ).all(at) as Array<Record<string, unknown>>;
  const invalidating = new Set<number>();
  for (const event of events) {
    const id = Number(event.id ?? 0);
    const supersedes = event.supersedes_consent_id == null
      ? null
      : Number(event.supersedes_consent_id);
    if (supersedes !== null && (supersedes === recordId || invalidating.has(supersedes))) {
      if (["revoke", "expire", "supersede"].includes(String(event.event_kind))) {
        invalidating.add(id);
        invalidating.add(recordId);
      }
    }
  }
  return invalidating.has(recordId);
}

/** Record explicit consent events. Silence, time, engagement, and delivery are never consent. */
export function recordConsentEvent(
  db: DatabaseSync,
  input: ConsentRecordInput,
): ConsentRecord {
  assertC5ContractCompatible(db);
  const mode = normalizeC5WriteMode(
    db,
    input.capabilityMode ?? input.mode ?? "observe",
  );
  const grantor = input.grantorIdentityRole;
  if (grantor !== "doc" && grantor !== "ashley") {
    throw new Error("consent_grantor_invalid");
  }
  const eventKind = input.eventKind;
  if (!["grant", "revoke", "expire", "supersede"].includes(eventKind)) {
    throw new Error("consent_event_kind_invalid");
  }
  const supersedesId = input.supersedesConsentId ?? null;
  if (eventKind !== "grant" && supersedesId == null) {
    throw new Error("consent_superseded_record_required");
  }
  if (supersedesId != null) {
    const previous = rowToConsent(db.prepare(
      `SELECT * FROM consent_records WHERE id = ?`,
    ).get(supersedesId));
    if (!previous || previous.ownerId !== input.ownerId ||
        previous.grantorIdentityRole !== grantor ||
        previous.granteeOrConsumer !== input.granteeOrConsumer.trim() ||
        previous.scope !== input.scope.trim() || previous.purpose !== input.purpose.trim()) {
      throw new Error("consent_superseded_record_mismatch");
    }
  }
  const now = new Date().toISOString();
  const grantedAt = input.grantedAt ?? now;
  const effectiveFrom = input.effectiveFrom ?? grantedAt;
  const effectiveTo = input.effectiveTo ?? null;
  const expiresAt = input.expiresAt ?? null;
  if (effectiveTo !== null && effectiveFrom >= effectiveTo) {
    throw new Error("consent_effective_interval_invalid");
  }
  if (expiresAt !== null && effectiveFrom > expiresAt) {
    throw new Error("consent_expiry_invalid");
  }
  const result = db.prepare(
    `INSERT INTO consent_records
       (entity_uuid, owner_id, grantor_identity_role, grantee_or_consumer,
        scope, purpose, evidence_or_decision_ref, classification, granted_at,
        effective_from, effective_to, expires_at, event_kind,
        supersedes_consent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assignNewEntityUuid(),
    input.ownerId,
    grantor,
    stringRequired(input.granteeOrConsumer, "consent_grantee_required", 200),
    stringRequired(input.scope, "consent_scope_required", 200),
    stringRequired(input.purpose, "consent_purpose_required", 500),
    stringRequired(input.evidenceOrDecisionRef, "consent_evidence_required", 300),
    input.classification,
    grantedAt,
    effectiveFrom,
    effectiveTo,
    expiresAt,
    eventKind,
    supersedesId,
    now,
  );
  const record = rowToConsent(db.prepare(
    `SELECT * FROM consent_records WHERE id = ?`,
  ).get(Number(result.lastInsertRowid)));
  if (!record) throw new Error("consent_record_write_unreadable");
  // Keep the write-mode decision explicit in the API while preserving the
  // append-only event shape. It is intentionally not a stored authority flag.
  void provenanceForC5Mode(mode);
  return record;
}

export function getConsentRecord(db: DatabaseSync, id: number): ConsentRecord | null {
  assertC5ContractCompatible(db);
  return rowToConsent(db.prepare(
    `SELECT * FROM consent_records WHERE id = ?`,
  ).get(id));
}

export function consentCurrentlyEligible(
  db: DatabaseSync,
  recordOrId: ConsentRecord | number,
  options: { at?: Date; mode?: C5Mode; capabilityMode?: C5Mode } = {},
): boolean {
  assertC5ContractCompatible(db);
  const record = typeof recordOrId === "number"
    ? getConsentRecord(db, recordOrId)
    : recordOrId;
  if (!record || record.eventKind !== "grant") return false;
  const at = (options.at ?? new Date()).toISOString();
  if (record.effectiveFrom > at || (record.effectiveTo !== null && at >= record.effectiveTo)) {
    return false;
  }
  if (record.expiresAt !== null && at >= record.expiresAt) return false;
  if (supersededByEvent(db, record.id, at)) return false;
  return true;
}

export const isConsentCurrentlyEligible = consentCurrentlyEligible;

function isRelationshipConsentScope(scope: string): boolean {
  const normalized = scope.trim().toLowerCase();
  return normalized === RELATIONSHIP_CONSENT_SCOPE ||
    normalized === LEGACY_RELATIONSHIP_CONSENT_SCOPE;
}

/**
 * C5 mutual state requires two separately current grants. One party cannot
 * infer the other party's consent from silence, delivery, or engagement.
 */
export function bilateralRelationshipConsentEligible(
  db: DatabaseSync,
  ownerId: string,
  at = new Date(),
): boolean {
  const current = listCurrentConsent(db, ownerId, { at });
  const hasDocGrant = current.some((record) =>
    record.grantorIdentityRole === "doc" &&
    record.granteeOrConsumer.trim().toLowerCase() === "ashley" &&
    isRelationshipConsentScope(record.scope),
  );
  const hasAshleyGrant = current.some((record) =>
    record.grantorIdentityRole === "ashley" &&
    record.granteeOrConsumer.trim().toLowerCase() === "doc" &&
    isRelationshipConsentScope(record.scope),
  );
  return hasDocGrant && hasAshleyGrant;
}

export const relationshipConsentEligible = bilateralRelationshipConsentEligible;

export function listCurrentConsent(
  db: DatabaseSync,
  ownerId: string,
  options: { at?: Date; grantorIdentityRole?: ConsentGrantorRole } = {},
): ConsentRecord[] {
  assertC5ContractCompatible(db);
  const at = options.at ?? new Date();
  const rows = db.prepare(
    `SELECT * FROM consent_records
     WHERE owner_id = ? AND event_kind = 'grant'
       AND effective_from <= ?
     ORDER BY id ASC`,
  ).all(ownerId, at.toISOString())
    .map(rowToConsent)
    .filter((row): row is ConsentRecord => row !== null);
  return rows.filter((row) =>
    (!options.grantorIdentityRole || row.grantorIdentityRole === options.grantorIdentityRole) &&
    consentCurrentlyEligible(db, row, { at }),
  );
}
