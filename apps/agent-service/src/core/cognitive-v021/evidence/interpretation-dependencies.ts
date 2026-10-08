import type { DatabaseSync } from "node:sqlite";
import {
  parseStoredWorkingContextInterpretationEnvelope,
  type InterpretationSupportUnavailableReason,
  type SourceSupportRef,
  type WorkingContextInterpretationEnvelope,
} from "./interpretation-envelope.js";
import { getConversationEvidence } from "./conversation-log.js";
import { lessonExists } from "../../teach/lessons.js";
import { resolveReceiptRef } from "../effect/in-flight.js";

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

/** Namespace edge targets because independent sidecar tables can reuse row IDs. */
export function workingContextDependencyKey(id: string): string {
  return `working_context:${id}`;
}

/** Return a table-qualified target so equal row IDs cannot alias across sources. */
export function supportRefDependencyKey(value: unknown): string | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "conversation_text_span":
      return typeof value.evidenceRowId === "string" ? `conversation_evidence:${value.evidenceRowId}` : null;
    case "observation_ref":
      return typeof value.observationId === "string" ? `observation:${value.observationId}` : null;
    case "domus_observation":
      return null;
    case "teaching_lesson":
      return null;
    case "receipt_ref":
      return typeof value.receiptId === "string" ? `receipt:${value.receiptId}` : null;
    case "artifact_text_span":
    case "document_page_region":
    case "image_region":
    case "structured_path":
      return typeof value.artifactId === "string" && typeof value.representationId === "string"
        ? `artifact:${value.artifactId}:${value.representationId}`
        : null;
    default:
      return null;
  }
}

export function persistInterpretationDependencies(
  db: DatabaseSync,
  interpretationId: string,
  envelope: WorkingContextInterpretationEnvelope | undefined,
): void {
  db.prepare("DELETE FROM interpretation_dependencies WHERE from_id = ?").run(interpretationId);
  if (!envelope) return;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO interpretation_dependencies (from_id, to_id, kind) VALUES (?, ?, ?)",
  );
  for (const ref of [...envelope.support, ...envelope.revisionEvidenceRefs]) {
    const key = supportRefDependencyKey(ref);
    if (key) insert.run(interpretationId, key, "support");
  }
  for (const parentId of [...envelope.derivationParents, ...(envelope.revisionOf ? [envelope.revisionOf] : [])]) {
    insert.run(interpretationId, workingContextDependencyKey(parentId), "revision");
  }
}

export function setStoredInterpretationLifecycle(
  db: DatabaseSync,
  interpretationId: string,
  lifecycle: WorkingContextInterpretationEnvelope["applicabilityLifecycle"],
  options: { status?: "active" | "superseded" | "abandoned" } = {},
): boolean {
  const row = db.prepare(
    "SELECT payload_json, applicability_lifecycle FROM working_context_items WHERE id = ? LIMIT 1",
  ).get(interpretationId) as Row | undefined;
  if (!row) return false;
  const payload = parse(row.payload_json);
  if (!isRecord(payload)) return false;
  const storedEnvelope = payload.interpretationEnvelope;
  const lifecycleValue = typeof row.applicability_lifecycle === "string"
    ? row.applicability_lifecycle
    : isRecord(storedEnvelope) ? storedEnvelope.applicabilityLifecycle : null;
  const envelope = parseStoredWorkingContextInterpretationEnvelope(storedEnvelope, lifecycleValue);
  if (!envelope) return false;
  const nextPayload = {
    ...payload,
    ...(options.status ? { status: options.status } : {}),
    interpretationEnvelope: { ...envelope, applicabilityLifecycle: lifecycle },
  };
  const status = options.status ?? payload.status;
  const superseded = status === "superseded" || status === "abandoned"
    || (options.status === undefined && (lifecycle === "superseded" || lifecycle === "withdrawn"))
    ? 1
    : 0;
  db.prepare(
    `UPDATE working_context_items
        SET payload_json = ?, applicability_lifecycle = ?, superseded = ?
      WHERE id = ?`,
  ).run(JSON.stringify(nextPayload), lifecycle, superseded, interpretationId);
  return true;
}

function markDependentSupportUnavailable(
  db: DatabaseSync,
  interpretationId: string,
  sourceKey: string,
  reason: InterpretationSupportUnavailableReason,
): boolean {
  const row = db.prepare(
    `SELECT payload_json, applicability_lifecycle
       FROM working_context_items WHERE id = ? LIMIT 1`,
  ).get(interpretationId) as Row | undefined;
  if (!row) return false;
  const payload = parse(row.payload_json);
  if (!isRecord(payload) || !isRecord(payload.interpretationEnvelope)) return false;
  const currentLifecycle = typeof row.applicability_lifecycle === "string"
    ? row.applicability_lifecycle
    : payload.interpretationEnvelope.applicabilityLifecycle;
  if (currentLifecycle !== "current" && currentLifecycle !== "needs_review"
    && currentLifecycle !== "superseded" && currentLifecycle !== "withdrawn") return false;
  const envelope = parseStoredWorkingContextInterpretationEnvelope(
    payload.interpretationEnvelope,
    currentLifecycle,
  );
  if (!envelope) return false;
  const withoutSource = (refs: readonly SourceSupportRef[]) => refs.filter(
    (ref) => supportRefDependencyKey(ref) !== sourceKey,
  );
  const nextEnvelope = {
    ...envelope,
    support: withoutSource(envelope.support),
    revisionEvidenceRefs: withoutSource(envelope.revisionEvidenceRefs),
    supportAvailability: "unavailable" as const,
    supportUnavailableReason: reason,
    applicabilityLifecycle: currentLifecycle === "current" || currentLifecycle === "needs_review"
      ? "needs_review" as const
      : currentLifecycle,
  };
  const nextPayload = { ...payload, interpretationEnvelope: nextEnvelope };
  db.prepare(
    `UPDATE working_context_items
        SET payload_json = ?, applicability_lifecycle = ?
      WHERE id = ?`,
  ).run(JSON.stringify(nextPayload), nextEnvelope.applicabilityLifecycle, interpretationId);
  return true;
}

export function markInterpretationSupportUnavailable(
  db: DatabaseSync,
  sourceKeys: readonly string[],
  reason: InterpretationSupportUnavailableReason,
): number {
  let changed = 0;
  const findDependents = db.prepare(
    `SELECT DISTINCT from_id FROM interpretation_dependencies
      WHERE to_id = ? AND kind = 'support'`,
  );
  for (const sourceKey of new Set(sourceKeys)) {
    for (const row of findDependents.all(sourceKey) as Array<{ from_id?: unknown }>) {
      if (typeof row.from_id === "string"
        && markDependentSupportUnavailable(db, row.from_id, sourceKey, reason)) changed += 1;
    }
  }
  return changed;
}

export function markInterpretationDependentsForReview(
  db: DatabaseSync,
  supersededInterpretationId: string,
  options: { exceptIds?: readonly string[] } = {},
): number {
  let changed = 0;
  const except = new Set(options.exceptIds ?? []);
  const findDependents = db.prepare(
    `SELECT DISTINCT from_id FROM interpretation_dependencies
      WHERE to_id = ? AND kind = 'revision'`,
  );
  for (const row of findDependents.all(workingContextDependencyKey(supersededInterpretationId)) as Array<{ from_id?: unknown }>) {
    if (typeof row.from_id !== "string" || except.has(row.from_id)) continue;
    const current = db.prepare(
      "SELECT applicability_lifecycle FROM working_context_items WHERE id = ? LIMIT 1",
    ).get(row.from_id) as { applicability_lifecycle?: unknown } | undefined;
    if (current?.applicability_lifecycle !== "current") continue;
    if (setStoredInterpretationLifecycle(db, row.from_id, "needs_review")) changed += 1;
  }
  return changed;
}

function containsRedactedValue(value: unknown): boolean {
  if (value === "[redacted]") return true;
  if (Array.isArray(value)) return value.some(containsRedactedValue);
  if (!isRecord(value)) return false;
  return value.redacted === true || Object.values(value).some(containsRedactedValue);
}

function unavailableSupportReason(
  db: DatabaseSync,
  ref: SourceSupportRef,
  conversationId: string,
): InterpretationSupportUnavailableReason | null {
  if (ref.kind === "conversation_text_span") {
    const evidence = getConversationEvidence(db, ref.evidenceRowId);
    if (!evidence) return "source_inaccessible";
    if (evidence.text === null || evidence.sourceStatus === "redacted") return "source_redacted";
    if (evidence.conversationId !== conversationId || ref.end > evidence.text.length
      || evidence.text.slice(ref.start, ref.end) !== ref.quote) return "source_inaccessible";
    const newest = db.prepare(
      `SELECT row_id FROM conversation_evidence_log
        WHERE lineage_id = ? ORDER BY version DESC, created_at_ms DESC LIMIT 1`,
    ).get(evidence.lineageId) as { row_id?: unknown } | undefined;
    return newest?.row_id === evidence.rowId ? null : "source_inaccessible";
  }
  if (ref.kind === "domus_observation") return null;
  if (ref.kind === "teaching_lesson") return lessonExists(db, ref.lessonId) ? null : "source_inaccessible";
  if (ref.kind === "observation_ref") {
    const row = db.prepare(
      `SELECT o.payload_json, o.data_classification, o.secret_omitted, c.conversation_id
         FROM observations o LEFT JOIN cycle_records c ON c.cycle_id = o.cycle_id
        WHERE o.observation_id = ? LIMIT 1`,
    ).get(ref.observationId) as Row | undefined;
    if (!row) return "source_inaccessible";
    const observation = parse(row.payload_json);
    if (observation === null) return "source_inaccessible";
    if (containsRedactedValue(observation)) return "source_redacted";
    if (row.conversation_id !== conversationId || row.data_classification === "secret"
      || Number(row.secret_omitted) !== 0) return "source_inaccessible";
    return null;
  }
  if (ref.kind === "receipt_ref") {
    const row = db.prepare("SELECT claims_json FROM effect_receipts WHERE receipt_id = ? LIMIT 1")
      .get(ref.receiptId) as Row | undefined;
    if (!row) return "source_inaccessible";
    if (containsRedactedValue(parse(row.claims_json))) return "source_redacted";
    return resolveReceiptRef(db, ref.receiptId, conversationId) ? null : "source_inaccessible";
  }
  return "source_inaccessible";
}

/** Persist review state when a previously accepted support reference is no longer readable. */
export function refreshWorkingContextSupportAvailability(db: DatabaseSync, conversationId: string): void {
  const rows = db.prepare(
    `SELECT id, payload_json, applicability_lifecycle
       FROM working_context_items
      WHERE conversation_id = ? AND superseded = 0`,
  ).all(conversationId) as Array<{ id?: unknown; payload_json?: unknown; applicability_lifecycle?: unknown }>;
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const payload = parse(row.payload_json);
    if (!isRecord(payload) || !isRecord(payload.interpretationEnvelope)) continue;
    const storedEnvelope = parseStoredWorkingContextInterpretationEnvelope(
      payload.interpretationEnvelope,
      row.applicability_lifecycle ?? payload.interpretationEnvelope.applicabilityLifecycle,
    );
    if (!storedEnvelope || storedEnvelope.supportAvailability !== "intact"
      || (storedEnvelope.applicabilityLifecycle !== "current" && storedEnvelope.applicabilityLifecycle !== "needs_review")) continue;
    for (const ref of [...storedEnvelope.support, ...storedEnvelope.revisionEvidenceRefs]) {
      const reason = unavailableSupportReason(db, ref, conversationId);
      const key = supportRefDependencyKey(ref);
      if (!reason || !key) continue;
      markInterpretationSupportUnavailable(db, [key], reason);
      break;
    }
  }
}
