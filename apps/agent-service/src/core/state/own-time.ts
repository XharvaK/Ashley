import type { DatabaseSync } from "node:sqlite";
import { getState, patchState } from "./store.js";

export type OwnTimeSession = {
  id: number;
  ownerId: string;
  startedAt: string;
  endedAt: string | null;
  startMessageId: number | null;
  endMessageId: number | null;
  createdAt: string;
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function mapSession(value: unknown): OwnTimeSession | null {
  if (!isRow(value)) return null;
  return {
    id: Number(value.id),
    ownerId: String(value.owner_id),
    startedAt: String(value.started_at),
    endedAt: typeof value.ended_at === "string" ? value.ended_at : null,
    startMessageId:
      typeof value.start_message_id === "number"
        ? value.start_message_id
        : value.start_message_id == null
          ? null
          : Number(value.start_message_id),
    endMessageId:
      typeof value.end_message_id === "number"
        ? value.end_message_id
        : value.end_message_id == null
          ? null
          : Number(value.end_message_id),
    createdAt: String(value.created_at),
  };
}

/** Read-only. Does not mutate state. */
export function getOpenOwnTimeSession(
  db: DatabaseSync,
  ownerId: string,
): OwnTimeSession | null {
  const row: unknown = db
    .prepare(
      `SELECT id, owner_id, started_at, ended_at, start_message_id,
              end_message_id, created_at
       FROM own_time_sessions
       WHERE owner_id = ? AND ended_at IS NULL
       LIMIT 1`,
    )
    .get(ownerId);
  return mapSession(row);
}

/** Latest completed own-time window for this owner. Read-only. */
export function getLatestCompletedOwnTimeSession(
  db: DatabaseSync,
  ownerId: string,
): OwnTimeSession | null {
  const row: unknown = db
    .prepare(
      `SELECT id, owner_id, started_at, ended_at, start_message_id,
              end_message_id, created_at
       FROM own_time_sessions
       WHERE owner_id = ? AND ended_at IS NOT NULL
       ORDER BY ended_at DESC, id DESC
       LIMIT 1`,
    )
    .get(ownerId);
  return mapSession(row);
}

/** Read-only presence helper. Does not mutate state. */
export function hasOpenOwnTimeSession(
  db: DatabaseSync,
  ownerId: string,
): boolean {
  return getOpenOwnTimeSession(db, ownerId) !== null;
}

/**
 * Atomic open: insert-or-preserve single open session + quiet + own_time.
 * Transaction owned here — callers must not wrap in another transaction.
 *
 * When called with legacy quiet+own_time and no row, started_at=now is an
 * inferred present start (historical interval unknown).
 */
export function openOwnTimeSession(
  db: DatabaseSync,
  ownerId: string,
  startMessageId: number | null,
): OwnTimeSession {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = getOpenOwnTimeSession(db, ownerId);
    if (!existing) {
      db.prepare(
        `INSERT INTO own_time_sessions
           (owner_id, started_at, ended_at, start_message_id, end_message_id, created_at)
         VALUES (?, ?, NULL, ?, NULL, ?)`,
      ).run(ownerId, now, startMessageId, now);
    }
    patchState(db, ownerId, {
      availability: "quiet",
      focus: "own_time",
    });
    const session = getOpenOwnTimeSession(db, ownerId);
    if (!session) throw new Error("own_time_open_failed");
    db.exec("COMMIT");
    return session;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Atomic close: end open session when present + available + clear own_time focus.
 * Transaction owned here — callers must not wrap in another transaction.
 */
export function closeOwnTimeSession(
  db: DatabaseSync,
  ownerId: string,
  endMessageId: number | null,
): OwnTimeSession | null {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const open = getOpenOwnTimeSession(db, ownerId);
    if (open) {
      db.prepare(
        `UPDATE own_time_sessions
         SET ended_at = ?, end_message_id = ?
         WHERE id = ? AND ended_at IS NULL`,
      ).run(now, endMessageId, open.id);
    }
    const state = getState(db, ownerId);
    patchState(db, ownerId, {
      availability: "available",
      focus: state.focus === "own_time" ? null : state.focus,
    });
    const closed: unknown = open
      ? db
          .prepare(
            `SELECT id, owner_id, started_at, ended_at, start_message_id,
                    end_message_id, created_at
             FROM own_time_sessions WHERE id = ?`,
          )
          .get(open.id)
      : null;
    db.exec("COMMIT");
    return mapSession(closed);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Apply departure or return transition after the user message is persisted.
 * Reactive owner-message path only. Call before motivations/Thought.
 *
 * Legacy sticky focus without a session:
 * - departure → openOwnTimeSession (started_at=now if no row; inferred present)
 * - non-departure + available/quiet sticky focus → closeOwnTimeSession clears
 *   focus/availability without fabricating a historical interval when no row
 */
export function applyOwnTimeTransitionForReactiveTurn(
  db: DatabaseSync,
  ownerId: string,
  options: { departureSignal: boolean; userMessageId: number },
): void {
  if (options.departureSignal) {
    openOwnTimeSession(db, ownerId, options.userMessageId);
    return;
  }

  const open = getOpenOwnTimeSession(db, ownerId);
  const state = getState(db, ownerId);
  if (open || state.focus === "own_time" || state.availability === "quiet") {
    // Only close when own-time related; avoid flipping quiet from unrelated silence.
    if (open || state.focus === "own_time") {
      closeOwnTimeSession(db, ownerId, options.userMessageId);
    }
  }
}
