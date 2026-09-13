import type { DatabaseSync } from "node:sqlite";
import type { MindStateDisposition, MindStateItem, MindStateItemKind } from "../types.js";

type Row = Record<string, unknown>;

function mapItem(value: unknown): MindStateItem | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Row;
  const kind = String(row.kind);
  const status = String(row.status);
  if (!(["goal", "concern", "commitment", "interest", "unfinished"] as string[]).includes(kind)) return null;
  if (!(["active", "resolved", "forgotten"] as string[]).includes(status)) return null;
  return {
    id: Number(row.id),
    ownerId: String(row.owner_id),
    kind: kind as MindStateItemKind,
    text: String(row.text),
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    activation: Number(row.activation),
    urgency: Number(row.urgency),
    status: status as MindStateItem["status"],
    dueAt: typeof row.due_at === "string" ? row.due_at : null,
    wakeState:
      row.wake_state === "pending" || row.wake_state === "claimed"
        ? row.wake_state
        : "consumed",
    wakeAttempts: Number(row.wake_attempts ?? 0),
    nextWakeAt: typeof row.next_wake_at === "string" ? row.next_wake_at : null,
    claimedAt: typeof row.claimed_at === "string" ? row.claimed_at : null,
    surfacedAt: typeof row.surfaced_at === "string" ? row.surfaced_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function upsertMindStateItem(
  db: DatabaseSync,
  input: {
    ownerId: string;
    kind: MindStateItemKind;
    text: string;
    sourceType?: string;
    sourceId?: string | number;
    activation?: number;
    urgency?: number;
    dueAt?: string | null;
  },
): number {
  const text = input.text.trim().slice(0, 600);
  if (!text) return 0;
  const now = new Date().toISOString();
  const sourceType = input.sourceType ?? "custom";
  const sourceId = String(input.sourceId ?? "1");
  const existing = db.prepare(
    `SELECT text, urgency, wake_state, wake_attempts, next_wake_at,
            claimed_at, surfaced_at
     FROM mind_state_items
     WHERE owner_id = ? AND kind = ? AND source_type = ? AND source_id = ?`,
  ).get(
    input.ownerId,
    input.kind,
    sourceType,
    sourceId,
  ) as Record<string, unknown> | undefined;
  const urgency = Math.max(0, Math.min(1, input.urgency ?? 0));
  const urgentKind = input.kind === "commitment" || input.kind === "concern";
  const wasUrgent = urgentKind && Number(existing?.urgency ?? 0) >= 0.85;
  const rearm = urgentKind && urgency >= 0.85 && (
    !existing ||
    !wasUrgent ||
    String(existing.text ?? "") !== text ||
    urgency - Number(existing.urgency ?? 0) >= 0.1
  );
  const wakeState = rearm
    ? "pending"
    : String(existing?.wake_state ?? "consumed");
  db.prepare(
    `INSERT INTO mind_state_items
       (owner_id, kind, text, source_type, source_id, activation, urgency,
        status, due_at, created_at, updated_at, wake_state, wake_attempts,
        next_wake_at, claimed_at, surfaced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, kind, source_type, source_id) DO UPDATE SET
       text = excluded.text,
       activation = MAX(mind_state_items.activation, excluded.activation),
       urgency = excluded.urgency,
       status = 'active', due_at = excluded.due_at, updated_at = excluded.updated_at,
       wake_state = excluded.wake_state,
       wake_attempts = excluded.wake_attempts,
       next_wake_at = excluded.next_wake_at,
       claimed_at = excluded.claimed_at,
       surfaced_at = excluded.surfaced_at`,
  ).run(
    input.ownerId,
    input.kind,
    text,
    sourceType,
    sourceId,
    Math.max(0, Math.min(1, input.activation ?? 0.5)),
    urgency,
    input.dueAt ?? null,
    now,
    now,
    wakeState,
    rearm ? 0 : Number(existing?.wake_attempts ?? 0),
    rearm
      ? now
      : typeof existing?.next_wake_at === "string"
        ? existing.next_wake_at
        : null,
    rearm
      ? null
      : typeof existing?.claimed_at === "string"
        ? existing.claimed_at
        : null,
    rearm
      ? null
      : typeof existing?.surfaced_at === "string"
        ? existing.surfaced_at
        : null,
  );
  const row = db.prepare(
    `SELECT id FROM mind_state_items
     WHERE owner_id = ? AND kind = ? AND source_type = ? AND source_id = ?`,
  ).get(input.ownerId, input.kind, sourceType, sourceId) as { id?: number } | undefined;
  return row?.id ?? 0;
}

export function listActiveMindStateItems(
  db: DatabaseSync,
  ownerId: string,
  limit = 20,
): MindStateItem[] {
  return db.prepare(
    `SELECT id, owner_id, kind, text, source_type, source_id, activation,
            urgency, status, due_at, wake_state, wake_attempts,
            next_wake_at, claimed_at, surfaced_at, created_at, updated_at
     FROM mind_state_items
     WHERE owner_id = ? AND status = 'active'
     ORDER BY urgency DESC, activation DESC, updated_at DESC LIMIT ?`,
  ).all(ownerId, Math.max(1, Math.min(100, limit)))
    .map(mapItem)
    .filter((item): item is MindStateItem => item !== null);
}

export function hasUrgentMindState(
  db: DatabaseSync,
  ownerId: string,
): boolean {
  const row = db.prepare(
     `SELECT 1 AS found FROM mind_state_items
     WHERE owner_id = ? AND status = 'active' AND urgency >= 0.85
       AND kind IN ('commitment', 'concern')
       AND (
         (wake_state = 'pending' AND (next_wake_at IS NULL OR next_wake_at <= ?))
         OR (wake_state = 'claimed' AND next_wake_at <= ?)
       )
     LIMIT 1`,
  ).get(ownerId, new Date().toISOString(), new Date().toISOString()) as
    { found?: number } | undefined;
  return row?.found === 1;
}

export function claimUrgentMindState(
  db: DatabaseSync,
  ownerId: string,
): MindStateItem | null {
  const now = new Date();
  const nowIso = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      `SELECT id FROM mind_state_items
       WHERE owner_id = ? AND status = 'active' AND urgency >= 0.85
         AND kind IN ('commitment', 'concern')
         AND (
           (wake_state = 'pending' AND (next_wake_at IS NULL OR next_wake_at <= ?))
           OR (wake_state = 'claimed' AND next_wake_at <= ?)
         )
       ORDER BY urgency DESC, updated_at ASC, id ASC LIMIT 1`,
    ).get(ownerId, nowIso, nowIso) as { id?: number } | undefined;
    if (!row?.id) {
      db.exec("COMMIT");
      return null;
    }
    db.prepare(
      `UPDATE mind_state_items
       SET wake_state = 'claimed', wake_attempts = wake_attempts + 1,
           claimed_at = ?, next_wake_at = ?
       WHERE id = ?`,
    ).run(
      nowIso,
      new Date(now.getTime() + 5 * 60_000).toISOString(),
      row.id,
    );
    const claimed = db.prepare(
      `SELECT id, owner_id, kind, text, source_type, source_id, activation,
              urgency, status, due_at, wake_state, wake_attempts,
              next_wake_at, claimed_at, surfaced_at, created_at, updated_at
       FROM mind_state_items WHERE id = ?`,
    ).get(row.id);
    db.exec("COMMIT");
    return mapItem(claimed);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function consumeUrgentWake(db: DatabaseSync, itemId: number): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE mind_state_items
     SET wake_state = 'consumed', surfaced_at = ?, claimed_at = NULL,
         next_wake_at = NULL
     WHERE id = ? AND wake_state = 'claimed'`,
  ).run(now, itemId);
}

export function retryUrgentWake(db: DatabaseSync, itemId: number): void {
  const row = db.prepare(
    "SELECT wake_attempts FROM mind_state_items WHERE id = ? AND wake_state = 'claimed'",
  ).get(itemId) as { wake_attempts?: number } | undefined;
  if (!row) return;
  const attempts = Math.max(1, Number(row.wake_attempts ?? 1));
  const delayMin = Math.min(60, 5 * 2 ** Math.min(4, attempts - 1));
  const now = new Date();
  db.prepare(
    `UPDATE mind_state_items
     SET wake_state = 'pending', claimed_at = NULL, next_wake_at = ?
     WHERE id = ? AND wake_state = 'claimed'`,
  ).run(
    new Date(now.getTime() + delayMin * 60_000).toISOString(),
    itemId,
  );
}

export function resolveMindStateItem(
  db: DatabaseSync,
  itemId: number,
  reason?: string,
): boolean {
  const now = new Date().toISOString();
  const res = db.prepare(
    `UPDATE mind_state_items
     SET status = 'resolved', wake_state = 'consumed', claimed_at = NULL,
         next_wake_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'active'`,
  ).run(now, itemId);
  return Number(res.changes) > 0;
}

export function cancelMindStateItem(
  db: DatabaseSync,
  itemId: number,
  reason?: string,
): boolean {
  const now = new Date().toISOString();
  const res = db.prepare(
    `UPDATE mind_state_items
     SET status = 'forgotten', wake_state = 'consumed', claimed_at = NULL,
         next_wake_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'active'`,
  ).run(now, itemId);
  return Number(res.changes) > 0;
}

export function resolveMindStateBySource(
  db: DatabaseSync,
  ownerId: string,
  sourceType: string,
  sourceId: string | number,
): number {
  const now = new Date().toISOString();
  const res = db.prepare(
    `UPDATE mind_state_items
     SET status = 'resolved', wake_state = 'consumed', claimed_at = NULL,
         next_wake_at = NULL, updated_at = ?
     WHERE owner_id = ? AND source_type = ? AND source_id = ? AND status = 'active'`,
  ).run(now, ownerId, sourceType, String(sourceId));
  return Number(res.changes);
}

export function applyMindStateDispositions(
  db: DatabaseSync,
  dispositions?: MindStateDisposition[] | null,
): void {
  if (!dispositions || dispositions.length === 0) return;
  for (const item of dispositions) {
    if (item.disposition === "resolve") {
      resolveMindStateItem(db, item.itemId, item.reason);
    } else if (item.disposition === "cancel") {
      cancelMindStateItem(db, item.itemId, item.reason);
    } else if (item.disposition === "consume_callback") {
      consumeUrgentWake(db, item.itemId);
    }
  }
}
