import { isValidWebSearchRequest } from "../../perception/search-provider.js";

export const TYPED_INSPECTION_OPERATION_KINDS = [
  "capability.inspect",
  "evidence.inspect",
  "temporal.inspect",
  "work.inspect",
] as const;

export const EVIDENCE_OPERATION_KINDS = ["evidence.read", "evidence.refresh"] as const;
export const WEB_SEARCH_OPERATION_KINDS = ["web.search"] as const;

export const EVIDENCE_READ_MAX_CHARS = 32_768;
export const EVIDENCE_READ_MAX_LINES = 4_096;

export type EvidenceOperationKind = (typeof EVIDENCE_OPERATION_KINDS)[number];
export type WebSearchOperationKind = (typeof WEB_SEARCH_OPERATION_KINDS)[number];

export type EvidenceTextSelector =
  | { kind: "text_window"; offsetChars: number; limitChars: number }
  | { kind: "text_lines"; startLine: number; endLine: number };

export type EvidenceReadRequest = {
  artifactId: string;
  representationId: string;
  selector: EvidenceTextSelector;
  cursor?: unknown;
};

export type EvidenceRefreshRequest = {
  artifactId: string;
  representationId: string;
  sourceUrl: string;
};

export type TypedInspectionOperationKind = (typeof TYPED_INSPECTION_OPERATION_KINDS)[number];

export type TypedInspectionRequest =
  | { operationKind: string }
  | { filter?: { modality?: string }; limit?: number; cursor?: string }
  | { limit?: number; cursor?: string };

export class CapabilityUnavailableError extends Error {
  readonly code = "CAPABILITY_UNAVAILABLE";
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super("CAPABILITY_UNAVAILABLE:" + reasonCode);
    this.name = "CapabilityUnavailableError";
    this.reasonCode = safeReasonCode(reasonCode);
  }
}

export function safeReasonCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,95}$/.test(value) ? value : "inspect_unavailable";
}

export function isTypedInspectionOperationKind(value: string): value is TypedInspectionOperationKind {
  return (TYPED_INSPECTION_OPERATION_KINDS as readonly string[]).includes(value);
}

export function isEvidenceOperationKind(value: string): value is EvidenceOperationKind {
  return (EVIDENCE_OPERATION_KINDS as readonly string[]).includes(value);
}

export function isWebSearchOperationKind(value: string): value is WebSearchOperationKind {
  return (WEB_SEARCH_OPERATION_KINDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validLimit(value: unknown): boolean {
  return value === undefined || (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 64
  );
}

function validCursor(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 512);
}

function validEvidenceSelector(value: unknown): value is EvidenceTextSelector {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "text_window") {
    return onlyKeys(value, ["kind", "offsetChars", "limitChars"])
      && typeof value.offsetChars === "number"
      && Number.isSafeInteger(value.offsetChars)
      && value.offsetChars >= 0
      && typeof value.limitChars === "number"
      && Number.isSafeInteger(value.limitChars)
      && value.limitChars >= 1
      && value.limitChars <= EVIDENCE_READ_MAX_CHARS;
  }
  if (value.kind === "text_lines") {
    return onlyKeys(value, ["kind", "startLine", "endLine"])
      && typeof value.startLine === "number"
      && Number.isSafeInteger(value.startLine)
      && value.startLine >= 1
      && typeof value.endLine === "number"
      && Number.isSafeInteger(value.endLine)
      && value.endLine > value.startLine
      && value.endLine - value.startLine <= EVIDENCE_READ_MAX_LINES;
  }
  return false;
}

function validEvidenceCursor(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return onlyKeys(value, ["schema", "artifactId", "artifactHash", "representationId", "selector", "audience", "continuation"])
    && value.schema === "ashley.artifact_cursor.v1"
    && typeof value.artifactId === "string"
    && value.artifactId.length > 0
    && typeof value.artifactHash === "string"
    && /^[a-f0-9]{64}$/.test(value.artifactHash)
    && typeof value.representationId === "string"
    && value.representationId.length > 0
    && validEvidenceSelector(value.selector)
    && isRecord(value.audience)
    && typeof value.audience.kind === "string"
    && isRecord(value.continuation);
}

function validSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidEvidenceOperationRequest(
  operationKind: string,
  value: unknown,
): value is Record<string, unknown> {
  if (!isEvidenceOperationKind(operationKind) || !isRecord(value)) return false;
  if (operationKind === "evidence.read") {
    return onlyKeys(value, ["artifactId", "representationId", "selector", "cursor"])
      && typeof value.artifactId === "string"
      && value.artifactId.trim().length > 0
      && typeof value.representationId === "string"
      && value.representationId.trim().length > 0
      && validEvidenceSelector(value.selector)
      && (value.cursor === undefined || validEvidenceCursor(value.cursor));
  }
  return onlyKeys(value, ["artifactId", "representationId", "sourceUrl"])
    && typeof value.artifactId === "string"
    && value.artifactId.trim().length > 0
    && typeof value.representationId === "string"
    && value.representationId.trim().length > 0
    && validSourceUrl(value.sourceUrl);
}

export function isValidWebSearchOperationRequest(
  operationKind: string,
  value: unknown,
): value is Record<string, unknown> {
  return isWebSearchOperationKind(operationKind) && isValidWebSearchRequest(value);
}

export function isValidTypedInspectionRequest(
  operationKind: string,
  value: unknown,
): value is Record<string, unknown> {
  if (!isTypedInspectionOperationKind(operationKind) || !isRecord(value)) return false;

  if (operationKind === "capability.inspect") {
    return onlyKeys(value, ["operationKind"])
      && typeof value.operationKind === "string"
      && /^[a-z][a-z0-9_.-]{0,95}$/.test(value.operationKind);
  }

  if (!onlyKeys(value, ["filter", "limit", "cursor"]) || !validLimit(value.limit) || !validCursor(value.cursor)) {
    return false;
  }

  if (operationKind !== "evidence.inspect") return value.filter === undefined;
  if (value.filter === undefined) return true;
  if (!isRecord(value.filter) || !onlyKeys(value.filter, ["modality"])) return false;
  return value.filter.modality === undefined || (
    typeof value.filter.modality === "string"
    && /^[a-z][a-z0-9_-]{0,63}$/.test(value.filter.modality)
  );
}
