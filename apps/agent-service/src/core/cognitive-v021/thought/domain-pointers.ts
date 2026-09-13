import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  buildCoverageManifest,
  type CoverageManifest,
} from "./coverage-manifest.js";
import type { CoverageDisposition } from "./continuity-candidate.js";
import { getCurrentSharedCulture } from "../../relationship/projections.js";

type DbRow = Record<string, unknown>;

export type TerminalSuppressionEvidence = Readonly<{
  triggerId: string;
  concernId: string;
  status: "suppressed_stale";
  reason: string;
  eventCycleId: string;
  eventGeneration: number;
  suppressedAtMs: number | null;
}>;

export type DomainPointer = Readonly<{
  domain: string;
  canonicalStore: string;
  entityIds: readonly string[];
  status: string;
  updatedAtMs: number | null;
  disposition: CoverageDisposition;
  pointerOnly: boolean;
  terminalEvidence?: readonly TerminalSuppressionEvidence[];
}>;

export type DomainPointersSection = Readonly<{
  version: 1;
  conversationId: string;
  cycleId: string;
  pointers: readonly DomainPointer[];
  coverageManifest: CoverageManifest;
}>;

type PointerRow = {
  id: string;
  status: string;
  updatedAtMs: number | null;
};

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function timestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function dateTimestamp(value: unknown): number | null {
  const numeric = timestamp(value);
  if (numeric !== null) return numeric;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rows(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): DbRow[] {
  return db.prepare(sql).all(...params).filter(isRow);
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function boundedReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim().slice(0, 64);
  return reason && /^[A-Za-z0-9_.:-]+$/.test(reason) ? reason : null;
}

function safeGeneration(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function safeTimestamp(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Read only the bounded causal evidence emitted by stale-trigger suppression. */
export function listTerminalSuppressionEvidence(
  db: DatabaseSync,
  conversationId: string,
): readonly TerminalSuppressionEvidence[] {
  const source = rows(db, `
    SELECT ft.trigger_id, ft.concern_id, ft.status,
           cl.cycle_id AS event_cycle_id, cl.generation AS event_generation,
           cl.payload_json
      FROM future_triggers ft
      LEFT JOIN causal_ledger cl
        ON cl.cycle_id = ('future-trigger:' || ft.trigger_id)
     WHERE ft.conversation_id = ? AND ft.status = 'suppressed_stale'
     ORDER BY ft.trigger_id ASC, cl.generation DESC, cl.cycle_id ASC
  `, conversationId);
  const seen = new Set<string>();
  const evidence: TerminalSuppressionEvidence[] = [];
  for (const item of source) {
    const triggerId = text(item.trigger_id).trim();
    const concernId = text(item.concern_id).trim();
    const eventCycleId = text(item.event_cycle_id).trim();
    if (!triggerId || !concernId || !eventCycleId || seen.has(triggerId)) continue;
    const payload = jsonValue(item.payload_json);
    if (!isRow(payload) || payload.result !== "suppressed_stale") continue;
    const reason = boundedReason(payload.reason);
    if (!reason) continue;
    seen.add(triggerId);
    evidence.push(Object.freeze({
      triggerId,
      concernId,
      status: "suppressed_stale",
      reason,
      eventCycleId,
      eventGeneration: safeGeneration(item.event_generation),
      suppressedAtMs: safeTimestamp(payload.atMs),
    }));
  }
  return Object.freeze(evidence);
}

function pointerStatus(values: readonly PointerRow[]): string {
  const statuses = [...new Set(values.map((value) => value.status).filter(Boolean))];
  if (statuses.length === 0) return "empty";
  if (statuses.length === 1) return statuses[0]!;
  return "mixed";
}

function pointerFromRows(
  domain: string,
  canonicalStore: string,
  sourceRecordCount: number,
  eligibleRows: readonly PointerRow[],
  queryFailed = false,
  terminalEvidence?: readonly TerminalSuppressionEvidence[],
): DomainPointer {
  const disposition: CoverageDisposition = queryFailed
    ? "UNREACHABLE"
    : sourceRecordCount === 0
      ? "EMPTY"
      : eligibleRows.length === 0
        ? "INELIGIBLE"
        : "POINTER_ONLY";
  const updatedAtMs = eligibleRows.reduce<number | null>(
    (latest, row) => row.updatedAtMs === null ? latest : latest === null ? row.updatedAtMs : Math.max(latest, row.updatedAtMs),
    null,
  );
  const pointer = {
    domain,
    canonicalStore,
    entityIds: Object.freeze(eligibleRows.map((row) => row.id)),
    status: queryFailed ? "unreachable" : pointerStatus(eligibleRows),
    updatedAtMs,
    disposition,
    pointerOnly: disposition === "POINTER_ONLY",
    ...(terminalEvidence ? { terminalEvidence: Object.freeze([...terminalEvidence]) } : {}),
  };
  Object.defineProperty(pointer, "pointerOnly", {
    value: pointer.pointerOnly,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(pointer);
}

type DomainAssessment = {
  domain: string;
  disposition: CoverageDisposition;
  sourceRecordCount: number;
  eligibleRecordCount: number;
  ineligibleRecordCount?: number;
  candidateIds: readonly string[];
  required: boolean;
  pointerOnly: boolean;
};

function makeDomain(
  domain: string,
  canonicalStore: string,
  sourceRows: readonly PointerRow[],
  eligibleRows: readonly PointerRow[],
  required = false,
  terminalEvidence?: readonly TerminalSuppressionEvidence[],
): { pointer: DomainPointer; assessment: DomainAssessment } {
  const pointer = pointerFromRows(domain, canonicalStore, sourceRows.length, eligibleRows, false, terminalEvidence);
  return {
    pointer,
    assessment: {
      domain,
      disposition: pointer.disposition,
      sourceRecordCount: sourceRows.length,
      eligibleRecordCount: eligibleRows.length,
      ineligibleRecordCount: Math.max(0, sourceRows.length - eligibleRows.length),
      candidateIds: eligibleRows.map((row) => row.id),
      required,
      pointerOnly: pointer.pointerOnly,
    },
  };
}

function unreachableDomain(
  domain: string,
  canonicalStore: string,
  required = false,
): { pointer: DomainPointer; assessment: DomainAssessment } {
  if (required) throw new Error("mind_occupancy_unreachable");
  const pointer = {
    domain,
    canonicalStore,
    entityIds: Object.freeze([] as string[]),
    status: "unreachable",
    updatedAtMs: null,
    disposition: "UNREACHABLE" as const,
    pointerOnly: false,
  };
  Object.defineProperty(pointer, "pointerOnly", {
    value: pointer.pointerOnly,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.freeze(pointer);
  return {
    pointer,
    assessment: {
      domain,
      disposition: "UNREACHABLE",
      sourceRecordCount: 0,
      eligibleRecordCount: 0,
      candidateIds: [],
      required,
      pointerOnly: false,
    },
  };
}

function mapRows(raw: readonly DbRow[], idKey: string, statusKey: string, timestampKey: string): PointerRow[] {
  return raw.flatMap((row) => {
    const id = text(row[idKey]).trim();
    if (!id) return [];
    return [{
      id,
      status: text(row[statusKey]).trim() || "unknown",
      updatedAtMs: timestamp(row[timestampKey]),
    }];
  });
}

function buildConcerns(db: DatabaseSync, conversationId: string): { pointer: DomainPointer; assessment: DomainAssessment } {
  const source = rows(db, `
    SELECT concern_id, status, updated_cycle
      FROM concerns
     WHERE conversation_id = ?
     ORDER BY concern_id ASC
  `, conversationId);
  const sourceRows = mapRows(source, "concern_id", "status", "updated_cycle");
  const eligibleRows = sourceRows.filter((row) =>
    ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable"].includes(row.status),
  );
  return makeDomain("concerns", "cognitive-v021.db:concerns", sourceRows, eligibleRows);
}

function buildMindOccupancy(db: DatabaseSync, conversationId: string): { pointer: DomainPointer; assessment: DomainAssessment } {
  const source = rows(db, `
    SELECT concern_id, status, updated_generation
      FROM mind_occupancy
     WHERE conversation_id = ?
     ORDER BY priority DESC, updated_generation DESC, concern_id ASC
  `, conversationId);
  const sourceRows = mapRows(source, "concern_id", "status", "updated_generation");
  const eligibleRows = sourceRows.filter((row) =>
    ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable"].includes(row.status),
  );
  return makeDomain("mind_occupancy", "cognitive-v021.db:mind_occupancy", sourceRows, eligibleRows, true);
}

function buildFutureTriggers(db: DatabaseSync, conversationId: string): { pointer: DomainPointer; assessment: DomainAssessment } {
  const source = rows(db, `
    SELECT trigger_id, status, due_at_ms
      FROM future_triggers
     WHERE conversation_id = ?
     ORDER BY due_at_ms ASC, trigger_id ASC
  `, conversationId);
  const sourceRows = mapRows(source, "trigger_id", "status", "due_at_ms");
  const eligibleRows = sourceRows.filter((row) => row.status === "scheduled");
  return makeDomain(
    "future_triggers",
    "cognitive-v021.db:future_triggers",
    sourceRows,
    eligibleRows,
    false,
    listTerminalSuppressionEvidence(db, conversationId),
  );
}

function buildSubscriptions(db: DatabaseSync, conversationId: string): { pointer: DomainPointer; assessment: DomainAssessment } {
  const source = rows(db, `
    SELECT subscription_id, cancelled
      FROM observation_subscriptions
     WHERE conversation_id = ?
     ORDER BY subscription_id ASC
  `, conversationId).map((row) => ({ ...row, status: Number(row.cancelled ?? 0) === 0 ? "active" : "cancelled" }));
  const sourceRows = mapRows(source, "subscription_id", "status", "updated_at_ms");
  const eligibleRows = sourceRows.filter((row) => row.status === "active");
  return makeDomain("observation_subscriptions", "cognitive-v021.db:observation_subscriptions", sourceRows, eligibleRows);
}

function buildSettlements(db: DatabaseSync, conversationId: string): { pointer: DomainPointer; assessment: DomainAssessment } {
  const source = rows(db, `
    SELECT s.settlement_id, s.generation, c.updated_at_ms
      FROM settlements s
      JOIN cycle_records c ON c.cycle_id = s.cycle_id
     WHERE c.conversation_id = ?
     ORDER BY s.generation DESC, s.settlement_id ASC
  `, conversationId);
  const sourceRows = mapRows(source, "settlement_id", "generation", "updated_at_ms").map((row) => ({ ...row, status: "settled" }));
  return makeDomain("recent_settlements", "cognitive-v021.db:settlements", sourceRows, sourceRows);
}

function buildDurableWork(db: DatabaseSync, conversationId: string): { pointer: DomainPointer; assessment: DomainAssessment } {
  const source = rows(db, `
    SELECT id, COALESCE(state, status) AS work_status, created_at_ms
      FROM inbox_events
     WHERE conversation_id = ?
     ORDER BY created_at_ms ASC, id ASC
  `, conversationId);
  const sourceRows = mapRows(source, "id", "work_status", "created_at_ms");
  const eligibleRows = sourceRows.filter((row) =>
    ["pending", "leased", "retry_wait", "reconciling", "claimed", "failed_retryable"].includes(row.status),
  );
  return makeDomain("durable_work", "cognitive-v021.db:inbox_events,durable_work_attempts", sourceRows, eligibleRows);
}

function buildFrontiers(db: DatabaseSync, conversationId: string, cycleId: string): { pointer: DomainPointer; assessment: DomainAssessment } {
  const source = rows(db, `
    SELECT frontier_id, state, updated_at_ms
      FROM deferred_reactive_frontiers
     WHERE conversation_id = ? AND cycle_id = ?
     ORDER BY updated_at_ms DESC, frontier_id ASC
  `, conversationId, cycleId);
  const sourceRows = mapRows(source, "frontier_id", "state", "updated_at_ms");
  const eligibleRows = sourceRows.filter((row) => ["waiting", "running"].includes(row.status));
  return makeDomain("frontiers", "cognitive-v021.db:deferred_reactive_frontiers", sourceRows, eligibleRows);
}

function buildRelationshipState(
  db: DatabaseSync,
  ownerId: string,
): { pointer: DomainPointer; assessment: DomainAssessment } {
  const current = getCurrentSharedCulture(db, ownerId);
  const sourceRows: PointerRow[] = current == null
    ? []
    : [{
        id: current.entityUuid,
        status: current.kind,
        updatedAtMs: dateTimestamp(current.computedAt),
      }];
  return makeDomain(
    "relationship_state",
    "nuclear.db:relationship_projections",
    sourceRows,
    sourceRows,
  );
}

function optional(
  domain: string,
  canonicalStore: string,
  read: () => { pointer: DomainPointer; assessment: DomainAssessment },
): { pointer: DomainPointer; assessment: DomainAssessment } {
  try {
    return read();
  } catch {
    return unreachableDomain(domain, canonicalStore);
  }
}

/**
 * Project domain awareness without copying operational payloads into Thought.
 * Mind Occupancy is required: a failed read is never represented as an empty
 * house. All other initial pointer domains are fail-soft.
 */
export function buildDomainPointers(
  sidecar: DatabaseSync,
  conversationId: string,
  cycleId: string,
  authorityDb?: DatabaseSync,
  ownerId?: string,
): DomainPointersSection {
  const authorityOwner = ownerId?.trim() ? ownerId : null;
  const domains = [
    (() => {
      try { return buildConcerns(sidecar, conversationId); }
      catch { return unreachableDomain("concerns", "cognitive-v021.db:concerns"); }
    })(),
    authorityDb && authorityOwner
      ? optional("relationship_state", "nuclear.db:relationship_projections", () =>
        buildRelationshipState(authorityDb, authorityOwner),
      )
      : unreachableDomain("relationship_state", "nuclear.db:relationship_*"),
    optional("recent_settlements", "cognitive-v021.db:settlements", () => buildSettlements(sidecar, conversationId)),
    (() => {
      try { return buildMindOccupancy(sidecar, conversationId); }
      catch { throw new Error("mind_occupancy_unreachable"); }
    })(),
    optional("future_triggers", "cognitive-v021.db:future_triggers", () => buildFutureTriggers(sidecar, conversationId)),
    optional("observation_subscriptions", "cognitive-v021.db:observation_subscriptions", () => buildSubscriptions(sidecar, conversationId)),
    optional("durable_work", "cognitive-v021.db:inbox_events,durable_work_attempts", () => buildDurableWork(sidecar, conversationId)),
    optional("frontiers", "cognitive-v021.db:deferred_reactive_frontiers", () => buildFrontiers(sidecar, conversationId, cycleId)),
  ];

  const pointers = Object.freeze(domains.map((domain) => domain.pointer));
  const coverageManifest = buildCoverageManifest(domains.map((domain) => domain.assessment));
  const section = {
    version: 1 as const,
    conversationId,
    cycleId,
    pointers,
  } as DomainPointersSection & { coverageManifest: CoverageManifest };
  // Coverage is receipt/diagnostic evidence. Keep it available to Host
  // readers without duplicating the larger manifest in the ordinary Thought
  // prompt, whose wire section must remain compact.
  Object.defineProperty(section, "coverageManifest", {
    value: coverageManifest,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(section);
}
