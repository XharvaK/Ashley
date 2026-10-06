// I1 (User 2026-10-06: "I should be able to just tell her, and she would just do it"; nothing per site):
// websites as places she can act in. A site becomes hers when the Owner asks her to go there (she
// records it in a turn the Owner started) and stays until closed. In an approved site she makes any
// HTTP request with web.request; what the site gives her to keep secret (a key shown once, a token)
// goes into her vault and she sees only its name. Everything a site returns is someone else's words.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { detectCredentialShape } from "../privacy/secrets.js";
import { requestWithLimits, type FetchLike, type ResolveHost } from "../curiosity/network.js";

export const WEB_PLACE_CLAIMS_MAX = 3;
export const WEB_REQUESTS_PER_HOUR = 60;
export const WEB_REQUESTS_PER_DAY = 400;
export const WEB_REQUEST_BODY_MAX = 32 * 1024;
export const WEB_RESPONSE_SHOWN_CHARS = 16_000;
export const WEB_RESPONSE_MAX_BYTES = 512 * 1024;
export const WEB_REQUEST_TIMEOUT_MS = 20_000;

export type WebPlaceClaim = { origin: string; reason: string; close?: true };
export type WebRequest = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  /** Send a vault value as a header, e.g. {vault:"api_key", header:"Authorization", scheme:"Bearer"}. */
  auth?: { vault: string; header?: string; scheme?: string };
  /** Keep response values in the vault: {path:"agent.api_key", as:"api_key"} (dot path, [n] for arrays). */
  keep?: Array<{ path: string; as: string }>;
};
export type WebPlaceView = { origin: string; state: "approved" | "requested" | "closed"; reason?: string; vault?: string[];
  requests: { lastHour: number; limitPerHour: number }; recent?: Array<{ method: string; path: string; status?: number; error?: string; atMs: number }> };

type Row = Record<string, unknown>;
const VAULT_NAME = /^[A-Za-z0-9_.-]{1,48}$/;
const SECRET_KEY = /(^|[_\-.])(secret|token|api[_-]?key|apikey|password|passwd|private[_-]?key|access[_-]?key|bearer|credential)s?($|[_\-.])/i;
const SECRET_SHAPE = /\b[A-Za-z0-9]{2,16}_(?:sk|secret|token|key)_[A-Za-z0-9_\-]{12,}\b/;

/** https://host[:port], lowercased; anything else is not a web place. */
export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim().includes("://") ? value.trim() : `https://${value.trim()}`);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.origin.toLowerCase();
  } catch { return null; }
}

export function isWebPlaceClaims(value: unknown): value is WebPlaceClaim[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > WEB_PLACE_CLAIMS_MAX) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const claim = item as Row;
    return Object.keys(claim).every(key => ["origin", "reason", "close"].includes(key)) && normalizeOrigin(claim.origin) !== null
      && typeof claim.reason === "string" && claim.reason.trim().length > 0 && claim.reason.length <= 300
      && (claim.close === undefined || claim.close === true);
  });
}

/**
 * Her web place decisions from one settled cycle. In a turn the Owner started, a new site is approved with
 * the Owner's message as its basis; in her own time it is only requested (she asks the Owner).
 */
export function recordWebPlaceClaims(sidecar: DatabaseSync, input: {
  claims: readonly WebPlaceClaim[]; ownerTurn: boolean; basisRef?: string; nowMs: number;
}): Array<{ origin: string; state: string }> {
  return input.claims.slice(0, WEB_PLACE_CLAIMS_MAX).map(claim => {
    const origin = normalizeOrigin(claim.origin)!;
    const reason = claim.reason.trim().slice(0, 300);
    const existing = sidecar.prepare("SELECT state FROM web_places WHERE origin = ?").get(origin) as Row | undefined;
    const state = claim.close ? "closed" : input.ownerTurn ? "approved" : existing?.state === "approved" ? "approved" : "requested";
    sidecar.prepare(`INSERT INTO web_places (origin, state, reason, basis_ref, requested_at_ms, approved_at_ms, closed_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(origin) DO UPDATE SET state = excluded.state, reason = excluded.reason,
      basis_ref = COALESCE(excluded.basis_ref, web_places.basis_ref), approved_at_ms = COALESCE(excluded.approved_at_ms, web_places.approved_at_ms),
      closed_at_ms = excluded.closed_at_ms, updated_at_ms = excluded.updated_at_ms`).run(
      origin, state, reason, state === "approved" && input.ownerTurn ? input.basisRef ?? null : null, input.nowMs,
      state === "approved" && input.ownerTurn ? input.nowMs : null, state === "closed" ? input.nowMs : null, input.nowMs);
    return { origin, state };
  });
}

/** The Owner's hard switch (/places): close or reopen a site. */
export function setWebPlaceState(sidecar: DatabaseSync, origin: string, state: "approved" | "closed", nowMs: number, reason = "set by the Owner"): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  sidecar.prepare(`INSERT INTO web_places (origin, state, reason, requested_at_ms, approved_at_ms, closed_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(origin) DO UPDATE SET state = excluded.state, updated_at_ms = excluded.updated_at_ms,
    approved_at_ms = COALESCE(excluded.approved_at_ms, web_places.approved_at_ms), closed_at_ms = excluded.closed_at_ms`).run(
    normalized, state, reason, nowMs, state === "approved" ? nowMs : null, state === "closed" ? nowMs : null, nowMs);
  return true;
}

export function webPlaceState(sidecar: DatabaseSync, origin: string): string | null {
  const row = sidecar.prepare("SELECT state FROM web_places WHERE origin = ?").get(origin) as Row | undefined;
  return row ? String(row.state) : null;
}

// ---- the vault ---------------------------------------------------------------------------------

function vaultFile(vaultDir: string, origin: string): string {
  return join(vaultDir, `${createHash("sha256").update(origin).digest("hex").slice(0, 24)}.json`);
}

function readVault(vaultDir: string, origin: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(vaultFile(vaultDir, origin), "utf8")) as { origin?: string; values?: Record<string, string> };
    return parsed.origin === origin && parsed.values ? parsed.values : {};
  } catch { return {}; }
}

function writeVault(vaultDir: string, origin: string, values: Record<string, string>): void {
  mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
  const file = vaultFile(vaultDir, origin);
  writeFileSync(file, JSON.stringify({ origin, values }), { encoding: "utf8", mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* platform without modes */ }
}

export function vaultNames(vaultDir: string | undefined, origin: string): string[] {
  return vaultDir && existsSync(vaultDir) ? Object.keys(readVault(vaultDir, origin)).sort() : [];
}

/** Every value in any vault, so no response, note or post can carry one out. */
export function allVaultValues(vaultDir: string | undefined, origins: readonly string[]): string[] {
  if (!vaultDir) return [];
  return origins.flatMap(origin => Object.values(readVault(vaultDir, origin))).filter(value => value.length >= 8);
}

// ---- views ---------------------------------------------------------------------------------------

function requestCount(sidecar: DatabaseSync, origin: string | null, sinceMs: number): number {
  return Number((sidecar.prepare(`SELECT count(*) AS n FROM web_requests WHERE (? IS NULL OR origin = ?) AND at_ms > ?`)
    .get(origin, origin, sinceMs) as Row).n ?? 0);
}

export function webPlacesForThought(sidecar: DatabaseSync, vaultDir: string | undefined, nowMs: number): WebPlaceView[] {
  return (sidecar.prepare("SELECT origin, state, reason FROM web_places WHERE state != 'closed' ORDER BY updated_at_ms DESC LIMIT 12").all() as Row[])
    .map(row => {
      const origin = String(row.origin);
      const vault = vaultNames(vaultDir, origin);
      const recent = (sidecar.prepare("SELECT method, path, status, error, at_ms FROM web_requests WHERE origin = ? ORDER BY at_ms DESC LIMIT 3").all(origin) as Row[])
        .reverse().map(item => ({ method: String(item.method), path: String(item.path),
          ...(item.status == null ? {} : { status: Number(item.status) }), ...(typeof item.error === "string" ? { error: item.error } : {}), atMs: Number(item.at_ms) }));
      return { origin, state: String(row.state) as WebPlaceView["state"], ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
        ...(vault.length ? { vault } : {}), requests: { lastHour: requestCount(sidecar, origin, nowMs - 3_600_000), limitPerHour: WEB_REQUESTS_PER_HOUR },
        ...(recent.length ? { recent } : {}) };
    });
}

export function approvedWebOrigins(sidecar: DatabaseSync): string[] {
  return (sidecar.prepare("SELECT origin FROM web_places WHERE state = 'approved'").all() as Row[]).map(row => String(row.origin));
}

// ---- web.request --------------------------------------------------------------------------------

export function isValidWebRequest(value: unknown): value is WebRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Row;
  if (Object.keys(request).some(key => !["url", "method", "headers", "json", "body", "auth", "keep"].includes(key))) return false;
  if (typeof request.url !== "string" || request.url.length > 2048) return false;
  if (request.method !== undefined && !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(request.method))) return false;
  if (request.headers !== undefined) {
    if (!request.headers || typeof request.headers !== "object" || Array.isArray(request.headers)) return false;
    const entries = Object.entries(request.headers as Row);
    if (entries.length > 12 || entries.some(([key, item]) => !/^[A-Za-z0-9-]{1,64}$/.test(key) || typeof item !== "string" || item.length > 2048)) return false;
  }
  if (request.json !== undefined && request.body !== undefined) return false;
  if (request.body !== undefined && (typeof request.body !== "string" || request.body.length > WEB_REQUEST_BODY_MAX)) return false;
  if (request.json !== undefined && JSON.stringify(request.json).length > WEB_REQUEST_BODY_MAX) return false;
  if (request.auth !== undefined) {
    const auth = request.auth as Row;
    if (!auth || typeof auth !== "object" || Object.keys(auth).some(key => !["vault", "header", "scheme"].includes(key))
      || typeof auth.vault !== "string" || !VAULT_NAME.test(auth.vault)
      || (auth.header !== undefined && (typeof auth.header !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(auth.header)))
      || (auth.scheme !== undefined && (typeof auth.scheme !== "string" || auth.scheme.length > 32))) return false;
  }
  if (request.keep !== undefined) {
    if (!Array.isArray(request.keep) || request.keep.length > 6) return false;
    if (!request.keep.every(item => item && typeof item === "object" && typeof (item as Row).path === "string" && String((item as Row).path).length <= 200
      && typeof (item as Row).as === "string" && VAULT_NAME.test(String((item as Row).as)))) return false;
  }
  return true;
}

function substituteVault(text: string, vault: Record<string, string>): { text: string; missing?: string } {
  let missing: string | undefined;
  const out = text.replace(/\{\{vault:([A-Za-z0-9_.-]{1,48})\}\}/g, (_match, name: string) => {
    if (vault[name] === undefined) { missing = name; return ""; }
    return vault[name]!;
  });
  return { text: out, ...(missing ? { missing } : {}) };
}

function pathParts(path: string): Array<string | number> {
  return path.split(".").flatMap(part => {
    const parts: Array<string | number> = [];
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!match) return [part];
    if (match[1]) parts.push(match[1]);
    for (const index of match[2]!.matchAll(/\[(\d+)\]/g)) parts.push(Number(index[1]));
    return parts;
  });
}

function takeAt(root: unknown, path: string): { value?: string; set: (replacement: string) => void } {
  const parts = pathParts(path);
  let parent: unknown = undefined;
  let node: unknown = root;
  for (const part of parts) {
    parent = node;
    node = node && typeof node === "object" ? (node as Record<string | number, unknown>)[part] : undefined;
  }
  const last = parts.at(-1);
  return {
    ...(typeof node === "string" ? { value: node } : {}),
    set: (replacement: string) => { if (parent && typeof parent === "object" && last !== undefined) (parent as Record<string | number, unknown>)[last] = replacement; },
  };
}

/** Move secrets out of a parsed response: the ones she named, then any value that looks like one. */
function vaultSecrets(body: unknown, keep: readonly { path: string; as: string }[], store: Record<string, string>): string[] {
  const kept: string[] = [];
  for (const item of keep) {
    const found = takeAt(body, item.path);
    if (found.value === undefined) continue;
    store[item.as] = found.value;
    found.set(`[kept in your vault as ${item.as}]`);
    kept.push(item.as);
  }
  const walk = (node: unknown, trail: string) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Row)) {
      const path = trail ? `${trail}.${key}` : key;
      if (typeof value === "string") {
        const secretish = (SECRET_KEY.test(key) && value.length >= 12) || SECRET_SHAPE.test(value) || detectCredentialShape(value).hit;
        if (secretish && !value.startsWith("[kept in your vault")) {
          const name = key.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40) || "secret";
          const unique = store[name] === undefined || store[name] === value ? name : `${name}_${Object.keys(store).length}`;
          store[unique] = value;
          (node as Row)[key] = `[kept in your vault as ${unique}]`;
          kept.push(unique);
        }
      } else if (value && typeof value === "object") {
        walk(value, path);
      }
    }
  };
  walk(body, "");
  return [...new Set(kept)];
}

function scrub(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of values) if (value.length >= 8) out = out.split(value).join("[a vault value]");
  return out.replace(new RegExp(SECRET_SHAPE.source, "g"), "[a secret-looking value]");
}

export type WebRequestOutcome = {
  status?: number; url: string; contentType?: string; json?: unknown; text?: string; truncated?: boolean;
  location?: string; keptInVault?: string[]; error?: string;
};

/** Execute one web.request in an approved place; every attempt is logged (it counts toward the fuse). */
export async function executeWebRequest(sidecar: DatabaseSync, input: {
  request: WebRequest; vaultDir: string; cycleId?: string; nowMs: number; fetcher?: FetchLike; resolve?: ResolveHost;
}): Promise<WebRequestOutcome> {
  const method = input.request.method ?? (input.request.json !== undefined || input.request.body !== undefined ? "POST" : "GET");
  let url: URL;
  try { url = new URL(input.request.url); } catch { return { url: input.request.url, error: "invalid_url" }; }
  const origin = normalizeOrigin(url.origin);
  const log = (status: number | null, error: string | null) => sidecar.prepare(`INSERT INTO web_requests (origin, method, path, status, error, cycle_id, at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(origin ?? url.origin, method, `${url.pathname}`.slice(0, 200), status, error, input.cycleId ?? null, input.nowMs);
  if (!origin || webPlaceState(sidecar, origin) !== "approved") return { url: url.toString(), error: "not_an_approved_place" };
  if (requestCount(sidecar, origin, input.nowMs - 3_600_000) >= WEB_REQUESTS_PER_HOUR
    || requestCount(sidecar, origin, input.nowMs - 86_400_000) >= WEB_REQUESTS_PER_DAY) {
    return { url: url.toString(), error: "place_fuse" };
  }
  const vault = readVault(input.vaultDir, origin);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.request.headers ?? {})) {
    const filled = substituteVault(value, vault);
    if (filled.missing) return { url: url.toString(), error: `vault_missing:${filled.missing}` };
    headers[key.toLowerCase()] = filled.text;
  }
  if (input.request.auth) {
    const secret = vault[input.request.auth.vault];
    if (secret === undefined) return { url: url.toString(), error: `vault_missing:${input.request.auth.vault}` };
    const scheme = input.request.auth.scheme ?? "Bearer";
    headers[(input.request.auth.header ?? "Authorization").toLowerCase()] = scheme ? `${scheme} ${secret}` : secret;
  }
  let body: string | undefined;
  if (input.request.json !== undefined) {
    const filled = substituteVault(JSON.stringify(input.request.json), vault);
    if (filled.missing) return { url: url.toString(), error: `vault_missing:${filled.missing}` };
    body = filled.text;
    headers["content-type"] ??= "application/json";
  } else if (input.request.body !== undefined) {
    const filled = substituteVault(input.request.body, vault);
    if (filled.missing) return { url: url.toString(), error: `vault_missing:${filled.missing}` };
    body = filled.text;
  }
  headers.accept ??= "application/json, text/plain;q=0.9, */*;q=0.5";
  let result;
  try {
    result = await requestWithLimits(url.toString(), { method, headers, ...(body === undefined ? {} : { body }),
      timeoutMs: WEB_REQUEST_TIMEOUT_MS, maxBytes: WEB_RESPONSE_MAX_BYTES, fetcher: input.fetcher, resolve: input.resolve });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 80) : "request_failed";
    log(null, reason);
    return { url: url.toString(), error: reason };
  }
  log(result.status, null);
  const raw = Buffer.from(result.body).toString("utf8");
  const known = Object.values(vault);
  const outcome: WebRequestOutcome = { status: result.status, url: result.finalUrl, contentType: result.contentType,
    ...(result.location ? { location: result.location } : {}) };
  let parsed: unknown;
  let isJson = false;
  if (result.contentType.includes("json") || /^\s*[[{]/.test(raw)) {
    try { parsed = JSON.parse(raw); isJson = true; } catch { /* plain text */ }
  }
  if (isJson) {
    const kept = vaultSecrets(parsed, input.request.keep ?? [], vault);
    if (kept.length) { writeVault(input.vaultDir, origin, vault); outcome.keptInVault = kept; }
    const shown = scrub(JSON.stringify(parsed), [...known, ...Object.values(vault)]);
    if (shown.length <= WEB_RESPONSE_SHOWN_CHARS) outcome.json = JSON.parse(shown);
    else { outcome.text = shown.slice(0, WEB_RESPONSE_SHOWN_CHARS); outcome.truncated = true; }
  } else {
    const shown = scrub(raw, known);
    outcome.text = shown.slice(0, WEB_RESPONSE_SHOWN_CHARS);
    if (shown.length > WEB_RESPONSE_SHOWN_CHARS || result.truncated) outcome.truncated = true;
  }
  return outcome;
}
