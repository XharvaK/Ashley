import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fetchAttachmentBytes } from "../../perception/fetch.js";
import { parseAttachmentCsv, resolveAttachmentJsonPath } from "../perception/attachments.js";
import { createPendingArtifacts, transitionArtifactStatus, urlFingerprint } from "../../perception/ingest.js";
import {
  readArtifactBytes,
  readArtifactTextPage,
  storeArtifactBytes,
} from "../../perception/artifact-store.js";
import type { EvidenceProvenanceFacet } from "../../perception/types.js";
import {
  assertArtifactCursorBinding,
  observationViewFromStorage,
  textArtifactRepresentationId,
  type ArtifactCursor,
  type ObservationView,
} from "../observation/view.js";
import { executeWebPageRefresh } from "./web-fetch-operations.js";
import type { WebFetchProvider } from "../../perception/web-fetch-provider.js";
import type { JsonValue, Observation, ObservationRequest } from "../types.js";
import type { SocialAudience } from "../social/types.js";
import {
  CapabilityUnavailableError,
  isValidEvidenceOperationRequest,
  type EvidenceReadRequest,
  type EvidenceRefreshRequest,
  type EvidenceTextSelector,
} from "../thought/typed-inspection.js";

type Row = Record<string, unknown>;

type RetainedText = {
  artifactId: string;
  representationId: string;
  contentHash: string;
  text: string;
  complete: boolean;
  inputTrust: "untrusted_evidence" | null;
  sourceUrl: string | null;
  source: "artifact" | "project" | "page";
  format: "text" | "json" | "csv";
};

type EvidenceRefreshResult = {
  bytes: Uint8Array;
  mime: string;
  finalUrl: string;
  contentHash: string;
};

export type EvidenceRefreshFetcher = (input: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
}) => Promise<EvidenceRefreshResult>;

type EvidenceOperationInput = {
  req: ObservationRequest;
  nuclear: DatabaseSync;
  sidecar?: DatabaseSync;
  ownerId?: string;
  nowMs: () => number;
  refresh?: EvidenceRefreshFetcher;
  webFetch?: WebFetchProvider;
};

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function allowedAudience(value: unknown): value is SocialAudience {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "owner_private") return Object.keys(value).length === 1;
  return value.kind === "owner_dm"
    && Object.keys(value).length === 2
    && typeof value.threadId === "string"
    && value.threadId.trim().length > 0;
}

function audienceOf(req: ObservationRequest): SocialAudience {
  if (!allowedAudience(req.audience)) {
    throw new CapabilityUnavailableError("capability_not_in_live_set");
  }
  return req.audience;
}

function observation(
  req: ObservationRequest,
  payload: Record<string, unknown>,
  provenance: string,
  view?: ObservationView,
): Observation {
  return {
    observationId: `v021:observation:${req.requestId}`,
    cycleId: req.cycleId,
    generation: req.generation,
    derived: false,
    replaySafe: true,
    modality: "text",
    payload,
    provenance,
    dataClassification: "never_public",
    secretOmitted: false,
    ...(view === undefined ? {} : { view }),
  };
}

function mapReadError(error: unknown): never {
  const code = error instanceof Error ? error.message : "evidence_read_failed";
  if (code === "artifact_cursor_artifact_hash_mismatch") {
    throw new CapabilityUnavailableError("artifact_version_mismatch");
  }
  if (code === "artifact_cursor_binding_mismatch") {
    throw new CapabilityUnavailableError("cursor_binding_mismatch");
  }
  if (code === "artifact_cursor_invalid") {
    throw new CapabilityUnavailableError("cursor_invalid");
  }
  if (code === "artifact_owner_mismatch" || code === "artifact_not_found") {
    throw new CapabilityUnavailableError("artifact_unavailable");
  }
  if (code === "artifact_not_preserved" || code === "artifact_corrupt") {
    throw new CapabilityUnavailableError("artifact_unavailable");
  }
  if (code === "artifact_not_utf8") {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  throw new CapabilityUnavailableError(code);
}

function currentArtifactRow(
  db: DatabaseSync,
  artifactId: string,
  ownerId: string,
): Row {
  const row = db.prepare(
    `SELECT entity_uuid, owner_id, status, content_hash, mime_declared, mime_detected,
            preserved, url_fingerprint, discord_attachment_id,
            source_message_entity_uuid, delivery_reservation_entity_uuid
       FROM perception_artifacts
      WHERE entity_uuid = ?`,
  ).get(artifactId) as Row | undefined;
  if (!row) throw new Error("artifact_not_found");
  if (row.owner_id !== ownerId) throw new Error("artifact_owner_mismatch");
  return row;
}

function textMime(value: unknown): boolean {
  const mime = typeof value === "string" ? value.split(";", 1)[0]!.trim().toLowerCase() : "";
  return mime.startsWith("text/")
    || mime === "application/json"
    || mime === "text/json"
    || mime === "text/csv"
    || mime === "application/csv"
    || mime === "application/xml"
    || mime === "application/javascript";
}

function sidecarTextCapture(
  sidecar: DatabaseSync,
  artifactId: string,
  representationId: string,
  ownerId: string,
): RetainedText | null {
  const row = sidecar.prepare(
    `SELECT o.payload_json, o.parent_artifact_id, o.representation_id,
            o.view_metadata_json, o.data_classification, o.secret_omitted,
            o.modality, o.provenance
       FROM observations o
       JOIN cycle_records c ON c.cycle_id = o.cycle_id AND c.generation = o.generation
      WHERE o.parent_artifact_id = ?
        AND o.representation_id = ?
        AND c.occupant_id = ?
        AND o.secret_omitted = 0
        AND lower(o.data_classification) NOT IN ('secret', 'forgotten')
        AND ((o.modality = 'tool' AND o.provenance = 'sandbox-v2:project-inspection')
          OR (o.modality = 'page' AND o.provenance = 'perception:web-fetch'))
      ORDER BY o.created_at_ms DESC, o.observation_id DESC
      LIMIT 1`,
  ).get(artifactId, representationId, ownerId) as Row | undefined;
  if (!row) return null;
  let view: ObservationView | null;
  let payload: unknown;
  try {
    view = observationViewFromStorage(
      row.parent_artifact_id,
      row.representation_id,
      row.view_metadata_json,
    );
    payload = JSON.parse(String(row.payload_json));
  } catch {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  if (!view || view.parentArtifactId !== artifactId || view.representationId !== representationId) {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  if (!isRecord(payload)
    || typeof payload.contentUtf8 !== "string"
    || typeof payload.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(payload.sha256)) {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  const source = row.modality === "page" ? "page" : "project";
  if (source === "page" && (typeof payload.requestedUrl !== "string" || payload.requestedUrl.trim().length === 0)) {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  const sourceUrl = source === "page" ? String(payload.requestedUrl) : null;
  return {
    artifactId,
    representationId,
    contentHash: payload.sha256,
    text: payload.contentUtf8,
    complete: payload.truncated !== true && view.completeness !== "partial",
    inputTrust: source === "page" ? "untrusted_evidence" : null,
    sourceUrl,
    source,
    format: "text",
  };
}

function retainedArtifactHash(row: Row): string {
  const hash = requiredText(row.content_hash);
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || Number(row.preserved ?? 0) !== 1) {
    throw new Error("artifact_not_preserved");
  }
  return hash;
}

function artifactTextCapture(
  db: DatabaseSync,
  artifactId: string,
  representationId: string,
  ownerId: string,
): RetainedText {
  const row = currentArtifactRow(db, artifactId, ownerId);
  if (!textMime(row.mime_detected ?? row.mime_declared)) {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  const expectedRepresentation = textArtifactRepresentationId(artifactId);
  if (representationId !== expectedRepresentation) {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  const mime = String(row.mime_detected ?? row.mime_declared ?? "").split(";", 1)[0]!.trim().toLowerCase();
  return {
    artifactId,
    representationId,
    contentHash: retainedArtifactHash(row),
    text: "",
    complete: true,
    inputTrust: "untrusted_evidence",
    sourceUrl: null,
    source: "artifact",
    format: mime === "application/json" || mime === "text/json"
      ? "json"
      : mime === "text/csv" || mime === "application/csv"
        ? "csv"
        : "text",
  };
}

function continuationOffset(cursor: ArtifactCursor | undefined): number | null {
  if (!cursor || !isRecord(cursor.continuation)) return null;
  return typeof cursor.continuation.offsetChars === "number"
    && Number.isSafeInteger(cursor.continuation.offsetChars)
    && cursor.continuation.offsetChars >= 0
    ? cursor.continuation.offsetChars
    : null;
}

function continuationLineStart(cursor: ArtifactCursor | undefined): number | null {
  if (!cursor || !isRecord(cursor.continuation)) return null;
  return typeof cursor.continuation.startLine === "number"
    && Number.isSafeInteger(cursor.continuation.startLine)
    && cursor.continuation.startLine >= 1
    ? cursor.continuation.startLine
    : null;
}

function textPage(
  source: RetainedText,
  selector: EvidenceTextSelector,
  cursor?: ArtifactCursor,
  audience: SocialAudience = { kind: "owner_private" },
): {
  text: string;
  offsetChars: number;
  totalChars: number;
  returnedSelector: JsonValue;
  nextCursor: ArtifactCursor | null;
} {
  if (selector.kind === "text_window") {
    const offsetChars = continuationOffset(cursor) ?? selector.offsetChars;
    if (!source.complete && offsetChars > source.text.length) {
      throw new CapabilityUnavailableError("representation_unavailable");
    }
    const text = source.source === "artifact"
      ? source.text.slice(offsetChars, offsetChars + selector.limitChars)
      : source.text.slice(offsetChars, offsetChars + selector.limitChars);
    const totalChars = source.source === "artifact" ? source.text.length : source.text.length;
    const end = offsetChars + text.length;
    const hasMore = source.complete && end < totalChars;
    return {
      text,
      offsetChars,
      totalChars,
      returnedSelector: { kind: "text_window", offsetChars, limitChars: selector.limitChars },
      nextCursor: hasMore ? {
        schema: "ashley.artifact_cursor.v1",
        artifactId: source.artifactId,
        artifactHash: source.contentHash,
        representationId: source.representationId,
        selector,
        audience: cursor?.audience ?? audience,
        continuation: { offsetChars: end },
      } : null,
    };
  }

  if (selector.kind !== "text_lines") {
    throw new CapabilityUnavailableError("representation_unavailable");
  }

  const lines = source.text.split("\n");
  const startLine = continuationLineStart(cursor) ?? selector.startLine;
  const lineCount = selector.endLine - selector.startLine;
  const endLine = Math.min(lines.length + 1, startLine + lineCount);
  const startIndex = Math.max(0, startLine - 1);
  const endIndex = Math.max(startIndex, Math.min(lines.length, endLine - 1));
  const text = lines.slice(startIndex, endIndex).join("\n");
  const offsetChars = lines.slice(0, startIndex).join("\n").length + (startIndex > 0 ? 1 : 0);
  const hasMore = source.complete && endIndex < lines.length;
  return {
    text,
    offsetChars,
    totalChars: source.text.length,
    returnedSelector: { kind: "text_lines", startLine, endLine },
    nextCursor: hasMore ? {
      schema: "ashley.artifact_cursor.v1",
      artifactId: source.artifactId,
      artifactHash: source.contentHash,
      representationId: source.representationId,
      selector,
      audience: cursor?.audience ?? audience,
      continuation: { startLine: endLine },
    } : null,
  };
}

function bindCursor(
  value: unknown,
  source: RetainedText,
  selector: EvidenceTextSelector,
  audience: SocialAudience,
): ArtifactCursor | undefined {
  if (value === undefined) return undefined;
  try {
    assertArtifactCursorBinding(value, {
      artifactId: source.artifactId,
      artifactHash: source.contentHash,
      representationId: source.representationId,
      selector,
      audience,
    });
    return value;
  } catch (error) {
    mapReadError(error);
  }
}

function readPerceptionPage(
  db: DatabaseSync,
  source: RetainedText,
  selector: EvidenceTextSelector,
  ownerId: string,
  cursor?: ArtifactCursor,
): RetainedText {
  if (selector.kind === "text_window") {
    const offsetChars = continuationOffset(cursor) ?? selector.offsetChars;
    try {
      const page = readArtifactTextPage(db, source.artifactId, offsetChars, selector.limitChars, ownerId);
      return { ...source, text: page.text };
    } catch (error) {
      mapReadError(error);
    }
  }
  if (selector.kind !== "text_lines") {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  try {
    const bytes = readArtifactBytes(db, source.artifactId, ownerId);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ...source, text };
  } catch (error) {
    mapReadError(error);
  }
}

function structuredItemCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object" && value !== null) return Object.keys(value).length;
  return 1;
}

function executeStructuredRead(
  input: EvidenceOperationInput,
  source: RetainedText,
  request: EvidenceReadRequest,
  audience: SocialAudience,
): Observation {
  if (source.source !== "artifact") {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  const selector = request.selector;
  if (selector.kind === "json_path" && source.format !== "json") {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  if (selector.kind === "csv_range" && source.format !== "csv") {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      readArtifactBytes(input.nuclear, source.artifactId, String(input.ownerId)),
    );
  } catch (error) {
    mapReadError(error);
  }
  if (selector.kind === "json_path") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      const selected = resolveAttachmentJsonPath(parsed, selector.path);
      if (structuredItemCount(selected) > selector.maxItems
        || JSON.stringify(selected).length > selector.maxChars) {
        throw new CapabilityUnavailableError("structured_extent_limit");
      }
      const returnedSelector = {
        kind: "json_path",
        path: selector.path,
        maxItems: selector.maxItems,
        maxChars: selector.maxChars,
      } as const;
      return observation(input.req, {
        artifactId: source.artifactId,
        representationId: source.representationId,
        artifactHash: source.contentHash,
        audience,
        format: "json",
        selector,
        returnedSelector,
        value: selected,
        inputTrust: "untrusted_evidence",
      }, "perception:artifact-read", {
        parentArtifactId: source.artifactId,
        representationId: source.representationId,
        derivation: "artifact_read",
        requestedSelector: selector,
        returnedSelector,
        completeness: "complete",
        omission: null,
        continuation: null,
        errors: [],
        contentHashBasis: "retained_bytes",
        inputTrust: "untrusted_evidence",
      });
    } catch (error) {
      if (error instanceof CapabilityUnavailableError) throw error;
      throw new CapabilityUnavailableError("structured_path_unresolved");
    }
  }

  if (selector.kind !== "csv_range") {
    throw new CapabilityUnavailableError("representation_unavailable");
  }

  let rows: string[][];
  try {
    rows = parseAttachmentCsv(text);
  } catch {
    throw new CapabilityUnavailableError("structured_parse_failed");
  }
  if (selector.startRow < 0 || selector.endRow > rows.length
    || selector.startColumn < 0
    || rows.some((row) => selector.endColumn > row.length)) {
    throw new CapabilityUnavailableError("structured_range_unresolved");
  }
  const selectedRows = rows.slice(selector.startRow, selector.endRow).map((row) =>
    row.slice(selector.startColumn, selector.endColumn));
  const returnedSelector = {
    kind: "csv_range",
    startRow: selector.startRow,
    endRow: selector.endRow,
    startColumn: selector.startColumn,
    endColumn: selector.endColumn,
  } as const;
  return observation(input.req, {
    artifactId: source.artifactId,
    representationId: source.representationId,
    artifactHash: source.contentHash,
    audience,
    format: "csv",
    selector,
    returnedSelector,
    rows: selectedRows,
    inputTrust: "untrusted_evidence",
  }, "perception:artifact-read", {
    parentArtifactId: source.artifactId,
    representationId: source.representationId,
    derivation: "artifact_read",
    requestedSelector: selector,
    returnedSelector,
    completeness: "complete",
    omission: null,
    continuation: null,
    errors: [],
    contentHashBasis: "retained_bytes",
    inputTrust: "untrusted_evidence",
  });
}

async function executeRead(input: EvidenceOperationInput, request: EvidenceReadRequest): Promise<Observation> {
  const ownerId = requiredText(input.ownerId);
  if (!ownerId) throw new CapabilityUnavailableError("inspect_scope_unavailable");
  const audience = audienceOf(input.req);
  let source: RetainedText | null = null;
  if (input.sidecar) {
    source = sidecarTextCapture(input.sidecar, request.artifactId, request.representationId, ownerId);
  }
  if (!source) {
    try {
      source = artifactTextCapture(input.nuclear, request.artifactId, request.representationId, ownerId);
    } catch (error) {
      if (error instanceof CapabilityUnavailableError && error.reasonCode === "representation_unavailable") throw error;
      mapReadError(error);
    }
  }
  if (!source) throw new CapabilityUnavailableError("artifact_unavailable");

  if (request.selector.kind === "json_path" || request.selector.kind === "csv_range") {
    return executeStructuredRead(input, source, request, audience);
  }

  const cursor = bindCursor(request.cursor, source, request.selector, audience);
  let page: ReturnType<typeof textPage>;
  if (source.source === "artifact" && request.selector.kind === "text_window") {
    const offsetChars = continuationOffset(cursor) ?? request.selector.offsetChars;
    let artifactPage;
    try {
      artifactPage = readArtifactTextPage(
        input.nuclear,
        source.artifactId,
        offsetChars,
        request.selector.limitChars,
        ownerId,
      );
    } catch (error) {
      mapReadError(error);
    }
    const end = offsetChars + artifactPage.text.length;
    page = {
      text: artifactPage.text,
      offsetChars,
      totalChars: artifactPage.totalChars,
      returnedSelector: { kind: "text_window", offsetChars, limitChars: request.selector.limitChars },
      nextCursor: end < artifactPage.totalChars ? {
        schema: "ashley.artifact_cursor.v1",
        artifactId: source.artifactId,
        artifactHash: source.contentHash,
        representationId: source.representationId,
        selector: request.selector,
        audience,
        continuation: { offsetChars: end },
      } : null,
    };
  } else {
    const prepared = source.source === "artifact"
      ? readPerceptionPage(input.nuclear, source, request.selector, ownerId, cursor)
      : source;
    page = textPage(prepared, request.selector, cursor, audience);
  }
  return observation(input.req, {
    artifactId: source.artifactId,
    representationId: source.representationId,
    artifactHash: source.contentHash,
    audience,
    selector: request.selector,
    returnedSelector: page.returnedSelector,
    text: page.text,
    offsetChars: page.offsetChars,
    limitChars: request.selector.kind === "text_window" ? request.selector.limitChars : page.text.length,
    totalChars: page.totalChars,
    completeness: source.complete ? "complete" : "partial",
    omission: source.complete ? null : { reason: "source_truncated" },
    nextCursor: page.nextCursor,
    inputTrust: source.inputTrust,
    accessLimits: ["owner_audience_bound", "typed_selector", "retained_version_only"],
  }, source.source === "artifact"
    ? "perception:artifact-read"
    : source.source === "page"
      ? "perception:web-page-read"
      : "sandbox-v2:project-evidence-read", {
    parentArtifactId: source.artifactId,
    representationId: source.representationId,
    requestedSelector: request.selector,
    returnedSelector: page.returnedSelector,
    completeness: source.complete ? "complete" : "partial",
    omission: source.complete ? null : { reason: "source_truncated" },
    continuation: page.nextCursor,
    errors: [],
    contentHashBasis: source.source === "artifact"
      ? "retained_bytes"
      : source.source === "page"
        ? "cleaned_utf8"
        : "raw_bytes",
    ...(source.inputTrust === null ? {} : { inputTrust: source.inputTrust }),
  });
}

function refreshProvenance(
  artifactId: string,
  sourceUrl: string,
  hash: string,
  nowMs: number,
): EvidenceProvenanceFacet {
  return {
    sourceIdentity: `url:${urlFingerprint(sourceUrl)}`,
    evidenceIdentity: `sha256:${hash}`,
    capturedAt: new Date(nowMs).toISOString(),
    citationRefs: [`artifact:${artifactId}`],
    completeness: "complete",
  };
}

async function executeRefresh(input: EvidenceOperationInput, request: EvidenceRefreshRequest): Promise<Observation> {
  const ownerId = requiredText(input.ownerId);
  if (!ownerId) throw new CapabilityUnavailableError("inspect_scope_unavailable");
  const audience = audienceOf(input.req);
  const pageSource = input.sidecar
    ? sidecarTextCapture(input.sidecar, request.artifactId, request.representationId, ownerId)
    : null;
  if (pageSource?.source === "page") {
    if (!pageSource.sourceUrl || urlFingerprint(request.sourceUrl) !== urlFingerprint(pageSource.sourceUrl)) {
      throw new CapabilityUnavailableError("refresh_source_mismatch");
    }
    if (!input.webFetch) throw new CapabilityUnavailableError("web_fetch_unavailable");
    return executeWebPageRefresh({
      req: input.req,
      provider: input.webFetch,
      sourceUrl: pageSource.sourceUrl,
      artifactId: request.artifactId,
      representationId: request.representationId,
      previousContentHash: pageSource.contentHash,
      nowMs: input.nowMs,
    });
  }
  let row: Row;
  try {
    row = currentArtifactRow(input.nuclear, request.artifactId, ownerId);
  } catch (error) {
    mapReadError(error);
  }
  if (request.representationId !== textArtifactRepresentationId(request.artifactId)) {
    throw new CapabilityUnavailableError("representation_unavailable");
  }
  if (typeof row.url_fingerprint !== "string" || urlFingerprint(request.sourceUrl) !== row.url_fingerprint) {
    throw new CapabilityUnavailableError("refresh_source_mismatch");
  }
  if (row.status === "redacted" || row.status === "expired") {
    throw new CapabilityUnavailableError("artifact_unavailable");
  }
  const fetcher = input.refresh ?? (async (fetchInput) => fetchAttachmentBytes(fetchInput.url, {
    timeoutMs: fetchInput.timeoutMs,
    maxBytes: fetchInput.maxBytes,
  }));
  let fetched: EvidenceRefreshResult;
  try {
    fetched = await fetcher({ url: request.sourceUrl, timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 });
  } catch {
    throw new CapabilityUnavailableError("refresh_failed");
  }
  if (!(fetched.bytes instanceof Uint8Array) || typeof fetched.mime !== "string" || typeof fetched.finalUrl !== "string") {
    throw new CapabilityUnavailableError("refresh_result_invalid");
  }
  const hash = createHash("sha256").update(fetched.bytes).digest("hex");
  if (hash !== fetched.contentHash) throw new CapabilityUnavailableError("refresh_result_invalid");
  const checkedAtMs = input.nowMs();
  const previousHash = requiredText(row.content_hash);
  if (previousHash === hash) {
    return observation(input.req, {
      unchanged: true,
      checkedAtMs,
      validator: "sha256",
      artifactId: request.artifactId,
      representationId: request.representationId,
      contentHash: hash,
      audience,
    }, "perception:artifact-refresh");
  }

  const created = createPendingArtifacts(input.nuclear, {
    ownerId,
    attachments: [{
      discordAttachmentId: `${String(row.discord_attachment_id ?? request.artifactId)}:refresh:${input.req.requestId}`,
      sourceUrl: request.sourceUrl,
      fileName: "refresh.txt",
      declaredMime: fetched.mime,
      declaredByteSize: fetched.bytes.byteLength,
    }],
    sourceMessageEntityUuid: `${String(row.source_message_entity_uuid ?? request.artifactId)}:refresh:${input.req.requestId}`,
    deliveryReservationEntityUuid: `${String(row.delivery_reservation_entity_uuid ?? request.artifactId)}:refresh:${input.req.requestId}`,
    aggregateTurnBytes: fetched.bytes.byteLength,
  });
  const next = created[0];
  if (!next) throw new CapabilityUnavailableError("refresh_persist_failed");
  transitionArtifactStatus(input.nuclear, next.entityUuid, ownerId, "fetched", {
    mimeDetected: fetched.mime,
    finalUrlFingerprint: urlFingerprint(fetched.finalUrl),
    contentHash: hash,
    byteSize: fetched.bytes.byteLength,
    provenance: refreshProvenance(next.entityUuid, fetched.finalUrl, hash, checkedAtMs),
  });
  try {
    storeArtifactBytes(input.nuclear, ownerId, next.entityUuid, fetched.bytes, fetched.mime,
      refreshProvenance(next.entityUuid, fetched.finalUrl, hash, checkedAtMs));
  } catch {
    throw new CapabilityUnavailableError("refresh_persist_failed");
  }
  return observation(input.req, {
    unchanged: false,
    checkedAtMs,
    validator: "sha256",
    previousArtifactId: request.artifactId,
    previousContentHash: previousHash,
    artifactId: next.entityUuid,
    representationId: textArtifactRepresentationId(next.entityUuid),
    contentHash: hash,
    audience,
  }, "perception:artifact-refresh");
}

export async function executeEvidenceOperation(input: EvidenceOperationInput): Promise<Observation> {
  if (!isValidEvidenceOperationRequest(input.req.kind, input.req.request)) {
    throw new CapabilityUnavailableError("evidence_request_invalid");
  }
  if (input.req.kind === "evidence.read") {
    return executeRead(input, input.req.request as EvidenceReadRequest);
  }
  return executeRefresh(input, input.req.request as EvidenceRefreshRequest);
}
