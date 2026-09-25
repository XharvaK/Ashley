import type { DatabaseSync } from "node:sqlite";
import type {
  CycleId,
  Generation,
  WorkingContextDelta,
  WorkingContextItem,
} from "../types.js";
import { validateAndBuildWorkingContextInterpretationEnvelope, parseStoredWorkingContextInterpretationEnvelope } from "./interpretation-envelope.js";
import type { WorkingContextItem as PersistedWorkingContextItem } from "../types.js";

export type WorkingContextPublication = { cycleId: CycleId; generation: Generation; nowMs?: number };

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function audienceScope(value: unknown): WorkingContextItem["audienceScope"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "owner_private") return { kind: "owner_private" };
  if (candidate.kind === "owner_dm" && typeof candidate.threadId === "string" && candidate.threadId.trim()) {
    return { kind: "owner_dm", threadId: candidate.threadId };
  }
  if (candidate.kind === "dm" && typeof candidate.principalId === "string" && candidate.principalId.trim()) {
    return { kind: "dm", principalId: candidate.principalId };
  }
  if (candidate.kind === "room" && typeof candidate.roomId === "string" && candidate.roomId.trim()) {
    return { kind: "room", roomId: candidate.roomId };
  }
  return null;
}

function mapItem(row: unknown, conversationId: string): WorkingContextItem | null {
  if (!isRow(row)) return null;
  const payload = parse(row.payload_json);
  if (!isRow(payload)) return null;
  const type = payload.type;
  const status = payload.status;
  if (
    type !== "topic" && type !== "referent" && type !== "correction" && type !== "owner_teaching" &&
    type !== "question" && type !== "commitment_temp" && type !== "repair"
  ) return null;
  if (status !== "active" && status !== "superseded" && status !== "abandoned") return null;
  const interpretationEnvelope = payload.interpretationEnvelope === undefined
    ? undefined
    : parseStoredWorkingContextInterpretationEnvelope(
      payload.interpretationEnvelope,
      row.legacy_scope === "legacy_unknown_scope" ? "needs_review" : row.applicability_lifecycle,
    );
  if (payload.interpretationEnvelope !== undefined && !interpretationEnvelope) return null;
  const legacyScope = row.legacy_scope === "legacy_unknown_scope" ? "legacy_unknown_scope" : null;
  const applicabilityLifecycle = legacyScope
    ? "needs_review"
    : row.applicability_lifecycle === "current" || row.applicability_lifecycle === "needs_review"
      || row.applicability_lifecycle === "superseded" || row.applicability_lifecycle === "withdrawn"
      ? row.applicability_lifecycle
      : interpretationEnvelope?.applicabilityLifecycle ?? null;
  const envelopeAudience = interpretationEnvelope?.audience.kind === "unknown"
    ? null
    : interpretationEnvelope?.audience ?? undefined;
  const mappedAudience = legacyScope && row.audience_state !== "known"
    ? null
    : audienceScope(envelopeAudience ?? payload.audienceScope);
  return {
    id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
    conversationId,
    type,
    text: typeof payload.text === "string" ? payload.text : "",
    concernId: typeof payload.concernId === "string" ? payload.concernId : null,
    sourceTurnIds: strings(payload.sourceTurnIds),
    status,
    supersedesId: typeof payload.supersedesId === "string" ? payload.supersedesId : null,
    updatedGeneration: Number(row.updated_generation ?? payload.updatedGeneration ?? 0),
    audienceScope: mappedAudience,
    ...(legacyScope ? { applicabilityLifecycle, legacyScope } : {}),
    sourcePrincipal: interpretationEnvelope?.attribution.principalId ?? (typeof payload.sourcePrincipal === "string" ? payload.sourcePrincipal : null),
    sourceEvidenceRef: interpretationEnvelope
      ? interpretationEnvelope.support.find((ref) => ref.kind === "conversation_text_span")?.evidenceRowId ?? null
      : typeof payload.sourceEvidenceRef === "string" ? payload.sourceEvidenceRef : null,
    protectionSubjects: Array.isArray(payload.protectionSubjects) ? strings(payload.protectionSubjects) : null,
    protectionBasisRefs: strings(payload.protectionBasisRefs),
    protectionStatus: payload.protectionStatus === "admitted" || payload.protectionStatus === "unresolved"
      ? payload.protectionStatus
      : null,
    licenseRefs: strings(payload.licenseRefs),
    ...(interpretationEnvelope ? { interpretationEnvelope } : {}),
  };
}

export function listWorkingContext(
  db: DatabaseSync,
  conversationId: string,
  options: { includeSuperseded?: boolean; limit?: number } = {},
): WorkingContextItem[] {
  const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));
  const filter = options.includeSuperseded ? "" : "AND superseded = 0";
  return db.prepare(
    `SELECT id, conversation_id, payload_json, superseded, updated_generation,
            applicability_lifecycle, audience_state, legacy_scope
       FROM working_context_items
      WHERE conversation_id = ? ${filter}
      ORDER BY COALESCE(updated_generation, 0) DESC, id ASC
      LIMIT ?`,
  ).all(conversationId, limit)
    .map((row) => mapItem(row, conversationId))
    .filter((row): row is WorkingContextItem => row !== null);
}

function put(
  db: DatabaseSync,
  item: Omit<PersistedWorkingContextItem, "updatedGeneration">,
  publication: WorkingContextPublication,
): void {
  db.prepare(
    `INSERT INTO working_context_items
       (id, conversation_id, type, payload_json, superseded, updated_cycle, updated_generation,
        applicability_lifecycle, audience_state, legacy_scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,
       type=excluded.type, payload_json=excluded.payload_json, superseded=excluded.superseded,
       updated_cycle=excluded.updated_cycle, updated_generation=excluded.updated_generation,
       applicability_lifecycle=excluded.applicability_lifecycle, audience_state=excluded.audience_state,
       legacy_scope=excluded.legacy_scope`,
  ).run(
    item.id,
    item.conversationId,
    item.type,
    JSON.stringify(item),
    item.status === "superseded" || item.status === "abandoned" ? 1 : 0,
    publication.cycleId,
    publication.generation,
    item.interpretationEnvelope?.applicabilityLifecycle ?? null,
    item.interpretationEnvelope?.audience.kind !== undefined
      ? item.interpretationEnvelope.audience.kind === "unknown" ? "unknown" : "known"
      : item.audienceScope ? "known" : "unknown",
    null,
  );
}

function normalizeItemForPublish(
  db: DatabaseSync,
  item: Extract<WorkingContextDelta, { op: "upsert" }>["item"],
  publication: WorkingContextPublication,
): Omit<PersistedWorkingContextItem, "updatedGeneration"> {
  const raw = item as Omit<PersistedWorkingContextItem, "updatedGeneration"> & { interpretationEnvelope?: unknown };
  if (raw.interpretationEnvelope === undefined) return raw;
  const envelope = validateAndBuildWorkingContextInterpretationEnvelope({
    db,
    itemId: raw.id,
    conversationId: raw.conversationId,
    text: raw.text,
    value: raw.interpretationEnvelope,
    cycleId: publication.cycleId,
    generation: publication.generation,
    nowMs: publication.nowMs ?? Date.now(),
  });
  const audienceScope = envelope.audience.kind === "unknown" ? null : envelope.audience;
  return {
    ...raw,
    audienceScope,
    sourcePrincipal: envelope.attribution.principalId,
    sourceEvidenceRef: envelope.support.find((ref) => ref.kind === "conversation_text_span")?.evidenceRowId ?? null,
    interpretationEnvelope: envelope,
  };
}

export function applyWorkingContextDelta(
  db: DatabaseSync,
  delta: WorkingContextDelta,
  publication: WorkingContextPublication,
): void {
  switch (delta.op) {
    case "upsert":
      put(db, normalizeItemForPublish(db, delta.item, publication), publication);
      return;
    case "supersede":
    {
      const replacement = normalizeItemForPublish(db, delta.replacement, publication);
      db.prepare(
        "UPDATE working_context_items SET superseded = 1, updated_cycle = ?, updated_generation = ? WHERE id = ?",
      ).run(publication.cycleId, publication.generation, delta.id);
      put(db, replacement, publication);
      return;
    }
    case "abandon":
      db.prepare(
        "UPDATE working_context_items SET superseded = 1, updated_cycle = ?, updated_generation = ? WHERE id = ?",
      ).run(publication.cycleId, publication.generation, delta.id);
  }
}
