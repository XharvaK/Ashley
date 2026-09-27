import type { DatabaseSync } from "node:sqlite";
import { getConversationEvidence } from "./conversation-log.js";
import { resolveReceiptRef } from "../effect/in-flight.js";
import { resolveAttachmentJsonPath } from "../perception/attachments.js";
import {
  imageArtifactRepresentationId,
  observationViewFromStorage,
  pdfPageImageRepresentationId,
  pdfPageTextRepresentationId,
  textArtifactRepresentationId,
} from "../observation/view.js";

export type SourceSupportRegion = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type SourceSupportRef =
  | Readonly<{
      kind: "conversation_text_span";
      evidenceRowId: string;
      start: number;
      end: number;
      quote: string;
    }>
  | Readonly<{
      kind: "artifact_text_span";
      artifactId: string;
      representationId: string;
      start: number;
      end: number;
      quote: string;
    }>
  | Readonly<{
      kind: "document_page_region";
      artifactId: string;
      representationId: string;
      page: number;
      region?: SourceSupportRegion;
    }>
  | Readonly<{
      kind: "image_region";
      artifactId: string;
      representationId: string;
      region?: SourceSupportRegion;
    }>
  | Readonly<{
      kind: "structured_path";
      artifactId: string;
      representationId: string;
      path: string | Readonly<{ row: number; column: number }>;
    }>
  | Readonly<{ kind: "observation_ref"; observationId: string }>
  | Readonly<{ kind: "receipt_ref"; receiptId: string }>;

export type InterpretationAudience =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "owner_private" }>
  | Readonly<{ kind: "owner_dm"; threadId: string }>
  | Readonly<{ kind: "dm"; principalId: string }>
  | Readonly<{ kind: "room"; roomId: string }>;

export type WorkingContextInterpretationKind =
  | "directive_interpretation"
  | "descriptive_belief"
  | "self_conclusion"
  | "adoption";

export type InterpretationBoundaryBasis = Readonly<Record<
  string,
  "explicit_in_source" | "inferred" | "unknown"
>>;

export type ApplicabilityInterval =
  | Readonly<{ fromMs: number; untilMs: number }>
  | Readonly<{ until: "unknown" }>
  | Readonly<{ until: "standing" }>;

/** Cognition-authored portion of a new interpretation envelope. */
export type WorkingContextInterpretationDraft = Readonly<{
  kind: WorkingContextInterpretationKind;
  support: readonly SourceSupportRef[];
  audience: InterpretationAudience;
  applicability: Readonly<{
    subject: string;
    target: string;
    conversationId: string;
    concernId?: string | null;
  }>;
  boundaryBasis: InterpretationBoundaryBasis;
  applicabilityInterval: ApplicabilityInterval;
  conditions: Readonly<{ text: string; unresolved: boolean }>;
  derivationParents: readonly string[];
  revisionOf: string | null;
  revisionEvidenceRefs: readonly SourceSupportRef[];
}>;

export type InterpretationAttribution = Readonly<{
  principalKind: "owner" | "external_human" | "external_bot" | "ashley" | "observation" | "receipt" | "mixed" | "unknown";
  principalId: string | null;
}>;

export type InterpretationSupportUnavailableReason =
  | "source_redacted"
  | "source_forgotten"
  | "source_inaccessible";

/** Host-completed envelope stored beside the existing Working Context text. */
export type WorkingContextInterpretationEnvelope = WorkingContextInterpretationDraft & Readonly<{
  owningRecordId: string;
  revision: number;
  authoringCycleId: string;
  supportAvailability: "intact" | "unavailable";
  attribution: InterpretationAttribution;
  audience: InterpretationAudience;
  sourceTimeMs: number | null;
  interpretationTimeMs: number;
  applicabilityLifecycle: "current" | "needs_review" | "superseded" | "withdrawn";
  supportUnavailableReason?: InterpretationSupportUnavailableReason;
}>;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: RecordValue, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseRegion(value: unknown): SourceSupportRegion | null {
  if (!isRecord(value) || !exactKeys(value, ["x", "y", "width", "height"])) return null;
  if (![value.x, value.y, value.width, value.height].every((part) =>
    typeof part === "number" && Number.isFinite(part))) return null;
  if ((value.x as number) < 0 || (value.y as number) < 0
    || (value.width as number) <= 0 || (value.height as number) <= 0) return null;
  return { x: value.x as number, y: value.y as number, width: value.width as number, height: value.height as number };
}

/** Validate the complete modality union. Unsupported known kinds remain typed, then fail at admission. */
export function parseSourceSupportRef(value: unknown): SourceSupportRef | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "conversation_text_span":
      return exactKeys(value, ["kind", "evidenceRowId", "start", "end", "quote"])
        && nonEmptyText(value.evidenceRowId) && finiteInteger(value.start) && finiteInteger(value.end)
        && value.start >= 0 && value.end > value.start && typeof value.quote === "string" && value.quote.length > 0
        ? value as SourceSupportRef
        : null;
    case "artifact_text_span":
      return exactKeys(value, ["kind", "artifactId", "representationId", "start", "end", "quote"])
        && nonEmptyText(value.artifactId) && nonEmptyText(value.representationId)
        && finiteInteger(value.start) && finiteInteger(value.end) && value.start >= 0 && value.end > value.start
        && typeof value.quote === "string" && value.quote.length > 0
        ? value as SourceSupportRef
        : null;
    case "document_page_region": {
      if (!exactKeys(value, ["kind", "artifactId", "representationId", "page"], ["region"])
        || !nonEmptyText(value.artifactId) || !nonEmptyText(value.representationId)
        || !finiteInteger(value.page) || value.page < 1) return null;
      if (Object.prototype.hasOwnProperty.call(value, "region")) {
        const region = parseRegion(value.region);
        if (!region) return null;
        return { kind: value.kind, artifactId: value.artifactId, representationId: value.representationId, page: value.page, region };
      }
      return { kind: value.kind, artifactId: value.artifactId, representationId: value.representationId, page: value.page };
    }
    case "image_region": {
      if (!exactKeys(value, ["kind", "artifactId", "representationId"], ["region"])
        || !nonEmptyText(value.artifactId) || !nonEmptyText(value.representationId)) return null;
      if (Object.prototype.hasOwnProperty.call(value, "region")) {
        const region = parseRegion(value.region);
        if (!region) return null;
        return { kind: value.kind, artifactId: value.artifactId, representationId: value.representationId, region };
      }
      return { kind: value.kind, artifactId: value.artifactId, representationId: value.representationId };
    }
    case "structured_path": {
      if (!exactKeys(value, ["kind", "artifactId", "representationId", "path"])
        || !nonEmptyText(value.artifactId) || !nonEmptyText(value.representationId)) return null;
      if (typeof value.path === "string") {
        if (value.path !== "" && !value.path.startsWith("/")) return null;
        return value as SourceSupportRef;
      }
      if (!isRecord(value.path) || !exactKeys(value.path, ["row", "column"])
        || !finiteInteger(value.path.row) || !finiteInteger(value.path.column)
        || value.path.row < 0 || value.path.column < 0) return null;
      return value as SourceSupportRef;
    }
    case "observation_ref":
      return exactKeys(value, ["kind", "observationId"]) && nonEmptyText(value.observationId)
        ? value as SourceSupportRef
        : null;
    case "receipt_ref":
      return exactKeys(value, ["kind", "receiptId"]) && nonEmptyText(value.receiptId)
        ? value as SourceSupportRef
        : null;
    default:
      return null;
  }
}

function parseAudience(value: unknown): InterpretationAudience | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "unknown" || value.kind === "owner_private") {
    return exactKeys(value, ["kind"]) ? { kind: value.kind } : null;
  }
  if (value.kind === "owner_dm" && exactKeys(value, ["kind", "threadId"]) && nonEmptyText(value.threadId)) {
    return { kind: value.kind, threadId: value.threadId };
  }
  if (value.kind === "dm" && exactKeys(value, ["kind", "principalId"]) && nonEmptyText(value.principalId)) {
    return { kind: value.kind, principalId: value.principalId };
  }
  if (value.kind === "room" && exactKeys(value, ["kind", "roomId"]) && nonEmptyText(value.roomId)) {
    return { kind: value.kind, roomId: value.roomId };
  }
  return null;
}

function parseInterval(value: unknown): ApplicabilityInterval | null {
  if (!isRecord(value)) return null;
  if (value.until === "unknown" || value.until === "standing") {
    return exactKeys(value, ["until"]) ? { until: value.until } : null;
  }
  if (exactKeys(value, ["fromMs", "untilMs"]) && finiteInteger(value.fromMs) && finiteInteger(value.untilMs)
    && value.fromMs <= value.untilMs) {
    return { fromMs: value.fromMs, untilMs: value.untilMs };
  }
  return null;
}

function parseBoundaryBasis(value: unknown): InterpretationBoundaryBasis | null {
  if (!isRecord(value) || Object.keys(value).length === 0) return null;
  const parsed: Record<string, "explicit_in_source" | "inferred" | "unknown"> = {};
  for (const [boundary, basis] of Object.entries(value)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(boundary)
      || (basis !== "explicit_in_source" && basis !== "inferred" && basis !== "unknown")) return null;
    parsed[boundary] = basis;
  }
  return parsed;
}

export function parseWorkingContextInterpretationDraft(value: unknown): WorkingContextInterpretationDraft | null {
  if (!isRecord(value) || !exactKeys(value, [
    "kind", "support", "applicability", "boundaryBasis", "applicabilityInterval", "conditions",
    "derivationParents", "revisionOf", "revisionEvidenceRefs",
  ], ["audience"])) return null;
  if (value.kind !== "directive_interpretation" && value.kind !== "descriptive_belief"
    && value.kind !== "self_conclusion" && value.kind !== "adoption") return null;
  if (!Array.isArray(value.support) || !value.support.every((ref) => parseSourceSupportRef(ref) !== null)) return null;
  const audience = value.audience === undefined ? { kind: "unknown" as const } : parseAudience(value.audience);
  if (!audience) return null;
  const applicability = value.applicability;
  if (!isRecord(applicability) || !exactKeys(applicability,
    ["subject", "target", "conversationId"], ["concernId"])
    || !nonEmptyText(applicability.subject) || !nonEmptyText(applicability.target)
    || !nonEmptyText(applicability.conversationId)
    || (applicability.concernId !== undefined && applicability.concernId !== null && !nonEmptyText(applicability.concernId))) return null;
  const boundaryBasis = parseBoundaryBasis(value.boundaryBasis);
  const applicabilityInterval = parseInterval(value.applicabilityInterval);
  const conditions = value.conditions;
  if (!boundaryBasis || !applicabilityInterval || !isRecord(conditions)
    || !exactKeys(conditions, ["text", "unresolved"])
    || typeof conditions.text !== "string" || typeof conditions.unresolved !== "boolean") return null;
  if (!Array.isArray(value.derivationParents) || !value.derivationParents.every(nonEmptyText)
    || (value.revisionOf !== null && !nonEmptyText(value.revisionOf))
    || !Array.isArray(value.revisionEvidenceRefs)
    || !value.revisionEvidenceRefs.every((ref) => parseSourceSupportRef(ref) !== null)) return null;
  return {
    kind: value.kind,
    support: value.support.map((ref) => parseSourceSupportRef(ref)!),
    audience,
    applicability: {
      subject: applicability.subject,
      target: applicability.target,
      conversationId: applicability.conversationId,
      ...(applicability.concernId === undefined ? {} : { concernId: applicability.concernId as string | null }),
    },
    boundaryBasis,
    applicabilityInterval,
    conditions: { text: conditions.text, unresolved: conditions.unresolved },
    derivationParents: [...value.derivationParents],
    revisionOf: value.revisionOf,
    revisionEvidenceRefs: value.revisionEvidenceRefs.map((ref) => parseSourceSupportRef(ref)!),
  };
}

export function parseStoredWorkingContextInterpretationEnvelope(
  value: unknown,
  lifecycleValue: unknown,
): WorkingContextInterpretationEnvelope | null {
  if (!isRecord(value) || !exactKeys(value, [
    "kind", "support", "applicability", "boundaryBasis", "applicabilityInterval", "conditions",
    "derivationParents", "revisionOf", "revisionEvidenceRefs", "audience", "owningRecordId", "revision",
    "authoringCycleId", "supportAvailability", "attribution", "sourceTimeMs", "interpretationTimeMs",
    "applicabilityLifecycle",
  ], ["supportUnavailableReason"])) return null;
  const draft = parseWorkingContextInterpretationDraft({
    kind: value.kind,
    support: value.support,
    audience: value.audience,
    applicability: value.applicability,
    boundaryBasis: value.boundaryBasis,
    applicabilityInterval: value.applicabilityInterval,
    conditions: value.conditions,
    derivationParents: value.derivationParents,
    revisionOf: value.revisionOf,
    revisionEvidenceRefs: value.revisionEvidenceRefs,
  });
  const attribution = value.attribution;
  if (!draft || !nonEmptyText(value.owningRecordId) || !finiteInteger(value.revision) || value.revision < 0
    || !nonEmptyText(value.authoringCycleId)
    || (value.supportAvailability !== "intact" && value.supportAvailability !== "unavailable")
    || (value.supportAvailability === "unavailable"
      && value.supportUnavailableReason !== "source_redacted"
      && value.supportUnavailableReason !== "source_forgotten"
      && value.supportUnavailableReason !== "source_inaccessible")
    || (value.supportAvailability === "intact" && value.supportUnavailableReason !== undefined)
    || !isRecord(attribution) || !exactKeys(attribution, ["principalKind", "principalId"])
    || !["owner", "external_human", "external_bot", "ashley", "observation", "receipt", "mixed", "unknown"].includes(String(attribution.principalKind))
    || (attribution.principalId !== null && typeof attribution.principalId !== "string")
    || (value.sourceTimeMs !== null && !finiteInteger(value.sourceTimeMs))
    || !finiteInteger(value.interpretationTimeMs) || value.interpretationTimeMs < 0
    || !["current", "needs_review", "superseded", "withdrawn"].includes(String(lifecycleValue))) return null;
  return {
    ...draft,
    owningRecordId: value.owningRecordId,
    revision: value.revision,
    authoringCycleId: value.authoringCycleId,
    supportAvailability: value.supportAvailability,
    attribution: {
      principalKind: attribution.principalKind as InterpretationAttribution["principalKind"],
      principalId: attribution.principalId as string | null,
    },
    sourceTimeMs: value.sourceTimeMs as number | null,
    interpretationTimeMs: value.interpretationTimeMs,
    applicabilityLifecycle: lifecycleValue as WorkingContextInterpretationEnvelope["applicabilityLifecycle"],
    ...(value.supportUnavailableReason === undefined
      ? {}
      : { supportUnavailableReason: value.supportUnavailableReason as InterpretationSupportUnavailableReason }),
  };
}

export type ResolvedSource = {
  principalKind: InterpretationAttribution["principalKind"];
  principalId: string | null;
  sourceTimeMs: number | null;
};

function assertCurrentEvidenceRow(
  db: DatabaseSync,
  ref: Extract<SourceSupportRef, { kind: "conversation_text_span" }>,
  conversationId: string,
): ResolvedSource {
  const evidence = getConversationEvidence(db, ref.evidenceRowId);
  if (!evidence || evidence.conversationId !== conversationId || evidence.text === null
    || evidence.sourceStatus === "redacted" || evidence.dataClassification === "secret" || evidence.secretOmitted) {
    throw new Error("support_ref_unresolvable");
  }
  const newest = db.prepare(
    `SELECT row_id FROM conversation_evidence_log
      WHERE lineage_id = ? ORDER BY version DESC, created_at_ms DESC LIMIT 1`,
  ).get(evidence.lineageId) as { row_id?: unknown } | undefined;
  if (typeof newest?.row_id !== "string" || newest.row_id !== evidence.rowId) {
    throw new Error("support_ref_not_current");
  }
  if (ref.end > evidence.text.length || evidence.text.slice(ref.start, ref.end) !== ref.quote) {
    throw new Error("support_ref_quote_mismatch");
  }
  if (evidence.role === "owner" && evidence.speakerKind === "owner") {
    return { principalKind: "owner", principalId: evidence.speakerPrincipalId ?? null, sourceTimeMs: evidence.createdAtMs };
  }
  if (evidence.role === "ashley" && evidence.speakerKind === "ashley") {
    return { principalKind: "ashley", principalId: evidence.speakerPrincipalId ?? null, sourceTimeMs: evidence.createdAtMs };
  }
  if (evidence.role === "external_dialog" && evidence.speakerKind === "external_human") {
    return { principalKind: "external_human", principalId: evidence.speakerPrincipalId ?? null, sourceTimeMs: evidence.createdAtMs };
  }
  if (evidence.role === "external_dialog" && evidence.speakerKind === "external_bot") {
    return { principalKind: "external_bot", principalId: evidence.speakerPrincipalId ?? null, sourceTimeMs: evidence.createdAtMs };
  }
  if (evidence.role === "system" && evidence.speakerKind === undefined) {
    return { principalKind: "unknown", principalId: null, sourceTimeMs: evidence.createdAtMs };
  }
  throw new Error("support_ref_principal_invalid");
}

function assertObservationVisibleToConversation(
  db: DatabaseSync,
  observationId: string,
  conversationId: string,
): ResolvedSource {
  const row = db.prepare(
    `SELECT o.created_at_ms, o.payload_json, o.data_classification, o.secret_omitted,
            c.conversation_id
       FROM observations o
       LEFT JOIN cycle_records c ON c.cycle_id = o.cycle_id
      WHERE o.observation_id = ? LIMIT 1`,
  ).get(observationId) as RecordValue | undefined;
  if (!row || row.conversation_id !== conversationId || typeof row.payload_json !== "string"
    || row.data_classification === "secret" || Number(row.secret_omitted) !== 0) {
    throw new Error("support_ref_unresolvable");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error("support_ref_unresolvable");
  }
  const redacted = (value: unknown): boolean => {
    if (value === "[redacted]") return true;
    if (Array.isArray(value)) return value.some(redacted);
    if (!isRecord(value)) return false;
    return value.redacted === true || Object.values(value).some(redacted);
  };
  if (redacted(payload)) throw new Error("support_ref_unresolvable");
  return {
    principalKind: "observation",
    principalId: null,
    sourceTimeMs: finiteInteger(row.created_at_ms) ? row.created_at_ms : null,
  };
}

function assertArtifactTextSpan(
  db: DatabaseSync,
  ref: Extract<SourceSupportRef, { kind: "artifact_text_span" }>,
  conversationId: string,
): ResolvedSource {
  const row = db.prepare(
    `SELECT o.payload_json, o.parent_artifact_id, o.representation_id,
            o.view_metadata_json, o.created_at_ms, o.data_classification,
            o.secret_omitted, c.conversation_id
       FROM observations o
       JOIN cycle_records c ON c.cycle_id = o.cycle_id AND c.generation = o.generation
      WHERE o.parent_artifact_id = ?
        AND o.representation_id = ?
        AND c.conversation_id = ?
        AND o.secret_omitted = 0
        AND lower(o.data_classification) NOT IN ('secret', 'forgotten')
      ORDER BY o.created_at_ms DESC, o.observation_id DESC
      LIMIT 1`,
  ).get(ref.artifactId, ref.representationId, conversationId) as RecordValue | undefined;
  if (!row || typeof row.payload_json !== "string") throw new Error("support_ref_unresolvable");
  let payload: unknown;
  let view;
  try {
    payload = JSON.parse(row.payload_json);
    view = observationViewFromStorage(
      row.parent_artifact_id,
      row.representation_id,
      row.view_metadata_json,
    );
  } catch {
    throw new Error("support_ref_unresolvable");
  }
  if (!view || view.parentArtifactId !== ref.artifactId
    || view.representationId !== ref.representationId
    || !isRecord(payload)
    || typeof payload.contentUtf8 !== "string"
    || (view.completeness !== "complete" && view.completeness !== "partial")) {
    throw new Error("support_ref_unresolvable");
  }
  const returnedSelector = view.returnedSelector;
  let baseOffset = 0;
  let availableChars = payload.contentUtf8.length;
  if (isRecord(returnedSelector) && returnedSelector.kind === "text_window") {
    if (typeof returnedSelector.offsetChars !== "number"
      || !Number.isSafeInteger(returnedSelector.offsetChars)
      || returnedSelector.offsetChars < 0
      || typeof returnedSelector.limitChars !== "number"
      || !Number.isSafeInteger(returnedSelector.limitChars)
      || returnedSelector.limitChars < 1
      || payload.contentUtf8.length > returnedSelector.limitChars) {
      throw new Error("support_ref_unresolvable");
    }
    baseOffset = returnedSelector.offsetChars;
    availableChars = baseOffset + payload.contentUtf8.length;
  } else if (!isRecord(returnedSelector) || returnedSelector.kind !== "whole_file") {
    throw new Error("support_ref_unresolvable");
  }
  if (ref.start < baseOffset || ref.end > availableChars
    || payload.contentUtf8.slice(ref.start - baseOffset, ref.end - baseOffset) !== ref.quote) {
    throw new Error("support_ref_unresolvable");
  }
  return {
    principalKind: "observation",
    principalId: null,
    sourceTimeMs: finiteInteger(row.created_at_ms) ? row.created_at_ms : null,
  };
}

function assertStructuredPath(
  db: DatabaseSync,
  ref: Extract<SourceSupportRef, { kind: "structured_path" }>,
  conversationId: string,
): ResolvedSource {
  if (ref.representationId !== textArtifactRepresentationId(ref.artifactId)) {
    throw new Error("support_ref_unresolved");
  }
  const row = db.prepare(
    `SELECT o.payload_json, o.parent_artifact_id, o.representation_id,
            o.view_metadata_json, o.created_at_ms, o.data_classification,
            o.secret_omitted, c.conversation_id
       FROM observations o
       JOIN cycle_records c ON c.cycle_id = o.cycle_id AND c.generation = o.generation
      WHERE o.parent_artifact_id = ?
        AND o.representation_id = ?
        AND c.conversation_id = ?
        AND o.secret_omitted = 0
        AND lower(o.data_classification) NOT IN ('secret', 'forgotten')
      ORDER BY o.created_at_ms DESC, o.observation_id DESC
      LIMIT 1`,
  ).get(ref.artifactId, ref.representationId, conversationId) as RecordValue | undefined;
  if (!row || typeof row.payload_json !== "string") {
    throw new Error("support_ref_unresolved");
  }
  let payload: unknown;
  let view;
  try {
    payload = JSON.parse(row.payload_json);
    view = observationViewFromStorage(
      row.parent_artifact_id,
      row.representation_id,
      row.view_metadata_json,
    );
  } catch {
    throw new Error("support_ref_unresolved");
  }
  if (!view || view.parentArtifactId !== ref.artifactId
    || view.representationId !== ref.representationId
    || !isRecord(payload)
    || (payload.format !== "json" && payload.format !== "csv")
    || typeof payload.contentHash !== "string") {
    throw new Error("support_ref_unresolved");
  }
  try {
    if (payload.format === "json") {
      if (typeof ref.path !== "string") throw new Error("support_ref_unresolved");
      resolveAttachmentJsonPath(payload.value, ref.path);
    } else {
      if (typeof ref.path !== "object" || ref.path === null || Array.isArray(ref.path)) {
        throw new Error("support_ref_unresolved");
      }
      if (!Array.isArray(payload.rows)
        || !payload.rows.every((candidate) => Array.isArray(candidate))) {
        throw new Error("support_ref_unresolved");
      }
      const rows = payload.rows as unknown[][];
      const path = ref.path as { row: number; column: number };
      if (path.row >= rows.length || path.column >= (rows[path.row]?.length ?? 0)) {
        throw new Error("support_ref_unresolved");
      }
    }
  } catch {
    throw new Error("support_ref_unresolved");
  }
  return {
    principalKind: "observation",
    principalId: null,
    sourceTimeMs: finiteInteger(row.created_at_ms) ? row.created_at_ms : null,
  };
}

function assertDocumentPageRegion(
  db: DatabaseSync,
  ref: Extract<SourceSupportRef, { kind: "document_page_region" }>,
  conversationId: string,
): ResolvedSource {
  if (ref.representationId !== pdfPageTextRepresentationId(ref.artifactId, ref.page)) {
    throw new Error("support_ref_unresolved");
  }
  const row = db.prepare(
    `SELECT o.payload_json, o.parent_artifact_id, o.representation_id,
            o.view_metadata_json, o.created_at_ms, o.data_classification,
            o.secret_omitted, c.conversation_id
       FROM observations o
       JOIN cycle_records c ON c.cycle_id = o.cycle_id AND c.generation = o.generation
      WHERE o.parent_artifact_id = ?
        AND o.representation_id = ?
        AND c.conversation_id = ?
        AND o.secret_omitted = 0
        AND lower(o.data_classification) NOT IN ('secret', 'forgotten')
      ORDER BY o.created_at_ms DESC, o.observation_id DESC
      LIMIT 1`,
  ).get(ref.artifactId, ref.representationId, conversationId) as RecordValue | undefined;
  if (!row || typeof row.payload_json !== "string") throw new Error("support_ref_unresolved");

  let payload: unknown;
  let view;
  try {
    payload = JSON.parse(row.payload_json);
    view = observationViewFromStorage(
      row.parent_artifact_id,
      row.representation_id,
      row.view_metadata_json,
    );
  } catch {
    throw new Error("support_ref_unresolved");
  }
  if (!view || view.parentArtifactId !== ref.artifactId
    || view.representationId !== ref.representationId
    || !isRecord(payload)
    || payload.format !== "pdf_page"
    || payload.artifactId !== ref.artifactId
    || payload.representationId !== ref.representationId
    || payload.page !== ref.page
    || typeof payload.contentHash !== "string"
    || !/^[a-f0-9]{64}$/.test(payload.contentHash)
    || typeof payload.pageWidth !== "number"
    || !Number.isFinite(payload.pageWidth)
    || payload.pageWidth <= 0
    || typeof payload.pageHeight !== "number"
    || !Number.isFinite(payload.pageHeight)
    || payload.pageHeight <= 0) {
    throw new Error("support_ref_unresolved");
  }
  const imageRef = payload.pageImageRef;
  if (!isRecord(imageRef)
    || imageRef.artifactId !== ref.artifactId
    || imageRef.page !== ref.page
    || imageRef.representationId !== pdfPageImageRepresentationId(ref.artifactId, ref.page)) {
    throw new Error("support_ref_unresolved");
  }
  const region = ref.region;
  if (region !== undefined
    && (region.x + region.width > payload.pageWidth
      || region.y + region.height > payload.pageHeight)) {
    throw new Error("support_ref_unresolved");
  }
  return {
    principalKind: "observation",
    principalId: null,
    sourceTimeMs: finiteInteger(row.created_at_ms) ? row.created_at_ms : null,
  };
}

function assertImageRegion(
  db: DatabaseSync,
  ref: Extract<SourceSupportRef, { kind: "image_region" }>,
  conversationId: string,
): ResolvedSource {
  if (ref.representationId !== imageArtifactRepresentationId(ref.artifactId)) {
    throw new Error("support_ref_unresolved");
  }
  const row = db.prepare(
    `SELECT o.payload_json, o.parent_artifact_id, o.representation_id,
            o.view_metadata_json, o.created_at_ms
       FROM observations o
       JOIN cycle_records c ON c.cycle_id = o.cycle_id AND c.generation = o.generation
      WHERE o.parent_artifact_id = ?
        AND o.representation_id = ?
        AND c.conversation_id = ?
        AND o.secret_omitted = 0
        AND lower(o.data_classification) NOT IN ('secret', 'forgotten')
        AND o.modality = 'image'
      ORDER BY o.created_at_ms DESC, o.observation_id DESC
      LIMIT 1`,
  ).get(ref.artifactId, ref.representationId, conversationId) as RecordValue | undefined;
  if (!row || typeof row.payload_json !== "string") throw new Error("support_ref_unresolved");

  let payload: unknown;
  let view;
  try {
    payload = JSON.parse(row.payload_json);
    view = observationViewFromStorage(
      row.parent_artifact_id,
      row.representation_id,
      row.view_metadata_json,
    );
  } catch {
    throw new Error("support_ref_unresolved");
  }
  if (!view || view.parentArtifactId !== ref.artifactId
    || view.representationId !== ref.representationId
    || !isRecord(payload)
    || payload.format !== "image"
    || payload.artifactId !== ref.artifactId
    || payload.representationId !== ref.representationId
    || typeof payload.contentHash !== "string"
    || !/^[a-f0-9]{64}$/.test(payload.contentHash)
    || typeof payload.pixelWidth !== "number"
    || !Number.isFinite(payload.pixelWidth)
    || payload.pixelWidth <= 0
    || typeof payload.pixelHeight !== "number"
    || !Number.isFinite(payload.pixelHeight)
    || payload.pixelHeight <= 0
    || payload.exif !== "not_stripped") {
    throw new Error("support_ref_unresolved");
  }
  const region = ref.region;
  if (region !== undefined
    && (region.x + region.width > payload.pixelWidth
      || region.y + region.height > payload.pixelHeight)) {
    throw new Error("support_ref_unresolved");
  }
  return {
    principalKind: "observation",
    principalId: null,
    sourceTimeMs: finiteInteger(row.created_at_ms) ? row.created_at_ms : null,
  };
}

function assertSupportRefs(
  db: DatabaseSync,
  refs: readonly SourceSupportRef[],
  conversationId: string,
): ResolvedSource[] {
  const resolved: ResolvedSource[] = [];
  for (const ref of refs) {
    switch (ref.kind) {
      case "conversation_text_span":
        resolved.push(assertCurrentEvidenceRow(db, ref, conversationId));
        break;
      case "observation_ref":
        resolved.push(assertObservationVisibleToConversation(db, ref.observationId, conversationId));
        break;
      case "artifact_text_span":
        resolved.push(assertArtifactTextSpan(db, ref, conversationId));
        break;
      case "structured_path":
        resolved.push(assertStructuredPath(db, ref, conversationId));
        break;
      case "document_page_region":
        resolved.push(assertDocumentPageRegion(db, ref, conversationId));
        break;
      case "image_region":
        resolved.push(assertImageRegion(db, ref, conversationId));
        break;
      case "receipt_ref": {
        const receipt = resolveReceiptRef(db, ref.receiptId, conversationId);
        if (!receipt) throw new Error("support_ref_unresolvable");
        resolved.push({ principalKind: "receipt", principalId: null, sourceTimeMs: receipt.atMs });
        break;
      }
      default:
        throw new Error("support_ref_kind_unimplemented");
    }
  }
  return resolved;
}

/** Resolve typed support refs through the source fence used by Working Context. */
export function validateSourceSupportRefs(
  db: DatabaseSync,
  values: readonly unknown[],
  conversationId: string,
): ResolvedSource[] {
  if (!conversationId.trim()) throw new Error("support_ref_conversation_required");
  const refs = values.map(parseSourceSupportRef);
  if (refs.some((ref) => ref === null)) throw new Error("support_ref_invalid");
  return assertSupportRefs(db, refs as SourceSupportRef[], conversationId);
}

function supportSourceIdentity(ref: SourceSupportRef): string {
  switch (ref.kind) {
    case "conversation_text_span": return `conversation_evidence:${ref.evidenceRowId}`;
    case "observation_ref": return `observation:${ref.observationId}`;
    case "receipt_ref": return `receipt:${ref.receiptId}`;
    case "artifact_text_span":
    case "document_page_region":
    case "image_region":
    case "structured_path": return `artifact:${ref.artifactId}:${ref.representationId}`;
  }
}

export function validateAndBuildWorkingContextInterpretationEnvelope(input: {
  db: DatabaseSync;
  itemId: string;
  conversationId: string;
  text: string;
  value: unknown;
  cycleId: string;
  generation: number;
  nowMs: number;
}): WorkingContextInterpretationEnvelope {
  const envelope = parseWorkingContextInterpretationDraft(input.value);
  if (!envelope) throw new Error("working_context_interpretation_envelope_invalid");
  if (envelope.applicability.conversationId !== input.conversationId) {
    throw new Error("interpretation_applicability_conversation_mismatch");
  }
  const resolved = validateSourceSupportRefs(input.db, envelope.support, input.conversationId);
  validateSourceSupportRefs(input.db, envelope.revisionEvidenceRefs, input.conversationId);
  if (envelope.kind === "directive_interpretation"
    && !resolved.some((source) => source.principalKind === "owner")) {
    throw new Error("support_ref_principal_invalid");
  }
  if (envelope.kind === "directive_interpretation"
    && resolved.some((source) => source.principalKind === "ashley"
      || source.principalKind === "external_human" || source.principalKind === "external_bot")) {
    throw new Error("support_ref_principal_invalid");
  }
  if (envelope.kind === "directive_interpretation"
    && new Set(resolved
      .filter((source) => source.principalKind === "owner" && source.principalId !== null)
      .map((source) => source.principalId)).size > 1) {
    throw new Error("support_ref_principal_invalid");
  }
  for (const parentId of envelope.derivationParents) {
    const parent = input.db.prepare(
      "SELECT id FROM working_context_items WHERE id = ? AND conversation_id = ? LIMIT 1",
    ).get(parentId, input.conversationId);
    if (!parent || parentId === input.itemId) throw new Error("interpretation_parent_unresolvable");
  }
  if (envelope.revisionOf !== null) {
    const prior = input.db.prepare(
      `SELECT id, payload_json, applicability_lifecycle
         FROM working_context_items WHERE id = ? AND conversation_id = ? LIMIT 1`,
    ).get(envelope.revisionOf, input.conversationId);
    if (!prior || envelope.revisionOf === input.itemId || !isRecord(prior)) {
      throw new Error("interpretation_revision_unresolvable");
    }
    let priorPayload: unknown;
    try { priorPayload = JSON.parse(String(prior.payload_json)); } catch { priorPayload = null; }
    const priorStoredEnvelope = isRecord(priorPayload) ? priorPayload.interpretationEnvelope : null;
    const priorLifecycle = typeof prior.applicability_lifecycle === "string"
      ? prior.applicability_lifecycle
      : isRecord(priorStoredEnvelope) ? priorStoredEnvelope.applicabilityLifecycle : null;
    const priorEnvelope = parseStoredWorkingContextInterpretationEnvelope(priorStoredEnvelope, priorLifecycle);
    if (!priorEnvelope) {
      throw new Error("interpretation_revision_unresolvable");
    }
    if (envelope.revisionEvidenceRefs.length === 0) {
      throw new Error("interpretation_revision_evidence_required");
    }
    const priorSupportIds = new Set(
      [...priorEnvelope.support, ...priorEnvelope.revisionEvidenceRefs].map(supportSourceIdentity),
    );
    if (!envelope.revisionEvidenceRefs.some((ref) => !priorSupportIds.has(supportSourceIdentity(ref)))) {
      throw new Error("interpretation_revision_evidence_not_new");
    }
  }
  const namedPrincipalSources = resolved.filter((source) =>
    source.principalKind !== "observation" && source.principalKind !== "receipt" && source.principalKind !== "unknown",
  );
  const principalSources = envelope.kind === "directive_interpretation"
    ? namedPrincipalSources.filter((source) => source.principalKind === "owner")
    : namedPrincipalSources;
  const principalKinds = new Set(principalSources.map((source) => source.principalKind));
  const principalIds = new Set(principalSources.map((source) => source.principalId));
  const attribution: InterpretationAttribution = principalSources.length === 0
    ? { principalKind: resolved.some((source) => source.principalKind === "observation")
      ? "observation"
      : resolved.some((source) => source.principalKind === "receipt") ? "receipt" : "unknown", principalId: null }
    : principalKinds.size === 1 && principalIds.size === 1
      ? { principalKind: principalSources[0]!.principalKind, principalId: principalSources[0]!.principalId }
      : { principalKind: "mixed", principalId: null };
  return {
    ...envelope,
    owningRecordId: input.itemId,
    revision: input.generation,
    authoringCycleId: input.cycleId,
    supportAvailability: "intact",
    attribution,
    sourceTimeMs: (envelope.kind === "directive_interpretation"
      ? resolved.find((source) => source.principalKind === "owner" && source.sourceTimeMs !== null)
      : resolved.find((source) => source.sourceTimeMs !== null))?.sourceTimeMs ?? null,
    interpretationTimeMs: input.nowMs,
    applicabilityLifecycle: "current",
  };
}
