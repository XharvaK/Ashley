import type { DatabaseSync } from "node:sqlite";
import {
  assignNewEntityUuid,
} from "../continuity/nuclear-targetable.js";
import {
  capabilityCanExecuteShadow,
  capabilityCanInfluence,
  capabilityCanInfluenceReadOnly,
  capabilityNames,
  capabilityShadowDependenciesReady,
  currentBuildIdentity,
  currentContractId,
  type CapabilityName,
} from "../rollout/capabilities.js";
import {
  currentModelContinuityIdentity,
  modelContinuityIdentity,
} from "../attention/continuity.js";
import type { AcceptedDispatchIdentity } from "../attention/types.js";
import {
  continuityGeneration as buildContinuityGeneration,
  durableSemanticKeyHash,
  semanticIdentityHash,
} from "./identity.js";
import { activeWithdrawal } from "../relationship/repair.js";
import {
  maxClassification,
  type DataClassification,
} from "../privacy/classification.js";

export const OPEN_COGNITIVE_ITEM_KINDS = [
  "question",
  "revisit",
  "concern",
] as const;

export const OPEN_COGNITIVE_ITEM_STATUSES = [
  "OPEN",
  "RESOLVED",
  "WITHDRAWN",
  "SUPERSEDED",
] as const;

export const OPEN_COGNITIVE_ITEM_DELAY_CLASSES = [
  "none",
  "brief",
  "standard",
  "long",
  "reflection_review",
] as const;

export type OpenCognitiveItemKind = (typeof OPEN_COGNITIVE_ITEM_KINDS)[number];
export type OpenCognitiveItemStatus =
  (typeof OPEN_COGNITIVE_ITEM_STATUSES)[number];
export type OpenCognitiveItemDelayClass =
  (typeof OPEN_COGNITIVE_ITEM_DELAY_CLASSES)[number];
export type OpenCognitiveItemProvenance = "shadow" | "live";

export type OpenCognitiveItemAttention = {
  delayClass: OpenCognitiveItemDelayClass | null;
  deferUntil: string | null;
  lastConsideredAt: string | null;
  considerationCount: number;
  lastOutcomeCode: string | null;
  reviewRequestedAt: string | null;
  reviewAttemptCount: number;
  reviewLastDisposition: string | null;
  updatedAt: string;
};

export type OpenCognitiveItemRecord = {
  id: number;
  ownerId: string;
  entityUuid: string;
  kind: OpenCognitiveItemKind;
  status: OpenCognitiveItemStatus;
  semanticSummary: string;
  sourceType: string;
  sourceId: string;
  sourceEntityUuid: string;
  semanticKeyHash: string;
  semanticIdentityHash: string;
  continuityGeneration: string;
  generationOrder: number;
  sourceCapability: string;
  contractId: string;
  provenance: OpenCognitiveItemProvenance;
  sourceRevision: string;
  origin: "cognition" | "reflection" | "runtime" | "manual";
  buildIdentity: string;
  modelEpoch: number;
  modelIdentity: string;
  dataClassification: "ordinary" | "sensitive" | "never_public" | "secret";
  statusReason: string;
  redactedAt: string | null;
  redactionCode: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  attention: OpenCognitiveItemAttention | null;
};

type ItemRow = {
  id: number;
  owner_id: string;
  entity_uuid: string;
  kind: OpenCognitiveItemKind;
  status: OpenCognitiveItemStatus;
  semantic_summary: string;
  source_type: string;
  source_id: string;
  source_entity_uuid: string;
  semantic_key_hash: string;
  semantic_identity_hash: string;
  continuity_generation: string;
  generation_order: number;
  source_capability: string;
  contract_id: string;
  provenance: OpenCognitiveItemProvenance;
  source_revision: string;
  origin: OpenCognitiveItemRecord["origin"];
  build_identity: string;
  model_epoch: number;
  model_identity: string;
  data_classification: OpenCognitiveItemRecord["dataClassification"];
  status_reason: string;
  redacted_at: string | null;
  redaction_code: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  attention_item_id: number | null;
  delay_class: OpenCognitiveItemDelayClass | null;
  defer_until: string | null;
  last_considered_at: string | null;
  consideration_count: number | null;
  last_outcome_code: string | null;
  review_requested_at: string | null;
  review_attempt_count: number | null;
  review_last_disposition: string | null;
  attention_updated_at: string | null;
};

function mapItem(row: ItemRow): OpenCognitiveItemRecord {
  return {
    id: Number(row.id),
    ownerId: row.owner_id,
    entityUuid: row.entity_uuid,
    kind: row.kind,
    status: row.status,
    semanticSummary: row.semantic_summary,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceEntityUuid: row.source_entity_uuid,
    semanticKeyHash: row.semantic_key_hash,
    semanticIdentityHash: row.semantic_identity_hash ?? "",
    continuityGeneration: row.continuity_generation ?? "",
    generationOrder: Number(row.generation_order ?? 0),
    sourceCapability: row.source_capability,
    contractId: row.contract_id,
    provenance: row.provenance,
    sourceRevision: row.source_revision,
    origin: row.origin,
    buildIdentity: row.build_identity,
    modelEpoch: Number(row.model_epoch),
    modelIdentity: row.model_identity ?? "",
    dataClassification: row.data_classification,
    statusReason: row.status_reason,
    redactedAt: row.redacted_at ?? null,
    redactionCode: row.redaction_code ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null,
    attention:
      row.attention_item_id == null
        ? null
        : {
            delayClass: row.delay_class,
            deferUntil: row.defer_until ?? null,
            lastConsideredAt: row.last_considered_at ?? null,
            considerationCount: Number(row.consideration_count ?? 0),
            lastOutcomeCode: row.last_outcome_code ?? null,
            reviewRequestedAt: row.review_requested_at ?? null,
            reviewAttemptCount: Number(row.review_attempt_count ?? 0),
            reviewLastDisposition: row.review_last_disposition ?? null,
            updatedAt: row.attention_updated_at ?? row.updated_at,
          },
  };
}

export function listOpenCognitiveItems(
  db: DatabaseSync,
  ownerId: string,
  options: {
    status?: OpenCognitiveItemStatus;
    entityUuid?: string;
    limit?: number;
    afterId?: number;
    beforeId?: number;
    availableAt?: string;
    reviewRequested?: boolean;
    order?: "updated_desc" | "id_asc" | "id_desc";
  } = {},
): OpenCognitiveItemRecord[] {
  const clauses = ["o.owner_id = ?"];
  const params: Array<string | number> = [ownerId];
  if (options.status != null) {
    clauses.push("o.status = ?");
    params.push(options.status);
  }
  if (options.entityUuid != null) {
    clauses.push("o.entity_uuid = ?");
    params.push(options.entityUuid);
  }
  if (options.afterId != null && Number.isSafeInteger(options.afterId)) {
    clauses.push("o.id > ?");
    params.push(Math.max(0, options.afterId));
  }
  if (options.beforeId != null && Number.isSafeInteger(options.beforeId)) {
    clauses.push("o.id < ?");
    params.push(Math.max(0, options.beforeId));
  }
  if (options.availableAt != null) {
    clauses.push("(a.defer_until IS NULL OR a.defer_until <= ?)");
    params.push(options.availableAt);
  }
  if (options.reviewRequested === true) {
    clauses.push("a.review_requested_at IS NOT NULL");
  }
  const limit = options.limit == null || !Number.isFinite(options.limit)
    ? null
    : Math.max(1, Math.min(256, Math.floor(options.limit)));
  const limitClause = limit == null ? "" : " LIMIT ?";
  if (limit != null) params.push(limit);
  const orderClause = options.order === "id_asc"
    ? "ORDER BY o.id ASC"
    : options.order === "id_desc"
      ? "ORDER BY o.id DESC"
    : "ORDER BY o.updated_at DESC, o.id DESC";
  const rows = db
    .prepare(
      `SELECT
         o.id, o.owner_id, o.entity_uuid, o.kind, o.status,
         o.semantic_summary, o.source_type, o.source_id,
         o.source_entity_uuid, o.semantic_key_hash,
         o.semantic_identity_hash, o.continuity_generation,
         o.generation_order,
         o.source_capability,
         o.contract_id, o.provenance, o.source_revision, o.origin,
         o.build_identity, o.model_epoch, o.model_identity,
         o.data_classification,
         o.status_reason, o.redacted_at, o.redaction_code,
         o.created_at, o.updated_at, o.resolved_at,
         a.item_id AS attention_item_id, a.delay_class, a.defer_until,
         a.last_considered_at, a.consideration_count, a.last_outcome_code,
         a.review_requested_at, a.review_attempt_count,
         a.review_last_disposition, a.updated_at AS attention_updated_at
       FROM open_cognitive_items o
       LEFT JOIN open_cognitive_item_attention a ON a.item_id = o.id
       WHERE ${clauses.join(" AND ")}
       ${orderClause}${limitClause}`,
    )
    .all(...params) as unknown as ItemRow[];
  return rows.map(mapItem);
}

export function getOpenCognitiveItem(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
): OpenCognitiveItemRecord | null {
  return listOpenCognitiveItems(db, ownerId, { entityUuid })[0] ?? null;
}

export type OpenCognitiveItemProposal = {
  ownerId: string;
  kind: OpenCognitiveItemKind;
  semanticSummary: string;
  source: {
    type: string;
    id: string;
    entityUuid: string;
  };
  origin: OpenCognitiveItemRecord["origin"];
  /**
   * Compatibility-only input. Host code deliberately ignores this value when
   * deriving durable identity.
   */
  semanticKeyMaterial?: string;
  provenance: OpenCognitiveItemProvenance;
  sourceCapability: string;
  contractId: string;
  buildIdentity: string;
  modelEpoch: number;
  modelIdentity?: string;
  dispatchIdentity?: AcceptedDispatchIdentity;
  sourceRevision?: string;
  dataClassification?: DataClassification;
};

export type MaterializeOpenCognitiveItemResult = {
  item: OpenCognitiveItemRecord;
  created: boolean;
};

type SourceSpec = {
  table: string;
};

const SOURCE_SPECS: Record<string, SourceSpec> = {
  message: { table: "mem_messages" },
  mem_message: { table: "mem_messages" },
  question: { table: "questions" },
  questions: { table: "questions" },
  fact: { table: "mem_facts" },
  opinion: { table: "opinions" },
  episode: { table: "episodes" },
  mind_state: { table: "mind_state_items" },
  doc_reminder: { table: "doc_reminders" },
  ashley_self_commitment: { table: "ashley_self_commitments" },
  mutual_commitment: { table: "mutual_commitments" },
  relational_tension: { table: "relational_tensions" },
};

const TERMINAL_SOURCE_STATUSES = new Set([
  "forgotten",
  "redacted",
  "released",
  "cancelled",
  "resolved",
  "fulfilled",
  "superseded",
]);

function rejectMaterialization(code: string): never {
  throw new Error(code);
}

function boundedText(
  value: unknown,
  maxLength: number,
  errorCode: string,
): string {
  if (typeof value !== "string") rejectMaterialization(errorCode);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxLength) {
    rejectMaterialization(errorCode);
  }
  return normalized;
}

function optionalBoundedText(value: unknown, maxLength: number): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") rejectMaterialization("oci_source_revision_invalid");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    rejectMaterialization("oci_source_revision_invalid");
  }
  return normalized;
}

function sourceId(value: unknown): string {
  const normalized = boundedText(value, 32, "oci_source_id_invalid");
  if (!/^\d+$/.test(normalized)) {
    rejectMaterialization("oci_source_id_invalid");
  }
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    rejectMaterialization("oci_source_id_invalid");
  }
  return String(numeric);
}

function isClassification(value: unknown): value is DataClassification {
  return (
    value === "ordinary" ||
    value === "sensitive" ||
    value === "never_public" ||
    value === "secret"
  );
}

function isKind(value: unknown): value is OpenCognitiveItemKind {
  return (OPEN_COGNITIVE_ITEM_KINDS as readonly string[]).includes(
    String(value),
  );
}

function isProvenance(value: unknown): value is OpenCognitiveItemProvenance {
  return value === "shadow" || value === "live";
}

function isOrigin(value: unknown): value is OpenCognitiveItemRecord["origin"] {
  return (
    value === "cognition" ||
    value === "reflection" ||
    value === "runtime" ||
    value === "manual"
  );
}

function sourceRowFor(
  db: DatabaseSync,
  ownerId: string,
  sourceType: string,
  id: string,
): Record<string, unknown> {
  const spec = SOURCE_SPECS[sourceType];
  if (!spec) rejectMaterialization("oci_source_type_unsupported");
  const row = db
    .prepare(
      "SELECT * FROM " +
        spec.table +
        " WHERE id = ? AND owner_id = ?",
    )
    .get(Number(id), ownerId) as Record<string, unknown> | undefined;
  if (!row) rejectMaterialization("oci_source_missing_or_owner_mismatch");
  return row;
}

function validateSourceState(
  row: Record<string, unknown>,
  sourceEntityUuid: string,
  provenance: OpenCognitiveItemProvenance,
  sourceType?: string,
): DataClassification {
  if (String(row.entity_uuid ?? "") !== sourceEntityUuid) {
    rejectMaterialization("oci_source_entity_mismatch");
  }
  const status = typeof row.status === "string" ? row.status.toLowerCase() : "";
  if (TERMINAL_SOURCE_STATUSES.has(status)) {
    rejectMaterialization("oci_source_unavailable");
  }
  if (sourceType && !sourceLifecycleAllows(sourceType, status)) {
    rejectMaterialization("oci_source_unavailable");
  }
  if (row.superseded_by != null) {
    rejectMaterialization("oci_source_unavailable");
  }
  if (row.redacted_at != null) {
    rejectMaterialization("oci_source_unavailable");
  }
  if (
    (row.provenance === "shadow" || row.provenance === "live") &&
    row.provenance !== provenance
  ) {
    rejectMaterialization("oci_provenance_mismatch");
  }
  const classification = isClassification(row.data_classification)
    ? row.data_classification
    : "never_public";
  if (classification === "secret") {
    rejectMaterialization("oci_source_secret");
  }
  return classification;
}

function sourceLifecycleAllows(sourceType: string, status: string): boolean {
  switch (sourceType) {
    case "question":
    case "questions":
      return status === "open" || status === "pursuing";
    case "episode":
    case "mind_state":
      return status === "active";
    case "doc_reminder":
      return status === "pending" || status === "due";
    case "ashley_self_commitment":
    case "mutual_commitment":
      return status === "active";
    case "relational_tension":
      return status === "open";
    default:
      return true;
  }
}

function currentSourceRevision(row: Record<string, unknown>): string {
  for (const key of ["source_revision", "revision", "updated_at", "created_at"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\s+/g, " ");
    }
  }
  return "";
}

function authoritativeSourceRevision(row: Record<string, unknown>): string {
  return optionalBoundedText(currentSourceRevision(row), 128);
}

function modelAliasFromIdentity(modelIdentity: string): string | null {
  const prefix = "model-continuity-v1:";
  if (!modelIdentity.startsWith(prefix)) return null;
  const separator = modelIdentity.indexOf("|", prefix.length);
  if (separator <= prefix.length) return null;
  const alias = modelIdentity.slice(prefix.length, separator).trim();
  return alias || null;
}

function currentModelForCognitionItem(
  db: DatabaseSync,
  modelIdentity: string,
) {
  const alias = modelAliasFromIdentity(modelIdentity);
  return alias ? currentModelContinuityIdentity(db, alias) : null;
}

function validateCapability(
  db: DatabaseSync,
  proposal: OpenCognitiveItemProposal,
): CapabilityName {
  const sourceCapability = boundedText(
    proposal.sourceCapability,
    128,
    "oci_source_capability_invalid",
  );
  if (
    !(capabilityNames as readonly string[]).includes(sourceCapability)
  ) {
    rejectMaterialization("oci_source_capability_unknown");
  }
  const capability = sourceCapability as CapabilityName;
  if (proposal.origin !== "cognition") {
    if (proposal.contractId.trim() !== currentContractId()) {
      rejectMaterialization("oci_contract_mismatch");
    }
    if (proposal.buildIdentity.trim() !== currentBuildIdentity()) {
      rejectMaterialization("oci_build_mismatch");
    }
  }
  if (
    !Number.isInteger(proposal.modelEpoch) ||
    proposal.modelEpoch < 0
  ) {
    rejectMaterialization("oci_model_epoch_invalid");
  }
  if (proposal.provenance === "shadow") {
    if (
      !capabilityCanExecuteShadow(db, capability) ||
      !capabilityShadowDependenciesReady(db, capability)
    ) {
      rejectMaterialization("oci_source_capability_shadow_unavailable");
    }
  } else if (!capabilityCanInfluence(db, capability, "apply")) {
    rejectMaterialization("oci_source_capability_not_live");
  }
  return capability;
}

function validateAcceptedDispatchIdentity(
  db: DatabaseSync,
  ownerId: string,
  identity: AcceptedDispatchIdentity | undefined,
  modelIdentity: string,
  modelEpoch: number,
  contractId: string,
  buildIdentity: string,
): void {
  if (!identity) rejectMaterialization("oci_dispatch_identity_missing");
  if (
    !Number.isSafeInteger(identity.requestId) ||
    identity.requestId <= 0 ||
    !Number.isSafeInteger(identity.dispatchSequence) ||
    identity.dispatchSequence <= 0 ||
    !Number.isInteger(identity.modelEpoch) ||
    identity.modelEpoch <= 0
  ) {
    rejectMaterialization("oci_dispatch_identity_invalid");
  }
  if (identity.ownerId !== ownerId) {
    rejectMaterialization("oci_dispatch_owner_mismatch");
  }
  const row = db
    .prepare(
      `SELECT owner_id, cognitive_job_id, route_alias, model_alias,
              resolved_model_id, model_epoch, dispatch_sequence, state, outcome,
              accepted_contract_id, accepted_build_identity
       FROM attention_requests WHERE id = ?`,
    )
    .get(identity.requestId) as
    | {
        owner_id?: string;
        cognitive_job_id?: number | null;
        route_alias?: string | null;
        model_alias?: string;
        resolved_model_id?: string | null;
        model_epoch?: number | null;
        dispatch_sequence?: number | null;
        state?: string;
        outcome?: string | null;
        accepted_contract_id?: string | null;
        accepted_build_identity?: string | null;
      }
    | undefined;
  if (!row || row.owner_id !== ownerId) {
    rejectMaterialization("oci_dispatch_owner_mismatch");
  }
  if (row.state !== "terminal" || row.outcome !== "completed") {
    rejectMaterialization("oci_dispatch_not_completed");
  }
  if (
    row.model_alias !== identity.modelAlias ||
    (row.route_alias ?? null) !== identity.routeAlias ||
    Number(row.dispatch_sequence ?? 0) !== identity.dispatchSequence ||
    Number(row.model_epoch ?? 0) !== identity.modelEpoch ||
    (row.resolved_model_id ?? null) !== identity.resolvedModelId
  ) {
    rejectMaterialization("oci_dispatch_identity_mismatch");
  }
  if (
    identity.cognitiveJobId == null ||
    Number(row.cognitive_job_id ?? 0) !== identity.cognitiveJobId
  ) {
    rejectMaterialization("oci_dispatch_job_mismatch");
  }
  if (
    identity.contractId.trim() === "" ||
    identity.buildIdentity.trim() === "" ||
    identity.contractId !== contractId ||
    identity.buildIdentity !== buildIdentity ||
    row.accepted_contract_id !== identity.contractId ||
    row.accepted_build_identity !== identity.buildIdentity
  ) {
    rejectMaterialization("oci_dispatch_provenance_mismatch");
  }
  if (
    modelContinuityIdentity(identity.modelAlias, identity.resolvedModelId) !==
      identity.modelIdentity ||
    identity.modelIdentity !== modelIdentity ||
    identity.modelEpoch !== modelEpoch
  ) {
    rejectMaterialization("oci_dispatch_provenance_mismatch");
  }
}

function validateProposal(
  db: DatabaseSync,
  proposal: OpenCognitiveItemProposal,
): {
  ownerId: string;
  kind: OpenCognitiveItemKind;
  semanticSummary: string;
  sourceType: string;
  sourceId: string;
  sourceEntityUuid: string;
  semanticKeyHash: string;
  semanticIdentityHash: string;
  continuityGeneration: string;
  generationOrder: number;
  sourceCapability: CapabilityName;
  contractId: string;
  provenance: OpenCognitiveItemProvenance;
  sourceRevision: string;
  origin: OpenCognitiveItemRecord["origin"];
  buildIdentity: string;
  modelEpoch: number;
  modelIdentity: string;
  dataClassification: DataClassification;
} {
  const ownerId = boundedText(proposal.ownerId, 128, "oci_owner_invalid");
  if (!isKind(proposal.kind)) rejectMaterialization("oci_kind_invalid");
  const kind = proposal.kind;
  if (!isProvenance(proposal.provenance)) {
    rejectMaterialization("oci_provenance_invalid");
  }
  if (!isOrigin(proposal.origin)) {
    rejectMaterialization("oci_origin_invalid");
  }
  const origin = proposal.origin;
  if (
    origin === "cognition" &&
    proposal.dispatchIdentity != null &&
    proposal.dispatchIdentity.ownerId !== ownerId
  ) {
    rejectMaterialization("oci_dispatch_owner_mismatch");
  }
  const semanticSummary = boundedText(
    proposal.semanticSummary,
    512,
    "oci_summary_invalid",
  );
  const sourceType = boundedText(
    proposal.source.type,
    64,
    "oci_source_type_invalid",
  ).toLowerCase();
  if (!SOURCE_SPECS[sourceType]) {
    rejectMaterialization("oci_source_type_unsupported");
  }
  const sourceIdValue = sourceId(proposal.source.id);
  const sourceEntityUuid = boundedText(
    proposal.source.entityUuid,
    128,
    "oci_source_entity_invalid",
  );
  const sourceRow = sourceRowFor(
    db,
    ownerId,
    sourceType,
    sourceIdValue,
  );
  const sourceClassification = validateSourceState(
    sourceRow,
    sourceEntityUuid,
    proposal.provenance,
    sourceType,
  );
  const proposalClassification = proposal.dataClassification ?? sourceClassification;
  if (!isClassification(proposalClassification)) {
    rejectMaterialization("oci_classification_invalid");
  }
  const dataClassification = maxClassification(
    sourceClassification,
    proposalClassification,
  );
  if (dataClassification === "secret") {
    rejectMaterialization("oci_classification_secret");
  }
  const sourceCapability = validateCapability(db, proposal);
  const sourceRevision = authoritativeSourceRevision(sourceRow);
  const modelIdentity =
    proposal.modelIdentity == null || proposal.modelIdentity === ""
      ? ""
      : boundedText(
          proposal.modelIdentity,
          256,
          "oci_model_identity_invalid",
        );
  if (!Number.isInteger(proposal.modelEpoch) || proposal.modelEpoch < 0) {
    rejectMaterialization("oci_model_epoch_invalid");
  }
  if (origin === "cognition") {
    const currentModel = currentModelForCognitionItem(db, modelIdentity);
    if (currentModel == null || currentModel.alias.trim() === "") {
      rejectMaterialization("oci_model_continuity_unavailable");
    }
    validateAcceptedDispatchIdentity(
      db,
      ownerId,
      proposal.dispatchIdentity,
      modelIdentity,
      proposal.modelEpoch,
      proposal.contractId.trim(),
      proposal.buildIdentity.trim(),
    );
  } else if (modelIdentity !== "" || proposal.modelEpoch !== 0) {
    rejectMaterialization("oci_model_continuity_unexpected");
  }
  const semanticIdentity = semanticIdentityHash({
    ownerId,
    sourceType,
    sourceId: sourceIdValue,
    sourceEntityUuid,
    kind,
    semanticSummary,
    sourceRevision,
  });
  const continuity = buildContinuityGeneration({
    contractId: proposal.contractId.trim(),
    buildIdentity: proposal.buildIdentity.trim(),
    modelIdentity,
    modelEpoch: proposal.modelEpoch,
  });
  const semanticKeyHash = durableSemanticKeyHash({
    semanticIdentityHash: semanticIdentity,
    continuityGeneration: continuity,
  });
  return {
    ownerId,
    kind,
    semanticSummary,
    sourceType,
    sourceId: sourceIdValue,
    sourceEntityUuid,
    semanticKeyHash,
    semanticIdentityHash: semanticIdentity,
    continuityGeneration: continuity,
    generationOrder:
      origin === "cognition"
        ? proposal.dispatchIdentity!.dispatchSequence
        : 0,
    sourceCapability,
    contractId: proposal.contractId.trim(),
    provenance: proposal.provenance,
    sourceRevision,
    origin,
    buildIdentity: proposal.buildIdentity.trim(),
    modelEpoch: proposal.modelEpoch,
    modelIdentity,
    dataClassification,
  };
}

type ExistingIdentityRow = {
  id: number;
  semantic_summary: string;
  source_type: string;
  source_id: string;
  source_entity_uuid: string;
  kind: string;
  source_revision: string;
  semantic_identity_hash: string;
  continuity_generation: string;
  generation_order: number;
  source_capability: string;
  contract_id: string;
  provenance: string;
  origin: string;
  build_identity: string;
  model_epoch: number;
  model_identity: string;
  data_classification: string;
};

type ContinuityGenerationDecision = {
  generationOrder: number;
  knownGeneration: boolean;
  staleArrival: boolean;
};

function decideContinuityGenerationOrder(
  db: DatabaseSync,
  validated: ReturnType<typeof validateProposal>,
): ContinuityGenerationDecision {
  const known = db
    .prepare(
      `SELECT generation_order
       FROM open_cognitive_items
       WHERE owner_id = ? AND semantic_identity_hash = ?
         AND continuity_generation = ?
       LIMIT 1`,
    )
    .get(
      validated.ownerId,
      validated.semanticIdentityHash,
      validated.continuityGeneration,
    ) as { generation_order?: number } | undefined;
  if (known) {
    return {
      generationOrder: Math.max(0, Number(known.generation_order ?? 0)),
      knownGeneration: true,
      staleArrival: false,
    };
  }

  const maximum = db
    .prepare(
      `SELECT COALESCE(MAX(generation_order), 0) AS generation_order
       FROM open_cognitive_items
       WHERE owner_id = ? AND semantic_identity_hash = ?`,
    )
    .get(validated.ownerId, validated.semanticIdentityHash) as {
      generation_order?: number;
    } | undefined;
  const maximumOrder = Math.max(0, Number(maximum?.generation_order ?? 0));
  const dispatchCounter = db
    .prepare(`SELECT next_seq FROM attention_dispatch_counter WHERE id = 1`)
    .get() as { next_seq?: number } | undefined;
  const maximumAcceptedDispatchOrder = Math.max(
    0,
    Number(dispatchCounter?.next_seq ?? 1) - 1,
  );
  const generationOrder = validated.origin === "cognition"
    ? validated.generationOrder
    : Math.max(maximumOrder, maximumAcceptedDispatchOrder) + 1;
  if (!Number.isSafeInteger(generationOrder) || generationOrder <= 0) {
    rejectMaterialization("oci_generation_order_invalid");
  }
  if (generationOrder === maximumOrder && maximumOrder > 0) {
    rejectMaterialization("oci_generation_order_conflict");
  }
  return {
    generationOrder,
    knownGeneration: false,
    staleArrival: generationOrder < maximumOrder,
  };
}

function supersedeStaleSourceRevisions(
  db: DatabaseSync,
  validated: ReturnType<typeof validateProposal>,
  nowIso: string,
): void {
  const staleRows = db
    .prepare(
      `SELECT id
       FROM open_cognitive_items
       WHERE owner_id = ? AND source_type = ? AND source_id = ?
         AND source_entity_uuid = ? AND kind = ? AND status = 'OPEN'
         AND source_revision <> ?
       ORDER BY id ASC`,
    )
    .all(
      validated.ownerId,
      validated.sourceType,
      validated.sourceId,
      validated.sourceEntityUuid,
      validated.kind,
      validated.sourceRevision,
    ) as Array<{ id: number }>;

  for (const row of staleRows) {
    const update = db
      .prepare(
        `UPDATE open_cognitive_items
         SET status = 'SUPERSEDED', status_reason = 'source_revision_superseded',
             updated_at = ?
         WHERE id = ? AND owner_id = ? AND status = 'OPEN'`,
      )
      .run(nowIso, row.id, validated.ownerId);
    if (Number(update.changes) !== 1) continue;
    db.prepare(
      `INSERT OR IGNORE INTO open_cognitive_item_attention
         (item_id, delay_class, defer_until, last_considered_at,
          consideration_count, last_outcome_code, review_requested_at, updated_at)
       VALUES (?, 'none', NULL, NULL, 0, NULL, NULL, ?)`,
    ).run(row.id, nowIso);
    db.prepare(
      `UPDATE open_cognitive_item_attention
       SET delay_class = 'none', defer_until = NULL,
           last_outcome_code = 'transition:supersede',
           review_requested_at = NULL, updated_at = ?
       WHERE item_id = ?`,
    ).run(nowIso, row.id);
    db.prepare(
      `INSERT INTO open_cognitive_item_transitions
         (item_id, owner_id, from_status, to_status, reason, created_at)
       VALUES (?, ?, 'OPEN', 'SUPERSEDED', 'source_revision_superseded', ?)`,
    ).run(row.id, validated.ownerId, nowIso);
  }
}

function supersedeStaleContinuityGenerations(
  db: DatabaseSync,
  validated: ReturnType<typeof validateProposal>,
  generationOrder: number,
  nowIso: string,
): void {
  const staleRows = db
    .prepare(
      `SELECT id
       FROM open_cognitive_items
       WHERE owner_id = ? AND semantic_identity_hash = ?
          AND continuity_generation <> ? AND status = 'OPEN'
          AND generation_order < ?
       ORDER BY id ASC`,
    )
    .all(
      validated.ownerId,
      validated.semanticIdentityHash,
      validated.continuityGeneration,
      generationOrder,
    ) as Array<{ id: number }>;

  for (const row of staleRows) {
    const update = db
      .prepare(
        `UPDATE open_cognitive_items
         SET status = 'SUPERSEDED', status_reason = 'continuity_generation_superseded',
             updated_at = ?
         WHERE id = ? AND owner_id = ? AND status = 'OPEN'`,
      )
      .run(nowIso, row.id, validated.ownerId);
    if (Number(update.changes) !== 1) continue;
    db.prepare(
      `INSERT OR IGNORE INTO open_cognitive_item_attention
         (item_id, delay_class, defer_until, last_considered_at,
          consideration_count, last_outcome_code, review_requested_at, updated_at)
       VALUES (?, 'none', NULL, NULL, 0, NULL, NULL, ?)`,
    ).run(row.id, nowIso);
    db.prepare(
      `UPDATE open_cognitive_item_attention
       SET delay_class = 'none', defer_until = NULL,
           last_outcome_code = 'transition:supersede',
           review_requested_at = NULL, updated_at = ?
       WHERE item_id = ?`,
    ).run(nowIso, row.id);
    db.prepare(
      `INSERT INTO open_cognitive_item_transitions
         (item_id, owner_id, from_status, to_status, reason, created_at)
       VALUES (?, ?, 'OPEN', 'SUPERSEDED', 'continuity_generation_superseded', ?)`,
    ).run(row.id, validated.ownerId, nowIso);
  }
}

export function materializeOpenCognitiveItem(
  db: DatabaseSync,
  proposal: OpenCognitiveItemProposal,
  options: { inTransaction?: boolean } = {},
): MaterializeOpenCognitiveItemResult {
  const ownsTransaction = options.inTransaction !== true;
  if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    const validated = validateProposal(db, proposal);
    const createdAt = new Date().toISOString();
    supersedeStaleSourceRevisions(db, validated, createdAt);
    const generation = decideContinuityGenerationOrder(db, validated);
    if (!generation.knownGeneration && !generation.staleArrival) {
      supersedeStaleContinuityGenerations(
        db,
        validated,
        generation.generationOrder,
        createdAt,
      );
    }
    const initialStatus: OpenCognitiveItemStatus = generation.staleArrival
      ? "SUPERSEDED"
      : "OPEN";
    const initialReason = generation.staleArrival
      ? "stale_continuity_generation"
      : "created";
    const insert = db.prepare(
      `INSERT INTO open_cognitive_items
         (owner_id, entity_uuid, kind, status, semantic_summary,
          source_type, source_id, source_entity_uuid, semantic_key_hash,
          semantic_identity_hash, continuity_generation, generation_order,
          source_capability, contract_id, provenance, source_revision, origin,
          build_identity, model_epoch, model_identity, data_classification, status_reason,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, semantic_key_hash) DO NOTHING`,
    );
    const result = insert.run(
      validated.ownerId,
      assignNewEntityUuid(),
      validated.kind,
      initialStatus,
      validated.semanticSummary,
      validated.sourceType,
      validated.sourceId,
      validated.sourceEntityUuid,
      validated.semanticKeyHash,
      validated.semanticIdentityHash,
      validated.continuityGeneration,
      generation.generationOrder,
      validated.sourceCapability,
      validated.contractId,
      validated.provenance,
      validated.sourceRevision,
      validated.origin,
      validated.buildIdentity,
      validated.modelEpoch,
      validated.modelIdentity,
      validated.dataClassification,
      initialReason,
      createdAt,
      createdAt,
    );
    const created = Number(result.changes) === 1;
    const existing = db
      .prepare(
         `SELECT id, source_entity_uuid, kind
                , semantic_summary, source_type, source_id, source_revision,
            semantic_identity_hash, continuity_generation, generation_order,
           source_capability, contract_id, provenance, origin, build_identity,
           model_epoch, model_identity, data_classification
         FROM open_cognitive_items
         WHERE owner_id = ? AND semantic_key_hash = ?`,
      )
      .get(validated.ownerId, validated.semanticKeyHash) as
      | (Partial<ExistingIdentityRow> & { id?: number })
      | undefined;
    if (!existing?.id) {
      rejectMaterialization("oci_materialization_missing_after_insert");
    }
    const identityMatches =
      existing.semantic_summary === validated.semanticSummary &&
      existing.source_type === validated.sourceType &&
      existing.source_id === validated.sourceId &&
      existing.source_entity_uuid === validated.sourceEntityUuid &&
      existing.kind === validated.kind &&
      existing.source_revision === validated.sourceRevision &&
      existing.semantic_identity_hash === validated.semanticIdentityHash &&
      existing.continuity_generation === validated.continuityGeneration &&
      Number(existing.generation_order) === generation.generationOrder &&
      existing.source_capability === validated.sourceCapability &&
      existing.contract_id === validated.contractId &&
      existing.provenance === validated.provenance &&
      existing.origin === validated.origin &&
      existing.build_identity === validated.buildIdentity &&
      Number(existing.model_epoch) === validated.modelEpoch &&
      existing.model_identity === validated.modelIdentity &&
      existing.data_classification === validated.dataClassification;
    if (!identityMatches) {
      rejectMaterialization("oci_idempotency_conflict");
    }
    db.prepare(
      `INSERT OR IGNORE INTO open_cognitive_item_attention
         (item_id, delay_class, defer_until, last_considered_at,
          consideration_count, last_outcome_code, review_requested_at, updated_at)
       VALUES (?, 'none', NULL, NULL, 0, NULL, NULL, ?)`,
    ).run(existing.id, createdAt);
    if (created) {
      db.prepare(
        `INSERT INTO open_cognitive_item_transitions
           (item_id, owner_id, from_status, to_status, reason, created_at)
         VALUES (?, ?, NULL, ?, ?, ?)`,
      ).run(
        existing.id,
        validated.ownerId,
        initialStatus,
        initialReason,
        createdAt,
      );
    }
    if (ownsTransaction) db.exec("COMMIT");
    const entityRow = db
      .prepare(
        `SELECT entity_uuid FROM open_cognitive_items WHERE id = ?`,
      )
      .get(existing.id) as { entity_uuid?: string } | undefined;
    if (!entityRow?.entity_uuid) {
      rejectMaterialization("oci_materialization_readback_failed");
    }
    const item = getOpenCognitiveItem(
      db,
      validated.ownerId,
      entityRow.entity_uuid,
    );
    if (!item) rejectMaterialization("oci_materialization_readback_failed");
    return { item, created };
  } catch (error) {
    if (ownsTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original materialization failure */
      }
    }
    throw error;
  }
}

/** Read-only source authority check used by behavior and owner diagnostics. */
export function openCognitiveItemSourceCurrent(
  db: DatabaseSync,
  item: OpenCognitiveItemRecord,
): boolean {
  if (item.status !== "OPEN" || item.provenance !== "live") return false;
  if (item.contractId !== currentContractId()) return false;
  if (item.buildIdentity !== currentBuildIdentity()) return false;

  if (!(capabilityNames as readonly string[]).includes(item.sourceCapability)) {
    return false;
  }
  const capability = item.sourceCapability as CapabilityName;
  if (item.origin === "cognition") {
    const currentModel = currentModelForCognitionItem(db, item.modelIdentity);
    if (
      currentModel == null ||
      currentModel.identity == null ||
      item.modelIdentity !== currentModel.identity ||
      item.modelEpoch !== currentModel.modelEpoch
    ) {
      return false;
    }
  } else if (item.modelIdentity !== "" || item.modelEpoch !== 0) {
    return false;
  }

  try {
    const sourceRow = sourceRowFor(
      db,
      item.ownerId,
      item.sourceType,
      item.sourceId,
    );
    validateSourceState(
      sourceRow,
      item.sourceEntityUuid,
      "live",
      item.sourceType,
    );
    if (
      item.sourceRevision !== "" &&
      authoritativeSourceRevision(sourceRow) !== item.sourceRevision
    ) {
      return false;
    }
    if (
      item.sourceRevision === "" &&
      authoritativeSourceRevision(sourceRow) !== ""
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Revalidate an OPEN live item's source and capability authority.
 * The source remains authoritative; this row is never sufficient by itself.
 * This deliberately excludes attention deferral so validated resolution and
 * Reflection review can inspect a deferred item without making it a candidate.
 */
export function openCognitiveItemSourceEligibleForInfluence(
  db: DatabaseSync,
  item: OpenCognitiveItemRecord,
): boolean {
  if (!openCognitiveItemSourceCurrent(db, item)) return false;
  const capability = item.sourceCapability as CapabilityName;
  return capabilityCanInfluence(db, capability, "apply") &&
    relationshipSourceGateOpen(db, item);
}

/**
 * Revalidate an OPEN live item before projecting it into behavioral candidates.
 * Deferral is attention metadata and is checked after source authority.
 */
export function openCognitiveItemEligibleForInfluence(
  db: DatabaseSync,
  item: OpenCognitiveItemRecord,
  now = Date.now(),
): boolean {
  if (!openCognitiveItemSourceEligibleForInfluence(db, item)) return false;
  if (!relationshipSourceGateOpen(db, item)) return false;
  const deferUntil = item.attention?.deferUntil;
  if (deferUntil == null) return true;
  const deferUntilMs = Date.parse(deferUntil);
  return Number.isFinite(deferUntilMs) && deferUntilMs <= now;
}

function relationshipSourceGateOpen(
  db: DatabaseSync,
  item: OpenCognitiveItemRecord,
): boolean {
  if (
    item.sourceType !== "ashley_self_commitment" &&
    item.sourceType !== "mutual_commitment" &&
    item.sourceType !== "relational_tension"
  ) {
    return true;
  }
  const withdrawal = activeWithdrawal(db, item.ownerId);
  if (!withdrawal) return true;
  return (
    item.sourceType === "relational_tension" &&
    String(withdrawal.repair_status ?? "") === "eligible"
  );
}

export type OpenCognitiveContinuityStatus = {
  totalCount: number;
  openCount: number;
  deferredCount: number;
  redactedCount: number;
  reviewDueCount: number;
  availableBySourceClass: Record<string, number>;
  unavailableByReason: Record<string, number>;
};

export const OPEN_COGNITIVE_REVIEW_DUE_COUNT_SQL = `
  SELECT COUNT(*) AS count FROM (
    SELECT a.item_id
    FROM (
      SELECT o.id
      FROM open_cognitive_items o INDEXED BY idx_open_cognitive_items_owner_status_id
      WHERE o.owner_id = ? AND o.status = 'OPEN'
      ORDER BY o.id ASC
      LIMIT 32
    ) raw
    JOIN open_cognitive_item_attention a ON a.item_id = raw.id
    WHERE /* REVIEW_VISIT */ a.review_requested_at IS NOT NULL
      AND (julianday(a.review_requested_at) IS NULL OR a.review_requested_at <= ?)
    LIMIT 9
  )`;

/** Indexed wake-path check for the existing Reflection review signal. */
export function countOpenCognitiveItemReviewDue(
  db: DatabaseSync,
  ownerId: string,
  now = new Date(),
): number {
  const row = db
    .prepare(OPEN_COGNITIVE_REVIEW_DUE_COUNT_SQL)
    .get(ownerId, now.toISOString()) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function sourceClass(sourceType: string): string {
  if (sourceType === "message" || sourceType === "mem_message") return "message";
  if (sourceType === "episode") return "episode";
  if (sourceType === "question" || sourceType === "questions") return "question";
  if (sourceType === "fact") return "fact";
  if (sourceType === "opinion") return "opinion";
  if (
    sourceType === "doc_reminder" ||
    sourceType === "ashley_self_commitment" ||
    sourceType === "mutual_commitment" ||
    sourceType === "relational_tension"
  ) {
    return "relationship";
  }
  if (sourceType === "mind_state") return "mind_state";
  return "other";
}

function itemDeferred(item: OpenCognitiveItemRecord, nowMs: number): boolean {
  const deferUntil = item.attention?.deferUntil;
  if (deferUntil == null) return false;
  const deferUntilMs = Date.parse(deferUntil);
  return !Number.isFinite(deferUntilMs) || deferUntilMs > nowMs;
}

function itemUnavailableReason(
  db: DatabaseSync,
  item: OpenCognitiveItemRecord,
  nowMs: number,
): string | null {
  if (itemDeferred(item, nowMs)) return "deferred";
  if (item.provenance !== "live") return "shadow";
  if (
    !capabilityCanInfluenceReadOnly(
      db,
      item.sourceCapability as CapabilityName,
      "apply",
    )
  ) {
    return "capability_blocked";
  }
  if (!openCognitiveItemSourceCurrent(db, item)) return "source_unavailable";
  if (!relationshipSourceGateOpen(db, item)) return "relationship_withdrawn";
  return null;
}

/**
 * Read-only, owner-scoped observability for the existing initiative status.
 * It returns counts and broad source classes only. It does not expose OCI
 * summaries and does not call capability helpers that bootstrap release rows.
 */
export function getOpenCognitiveContinuityStatus(
  db: DatabaseSync,
  ownerId: string,
  now = new Date(),
): OpenCognitiveContinuityStatus {
  const items = listOpenCognitiveItems(db, ownerId);
  const nowMs = now.getTime();
  const openItems = items.filter((item) => item.status === "OPEN");
  const availableBySourceClass: Record<string, number> = {};
  const unavailableByReason: Record<string, number> = {};
  for (const item of openItems) {
    const reason = itemUnavailableReason(db, item, nowMs);
    if (reason != null) {
      unavailableByReason[reason] = (unavailableByReason[reason] ?? 0) + 1;
    } else {
      const key = sourceClass(item.sourceType);
      availableBySourceClass[key] = (availableBySourceClass[key] ?? 0) + 1;
    }
  }
  return {
    totalCount: items.length,
    openCount: openItems.length,
    deferredCount: openItems.filter((item) => itemDeferred(item, nowMs)).length,
    redactedCount: items.filter((item) => item.redactedAt !== null).length,
    reviewDueCount: openItems.filter(
      (item) => item.attention?.reviewRequestedAt != null,
    ).length,
    availableBySourceClass,
    unavailableByReason,
  };
}
