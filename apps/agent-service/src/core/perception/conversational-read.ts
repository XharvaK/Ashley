import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { htmlToText } from "../curiosity/feed.js";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import type { Decision } from "../types.js";
import { fetchAttachmentBytes } from "./fetch.js";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_MODEL_EXCERPT_CHARS,
  MAX_STORED_EXCERPT_CHARS,
  MAX_URL_LENGTH,
  type ConversationalReadStatus,
  type ModelPartRecord,
} from "./types.js";
import { urlFingerprint } from "./ingest.js";

export type ConversationalReadRecord = {
  id: number;
  entityUuid: string;
  requestedUrl: string;
  status: ConversationalReadStatus;
};

function retentionUntil(now = new Date()): string {
  const until = new Date(now);
  until.setUTCDate(until.getUTCDate() + DEFAULT_RETENTION_DAYS);
  return until.toISOString();
}

export function createPendingRead(
  db: DatabaseSync,
  params: {
    ownerId: string;
    url: string;
    sourceMessageEntityUuid: string;
    deliveryReservationEntityUuid: string;
  },
): ConversationalReadRecord | null {
  const requestedUrl = params.url.trim().slice(0, MAX_URL_LENGTH);
  if (!requestedUrl) return null;
  const entityUuid = assignNewEntityUuid();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO conversational_reads
         (owner_id, entity_uuid, data_classification, source_message_entity_uuid,
          delivery_reservation_entity_uuid, requested_url_fingerprint, evidence_class,
          status, model_representation, model_parts_json, retention_until,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'snippet_only', 'pending', 'none', '[]', ?, ?, ?)`,
    )
    .run(
      params.ownerId,
      entityUuid,
      defaultUnclassifiedConversational(),
      params.sourceMessageEntityUuid,
      params.deliveryReservationEntityUuid,
      urlFingerprint(requestedUrl),
      retentionUntil(),
      now,
      now,
    );
  return {
    id: Number(result.lastInsertRowid),
    entityUuid,
    requestedUrl,
    status: "pending",
  };
}

export function authorizeConversationalRead(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
  decision: Decision,
): boolean {
  if (decision.kind === "refuse" || decision.kind === "silence") {
    return false;
  }
  const decisionEntityUuid =
    decision.id != null
      ? (
          db
            .prepare(
              `SELECT entity_uuid FROM decision_log WHERE id = ? AND owner_id = ?`,
            )
            .get(decision.id, ownerId) as { entity_uuid?: string } | undefined
        )?.entity_uuid ?? null
      : null;
  const now = new Date().toISOString();
  const changes = db
    .prepare(
      `UPDATE conversational_reads
       SET authorization_decision_entity_uuid = ?, updated_at = ?
       WHERE entity_uuid = ? AND owner_id = ? AND status = 'pending'`,
    )
    .run(decisionEntityUuid, now, entityUuid, ownerId).changes;
  return changes > 0;
}

export function transitionConversationalReadStatus(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
  status: ConversationalReadStatus,
  extras?: {
    errorCode?: string | null;
    finalUrlFingerprint?: string | null;
    contentHash?: string | null;
    title?: string | null;
    excerpt?: string | null;
    evidenceClass?: "read_record" | "fetch_failed" | "snippet_only";
    modelParts?: ModelPartRecord[];
  },
): boolean {
  const now = new Date().toISOString();
  return (
    db
      .prepare(
        `UPDATE conversational_reads
         SET status = ?,
             error_code = COALESCE(?, error_code),
             final_url_fingerprint = COALESCE(?, final_url_fingerprint),
             content_hash = COALESCE(?, content_hash),
             title = COALESCE(?, title),
             excerpt = COALESCE(?, excerpt),
             evidence_class = COALESCE(?, evidence_class),
             model_parts_json = COALESCE(?, model_parts_json),
             model_representation = CASE
               WHEN ? = 'included' THEN 'inline_text_excerpt'
               ELSE model_representation
             END,
             updated_at = ?
         WHERE entity_uuid = ? AND owner_id = ?`,
      )
      .run(
        status,
        extras?.errorCode ?? null,
        extras?.finalUrlFingerprint ?? null,
        extras?.contentHash ?? null,
        extras?.title ?? null,
        extras?.excerpt ?? null,
        extras?.evidenceClass ?? null,
        extras?.modelParts ? JSON.stringify(extras.modelParts) : null,
        status,
        now,
        entityUuid,
        ownerId,
      ).changes > 0
  );
}

function extractTitle(rawHtml: string, fallback: string): string {
  const match = rawHtml.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title || fallback.slice(0, 200);
}

function buildModelExcerpt(cleaned: string): { stored: string; model: string } {
  const normalized = cleaned.replace(/\s+\n/g, "\n").trim();
  const stored = normalized.slice(0, MAX_STORED_EXCERPT_CHARS);
  const model = normalized.slice(0, MAX_MODEL_EXCERPT_CHARS);
  return { stored, model };
}

export async function fetchConversationalReadPage(
  db: DatabaseSync,
  params: {
    ownerId: string;
    entityUuid: string;
    url: string;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<{ storedExcerpt: string; modelExcerpt: string; title: string } | null> {
  transitionConversationalReadStatus(
    db,
    params.entityUuid,
    params.ownerId,
    "fetching",
  );
  try {
    const resource = await fetchAttachmentBytes(params.url, {
      timeoutMs: params.timeoutMs,
      maxBytes: 2 * 1024 * 1024,
      signal: params.signal,
    });
    if (resource.mime === "application/pdf") {
      transitionConversationalReadStatus(
        db,
        params.entityUuid,
        params.ownerId,
        "failed",
        { errorCode: "pdf_not_supported", evidenceClass: "fetch_failed" },
      );
      return null;
    }
    if (resource.mime && !/(?:text\/|html|xhtml|xml|json)/.test(resource.mime)) {
      transitionConversationalReadStatus(
        db,
        params.entityUuid,
        params.ownerId,
        "failed",
        { errorCode: "unsupported_content_type", evidenceClass: "fetch_failed" },
      );
      return null;
    }
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(resource.bytes);
    const cleaned = htmlToText(raw).replace(/\s+\n/g, "\n").trim();
    if (cleaned.length < 80) {
      transitionConversationalReadStatus(
        db,
        params.entityUuid,
        params.ownerId,
        "failed",
        { errorCode: "insufficient_content", evidenceClass: "fetch_failed" },
      );
      return null;
    }
    const { stored, model } = buildModelExcerpt(cleaned);
    const title = extractTitle(raw, params.url);
    const contentHash = createHash("sha256").update(cleaned).digest("hex");
    transitionConversationalReadStatus(
      db,
      params.entityUuid,
      params.ownerId,
      "fetched",
      {
        finalUrlFingerprint: urlFingerprint(resource.finalUrl),
        contentHash,
        title,
        excerpt: stored,
        evidenceClass: "read_record",
      },
    );
    return { storedExcerpt: stored, modelExcerpt: model, title };
  } catch (error) {
    const code = error instanceof Error ? error.message : "fetch_failed";
    transitionConversationalReadStatus(
      db,
      params.entityUuid,
      params.ownerId,
      "failed",
      { errorCode: code.slice(0, 120), evidenceClass: "fetch_failed" },
    );
    return null;
  }
}

export function markConversationalReadIncluded(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
  modelParts: ModelPartRecord[],
): boolean {
  return transitionConversationalReadStatus(
    db,
    entityUuid,
    ownerId,
    "included",
    { modelParts },
  );
}

export function getConversationalReadRow(
  db: DatabaseSync,
  entityUuid: string,
  ownerId: string,
): {
  status: ConversationalReadStatus;
  authorizationDecisionEntityUuid: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT status, authorization_decision_entity_uuid
       FROM conversational_reads
       WHERE entity_uuid = ? AND owner_id = ?`,
    )
    .get(entityUuid, ownerId) as {
    status?: string;
    authorization_decision_entity_uuid?: string | null;
  } | undefined;
  if (!row?.status) return null;
  return {
    status: row.status as ConversationalReadStatus,
    authorizationDecisionEntityUuid:
      row.authorization_decision_entity_uuid ?? null,
  };
}
