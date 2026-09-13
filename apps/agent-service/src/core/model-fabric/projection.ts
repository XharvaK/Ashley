import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../model-routing/types.js";
import type { EvidenceRef as CoreEvidenceRef } from "../types.js";
import { freezeDeep, sha256, sha256Text } from "./hash.js";
import type {
  ContextPolicyId,
  ContextProjection,
  EvidenceRef as ModelFabricEvidenceRef,
  MediaRef,
  ModelContentPart,
  ModelPurposeId,
  ProjectionClassification,
  ProjectionContentBinding,
  ProjectionTelemetryFingerprint,
} from "./types.js";

export type { ContextProjection } from "./types.js";

export type ContextProjectionInput = {
  /** String compatibility is retained for C2's open purpose vocabulary. */
  purpose: ModelPurposeId | string;
  contextPolicyId: string;
  messages?: readonly ChatMessage[];
  parts?: readonly ModelContentPart[];
  evidenceRefs?: readonly (CoreEvidenceRef | ModelFabricEvidenceRef)[];
  currentMessage?: string;
  tokenEstimateDivisor?: number;
  bounds?: Partial<ContextProjection["bounds"]>;
  privacyPolicyId?: string;
};

const DEFAULT_BOUNDS = {
  maxParts: 512,
  maxUtf8Bytes: 4_000_000,
  maxEstimatedTokens: 1_000_000,
  maxMediaBytes: 100_000_000,
};

function roleFor(message: ChatMessage): "instruction" | "user" | "assistant" {
  return message.role === "system" ? "instruction" : message.role;
}

function classificationFor(message: ChatMessage): ProjectionClassification {
  return message.role === "system" ? "system_private" : "owner_private";
}

function mediaRefFor(url: string): MediaRef {
  const contentHash = `sha256:${sha256Text(url)}`;
  const comma = url.indexOf(",");
  const header = comma >= 0 ? url.slice(0, comma) : "";
  const mime = header.match(/^data:([^;,]+)/i)?.[1] ?? "application/octet-stream";
  const encoded = comma >= 0 ? url.slice(comma + 1) : url;
  return {
    artifactEntityUuid: `inline:${contentHash.slice(7, 23)}`,
    contentHash,
    mime,
    byteSize: Math.ceil((encoded.length * 3) / 4),
    retentionUntilMs: null,
    representation: "source_attachment",
    parentArtifactEntityUuid: null,
  };
}

function partsFor(messages: readonly ChatMessage[]): ModelContentPart[] {
  const parts: ModelContentPart[] = [];
  for (const message of messages) {
    if (message.content) {
      parts.push({
        kind: "text",
        role: roleFor(message),
        text: message.content,
        classification: classificationFor(message),
      });
    }
    for (const imageUrl of message.imageUrls ?? []) {
      parts.push({
        kind: "image_ref",
        mediaRef: mediaRefFor(imageUrl),
        classification: classificationFor(message),
      });
    }
  }
  return parts;
}

function clonePart(part: ModelContentPart): ModelContentPart {
  switch (part.kind) {
    case "text":
      return {
        ...part,
        evidenceRef: part.evidenceRef ? { ...part.evidenceRef } : undefined,
      };
    case "image_ref":
    case "document_page_ref":
    case "audio_ref":
      return {
        ...part,
        mediaRef: { ...part.mediaRef },
        evidenceRef: part.evidenceRef ? { ...part.evidenceRef } : undefined,
      };
    case "structured_observation":
      return {
        ...part,
        value: { ...part.value },
        evidenceRefs: part.evidenceRefs.map((ref) => ({ ...ref })),
      };
  }
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function mediaBytesFor(part: ModelContentPart): number {
  switch (part.kind) {
    case "image_ref":
    case "document_page_ref":
    case "audio_ref":
      return part.mediaRef.byteSize;
    default:
      return 0;
  }
}

function textBytesFor(part: ModelContentPart): number {
  return part.kind === "text" ? utf8Bytes(part.text) : 0;
}

function sizeBucket(value: number): string {
  if (value === 0) return "0";
  if (value <= 256) return "1-256";
  if (value <= 1024) return "257-1024";
  if (value <= 4096) return "1025-4096";
  if (value <= 16_384) return "4097-16384";
  return "16385+";
}

function telemetryFingerprint(
  purpose: ModelPurposeId,
  contextPolicyId: string,
  parts: readonly ModelContentPart[],
  measured: { parts: number; utf8Bytes: number; estimatedTokens: number; mediaBytes: number },
): ProjectionTelemetryFingerprint {
  const structural = {
    purpose,
    contextPolicyId,
    kinds: parts.map((part) => part.kind),
    classifications: parts.map((part) => part.classification),
    partCount: measured.parts,
    utf8Bytes: sizeBucket(measured.utf8Bytes),
    estimatedTokens: sizeBucket(measured.estimatedTokens),
    mediaBytes: sizeBucket(measured.mediaBytes),
  };
  return `projection_structure_v1:${sha256(structural)}` as ProjectionTelemetryFingerprint;
}

function projectionKind(ref: CoreEvidenceRef): ModelFabricEvidenceRef["kind"] {
  switch (ref.type) {
    case "message":
      return "message";
    case "episode":
      return "episode";
    case "take":
    case "question":
      return "read";
    case "open_cognitive_item":
      return "task";
    default:
      return "artifact";
  }
}

function isModelFabricEvidenceRef(
  value: CoreEvidenceRef | ModelFabricEvidenceRef,
): value is ModelFabricEvidenceRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "entityUuid" in value &&
    "provenance" in value
  );
}

function normalizeEvidenceRef(
  value: CoreEvidenceRef | ModelFabricEvidenceRef,
): ModelFabricEvidenceRef {
  if (isModelFabricEvidenceRef(value)) return { ...value };
  return {
    kind: projectionKind(value),
    entityUuid: `${value.type}:${String(value.id)}`,
    provenance: "external_untrusted",
  };
}

function maxBound(
  value: number,
  predicate: (candidate: number) => boolean,
  error: string,
): number {
  if (!predicate(value)) throw new Error(error);
  return value;
}

/** Builds an immutable, bounded metadata projection without changing provider messages. */
export function createContextProjection(
  input: ContextProjectionInput,
): ContextProjection {
  if (!input.contextPolicyId.trim()) throw new Error("context_projection_policy_required");
  if (!input.purpose.trim()) throw new Error("context_projection_purpose_required");

  const maxParts = maxBound(
    Number(input.bounds?.maxParts ?? DEFAULT_BOUNDS.maxParts),
    (value) => Number.isInteger(value) && value > 0,
    "context_projection_max_parts_invalid",
  );
  const maxUtf8Bytes = maxBound(
    Number(input.bounds?.maxUtf8Bytes ?? DEFAULT_BOUNDS.maxUtf8Bytes),
    (value) => Number.isInteger(value) && value > 0,
    "context_projection_max_bytes_invalid",
  );
  const divisor = maxBound(
    Number(input.tokenEstimateDivisor ?? 4),
    (value) => Number.isInteger(value) && value > 0,
    "context_projection_token_divisor_invalid",
  );
  const maxEstimatedTokens = maxBound(
    Number(input.bounds?.maxEstimatedTokens ?? DEFAULT_BOUNDS.maxEstimatedTokens),
    (value) => Number.isInteger(value) && value > 0,
    "context_projection_max_tokens_invalid",
  );
  const maxMediaBytes = maxBound(
    Number(input.bounds?.maxMediaBytes ?? DEFAULT_BOUNDS.maxMediaBytes),
    (value) => Number.isInteger(value) && value >= 0,
    "context_projection_max_media_invalid",
  );

  const parts = input.parts
    ? input.parts.map(clonePart)
    : partsFor(input.messages ?? []);
  if (parts.length > maxParts) throw new Error("context_projection_parts_overflow");

  if (input.currentMessage !== undefined) {
    const occurrences = parts.filter(
      (part) => part.kind === "text" && part.text === input.currentMessage,
    ).length;
    if (occurrences > 1) throw new Error("context_current_message_duplicated");
  }

  const evidenceRefs = (input.evidenceRefs ?? []).map(normalizeEvidenceRef);
  const measured = {
    parts: parts.length,
    utf8Bytes: parts.reduce((sum, part) => sum + textBytesFor(part), 0),
    estimatedTokens: 0,
    mediaBytes: parts.reduce((sum, part) => sum + mediaBytesFor(part), 0),
  };
  measured.estimatedTokens = Math.ceil(measured.utf8Bytes / divisor);

  if (measured.utf8Bytes > maxUtf8Bytes) {
    throw new Error("context_projection_bytes_overflow");
  }
  if (measured.estimatedTokens > maxEstimatedTokens) {
    throw new Error("context_projection_tokens_overflow");
  }
  if (measured.mediaBytes > maxMediaBytes) {
    throw new Error("context_projection_media_overflow");
  }

  const bounds = { maxParts, maxUtf8Bytes, maxEstimatedTokens, maxMediaBytes };
  const contentBinding: ProjectionContentBinding = {
    canonicalization: "context_projection_content_v1",
    algorithm: "sha256",
    value: `sha256:${sha256({
      purpose: input.purpose,
      contextPolicyId: input.contextPolicyId,
      parts,
      evidenceRefs,
      bounds,
    })}`,
    privacyPolicyId: input.privacyPolicyId ?? input.contextPolicyId,
  };
  const projection: ContextProjection = {
    projectionId: randomUUID() as ContextProjection["projectionId"],
    contextPolicyId: input.contextPolicyId as ContextPolicyId,
    purpose: input.purpose as ModelPurposeId,
    parts,
    evidenceRefs,
    contentBinding,
    telemetryFingerprint: telemetryFingerprint(
      input.purpose as ModelPurposeId,
      input.contextPolicyId,
      parts,
      measured,
    ),
    bounds,
    measured,
  };
  return freezeDeep(projection);
}
