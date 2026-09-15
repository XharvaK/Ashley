import { DEFAULT_PRIVATE_THOUGHT_POLICY, PRIVATE_THOUGHT_WINDOW_MS } from "../private-budget/ledger.js";
import { DURABLE_RETRY_POLICY } from "../retry/policy.js";
import { ORDINARY_THOUGHT_BUDGET_MS, PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR } from "../types.js";
import { RPS_WINDOW_MS, TPM_WINDOW_MS } from "../../attention/types.js";
import { quotaContractFor, type QuotaContract } from "../../model-routing/router.js";
import type { QuotaBucket } from "../../model-routing/types.js";
import type { AvailableSocialDestination, SocialAudience } from "./types.js";

export type OperationalExhaustion =
  | { operational: "budget_exhausted" }
  | { operational: "backing_off" }
  | { operational: "paused" };

export type ResourceUsage = Readonly<{
  computeMs: number;
  outputTokens: number;
  networkRequests: number;
}>;

export type ResourceFusePolicy = Readonly<{
  windowMs: number;
  computeMs: number;
  outputTokens: number;
  networkRequests: number;
  rapidLoopWindowMs?: number;
  rapidLoopLimit?: number;
  backoffDelaysMs?: readonly number[];
}>;

export type SocialLifecycleResourceInput = Readonly<{
  conversationKey: string;
  consequenceChainId: string;
  lifecycleId: string;
  attemptLineage?: string;
  botParticipantId?: string;
  roomId?: string;
  nowMs: number;
  usage: ResourceUsage;
  paused?: boolean;
}>;

export type ResourceFuseDecision =
  | { accepted: true; deduplicated?: boolean }
  | { accepted: false; fact: OperationalExhaustion; retryAtMs?: number };

type RecordedUse = {
  atMs: number;
  lifecycleId: string;
  scopeKeys: string[];
  usage: ResourceUsage;
};

type LoopState = {
  count: number;
  lastAtMs: number;
  backoffUntilMs: number;
};

function finiteNonNegative(value: number, code: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}

function requiredText(value: string, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function validatePolicy(policy: ResourceFusePolicy): ResourceFusePolicy {
  finiteNonNegative(policy.windowMs, "resource_window_invalid");
  finiteNonNegative(policy.computeMs, "resource_compute_budget_invalid");
  finiteNonNegative(policy.outputTokens, "resource_output_budget_invalid");
  finiteNonNegative(policy.networkRequests, "resource_network_budget_invalid");
  if (policy.windowMs <= 0) throw new Error("resource_window_invalid");
  if (policy.rapidLoopWindowMs !== undefined) finiteNonNegative(policy.rapidLoopWindowMs, "resource_loop_window_invalid");
  if (policy.rapidLoopLimit !== undefined && (!Number.isInteger(policy.rapidLoopLimit) || policy.rapidLoopLimit < 0)) {
    throw new Error("resource_loop_limit_invalid");
  }
  for (const delay of policy.backoffDelaysMs ?? []) finiteNonNegative(delay, "resource_backoff_invalid");
  return policy;
}

function usage(value: ResourceUsage): ResourceUsage {
  return Object.freeze({
    computeMs: finiteNonNegative(value.computeMs, "resource_compute_usage_invalid"),
    outputTokens: finiteNonNegative(value.outputTokens, "resource_output_usage_invalid"),
    networkRequests: finiteNonNegative(value.networkRequests, "resource_network_usage_invalid"),
  });
}

function audienceKey(audience: SocialAudience): string {
  if (audience.kind === "owner_private") return "owner_private";
  if (audience.kind === "dm") return `dm:${audience.principalId}`;
  return `room:${audience.roomId}`;
}

export function socialDestinationKey(audience: SocialAudience): string {
  return audienceKey(audience);
}

function scopeKeys(input: SocialLifecycleResourceInput): string[] {
  const keys = [
    `conversation:${requiredText(input.conversationKey, "conversation_key_required")}`,
    `chain:${requiredText(input.consequenceChainId, "consequence_chain_id_required")}`,
  ];
  if (input.botParticipantId?.trim()) keys.push(`bot:${input.botParticipantId.trim()}`);
  if (input.roomId?.trim()) keys.push(`room:${input.roomId.trim()}`);
  return keys;
}

function addUsage(left: ResourceUsage, right: ResourceUsage): ResourceUsage {
  return {
    computeMs: left.computeMs + right.computeMs,
    outputTokens: left.outputTokens + right.outputTokens,
    networkRequests: left.networkRequests + right.networkRequests,
  };
}

function exceeds(total: ResourceUsage, next: ResourceUsage, policy: ResourceFusePolicy): boolean {
  return total.computeMs + next.computeMs > policy.computeMs
    || total.outputTokens + next.outputTokens > policy.outputTokens
    || total.networkRequests + next.networkRequests > policy.networkRequests;
}

function currentBackoffDelay(policy: ResourceFusePolicy, count: number): number {
  const delays = policy.backoffDelaysMs ?? DURABLE_RETRY_POLICY.delaysMs;
  return delays[Math.min(Math.max(count - 1, 0), delays.length - 1)] ?? 0;
}

/**
 * In-process coordination for social lifecycles. Durable capture and the
 * existing attention/private/retry ledgers remain the persistence and final
 * ceiling owners. This class only makes the social aggregate explicit and
 * fail-closed before a lifecycle is admitted to those owners.
 */
export class ResourceFuse {
  private readonly policy: ResourceFusePolicy;
  private readonly uses: RecordedUse[] = [];
  private readonly seenLifecycles = new Set<string>();
  private readonly loops = new Map<string, LoopState>();

  constructor(policy: ResourceFusePolicy) {
    this.policy = validatePolicy(policy);
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.policy.windowMs;
    while (this.uses.length > 0 && this.uses[0]!.atMs < cutoff) this.uses.shift();
  }

  private usageForScope(scopeKey: string): ResourceUsage {
    let total: ResourceUsage = { computeMs: 0, outputTokens: 0, networkRequests: 0 };
    for (const item of this.uses) {
      if (item.scopeKeys.includes(scopeKey)) total = addUsage(total, item.usage);
    }
    return total;
  }

  private loopKey(input: SocialLifecycleResourceInput): string {
    return [
      input.conversationKey,
      input.botParticipantId ?? "",
      input.roomId ?? "",
    ].join("\u001f");
  }

  admit(input: SocialLifecycleResourceInput): ResourceFuseDecision {
    requiredText(input.conversationKey, "conversation_key_required");
    requiredText(input.consequenceChainId, "consequence_chain_id_required");
    requiredText(input.lifecycleId, "lifecycle_id_required");
    finiteNonNegative(input.nowMs, "resource_time_invalid");
    const nextUsage = usage(input.usage);
    if (input.paused === true) return { accepted: false, fact: { operational: "paused" } };
    if (this.seenLifecycles.has(input.lifecycleId)) return { accepted: true, deduplicated: true };

    this.prune(input.nowMs);
    const keys = scopeKeys(input);
    if (keys.some((key) => exceeds(this.usageForScope(key), nextUsage, this.policy))) {
      return { accepted: false, fact: { operational: "budget_exhausted" } };
    }

    const loopKey = this.loopKey(input);
    const prior = this.loops.get(loopKey);
    const loopWindow = this.policy.rapidLoopWindowMs ?? DURABLE_RETRY_POLICY.maxRetryAgeMs;
    if (prior && input.nowMs - prior.lastAtMs <= loopWindow) {
      if (input.nowMs < prior.backoffUntilMs) {
        return { accepted: false, fact: { operational: "backing_off" }, retryAtMs: prior.backoffUntilMs };
      }
      const loopLimit = this.policy.rapidLoopLimit ?? 1;
      if (prior.count >= loopLimit) {
        const retryAtMs = input.nowMs + currentBackoffDelay(this.policy, prior.count);
        this.loops.set(loopKey, { ...prior, backoffUntilMs: retryAtMs });
        return { accepted: false, fact: { operational: "backing_off" }, retryAtMs };
      }
    }
    return { accepted: true };
  }

  record(input: SocialLifecycleResourceInput): void {
    const decision = this.admit(input);
    if (!decision.accepted || decision.deduplicated) return;
    this.recordAccepted(input);
  }

  private recordAccepted(input: SocialLifecycleResourceInput): void {
    const keys = scopeKeys(input);
    const nextUsage = usage(input.usage);
    this.uses.push({ atMs: input.nowMs, lifecycleId: input.lifecycleId, scopeKeys: keys, usage: nextUsage });
    this.seenLifecycles.add(input.lifecycleId);
    const loopKey = this.loopKey(input);
    const prior = this.loops.get(loopKey);
    this.loops.set(loopKey, {
      count: prior && input.nowMs - prior.lastAtMs <= (this.policy.rapidLoopWindowMs ?? DURABLE_RETRY_POLICY.maxRetryAgeMs)
        ? prior.count + 1
        : 1,
      lastAtMs: input.nowMs,
      backoffUntilMs: 0,
    });
  }

  admitAndRecord(input: SocialLifecycleResourceInput): ResourceFuseDecision {
    const decision = this.admit(input);
    if (decision.accepted && !decision.deduplicated) this.recordAccepted(input);
    return decision;
  }

  usageSnapshot(nowMs: number): ResourceUsage {
    finiteNonNegative(nowMs, "resource_time_invalid");
    this.prune(nowMs);
    return this.uses.reduce((total, item) => addUsage(total, item.usage), {
      computeMs: 0,
      outputTokens: 0,
      networkRequests: 0,
    });
  }
}

export type ResourceOwnerCeilings = Readonly<{
  attention: Readonly<{
    rps: number;
    rpm: number;
    tpm: number;
    rpsWindowMs: number;
    tpmWindowMs: number;
  }>;
  privateThought: Readonly<{
    limit: number;
    windowMs: number;
  }>;
  retry: typeof DURABLE_RETRY_POLICY;
  thoughtBudgetMs: number;
}>;

/** Snapshot the existing backstop owners; this does not create a second quota. */
export function currentResourceOwnerCeilings(quotaBucket: QuotaBucket): ResourceOwnerCeilings {
  const attention: QuotaContract = quotaContractFor(quotaBucket);
  return Object.freeze({
    attention: Object.freeze({
      rps: attention.rps,
      rpm: attention.rpm,
      tpm: attention.tpm,
      rpsWindowMs: RPS_WINDOW_MS,
      tpmWindowMs: TPM_WINDOW_MS,
    }),
    privateThought: Object.freeze({
      limit: DEFAULT_PRIVATE_THOUGHT_POLICY.limit ?? PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR,
      windowMs: PRIVATE_THOUGHT_WINDOW_MS,
    }),
    retry: DURABLE_RETRY_POLICY,
    thoughtBudgetMs: ORDINARY_THOUGHT_BUDGET_MS,
  });
}

/** Build the three social dimensions from the current system backstop owners. */
export function resourceFusePolicyFromOwners(quotaBucket: QuotaBucket): ResourceFusePolicy {
  const owners = currentResourceOwnerCeilings(quotaBucket);
  return {
    windowMs: owners.attention.tpmWindowMs,
    computeMs: owners.thoughtBudgetMs,
    outputTokens: owners.attention.tpm,
    networkRequests: owners.attention.rpm,
    rapidLoopWindowMs: owners.retry.maxRetryAgeMs,
    backoffDelaysMs: owners.retry.delaysMs,
  };
}

export type SocialLifecycleReference = Readonly<{
  conversationKey: string;
  captureRef: string;
  receivedAtMs: number;
}>;

export type SocialLifecycleBatch = Readonly<{
  conversationKey: string;
  captureRefs: string[];
  firstReceivedAtMs: number;
  lastReceivedAtMs: number;
}>;

/** Group durable references for the next lifecycle. Every unique ref survives. */
export function coalesceSocialLifecycleBatch(
  refs: readonly SocialLifecycleReference[],
): SocialLifecycleBatch[] {
  const batches = new Map<string, { refs: string[]; seen: Set<string>; first: number; last: number }>();
  for (const ref of refs) {
    const conversationKey = requiredText(ref.conversationKey, "conversation_key_required");
    const captureRef = requiredText(ref.captureRef, "capture_ref_required");
    finiteNonNegative(ref.receivedAtMs, "received_at_invalid");
    let batch = batches.get(conversationKey);
    if (!batch) {
      batch = { refs: [], seen: new Set(), first: ref.receivedAtMs, last: ref.receivedAtMs };
      batches.set(conversationKey, batch);
    }
    if (!batch.seen.has(captureRef)) {
      batch.seen.add(captureRef);
      batch.refs.push(captureRef);
    }
    batch.first = Math.min(batch.first, ref.receivedAtMs);
    batch.last = Math.max(batch.last, ref.receivedAtMs);
  }
  return [...batches.entries()].map(([conversationKey, batch]) => ({
    conversationKey,
    captureRefs: [...batch.refs],
    firstReceivedAtMs: batch.first,
    lastReceivedAtMs: batch.last,
  }));
}

export type NotificationBatch = Readonly<{
  principalId: string;
  day: string;
  window: number | "digest";
  refs: string[];
}>;

export class NotificationBatcher {
  private readonly windowMs: number;
  private readonly dailyCap: number;
  private readonly batches = new Map<string, NotificationBatch>();

  constructor(input: { windowMs: number; dailyCap: number }) {
    if (!Number.isFinite(input.windowMs) || input.windowMs <= 0) throw new Error("notification_window_invalid");
    if (!Number.isInteger(input.dailyCap) || input.dailyCap < 0) throw new Error("notification_cap_invalid");
    this.windowMs = input.windowMs;
    this.dailyCap = input.dailyCap;
  }

  private day(nowMs: number): string {
    return new Date(nowMs).toISOString().slice(0, 10);
  }

  private key(principalId: string, day: string, window: number | "digest"): string {
    return `${principalId}:${day}:${String(window)}`;
  }

  enqueue(principalId: string, nowMs: number, ref: string): {
    kind: "window" | "digest";
    created: boolean;
    batch: NotificationBatch;
  } {
    const principal = requiredText(principalId, "notification_principal_required");
    const notificationRef = requiredText(ref, "notification_ref_required");
    finiteNonNegative(nowMs, "notification_time_invalid");
    const day = this.day(nowMs);
    const window = Math.floor(nowMs / this.windowMs);
    const currentKey = this.key(principal, day, window);
    const existingWindow = this.batches.get(currentKey);
    if (existingWindow) {
      if (!existingWindow.refs.includes(notificationRef)) existingWindow.refs.push(notificationRef);
      return { kind: "window", created: false, batch: existingWindow };
    }
    const dailyWindows = [...this.batches.values()].filter((item) =>
      item.principalId === principal && item.day === day && item.window !== "digest",
    ).length;
    const kind = dailyWindows >= this.dailyCap ? "digest" : "window";
    const batchKey = this.key(principal, day, kind === "digest" ? "digest" : window);
    const existing = this.batches.get(batchKey);
    if (existing) {
      if (!existing.refs.includes(notificationRef)) existing.refs.push(notificationRef);
      return { kind, created: false, batch: existing };
    }
    const batch: NotificationBatch = {
      principalId: principal,
      day,
      window: kind === "digest" ? "digest" : window,
      refs: [notificationRef],
    };
    this.batches.set(batchKey, batch);
    return { kind, created: true, batch };
  }

  get(principalId: string, nowMs: number, kind: "window" | "digest" = "window"): NotificationBatch {
    const principal = requiredText(principalId, "notification_principal_required");
    const day = this.day(nowMs);
    const window = Math.floor(nowMs / this.windowMs);
    const batch = this.batches.get(this.key(principal, day, kind === "digest" ? "digest" : window));
    return batch ?? { principalId: principal, day, window: kind === "digest" ? "digest" : window, refs: [] };
  }
}

export function recordMultiDestinationChoice(input: {
  available: readonly AvailableSocialDestination[];
  chosen: SocialAudience;
}): { accepted: true; destination: SocialAudience } {
  const match = input.available.find((item) => socialDestinationKey(item.audience) === socialDestinationKey(input.chosen));
  if (!match) throw new Error("destination_not_available");
  return { accepted: true, destination: match.audience };
}
