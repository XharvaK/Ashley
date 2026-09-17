import type { DatabaseSync } from "node:sqlite";
import type { HandlerResult, InboxEvent, OwnerDispatchCoverage } from "../types.js";
import { getCycle, getCurrentCycle } from "./inbox.js";
import { ownerCoverageHash, isOwnerObligationEventKind } from "../owner-obligation.js";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Row
    : {};
}

function evidenceRowId(value: unknown): string | null {
  const payload = record(value);
  return typeof payload.evidenceRowId === "string" && payload.evidenceRowId.trim()
    ? payload.evidenceRowId
    : null;
}

function eventEvidenceRowId(event: InboxEvent): string | null {
  return evidenceRowId(event.payload);
}

function payloadEvidenceRowId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return evidenceRowId(JSON.parse(value));
  } catch {
    return null;
  }
}

function eventOrder(row: Row): { createdAtMs: number; id: string } {
  const createdAtMs = typeof row.created_at_ms === "number"
    ? row.created_at_ms
    : Number(row.created_at_ms ?? 0);
  return {
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
    id: typeof row.id === "string" ? row.id : "",
  };
}

/**
 * Capture the exact owner-event set visible to one dispatch attempt.
 * The snapshot is host-only and is never stored as a second obligation
 * ledger. Later events are absent because only the current durable rows are
 * enumerated before the handler is invoked.
 */
export function captureOwnerDispatchCoverage(
  db: DatabaseSync,
  event: InboxEvent,
): OwnerDispatchCoverage {
  const payload = record(event.payload);
  const cycleId = typeof payload.cycleId === "string" ? payload.cycleId : null;
  const cycle = cycleId ? getCycle(db, cycleId) : null;
  const coveredEvidenceIds = new Set(cycle?.composeLogIds ?? []);
  const triggerEvidenceId = eventEvidenceRowId(event);
  if (triggerEvidenceId) coveredEvidenceIds.add(triggerEvidenceId);

  const rows = db.prepare(
    `SELECT id, payload_json, created_at_ms
       FROM inbox_events
      WHERE wake_id = ? AND id != ?
        AND kind IN ('owner_utterance', 'owner_message')
        AND state IN ('pending', 'retry_wait')
      ORDER BY created_at_ms ASC, id ASC`,
  ).all(event.wakeId, event.id) as Row[];

  const ownerEvents: Array<{ id: string; createdAtMs: number; evidenceRowId: string | null }> = [];
  if (isOwnerObligationEventKind(event.kind)) {
    ownerEvents.push({
      id: event.id,
      createdAtMs: event.createdAtMs,
      evidenceRowId: triggerEvidenceId,
    });
  }
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    ownerEvents.push({
      id,
      createdAtMs: eventOrder(row).createdAtMs,
      evidenceRowId: payloadEvidenceRowId(row.payload_json),
    });
  }
  ownerEvents.sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));

  const coveredOwnerEventIds: string[] = [];
  const uncoveredOwnerEventIds: string[] = [];
  for (const ownerEvent of ownerEvents) {
    if (ownerEvent.evidenceRowId && coveredEvidenceIds.has(ownerEvent.evidenceRowId)) {
      coveredOwnerEventIds.push(ownerEvent.id);
    } else {
      uncoveredOwnerEventIds.push(ownerEvent.id);
    }
  }
  const fields = {
    primaryEventId: event.id,
    coveredOwnerEventIds,
    uncoveredOwnerEventIds,
  } satisfies Omit<OwnerDispatchCoverage, "coverageHash">;
  return Object.freeze({ ...fields, coverageHash: ownerCoverageHash(fields) });
}

type SupersessionResult = Extract<HandlerResult, { kind: "superseded" }>;

function eventEvidenceById(db: DatabaseSync, event: InboxEvent, eventId: string): string | null {
  if (eventId === event.id) return eventEvidenceRowId(event);
  const row = record(db.prepare(
    "SELECT payload_json FROM inbox_events WHERE id = ? AND wake_id = ? LIMIT 1",
  ).get(eventId, event.wakeId));
  return payloadEvidenceRowId(row.payload_json);
}

/**
 * Prove the only stale-to-superseded transition permitted by the durable
 * retry ledger. A newer generation is insufficient by itself: the immediate
 * successor must be the current cycle, explicitly name the old generation as
 * preempted, expose one live Owner event, and carry every covered Owner
 * evidence reference forward in its compose log. Any ambiguity returns null
 * so the caller remains unresolved/retryable.
 */
export function proveExactOwnerSupersession(
  db: DatabaseSync,
  event: InboxEvent,
  coverage: OwnerDispatchCoverage,
): SupersessionResult | null {
  if (!isOwnerObligationEventKind(event.kind)) return null;
  if (coverage.primaryEventId !== event.id) return null;
  if (coverage.coveredOwnerEventIds.length === 0 || coverage.uncoveredOwnerEventIds.length > 0) return null;
  if (ownerCoverageHash(coverage) !== coverage.coverageHash) return null;
  if (!coverage.coveredOwnerEventIds.includes(event.id)) return null;
  if (new Set(coverage.coveredOwnerEventIds).size !== coverage.coveredOwnerEventIds.length
    || new Set(coverage.uncoveredOwnerEventIds).size !== coverage.uncoveredOwnerEventIds.length
    || coverage.coveredOwnerEventIds.some((id) => coverage.uncoveredOwnerEventIds.includes(id))) return null;

  const oldCycleId = typeof record(event.payload).cycleId === "string"
    ? record(event.payload).cycleId as string
    : null;
  const oldCycle = oldCycleId ? getCycle(db, oldCycleId) : null;
  if (!oldCycle || oldCycle.wakeId !== event.wakeId) return null;
  const current = getCurrentCycle(db, event.conversationId, { includeIdle: true });
  if (!current
    || current.generation <= oldCycle.generation
    || current.preemptedGeneration !== oldCycle.generation
    || current.wakeId === event.wakeId) return null;
  const oldWake = db.prepare("SELECT state FROM wakes WHERE wake_id = ? LIMIT 1").get(event.wakeId) as Row | undefined;
  if (!oldWake || text(oldWake.state) === "terminal") return null;
  const successorWake = db.prepare("SELECT state FROM wakes WHERE wake_id = ? LIMIT 1").get(current.wakeId) as Row | undefined;
  if (!successorWake || text(successorWake.state) === "terminal") return null;

  const successorRows = db.prepare(
    `SELECT id, kind, state
       FROM inbox_events
      WHERE wake_id = ?
        AND kind IN ('owner_message', 'owner_utterance')
        AND state NOT IN ('terminal', 'quarantined')
      ORDER BY created_at_ms ASC, id ASC`,
  ).all(current.wakeId) as Row[];
  if (successorRows.length !== 1) return null;
  const successorEventId = text(successorRows[0]?.id);
  if (!successorEventId) return null;

  const covered = [...coverage.coveredOwnerEventIds];
  for (const ownerEventId of covered) {
    const evidenceId = eventEvidenceById(db, event, ownerEventId);
    if (!evidenceId || !current.composeLogIds.includes(evidenceId)) return null;
  }

  return {
    kind: "superseded",
    successorIdentity: { wakeId: current.wakeId, eventId: successorEventId },
    coveredOwnerEventIds: covered,
    uncoveredOwnerEventIds: [],
    coverageHash: ownerCoverageHash({
      primaryEventId: event.id,
      coveredOwnerEventIds: covered,
      uncoveredOwnerEventIds: [],
    }),
  };
}

/**
 * Prove the stale-to-superseded transition for an in-flight Owner Thought
 * displaced by a waiting detached-operation completion. A completion admits
 * a newer cycle, so an active Owner Thought would otherwise fail transient
 * and retry against the same stale cycle forever: each retry re-runs the
 * staleness check before any provider work, while the completion (newer,
 * pending) can never run first under fair ordering. Yielding terminally to
 * the oldest pending completion converges quietly: the completion Thought
 * carries the displaced Owner turn in conversation evidence and answers it.
 * Owner succession (proveExactOwnerSupersession) always wins first; this is
 * the fallback only when no valid owner successor exists.
 */
export function proveCompletionSuccession(
  db: DatabaseSync,
  event: InboxEvent,
  coverage: OwnerDispatchCoverage,
): SupersessionResult | null {
  if (!isOwnerObligationEventKind(event.kind)) return null;
  if (coverage.primaryEventId !== event.id) return null;
  if (coverage.coveredOwnerEventIds.length === 0 || coverage.uncoveredOwnerEventIds.length > 0) return null;
  if (ownerCoverageHash(coverage) !== coverage.coverageHash) return null;
  if (!coverage.coveredOwnerEventIds.includes(event.id)) return null;
  if (new Set(coverage.coveredOwnerEventIds).size !== coverage.coveredOwnerEventIds.length
    || new Set(coverage.uncoveredOwnerEventIds).size !== coverage.uncoveredOwnerEventIds.length
    || coverage.coveredOwnerEventIds.some((id) => coverage.uncoveredOwnerEventIds.includes(id))) return null;

  const successor = db.prepare(
    `SELECT id, wake_id
       FROM inbox_events
      WHERE conversation_id = ?
        AND kind = 'observation_or_receipt'
        AND json_extract(payload_json, '$.detachedOperationId') IS NOT NULL
        AND TRIM(COALESCE(json_extract(payload_json, '$.detachedOperationId'), '')) <> ''
        AND state NOT IN ('terminal', 'quarantined')
      ORDER BY created_at_ms ASC, id ASC LIMIT 1`,
  ).get(event.conversationId) as Row | undefined;
  const successorEventId = text(successor?.id);
  const successorWakeId = text(successor?.wake_id);
  if (!successorEventId || !successorWakeId || successorWakeId === event.wakeId) return null;
  const successorWake = db.prepare("SELECT state FROM wakes WHERE wake_id = ? LIMIT 1").get(successorWakeId) as Row | undefined;
  if (!successorWake || text(successorWake.state) === "terminal") return null;

  const covered = [...coverage.coveredOwnerEventIds];
  return {
    kind: "superseded",
    successorIdentity: { wakeId: successorWakeId, eventId: successorEventId },
    coveredOwnerEventIds: covered,
    uncoveredOwnerEventIds: [],
    coverageHash: ownerCoverageHash({
      primaryEventId: event.id,
      coveredOwnerEventIds: covered,
      uncoveredOwnerEventIds: [],
    }),
  };
}
