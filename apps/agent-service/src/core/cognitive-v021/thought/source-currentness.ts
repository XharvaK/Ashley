import { sha256, stableJson } from "../../model-fabric/hash.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  ConcernDelta,
  DeskEntry,
  FutureTriggerDelta,
  MindOccupancy,
  OccupancyDelta,
  WorkingContextDelta,
  WorkingContextItem,
  OccupiedConcernProjection,
} from "../types.js";
import { listWorkingContext } from "../evidence/working-context.js";
import { listOccupancy } from "../concerns/occupancy.js";
import {
  listTerminalSuppressionEvidence,
  type TerminalSuppressionEvidence,
} from "./domain-pointers.js";
import type { DomainPointersSection } from "./domain-pointers.js";

export type WorkingContextCurrentnessEntry = Readonly<{
  conversationId: string;
  updatedGeneration: number;
  superseded: boolean;
  payloadHash: string;
}>;

export type WorkingContextCurrentness = Readonly<
  Record<string, WorkingContextCurrentnessEntry>
>;

export type OccupancyCurrentness = Readonly<{
  limit: number;
  selected: readonly MindOccupancy[];
  boundary: MindOccupancy | null;
}>;

export type ConcernCurrentnessEntry = Readonly<{
  snapshotHash: string;
  status: string;
  updatedCycle?: string;
}>;

export type FutureTriggerCurrentness = Readonly<{
  scheduledIds: readonly string[];
  terminalEvidence: readonly TerminalSuppressionEvidence[];
}>;

/**
 * Host-side source witness captured while the Thought input is assembled.
 * The selected source package and this witness are created together. The
 * witness is non-enumerable on the model input and is never sent to Thought.
 */
export type ThoughtSourceCurrentness = Readonly<{
  conversationId?: string;
  workingContext: WorkingContextCurrentness;
  workingContextOrder?: readonly string[];
  occupancySelection?: OccupancyCurrentness;
  concernMembership?: readonly string[];
  concernDependencies?: Readonly<Record<string, ConcernCurrentnessEntry | null>>;
  futureTriggers?: FutureTriggerCurrentness;
  learnedSelfRevisionHead: string;
  relationshipOwnerId: string | null;
  relationshipRevisionHead: string;
}>;

/** The exact source rows and bounded domain evidence consumed by one pass. */
export type ThoughtSourceCapture = Readonly<{
  workingContext: readonly WorkingContextItem[];
  deskEntries: readonly DeskEntry[];
  occupancy: readonly MindOccupancy[];
  occupiedConcernProjection: readonly OccupiedConcernProjection[];
  concernSnapshots: Readonly<Record<string, string>>;
  domainPointers: DomainPointersSection;
  sourceCurrentness: ThoughtSourceCurrentness;
}>;

export type ThoughtSourceCaptureState = Readonly<{
  conversationId: string;
  workingContext: readonly WorkingContextItem[];
  occupancy: readonly MindOccupancy[];
  occupancyLimit: number;
  occupancyBoundary: MindOccupancy | null;
  concernMembership?: readonly string[];
  concernDependencies: Readonly<Record<string, ConcernCurrentnessEntry | null>>;
  scheduledFutureTriggerIds: readonly string[];
  terminalEvidence: readonly TerminalSuppressionEvidence[];
}>;

type DbRow = Record<string, unknown>;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function row(value: unknown): DbRow | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as DbRow
    : null;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function workingContextPayload(item: Pick<WorkingContextItem, "id" | "conversationId" | "type" | "text" | "concernId" | "sourceTurnIds" | "status" | "supersedesId">): Record<string, unknown> {
  return {
    id: item.id,
    conversationId: item.conversationId,
    type: item.type,
    text: item.text,
    concernId: item.concernId,
    sourceTurnIds: [...item.sourceTurnIds],
    status: item.status,
    supersedesId: item.supersedesId,
  };
}

export function workingContextPayloadHash(
  item: Pick<WorkingContextItem, "id" | "conversationId" | "type" | "text" | "concernId" | "sourceTurnIds" | "status" | "supersedesId">,
): string {
  return sha256(workingContextPayload(item));
}

function workingContextEntryFromItem(item: WorkingContextItem): WorkingContextCurrentnessEntry {
  return Object.freeze({
    conversationId: item.conversationId,
    updatedGeneration: item.updatedGeneration,
    superseded: item.status !== "active",
    payloadHash: workingContextPayloadHash(item),
  });
}

export function captureWorkingContextCurrentness(
  items: readonly WorkingContextItem[],
): WorkingContextCurrentness {
  const entries: Record<string, WorkingContextCurrentnessEntry> = {};
  for (const item of items) {
    if (!item.id) continue;
    entries[item.id] = workingContextEntryFromItem(item);
  }
  return Object.freeze(entries);
}

function learnedSelfRevisionHead(db: DatabaseSync): string {
  try {
    const rows = db.prepare(
      `SELECT assertion_key, content_hash, live, memory_kind,
              data_classification, admitted_generation
         FROM sidecar_memory_assertions
        WHERE memory_kind = 'learned_self_evidence'
        ORDER BY assertion_key ASC`,
    ).all();
    return sha256(rows);
  } catch {
    return "unavailable";
  }
}

function relationshipRevisionHead(
  db: DatabaseSync | undefined,
  ownerId: string | null,
): string {
  if (!db || !ownerId) return "unavailable";
  try {
    const current = db.prepare(
      `SELECT id, entity_uuid, projection_policy_id, projection_policy_version,
              source_bindings_json, source_watermark_json, data_classification,
              provenance, party_subject_scope, effective_from,
              supersedes_projection_id, content_binding, computed_at
         FROM relationship_projections
        WHERE owner_id = ? AND kind = 'current_shared_culture'
          AND effective_to IS NULL`,
    ).get(ownerId);
    return sha256(current == null ? { state: "empty" } : { state: "current", current });
  } catch {
    return "unavailable";
  }
}

function currentConcernMembership(db: DatabaseSync, conversationId: string): string[] {
  return db.prepare(
    `SELECT concern_id
       FROM concerns
      WHERE conversation_id = ?
        AND status IN ('active', 'investigating', 'waiting_for_evidence', 'dormant_but_revisitable')
      ORDER BY concern_id ASC`,
  ).all(conversationId).flatMap((value) => {
    const item = row(value);
    return typeof item?.concern_id === "string" && item.concern_id.trim()
      ? [item.concern_id]
      : [];
  });
}

export function captureThoughtSourceCurrentness(
  sidecar: DatabaseSync,
  authorityDb: DatabaseSync | undefined,
  ownerId: string | null,
  workingContext: readonly WorkingContextItem[],
  capture?: Partial<ThoughtSourceCaptureState>,
): ThoughtSourceCurrentness {
  const conversationId = capture?.conversationId
    ?? workingContext[0]?.conversationId
    ?? undefined;
  const concernMembership = capture?.concernMembership
    ?? (conversationId ? currentConcernMembership(sidecar, conversationId) : undefined);
  const currentness: ThoughtSourceCurrentness = {
    ...(conversationId ? { conversationId } : {}),
    workingContext: captureWorkingContextCurrentness(workingContext),
    workingContextOrder: Object.freeze(workingContext.map((item) => item.id)),
    ...(capture?.occupancy
      ? {
          occupancySelection: Object.freeze({
            limit: Math.max(1, Math.floor(capture.occupancyLimit ?? capture.occupancy.length)),
            selected: Object.freeze([...capture.occupancy]),
            boundary: capture.occupancyBoundary ?? null,
        }),
      }
      : {}),
    ...(concernMembership !== undefined
      ? { concernMembership: Object.freeze([...concernMembership]) }
      : {}),
    ...(capture?.concernDependencies
      ? { concernDependencies: Object.freeze({ ...capture.concernDependencies }) }
      : {}),
    ...(capture?.scheduledFutureTriggerIds || capture?.terminalEvidence
      ? {
          futureTriggers: Object.freeze({
            scheduledIds: Object.freeze([...(capture.scheduledFutureTriggerIds ?? [])]),
            terminalEvidence: Object.freeze([...(capture.terminalEvidence ?? [])]),
          }),
        }
      : {}),
    learnedSelfRevisionHead: learnedSelfRevisionHead(sidecar),
    relationshipOwnerId: ownerId,
    relationshipRevisionHead: relationshipRevisionHead(authorityDb, ownerId),
  };
  return Object.freeze(currentness);
}

export function captureThoughtSourceCurrentnessFromDb(
  sidecar: DatabaseSync,
  authorityDb: DatabaseSync | undefined,
  ownerId: string | null,
  conversationId: string,
): ThoughtSourceCurrentness {
  const workingContext = listWorkingContext(sidecar, conversationId);
  return captureThoughtSourceCurrentness(
    sidecar,
    authorityDb,
    ownerId,
    workingContext,
    { conversationId },
  );
}

function currentWorkingContextEntry(
  db: DatabaseSync,
  id: string,
): WorkingContextCurrentnessEntry | null {
  const source = row(db.prepare(
    `SELECT id, conversation_id, payload_json, superseded, updated_generation
       FROM working_context_items WHERE id = ? LIMIT 1`,
  ).get(id));
  if (!source) return null;
  const payload = row(parseJson(source.payload_json));
  if (!payload) return null;
  const sourceTurnIds = Array.isArray(payload.sourceTurnIds)
    ? payload.sourceTurnIds.filter((item): item is string => typeof item === "string")
    : [];
  const status = payload.status === "superseded" || payload.status === "abandoned"
    ? payload.status
    : payload.status === "active" ? "active" : null;
  if (!status) return null;
  return {
    conversationId: text(source.conversation_id),
    updatedGeneration: number(source.updated_generation),
    superseded: number(source.superseded) === 1,
    payloadHash: workingContextPayloadHash({
      id: text(source.id, id),
      conversationId: text(payload.conversationId, text(source.conversation_id)),
      type: payload.type as WorkingContextItem["type"],
      text: text(payload.text),
      concernId: typeof payload.concernId === "string" ? payload.concernId : null,
      sourceTurnIds,
      status,
      supersedesId: typeof payload.supersedesId === "string" ? payload.supersedesId : null,
    }),
  };
}

function currentConcernEntry(db: DatabaseSync, concernId: string): ConcernCurrentnessEntry | null {
  const source = row(db.prepare(
    `SELECT snapshot_hash, status, updated_cycle
       FROM concerns WHERE concern_id = ? LIMIT 1`,
  ).get(concernId));
  if (!source) return null;
  return {
    snapshotHash: text(source.snapshot_hash),
    status: text(source.status),
    updatedCycle: text(source.updated_cycle),
  };
}

function currentWorkingContextOrder(db: DatabaseSync, conversationId: string): string[] {
  return listWorkingContext(db, conversationId).map((item) => item.id);
}

function currentOccupancySelection(
  db: DatabaseSync,
  conversationId: string,
  limit: number,
): OccupancyCurrentness {
  const rows = listOccupancy(db, conversationId, Math.max(1, limit + 1));
  return {
    limit,
    selected: rows.slice(0, limit),
    boundary: rows[limit] ?? null,
  };
}

function currentFutureTriggerCurrentness(
  db: DatabaseSync,
  conversationId: string,
): FutureTriggerCurrentness {
  const scheduledIds = db.prepare(
    `SELECT trigger_id
       FROM future_triggers
      WHERE conversation_id = ? AND status = 'scheduled'
      ORDER BY due_at_ms ASC, trigger_id ASC`,
  ).all(conversationId)
    .flatMap((value) => {
      const item = row(value);
      return typeof item?.trigger_id === "string" ? [item.trigger_id] : [];
    });
  return {
    scheduledIds,
    terminalEvidence: listTerminalSuppressionEvidence(db, conversationId),
  };
}

function sameEntry(
  expected: WorkingContextCurrentnessEntry,
  actual: WorkingContextCurrentnessEntry,
): boolean {
  return stableJson(expected) === stableJson(actual);
}

function currentnessError(code: string): Error {
  return new Error(code);
}

function sameOptional<T>(expected: T | null, actual: T | null): boolean {
  return stableJson(expected) === stableJson(actual);
}

function sameConcernEntry(
  expected: ConcernCurrentnessEntry | null,
  actual: ConcernCurrentnessEntry | null,
): boolean {
  if (expected === null || actual === null) return expected === actual;
  return expected.snapshotHash === actual.snapshotHash
    && expected.status === actual.status
    && (expected.updatedCycle === undefined || expected.updatedCycle === actual.updatedCycle);
}

export type ThoughtSourceCurrentnessDependencies = Readonly<{
  concernDeltas?: readonly ConcernDelta[];
  occupancyDeltas?: readonly OccupancyDelta[];
  futureTriggers?: readonly FutureTriggerDelta[];
}>;

function assertDeltaTargetsBound(
  sidecar: DatabaseSync,
  expected: ThoughtSourceCurrentness,
  dependencies: ThoughtSourceCurrentnessDependencies,
): void {
  for (const delta of dependencies.concernDeltas ?? []) {
    const concernId = delta.op === "resolve" ? delta.concernId : delta.record.concernId;
    const exists = currentConcernEntry(sidecar, concernId) !== null;
    if (exists && expected.concernDependencies?.[concernId] === undefined) {
      throw currentnessError("concern_currentness_unbound");
    }
  }
  for (const delta of dependencies.occupancyDeltas ?? []) {
    const concernId = delta.occupancy.concernId;
    const exists = sidecar.prepare(
      "SELECT 1 AS present FROM mind_occupancy WHERE conversation_id = ? AND concern_id = ? LIMIT 1",
    ).get(delta.occupancy.conversationId, concernId) != null;
    const captured = expected.occupancySelection?.selected.some((item) => item.concernId === concernId)
      || expected.occupancySelection?.boundary?.concernId === concernId;
    if (exists && !captured) throw currentnessError("occupancy_currentness_unbound");
  }
  for (const delta of dependencies.futureTriggers ?? []) {
    const triggerId = delta.op === "cancel" ? delta.triggerId : delta.trigger.triggerId;
    const exists = sidecar.prepare(
      "SELECT 1 AS present FROM future_triggers WHERE trigger_id = ? LIMIT 1",
    ).get(triggerId) != null;
    const captured = expected.futureTriggers?.scheduledIds.includes(triggerId)
      || expected.futureTriggers?.terminalEvidence.some((item) => item.triggerId === triggerId);
    if (exists && !captured) throw currentnessError("future_trigger_currentness_unbound");
  }
}

/**
 * Compare one coherent source witness with canonical state while the caller's
 * publication transaction holds its database locks. New authored rows are
 * allowed when no pre-existing row existed; no generic self-exemption exists.
 */
export function assertThoughtSourceCurrentness(
  sidecar: DatabaseSync,
  authorityDb: DatabaseSync | undefined,
  expected: ThoughtSourceCurrentness,
  workingContextDeltas: readonly WorkingContextDelta[] = [],
  dependencies: ThoughtSourceCurrentnessDependencies = {},
): void {
  const conversationId = expected.conversationId
    ?? Object.values(expected.workingContext)[0]?.conversationId
    ?? null;

  if (conversationId && expected.workingContextOrder) {
    if (!sameOptional(expected.workingContextOrder, currentWorkingContextOrder(sidecar, conversationId))) {
      throw currentnessError("working_context_currentness_stale");
    }
  }

  for (const [id, expectedEntry] of Object.entries(expected.workingContext)) {
    const actual = currentWorkingContextEntry(sidecar, id);
    if (!actual || !sameEntry(expectedEntry, actual)) {
      throw currentnessError("working_context_currentness_stale");
    }
  }

  for (const delta of workingContextDeltas) {
    const targetId = delta.op === "upsert" ? delta.item.id : delta.id;
    const actual = currentWorkingContextEntry(sidecar, targetId);
    if (actual && expected.workingContext[targetId] === undefined) {
      throw currentnessError("working_context_currentness_unbound");
    }
  }

  if (expected.occupancySelection && conversationId) {
    const actual = currentOccupancySelection(
      sidecar,
      conversationId,
      expected.occupancySelection.limit,
    );
    if (!sameOptional(expected.occupancySelection.selected, actual.selected)
      || !sameOptional(expected.occupancySelection.boundary, actual.boundary)) {
      throw currentnessError("occupancy_currentness_stale");
    }
  }

  if (expected.concernMembership && conversationId) {
    if (!sameOptional(expected.concernMembership, currentConcernMembership(sidecar, conversationId))) {
      throw currentnessError("concern_membership_currentness_stale");
    }
  }

  for (const [concernId, expectedEntry] of Object.entries(expected.concernDependencies ?? {})) {
    if (!sameConcernEntry(expectedEntry, currentConcernEntry(sidecar, concernId))) {
      throw currentnessError("concern_currentness_stale");
    }
  }

  if (expected.futureTriggers && conversationId) {
    const actual = currentFutureTriggerCurrentness(sidecar, conversationId);
    if (!sameOptional(expected.futureTriggers.scheduledIds, actual.scheduledIds)
      || !sameOptional(expected.futureTriggers.terminalEvidence, actual.terminalEvidence)) {
      throw currentnessError("future_trigger_currentness_stale");
    }
  }

  assertDeltaTargetsBound(sidecar, expected, dependencies);

  if (learnedSelfRevisionHead(sidecar) !== expected.learnedSelfRevisionHead) {
    throw currentnessError("learned_self_revision_head_stale");
  }
  if (relationshipRevisionHead(authorityDb, expected.relationshipOwnerId) !== expected.relationshipRevisionHead) {
    throw currentnessError("relationship_currentness_stale");
  }
}

export function isThoughtSourceCurrentnessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message === "working_context_currentness_stale" ||
    message === "working_context_currentness_unbound" ||
    message === "occupancy_currentness_stale" ||
    message === "occupancy_currentness_unbound" ||
    message === "concern_currentness_stale" ||
    message === "concern_membership_currentness_stale" ||
    message === "concern_currentness_unbound" ||
    message === "future_trigger_currentness_stale" ||
    message === "future_trigger_currentness_unbound" ||
    message === "learned_self_revision_head_stale" ||
    message === "relationship_currentness_stale";
}
