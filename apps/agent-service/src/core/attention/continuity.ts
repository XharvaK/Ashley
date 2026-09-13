import type { DatabaseSync } from "node:sqlite";
import {
  MODEL_SENSITIVE_SET_FOR_CONTRACT,
} from "./contract-material.js";
import type { AttentionClock } from "./types.js";
import { realClock } from "./types.js";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

export function resolveProviderModelId(
  modelAlias: string,
  providerModel: string | null | undefined,
): { resolvedModelId: string | null; unresolvedAlias: boolean } {
  if (providerModel == null || providerModel.trim() === "") {
    return { resolvedModelId: null, unresolvedAlias: true };
  }
  const returned = providerModel.trim();
  if (returned === modelAlias) {
    return { resolvedModelId: null, unresolvedAlias: true };
  }
  return { resolvedModelId: returned, unresolvedAlias: false };
}

export function modelContinuityIdentity(
  alias: string,
  resolvedModelId: string | null,
): string | null {
  const normalizedAlias = alias.trim();
  const normalizedResolvedModelId = resolvedModelId?.trim() ?? "";
  return normalizedResolvedModelId.length === 0
    ? null
    : `model-continuity-v1:${normalizedAlias}|${normalizedResolvedModelId}`;
}

/**
 * Apply continuity using DB-global dispatch_sequence ordering.
 * Older responses cannot advance baseline/epoch/demotion.
 */
export function applyModelContinuity(
  db: DatabaseSync,
  input: {
    alias: string;
    resolvedModelId: string | null;
    unresolvedAlias: boolean;
    dispatchSequence: number;
  },
  demoteActiveSensitive: (db: DatabaseSync) => void,
  clock: AttentionClock = realClock,
): {
  kind: "baseline" | "resolved_change" | "unresolved_alias" | "stale" | "none";
  epoch: number;
} {
  const now = new Date(clock.nowMs()).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = db
      .prepare(`SELECT * FROM model_continuity_state WHERE alias = ?`)
      .get(input.alias);

    if (input.unresolvedAlias || input.resolvedModelId == null) {
      db.prepare(
        `INSERT INTO model_continuity_events
           (alias, previous_resolved_id, new_resolved_id, previous_epoch, new_epoch,
            detected_at, dispatch_sequence, kind, action)
         VALUES (?, NULL, NULL, NULL, NULL, ?, ?, 'unresolved_alias', 'none')`,
      ).run(input.alias, now, input.dispatchSequence);
      db.exec("COMMIT");
      return { kind: "unresolved_alias", epoch: isRow(state) ? Number(state.model_epoch) : 0 };
    }

    if (!isRow(state) || Number(state.model_epoch ?? 0) === 0) {
      db.prepare(
        `INSERT INTO model_continuity_state
           (alias, resolved_model_id, model_epoch, last_accepted_dispatch_sequence, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(alias) DO UPDATE SET
           resolved_model_id = excluded.resolved_model_id,
           model_epoch = 1,
           last_accepted_dispatch_sequence = excluded.last_accepted_dispatch_sequence,
           updated_at = excluded.updated_at
         WHERE model_continuity_state.model_epoch = 0
            OR model_continuity_state.last_accepted_dispatch_sequence < excluded.last_accepted_dispatch_sequence`,
      ).run(input.alias, input.resolvedModelId, input.dispatchSequence, now);
      db.prepare(
        `INSERT INTO model_continuity_events
           (alias, previous_resolved_id, new_resolved_id, previous_epoch, new_epoch,
            detected_at, dispatch_sequence, kind, action)
         VALUES (?, NULL, ?, 0, 1, ?, ?, 'baseline', 'none')`,
      ).run(input.alias, input.resolvedModelId, now, input.dispatchSequence);
      db.exec("COMMIT");
      return { kind: "baseline", epoch: 1 };
    }

    const lastSeq = Number(state.last_accepted_dispatch_sequence ?? 0);
    if (input.dispatchSequence <= lastSeq) {
      db.exec("COMMIT");
      return { kind: "stale", epoch: Number(state.model_epoch) };
    }

    const prevId =
      typeof state.resolved_model_id === "string" ? state.resolved_model_id : null;
    if (prevId === input.resolvedModelId) {
      db.prepare(
        `UPDATE model_continuity_state
         SET last_accepted_dispatch_sequence = ?, updated_at = ?
         WHERE alias = ?`,
      ).run(input.dispatchSequence, now, input.alias);
      db.exec("COMMIT");
      return { kind: "none", epoch: Number(state.model_epoch) };
    }

    const prevEpoch = Number(state.model_epoch);
    const newEpoch = prevEpoch + 1;
    db.prepare(
      `UPDATE model_continuity_state
       SET resolved_model_id = ?, model_epoch = ?,
           last_accepted_dispatch_sequence = ?, updated_at = ?
       WHERE alias = ?`,
    ).run(
      input.resolvedModelId,
      newEpoch,
      input.dispatchSequence,
      now,
      input.alias,
    );
    db.prepare(
      `INSERT INTO model_continuity_events
         (alias, previous_resolved_id, new_resolved_id, previous_epoch, new_epoch,
          detected_at, dispatch_sequence, kind, action)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'resolved_change', 'demote_model_sensitive_to_observe')`,
    ).run(
      input.alias,
      prevId,
      input.resolvedModelId,
      prevEpoch,
      newEpoch,
      now,
      input.dispatchSequence,
    );
    db.exec("COMMIT");
    demoteActiveSensitive(db);
    return { kind: "resolved_change", epoch: newEpoch };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function currentModelEpoch(db: DatabaseSync, alias: string): number {
  const row = db
    .prepare(`SELECT model_epoch FROM model_continuity_state WHERE alias = ?`)
    .get(alias);
  return isRow(row) ? Number(row.model_epoch ?? 0) : 0;
}

export type CurrentModelContinuityIdentity = {
  alias: string;
  resolvedModelId: string | null;
  modelEpoch: number;
  identity: string | null;
};

/** Read-only host-owned model identity for model-derived cognition. */
export function currentModelContinuityIdentity(
  db: DatabaseSync,
  alias: string,
): CurrentModelContinuityIdentity {
  const normalizedAlias = alias.trim();
  const row = db
    .prepare(
      `SELECT resolved_model_id, model_epoch
       FROM model_continuity_state WHERE alias = ?`,
    )
    .get(normalizedAlias);
  const resolvedModelId =
    isRow(row) && typeof row.resolved_model_id === "string" && row.resolved_model_id.trim()
      ? row.resolved_model_id.trim()
      : null;
  const modelEpoch =
    isRow(row) && Number.isInteger(Number(row.model_epoch))
      ? Math.max(0, Number(row.model_epoch))
      : 0;
  return {
    alias: normalizedAlias,
    resolvedModelId,
    modelEpoch,
    identity: modelContinuityIdentity(normalizedAlias, resolvedModelId),
  };
}

export { MODEL_SENSITIVE_SET_FOR_CONTRACT };
