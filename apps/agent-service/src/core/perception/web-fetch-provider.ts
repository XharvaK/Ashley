import {
  FETCH_TIMEOUT_MS,
  fetchWithLimits,
  MAX_RESPONSE_BYTES,
  type FetchLike,
  type LimitedFetchResult,
  type ResolveHost,
} from "../curiosity/network.js";
import type { SocialAudience } from "../cognitive-v021/social/types.js";

export const WEB_FETCH_OPERATION_KIND = "web.fetch" as const;
export const WEB_FETCH_MAX_URL_CHARS = 2_048;
export const WEB_FETCH_ACCEPT =
  "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8, application/json;q=0.7, application/xml;q=0.6, application/javascript;q=0.5";

export type WebFetchRequest = Readonly<{
  url: string;
}>;

export type WebFetchProvider = Readonly<{
  available: boolean;
  fetch(url: string, options?: { signal?: AbortSignal }): Promise<LimitedFetchResult>;
}>;

export type CuriosityWebFetchProviderOptions = Readonly<{
  fetcher?: FetchLike;
  resolve?: ResolveHost;
  timeoutMs?: number;
  maxBytes?: number;
  truncateAtLimit?: boolean;
}>;

const PRIVATE_INPUT_FIELDS = new Set([
  "attachments",
  "context",
  "conversation",
  "conversationText",
  "memory",
  "ownerMemory",
  "ownerPrivateFields",
  "privateContext",
  "projectBytes",
  "retrieval",
  "sourceRefs",
  "workingContext",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidWebFetchAudience(value: unknown): value is SocialAudience {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "owner_private") return Object.keys(value).length === 1;
  if (value.kind === "owner_dm") {
    return Object.keys(value).length === 2 && nonEmptyText(value.threadId);
  }
  if (value.kind === "dm") {
    return Object.keys(value).length === 2 && nonEmptyText(value.principalId);
  }
  if (value.kind === "room") {
    return Object.keys(value).length === 2 && nonEmptyText(value.roomId);
  }
  return false;
}

export function isValidWebFetchRequest(value: unknown): value is WebFetchRequest {
  if (!isRecord(value)
    || Object.keys(value).some((key) => key !== "url")
    || !nonEmptyText(value.url)
    || value.url.length > WEB_FETCH_MAX_URL_CHARS) {
    return false;
  }
  try {
    const parsed = new URL(value.url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.username.length === 0
      && parsed.password.length === 0;
  } catch {
    return false;
  }
}

export function buildPublicWebFetchRequest(
  value: unknown,
  audience: SocialAudience,
): WebFetchRequest {
  if (isRecord(value) && Object.keys(value).some((key) => PRIVATE_INPUT_FIELDS.has(key))) {
    throw new Error("web_fetch_private_input_forbidden");
  }
  if (!isValidWebFetchAudience(audience)) {
    throw new Error("web_fetch_audience_invalid");
  }
  if (!isValidWebFetchRequest(value)) {
    throw new Error("web_fetch_request_invalid");
  }
  return Object.freeze({ url: value.url.trim() });
}

export class CuriosityWebFetchProvider implements WebFetchProvider {
  readonly available = true;

  constructor(private readonly options: CuriosityWebFetchProviderOptions = {}) {}

  fetch(url: string, options: { signal?: AbortSignal } = {}): Promise<LimitedFetchResult> {
    return fetchWithLimits(url, {
      accept: WEB_FETCH_ACCEPT,
      timeoutMs: this.options.timeoutMs ?? FETCH_TIMEOUT_MS,
      maxBytes: this.options.maxBytes ?? MAX_RESPONSE_BYTES,
      signal: options.signal,
      fetcher: this.options.fetcher,
      resolve: this.options.resolve,
      outboundPurpose: "curiosity_http",
      userAgent: "AshleyWebFetch/1.0",
      truncateAtLimit: this.options.truncateAtLimit ?? false,
    });
  }
}

export class UnavailableWebFetchProvider implements WebFetchProvider {
  readonly available = false;

  async fetch(
    _url: string,
    _options?: { signal?: AbortSignal },
  ): Promise<LimitedFetchResult> {
    throw new Error("web_fetch_unavailable");
  }
}

/** Phase-A default: the live page provider is not bound to production. */
export const defaultWebFetchProvider: WebFetchProvider =
  new UnavailableWebFetchProvider();
