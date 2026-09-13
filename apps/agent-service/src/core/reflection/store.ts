import type { DatabaseSync } from "node:sqlite";
import type { MotivationKind } from "../types.js";
import { requireStableAuthorityBarrier } from "../cognitive-v021/authority/barrier.js";

export type ClassifiedSignal = "positive" | "negative" | "neutral";
export type ReflectionEventStatus = "pending" | "applied" | "ignored";

export type ReflectionEvent = {
  id: number;
  ownerId: string;
  kind: "initiative_reaction";
  sourceKey: string;
  decisionId: number | null;
  reservationId: number | null;
  discordMessageId: string;
  subjectKind: MotivationKind | null;
  rawSignal: string;
  classifiedSignal: ClassifiedSignal;
  classifierVersion: number;
  status: ReflectionEventStatus;
  reason: string;
  detailJson: string;
  createdAt: string;
  processedAt: string | null;
};

export type InitiativeLearning = {
  ownerId: string;
  motivationKind: MotivationKind;
  positiveCount: number;
  negativeCount: number;
  adjustment: number;
  windowSize: number;
  lastEventId: number | null;
  updatedAt: string;
};

export type ReflectionEventInput = Omit<ReflectionEvent, "id">;

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function motivationKind(value: unknown): MotivationKind | null {
  const kind = stringValue(value);
  switch (kind) {
    case "user_message":
    case "question":
    case "fact":
    case "callback":
    case "opinion":
    case "take":
    case "unfinished":
    case "identity":
    case "availability":
    case "boundary":
    case "silence_signal":
    case "silence_ok":
      return kind;
    default:
      return null;
  }
}

function mapEvent(row: unknown): ReflectionEvent | null {
  if (!isRow(row)) return null;
  const signal = stringValue(row.classified_signal);
  const status = stringValue(row.status);
  if (
    (signal !== "positive" && signal !== "negative" && signal !== "neutral") ||
    (status !== "pending" && status !== "applied" && status !== "ignored")
  ) {
    return null;
  }
  return {
    id: numberValue(row.id),
    ownerId: stringValue(row.owner_id),
    kind: "initiative_reaction",
    sourceKey: stringValue(row.source_key),
    decisionId: nullableNumber(row.decision_id),
    reservationId: nullableNumber(row.reservation_id),
    discordMessageId: stringValue(row.discord_message_id),
    subjectKind: motivationKind(row.subject_kind),
    rawSignal: stringValue(row.raw_signal),
    classifiedSignal: signal,
    classifierVersion: numberValue(row.classifier_version),
    status,
    reason: stringValue(row.reason),
    detailJson: stringValue(row.detail_json),
    createdAt: stringValue(row.created_at),
    processedAt:
      typeof row.processed_at === "string" ? row.processed_at : null,
  };
}

function mapLearning(row: unknown): InitiativeLearning | null {
  if (!isRow(row)) return null;
  const kind = motivationKind(row.motivation_kind);
  if (!kind) return null;
  return {
    ownerId: stringValue(row.owner_id),
    motivationKind: kind,
    positiveCount: numberValue(row.positive_count),
    negativeCount: numberValue(row.negative_count),
    adjustment: numberValue(row.adjustment),
    windowSize: numberValue(row.window_size),
    lastEventId: nullableNumber(row.last_event_id),
    updatedAt: stringValue(row.updated_at),
  };
}

const EVENT_COLUMNS = `
  id, owner_id, kind, source_key, decision_id, reservation_id,
  discord_message_id, subject_kind, raw_signal, classified_signal,
  classifier_version, status, reason, detail_json, created_at, processed_at`;

export function insertReflectionEvent(
  db: DatabaseSync,
  input: ReflectionEventInput,
): ReflectionEvent {
  db.prepare(
    `INSERT OR IGNORE INTO reflection_events
       (owner_id, kind, source_key, decision_id, reservation_id,
        discord_message_id, subject_kind, raw_signal, classified_signal,
        classifier_version, status, reason, detail_json, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.ownerId,
    input.kind,
    input.sourceKey,
    input.decisionId,
    input.reservationId,
    input.discordMessageId,
    input.subjectKind,
    input.rawSignal,
    input.classifiedSignal,
    input.classifierVersion,
    input.status,
    input.reason,
    input.detailJson,
    input.createdAt,
    input.processedAt,
  );
  const event = mapEvent(
    db
      .prepare(
        `SELECT ${EVENT_COLUMNS}
         FROM reflection_events
         WHERE source_key = ?`,
      )
      .get(input.sourceKey),
  );
  if (!event) throw new Error("reflection_event_insert_failed");
  return event;
}

export function getReflectionEvent(
  db: DatabaseSync,
  eventId: number,
): ReflectionEvent | null {
  return mapEvent(
    db
      .prepare(
        `SELECT ${EVENT_COLUMNS}
         FROM reflection_events
         WHERE id = ?`,
      )
      .get(eventId),
  );
}

export function listPendingSubjects(
  db: DatabaseSync,
  ownerId?: string,
): Array<{ ownerId: string; motivationKind: MotivationKind }> {
  const rows = ownerId
    ? db
        .prepare(
          `SELECT DISTINCT owner_id, subject_kind
           FROM reflection_events
           WHERE status = 'pending' AND owner_id = ? AND subject_kind IS NOT NULL`,
        )
        .all(ownerId)
    : db
        .prepare(
          `SELECT DISTINCT owner_id, subject_kind
           FROM reflection_events
           WHERE status = 'pending' AND subject_kind IS NOT NULL`,
        )
        .all();
  return rows.flatMap((row) => {
    if (!isRow(row)) return [];
    const kind = motivationKind(row.subject_kind);
    return kind
      ? [{ ownerId: stringValue(row.owner_id), motivationKind: kind }]
      : [];
  });
}

export function listEvidenceWindow(
  db: DatabaseSync,
  ownerId: string,
  subjectKind: MotivationKind,
  limit: number,
): ReflectionEvent[] {
  return db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
       FROM reflection_events
       WHERE owner_id = ? AND subject_kind = ?
         AND status IN ('pending', 'applied')
         AND classified_signal IN ('positive', 'negative')
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(ownerId, subjectKind, limit)
    .map(mapEvent)
    .filter((event): event is ReflectionEvent => event !== null);
}

export function saveInitiativeLearning(
  db: DatabaseSync,
  learning: InitiativeLearning,
): void {
  requireStableAuthorityBarrier(db);
  db.prepare(
    `INSERT INTO initiative_learning
       (owner_id, motivation_kind, positive_count, negative_count,
        adjustment, window_size, last_event_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, motivation_kind) DO UPDATE SET
       positive_count = excluded.positive_count,
       negative_count = excluded.negative_count,
       adjustment = excluded.adjustment,
       window_size = excluded.window_size,
       last_event_id = excluded.last_event_id,
       updated_at = excluded.updated_at`,
  ).run(
    learning.ownerId,
    learning.motivationKind,
    learning.positiveCount,
    learning.negativeCount,
    learning.adjustment,
    learning.windowSize,
    learning.lastEventId,
    learning.updatedAt,
  );
  requireStableAuthorityBarrier(db);
}

export function markPendingSubjectApplied(
  db: DatabaseSync,
  ownerId: string,
  subjectKind: MotivationKind,
  processedAt: string,
): void {
  db.prepare(
    `UPDATE reflection_events
     SET status = 'applied', processed_at = ?
     WHERE owner_id = ? AND subject_kind = ? AND status = 'pending'`,
  ).run(processedAt, ownerId, subjectKind);
}

export function listInitiativeLearning(
  db: DatabaseSync,
  ownerId: string,
): InitiativeLearning[] {
  return db
    .prepare(
      `SELECT owner_id, motivation_kind, positive_count, negative_count,
              adjustment, window_size, last_event_id, updated_at
       FROM initiative_learning
       WHERE owner_id = ?
       ORDER BY motivation_kind`,
    )
    .all(ownerId)
    .map(mapLearning)
    .filter((row): row is InitiativeLearning => row !== null);
}

export function listReflectionEvents(
  db: DatabaseSync,
  ownerId: string,
  limit = 20,
): ReflectionEvent[] {
  return db
    .prepare(
      `SELECT ${EVENT_COLUMNS}
       FROM reflection_events
       WHERE owner_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(ownerId, Math.max(1, Math.min(100, limit)))
    .map(mapEvent)
    .filter((event): event is ReflectionEvent => event !== null);
}
