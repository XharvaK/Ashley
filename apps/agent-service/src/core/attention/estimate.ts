export type EstimateMessage = {
  role: string;
  content: string;
  /** @deprecated use inlineImages for Wave 06+ */
  imageUrls?: string[];
  inlineImages?: Array<{ base64Bytes: number; mime: string }>;
};

/** Conservative UTF-8 bytes → token factor (over-estimate for safety). */
export const BYTES_PER_TOKEN = 2;

/** Conservative reservation per image input when URL count only. */
export const IMAGE_TOKEN_RESERVE = 1_200;

/** Framing overhead for chat serialization (roles, JSON wrappers). */
export const FRAMING_TOKEN_OVERHEAD = 64;

export type TokenEstimate = {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
};

export type RequestEstimateOptions = {
  maxTokens?: number;
  toolsJson?: string;
  /**
   * UTF-8 bytes in the provider request that are not represented by the
   * logical chat messages above. This is for response schemas, provider
   * wrappers, and other wire material only; callers must not pass the full
   * serialized message array or count it twice.
   */
  wireAdditionalBytes?: number;
};

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function inlineImageTokens(
  inlineImages: Array<{ base64Bytes: number; mime: string }>,
): number {
  let total = 0;
  for (const image of inlineImages) {
    const bytes = Math.max(0, image.base64Bytes);
    total += Math.max(
      IMAGE_TOKEN_RESERVE,
      Math.ceil(bytes / BYTES_PER_TOKEN) + FRAMING_TOKEN_OVERHEAD,
    );
  }
  return total;
}

/**
 * Return the logical textual bytes used by the conservative estimator before
 * the fixed framing and image reservations are applied.
 */
export function estimateRequestInputBytes(
  messages: EstimateMessage[],
  options: Pick<RequestEstimateOptions, "toolsJson" | "wireAdditionalBytes"> = {},
): number {
  let bytes = 0;
  for (const message of messages) {
    bytes += utf8Bytes(message.role);
    bytes += utf8Bytes(message.content ?? "");
  }
  if (options.toolsJson) bytes += utf8Bytes(options.toolsJson);
  bytes += Math.max(0, Math.floor(options.wireAdditionalBytes ?? 0));
  return bytes;
}

/**
 * Conservative token estimator. Prefers UTF-8 byte length of the complete
 * serialized textual request — never characters/4.
 */
export function estimateRequestTokens(
  messages: EstimateMessage[],
  options: RequestEstimateOptions = {},
): TokenEstimate {
  let legacyImageCount = 0;
  let inlineImages: Array<{ base64Bytes: number; mime: string }> = [];
  for (const message of messages) {
    legacyImageCount += message.imageUrls?.length ?? 0;
    if (message.inlineImages?.length) {
      inlineImages = inlineImages.concat(message.inlineImages);
    }
  }
  const bytes = estimateRequestInputBytes(messages, options);
  const textTokens = Math.ceil(bytes / BYTES_PER_TOKEN) + FRAMING_TOKEN_OVERHEAD;
  const imageTokens =
    inlineImages.length > 0
      ? inlineImageTokens(inlineImages)
      : legacyImageCount * IMAGE_TOKEN_RESERVE;
  const estimatedInputTokens = textTokens + imageTokens;
  const estimatedOutputTokens = Math.max(1, options.maxTokens ?? 2048);
  return { estimatedInputTokens, estimatedOutputTokens };
}
