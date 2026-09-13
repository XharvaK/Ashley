import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { getAuthoritativeLineageId } from "./db.js";

export type ForgetAction = "delete" | "redact" | "detach";

export type ForgetTarget = {
  entityType: string;
  entityUuid: string;
  action: ForgetAction;
};

export type CategoryCounts = Record<string, number>;

const PREVIEW_TTL_MS = 30 * 60 * 1000;

export function createForgetPreview(
  continuity: DatabaseSync,
  input: {
    ownerId: string;
    targets: ForgetTarget[];
    categoryCounts: CategoryCounts;
    confirmationDiscordMessageId?: string | null;
    topicDiagnosticFingerprint?: string | null;
    ttlMs?: number;
  },
): { previewId: string; expiresAt: string; categoryCounts: CategoryCounts } {
  const lineageId = getAuthoritativeLineageId(continuity);
  const previewId = randomUUID();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (input.ttlMs ?? PREVIEW_TTL_MS)).toISOString();
  continuity.exec("BEGIN IMMEDIATE");
  try {
    continuity
      .prepare(
        `INSERT INTO forget_previews
           (preview_id, owner_id, lineage_id, created_at, expires_at, status,
            category_counts_json, confirmation_discord_message_id, topic_diagnostic_fingerprint)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(
        previewId,
        input.ownerId,
        lineageId,
        createdAt,
        expiresAt,
        JSON.stringify(input.categoryCounts),
        input.confirmationDiscordMessageId ?? null,
        input.topicDiagnosticFingerprint ?? null,
      );
    const insert = continuity.prepare(
      `INSERT INTO forget_preview_targets (preview_id, entity_type, entity_uuid, action)
       VALUES (?, ?, ?, ?)`,
    );
    for (const target of input.targets) {
      insert.run(
        previewId,
        target.entityType,
        target.entityUuid,
        target.action,
      );
    }
    continuity.exec("COMMIT");
  } catch (error) {
    continuity.exec("ROLLBACK");
    throw error;
  }
  return { previewId, expiresAt, categoryCounts: input.categoryCounts };
}

export function bindForgetPreviewDiscordMessage(
  continuity: DatabaseSync,
  input: {
    previewId: string;
    ownerId: string;
    confirmationDiscordMessageId: string;
  },
): void {
  const lineageId = getAuthoritativeLineageId(continuity);
  continuity.exec("BEGIN IMMEDIATE");
  try {
    const preview = continuity
      .prepare(
        `SELECT preview_id, owner_id, lineage_id, status, expires_at,
                confirmation_discord_message_id
         FROM forget_previews WHERE preview_id = ?`,
      )
      .get(input.previewId) as
      | {
          preview_id: string;
          owner_id: string;
          lineage_id: string;
          status: string;
          expires_at: string;
          confirmation_discord_message_id: string | null;
        }
      | undefined;
    if (!preview) throw new Error("forget_preview_missing");
    if (preview.owner_id !== input.ownerId) {
      throw new Error("forget_preview_owner_mismatch");
    }
    if (preview.lineage_id !== lineageId) {
      throw new Error("forget_preview_lineage_mismatch");
    }
    if (preview.status !== "pending") {
      throw new Error("forget_preview_not_pending");
    }
    if (Date.parse(preview.expires_at) <= Date.now()) {
      continuity
        .prepare(
          `UPDATE forget_previews SET status = 'expired' WHERE preview_id = ?`,
        )
        .run(preview.preview_id);
      continuity.exec("COMMIT");
      throw new Error("forget_preview_expired");
    }
    // Idempotent: same message already bound.
    if (
      preview.confirmation_discord_message_id ===
      input.confirmationDiscordMessageId
    ) {
      continuity.exec("COMMIT");
      return;
    }
    if (preview.confirmation_discord_message_id) {
      continuity.exec("ROLLBACK");
      throw new Error("forget_preview_bind_conflict");
    }
    const taken = continuity
      .prepare(
        `SELECT preview_id FROM forget_previews
         WHERE owner_id = ? AND confirmation_discord_message_id = ?
           AND status = 'pending' AND preview_id <> ?`,
      )
      .get(
        input.ownerId,
        input.confirmationDiscordMessageId,
        input.previewId,
      );
    if (taken) {
      continuity.exec("ROLLBACK");
      throw new Error("forget_preview_discord_message_in_use");
    }
    continuity
      .prepare(
        `UPDATE forget_previews
         SET confirmation_discord_message_id = ?
         WHERE preview_id = ? AND owner_id = ? AND status = 'pending'`,
      )
      .run(
        input.confirmationDiscordMessageId,
        input.previewId,
        input.ownerId,
      );
    continuity.exec("COMMIT");
  } catch (error) {
    try {
      continuity.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function resolvePreviewByDiscordMessage(
  continuity: DatabaseSync,
  ownerId: string,
  confirmationDiscordMessageId: string,
): string | null {
  const row = continuity
    .prepare(
      `SELECT preview_id, expires_at, status FROM forget_previews
       WHERE owner_id = ? AND confirmation_discord_message_id = ?`,
    )
    .get(ownerId, confirmationDiscordMessageId) as
    | { preview_id: string; expires_at: string; status: string }
    | undefined;
  if (!row) return null;
  if (row.status !== "pending") return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    continuity
      .prepare(
        `UPDATE forget_previews SET status = 'expired' WHERE preview_id = ?`,
      )
      .run(row.preview_id);
    return null;
  }
  return row.preview_id;
}

export function listPreviewTargets(
  continuity: DatabaseSync,
  previewId: string,
): ForgetTarget[] {
  return (
    continuity
      .prepare(
        `SELECT entity_type, entity_uuid, action FROM forget_preview_targets
         WHERE preview_id = ?`,
      )
      .all(previewId) as Array<{
      entity_type: string;
      entity_uuid: string;
      action: ForgetAction;
    }>
  ).map((row) => ({
    entityType: row.entity_type,
    entityUuid: row.entity_uuid,
    action: row.action,
  }));
}

export function cancelForgetPreview(
  continuity: DatabaseSync,
  previewId: string,
  ownerId: string,
): void {
  continuity
    .prepare(
      `UPDATE forget_previews SET status = 'cancelled'
       WHERE preview_id = ? AND owner_id = ? AND status = 'pending'`,
    )
    .run(previewId, ownerId);
}

/**
 * Convert a pending preview into a pending tombstone with exact stored targets.
 * No targets may be added here.
 */
export function confirmPreviewToTombstone(
  continuity: DatabaseSync,
  input: { previewId: string; ownerId: string },
): { tombstoneId: string; targets: ForgetTarget[]; categoryCounts: CategoryCounts } {
  const lineageId = getAuthoritativeLineageId(continuity);
  continuity.exec("BEGIN IMMEDIATE");
  try {
    const preview = continuity
      .prepare(
        `SELECT preview_id, owner_id, lineage_id, expires_at, status, category_counts_json
         FROM forget_previews WHERE preview_id = ?`,
      )
      .get(input.previewId) as
      | {
          preview_id: string;
          owner_id: string;
          lineage_id: string;
          expires_at: string;
          status: string;
          category_counts_json: string;
        }
      | undefined;
    if (!preview) throw new Error("forget_preview_missing");
    if (preview.owner_id !== input.ownerId) {
      throw new Error("forget_preview_owner_mismatch");
    }
    if (preview.lineage_id !== lineageId) {
      throw new Error("forget_preview_lineage_mismatch");
    }
    if (preview.status !== "pending") {
      throw new Error("forget_preview_not_pending");
    }
    if (Date.parse(preview.expires_at) <= Date.now()) {
      continuity
        .prepare(
          `UPDATE forget_previews SET status = 'expired' WHERE preview_id = ?`,
        )
        .run(preview.preview_id);
      continuity.exec("COMMIT");
      throw new Error("forget_preview_expired");
    }
    const targets = listPreviewTargets(continuity, preview.preview_id);
    const tombstoneId = randomUUID();
    const now = new Date().toISOString();
    const external = {
      discord: "original messages remain under Discord retention",
      mistral: "provider retention cannot be retroactively erased",
      old_backups: "older backup packages may still contain forgotten material",
    };
    continuity
      .prepare(
        `INSERT INTO forget_tombstones
           (tombstone_id, owner_id, lineage_id, preview_id, receipt_id, status,
            created_at, applied_at, category_counts_json, external_non_erasure_json)
         VALUES (?, ?, ?, ?, NULL, 'pending', ?, NULL, ?, ?)`,
      )
      .run(
        tombstoneId,
        input.ownerId,
        lineageId,
        preview.preview_id,
        now,
        preview.category_counts_json,
        JSON.stringify(external),
      );
    const insert = continuity.prepare(
      `INSERT INTO forget_tombstone_targets
         (tombstone_id, entity_type, entity_uuid, action)
       VALUES (?, ?, ?, ?)`,
    );
    for (const target of targets) {
      insert.run(
        tombstoneId,
        target.entityType,
        target.entityUuid,
        target.action,
      );
    }
    continuity
      .prepare(
        `UPDATE forget_previews SET status = 'confirmed' WHERE preview_id = ?`,
      )
      .run(preview.preview_id);
    continuity.exec("COMMIT");
    return {
      tombstoneId,
      targets,
      categoryCounts: JSON.parse(preview.category_counts_json) as CategoryCounts,
    };
  } catch (error) {
    try {
      continuity.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function markTombstoneApplied(
  continuity: DatabaseSync,
  tombstoneId: string,
  receiptId: string | null,
): void {
  continuity
    .prepare(
      `UPDATE forget_tombstones
       SET status = 'applied', applied_at = ?, receipt_id = COALESCE(?, receipt_id)
       WHERE tombstone_id = ?`,
    )
    .run(new Date().toISOString(), receiptId, tombstoneId);
}

export function listTombstoneTargets(
  continuity: DatabaseSync,
  tombstoneId: string,
): ForgetTarget[] {
  return (
    continuity
      .prepare(
        `SELECT entity_type, entity_uuid, action FROM forget_tombstone_targets
         WHERE tombstone_id = ?`,
      )
      .all(tombstoneId) as Array<{
      entity_type: string;
      entity_uuid: string;
      action: ForgetAction;
    }>
  ).map((row) => ({
    entityType: row.entity_type,
    entityUuid: row.entity_uuid,
    action: row.action,
  }));
}

export function listPendingOrAppliedTombstones(
  continuity: DatabaseSync,
  lineageId: string,
): Array<{ tombstoneId: string; ownerId: string; status: string }> {
  return (
    continuity
      .prepare(
        `SELECT tombstone_id, owner_id, status FROM forget_tombstones
         WHERE lineage_id = ? AND status IN ('pending','applied')
         ORDER BY created_at ASC`,
      )
      .all(lineageId) as Array<{
      tombstone_id: string;
      owner_id: string;
      status: string;
    }>
  ).map((row) => ({
    tombstoneId: row.tombstone_id,
    ownerId: row.owner_id,
    status: row.status,
  }));
}
