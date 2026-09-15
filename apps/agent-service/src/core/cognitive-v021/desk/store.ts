import type { DatabaseSync } from "node:sqlite";
import {
  getMemoryAssertion,
  REDACTED_MEMORY_STATEMENT,
} from "../memory/assertions.js";
import type {
  DeskDelta,
  DeskEntry,
  DeskEntryDraft,
  DeskLifecycle,
} from "../types.js";
import type { SocialAudience } from "../social/types.js";

type Row = Record<string, unknown>;
type DeskSettlementContext = { cycleId: string; generation: number };

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function error(code: string): never {
  throw new Error(code);
}

function audience(value: unknown): SocialAudience | null {
  if (!isRow(value) || typeof value.kind !== "string") return null;
  if (value.kind === "owner_private" && Object.keys(value).length === 1) return { kind: "owner_private" };
  if (value.kind === "owner_dm" && Object.keys(value).length === 2 && typeof value.threadId === "string" && value.threadId.length > 0) {
    return { kind: "owner_dm", threadId: value.threadId };
  }
  if (value.kind === "dm" && Object.keys(value).length === 2 && typeof value.principalId === "string" && value.principalId.length > 0) {
    return { kind: "dm", principalId: value.principalId };
  }
  if (value.kind === "room" && Object.keys(value).length === 2 && typeof value.roomId === "string" && value.roomId.length > 0) {
    return { kind: "room", roomId: value.roomId };
  }
  return null;
}

/** External audiences are never accepted as a widening license by the desk. */
function ownerScopedAudience(value: SocialAudience): SocialAudience {
  return value.kind === "owner_private" || value.kind === "owner_dm"
    ? value
    : { kind: "owner_private" };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result = value.map((item) => typeof item === "string" ? item : "");
  return result.every((item) => item.length > 0) ? result : null;
}

function parseAudience(value: unknown): SocialAudience | null {
  try { return audience(JSON.parse(text(value))); } catch { return null; }
}

function currentEndorsement(db: DatabaseSync, ref: string | null): string | null {
  if (!ref) return null;
  const assertion = getMemoryAssertion(db, ref as never);
  return assertion && assertion.live && assertion.admittedGeneration !== null &&
    assertion.statement !== REDACTED_MEMORY_STATEMENT
    ? ref
    : null;
}

function validateDraft(db: DatabaseSync, input: DeskEntryDraft): DeskEntryDraft {
  if (!input.id.trim()) error("desk_entry_id_required");
  if (!input.body.trim()) error("desk_entry_body_required");
  if (!input.concernRef || typeof input.concernRef !== "string") {
    // A desk note may be unattached. Null is the only valid absence marker.
    if (input.concernRef !== null) error("desk_entry_concern_invalid");
  }
  if (!Array.isArray(input.sourceRefs) || input.sourceRefs.some((ref) => typeof ref !== "string" || ref.trim() === "")) {
    error("desk_entry_source_refs_invalid");
  }
  if (input.authorKind !== "ashley" && input.authorKind !== "owner" && input.authorKind !== "quoted_external") {
    error("desk_entry_author_invalid");
  }
  if (input.form !== "note" && input.form !== "draft" && input.form !== "observation" && input.form !== "brainstorm") {
    error("desk_entry_form_invalid");
  }
  if (input.authorKind === "quoted_external" ? input.verbatim !== true : input.verbatim !== false) {
    error("desk_attribution_mixed");
  }
  if (input.endorsementRef !== null && typeof input.endorsementRef !== "string") {
    error("desk_entry_endorsement_invalid");
  }
  const normalizedAudience = ownerScopedAudience(input.audienceScope);
  const endorsementRef = currentEndorsement(db, input.endorsementRef);
  if (input.endorsementRef !== null && endorsementRef === null) error("desk_endorsement_invalid");
  return {
    ...input,
    concernRef: input.concernRef,
    sourceRefs: [...input.sourceRefs],
    audienceScope: normalizedAudience,
    endorsementRef,
  };
}

function rowToEntry(row: unknown): DeskEntry | null {
  if (!isRow(row)) return null;
  const sourceRefs = stringList(parseJson(row.source_refs_json));
  const scope = parseAudience(row.audience_scope_json);
  const lifecycle = row.lifecycle;
  if (!sourceRefs || !scope || (lifecycle !== "active" && lifecycle !== "archived" && lifecycle !== "tombstoned")) return null;
  if (row.verbatim !== 0 && row.verbatim !== 1) return null;
  const authorKind = row.author_kind;
  if (authorKind !== "ashley" && authorKind !== "owner" && authorKind !== "quoted_external") return null;
  const form = row.form;
  if (form !== "note" && form !== "draft" && form !== "observation" && form !== "brainstorm") return null;
  return {
    id: text(row.id),
    concernRef: row.concern_ref == null ? null : text(row.concern_ref),
    body: text(row.body),
    authorKind,
    sourceRefs,
    verbatim: row.verbatim === 1,
    form,
    endorsementRef: row.endorsement_ref == null ? null : text(row.endorsement_ref),
    audienceScope: scope,
    lifecycle,
    supersededBy: row.superseded_by == null ? null : text(row.superseded_by),
    updatedCycle: text(row.updated_cycle),
    updatedGeneration: number(row.updated_generation),
    createdAtMs: number(row.created_at_ms),
    updatedAtMs: number(row.updated_at_ms),
  };
}

function parseJson(value: unknown): unknown {
  try { return JSON.parse(text(value)); } catch { return null; }
}

function insertDeskEntry(
  db: DatabaseSync,
  input: DeskEntryDraft,
  context: DeskSettlementContext,
  nowMs: number,
  endorsementRef: string | null,
): void {
  db.prepare(
    `INSERT INTO desk_entries
       (id, concern_ref, body, author_kind, source_refs_json, verbatim, form,
        endorsement_ref, audience_scope_json, lifecycle, superseded_by,
        updated_cycle, updated_generation, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.concernRef,
    input.body,
    input.authorKind,
    JSON.stringify(input.sourceRefs),
    input.verbatim ? 1 : 0,
    input.form,
    endorsementRef,
    JSON.stringify(input.audienceScope),
    context.cycleId,
    context.generation,
    nowMs,
    nowMs,
  );
}

function attributionChanged(existing: DeskEntry, replacement: DeskEntryDraft): boolean {
  return existing.body !== replacement.body ||
    existing.authorKind !== replacement.authorKind ||
    existing.verbatim !== replacement.verbatim ||
    JSON.stringify(existing.sourceRefs) !== JSON.stringify(replacement.sourceRefs);
}

function applyOneDeskDelta(
  db: DatabaseSync,
  delta: DeskDelta,
  context: DeskSettlementContext,
  nowMs: number,
): void {
  if (delta.op === "upsert") {
    const input = validateDraft(db, delta.entry);
    const existing = rowToEntry(db.prepare("SELECT * FROM desk_entries WHERE id = ?").get(input.id));
    if (!existing) {
      insertDeskEntry(db, input, context, nowMs, input.endorsementRef);
      return;
    }
    if (existing.lifecycle !== "active") error("desk_entry_not_active");
    const endorsementRef = attributionChanged(existing, input) ? null : input.endorsementRef;
    db.prepare(
      `UPDATE desk_entries
          SET concern_ref = ?, body = ?, author_kind = ?, source_refs_json = ?,
              verbatim = ?, form = ?, endorsement_ref = ?, audience_scope_json = ?,
              updated_cycle = ?, updated_generation = ?, updated_at_ms = ?
        WHERE id = ? AND lifecycle = 'active'`,
    ).run(
      input.concernRef,
      input.body,
      input.authorKind,
      JSON.stringify(input.sourceRefs),
      input.verbatim ? 1 : 0,
      input.form,
      endorsementRef,
      JSON.stringify(input.audienceScope),
      context.cycleId,
      context.generation,
      nowMs,
      input.id,
    );
    return;
  }

  const targetId = delta.id;
  const existing = rowToEntry(db.prepare("SELECT * FROM desk_entries WHERE id = ?").get(targetId));
  if (!existing || existing.lifecycle !== "active") error("desk_entry_not_active");

  if (delta.op === "supersede") {
    const replacement = validateDraft(db, delta.replacement);
    if (replacement.id === targetId || db.prepare("SELECT 1 FROM desk_entries WHERE id = ?").get(replacement.id)) {
      error("desk_entry_replacement_exists");
    }
    insertDeskEntry(db, replacement, context, nowMs, replacement.endorsementRef);
    db.prepare(
      `UPDATE desk_entries
          SET lifecycle = 'archived', superseded_by = ?, updated_cycle = ?,
              updated_generation = ?, updated_at_ms = ?
        WHERE id = ? AND lifecycle = 'active'`,
    ).run(replacement.id, context.cycleId, context.generation, nowMs, targetId);
    return;
  }

  const lifecycle: DeskLifecycle = delta.op === "archive" ? "archived" : "tombstoned";
  db.prepare(
    `UPDATE desk_entries
        SET lifecycle = ?, updated_cycle = ?, updated_generation = ?, updated_at_ms = ?
      WHERE id = ? AND lifecycle = 'active'`,
  ).run(lifecycle, context.cycleId, context.generation, nowMs, targetId);
}

export function applyDeskDeltas(
  db: DatabaseSync,
  deltas: readonly DeskDelta[],
  context: DeskSettlementContext,
  nowMs = Date.now(),
): void {
  for (const delta of deltas) applyOneDeskDelta(db, delta, context, nowMs);
}

export function isDeskEntryAudienceEligible(entry: DeskEntry, requestedAudience: SocialAudience): boolean {
  if (requestedAudience.kind !== "owner_private" && requestedAudience.kind !== "owner_dm") return false;
  return entry.audienceScope.kind === "owner_private" || entry.audienceScope.kind === "owner_dm";
}

export function listDeskEntries(
  db: DatabaseSync,
  options: { audience?: SocialAudience; limit?: number } = {},
): DeskEntry[] {
  const requestedAudience = options.audience ?? { kind: "owner_private" };
  if (requestedAudience.kind !== "owner_private" && requestedAudience.kind !== "owner_dm") return [];
  const limit = Math.max(1, Math.min(128, options.limit ?? 64));
  const rows = db.prepare(
    `SELECT * FROM desk_entries
      WHERE lifecycle = 'active' AND body <> ?
      ORDER BY updated_generation DESC, id ASC
      LIMIT ?`,
  ).all(REDACTED_MEMORY_STATEMENT, limit);
  return rows.map(rowToEntry)
    .filter((entry): entry is DeskEntry => entry !== null)
    .filter((entry) => isDeskEntryAudienceEligible(entry, requestedAudience))
    .map((entry) => ({
      ...entry,
      endorsementRef: currentEndorsement(db, entry.endorsementRef),
    }));
}
