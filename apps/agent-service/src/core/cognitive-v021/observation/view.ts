import { sha256, stableJson } from "../../model-fabric/hash.js";
import type { JsonValue } from "../types.js";
import type { SocialAudience } from "../social/types.js";

export type ObservationView = Readonly<{
  parentArtifactId?: string;
  representationId?: string;
  derivation?: string;
  requestedSelector?: JsonValue;
  returnedSelector?: JsonValue;
  completeness?: "complete" | "partial" | "unknown";
  omission?: JsonValue;
  continuation?: JsonValue;
  errors?: readonly JsonValue[];
  contentHashBasis?: string;
  inputTrust?: string;
}>;

export type ArtifactCursor = Readonly<{
  schema: "ashley.artifact_cursor.v1";
  artifactId: string;
  artifactHash: string;
  representationId: string;
  selector: JsonValue;
  audience: SocialAudience;
  continuation: JsonValue;
}>;

export type ArtifactCursorBinding = Pick<
  ArtifactCursor,
  "artifactId" | "artifactHash" | "representationId" | "selector" | "audience"
>;

export class ObservationViewError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ObservationViewError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function viewJson(value: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("view_undefined");
    return JSON.parse(serialized) as JsonValue;
  } catch {
    throw new ObservationViewError("observation_view_invalid");
  }
}

/** Validate and clone a stored or supplied observation view without inventing missing facts. */
export function canonicalObservationView(value: unknown): ObservationView | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new ObservationViewError("observation_view_invalid");
  const allowed = new Set([
    "parentArtifactId", "representationId", "derivation", "requestedSelector", "returnedSelector",
    "completeness", "omission", "continuation", "errors", "contentHashBasis", "inputTrust",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ObservationViewError("observation_view_invalid");
  }

  const view: Record<string, unknown> = {};
  for (const key of ["parentArtifactId", "representationId", "derivation", "contentHashBasis", "inputTrust"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || field.trim() === "") {
      throw new ObservationViewError("observation_view_invalid");
    }
    view[key] = field;
  }
  if (value.completeness !== undefined) {
    if (value.completeness !== "complete" && value.completeness !== "partial" && value.completeness !== "unknown") {
      throw new ObservationViewError("observation_view_invalid");
    }
    view.completeness = value.completeness;
  }
  for (const key of ["requestedSelector", "returnedSelector", "omission", "continuation"] as const) {
    if (value[key] !== undefined) view[key] = viewJson(value[key]);
  }
  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors)) throw new ObservationViewError("observation_view_invalid");
    view.errors = value.errors.map((error) => viewJson(error));
  }
  return view as ObservationView;
}

export function observationViewMetadataJson(view: ObservationView | null): string | null {
  if (view === null) return null;
  const { parentArtifactId: _parentArtifactId, representationId: _representationId, ...metadata } = view;
  return JSON.stringify(metadata);
}

export function observationViewFromStorage(
  parentArtifactId: unknown,
  representationId: unknown,
  metadataJson: unknown,
): ObservationView | null {
  if ((parentArtifactId != null && typeof parentArtifactId !== "string")
    || (representationId != null && typeof representationId !== "string")) {
    throw new ObservationViewError("observation_view_invalid");
  }
  let metadata: Record<string, unknown> = {};
  if (metadataJson != null) {
    if (typeof metadataJson !== "string") throw new ObservationViewError("observation_view_invalid");
    try {
      const parsed: unknown = JSON.parse(metadataJson);
      if (!isRecord(parsed)) throw new Error("view_metadata_not_object");
      if (Object.prototype.hasOwnProperty.call(parsed, "parentArtifactId")
        || Object.prototype.hasOwnProperty.call(parsed, "representationId")) {
        throw new Error("view_identity_must_use_columns");
      }
      metadata = parsed;
    } catch {
      throw new ObservationViewError("observation_view_invalid");
    }
  }
  if (parentArtifactId == null && representationId == null && metadataJson == null) return null;
  return canonicalObservationView({
    ...metadata,
    ...(parentArtifactId == null ? {} : { parentArtifactId }),
    ...(representationId == null ? {} : { representationId }),
  });
}

export function projectFileArtifactIdentity(input: {
  projectId: string;
  path: string;
  rawByteHash: string;
  capturedAtMs: number;
}): Pick<ObservationView, "parentArtifactId" | "representationId"> {
  if (!input.projectId.trim() || !input.path.trim() || !input.rawByteHash.trim()
    || !Number.isSafeInteger(input.capturedAtMs) || input.capturedAtMs < 0) {
    throw new ObservationViewError("project_file_artifact_identity_invalid");
  }
  const parentArtifactId = `artifact:v1:${sha256({
    sourceLocator: { kind: "project_file", projectId: input.projectId, path: input.path },
    rawByteHash: input.rawByteHash,
    capturedAtMs: input.capturedAtMs,
  })}`;
  return { parentArtifactId, representationId: textArtifactRepresentationId(parentArtifactId) };
}

export function webPageArtifactIdentity(input: {
  requestedUrl: string;
  contentHash: string;
  capturedAtMs: number;
}): Pick<ObservationView, "parentArtifactId" | "representationId"> {
  if (!input.requestedUrl.trim() || !/^[a-f0-9]{64}$/.test(input.contentHash)
    || !Number.isSafeInteger(input.capturedAtMs) || input.capturedAtMs < 0) {
    throw new ObservationViewError("web_page_artifact_identity_invalid");
  }
  const parentArtifactId = `artifact:v1:${sha256({
    sourceLocator: { kind: "web_page", requestedUrl: input.requestedUrl.trim() },
    contentHash: input.contentHash,
    capturedAtMs: input.capturedAtMs,
  })}`;
  return { parentArtifactId, representationId: textArtifactRepresentationId(parentArtifactId) };
}

/** Stable text representation identity for a retained artifact capture. */
export function textArtifactRepresentationId(parentArtifactId: string): string {
  if (typeof parentArtifactId !== "string" || parentArtifactId.trim() === "") {
    throw new ObservationViewError("artifact_representation_identity_invalid");
  }
  return `representation:v1:${sha256({ parentArtifactId, kind: "utf8_text" })}`;
}

export function assertArtifactCursorBinding(
  cursor: unknown,
  expected: ArtifactCursorBinding,
): asserts cursor is ArtifactCursor {
  if (!isRecord(cursor)
    || cursor.schema !== "ashley.artifact_cursor.v1"
    || typeof cursor.artifactId !== "string"
    || typeof cursor.artifactHash !== "string"
    || typeof cursor.representationId !== "string"
    || !Object.prototype.hasOwnProperty.call(cursor, "selector")
    || !Object.prototype.hasOwnProperty.call(cursor, "audience")
    || !Object.prototype.hasOwnProperty.call(cursor, "continuation")) {
    throw new ObservationViewError("artifact_cursor_invalid");
  }
  if (cursor.artifactHash !== expected.artifactHash) {
    throw new ObservationViewError("artifact_cursor_artifact_hash_mismatch");
  }
  if (cursor.artifactId !== expected.artifactId
    || cursor.representationId !== expected.representationId
    || stableJson(cursor.selector) !== stableJson(expected.selector)
    || stableJson(cursor.audience) !== stableJson(expected.audience)) {
    throw new ObservationViewError("artifact_cursor_binding_mismatch");
  }
}
