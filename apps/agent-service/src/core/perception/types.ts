import type { Decision } from "../types.js";

export type PerceptionArtifactStatus =
  | "pending"
  | "fetching"
  | "fetched"
  | "included"
  | "failed"
  | "unsupported"
  | "expired"
  | "redacted";

export type ConversationalReadStatus =
  | "pending"
  | "fetching"
  | "fetched"
  | "included"
  | "failed"
  | "expired"
  | "redacted";

export type ModelRepresentation =
  | "none"
  | "inline_base64"
  | "inline_text_excerpt";

export type ModelAudience = "thought" | "expression";

export type ModelPartRecord = {
  audience: ModelAudience;
  partIndex: number;
  byteRange?: { start: number; end: number };
};

export type AttachmentIntakeRef = {
  discordAttachmentId: string;
  declaredMime: string;
  fileName: string;
  declaredByteSize?: number;
  sourceUrl: string;
};

export type PerceptionLicenses = {
  imageIncluded: string[];
  textExcerptIncluded: string[];
  conversationalReadIncluded: string[];
};

export const MAX_ATTACHMENTS_PER_TURN = 4;
export const MAX_SINGLE_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_AGGREGATE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_MODEL_EXCERPT_CHARS = 8_000;
export const MAX_STORED_EXCERPT_CHARS = 2_000;
export const MAX_FILENAME_LENGTH = 200;
export const MAX_URL_LENGTH = 2_048;
export const MIN_FETCH_MS = 800;
export const DEFAULT_RETENTION_DAYS = 7;

export type PerceptionInlinePart = {
  audience: ModelAudience;
  kind: "image" | "text_excerpt" | "conversational_read";
  entityUuid: string;
  content: string;
  mime?: string;
};

export type PerceptionTurnInput = {
  ownerId: string;
  message: string;
  attachments: AttachmentIntakeRef[];
  sourceMessageEntityUuid: string;
  deliveryReservationEntityUuid: string;
  deliveryReservationId: number;
  /** Absolute optional-Perception cutoff selected by the owning turn plan. */
  deadlineAtMs: number;
  decision: Decision;
};

export type PerceptionTurnResult = {
  artifactsCreated: number;
  conversationalReadCreated: boolean;
  preflightBlocked: boolean;
  preflightReason?: string;
  thoughtParts: PerceptionInlinePart[];
  expressionParts: PerceptionInlinePart[];
  licenses: PerceptionLicenses;
  researchIntent: { intent: true; url: string } | { intent: false };
};
