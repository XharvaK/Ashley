import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { htmlToText } from "../curiosity/feed.js";
import {
  fetchWithAggregateLimits,
  type FetchLike,
  type ResolveHost,
} from "../curiosity/network.js";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import type { Decision } from "../types.js";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_MODEL_EXCERPT_CHARS,
  MAX_STORED_EXCERPT_CHARS,
  MAX_URL_LENGTH,
  type ConversationalReadStatus,
  type EvidenceProvenanceFacet,
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

function boundedExcerpt(
  normalized: string,
  maximum: number,
  marker: string | null,
): string {
  if (!marker) return normalized.slice(0, maximum);
  if (normalized.length + marker.length + 2 <= maximum) {
    return `${normalized}\n\n${marker}`;
  }
  const contentMaximum = Math.max(0, maximum - marker.length - 2);
  return `${normalized.slice(0, contentMaximum).trimEnd()}\n\n${marker}`;
}

function buildModelExcerpt(
  cleaned: string,
  marker: string | null = null,
): { stored: string; model: string } {
  const normalized = cleaned.replace(/\s+\n/g, "\n").trim();
  const stored = boundedExcerpt(normalized, MAX_STORED_EXCERPT_CHARS, marker);
  const model = boundedExcerpt(normalized, MAX_MODEL_EXCERPT_CHARS, marker);
  return { stored, model };
}

function contentTypeIsUnsupported(contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return Boolean(normalized) && !/(?:text\/|html|xhtml|xml|json)/.test(normalized);
}

function evidenceProvenance(
  entityUuid: string,
  pageIndex: number,
  finalUrl: string,
  cleaned: string,
  capturedAt: string,
  completeness: EvidenceProvenanceFacet["completeness"],
): EvidenceProvenanceFacet {
  const contentHash = createHash("sha256").update(cleaned).digest("hex");
  return {
    sourceIdentity: `url:${urlFingerprint(finalUrl)}`,
    evidenceIdentity: `sha256:${contentHash}`,
    capturedAt,
    citationRefs: [`conversational-read:${entityUuid}:page:${pageIndex}`],
    completeness,
  };
}

export async function fetchConversationalReadPage(
  db: DatabaseSync,
  params: {
    ownerId: string;
    entityUuid: string;
    url: string;
    urls?: readonly string[];
    timeoutMs: number;
    signal?: AbortSignal;
    fetcher?: FetchLike;
    resolve?: ResolveHost;
  },
): Promise<{
  storedExcerpt: string;
  modelExcerpt: string;
  title: string;
  provenance: EvidenceProvenanceFacet[];
  aggregateProvenance: EvidenceProvenanceFacet;
  modelParts: ModelPartRecord[];
  completeness: EvidenceProvenanceFacet["completeness"];
} | null> {
  transitionConversationalReadStatus(
    db,
    params.entityUuid,
    params.ownerId,
    "fetching",
  );
  try {
    const urls = [...new Set([
      params.url,
      ...(params.urls ?? []),
    ].map((url) => url.trim()).filter(Boolean))];
    const aggregate = await fetchWithAggregateLimits(urls, {
      accept: "text/html, text/plain, application/json, application/xml",
      timeoutMs: params.timeoutMs,
      signal: params.signal,
      fetcher: params.fetcher,
      resolve: params.resolve,
      outboundPurpose: "perception_http",
      userAgent: "AshleyPerception/1.0",
    });
    if (aggregate.pages.some((page) => {
      const normalized = page.contentType.split(";", 1)[0]?.trim().toLowerCase();
      return normalized === "application/pdf" || contentTypeIsUnsupported(page.contentType);
    })) {
      transitionConversationalReadStatus(
        db,
        params.entityUuid,
        params.ownerId,
        "failed",
        { errorCode: "unsupported_content_type", evidenceClass: "fetch_failed" },
      );
      return null;
    }

    const pageTexts = aggregate.pages.map((page) => ({
      raw: new TextDecoder("utf-8", { fatal: false }).decode(page.body),
      cleaned: htmlToText(
        new TextDecoder("utf-8", { fatal: false }).decode(page.body),
      ).replace(/\s+\n/g, "\n").trim(),
    }));
    const cleaned = pageTexts
      .map((page) => page.cleaned)
      .filter(Boolean)
      .join("\n\n")
      .trim();
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

    const completeness: EvidenceProvenanceFacet["completeness"] =
      aggregate.envelope.truncated
        ? "truncated_at_limit"
        : aggregate.envelope.incomplete
          ? "incomplete"
          : "complete";
    const capturedAt = new Date().toISOString();
    const provenance = pageTexts.flatMap((page, index) => {
      const fetchedPage = aggregate.pages[index];
      if (!fetchedPage || !page.cleaned) return [];
      return [evidenceProvenance(
        params.entityUuid,
        index,
        fetchedPage.finalUrl,
        page.cleaned,
        capturedAt,
        completeness,
      )];
    });
    if (provenance.length === 0) {
      transitionConversationalReadStatus(
        db,
        params.entityUuid,
        params.ownerId,
        "failed",
        { errorCode: "insufficient_content", evidenceClass: "fetch_failed" },
      );
      return null;
    }
    const contentHash = createHash("sha256").update(cleaned).digest("hex");
    const aggregateProvenance: EvidenceProvenanceFacet = {
      sourceIdentity: provenance.length === 1
        ? provenance[0]!.sourceIdentity
        : `aggregate:${params.entityUuid}`,
      evidenceIdentity: `sha256:${contentHash}`,
      capturedAt,
      citationRefs: provenance.flatMap((facet) => facet.citationRefs),
      completeness,
    };
    const marker = aggregate.envelope.truncationMarker;
    const { stored, model } = buildModelExcerpt(cleaned, marker);
    const firstRaw = pageTexts[0]?.raw ?? "";
    const title = extractTitle(firstRaw, params.url);
    const modelParts: ModelPartRecord[] = provenance.map((facet, index) => ({
      audience: "thought",
      partIndex: index,
      provenance: facet,
    }));
    transitionConversationalReadStatus(
      db,
      params.entityUuid,
      params.ownerId,
      "fetched",
      {
        finalUrlFingerprint: urlFingerprint(aggregate.pages[0]?.finalUrl ?? params.url),
        contentHash,
        title,
        excerpt: stored,
        evidenceClass: "read_record",
        modelParts,
      },
    );
    return {
      storedExcerpt: stored,
      modelExcerpt: model,
      title,
      provenance,
      aggregateProvenance,
      modelParts,
      completeness,
    };
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
