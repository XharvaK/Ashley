import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { assertOutboundAllowed } from "../continuity/process-guards.js";

export const MAX_REDIRECTS = 5;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_AGGREGATE_PAGES = 4;
export const MAX_AGGREGATE_BYTES = MAX_RESPONSE_BYTES * MAX_AGGREGATE_PAGES;
export const MAX_AGGREGATE_REDIRECTS = MAX_REDIRECTS * MAX_AGGREGATE_PAGES;
export const MAX_AGGREGATE_SUBREQUESTS =
  MAX_AGGREGATE_PAGES * (MAX_REDIRECTS + 1);
export const AGGREGATE_TRUNCATION_MARKER =
  "[Ashley external read truncated: finite envelope limit reached]";
export const AGGREGATE_INCOMPLETE_MARKER =
  "[Ashley external read incomplete: capture deadline reached]";

export type ResolveHost = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;
export type FetchLike = typeof fetch;

export type LimitedFetchResult = {
  finalUrl: string;
  contentType: string;
  body: Uint8Array;
  redirectDepth: number;
  subrequests: number;
  truncated: boolean;
};

export type AggregatePage = {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  body: Uint8Array;
  redirectDepth: number;
  subrequests: number;
  truncated: boolean;
};

export type AggregateEnvelope = {
  totalPages: number;
  totalBytes: number;
  redirectDepth: number;
  totalElapsedMs: number;
  fanOut: number;
  subrequests: number;
  truncated: boolean;
  incomplete: boolean;
  truncationMarker: string | null;
};

export type AggregateFetchResult = {
  pages: AggregatePage[];
  envelope: AggregateEnvelope;
};

function publicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Words(address: string): number[] | null {
  const normalized = address.toLowerCase().split("%")[0]!;
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const words: number[] = [];
    for (const token of part.split(":")) {
      if (token.includes(".")) {
        const octets = token.split(".").map(Number);
        if (octets.length !== 4 || octets.some((value) =>
          !Number.isInteger(value) || value < 0 || value > 255
        )) return null;
        words.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else if (!/^[0-9a-f]{1,4}$/.test(token)) {
        return null;
      } else {
        words.push(Number.parseInt(token, 16));
      }
    }
    return words;
  };
  const left = parse(halves[0] ?? "");
  const right = parse(halves[1] ?? "");
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const omitted = 8 - left.length - right.length;
  return omitted >= 1 ? [...left, ...Array<number>(omitted).fill(0), ...right] : null;
}

function embeddedIpv4(words: number[], offset: number): string {
  return [
    words[offset]! >> 8,
    words[offset]! & 0xff,
    words[offset + 1]! >> 8,
    words[offset + 1]! & 0xff,
  ].join(".");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family !== 6) return false;
  const words = ipv6Words(address);
  if (!words) return false;
  const [a, b, c, d, e, f, g, h] = words as [number, number, number, number, number, number, number, number];
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && h === 1)) return false;
  if ((a & 0xfe00) === 0xfc00 || (a & 0xffc0) === 0xfe80 || (a & 0xff00) === 0xff00) return false;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    if (f === 0xffff) return publicIpv4(embeddedIpv4(words, 6));
    return false;
  }
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return publicIpv4(embeddedIpv4(words, 6));
  }
  if (
    (a === 0x64 && b === 0xff9b && c === 1) ||
    (a === 0x100 && b === 0 && c === 0 && d === 0) ||
    (a === 0x2001 && b === 0) ||
    (a === 0x2001 && b === 2 && c === 0) ||
    (a === 0x2001 && (b & 0xfff0) === 0x10) ||
    (a === 0x2001 && b === 0x0db8) ||
    a === 0x2002
  ) return false;
  return true;
}

const defaultResolve: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family }));
};

export async function validatePublicUrl(
  input: string,
  resolve: ResolveHost = defaultResolve,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("invalid_url");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("unsupported_url");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolve(hostname);
  if (addresses.length === 0 || addresses.some((record) => !isPublicAddress(record.address))) {
    throw new Error("non_public_address");
  }
  return url;
}

async function boundedBody(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
  truncateAtLimit = false,
): Promise<{ body: Uint8Array; truncated: boolean }> {
  const length = Number(response.headers.get("content-length") ?? 0);
  const declaredTooLarge = Number.isFinite(length) && length > maxBytes;
  if (declaredTooLarge && !truncateAtLimit) {
    throw new Error("response_too_large");
  }
  if (!response.body) {
    return { body: new Uint8Array(), truncated: declaredTooLarge };
  }
  if (maxBytes <= 0) {
    await response.body.cancel();
    return { body: new Uint8Array(), truncated: true };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let hitLimit = false;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    const remaining = maxBytes - total;
    if (part.value.byteLength > remaining) {
      if (remaining > 0) chunks.push(part.value.slice(0, remaining));
      await reader.cancel();
      total = maxBytes;
      hitLimit = true;
      break;
    }
    chunks.push(part.value);
    total += part.value.byteLength;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body,
    truncated: declaredTooLarge || hitLimit,
  };
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("fetch_timeout"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("fetch_timeout"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export async function fetchWithLimits(
  input: string,
  options: {
    accept: string;
    timeoutMs: number;
    maxBytes: number;
    signal?: AbortSignal;
    fetcher?: FetchLike;
    resolve?: ResolveHost;
    outboundPurpose?: string;
    userAgent?: string;
    maxRedirects?: number;
    truncateAtLimit?: boolean;
  },
): Promise<LimitedFetchResult> {
  const fetcher = options.fetcher ?? fetch;
  // Explicit fetch/resolver injection is the deterministic fixture boundary
  // used by offline qualification tests. Outside that qualification mode the
  // process-level outbound gate remains mandatory; the phase0 transport guard
  // still covers any accidental real transport from an offline fixture.
  const offlineFixture =
    process.env.ASHLEY_PHASE0_OFFLINE === "true" &&
    Boolean(options.fetcher || options.resolve);
  if (!offlineFixture) {
    assertOutboundAllowed(options.outboundPurpose ?? "curiosity_http");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }
  let current = input;
  const maxRedirects = Number.isFinite(options.maxRedirects)
    ? Math.max(0, Math.min(MAX_REDIRECTS, Math.floor(options.maxRedirects!)))
    : MAX_REDIRECTS;
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      const url = await withAbort(
        validatePublicUrl(current, options.resolve ?? defaultResolve),
        controller.signal,
      );
      const response = await withAbort(
        Promise.resolve().then(() => fetcher(url, {
          redirect: "manual",
          headers: {
            accept: options.accept,
            "user-agent": options.userAgent ?? "AshleyCuriosity/1.0",
          },
          signal: controller.signal,
        })),
        controller.signal,
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === maxRedirects) throw new Error("too_many_redirects");
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect_without_location");
        await response.body?.cancel();
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`http_${response.status}`);
      const bounded = await withAbort(
        boundedBody(response, options.maxBytes, options.truncateAtLimit ?? false),
        controller.signal,
      );
      return {
        finalUrl: url.toString(),
        contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
        body: bounded.body,
        redirectDepth: redirects,
        subrequests: redirects + 1,
        truncated: bounded.truncated,
      };
    }
    throw new Error("too_many_redirects");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("fetch_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }
}

export async function fetchValidatedResource(
  input: string,
  options: {
    accept: string;
    fetcher?: FetchLike;
    resolve?: ResolveHost;
  },
): Promise<LimitedFetchResult> {
  return fetchWithLimits(input, {
    accept: options.accept,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    fetcher: options.fetcher,
    resolve: options.resolve,
    outboundPurpose: "curiosity_http",
  });
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function boundedTimeout(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(FETCH_TIMEOUT_MS, Math.floor(value)));
}

export async function fetchWithAggregateLimits(
  inputs: readonly string[],
  options: {
    accept: string;
    timeoutMs: number;
    maxPages?: number;
    maxBytes?: number;
    maxRedirects?: number;
    maxSubrequests?: number;
    signal?: AbortSignal;
    fetcher?: FetchLike;
    resolve?: ResolveHost;
    outboundPurpose?: string;
    userAgent?: string;
  },
): Promise<AggregateFetchResult> {
  const urls = inputs.map((url) => url.trim()).filter(Boolean);
  if (urls.length === 0) throw new Error("aggregate_urls_empty");

  const maxPages = boundedLimit(
    options.maxPages,
    MAX_AGGREGATE_PAGES,
    MAX_AGGREGATE_PAGES,
  );
  const maxBytes = boundedLimit(
    options.maxBytes,
    MAX_AGGREGATE_BYTES,
    MAX_AGGREGATE_BYTES,
  );
  const maxRedirects = boundedLimit(
    options.maxRedirects,
    MAX_AGGREGATE_REDIRECTS,
    MAX_AGGREGATE_REDIRECTS,
  );
  const maxSubrequests = boundedLimit(
    options.maxSubrequests,
    MAX_AGGREGATE_SUBREQUESTS,
    MAX_AGGREGATE_SUBREQUESTS,
  );
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  const pages: AggregatePage[] = [];
  let totalBytes = 0;
  let redirectDepth = 0;
  let subrequests = 0;
  let truncated = false;
  let incomplete = false;

  try {
    for (const requestedUrl of urls) {
      const elapsed = Date.now() - startedAt;
      const remainingBytes = maxBytes - totalBytes;
      const remainingRedirects = Math.max(0, maxRedirects - redirectDepth);
      const remainingSubrequests = Math.max(0, maxSubrequests - subrequests);
      if (
        pages.length >= maxPages ||
        remainingBytes <= 0 ||
        remainingSubrequests <= 0 ||
        elapsed >= timeoutMs
      ) {
        truncated = true;
        incomplete = true;
        break;
      }

      const remainingMs = Math.max(1, timeoutMs - elapsed);
      const pageMaxRedirects = Math.min(
        MAX_REDIRECTS,
        remainingRedirects,
        Math.max(0, remainingSubrequests - 1),
      );
      try {
        const page = await fetchWithLimits(requestedUrl, {
          accept: options.accept,
          timeoutMs: Math.min(FETCH_TIMEOUT_MS, remainingMs),
          maxBytes: Math.min(MAX_RESPONSE_BYTES, remainingBytes),
          maxRedirects: pageMaxRedirects,
          truncateAtLimit: true,
          signal: controller.signal,
          fetcher: options.fetcher,
          resolve: options.resolve,
          outboundPurpose: options.outboundPurpose ?? "perception_http",
          userAgent: options.userAgent ?? "AshleyPerception/1.0",
        });
        pages.push({
          requestedUrl,
          finalUrl: page.finalUrl,
          contentType: page.contentType,
          body: page.body,
          redirectDepth: page.redirectDepth,
          subrequests: page.subrequests,
          truncated: page.truncated,
        });
        totalBytes += page.body.byteLength;
        redirectDepth += page.redirectDepth;
        subrequests += page.subrequests;
        if (page.truncated) {
          truncated = true;
          incomplete = true;
          break;
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : "fetch_failed";
        if (code === "fetch_timeout") {
          incomplete = true;
          break;
        }
        if (code === "too_many_redirects") {
          subrequests += pageMaxRedirects + 1;
          redirectDepth += pageMaxRedirects;
          truncated = true;
          incomplete = true;
          break;
        }
        throw error;
      }
    }

  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }

  return {
    pages,
    envelope: {
      totalPages: pages.length,
      totalBytes,
      redirectDepth,
      totalElapsedMs: Math.max(0, Date.now() - startedAt),
      fanOut: pages.length,
      subrequests,
      truncated,
      incomplete,
      truncationMarker: truncated
        ? AGGREGATE_TRUNCATION_MARKER
        : incomplete
          ? AGGREGATE_INCOMPLETE_MARKER
          : null,
    },
  };
}
