import type { SocialAudience } from "../cognitive-v021/social/types.js";

export const WEB_SEARCH_OPERATION_KIND = "web.search" as const;
export const WEB_SEARCH_MAX_QUERY_CHARS = 512;
export const WEB_SEARCH_MAX_RESULTS = 10;

export type WebSearchRequest = Readonly<{
  query: string;
  maxResults?: number;
}>;

export type WebSearchResult = Readonly<{
  title: string;
  url: string;
  snippet: string;
}>;

export type WebSearchResultSet = Readonly<{
  query: string;
  results: readonly WebSearchResult[];
  providerName: string;
  capturedAtMs: number;
  resultSetId: string;
}>;

export interface WebSearchProvider {
  search(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<WebSearchResultSet>;
  readonly available: boolean;
}

export type WebSearchEgressPolicy = Readonly<{
  check(query: WebSearchRequest, audience: SocialAudience): void;
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

export function isValidWebSearchAudience(value: unknown): value is SocialAudience {
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

function isValidMaxResults(value: unknown): value is number {
  return value === undefined
    || (typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 1
      && value <= WEB_SEARCH_MAX_RESULTS);
}

export function isValidWebSearchRequest(value: unknown): value is WebSearchRequest {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => key !== "query" && key !== "maxResults")) {
    return false;
  }
  return typeof value.query === "string"
    && value.query.trim().length > 0
    && value.query.length <= WEB_SEARCH_MAX_QUERY_CHARS
    && isValidMaxResults(value.maxResults);
}

export const publicWebSearchEgressPolicy: WebSearchEgressPolicy = Object.freeze({
  check(query: WebSearchRequest, audience: SocialAudience): void {
    if (isRecord(query) && Object.keys(query).some((key) => PRIVATE_INPUT_FIELDS.has(key))) {
      throw new Error("web_search_private_input_forbidden");
    }
    if (!isValidWebSearchAudience(audience)) {
      throw new Error("web_search_audience_invalid");
    }
    if (!isValidWebSearchRequest(query)) {
      throw new Error("web_search_request_invalid");
    }
  },
});

/** Build a public-only query from the cognition-supplied request. */
export function buildPublicWebSearchQuery(
  value: unknown,
  audience: SocialAudience,
): WebSearchRequest {
  if (isRecord(value) && Object.keys(value).some((key) => PRIVATE_INPUT_FIELDS.has(key))) {
    throw new Error("web_search_private_input_forbidden");
  }
  if (!isValidWebSearchRequest(value)) {
    throw new Error("web_search_request_invalid");
  }
  const query = Object.freeze({
    query: value.query.trim(),
    ...(value.maxResults === undefined ? {} : { maxResults: value.maxResults }),
  });
  publicWebSearchEgressPolicy.check(query, audience);
  return query;
}

export class UnavailableWebSearchProvider implements WebSearchProvider {
  readonly available = false;

  async search(
    _query: string,
    _options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<WebSearchResultSet> {
    throw new Error("web_search_unavailable");
  }
}

export const defaultWebSearchProvider: WebSearchProvider =
  new UnavailableWebSearchProvider();
