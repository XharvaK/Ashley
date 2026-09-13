import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import {
  defaultUnclassifiedConversational,
  type DataClassification,
} from "../privacy/classification.js";

export type AssertionKind =
  | "keyed_fact"
  | "episode_claim"
  | "owner_interpretation";
export type SubjectFacet =
  | "owner_model"
  | "external_verifiable"
  | "ashley_side"
  | "unknown";
export type LineageKind =
  | "unknown"
  | "explicit_seed"
  | "owner_designated"
  | "observed_overlap"
  | "ashley_native";
export type DerivationKind = "observed" | "derived";
export type SupportState = "supported" | "unsupported" | "uncertain";
export type InfluenceClass = "I0" | "I1" | "I2" | "I3";
export type WorldIntervalBasis = "adjudicated" | "legacy_unknown";
export type AuthorityBasis =
  | "adjudicated"
  | "legacy_supersession"
  | "legacy_current";
export type TerminationReason =
  | "superseded"
  | "invalidated"
  | "forgotten"
  | "scope_refined"
  | "source_disputed";

export type MemoryAssertion = {
  id: number;
  entityUuid: string;
  ownerId: string;
  kind: AssertionKind;
  subjectFacet: SubjectFacet;
  lineageKind: LineageKind;
  derivationKind: DerivationKind;
  supportState: SupportState;
  influenceClass: InfluenceClass;
  category: string | null;
  key: string | null;
  value: string | null;
  claimText: string | null;
  sourceKind: string;
  sourceEntityUuid: string | null;
  sourceMessageId: number | null;
  sourceQuote: string | null;
  legacyFactId: number | null;
  legacyEpisodeId: number | null;
  recordedAt: string;
  validFrom: string | null;
  validTo: string | null;
  worldIntervalBasis: WorldIntervalBasis;
  authorityFrom: string | null;
  authorityTo: string | null;
  authorityBasis: AuthorityBasis;
  terminationReason: TerminationReason | null;
  supersededByAssertionId: number | null;
  confidence: number;
  importance: number;
  dataClassification: DataClassification;
  createdAt: string;
  updatedAt: string;
};

export type InsertAssertionInput = {
  ownerId: string;
  kind: AssertionKind;
  subjectFacet: SubjectFacet;
  lineageKind: LineageKind;
  derivationKind: DerivationKind;
  supportState: SupportState;
  influenceClass: InfluenceClass;
  category?: string | null;
  key?: string | null;
  value?: string | null;
  claimText?: string | null;
  sourceKind: string;
  sourceEntityUuid?: string | null;
  sourceMessageId?: number | null;
  sourceQuote?: string | null;
  legacyFactId?: number | null;
  legacyEpisodeId?: number | null;
  recordedAt?: string;
  validFrom?: string | null;
  validTo?: string | null;
  worldIntervalBasis?: WorldIntervalBasis;
  authorityFrom?: string | null;
  authorityTo?: string | null;
  authorityBasis?: AuthorityBasis;
  terminationReason?: TerminationReason | null;
  supersededByAssertionId?: number | null;
  confidence?: number;
  importance?: number;
  dataClassification?: DataClassification;
  entityUuid?: string;
  createdAt?: string;
  updatedAt?: string;
};

type DbRow = Record<string, unknown>;

const CATEGORIES = new Set([
  "project",
  "preference",
  "person",
  "ongoing",
  "pinned",
]);
const DATA_CLASSIFICATIONS = new Set<DataClassification>([
  "ordinary",
  "sensitive",
  "never_public",
  "secret",
]);

function row(value: unknown): DbRow | null {
  return typeof value === "object" && value !== null ? value as DbRow : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value);
}

function requireNonEmpty(value: string | null | undefined, name: string): string {
  const clean = value?.trim() ?? "";
  if (!clean) throw new Error(`memory_assertion_${name}_required`);
  return clean;
}

function assertValidInput(input: InsertAssertionInput): void {
  requireNonEmpty(input.ownerId, "owner_id");
  requireNonEmpty(input.sourceKind, "source_kind");
  if (input.influenceClass === ("I4" as InfluenceClass)) {
    throw new Error("memory_assertion_influence_class_refused:I4");
  }
  if (!["I0", "I1", "I2", "I3"].includes(input.influenceClass)) {
    throw new Error("memory_assertion_influence_class_invalid");
  }
  if (input.kind === "keyed_fact") {
    requireNonEmpty(input.category, "category");
    if (!CATEGORIES.has(input.category!.trim())) {
      throw new Error("memory_assertion_category_invalid");
    }
    requireNonEmpty(input.key, "key");
    requireNonEmpty(input.value, "value");
  } else {
    requireNonEmpty(input.claimText, "claim_text");
  }
  if (
    input.subjectFacet === "owner_model" &&
    input.derivationKind === "derived" &&
    (input.influenceClass === "I2" || input.influenceClass === "I3")
  ) {
    throw new Error("memory_assertion_unconfirmed_derived_owner_model");
  }
  if (input.validFrom != null && input.validTo != null && input.validFrom >= input.validTo) {
    throw new Error("memory_assertion_world_interval_invalid");
  }
  if (input.authorityFrom != null && input.authorityTo != null && input.authorityFrom >= input.authorityTo) {
    throw new Error("memory_assertion_authority_interval_invalid");
  }
  if (input.dataClassification && !DATA_CLASSIFICATIONS.has(input.dataClassification)) {
    throw new Error("memory_assertion_classification_invalid");
  }
}

function mapAssertion(value: unknown): MemoryAssertion | null {
  const source = row(value);
  if (!source) return null;
  const kind = stringValue(source.kind);
  const subjectFacet = stringValue(source.subject_facet);
  const lineageKind = stringValue(source.lineage_kind);
  const derivationKind = stringValue(source.derivation_kind);
  const supportState = stringValue(source.support_state);
  const influenceClass = stringValue(source.influence_class);
  const worldIntervalBasis = stringValue(source.world_interval_basis);
  const authorityBasis = stringValue(source.authority_basis);
  const terminationReason = source.termination_reason == null
    ? null
    : stringValue(source.termination_reason);
  if (
    !["keyed_fact", "episode_claim", "owner_interpretation"].includes(kind) ||
    !["owner_model", "external_verifiable", "ashley_side", "unknown"].includes(subjectFacet) ||
    !["unknown", "explicit_seed", "owner_designated", "observed_overlap", "ashley_native"].includes(lineageKind) ||
    !["observed", "derived"].includes(derivationKind) ||
    !["supported", "unsupported", "uncertain"].includes(supportState) ||
    !["I0", "I1", "I2", "I3"].includes(influenceClass) ||
    !["adjudicated", "legacy_unknown"].includes(worldIntervalBasis) ||
    !["adjudicated", "legacy_supersession", "legacy_current"].includes(authorityBasis) ||
    (terminationReason !== null && ![
      "superseded", "invalidated", "forgotten", "scope_refined", "source_disputed",
    ].includes(terminationReason))
  ) return null;
  const classification = stringValue(source.data_classification);
  if (!DATA_CLASSIFICATIONS.has(classification as DataClassification)) return null;
  return {
    id: numberValue(source.id),
    entityUuid: stringValue(source.entity_uuid),
    ownerId: stringValue(source.owner_id),
    kind: kind as AssertionKind,
    subjectFacet: subjectFacet as SubjectFacet,
    lineageKind: lineageKind as LineageKind,
    derivationKind: derivationKind as DerivationKind,
    supportState: supportState as SupportState,
    influenceClass: influenceClass as InfluenceClass,
    category: nullableString(source.category),
    key: nullableString(source.key),
    value: nullableString(source.value),
    claimText: nullableString(source.claim_text),
    sourceKind: stringValue(source.source_kind),
    sourceEntityUuid: nullableString(source.source_entity_uuid),
    sourceMessageId: nullableNumber(source.source_message_id),
    sourceQuote: nullableString(source.source_quote),
    legacyFactId: nullableNumber(source.legacy_fact_id),
    legacyEpisodeId: nullableNumber(source.legacy_episode_id),
    recordedAt: stringValue(source.recorded_at),
    validFrom: nullableString(source.valid_from),
    validTo: nullableString(source.valid_to),
    worldIntervalBasis: worldIntervalBasis as WorldIntervalBasis,
    authorityFrom: nullableString(source.authority_from),
    authorityTo: nullableString(source.authority_to),
    authorityBasis: authorityBasis as AuthorityBasis,
    terminationReason: terminationReason as TerminationReason | null,
    supersededByAssertionId: nullableNumber(source.superseded_by_assertion_id),
    confidence: numberValue(source.confidence),
    importance: numberValue(source.importance),
    dataClassification: classification as DataClassification,
    createdAt: stringValue(source.created_at),
    updatedAt: stringValue(source.updated_at),
  };
}

export function insertAssertion(
  db: DatabaseSync,
  input: InsertAssertionInput,
): number {
  assertValidInput(input);
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const createdAt = input.createdAt ?? recordedAt;
  const updatedAt = input.updatedAt ?? createdAt;
  const result = db.prepare(
    `INSERT INTO memory_assertions
       (entity_uuid, owner_id, kind, subject_facet, lineage_kind,
        derivation_kind, support_state, influence_class, category, key, value,
        claim_text, source_kind, source_entity_uuid, source_message_id,
        source_quote, legacy_fact_id, legacy_episode_id, recorded_at,
        valid_from, valid_to, world_interval_basis, authority_from,
        authority_to, authority_basis, termination_reason,
        superseded_by_assertion_id, confidence, importance, data_classification,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  ).run(
    input.entityUuid ?? newEntityUuid(),
    input.ownerId.trim(),
    input.kind,
    input.subjectFacet,
    input.lineageKind,
    input.derivationKind,
    input.supportState,
    input.influenceClass,
    input.category?.trim() ?? null,
    input.key?.trim() ?? null,
    input.value?.trim() ?? null,
    input.claimText ?? null,
    input.sourceKind.trim(),
    input.sourceEntityUuid ?? null,
    input.sourceMessageId ?? null,
    input.sourceQuote ?? null,
    input.legacyFactId ?? null,
    input.legacyEpisodeId ?? null,
    recordedAt,
    input.validFrom ?? null,
    input.validTo ?? null,
    input.worldIntervalBasis ?? "legacy_unknown",
    input.authorityFrom ?? null,
    input.authorityTo ?? null,
    input.authorityBasis ?? "adjudicated",
    input.terminationReason ?? null,
    input.supersededByAssertionId ?? null,
    Math.max(0, Math.min(1, input.confidence ?? 0)),
    Math.max(0, Math.min(100, Math.round(input.importance ?? 0))),
    input.dataClassification ?? defaultUnclassifiedConversational(),
    createdAt,
    updatedAt,
  );
  return Number(result.lastInsertRowid);
}

export function getAssertion(
  db: DatabaseSync,
  assertionId: number,
): MemoryAssertion | null {
  return mapAssertion(db.prepare(
    "SELECT * FROM memory_assertions WHERE id = ?",
  ).get(assertionId));
}

export function listAssertions(
  db: DatabaseSync,
  ownerId: string,
): MemoryAssertion[] {
  return db.prepare(
    `SELECT * FROM memory_assertions
     WHERE owner_id = ? ORDER BY id ASC`,
  ).all(ownerId)
    .map(mapAssertion)
    .filter((assertion): assertion is MemoryAssertion => assertion !== null);
}
