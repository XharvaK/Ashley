import { createHash } from "node:crypto";
import { fetchWithLimits } from "../curiosity/network.js";

export type FetchAttachmentResult = {
  bytes: Uint8Array;
  mime: string;
  finalUrl: string;
  contentHash: string;
};

function normalizeMime(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export async function fetchAttachmentBytes(
  url: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    signal?: AbortSignal;
  },
): Promise<FetchAttachmentResult> {
  const resource = await fetchWithLimits(url, {
    accept: "*/*",
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    signal: options.signal,
    outboundPurpose: "perception_http",
    userAgent: "AshleyPerception/1.0",
  });
  const mime = normalizeMime(resource.contentType) || "application/octet-stream";
  const contentHash = createHash("sha256").update(resource.body).digest("hex");
  return {
    bytes: resource.body,
    mime,
    finalUrl: resource.finalUrl,
    contentHash,
  };
}
