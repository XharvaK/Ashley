/**
 * Frozen S1 composition bounds. These are logical serializer contracts, not
 * provider quotas and not permission to invent additional model-visible data.
 */
export const PROTECTED_PRIOR_DIALOGUE_COUNT = 4;
export const ORDINARY_PRIOR_MESSAGE_BYTE_CLASS = 2_048;
export const PROTECTED_HISTORY_ALLOCATION_BYTES = 9_216;

export const REQUIRED_WC_PROJECTED_POOL_BYTES = 2_560;
export const REQUIRED_WC_ITEM_BYTES = 640;

export const ATTACHMENT_AVAILABILITY = [
  "CONTENT_AVAILABLE",
  "PARTIALLY_AVAILABLE",
  "OMITTED_FROM_THIS_REQUEST",
  "UNAVAILABLE",
  "NO_ASSOCIATED_CONTENT",
] as const;

export type AttachmentAvailability = (typeof ATTACHMENT_AVAILABILITY)[number];

export type DialogueProtection =
  | "current_trigger"
  | "protected_prior_dialogue"
  | "ordinary";

export function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}
