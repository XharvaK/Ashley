import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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
  type Observation,
  type ObservationSubscription,
  type SubscriptionDelta,
} from "../types.js";
import { persistOrVerifyObservation } from "./persistence.js";

type Row = Record<string, unknown>;

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
};

export type MatchSubscriptionItemOptions = {
  cycleId?: string;
  generation?: number;
  nowMs?: number;
};

export type CreateObservationSubscriptionInput = Omit<ObservationSubscription, "status"> & {
  status?: ObservationSubscription["status"];
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
  return {
    subscriptionId: value.subscription_id,
    conversationId: value.conversation_id,
    concernId: typeof spec.concernId === "string" ? spec.concernId : null,
    source: text(spec.source),
    scope: text(spec.scope),
    topicKeys,
    match,
    expiresAtMs: spec.expiresAtMs == null ? null : number(spec.expiresAtMs),
    status: Number(value.cancelled ?? 0) === 1 ? "cancelled" : "active",
  };
}

function subscriptionSpec(input: CreateObservationSubscriptionInput): Record<string, unknown> {
  const { status: _status, ...spec } = input;
  return spec;
}

function validateSubscription(input: CreateObservationSubscriptionInput): void {
  if (!input.subscriptionId.trim()) throw new Error("subscription_id_required");
  if (!input.conversationId.trim()) throw new Error("subscription_conversation_required");
  if (!Array.isArray(input.topicKeys) || input.topicKeys.length === 0 || input.topicKeys.some((key) => !key.trim())) {
    throw new Error("subscription_topic_keys_required");
  }
  if (input.match !== "equality" && input.match !== "substring") throw new Error("subscription_match_invalid");
  if (input.expiresAtMs != null && !Number.isFinite(input.expiresAtMs)) throw new Error("subscription_expiry_invalid");
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
    `SELECT subscription_id, conversation_id, spec_json, cancelled
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
): ObservationSubscription {
  validateSubscription(input);
  const existing = db.prepare("SELECT subscription_id FROM observation_subscriptions WHERE subscription_id = ?").get(input.subscriptionId);
  if (!existing && input.status !== "cancelled") {
    const row = db.prepare("SELECT COUNT(*) AS count FROM observation_subscriptions WHERE conversation_id = ? AND cancelled = 0").get(input.conversationId) as Row | undefined;
    if (number(row?.count) >= maxPerConversation) throw new Error("subscription_capacity_exceeded");
  }
  db.prepare(
    `INSERT INTO observation_subscriptions (subscription_id, conversation_id, spec_json, cancelled)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(subscription_id) DO UPDATE SET conversation_id=excluded.conversation_id,
       spec_json=excluded.spec_json, cancelled=excluded.cancelled`,
  ).run(input.subscriptionId, input.conversationId, JSON.stringify(subscriptionSpec(input)), input.status === "cancelled" ? 1 : 0);
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
  const active = new Set(listObservationSubscriptions(db, conversationId).map((item) => item.subscriptionId));
  for (const delta of deltas) {
    if (delta.op === "cancel") {
      active.delete(delta.subscriptionId);
      continue;
    }
    if (!active.has(delta.subscription.subscriptionId) && active.size >= maxPerConversation) {
      throw new Error("subscription_capacity_exceeded");
    }
    active.add(delta.subscription.subscriptionId);
  }
}

function itemText(item: SubscriptionItem | string): string {
  if (typeof item === "string") return item;
  return item.text ?? item.content ?? item.statement ?? item.title ?? item.topicKey ?? "";
}

function itemTopicKey(item: SubscriptionItem | string): string {
  return typeof item === "string" ? "" : item.topicKey ?? "";
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

function normalizedPayload(item: SubscriptionItem | string, classificationValue: DataClassification, secretOmitted: boolean): unknown {
  const value = itemText(item);
  if (secretOmitted) return { text: CREDENTIAL_OMITTED_PLACEHOLDER, topicKey: itemTopicKey(item) || null };
  if (typeof item === "string") return { text: value };
  return {
    itemId: item.itemId ?? null,
    text: value,
    topicKey: item.topicKey ?? null,
    source: item.source ?? null,
    payload: item.payload ?? null,
    dataClassification: classificationValue,
  };
}

export function matchSubscriptionItem(
  subscription: ObservationSubscription,
  item: SubscriptionItem | string,
  options: MatchSubscriptionItemOptions = {},
): Observation | null {
  if (subscription.status !== "active") return null;
  const nowMs = options.nowMs ?? Date.now();
  if (subscription.expiresAtMs != null && nowMs >= subscription.expiresAtMs) return null;
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
    payload: normalizedPayload(item, dataClassification, secretOmitted),
    provenance: `subscription:${subscription.subscriptionId}:${subscription.source}`,
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
