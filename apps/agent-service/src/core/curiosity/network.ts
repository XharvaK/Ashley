import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { assertOutboundAllowed } from "../continuity/process-guards.js";

export const MAX_REDIRECTS = 5;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 20_000;

export type ResolveHost = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;
export type FetchLike = typeof fetch;

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
): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error("response_too_large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
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
  },
): Promise<{ finalUrl: string; contentType: string; body: Uint8Array }> {
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
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const url = await withAbort(
        validatePublicUrl(current, options.resolve ?? defaultResolve),
        controller.signal,
      );
      const response = await fetcher(url, {
        redirect: "manual",
        headers: {
          accept: options.accept,
          "user-agent": options.userAgent ?? "AshleyCuriosity/1.0",
        },
        signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === MAX_REDIRECTS) throw new Error("too_many_redirects");
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect_without_location");
        await response.body?.cancel();
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`http_${response.status}`);
      return {
        finalUrl: url.toString(),
        contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
        body: await boundedBody(response, options.maxBytes),
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
): Promise<{ finalUrl: string; contentType: string; body: Uint8Array }> {
  return fetchWithLimits(input, {
    accept: options.accept,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    fetcher: options.fetcher,
    resolve: options.resolve,
    outboundPurpose: "curiosity_http",
  });
}
