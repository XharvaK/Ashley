import type { DatabaseSync } from "node:sqlite";
import type { MindState } from "../types.js";

type StatePatch = {
  focus?: string | null;
  mood?: string | null;
  unfinished?: string[];
  unfinishedJson?: string;
  availability?: string;
};

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : value == null ? null : Number(value);
}

function safeUnfinished(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function ensureState(db: DatabaseSync, ownerId: string): void {
  db.prepare(
    `INSERT INTO internal_state
       (owner_id, focus, mood, unfinished_json, availability, last_decision_id, updated_at)
     VALUES (?, NULL, NULL, '[]', 'available', NULL, ?)
     ON CONFLICT(owner_id) DO NOTHING`,
  ).run(ownerId, new Date().toISOString());
}

export function getState(db: DatabaseSync, ownerId: string): MindState {
  ensureState(db, ownerId);
  const row: unknown = db
    .prepare(
      `SELECT owner_id, focus, mood, unfinished_json, availability,
              last_decision_id, updated_at
       FROM internal_state
       WHERE owner_id = ?`,
    )
    .get(ownerId);
  if (!isRow(row)) {
    throw new Error(`nuclear_state_missing:${ownerId}`);
  }
  const unfinishedJson = stringValue(row.unfinished_json, "[]");
  return {
    ownerId: stringValue(row.owner_id, ownerId),
    focus: nullableString(row.focus),
    mood: nullableString(row.mood),
    unfinished: safeUnfinished(unfinishedJson),
    unfinishedJson,
    availability: stringValue(row.availability, "available"),
    lastDecisionId: numberValue(row.last_decision_id),
    updatedAt: stringValue(row.updated_at, new Date(0).toISOString()),
  };
}

export function patchState(
  db: DatabaseSync,
  ownerId: string,
  patch: StatePatch,
): MindState {
  const current = getState(db, ownerId);
  const unfinishedJson =
    patch.unfinishedJson ??
    (patch.unfinished === undefined
      ? current.unfinishedJson
      : JSON.stringify(patch.unfinished.slice(0, 32)));
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE internal_state
     SET focus = ?, mood = ?, unfinished_json = ?, availability = ?, updated_at = ?
     WHERE owner_id = ?`,
  ).run(
    patch.focus === undefined ? current.focus : patch.focus,
    patch.mood === undefined ? current.mood : patch.mood,
    unfinishedJson,
    patch.availability ?? current.availability,
    now,
    ownerId,
  );
  return getState(db, ownerId);
}

export function setLastDecision(
  db: DatabaseSync,
  ownerId: string,
  decisionId: number | null,
): void {
  ensureState(db, ownerId);
  db.prepare(
    `UPDATE internal_state
     SET last_decision_id = ?, updated_at = ?
     WHERE owner_id = ?`,
  ).run(decisionId, new Date().toISOString(), ownerId);
}
