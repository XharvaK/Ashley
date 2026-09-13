import type { DatabaseSync } from "node:sqlite";
import {
  getLatestCompletedOwnTimeSession,
  getOpenOwnTimeSession,
  type OwnTimeSession,
} from "../../state/own-time.js";
import type { CoverageDisposition } from "../thought/continuity-candidate.js";

export const OWN_TIME_DOMAIN = "own_time" as const;
export const OWN_TIME_CANONICAL_STORE = "nuclear.db:own_time_sessions" as const;

export type OwnTimeSessionCandidate = Readonly<{
  domain: typeof OWN_TIME_DOMAIN;
  canonicalStore: typeof OWN_TIME_CANONICAL_STORE;
  entityIds: readonly string[];
  status: "open" | "completed" | "empty" | "unreachable";
  updatedAtMs: number | null;
  disposition: CoverageDisposition;
  pointerOnly: boolean;
  sessionId: number | null;
  startedAt: string | null;
  endedAt: string | null;
  startMessageId: number | null;
  endMessageId: number | null;
}>;

function sourceTimestamp(session: OwnTimeSession): number | null {
  const value = Date.parse(session.endedAt ?? session.startedAt);
  return Number.isFinite(value) ? value : null;
}

function emptyCandidate(
  status: "empty" | "unreachable",
  disposition: "EMPTY" | "UNREACHABLE",
): OwnTimeSessionCandidate {
  return Object.freeze({
    domain: OWN_TIME_DOMAIN,
    canonicalStore: OWN_TIME_CANONICAL_STORE,
    entityIds: Object.freeze([] as string[]),
    status,
    updatedAtMs: null,
    disposition,
    pointerOnly: false,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    startMessageId: null,
    endMessageId: null,
  });
}

function sessionCandidate(
  session: OwnTimeSession,
  status: "open" | "completed",
): OwnTimeSessionCandidate {
  return Object.freeze({
    domain: OWN_TIME_DOMAIN,
    canonicalStore: OWN_TIME_CANONICAL_STORE,
    entityIds: Object.freeze([String(session.id)]),
    status,
    updatedAtMs: sourceTimestamp(session),
    disposition: "POINTER_ONLY",
    pointerOnly: true,
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    startMessageId: session.startMessageId,
    endMessageId: session.endMessageId,
  });
}

/**
 * Adapt only explicit owner session boundaries into a compact C2 pointer.
 *
 * An open session wins over completed history. With no session row, this
 * returns EMPTY; wall-clock duration is never used to create activity.
 * Query errors remain observable as UNREACHABLE and do not abort Thought
 * assembly.
 */
export function adaptOwnTimeSession(
  nuclearDb: DatabaseSync,
  ownerId = "default",
): OwnTimeSessionCandidate {
  try {
    const open = getOpenOwnTimeSession(nuclearDb, ownerId);
    if (open) return sessionCandidate(open, "open");
    const completed = getLatestCompletedOwnTimeSession(nuclearDb, ownerId);
    return completed
      ? sessionCandidate(completed, "completed")
      : emptyCandidate("empty", "EMPTY");
  } catch {
    return emptyCandidate("unreachable", "UNREACHABLE");
  }
}
