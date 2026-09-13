import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_FILENAME_LENGTH,
  MAX_URL_LENGTH,
  type AttachmentIntakeRef,
  type ModelPartRecord,
  type ModelRepresentation,
  type PerceptionArtifactStatus,
} from "./types.js";

export type PendingArtifactRecord = {
  id: number;
  entityUuid: string;
  discordAttachmentId: string;
  declaredMime: string;
  fileName: string;
  sourceUrl: string;
};

function retentionUntil(now = new Date()): string {
  const until = new Date(now);
  until.setUTCDate(until.getUTCDate() + DEFAULT_RETENTION_DAYS);
  return until.toISOString();
}

export function urlFingerprint(url: string): string {
  return createHash("sha256").update(url.trim()).digest("hex");
}

function isPdfMime(mime: string): boolean {
  return mime.trim().toLowerCase() === "application/pdf";
}

export function buildInlineDataUri(bytes: Uint8Array, mime: string): string {
  const normalized = mime.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  return `data:${normalized};base64,${Buffer.from(bytes).toString("base64")}`;
}

export function createPendingArtifacts(
  db: DatabaseSync,
  params: {
    ownerId: string;
    attachments: AttachmentIntakeRef[];
    sourceMessageEntityUuid: string;
    deliveryReservationEntityUuid: string;
    aggregateTurnBytes: number;
  },
): PendingArtifactRecord[] {
  const now = new Date().toISOString();
  const classification = defaultUnclassifiedConversational();
  const retention = retentionUntil();
  const insert = db.prepare(
    `INSERT INTO perception_artifacts
       (owner_id, entity_uuid, data_classification, source_kind,
        discord_attachment_id, source_message_entity_uuid,
        delivery_reservation_entity_uuid, url_fingerprint, mime_declared,
        byte_size, aggregate_turn_bytes, status, model_representation,
        model_parts_json, retention_until, created_at, updated_at)
     VALUES (?, ?, ?, 'discord_attachment', ?, ?, ?, ?, ?, ?, ?, 'pending', 'none', '[]', ?, ?, ?)`,
  );
  const created: PendingArtifactRecord[] = [];
  for (const attachment of params.attachments.slice(0, MAX_ATTACHMENTS_PER_TURN)) {
    const entityUuid = assignNewEntityUuid();
    const sourceUrl = attachment.sourceUrl.trim().slice(0, MAX_URL_LENGTH);
    const declaredMime = attachment.declaredMime.trim().slice(0, 200);
    const fileName = attachment.fileName.trim().slice(0, MAX_FILENAME_LENGTH);
    if (!sourceUrl || !attachment.discordAttachmentId) continue;
    if (isPdfMime(declaredMime)) {
      const result = insert.run(
        params.ownerId,
        entityUuid,
        classification,
        attachment.discordAttachmentId,
        params.sourceMessageEntityUuid,
        params.deliveryReservationEntityUuid,
        urlFingerprint(sourceUrl),
        declaredMime,
        attachment.declaredByteSize ?? 0,
        params.aggregateTurnBytes,
        retention,
        now,
        now,
      );
      transitionArtifactStatus(db, entityUuid, params.ownerId, "unsupported", {
        errorCode: "pdf_not_supported",
      });
      created.push({
        id: Number(result.lastInsertRowid),
        entityUuid,
        discordAttachmentId: attachment.discordAttachmentId,
        declaredMime,
        fileName,
        sourceUrl,
      });
      continue;
    }
    const result = insert.run(
      params.ownerId,
      entityUuid,
      classification,
      attachment.discordAttachmentId,
      params.sourceMessageEntityUuid,
      params.deliveryReservationEntityUuid,
      urlFingerprint(sourceUrl),
      declaredMime,
      attachment.declaredByteSize ?? 0,
      params.aggregateTurnBytes,
      retention,
      now,
      now,
    );
    created.push({
      id: Number(result.lastInsertRowid),
      entityUuid,
      discordAttachmentId: attachment.discordAttachmentId,
      declaredMime,
      fileName,
      sourceUrl,
    });
  }
  return created;
}

export function transitionArtifactStatus(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
  status: PerceptionArtifactStatus,
  extras?: {
    errorCode?: string | null;
    mimeDetected?: string | null;
    finalUrlFingerprint?: string | null;
    contentHash?: string | null;
    byteSize?: number;
    modelRepresentation?: ModelRepresentation;
    excerpt?: string | null;
  },
): boolean {
  const now = new Date().toISOString();
  const changes = db
    .prepare(
      `UPDATE perception_artifacts
       SET status = ?,
           error_code = COALESCE(?, error_code),
           mime_detected = COALESCE(?, mime_detected),
           final_url_fingerprint = COALESCE(?, final_url_fingerprint),
           content_hash = COALESCE(?, content_hash),
           byte_size = COALESCE(?, byte_size),
           model_representation = COALESCE(?, model_representation),
           excerpt = COALESCE(?, excerpt),
           updated_at = ?
       WHERE entity_uuid = ? AND owner_id = ?`,
    )
    .run(
      status,
      extras?.errorCode ?? null,
      extras?.mimeDetected ?? null,
      extras?.finalUrlFingerprint ?? null,
      extras?.contentHash ?? null,
      extras?.byteSize ?? null,
      extras?.modelRepresentation ?? null,
      extras?.excerpt ?? null,
      now,
      entityUuid,
      ownerId,
    ).changes;
  return changes > 0;
}

export function markArtifactIncluded(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
  modelParts: ModelPartRecord[],
  options?: {
    modelRepresentation?: ModelRepresentation;
    excerpt?: string | null;
  },
): boolean {
  const now = new Date().toISOString();
  const representation =
    options?.modelRepresentation ??
    (modelParts.length > 0 ? "inline_base64" : "none");
  const changes = db
    .prepare(
      `UPDATE perception_artifacts
       SET status = 'included',
           model_representation = ?,
           model_parts_json = ?,
           excerpt = COALESCE(?, excerpt),
           updated_at = ?
       WHERE entity_uuid = ? AND owner_id = ?`,
    )
    .run(
      representation,
      JSON.stringify(modelParts),
      options?.excerpt ?? null,
      now,
      entityUuid,
      ownerId,
    ).changes;
  return changes > 0;
}

export function getArtifactRow(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
): {
  status: PerceptionArtifactStatus;
  declaredMime: string;
  mimeDetected: string | null;
  byteSize: number;
} | null {
  const row = db
    .prepare(
      `SELECT status, mime_declared, mime_detected, byte_size
       FROM perception_artifacts
       WHERE entity_uuid = ? AND owner_id = ?`,
    )
    .get(entityUuid, ownerId) as {
    status?: string;
    mime_declared?: string;
    mime_detected?: string | null;
    byte_size?: number;
  } | undefined;
  if (!row?.status) return null;
  return {
    status: row.status as PerceptionArtifactStatus,
    declaredMime: String(row.mime_declared ?? ""),
    mimeDetected: row.mime_detected ?? null,
    byteSize: Number(row.byte_size ?? 0),
  };
}

export function isImageMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("image/");
}

export function isTextMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/xml" ||
    normalized === "application/javascript"
  );
}

export function markPdfUnsupported(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
): void {
  transitionArtifactStatus(db, entityUuid, ownerId, "unsupported", {
    errorCode: "pdf_not_supported",
  });
}
