import type { DatabaseSync } from "node:sqlite";
import {
  capabilityCanInfluence,
  recordLiveShadowEvent,
} from "../rollout/capabilities.js";
import { getLatestCompletedOwnTimeSession } from "../state/own-time.js";
import type {
  AuthorizedReadingClaim,
  Decision,
  OwnTimeReportReason,
  OwnTimeReportStatus,
} from "../types.js";
import type { OwnTimeReportConstraint } from "./own-time-constraint.js";

const TITLE_BOUND = 300;
const MAX_REPORT_TAKES = 3;

/** Exact whole-message standalone shorthand (canonical, no punctuation). */
const RETURN_SHORTHANDS = new Set([
  "anything to report",
  "what did you find",
  "what did you discover",
  "what did you read",
  "catch me up",
  "did you find anything",
]);

export type EligibleReportTake = {
  takeId: number;
  readId: number;
  title: string;
  claim: string;
  itemScore: number;
  createdAt: string;
};

export type OwnTimeReportAssessment = {
  status: OwnTimeReportStatus;
  reason: OwnTimeReportReason;
  sessionId: number | null;
  sessionStartedAt: string | null;
  sessionEndedAt: string | null;
  ownerLinkedReadCount: number;
  eligibleTakeCount: number;
  alreadyReportedCount: number;
  selected: EligibleReportTake[];
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? NaN);
}

function normalizeMessage(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

/** Canonicalize whole-message shorthand: strip terminal punctuation, then trim. */
function canonicalizeShorthandMessage(message: string): string {
  return normalizeMessage(message)
    .replace(/[.!?…]+$/u, "")
    .trim();
}

/**
 * Phrase-only detector: requires discovery/report intent AND an explicit
 * away/sleep/own-time cue. Bare shorthand alone is never enough.
 */
export function isOwnTimeReportAsk(message: string): boolean {
  const text = normalizeMessage(message);
  if (!text) return false;
  const asksReport =
    /\b(?:(?:can\s+you\s+)?tell\s+me\s+all(?:\s+the\s+things)?(?:\s+(?:that\s+)?you(?:'ve| have))?\s+(?:discovered|found|learned|read|noticed)|(?:can\s+you\s+)?tell\s+me\s+what\s+you\s+(?:discovered|found|learned|read|noticed)|what\s+(?:did|have)\s+you\s+(?:discover(?:ed)?|find|found|learn(?:ed)?|read|notice(?:d)?)|anything\s+(?:to\s+report|interesting)|what\s+(?:turned\s+up|came\s+up)|did\s+(?:you\s+(?:find|read|discover)\s+anything|anything\s+catch\s+your\s+attention)|report\s+(?:back|on\s+what)|catch\s+me\s+up)\b/.test(
      text,
    );
  if (!asksReport) return false;
  return /\b(?:while\s+i(?:'m|\s+am|\s+was)?\s+(?:away|asleep|sleeping|gone|out)|(?:during|in)\s+(?:my\s+)?(?:sleep|nap|own\s*time)|overnight|last\s+night|while\s+i\s+slept|when\s+i(?:'m|\s+am|\s+was)?\s+(?:away|asleep|sleeping|gone|out))\b/.test(
    text,
  );
}

/** Exact whole-message shorthand allowlist (no topical additions). */
export function isExactReturnReportShorthand(message: string): boolean {
  return RETURN_SHORTHANDS.has(canonicalizeShorthandMessage(message));
}

/**
 * Context-aware gate: cue-required ask, or exact shorthand on the return
 * message that closed the latest completed own-time session.
 */
export function isEffectiveOwnTimeReportAsk(
  db: DatabaseSync,
  input: { ownerId: string; userMessage: string; userMessageId: number },
): boolean {
  if (isOwnTimeReportAsk(input.userMessage)) return true;
  if (!isExactReturnReportShorthand(input.userMessage)) return false;
  const session = getLatestCompletedOwnTimeSession(db, input.ownerId);
  return (
    session?.endMessageId != null &&
    session.endMessageId === input.userMessageId
  );
}

export function shadowSourceKey(userMessageId: number): string {
  return `own-time-report:message:${userMessageId}`;
}

/** Owner-linked reads via consolidate_curiosity jobs (any status). */
export function listOwnerLinkedReadIdsInWindow(
  db: DatabaseSync,
  ownerId: string,
  startedAt: string,
  endedAt: string,
): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.id AS id
       FROM cur_reads r
       INNER JOIN cognitive_jobs j
         ON j.kind = 'consolidate_curiosity'
        AND j.owner_id = ?
        AND json_type(j.payload_json, '$.readId') = 'integer'
        AND json_extract(j.payload_json, '$.readId') = r.id
       WHERE r.retrieved_at >= ?
         AND r.retrieved_at <= ?
         AND r.provenance = 'live'
       ORDER BY r.retrieved_at ASC, r.id ASC`,
    )
    .all(ownerId, startedAt, endedAt);
  const ids: number[] = [];
  for (const row of rows) {
    if (!isRow(row)) continue;
    const id = numberValue(row.id);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

function parseReportedTakeIds(evidenceRefsJson: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(evidenceRefsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids: number[] = [];
  for (const entry of parsed) {
    if (!isRow(entry)) continue;
    if (entry.type !== "take") continue;
    const id = numberValue(entry.id);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

/** Successfully reported take IDs for this session (non-empty outcome_text). */
export function listSuccessfullyReportedTakeIds(
  db: DatabaseSync,
  ownerId: string,
  sessionEndedAt: string,
): Set<number> {
  const rows = db
    .prepare(
      `SELECT evidence_refs_json
       FROM decision_log
       WHERE owner_id = ?
         AND trigger = 'reactive'
         AND decision_kind = 'share'
         AND created_at >= ?
         AND outcome_text IS NOT NULL
         AND TRIM(outcome_text) <> ''`,
    )
    .all(ownerId, sessionEndedAt);
  const reported = new Set<number>();
  for (const row of rows) {
    if (!isRow(row)) continue;
    for (const id of parseReportedTakeIds(String(row.evidence_refs_json ?? "[]"))) {
      reported.add(id);
    }
  }
  return reported;
}

export function listEligibleReportTakes(
  db: DatabaseSync,
  ownerId: string,
  readIds: number[],
  alreadyReported: Set<number>,
): EligibleReportTake[] {
  if (readIds.length === 0) return [];
  const placeholders = readIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT t.id AS take_id, t.read_id AS read_id, t.take AS claim,
              t.created_at AS created_at, i.title AS title, i.score AS item_score
       FROM cur_takes t
       INNER JOIN cur_items i ON i.id = t.item_id
       INNER JOIN evidence_links el
         ON el.owner_id = ?
        AND el.target_type = 'take'
        AND el.target_id = CAST(t.id AS TEXT)
        AND el.source_type = 'read'
        AND el.source_id = CAST(t.read_id AS TEXT)
       WHERE t.evidence_kind = 'read_record'
         AND t.read_id IS NOT NULL
         AND t.provenance = 'live'
         AND t.read_id IN (${placeholders})
       ORDER BY i.score DESC, t.created_at DESC, t.id DESC`,
    )
    .all(ownerId, ...readIds);

  const seen = new Set<number>();
  const eligible: EligibleReportTake[] = [];
  for (const row of rows) {
    if (!isRow(row)) continue;
    const takeId = numberValue(row.take_id);
    const readId = numberValue(row.read_id);
    if (!Number.isInteger(takeId) || takeId <= 0) continue;
    if (!Number.isInteger(readId) || readId <= 0) continue;
    if (alreadyReported.has(takeId)) continue;
    if (seen.has(takeId)) continue;
    seen.add(takeId);
    eligible.push({
      takeId,
      readId,
      title: String(row.title ?? "").trim().slice(0, TITLE_BOUND),
      claim: String(row.claim ?? ""),
      itemScore: numberValue(row.item_score) || 0,
      createdAt: String(row.created_at ?? ""),
    });
  }
  return eligible;
}

export function assessOwnTimeReport(
  db: DatabaseSync,
  ownerId: string,
): OwnTimeReportAssessment {
  const session = getLatestCompletedOwnTimeSession(db, ownerId);
  if (!session || !session.endedAt) {
    return {
      status: "no_session",
      reason: "no_session",
      sessionId: null,
      sessionStartedAt: null,
      sessionEndedAt: null,
      ownerLinkedReadCount: 0,
      eligibleTakeCount: 0,
      alreadyReportedCount: 0,
      selected: [],
    };
  }

  const readIds = listOwnerLinkedReadIdsInWindow(
    db,
    ownerId,
    session.startedAt,
    session.endedAt,
  );
  if (readIds.length === 0) {
    return {
      status: "no_activity",
      reason: "no_owner_reading_activity",
      sessionId: session.id,
      sessionStartedAt: session.startedAt,
      sessionEndedAt: session.endedAt,
      ownerLinkedReadCount: 0,
      eligibleTakeCount: 0,
      alreadyReportedCount: 0,
      selected: [],
    };
  }

  const alreadyReported = listSuccessfullyReportedTakeIds(
    db,
    ownerId,
    session.endedAt,
  );
  const allEligible = listEligibleReportTakes(
    db,
    ownerId,
    readIds,
    new Set(),
  );
  const unreported = allEligible.filter((take) => !alreadyReported.has(take.takeId));
  const alreadyReportedCount = allEligible.length - unreported.length;

  if (unreported.length === 0) {
    return {
      status: "no_reportable_take",
      reason:
        alreadyReportedCount > 0 ? "already_reported" : "no_grounded_take",
      sessionId: session.id,
      sessionStartedAt: session.startedAt,
      sessionEndedAt: session.endedAt,
      ownerLinkedReadCount: readIds.length,
      eligibleTakeCount: 0,
      alreadyReportedCount,
      selected: [],
    };
  }

  const selected = unreported.slice(0, MAX_REPORT_TAKES);
  return {
    status: "reportable_takes",
    reason: "reportable_takes",
    sessionId: session.id,
    sessionStartedAt: session.startedAt,
    sessionEndedAt: session.endedAt,
    ownerLinkedReadCount: readIds.length,
    eligibleTakeCount: unreported.length,
    alreadyReportedCount,
    selected,
  };
}

function buildStructuredClaims(
  selected: EligibleReportTake[],
): Decision["authorizedClaims"] {
  const readingClaims: AuthorizedReadingClaim[] = [];
  const readingRecordIds: number[] = [];
  const readingTitles: string[] = [];
  const seenTakes = new Set<number>();
  const seenReads = new Set<number>();

  for (const take of selected) {
    if (seenTakes.has(take.takeId) || seenReads.has(take.readId)) continue;
    seenTakes.add(take.takeId);
    seenReads.add(take.readId);
    readingClaims.push({
      takeId: take.takeId,
      readRecordId: take.readId,
      title: take.title,
      claim: take.claim,
    });
    readingRecordIds.push(take.readId);
    readingTitles.push(take.title);
  }
  return { readingRecordIds, readingTitles, readingClaims };
}

/**
 * Deterministic Agency report floor after ordinary Thought.
 * Wave 01: semantic mutation after Thought is forbidden. Kept as a no-op
 * identity for legacy tests that still import the name.
 */
export function applyOwnTimeReportFinalizer(
  decision: Decision,
  _assessment: OwnTimeReportAssessment,
): Decision {
  return decision;
}

function shadowDetail(assessment: OwnTimeReportAssessment): Record<string, unknown> {
  return {
    sessionPresent: assessment.sessionId != null,
    sessionId: assessment.sessionId,
    ownerLinkedReadCount: assessment.ownerLinkedReadCount,
    eligibleTakeCount: assessment.eligibleTakeCount,
    alreadyReportedCount: assessment.alreadyReportedCount,
    proposedStatus: assessment.status,
    proposedReason: assessment.reason,
    proposedSelectedTakeIds: assessment.selected.map((take) => take.takeId),
  };
}

/**
 * Build a typed pre-Thought own-time constraint.
 * When the capability cannot influence, records own_time_report shadow only
 * and returns a non-influencing constraint (or null when not an ask).
 */
export function buildOwnTimeReportConstraint(
  db: DatabaseSync,
  input: {
    ownerId: string;
    userMessage: string;
    userMessageId: number;
  },
): OwnTimeReportConstraint | null {
  if (!isEffectiveOwnTimeReportAsk(db, input)) {
    return null;
  }

  const assessment = assessOwnTimeReport(db, input.ownerId);
  const sourceKey = shadowSourceKey(input.userMessageId);
  const canInfluence = capabilityCanInfluence(db, "own_time_report");

  if (!canInfluence) {
    recordLiveShadowEvent(db, "own_time_report", sourceKey, {
      detail: shadowDetail(assessment),
    });
    return {
      canInfluence: false,
      status: assessment.status,
      reason: assessment.reason,
      sessionId: assessment.sessionId,
      selectedTakeIds: assessment.selected.map((take) => take.takeId),
      readingClaims: buildStructuredClaims(assessment.selected).readingClaims,
    };
  }

  const claims = buildStructuredClaims(assessment.selected);
  return {
    canInfluence: true,
    status: assessment.status,
    reason: assessment.reason,
    sessionId: assessment.sessionId,
    selectedTakeIds: claims.readingClaims.map((claim) => claim.takeId),
    readingClaims: claims.readingClaims,
  };
}

/**
 * @deprecated Wave 01 — post-Thought semantic rewrite removed.
 * Prefer buildOwnTimeReportConstraint before decide().
 * Returns the Decision unchanged. May still record own_time_report shadow
 * when the ask is effective and the capability cannot influence.
 */
export function applyOwnTimeReportAfterThought(
  db: DatabaseSync,
  decision: Decision,
  input: {
    ownerId: string;
    userMessage: string;
    userMessageId: number;
  },
): Decision {
  if (!isEffectiveOwnTimeReportAsk(db, input)) {
    return decision;
  }
  if (capabilityCanInfluence(db, "own_time_report")) {
    // Authorization must already be on the Decision via pre-Thought constraint.
    return decision;
  }
  const assessment = assessOwnTimeReport(db, input.ownerId);
  recordLiveShadowEvent(db, "own_time_report", shadowSourceKey(input.userMessageId), {
    detail: shadowDetail(assessment),
  });
  return decision;
}
