import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ConcernDelta,
  ConcernRecord,
  CognitiveStatus,
  CycleId,
  Generation,
  QuarantineKind,
} from "../types.js";

export type ConcernPublication = { cycleId: CycleId; generation: Generation };
type Row = Record<string, unknown>;

const COGNITIVE_STATUSES: readonly string[] = [
  "active",
  "investigating",
  "waiting_for_evidence",
  "dormant_but_revisitable",
  "resolved",
];

const QUARANTINE_KINDS: readonly string[] = [
  "legacy_unavailable_source",
  "legacy_quarantine_reason_unavailable",
];

function isRow(value: unknown): value is Row { return typeof value === "object" && value !== null; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function json(value: unknown, fallback: unknown): unknown { try { return JSON.parse(text(value)); } catch { return fallback; } }

/**
 * NULL cognitive status is truthful: it means no cognition-authored status has
 * been established. An unrecognized stored value is also surfaced as NULL
 * rather than coerced into a status cognition never authored.
 */
export function cognitiveStatusOf(value: unknown): CognitiveStatus | null {
  return typeof value === "string" && COGNITIVE_STATUSES.includes(value)
    ? value as CognitiveStatus
    : null;
}

export function quarantineKindOf(value: unknown): QuarantineKind | null {
  return typeof value === "string" && QUARANTINE_KINDS.includes(value)
    ? value as QuarantineKind
    : null;
}

/**
 * Host/E authority facts stored beside the cognitive record. They are never
 * folded into the cognitive snapshot hash and never authored by cognition.
 */
export type ConcernAuthorityFacts = Readonly<{
  forgotten: boolean;
  quarantineKind: QuarantineKind | null;
  cognitiveStatus: CognitiveStatus | null;
}>;

function mapConcern(row: unknown): ConcernRecord | null {
  if (!isRow(row)) return null;
  const sourceTurnIds = json(row.source_refs_json, []);
  const dimensions = json(row.dimensions_json, null);
  if (!Array.isArray(sourceTurnIds) || !isRow(dimensions)) return null;
  return {
    concernId: text(row.concern_id),
    conversationId: text(row.conversation_id),
    statement: text(row.statement),
    sourceTurnIds: sourceTurnIds.filter((id): id is string => typeof id === "string"),
    dimensions: dimensions as ConcernRecord["dimensions"],
    assertionKey: row.assertion_key == null ? null : text(row.assertion_key),
    status: cognitiveStatusOf(row.cognitive_status),
    snapshotHash: text(row.snapshot_hash),
  };
}

/**
 * Host/E authority facts for one concern. Unlike the cognitive read path this
 * does not hide forgotten rows, because Host/E provenance and migration
 * accounting must stay auditable; the caller decides the audience.
 */
export function getConcernAuthorityFacts(
  db: DatabaseSync,
  concernId: string,
): ConcernAuthorityFacts | null {
  const row = db.prepare(
    "SELECT forgotten, quarantine_kind, cognitive_status FROM concerns WHERE concern_id = ?",
  ).get(concernId);
  if (!isRow(row)) return null;
  return {
    forgotten: Number(row.forgotten ?? 0) === 1,
    quarantineKind: quarantineKindOf(row.quarantine_kind),
    cognitiveStatus: cognitiveStatusOf(row.cognitive_status),
  };
}

/**
 * Cognition-facing concern read. Forgotten rows are absent as if they never
 * existed; they are never served, counted, or referenced by this path.
 */
export function getConcern(db: DatabaseSync, concernId: string): ConcernRecord | null {
  return mapConcern(db.prepare(
    "SELECT * FROM concerns WHERE concern_id = ? AND forgotten = 0",
  ).get(concernId));
}

export function listConcerns(db: DatabaseSync, conversationId: string): ConcernRecord[] {
  return db.prepare(
    "SELECT * FROM concerns WHERE conversation_id = ? AND forgotten = 0 ORDER BY concern_id ASC",
  ).all(conversationId)
    .map(mapConcern)
    .filter((row): row is ConcernRecord => row !== null);
}

/**
 * Host/E quarantine set for one conversation. Quarantine blocks foreground and
 * trust, so a quarantined concern is excluded from the foreground projection
 * even when cognition has authored a grounded status on it. It is never a
 * write veto and never an occupancy veto by itself.
 */
export function listQuarantinedConcernIds(
  db: DatabaseSync,
  conversationId: string,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const value of db.prepare(
    "SELECT concern_id FROM concerns WHERE conversation_id = ? AND forgotten = 0 AND quarantine_kind IS NOT NULL",
  ).all(conversationId)) {
    if (isRow(value) && typeof value.concern_id === "string" && value.concern_id.trim()) {
      ids.add(value.concern_id);
    }
  }
  return ids;
}

export function concernSnapshotHash(record: Omit<ConcernRecord, "snapshotHash">): string {
  return createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex");
}

export function applyConcernDelta(
  db: DatabaseSync,
  delta: ConcernDelta,
  publication: ConcernPublication,
): void {
  if (delta.op === "resolve") {
    // A forgotten row is never resurrected by cognition, and quarantine is
    // never cleared here: resolve owns cognitive_status only.
    db.prepare(
      "UPDATE concerns SET cognitive_status = 'resolved', updated_cycle = ? WHERE concern_id = ? AND forgotten = 0",
    ).run(publication.cycleId, delta.concernId);
    return;
  }
  const record = delta.record;
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, cognitive_status, quarantine_kind, forgotten, snapshot_hash, updated_cycle)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
     ON CONFLICT(concern_id) DO UPDATE SET conversation_id=excluded.conversation_id,
       statement=excluded.statement, source_refs_json=excluded.source_refs_json,
       dimensions_json=excluded.dimensions_json, assertion_key=excluded.assertion_key,
       cognitive_status=excluded.cognitive_status, snapshot_hash=excluded.snapshot_hash,
       updated_cycle=excluded.updated_cycle
       WHERE concerns.forgotten = 0`,
  ).run(
    record.concernId,
    record.conversationId,
    record.statement,
    JSON.stringify(record.sourceTurnIds),
    JSON.stringify(record.dimensions),
    record.assertionKey,
    record.status,
    concernSnapshotHash(record),
    publication.cycleId,
  );
}
