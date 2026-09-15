import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  htmlToText,
  parseFeed,
  type FeedItem,
} from "../../curiosity/feed.js";
import {
  FETCH_TIMEOUT_MS,
  MAX_AGGREGATE_SUBREQUESTS,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  fetchWithAggregateLimits,
  type FetchLike,
  type ResolveHost,
} from "../../curiosity/network.js";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "../../privacy/secrets.js";
import {
  defaultUnclassifiedConversational,
  type DataClassification,
} from "../../privacy/classification.js";
import {
  DEFAULT_MAX_SUBSCRIPTIONS,
  PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE,
  type ExternalSubscriptionSource,
  type ExternalSubscriptionSourceKind,
  type Observation,
  type ObservationSubscription,
  type SubscriptionMutationAuthority,
  type SubscriptionPollOutcomeKind,
  type SubscriptionDelta,
} from "../types.js";
import { persistOrVerifyObservation } from "./persistence.js";

type Row = Record<string, unknown>;

/** The cheap idle loop is one minute; the periodic opportunity is four hours. */
export const MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS = 60_000 as const;
export const MAX_EXTERNAL_WATCH_POLL_INTERVAL_MS = 14_400_000 as const;
const MAX_EXTERNAL_WATCH_ITEM_TEXT = 8_000;
const MAX_EXTERNAL_WATCH_FEED_ITEMS = 40;

export type SubscriptionPollOutcome = {
  subscriptionId: string;
  kind: SubscriptionPollOutcomeKind;
  atMs: number;
  itemCount?: number;
  reason?: string;
};

export type SubscriptionPollResult = {
  items: SubscriptionItem[];
  outcomes: SubscriptionPollOutcome[];
};

type PollOutcomeItemKind =
  | "operational_expiry"
  | "fetch_failure"
  | "timeout"
  | "partial"
  | "unavailable";

export type SubscriptionItem = {
  itemId?: string;
  text?: string;
  content?: string;
  statement?: string;
  title?: string;
  topicKey?: string;
  source?: string;
  payload?: unknown;
  dataClassification?: DataClassification;
  secretOmitted?: boolean;
  createdAtMs?: number;
  /** Host-operational result; it is never an Ashley-authored semantic claim. */
  pollOutcome?: PollOutcomeItemKind;
  pollSubscriptionId?: string;
  pollReason?: string;
};

export type MatchSubscriptionItemOptions = {
  cycleId?: string;
  generation?: number;
  nowMs?: number;
};

export type CreateObservationSubscriptionInput = Omit<ObservationSubscription, "status"> & {
  status?: ObservationSubscription["status"];
};

export type CreateObservationSubscriptionOptions = {
  authority?: SubscriptionMutationAuthority;
};

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function sourceKind(value: unknown): ExternalSubscriptionSourceKind | null {
  return value === "url" || value === "url_pattern" || value === "rss" || value === "atom" || value === "json"
    ? value
    : null;
}

function externalSourceFrom(row: Row, spec: Row): ExternalSubscriptionSource | null {
  const columnKind = sourceKind(row.external_source_type);
  const columnPattern = text(row.external_source_url_pattern);
  if (columnKind && columnPattern) return { kind: columnKind, urlPattern: columnPattern };
  const nested = isRow(spec.externalSource) ? spec.externalSource : null;
  const nestedKind = sourceKind(nested?.kind);
  const nestedPattern = text(nested?.urlPattern);
  return nestedKind && nestedPattern ? { kind: nestedKind, urlPattern: nestedPattern } : null;
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : number(value);
}

function parsePollOutcome(value: unknown): SubscriptionPollOutcomeKind | null {
  return value === "not_due"
    || value === "complete_no_match"
    || value === "matched"
    || value === "fetch_failure"
    || value === "timeout"
    || value === "partial"
    || value === "unavailable"
    || value === "rejected"
    || value === "expired"
    ? value
    : null;
}

function classification(value: unknown): DataClassification {
  return value === "ordinary" || value === "sensitive" || value === "never_public" || value === "secret"
    ? value
    : defaultUnclassifiedConversational();
}

function mapSubscription(value: unknown): ObservationSubscription | null {
  if (!isRow(value)) return null;
  const spec = json(value.spec_json);
  if (!isRow(spec)) return null;
  const topicKeys = Array.isArray(spec.topicKeys) ? spec.topicKeys.filter((item): item is string => typeof item === "string") : [];
  const match = spec.match === "equality" || spec.match === "substring" ? spec.match : null;
  if (typeof value.subscription_id !== "string" || typeof value.conversation_id !== "string" || !match) return null;
  const externalSource = externalSourceFrom(value, spec);
  return {
    subscriptionId: value.subscription_id,
    conversationId: value.conversation_id,
    concernId: typeof spec.concernId === "string" ? spec.concernId : null,
    source: text(spec.source),
    scope: text(spec.scope),
    topicKeys,
    match,
    expiresAtMs: value.expires_at_ms == null
      ? spec.expiresAtMs == null ? null : number(spec.expiresAtMs)
      : number(value.expires_at_ms),
    status: Number(value.cancelled ?? 0) === 1 ? "cancelled" : "active",
    externalSource,
    pollIntervalMs: value.poll_interval_ms == null
      ? nullableNumber(spec.pollIntervalMs)
      : number(value.poll_interval_ms),
    requesterId: value.requester_id == null ? (typeof spec.requesterId === "string" ? spec.requesterId : null) : text(value.requester_id),
    lastPolledAtMs: nullableNumber(value.last_polled_at_ms),
    lastPollOutcome: parsePollOutcome(value.last_poll_outcome),
    expiryOpportunityEmittedAtMs: nullableNumber(value.expiry_opportunity_emitted_at_ms),
  };
}

function subscriptionSpec(input: CreateObservationSubscriptionInput): Record<string, unknown> {
  const {
    status: _status,
    lastPolledAtMs: _lastPolledAtMs,
    lastPollOutcome: _lastPollOutcome,
    expiryOpportunityEmittedAtMs: _expiryOpportunityEmittedAtMs,
    ...spec
  } = input;
  return spec;
}

function pollUrl(urlPattern: string): string {
  return urlPattern.endsWith("*") ? urlPattern.slice(0, -1) : urlPattern;
}

function validateExternalSource(source: ExternalSubscriptionSource): void {
  if (!source || !sourceKind(source.kind)) throw new Error("subscription_external_source_invalid");
  const pattern = source.urlPattern.trim();
  if (!pattern || pattern.length > 2_048 || pattern.includes("*") && !pattern.endsWith("*")) {
    throw new Error("subscription_external_source_invalid");
  }
  let url: URL;
  try { url = new URL(pollUrl(pattern)); } catch { throw new Error("subscription_external_source_invalid"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("subscription_external_source_invalid");
  }
}

function validateSubscription(input: CreateObservationSubscriptionInput): void {
  if (!input.subscriptionId.trim()) throw new Error("subscription_id_required");
  if (!input.conversationId.trim()) throw new Error("subscription_conversation_required");
  if (!Array.isArray(input.topicKeys) || input.topicKeys.length === 0 || input.topicKeys.some((key) => !key.trim())) {
    throw new Error("subscription_topic_keys_required");
  }
  if (input.match !== "equality" && input.match !== "substring") throw new Error("subscription_match_invalid");
  const expiresAtMs = input.expiresAtMs;
  const pollIntervalMs = input.pollIntervalMs;
  if (expiresAtMs != null && (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0)) throw new Error("subscription_expiry_invalid");
  if (input.externalSource != null) {
    validateExternalSource(input.externalSource);
    if (typeof expiresAtMs !== "number" || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) throw new Error("subscription_external_expiry_required");
    if (typeof pollIntervalMs !== "number" || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS || pollIntervalMs > MAX_EXTERNAL_WATCH_POLL_INTERVAL_MS) {
      throw new Error("subscription_poll_interval_invalid");
    }
    if (input.requesterId != null && !input.requesterId.trim()) throw new Error("subscription_requester_invalid");
  } else if (input.pollIntervalMs != null) {
    throw new Error("subscription_external_source_required");
  }
}

function mutationShape(value: Pick<ObservationSubscription, "conversationId" | "concernId" | "source" | "scope" | "topicKeys" | "match" | "expiresAtMs" | "externalSource" | "pollIntervalMs" | "requesterId">): Record<string, unknown> {
  return {
    conversationId: value.conversationId,
    concernId: value.concernId ?? null,
    source: value.source,
    scope: value.scope,
    topicKeys: [...value.topicKeys],
    match: value.match,
    expiresAtMs: value.expiresAtMs ?? null,
    externalSource: value.externalSource ?? null,
    pollIntervalMs: value.pollIntervalMs ?? null,
    requesterId: value.requesterId ?? null,
  };
}

function subscriptionMutationChanged(
  existing: ObservationSubscription,
  input: CreateObservationSubscriptionInput,
): boolean {
  return JSON.stringify(mutationShape(existing)) !== JSON.stringify(mutationShape(input));
}

export function listObservationSubscriptions(
  db: DatabaseSync,
  conversationId?: string,
  options: { includeCancelled?: boolean; limit?: number } = {},
): ObservationSubscription[] {
  const limit = Math.max(1, Math.min(10_000, options.limit ?? 1000));
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (conversationId) {
    clauses.push("conversation_id = ?");
    args.push(conversationId);
  }
  if (!options.includeCancelled) clauses.push("cancelled = 0");
  args.push(limit);
  return db.prepare(
    `SELECT subscription_id, conversation_id, spec_json, cancelled,
            external_source_type, external_source_url_pattern, poll_interval_ms,
            expires_at_ms, requester_id, last_polled_at_ms, last_poll_outcome,
            expiry_opportunity_emitted_at_ms
       FROM observation_subscriptions
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY subscription_id ASC LIMIT ?`,
  ).all(...args)
    .map(mapSubscription)
    .filter((subscription): subscription is ObservationSubscription => subscription !== null);
}

export function createObservationSubscription(
  db: DatabaseSync,
  input: CreateObservationSubscriptionInput,
  maxPerConversation = DEFAULT_MAX_SUBSCRIPTIONS,
  options: CreateObservationSubscriptionOptions = {},
): ObservationSubscription {
  validateSubscription(input);
  const existing = listObservationSubscriptions(db, undefined, { includeCancelled: true })
    .find((subscription) => subscription.subscriptionId === input.subscriptionId);
  const changed = existing ? subscriptionMutationChanged(existing, input) : false;
  const reactivating = existing?.status === "cancelled" && input.status !== "cancelled";
  if (existing && (changed && input.status !== "cancelled" || reactivating) && !options.authority) {
    throw new Error("subscription_renewal_authority_required");
  }
  const resetPollState = !existing || changed || reactivating;
  const targetAlreadyActive = existing?.status === "active" && existing.conversationId === input.conversationId;
  if (!targetAlreadyActive && input.status !== "cancelled") {
    const row = db.prepare("SELECT COUNT(*) AS count FROM observation_subscriptions WHERE conversation_id = ? AND cancelled = 0 AND subscription_id <> ?").get(input.conversationId, input.subscriptionId) as Row | undefined;
    if (number(row?.count) >= maxPerConversation) throw new Error("subscription_capacity_exceeded");
  }
  db.prepare(
    `INSERT INTO observation_subscriptions
       (subscription_id, conversation_id, spec_json, cancelled,
        external_source_type, external_source_url_pattern, poll_interval_ms,
        expires_at_ms, requester_id, last_polled_at_ms, last_poll_outcome,
        expiry_opportunity_emitted_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(subscription_id) DO UPDATE SET conversation_id=excluded.conversation_id,
       spec_json=excluded.spec_json, cancelled=excluded.cancelled,
       external_source_type=excluded.external_source_type,
       external_source_url_pattern=excluded.external_source_url_pattern,
       poll_interval_ms=excluded.poll_interval_ms,
       expires_at_ms=excluded.expires_at_ms,
       requester_id=excluded.requester_id,
       last_polled_at_ms=excluded.last_polled_at_ms,
       last_poll_outcome=excluded.last_poll_outcome,
       expiry_opportunity_emitted_at_ms=excluded.expiry_opportunity_emitted_at_ms`,
  ).run(
    input.subscriptionId,
    input.conversationId,
    JSON.stringify(subscriptionSpec(input)),
    input.status === "cancelled" ? 1 : 0,
    input.externalSource?.kind ?? null,
    input.externalSource?.urlPattern.trim() ?? null,
    input.externalSource?.kind ? input.pollIntervalMs ?? null : null,
    input.expiresAtMs ?? null,
    input.requesterId ?? null,
    resetPollState ? null : existing?.lastPolledAtMs ?? null,
    resetPollState ? null : existing?.lastPollOutcome ?? null,
    resetPollState ? null : existing?.expiryOpportunityEmittedAtMs ?? null,
  );
  const result = listObservationSubscriptions(db, input.conversationId, { includeCancelled: true })
    .find((subscription) => subscription.subscriptionId === input.subscriptionId);
  if (!result) throw new Error("subscription_create_lost");
  return result;
}

export function cancelObservationSubscription(db: DatabaseSync, subscriptionId: string): boolean {
  const result = db.prepare("UPDATE observation_subscriptions SET cancelled = 1 WHERE subscription_id = ? AND cancelled = 0").run(subscriptionId);
  return number(result.changes) === 1;
}

/** Validate a settlement's create/cancel sequence without discarding existing subscriptions. */
export function assertSubscriptionCapacity(
  db: DatabaseSync,
  conversationId: string,
  deltas: SubscriptionDelta[],
  maxPerConversation = DEFAULT_MAX_SUBSCRIPTIONS,
): void {
  const existingById = new Map(
    listObservationSubscriptions(db, undefined, { includeCancelled: true })
      .map((subscription) => [subscription.subscriptionId, subscription] as const),
  );
  const activeByConversation = new Map<string, Set<string>>();
  for (const subscription of existingById.values()) {
    if (subscription.status !== "active") continue;
    const active = activeByConversation.get(subscription.conversationId) ?? new Set<string>();
    active.add(subscription.subscriptionId);
    activeByConversation.set(subscription.conversationId, active);
  }
  for (const delta of deltas) {
    if (delta.op === "cancel") {
      const existing = existingById.get(delta.subscriptionId);
      if (existing) activeByConversation.get(existing.conversationId)?.delete(delta.subscriptionId);
      continue;
    }
    validateSubscription(delta.subscription);
    const existing = existingById.get(delta.subscription.subscriptionId);
    if (existing && subscriptionMutationChanged(existing, delta.subscription)) {
      if (delta.authority !== "thought_adoption" && delta.authority !== "owner_request") {
        throw new Error("subscription_renewal_authority_required");
      }
    }
    if (existing?.status === "cancelled" && delta.authority !== "thought_adoption" && delta.authority !== "owner_request") {
      throw new Error("subscription_renewal_authority_required");
    }
    const previousActive = existing?.status === "active" ? activeByConversation.get(existing.conversationId) : undefined;
    previousActive?.delete(delta.subscription.subscriptionId);
    const active = activeByConversation.get(delta.subscription.conversationId) ?? new Set<string>();
    if (active.size >= maxPerConversation && !active.has(delta.subscription.subscriptionId)) {
      throw new Error("subscription_capacity_exceeded");
    }
    active.add(delta.subscription.subscriptionId);
    activeByConversation.set(delta.subscription.conversationId, active);
    existingById.set(delta.subscription.subscriptionId, {
      ...delta.subscription,
      status: "active",
    });
  }
}

/** Apply a Thought/Owner-authorized subscription mutation inside publication. */
export function applyObservationSubscriptionDelta(
  db: DatabaseSync,
  delta: SubscriptionDelta,
): void {
  if (delta.op === "cancel") {
    db.prepare("UPDATE observation_subscriptions SET cancelled = 1 WHERE subscription_id = ?").run(delta.subscriptionId);
    return;
  }
  createObservationSubscription(db, delta.subscription, DEFAULT_MAX_SUBSCRIPTIONS, {
    authority: delta.authority,
  });
}

function itemText(item: SubscriptionItem | string): string {
  if (typeof item === "string") return item;
  return item.text ?? item.content ?? item.statement ?? item.title ?? item.topicKey ?? "";
}

function itemTopicKey(item: SubscriptionItem | string): string {
  return typeof item === "string" ? "" : item.topicKey ?? "";
}

function itemPollOutcome(item: SubscriptionItem | string): PollOutcomeItemKind | null {
  return typeof item === "string" ? null : item.pollOutcome ?? null;
}

function itemPollSubscriptionId(item: SubscriptionItem | string): string | null {
  return typeof item === "string" ? null : item.pollSubscriptionId ?? null;
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function externalUrlMatches(pattern: string, actual: string): boolean {
  const trimmedPattern = pattern.trim();
  const normalizedActual = normalizedUrl(actual);
  if (trimmedPattern.endsWith("*")) {
    return normalizedActual.startsWith(normalizedUrl(trimmedPattern.slice(0, -1)));
  }
  return normalizedActual === normalizedUrl(trimmedPattern);
}

function externalPollUrl(subscription: ObservationSubscription): string | null {
  const pattern = subscription.externalSource?.urlPattern?.trim();
  return pattern ? pollUrl(pattern) : null;
}

function externalProvenance(subscription: ObservationSubscription, suffix?: string): string {
  const requester = subscription.requesterId ? `:requester:${subscription.requesterId}` : "";
  return `subscription:${subscription.subscriptionId}:${suffix ?? subscription.source}${requester}`;
}

function outcomeItem(
  subscription: ObservationSubscription,
  outcome: PollOutcomeItemKind,
  nowMs: number,
  reason?: string,
): SubscriptionItem {
  return {
    itemId: `watch:${subscription.subscriptionId}:${outcome}:${nowMs}`,
    source: externalPollUrl(subscription) ?? subscription.source,
    createdAtMs: nowMs,
    pollOutcome: outcome,
    pollSubscriptionId: subscription.subscriptionId,
    ...(reason ? { pollReason: reason } : {}),
    payload: {
      outcome,
      subscriptionId: subscription.subscriptionId,
      source: subscription.source,
      externalSource: subscription.externalSource ?? null,
      expiresAtMs: subscription.expiresAtMs,
      requesterId: subscription.requesterId ?? null,
      ownerRequested: subscription.requesterId != null,
      ...(reason ? { reason } : {}),
    },
  };
}

function pollErrorKind(error: unknown): "fetch_failure" | "timeout" | "unavailable" | "rejected" {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "fetch_timeout") return "timeout";
  if (message === "invalid_url" || message === "unsupported_url" || message === "non_public_address") return "rejected";
  if (message.startsWith("http_") || message === "response_too_large") return "unavailable";
  return "fetch_failure";
}

function sourceAcceptHeader(kind: ExternalSubscriptionSourceKind): string {
  if (kind === "rss" || kind === "atom") return "application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain";
  if (kind === "json") return "application/json, text/json";
  return "text/html, text/plain, application/json, application/xml, text/xml";
}

function contentTypeAllowed(kind: ExternalSubscriptionSourceKind, contentType: string): boolean {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized) return true;
  if (normalized === "application/pdf") return false;
  if (kind === "json") return normalized === "application/json" || normalized === "text/json" || normalized.endsWith("+json");
  if (kind === "rss" || kind === "atom") return normalized.includes("xml") || normalized.includes("rss") || normalized.includes("atom") || normalized.startsWith("text/");
  return normalized.startsWith("text/") || normalized.includes("html") || normalized.includes("xml") || normalized.includes("json");
}

function shortText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_EXTERNAL_WATCH_ITEM_TEXT);
}

function feedSubscriptionItems(
  feed: FeedItem[],
  subscription: ObservationSubscription,
  source: string,
  nowMs: number,
): SubscriptionItem[] {
  return feed.slice(0, MAX_EXTERNAL_WATCH_FEED_ITEMS).map((item, index) => ({
    itemId: item.url || `feed-item:${index}`,
    text: shortText([item.title, item.excerpt].filter(Boolean).join(" — ")),
    title: item.title,
    source,
    createdAtMs: nowMs,
    payload: {
      title: item.title,
      url: item.url,
      excerpt: item.excerpt,
      publishedAt: item.publishedAt,
      source,
      requesterId: subscription.requesterId ?? null,
      ownerRequested: subscription.requesterId != null,
    },
  }));
}

function jsonSubscriptionItems(
  value: unknown,
  subscription: ObservationSubscription,
  source: string,
  nowMs: number,
): SubscriptionItem[] | null {
  const rows = isRow(value) && Array.isArray(value.items) ? value.items : Array.isArray(value) ? value : [value];
  const items: SubscriptionItem[] = [];
  rows.slice(0, MAX_EXTERNAL_WATCH_FEED_ITEMS).forEach((row, index) => {
    const record = isRow(row) ? row : null;
    const parts = record
      ? [record.title, record.name, record.summary, record.description, record.text, record.content, record.message]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      : typeof row === "string" ? [row] : [];
    const textValue = shortText(parts.join(" — ") || JSON.stringify(row));
    if (!textValue) return;
    const itemId = record && (typeof record.id === "string" || typeof record.id === "number")
      ? String(record.id)
      : `json-item:${index}`;
    items.push({
      itemId,
      text: textValue,
      topicKey: record && typeof record.topicKey === "string" ? record.topicKey : undefined,
      source,
      createdAtMs: nowMs,
      payload: {
        value: textValue,
        source,
        requesterId: subscription.requesterId ?? null,
        ownerRequested: subscription.requesterId != null,
      },
    });
  });
  return items;
}

function urlSubscriptionItems(
  raw: string,
  subscription: ObservationSubscription,
  source: string,
  nowMs: number,
): SubscriptionItem[] {
  const textValue = shortText(htmlToText(raw));
  if (!textValue) return [];
  return [{
    itemId: createHash("sha256").update(`${source}:${textValue}`).digest("hex").slice(0, 32),
    text: textValue,
    source,
    createdAtMs: nowMs,
    payload: {
      source,
      requesterId: subscription.requesterId ?? null,
      ownerRequested: subscription.requesterId != null,
    },
  }];
}

function parseExternalBody(
  subscription: ObservationSubscription,
  raw: string,
  source: string,
  nowMs: number,
): SubscriptionItem[] | null {
  const kind = subscription.externalSource?.kind;
  if (!kind) return null;
  if (kind === "rss" || kind === "atom") {
    if (kind === "rss" && !/<rss\b/i.test(raw)) return null;
    if (kind === "atom" && !/<feed\b/i.test(raw)) return null;
    return feedSubscriptionItems(parseFeed(raw, MAX_EXTERNAL_WATCH_FEED_ITEMS), subscription, source, nowMs);
  }
  if (kind === "json") {
    try { return jsonSubscriptionItems(JSON.parse(raw), subscription, source, nowMs); } catch { return null; }
  }
  return urlSubscriptionItems(raw, subscription, source, nowMs);
}

function recordPollState(
  db: DatabaseSync,
  subscriptionId: string,
  nowMs: number,
  outcome: SubscriptionPollOutcomeKind,
  expiryOpportunityEmittedAtMs?: number | null,
): void {
  if (expiryOpportunityEmittedAtMs === undefined) {
    db.prepare(
      `UPDATE observation_subscriptions
          SET last_polled_at_ms = ?, last_poll_outcome = ?
        WHERE subscription_id = ?`,
    ).run(nowMs, outcome, subscriptionId);
    return;
  }
  db.prepare(
    `UPDATE observation_subscriptions
        SET last_polled_at_ms = ?, last_poll_outcome = ?,
            expiry_opportunity_emitted_at_ms = ?
      WHERE subscription_id = ?`,
  ).run(nowMs, outcome, expiryOpportunityEmittedAtMs, subscriptionId);
}

async function pollOneExternalSubscription(
  db: DatabaseSync,
  subscription: ObservationSubscription,
  options: ExternalSubscriptionPollOptions,
): Promise<{ outcome: SubscriptionPollOutcome; items: SubscriptionItem[] }> {
  const nowMs = options.nowMs ?? Date.now();
  const externalSource = subscription.externalSource;
  if (!externalSource || subscription.status !== "active") {
    return { outcome: { subscriptionId: subscription.subscriptionId, kind: "not_due", atMs: nowMs }, items: [] };
  }
  if (subscription.expiresAtMs == null) {
    recordPollState(db, subscription.subscriptionId, nowMs, "rejected");
    return {
      outcome: { subscriptionId: subscription.subscriptionId, kind: "rejected", atMs: nowMs, reason: "external_expiry_required" },
      items: [],
    };
  }
  if (nowMs >= subscription.expiresAtMs) {
    if (subscription.expiryOpportunityEmittedAtMs != null) {
      return { outcome: { subscriptionId: subscription.subscriptionId, kind: "expired", atMs: nowMs }, items: [] };
    }
    recordPollState(db, subscription.subscriptionId, nowMs, "expired", nowMs);
    return {
      outcome: { subscriptionId: subscription.subscriptionId, kind: "expired", atMs: nowMs, reason: "admitted_watch_expired" },
      items: [outcomeItem(subscription, "operational_expiry", nowMs, "admitted_watch_expired")],
    };
  }
  if (subscription.pollIntervalMs == null || !Number.isSafeInteger(subscription.pollIntervalMs)) {
    recordPollState(db, subscription.subscriptionId, nowMs, "rejected");
    return {
      outcome: { subscriptionId: subscription.subscriptionId, kind: "rejected", atMs: nowMs, reason: "poll_interval_required" },
      items: [],
    };
  }
  if (subscription.lastPolledAtMs != null && nowMs < subscription.lastPolledAtMs + subscription.pollIntervalMs) {
    return { outcome: { subscriptionId: subscription.subscriptionId, kind: "not_due", atMs: nowMs }, items: [] };
  }
  const requestedUrl = externalPollUrl(subscription);
  if (!requestedUrl) {
    recordPollState(db, subscription.subscriptionId, nowMs, "rejected");
    return {
      outcome: { subscriptionId: subscription.subscriptionId, kind: "rejected", atMs: nowMs, reason: "external_source_invalid" },
      items: [],
    };
  }
  try {
    const aggregate = await fetchWithAggregateLimits([requestedUrl], {
      accept: sourceAcceptHeader(externalSource.kind),
      timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
      maxPages: 1,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: MAX_REDIRECTS,
      maxSubrequests: MAX_AGGREGATE_SUBREQUESTS,
      fetcher: options.fetcher,
      resolve: options.resolve,
      outboundPurpose: "subscription_watch_http",
      userAgent: "AshleySubscriptionWatch/1.0",
    });
    const page = aggregate.pages[0];
    if (!page || !externalUrlMatches(externalSource.urlPattern, page.finalUrl)) {
      recordPollState(db, subscription.subscriptionId, nowMs, "rejected");
      return {
        outcome: { subscriptionId: subscription.subscriptionId, kind: "rejected", atMs: nowMs, reason: "source_descriptor_violation" },
        items: [],
      };
    }
    if (aggregate.envelope.incomplete || aggregate.envelope.truncated) {
      const kind: "timeout" | "partial" = aggregate.envelope.incomplete && !aggregate.envelope.truncated ? "timeout" : "partial";
      recordPollState(db, subscription.subscriptionId, nowMs, kind);
      return {
        outcome: { subscriptionId: subscription.subscriptionId, kind, atMs: nowMs, reason: aggregate.envelope.truncationMarker ?? "incomplete_capture" },
        items: [outcomeItem(subscription, kind, nowMs, aggregate.envelope.truncationMarker ?? "incomplete_capture")],
      };
    }
    if (!contentTypeAllowed(externalSource.kind, page.contentType)) {
      recordPollState(db, subscription.subscriptionId, nowMs, "unavailable");
      return {
        outcome: { subscriptionId: subscription.subscriptionId, kind: "unavailable", atMs: nowMs, reason: "unsupported_content_type" },
        items: [outcomeItem(subscription, "unavailable", nowMs, "unsupported_content_type")],
      };
    }
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(page.body);
    const items = parseExternalBody(subscription, raw, page.finalUrl, nowMs);
    if (items === null) {
      recordPollState(db, subscription.subscriptionId, nowMs, "unavailable");
      return {
        outcome: { subscriptionId: subscription.subscriptionId, kind: "unavailable", atMs: nowMs, reason: "source_parse_failed" },
        items: [outcomeItem(subscription, "unavailable", nowMs, "source_parse_failed")],
      };
    }
    const matchingItems = items.filter((item) => matchSubscriptionItem(subscription, item, { nowMs }) !== null);
    if (matchingItems.length === 0) {
      recordPollState(db, subscription.subscriptionId, nowMs, "complete_no_match");
      return {
        outcome: { subscriptionId: subscription.subscriptionId, kind: "complete_no_match", atMs: nowMs, itemCount: 0 },
        items: [],
      };
    }
    recordPollState(db, subscription.subscriptionId, nowMs, "matched");
    return {
      outcome: { subscriptionId: subscription.subscriptionId, kind: "matched", atMs: nowMs, itemCount: matchingItems.length },
      items: matchingItems,
    };
  } catch (error) {
    const kind = pollErrorKind(error);
    recordPollState(db, subscription.subscriptionId, nowMs, kind);
    const reason = error instanceof Error ? error.message : "fetch_failed";
    return {
      outcome: { subscriptionId: subscription.subscriptionId, kind, atMs: nowMs, reason },
      items: kind === "rejected" ? [] : [outcomeItem(subscription, kind, nowMs, reason)],
    };
  }
}

export type ExternalSubscriptionPollOptions = {
  nowMs?: number;
  timeoutMs?: number;
  fetcher?: FetchLike;
  resolve?: ResolveHost;
};

/** Poll admitted external watches without invoking Thought for each poll. */
export async function pollObservationSubscriptions(
  db: DatabaseSync,
  options: ExternalSubscriptionPollOptions = {},
): Promise<SubscriptionPollResult> {
  const result: SubscriptionPollResult = { items: [], outcomes: [] };
  for (const subscription of listObservationSubscriptions(db)) {
    if (!subscription.externalSource) continue;
    const polled = await pollOneExternalSubscription(db, subscription, options);
    result.outcomes.push(polled.outcome);
    result.items.push(...polled.items);
  }
  return result;
}

function validClassification(value: unknown): DataClassification {
  return classification(value);
}

function observationId(subscription: ObservationSubscription, item: SubscriptionItem | string): string {
  const identity = typeof item === "string"
    ? { text: item }
    : { itemId: item.itemId ?? null, text: itemText(item), topicKey: item.topicKey ?? null, createdAtMs: item.createdAtMs ?? null };
  const digest = createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex").slice(0, 32);
  return `subscription:${subscription.subscriptionId}:${digest}`;
}

function normalizedPayload(
  subscription: ObservationSubscription,
  item: SubscriptionItem | string,
  classificationValue: DataClassification,
  secretOmitted: boolean,
): unknown {
  const value = itemText(item);
  const attribution = {
    requesterId: subscription.requesterId ?? null,
    ownerRequested: subscription.requesterId != null,
  };
  if (secretOmitted) return { text: CREDENTIAL_OMITTED_PLACEHOLDER, topicKey: itemTopicKey(item) || null, ...attribution };
  if (typeof item === "string") return { text: value, ...attribution };
  return {
    itemId: item.itemId ?? null,
    text: value,
    topicKey: item.topicKey ?? null,
    source: item.source ?? null,
    payload: item.payload ?? null,
    dataClassification: classificationValue,
    ...attribution,
  };
}

function outcomeObservation(
  subscription: ObservationSubscription,
  item: SubscriptionItem,
  outcome: PollOutcomeItemKind,
  options: MatchSubscriptionItemOptions,
): Observation {
  const reason = item.pollReason ?? null;
  return {
    observationId: observationId(subscription, item),
    cycleId: options.cycleId ?? `subscription:${subscription.subscriptionId}`,
    generation: options.generation ?? 0,
    derived: true,
    replaySafe: true,
    modality: "subscription",
    payload: {
      kind: "operational_watch_outcome",
      outcome,
      subscriptionId: subscription.subscriptionId,
      source: subscription.source,
      externalSource: subscription.externalSource ?? null,
      expiresAtMs: subscription.expiresAtMs,
      requesterId: subscription.requesterId ?? null,
      ownerRequested: subscription.requesterId != null,
      ...(reason ? { reason } : {}),
    },
    provenance: externalProvenance(subscription, `watch:${outcome}`),
    dataClassification: "ordinary",
    secretOmitted: false,
  };
}

export function matchSubscriptionItem(
  subscription: ObservationSubscription,
  item: SubscriptionItem | string,
  options: MatchSubscriptionItemOptions = {},
): Observation | null {
  if (subscription.status !== "active") return null;
  const pollOutcome = itemPollOutcome(item);
  if (pollOutcome) {
    if (itemPollSubscriptionId(item) !== subscription.subscriptionId) return null;
    if (pollOutcome === "operational_expiry") return outcomeObservation(subscription, typeof item === "string" ? { } : item, pollOutcome, options);
    return outcomeObservation(subscription, typeof item === "string" ? { } : item, pollOutcome, options);
  }
  const nowMs = options.nowMs ?? Date.now();
  if (subscription.expiresAtMs != null && nowMs >= subscription.expiresAtMs) return null;
  if (subscription.externalSource) {
    const itemSource = typeof item === "string" ? "" : item.source?.trim() ?? "";
    if (!itemSource || !externalUrlMatches(subscription.externalSource.urlPattern, itemSource)) return null;
  }
  const value = itemText(item).trim();
  const topicKey = itemTopicKey(item).trim();
  if (!value && !topicKey) return null;
  const haystacks = [value.toLocaleLowerCase(), topicKey.toLocaleLowerCase()].filter(Boolean);
  const matches = subscription.topicKeys.some((key) => {
    const needle = key.trim().toLocaleLowerCase();
    if (!needle) return false;
    return haystacks.some((haystack) => subscription.match === "equality" ? haystack === needle : haystack.includes(needle));
  });
  if (!matches) return null;

  const suppliedClassification = typeof item === "string" ? defaultUnclassifiedConversational() : validClassification(item.dataClassification);
  const credential = detectCredentialShape(value).hit;
  const secretOmitted = credential || suppliedClassification === "secret" || (typeof item !== "string" && item.secretOmitted === true);
  const dataClassification: DataClassification = secretOmitted ? "secret" : suppliedClassification;
  return {
    observationId: observationId(subscription, item),
    cycleId: options.cycleId ?? `subscription:${subscription.subscriptionId}`,
    generation: options.generation ?? 0,
    derived: true,
    replaySafe: true,
    modality: "subscription",
    payload: normalizedPayload(subscription, item, dataClassification, secretOmitted),
    provenance: externalProvenance(subscription),
    dataClassification,
    secretOmitted,
  };
}

export function collectSubscriptionObservations(
  db: DatabaseSync,
  conversationId: string,
  items: Array<SubscriptionItem | string>,
  options: MatchSubscriptionItemOptions & { limit?: number } = {},
): Observation[] {
  const subscriptions = listObservationSubscriptions(db, conversationId);
  const limit = Math.max(1, Math.min(PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE, options.limit ?? PRIVATE_SUBSCRIPTION_ITEMS_PER_IDLE));
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const subscription of subscriptions) {
      const observation = matchSubscriptionItem(subscription, item, options);
      if (!observation || seen.has(observation.observationId)) continue;
      observations.push(observation);
      seen.add(observation.observationId);
      break;
    }
    if (observations.length >= limit) break;
  }
  return observations;
}

export function persistSubscriptionObservation(db: DatabaseSync, observation: Observation, createdAtMs = Date.now()): void {
  persistOrVerifyObservation(db, observation, createdAtMs);
}
