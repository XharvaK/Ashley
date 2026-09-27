import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  MAX_AGGREGATE_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_MODEL_EXCERPT_CHARS,
  MAX_SINGLE_ATTACHMENT_BYTES,
  type AttachmentSourceClass,
  type AttachmentIntakeRef,
} from "../../perception/types.js";
import { fetchAttachmentBytes, type FetchAttachmentResult } from "../../perception/fetch.js";
import {
  createPendingArtifacts,
  buildInlineDataUri,
  transitionArtifactStatus,
} from "../../perception/ingest.js";
import {
  storeArtifactBytes,
} from "../../perception/artifact-store.js";
import type { JsonValue, Observation } from "../types.js";
import {
  imageArtifactRepresentationId,
  textArtifactRepresentationId,
  type ObservationView,
} from "../observation/view.js";
import { readImageDimensions, type ImageDimensions, type VisionTransport } from "./images.js";
import { parsePdfDocument, pdfPageSelector, type PdfPage } from "./pdf.js";

export type { VisionTransport } from "./images.js";

type AttachmentFormat = "text" | "json" | "csv" | "pdf" | "image";

export type AttachmentFetcher = (input: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
}) => Promise<FetchAttachmentResult>;

export type AttachmentObservationInput = {
  nuclear: DatabaseSync;
  ownerId: string;
  cycleId: string;
  generation: number;
  sourceMessageEntityUuid: string;
  deliveryReservationEntityUuid: string;
  attachments: readonly unknown[];
  /** Host capability reality gates this input; tests may inject the gate. */
  attachmentTextEnabled: boolean;
  /** `true` is direct visual access; `mediated` is a disclosed helper derivation. */
  visionAccess?: boolean | "mediated";
  /** Host-owned visual transport. Tests may inject a bounded double. */
  imageTransport?: VisionTransport;
  fetchAttachment?: AttachmentFetcher;
  nowMs?: number;
};

const FETCH_TIMEOUT_MS = 10_000;
const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/markdown",
  "application/x-markdown",
]);
const JSON_MIME_TYPES = new Set(["application/json", "text/json"]);
const CSV_MIME_TYPES = new Set(["text/csv", "application/csv"]);
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);
const OCTET_MIME = "application/octet-stream";

function normalizedMime(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() || OCTET_MIME;
}

function extensionOf(fileName: string): string {
  const lower = fileName.trim().toLowerCase();
  const index = lower.lastIndexOf(".");
  return index >= 0 ? lower.slice(index) : "";
}

function formatForExtension(fileName: string): AttachmentFormat | null {
  switch (extensionOf(fileName)) {
    case ".txt":
    case ".md":
    case ".markdown":
      return "text";
    case ".json":
      return "json";
    case ".csv":
      return "csv";
    case ".pdf":
      return "pdf";
    case ".png":
    case ".jpeg":
    case ".jpg":
    case ".webp":
    case ".gif":
    case ".avif":
      return "image";
    default:
      return null;
  }
}

function mimeCompatible(format: AttachmentFormat, mime: string): boolean {
  const normalized = normalizedMime(mime);
  if (normalized === OCTET_MIME) return true;
  if (format === "pdf") return normalized === "application/pdf";
  if (format === "json") return JSON_MIME_TYPES.has(normalized) || normalized === "text/plain";
  if (format === "csv") return CSV_MIME_TYPES.has(normalized) || normalized === "text/plain";
  if (format === "image") return IMAGE_MIME_TYPES.has(normalized);
  return TEXT_MIME_TYPES.has(normalized);
}

function normalizeAttachment(value: unknown): AttachmentIntakeRef | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.discordAttachmentId !== "string" || !item.discordAttachmentId.trim()
    || typeof item.declaredMime !== "string"
    || typeof item.fileName !== "string" || !item.fileName.trim()
    || typeof item.sourceUrl !== "string" || !item.sourceUrl.trim()) return null;
  if (item.declaredByteSize !== undefined
    && (!Number.isSafeInteger(item.declaredByteSize) || Number(item.declaredByteSize) < 0)) return null;
  const sourceClass = item.sourceClass === "supplied_screenshot"
    ? "supplied_screenshot" as const
    : item.sourceClass === "supplied_image"
      ? "supplied_image" as const
      : undefined;
  return {
    discordAttachmentId: item.discordAttachmentId.trim(),
    declaredMime: normalizedMime(item.declaredMime),
    fileName: item.fileName.trim().slice(0, 200),
    ...(item.declaredByteSize === undefined ? {} : { declaredByteSize: Number(item.declaredByteSize) }),
    sourceUrl: item.sourceUrl.trim().slice(0, 2_048),
    ...(sourceClass === undefined ? {} : { sourceClass }),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function observationId(cycleId: string, generation: number, attachmentId: string): string {
  return `v021:observation:attachment:${sha256(new TextEncoder().encode(JSON.stringify({
    cycleId,
    generation,
    attachmentId,
  })))}`;
}

function stableArtifactRow(
  db: DatabaseSync,
  reservationId: string,
  attachmentId: string,
): { entityUuid: string; id: number } | null {
  const row = db.prepare(
    `SELECT id, entity_uuid
       FROM perception_artifacts
      WHERE delivery_reservation_entity_uuid = ?
        AND discord_attachment_id = ?
      LIMIT 1`,
  ).get(reservationId, attachmentId) as { id?: unknown; entity_uuid?: unknown } | undefined;
  if (typeof row?.entity_uuid !== "string" || !row.entity_uuid.trim()) return null;
  return { id: Number(row.id ?? 0), entityUuid: row.entity_uuid };
}

function ensureArtifact(
  db: DatabaseSync,
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  aggregateTurnBytes: number,
): { entityUuid: string; id: number } {
  const existing = stableArtifactRow(
    db,
    input.deliveryReservationEntityUuid,
    attachment.discordAttachmentId,
  );
  if (existing) return existing;
  try {
    const created = createPendingArtifacts(db, {
      ownerId: input.ownerId,
      attachments: [attachment],
      sourceMessageEntityUuid: input.sourceMessageEntityUuid,
      deliveryReservationEntityUuid: input.deliveryReservationEntityUuid,
      aggregateTurnBytes,
    })[0];
    if (created) return { entityUuid: created.entityUuid, id: created.id };
  } catch {
    const raced = stableArtifactRow(
      db,
      input.deliveryReservationEntityUuid,
      attachment.discordAttachmentId,
    );
    if (raced) return raced;
  }
  throw new Error("attachment_artifact_create_failed");
}

function identityView(
  artifactId: string,
  selector: Record<string, unknown>,
  returnedSelector: Record<string, unknown>,
  options: {
    completeness: "complete" | "partial" | "unknown";
    contentHash?: string;
    errors?: readonly Record<string, unknown>[];
  },
): ObservationView {
  return {
    parentArtifactId: artifactId,
    representationId: textArtifactRepresentationId(artifactId),
    derivation: "attachment_ingest",
    requestedSelector: selector as JsonValue,
    returnedSelector: returnedSelector as JsonValue,
    completeness: options.completeness,
    omission: options.completeness === "partial" ? { reason: "acquisition_limit" } : null,
    continuation: null,
    errors: (options.errors ?? []) as readonly JsonValue[],
    ...(options.contentHash ? { contentHashBasis: `raw_bytes:${options.contentHash}` } : {}),
    inputTrust: "untrusted_evidence",
  };
}

function basePayload(
  attachment: AttachmentIntakeRef,
  artifactId: string,
): Record<string, unknown> {
  return {
    operationKind: "attachment.observe",
    attachmentId: attachment.discordAttachmentId,
    fileName: attachment.fileName,
    declaredMime: attachment.declaredMime,
    artifactId,
    representationId: textArtifactRepresentationId(artifactId),
    inputTrust: "untrusted_evidence",
  };
}

function buildObservation(
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  artifactId: string,
  payload: Record<string, unknown>,
  view: ObservationView,
): Observation {
  return {
    observationId: observationId(input.cycleId, input.generation, attachment.discordAttachmentId),
    cycleId: input.cycleId,
    generation: input.generation,
    derived: false,
    replaySafe: true,
    modality: "text",
    payload,
    provenance: "perception:attachment",
    dataClassification: "never_public",
    secretOmitted: false,
    view: {
      ...view,
      parentArtifactId: artifactId,
      representationId: textArtifactRepresentationId(artifactId),
    },
  };
}

function errorObservation(
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  artifactId: string,
  code: string,
  details: Record<string, unknown> = {},
): Observation {
  const payload = {
    ...basePayload(attachment, artifactId),
    error: { code, ...details },
  };
  return buildObservation(
    input,
    attachment,
    artifactId,
    payload,
    identityView(
      artifactId,
      { kind: "attachment", format: formatForExtension(attachment.fileName) ?? "unknown" },
      { kind: "error", code },
      { completeness: "unknown", errors: [{ code, ...details }] },
    ),
  );
}

function invalidReferenceObservation(
  input: AttachmentObservationInput,
  index: number,
): Observation {
  const id = `invalid-${index}`;
  return {
    observationId: observationId(input.cycleId, input.generation, id),
    cycleId: input.cycleId,
    generation: input.generation,
    derived: false,
    replaySafe: true,
    modality: "text",
    payload: {
      operationKind: "attachment.observe",
      attachmentIndex: index,
      inputTrust: "untrusted_evidence",
      error: { code: "attachment_ref_invalid" },
    },
    provenance: "perception:attachment",
    dataClassification: "never_public",
    secretOmitted: false,
    view: {
      derivation: "attachment_ingest",
      completeness: "unknown",
      requestedSelector: { kind: "attachment", index },
      returnedSelector: { kind: "error", code: "attachment_ref_invalid" },
      continuation: null,
      errors: [{ code: "attachment_ref_invalid" }],
      inputTrust: "untrusted_evidence",
    },
  };
}

function boundedString(value: string, remaining: { value: number }): { value: string; complete: boolean } {
  if (value.length <= remaining.value) {
    remaining.value -= value.length;
    return { value, complete: true };
  }
  const result = value.slice(0, Math.max(0, remaining.value));
  remaining.value = 0;
  return { value: result, complete: false };
}

function boundedJson(value: unknown, remaining: { value: number }, depth = 0): { value: unknown; complete: boolean } {
  if (depth > 32 || remaining.value <= 0) return { value: "[omitted]", complete: false };
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    const serialized = JSON.stringify(value);
    const complete = serialized.length <= remaining.value;
    remaining.value = Math.max(0, remaining.value - serialized.length);
    return { value: complete ? value : "[omitted]", complete };
  }
  if (typeof value === "string") return boundedString(value, remaining);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    let complete = true;
    for (const item of value.slice(0, 64)) {
      const bounded = boundedJson(item, remaining, depth + 1);
      result.push(bounded.value);
      complete = complete && bounded.complete;
      if (remaining.value <= 0) break;
    }
    if (value.length > result.length) complete = false;
    return { value: result, complete };
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    let complete = true;
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
      if (remaining.value <= 0) {
        complete = false;
        break;
      }
      const bounded = boundedJson(item, remaining, depth + 1);
      result[key] = bounded.value;
      complete = complete && bounded.complete;
    }
    if (Object.keys(value as Record<string, unknown>).length > Object.keys(result).length) complete = false;
    return { value: result, complete };
  }
  return { value: "[omitted]", complete: false };
}

export function parseAttachmentCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let justClosedQuote = false;
  const pushRow = () => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          justClosedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
      justClosedQuote = false;
      continue;
    }
    if (justClosedQuote && char !== "," && char !== "\n" && char !== "\r") {
      throw new Error("csv_parse_failed");
    }
    justClosedQuote = false;
    if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (quoted) throw new Error("csv_parse_failed");
  if (field.length > 0 || row.length > 0 || (text.length > 0 && !text.endsWith("\n"))) pushRow();
  return rows;
}

export function resolveAttachmentJsonPath(value: unknown, path: string): unknown {
  if (path === "") return value;
  if (!path.startsWith("/")) throw new Error("structured_path_unresolved");
  let current: unknown = value;
  for (const rawToken of path.slice(1).split("/")) {
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(token)) throw new Error("structured_path_unresolved");
      const index = Number(token);
      if (index >= current.length) throw new Error("structured_path_unresolved");
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null
      || !Object.prototype.hasOwnProperty.call(current, token)) {
      throw new Error("structured_path_unresolved");
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function attachmentProvenance(input: AttachmentObservationInput, attachment: AttachmentIntakeRef) {
  return {
    sourceIdentity: "discord_attachment",
    evidenceIdentity: `${input.sourceMessageEntityUuid}:${attachment.discordAttachmentId}`,
    capturedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    citationRefs: [attachment.sourceUrl],
    completeness: "complete" as const,
  };
}

function successObservation(
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  artifactId: string,
  format: AttachmentFormat,
  bytes: Uint8Array,
  mime: string,
): Observation {
  const contentHash = sha256(bytes);
  const base = basePayload(attachment, artifactId);
  if (format === "text") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const contentUtf8 = text.slice(0, MAX_MODEL_EXCERPT_CHARS);
    const complete = contentUtf8.length === text.length;
    return buildObservation(input, attachment, artifactId, {
      ...base,
      detectedMime: mime,
      format,
      contentHash,
      byteSize: bytes.byteLength,
      contentUtf8,
      truncated: !complete,
    }, identityView(
      artifactId,
      { kind: "text_window", offsetChars: 0, limitChars: MAX_MODEL_EXCERPT_CHARS },
      { kind: "text_window", offsetChars: 0, limitChars: MAX_MODEL_EXCERPT_CHARS },
      { completeness: complete ? "complete" : "partial", contentHash },
    ));
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (format === "json") {
    const parsed = JSON.parse(text) as unknown;
    const remaining = { value: MAX_MODEL_EXCERPT_CHARS };
    const bounded = boundedJson(parsed, remaining);
    return buildObservation(input, attachment, artifactId, {
      ...base,
      detectedMime: mime,
      format,
      contentHash,
      byteSize: bytes.byteLength,
      value: bounded.value,
      truncated: !bounded.complete,
    }, identityView(
      artifactId,
      { kind: "json_path", path: "", maxItems: 64, maxChars: MAX_MODEL_EXCERPT_CHARS },
      { kind: "json_path", path: "", maxItems: 64, maxChars: MAX_MODEL_EXCERPT_CHARS },
      { completeness: bounded.complete ? "complete" : "partial", contentHash },
    ));
  }

  const rows = parseAttachmentCsv(text);
  const returnedRows = rows.slice(0, 256).map((row) => row.slice(0, 64).map((cell) => cell.slice(0, 2_000)));
  const returnedColumns = returnedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const complete = returnedRows.length === rows.length
    && returnedRows.every((row, index) => row.length === rows[index]!.length
      && row.every((cell, column) => cell.length === rows[index]![column]!.length));
  return buildObservation(input, attachment, artifactId, {
    ...base,
    detectedMime: mime,
    format,
    contentHash,
    byteSize: bytes.byteLength,
    rows: returnedRows,
    truncated: !complete,
  }, identityView(
    artifactId,
    { kind: "csv_range", startRow: 0, endRow: returnedRows.length, startColumn: 0, endColumn: returnedColumns },
    { kind: "csv_range", startRow: 0, endRow: returnedRows.length, startColumn: 0, endColumn: returnedColumns },
    { completeness: complete ? "complete" : "partial", contentHash },
  ));
}

async function imageObservation(
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  artifactId: string,
  bytes: Uint8Array,
  mime: string,
  transport: VisionTransport,
): Promise<Observation> {
  const contentHash = sha256(bytes);
  const dimensions = readImageDimensions(bytes, mime);
  const representationId = imageArtifactRepresentationId(artifactId);
  const sourceClass: AttachmentSourceClass = attachment.sourceClass ?? "supplied_image";
  const selector = { kind: "image" } as const;
  const payload: Record<string, unknown> = {
    ...basePayload(attachment, artifactId),
    detectedMime: mime,
    format: "image",
    representationId,
    contentHash,
    byteSize: bytes.byteLength,
    sourceClass,
    exif: "not_stripped",
    ...(dimensions === null
      ? { pixelDimensions: { status: "unavailable" } }
      : { pixelWidth: dimensions.width, pixelHeight: dimensions.height, pixelDimensions: dimensions }),
  };

  if (transport.kind === "direct_visual") {
    // Host-only wire material. It is deliberately non-enumerable so a durable
    // observation never stores a second copy of the image beside the artifact.
    Object.defineProperty(payload, "imageDataUri", {
      value: buildInlineDataUri(bytes, mime),
      enumerable: false,
      writable: false,
      configurable: false,
    });
  } else {
    const description = (await transport.describeImage({
      bytes: new Uint8Array(bytes),
      mime,
      fileName: attachment.fileName,
      sourceClass,
      dimensions,
    })).trim().slice(0, MAX_MODEL_EXCERPT_CHARS);
    if (!description) throw new Error("image_description_empty");
    payload.description = description;
    payload.helperModelId = transport.helperModelId;
  }

  const access = transport.kind;
  return {
    observationId: observationId(input.cycleId, input.generation, attachment.discordAttachmentId),
    cycleId: input.cycleId,
    generation: input.generation,
    derived: transport.kind === "mediated_visual",
    replaySafe: true,
    modality: "image",
    payload,
    provenance: "perception:image",
    dataClassification: "never_public",
    secretOmitted: false,
    view: {
      parentArtifactId: artifactId,
      representationId,
      derivation: transport.kind === "direct_visual"
        ? "retained_image"
        : "mediated_visual_description",
      access,
      requestedSelector: selector,
      returnedSelector: selector,
      completeness: "complete",
      omission: null,
      continuation: null,
      errors: [],
      contentHashBasis: `raw_bytes:${contentHash}`,
      inputTrust: "untrusted_evidence",
    },
  };
}

function pdfPageObservation(
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  artifactId: string,
  page: PdfPage,
  pageCount: number,
  contentHash: string,
  byteSize: number,
): Observation {
  const base = basePayload(attachment, artifactId);
  const selector = pdfPageSelector(page.page);
  return {
    observationId: `${observationId(input.cycleId, input.generation, attachment.discordAttachmentId)}:page:${page.page}`,
    cycleId: input.cycleId,
    generation: input.generation,
    derived: false,
    replaySafe: true,
    modality: "page",
    payload: {
      ...base,
      format: "pdf_page",
      representationId: page.textRepresentationId,
      contentHash,
      byteSize,
      page: page.page,
      pageCount,
      pageWidth: page.width,
      pageHeight: page.height,
      extraction: page.extraction,
      ...(page.text.length > 0 ? { contentUtf8: page.text } : {}),
      featuresNotExtracted: page.featuresNotExtracted,
      pageImageRef: {
        artifactId,
        representationId: page.imageRepresentationId,
        page: page.page,
        source: "retained_pdf_page",
        access: "deferred_visual",
      },
      ocr: { status: "unavailable" },
      inputTrust: "untrusted_evidence",
    },
    provenance: "perception:pdf",
    dataClassification: "never_public",
    secretOmitted: false,
    view: {
      parentArtifactId: artifactId,
      representationId: page.textRepresentationId,
      derivation: "pdf_text_extract",
      requestedSelector: selector,
      returnedSelector: selector,
      completeness: "complete",
      omission: null,
      continuation: page.page < pageCount ? { page: page.page + 1 } : null,
      errors: page.extraction === "empty" ? [{ code: "extraction_empty" }] : [],
      contentHashBasis: "raw_bytes",
      inputTrust: "untrusted_evidence",
    },
  };
}

function pdfObservations(
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  artifactId: string,
  bytes: Uint8Array,
): Observation[] {
  const contentHash = sha256(bytes);
  try {
    const document = parsePdfDocument(bytes, artifactId);
    return document.pages.map((page) => pdfPageObservation(
      input,
      attachment,
      artifactId,
      page,
      document.pageCount,
      contentHash,
      bytes.byteLength,
    ));
  } catch (error) {
    const code = error instanceof Error && error.message === "document_encrypted"
      ? "document_encrypted"
      : "document_unreadable";
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", {
      errorCode: code,
    });
    return [errorObservation(input, attachment, artifactId, code, { mediaType: "application/pdf" })];
  }
}

async function resolveOne(
  input: AttachmentObservationInput,
  attachment: AttachmentIntakeRef,
  aggregateDeclaredBytes: number,
  fetchedBytes: { value: number },
  fetcher: AttachmentFetcher,
): Promise<Observation[]> {
  const artifact = ensureArtifact(input.nuclear, input, attachment, aggregateDeclaredBytes);
  const declaredFormat = formatForExtension(attachment.fileName)
    ?? (normalizedMime(attachment.declaredMime) === "application/pdf"
      ? "pdf"
      : IMAGE_MIME_TYPES.has(normalizedMime(attachment.declaredMime))
        ? "image"
        : null);
  const artifactId = artifact.entityUuid;
  if (!declaredFormat || !mimeCompatible(declaredFormat, attachment.declaredMime)) {
    const mediaType = normalizedMime(attachment.declaredMime);
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "unsupported", {
      errorCode: `unsupported_media:${mediaType}`,
    });
    return [errorObservation(input, attachment, artifactId, "unsupported_media", { mediaType })];
  }
  if (attachment.declaredByteSize !== undefined && attachment.declaredByteSize > MAX_SINGLE_ATTACHMENT_BYTES) {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", { errorCode: "attachment_size_limit" });
    return [errorObservation(input, attachment, artifactId, "attachment_size_limit", {
      maxBytes: MAX_SINGLE_ATTACHMENT_BYTES,
    })];
  }
  if (aggregateDeclaredBytes > MAX_AGGREGATE_ATTACHMENT_BYTES) {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", { errorCode: "attachment_aggregate_limit" });
    return [errorObservation(input, attachment, artifactId, "attachment_aggregate_limit", {
      maxBytes: MAX_AGGREGATE_ATTACHMENT_BYTES,
    })];
  }
  const imageTransport = declaredFormat === "image" ? input.imageTransport : undefined;
  const imageAccessAllowed = declaredFormat === "image"
    && input.visionAccess !== false
    && input.visionAccess !== undefined
    && imageTransport !== undefined
    && ((input.visionAccess === true && imageTransport.kind === "direct_visual")
      || (input.visionAccess === "mediated" && imageTransport.kind === "mediated_visual"));
  if ((declaredFormat === "image" && !imageAccessAllowed) || (declaredFormat !== "image" && !input.attachmentTextEnabled)) {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", {
      errorCode: "capability_not_in_live_set",
    });
    return [errorObservation(input, attachment, artifactId, "capability_not_in_live_set")];
  }

  transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "fetching");
  let fetched: FetchAttachmentResult;
  try {
    fetched = await fetcher({
      url: attachment.sourceUrl,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_SINGLE_ATTACHMENT_BYTES,
    });
  } catch {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", {
      errorCode: "attachment_unreadable",
    });
    return [errorObservation(input, attachment, artifactId, "attachment_unreadable")];
  }
  const actualHash = sha256(fetched.bytes);
  if (fetched.bytes.byteLength > MAX_SINGLE_ATTACHMENT_BYTES) {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", {
      errorCode: "attachment_size_limit",
      mimeDetected: normalizedMime(fetched.mime),
      contentHash: actualHash,
      byteSize: fetched.bytes.byteLength,
    });
    return [errorObservation(input, attachment, artifactId, "attachment_size_limit", {
      maxBytes: MAX_SINGLE_ATTACHMENT_BYTES,
    })];
  }
  if (fetchedBytes.value + fetched.bytes.byteLength > MAX_AGGREGATE_ATTACHMENT_BYTES) {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", {
      errorCode: "attachment_aggregate_limit",
      mimeDetected: normalizedMime(fetched.mime),
      contentHash: actualHash,
      byteSize: fetched.bytes.byteLength,
    });
    return [errorObservation(input, attachment, artifactId, "attachment_aggregate_limit", {
      maxBytes: MAX_AGGREGATE_ATTACHMENT_BYTES,
    })];
  }
  fetchedBytes.value += fetched.bytes.byteLength;
  const detectedMime = normalizedMime(fetched.mime);
  if (!mimeCompatible(declaredFormat, detectedMime)) {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "unsupported", {
      errorCode: `unsupported_media:${detectedMime}`,
      mimeDetected: detectedMime,
      contentHash: actualHash,
      byteSize: fetched.bytes.byteLength,
    });
    return [errorObservation(input, attachment, artifactId, "unsupported_media", { mediaType: detectedMime })];
  }

  const provenance = {
    ...attachmentProvenance(input, attachment),
    ...(declaredFormat === "image"
      ? {
          exif: "not_stripped" as const,
          sourceClass: attachment.sourceClass ?? "supplied_image" as const,
        }
      : {}),
  };
  transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "fetched", {
    mimeDetected: detectedMime,
    finalUrlFingerprint: sha256(new TextEncoder().encode(fetched.finalUrl)),
    contentHash: actualHash,
    byteSize: fetched.bytes.byteLength,
    provenance,
  });
  try {
    storeArtifactBytes(input.nuclear, input.ownerId, artifactId, fetched.bytes, detectedMime, provenance);
  } catch {
    transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", {
      errorCode: "attachment_unreadable",
    });
    return [errorObservation(input, attachment, artifactId, "attachment_unreadable")];
  }

  if (declaredFormat === "pdf") {
    return pdfObservations(input, attachment, artifactId, fetched.bytes);
  }

  if (declaredFormat === "image") {
    try {
      const observation = await imageObservation(
        input,
        attachment,
        artifactId,
        fetched.bytes,
        detectedMime,
        imageTransport!,
      );
      transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "included", {
        modelRepresentation: imageTransport!.kind === "direct_visual"
          ? "inline_base64"
          : "inline_text_excerpt",
      });
      return [observation];
    } catch (error) {
      transitionArtifactStatus(input.nuclear, artifactId, input.ownerId, "failed", {
        errorCode: error instanceof Error && error.message === "image_description_empty"
          ? "image_description_empty"
          : "image_mediation_failed",
      });
      return [errorObservation(input, attachment, artifactId, error instanceof Error
        ? error.message
        : "image_mediation_failed", { mediaType: detectedMime })];
    }
  }

  try {
    return [successObservation(input, attachment, artifactId, declaredFormat, fetched.bytes, detectedMime)];
  } catch {
    return [errorObservation(input, attachment, artifactId, "attachment_parse_failed", {
      mediaType: detectedMime,
    })];
  }
}

/** Resolve owner-message attachment refs into retained, bounded Thought observations. */
export async function resolveAttachmentObservations(
  input: AttachmentObservationInput,
): Promise<Observation[]> {
  const normalized = input.attachments.map(normalizeAttachment);
  const fetcher = input.fetchAttachment ?? ((request) => fetchAttachmentBytes(request.url, {
    timeoutMs: request.timeoutMs,
    maxBytes: request.maxBytes,
  }));
  const bounded = normalized.slice(0, MAX_ATTACHMENTS_PER_TURN);
  const declaredAggregateBytes = bounded.reduce(
    (total, attachment) => total + (attachment?.declaredByteSize ?? 0),
    0,
  );
  const fetchedBytes = { value: 0 };
  const observations: Observation[] = [];
  for (const [index, attachment] of bounded.entries()) {
    if (attachment) {
      observations.push(...await resolveOne(input, attachment, declaredAggregateBytes, fetchedBytes, fetcher));
    } else {
      observations.push(invalidReferenceObservation(input, index));
    }
  }
  for (const [index, attachment] of normalized.slice(MAX_ATTACHMENTS_PER_TURN).entries()) {
    if (!attachment) {
      observations.push(invalidReferenceObservation(input, MAX_ATTACHMENTS_PER_TURN + index));
      continue;
    }
    const artifact = ensureArtifact(input.nuclear, input, attachment, declaredAggregateBytes);
    transitionArtifactStatus(input.nuclear, artifact.entityUuid, input.ownerId, "failed", { errorCode: "attachment_count_limit" });
    observations.push(errorObservation(input, attachment, artifact.entityUuid, "attachment_count_limit", {
      maxAttachments: MAX_ATTACHMENTS_PER_TURN,
    }));
  }
  return observations;
}
