import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { assertOutboundAllowed } from "../continuity/process-guards.js";
import { sha256Text } from "../model-fabric/hash.js";
import {
  WEB_SEARCH_MAX_QUERY_CHARS,
  WEB_SEARCH_MAX_RESULTS,
  type WebSearchProvider,
  type WebSearchResult,
  type WebSearchResultSet,
} from "./search-provider.js";

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const TAVILY_PROVIDER_NAME = "tavily";
export const TAVILY_MAX_RESULTS = 4;
export const TAVILY_CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
export const TAVILY_TIMEOUT_MS = 12_000;
export const TAVILY_MAX_RESPONSE_BYTES = 512 * 1024;

const MAX_TITLE_CHARS = 200;
const MAX_URL_CHARS = 2_048;
const MAX_SNIPPET_CHARS = 400;

export type TavilyFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type TavilyWebSearchProviderOptions = Readonly<{
  apiKey?: string;
  lookupEnabled?: boolean;
  monthlyCredits?: number;
  dailyCredits?: number;
  fetcher?: TavilyFetch;
  now?: () => Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
  cacheTtlMs?: number;
}>;

type CacheRecord = Readonly<{
  cachedAtMs: number;
  capturedAtMs: number;
  resultSetId: string;
  results: readonly WebSearchResult[];
}>;

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value: number, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function boundedTimeout(value: number | undefined): number {
  return Math.max(1, Math.min(TAVILY_TIMEOUT_MS, Math.floor(value ?? TAVILY_TIMEOUT_MS)));
}

function normalizeQuery(query: string): string {
  if (typeof query !== "string" || query.trim().length === 0 || query.length > WEB_SEARCH_MAX_QUERY_CHARS) {
    throw new Error("web_search_request_invalid");
  }
  return query.trim();
}

function normalizeMaxResults(value: number | undefined): number {
  if (value !== undefined
    && (!Number.isSafeInteger(value) || value < 1 || value > WEB_SEARCH_MAX_RESULTS)) {
    throw new Error("web_search_request_invalid");
  }
  return Math.min(value ?? TAVILY_MAX_RESULTS, TAVILY_MAX_RESULTS);
}

function sanitizeSearchText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/```/g, "'''")
    .replace(/\s+/g, " ")
    .trim();
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || url.length > MAX_URL_CHARS) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function validResult(value: unknown): value is WebSearchResult {
  if (!isRecord(value)) return false;
  return typeof value.title === "string"
    && value.title.length > 0
    && value.title.length <= MAX_TITLE_CHARS
    && typeof value.url === "string"
    && httpsUrl(value.url) === value.url
    && typeof value.snippet === "string"
    && value.snippet.length > 0
    && value.snippet.length <= MAX_SNIPPET_CHARS;
}

/** Parse only the result-set fields used by the Host WebSearchProvider contract. */
export function parseTavilyResults(payload: unknown, maxResults = TAVILY_MAX_RESULTS): WebSearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new Error("web_search_provider_response_invalid");
  }
  const results: WebSearchResult[] = [];
  for (const value of payload.results) {
    if (!isRecord(value)) continue;
    const title = sanitizeSearchText(typeof value.title === "string" ? value.title : "");
    const url = httpsUrl(value.url);
    const snippet = sanitizeSearchText(typeof value.content === "string" ? value.content : "");
    if (!title || !url || !snippet) continue;
    results.push({
      title: title.slice(0, MAX_TITLE_CHARS),
      url,
      snippet: snippet.slice(0, MAX_SNIPPET_CHARS),
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

function resultSetId(query: string, capturedAtMs: number, results: readonly WebSearchResult[]): string {
  return `${TAVILY_PROVIDER_NAME}:${sha256Text(JSON.stringify({ query, capturedAtMs, results }))}`;
}

function resultSet(
  query: string,
  capturedAtMs: number,
  results: readonly WebSearchResult[],
): WebSearchResultSet {
  return {
    query,
    results: [...results],
    providerName: TAVILY_PROVIDER_NAME,
    capturedAtMs,
    resultSetId: resultSetId(query, capturedAtMs, results),
  };
}

function monthKey(now: Date): string {
  return `tavily:month:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dayKey(now: Date): string {
  return `tavily:day:${now.toISOString().slice(0, 10)}`;
}

function cacheKey(query: string): string {
  return `tavily:cache:${sha256Text(query.toLowerCase())}`;
}

function kvValue(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as Row | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

function counterValue(db: DatabaseSync, key: string): number {
  const value = Number(kvValue(db, key) ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function putKv(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function reserveTavilyCredit(
  db: DatabaseSync,
  now: Date,
  monthlyCredits: number,
  dailyCredits: number,
): boolean {
  if (monthlyCredits <= 0 || dailyCredits <= 0) return false;
  const mKey = monthKey(now);
  const dKey = dayKey(now);
  try {
    db.exec("BEGIN IMMEDIATE");
    const monthUsed = counterValue(db, mKey);
    const dayUsed = counterValue(db, dKey);
    if (monthUsed >= monthlyCredits || dayUsed >= dailyCredits) {
      db.exec("ROLLBACK");
      return false;
    }
    putKv(db, mKey, String(monthUsed + 1));
    putKv(db, dKey, String(dayUsed + 1));
    db.exec("COMMIT");
    return true;
  } catch {
    try { db.exec("ROLLBACK"); } catch { /* preserve the state failure */ }
    throw new Error("web_search_state_unavailable");
  }
}

function readCache(
  db: DatabaseSync,
  query: string,
  nowMs: number,
  ttlMs: number,
): CacheRecord | null {
  let raw: string | null;
  try {
    raw = kvValue(db, cacheKey(query));
  } catch {
    throw new Error("web_search_state_unavailable");
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const cachedAtMs = parsed.cachedAtMs;
    const capturedAtMs = parsed.capturedAtMs;
    const resultSetId = parsed.resultSetId;
    const results = parsed.results;
    if (typeof cachedAtMs !== "number"
      || !Number.isSafeInteger(cachedAtMs)
      || typeof capturedAtMs !== "number"
      || !Number.isSafeInteger(capturedAtMs)
      || cachedAtMs < 0
      || capturedAtMs < 0
      || typeof resultSetId !== "string"
      || !/^tavily:[0-9a-f]{64}$/.test(resultSetId)
      || !Array.isArray(results)
      || !results.every(validResult)) {
      return null;
    }
    if (nowMs - cachedAtMs > ttlMs) return null;
    return {
      cachedAtMs,
      capturedAtMs,
      resultSetId,
      results,
    };
  } catch {
    return null;
  }
}

function writeCache(db: DatabaseSync, query: string, value: WebSearchResultSet, cachedAtMs: number): void {
  try {
    putKv(db, cacheKey(query), JSON.stringify({
      cachedAtMs,
      capturedAtMs: value.capturedAtMs,
      resultSetId: value.resultSetId,
      results: value.results,
    } satisfies CacheRecord));
  } catch {
    throw new Error("web_search_state_unavailable");
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("web_search_response_limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("web_search_timeout");
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("web_search_response_limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function providerError(status: number): Error {
  if (status === 401 || status === 403) return new Error("web_search_provider_auth");
  if (status === 429) return new Error("web_search_provider_rate_limited");
  if (status >= 500) return new Error("web_search_provider_unavailable");
  return new Error("web_search_provider_error");
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly available: boolean;

  private readonly apiKey: string;
  private readonly lookupEnabled: boolean;
  private readonly monthlyCredits: number;
  private readonly dailyCredits: number;
  private readonly fetcher: TavilyFetch;
  private readonly injectedFetcher: boolean;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly cacheTtlMs: number;

  constructor(
    private readonly db: DatabaseSync,
    options: TavilyWebSearchProviderOptions = {},
  ) {
    this.apiKey = (options.apiKey ?? env.tavilyApiKey).trim();
    this.lookupEnabled = options.lookupEnabled ?? env.curiosityLookupEnabled;
    this.monthlyCredits = boundedInteger(
      options.monthlyCredits ?? env.curiosityTavilyMonthlyCredits,
      0,
      1_000_000,
    );
    this.dailyCredits = boundedInteger(
      options.dailyCredits ?? env.curiosityLookupPerDay,
      0,
      100_000,
    );
    this.fetcher = options.fetcher ?? (globalThis.fetch as TavilyFetch);
    this.injectedFetcher = options.fetcher !== undefined;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = boundedTimeout(options.timeoutMs);
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? TAVILY_MAX_RESPONSE_BYTES,
      TAVILY_MAX_RESPONSE_BYTES,
      TAVILY_MAX_RESPONSE_BYTES,
    );
    this.cacheTtlMs = boundedInteger(
      options.cacheTtlMs ?? TAVILY_CACHE_TTL_MS,
      TAVILY_CACHE_TTL_MS,
      TAVILY_CACHE_TTL_MS,
    );
    this.available = this.lookupEnabled && this.apiKey.length > 0;
  }

  async search(
    query: string,
    options: { maxResults?: number; signal?: AbortSignal } = {},
  ): Promise<WebSearchResultSet> {
    const normalizedQuery = normalizeQuery(query);
    const maxResults = normalizeMaxResults(options.maxResults);
    if (!this.available) throw new Error("web_search_unavailable");

    const now = this.now();
    const capturedAtMs = now.getTime();
    if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs < 0) {
      throw new Error("web_search_state_unavailable");
    }
    const cached = readCache(this.db, normalizedQuery, capturedAtMs, this.cacheTtlMs);
    if (cached) {
      const results = cached.results.slice(0, maxResults);
      return results.length === cached.results.length
        ? {
          query: normalizedQuery,
          results,
          providerName: TAVILY_PROVIDER_NAME,
          capturedAtMs: cached.capturedAtMs,
          resultSetId: cached.resultSetId,
        }
        : resultSet(normalizedQuery, cached.capturedAtMs, results);
    }
    if (!reserveTavilyCredit(this.db, now, this.monthlyCredits, this.dailyCredits)) {
      throw new Error("web_search_quota_exhausted");
    }

    const controller = new AbortController();
    let timedOut = false;
    let externallyAborted = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const abortExternal = () => {
      externallyAborted = true;
      controller.abort();
    };
    if (options.signal) {
      if (options.signal.aborted) abortExternal();
      else options.signal.addEventListener("abort", abortExternal, { once: true });
    }

    try {
      if (!this.injectedFetcher) {
        assertOutboundAllowed("tavily_search");
      }
      const response = await this.fetcher(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query: normalizedQuery,
          search_depth: "basic",
          max_results: maxResults,
          include_answer: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw providerError(response.status);
      }
      const body = await readBoundedBody(response, this.maxResponseBytes, controller.signal);
      let payload: unknown;
      try {
        payload = JSON.parse(body) as unknown;
      } catch {
        throw new Error("web_search_provider_response_invalid");
      }
      const results = parseTavilyResults(payload, maxResults);
      const output = resultSet(normalizedQuery, capturedAtMs, results);
      writeCache(this.db, normalizedQuery, output, capturedAtMs);
      return output;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("web_search_")) throw error;
      if (timedOut) throw new Error("web_search_timeout");
      if (externallyAborted) throw new Error("web_search_cancelled");
      throw new Error("web_search_network_error");
    } finally {
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener("abort", abortExternal);
    }
  }
}
