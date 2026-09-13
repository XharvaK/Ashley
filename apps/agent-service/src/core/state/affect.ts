import type { DatabaseSync } from "node:sqlite";
import type { AffectiveState, Decision, EvidenceRef } from "../types.js";

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));
const clampValence = (value: number): number => Math.max(-1, Math.min(1, value));

export function getAffectiveState(db: DatabaseSync, ownerId: string): AffectiveState {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO affective_state
       (owner_id, valence, activation, openness, tension, reason,
        source_type, source_id, updated_at)
     VALUES (?, 0, 0.5, 0.5, 0, 'neutral baseline', NULL, NULL, ?)
     ON CONFLICT(owner_id) DO NOTHING`,
  ).run(ownerId, now);
  const row = db.prepare(
    `SELECT owner_id, valence, activation, openness, tension, reason,
            source_type, source_id, updated_at
     FROM affective_state WHERE owner_id = ?`,
  ).get(ownerId) as Record<string, unknown>;
  return {
    ownerId: String(row.owner_id),
    valence: Number(row.valence),
    activation: Number(row.activation),
    openness: Number(row.openness),
    tension: Number(row.tension),
    reason: String(row.reason),
    sourceType: typeof row.source_type === "string" ? row.source_type : null,
    sourceId: typeof row.source_id === "string" ? row.source_id : null,
    updatedAt: String(row.updated_at),
  };
}

export function applyAffectiveEvent(
  db: DatabaseSync,
  input: {
    ownerId: string;
    sourceType: string;
    sourceId: string | number;
    valenceDelta?: number;
    activationDelta?: number;
    opennessDelta?: number;
    tensionDelta?: number;
    reason: string;
  },
): AffectiveState {
  const current = getAffectiveState(db, input.ownerId);
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT OR IGNORE INTO affective_events
       (owner_id, source_type, source_id, valence_delta, activation_delta,
        openness_delta, tension_delta, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.ownerId,
    input.sourceType,
    String(input.sourceId),
    input.valenceDelta ?? 0,
    input.activationDelta ?? 0,
    input.opennessDelta ?? 0,
    input.tensionDelta ?? 0,
    input.reason.trim().slice(0, 500),
    now,
  );
  if (result.changes === 0) return current;
  db.prepare(
    `UPDATE affective_state
     SET valence = ?, activation = ?, openness = ?, tension = ?, reason = ?,
         source_type = ?, source_id = ?, updated_at = ?
     WHERE owner_id = ?`,
  ).run(
    clampValence(current.valence + (input.valenceDelta ?? 0)),
    clampUnit(current.activation + (input.activationDelta ?? 0)),
    clampUnit(current.openness + (input.opennessDelta ?? 0)),
    clampUnit(current.tension + (input.tensionDelta ?? 0)),
    input.reason.trim().slice(0, 500),
    input.sourceType,
    String(input.sourceId),
    now,
    input.ownerId,
  );
  return getAffectiveState(db, input.ownerId);
}

export function decayAffect(db: DatabaseSync, ownerId: string): AffectiveState {
  const current = getAffectiveState(db, ownerId);
  const elapsedHours = Math.max(0, (Date.now() - Date.parse(current.updatedAt)) / 3_600_000);
  if (elapsedHours < 1) return current;
  const factor = Math.pow(0.85, Math.min(24, elapsedHours));
  const valence = current.valence * factor;
  const activation = 0.5 + (current.activation - 0.5) * factor;
  const openness = 0.5 + (current.openness - 0.5) * factor;
  const tension = current.tension * factor;
  const stillGrounded = Math.abs(valence) >= 0.05 ||
    Math.abs(activation - 0.5) >= 0.05 ||
    Math.abs(openness - 0.5) >= 0.05 ||
    tension >= 0.05;
  const rootReason = current.reason.replace(/^(?:settling after: )+/, "");
  db.prepare(
    `UPDATE affective_state
     SET valence = ?, activation = ?, openness = ?, tension = ?,
         reason = ?, source_type = ?, source_id = ?, updated_at = ?
     WHERE owner_id = ?`,
  ).run(
    valence,
    activation,
    openness,
    tension,
    stillGrounded ? `settling after: ${rootReason}`.slice(0, 500) : "neutral baseline",
    stillGrounded ? current.sourceType : null,
    stillGrounded ? current.sourceId : null,
    new Date().toISOString(),
    ownerId,
  );
  return getAffectiveState(db, ownerId);
}

export function attachAffectLicense(
  decision: Decision,
  state: AffectiveState,
): Decision {
  const source: EvidenceRef | undefined =
    state.sourceType === "episode" && state.sourceId
      ? { type: "episode", id: state.sourceId }
      : undefined;
  const moved = Math.abs(state.valence) >= 0.1 || state.tension >= 0.15 || Math.abs(state.activation - 0.5) >= 0.15;
  return {
    ...decision,
    affectLicense: {
      permitted: moved && Boolean(source),
      valence: state.valence,
      activation: state.activation,
      openness: state.openness,
      tension: state.tension,
      reason: state.reason,
      ...(source ? { source } : {}),
    },
  };
}
