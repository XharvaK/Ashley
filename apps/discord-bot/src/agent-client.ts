import { config } from "./config.js";

const AGENT_TRANSPORT_HARD_MS = 30_000;

export type AgentError = {
  error: string;
  code: string;
  retryAfterSec?: number;
};

export type DiscordPresencePayload = {
  status: "online" | "idle";
  label: string;
};

function isTimeoutAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || err.name === "AbortError";
}

async function agentFetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = AGENT_TRANSPORT_HARD_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.agentUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
    });
  } catch (err) {
    if (isTimeoutAbort(err)) {
      const e = new Error("agent request timed out") as Error & {
        code?: string;
      };
      e.code = "agent_timeout";
      throw e;
    }
    throw err;
  }
  const body = (await res.json()) as T & AgentError;
  if (!res.ok && res.status !== 202) {
    const err = new Error(body.error ?? res.statusText);
    const e = err as Error & { code?: string; retryAfterSec?: number; status?: number };
    e.code = body.code;
    e.status = res.status;
    if (body.retryAfterSec != null) e.retryAfterSec = body.retryAfterSec;
    throw err;
  }
  return { ...body, __httpStatus: res.status } as T;
}

export type CognitiveIngressResult = {
  accepted: true;
  evidenceRowId: string;
  inboxEventId: string;
  conversationId: string;
  cycleId: string;
  generation: number;
  action: "compose" | "preempt";
  duplicate?: boolean;
  evidenceRecordId?: string;
  admittedAtMs?: number;
};

/** Durable cognitive admission. The response is only an admission receipt. */
export async function ingressChat(
  message: string,
  options?: {
    threadId?: string;
    attachments?: Array<{
      discordAttachmentId: string;
      declaredMime: string;
      fileName: string;
      declaredByteSize?: number;
      sourceUrl: string;
    }>;
    discordPresence?: DiscordPresencePayload;
    inboundDiscordMessageIds?: string[];
    finalFragmentReceivedAtMs?: number;
  },
): Promise<CognitiveIngressResult> {
  return agentFetch<CognitiveIngressResult>(
    "/chat/ingress",
    {
      method: "POST",
      body: JSON.stringify({
        message,
        userId: config.ownerId,
        channel: "discord",
        threadId: options?.threadId,
        attachments: options?.attachments?.length ? options.attachments : undefined,
        discordPresence: options?.discordPresence,
        inboundDiscordMessageIds: options?.inboundDiscordMessageIds,
        finalFragmentReceivedAtMs: options?.finalFragmentReceivedAtMs,
      }),
    },
  );
}

export type PendingDelivery = {
  reservationId: number;
  draftText: string;
  bubbles: Array<{
    ordinal: number;
    text: string;
    discordMessageId: string | null;
  }>;
  statusUrl: string;
};

export async function claimPendingDeliveries(options?: {
  lane?: "cognitive_v021";
}) {
  return agentFetch<{ deliveries: PendingDelivery[] }>(
    `/delivery/claim`,
    {
      method: "POST",
      body: JSON.stringify({
        userId: config.ownerId,
        lane: options?.lane,
      }),
    },
  );
}

export async function claimPendingCognitiveDeliveries() {
  return claimPendingDeliveries({ lane: "cognitive_v021" });
}

export async function receiptDeliveryBubble(
  reservationId: number,
  ordinal: number,
  discordMessageId: string,
) {
  return agentFetch<{ ok: boolean }>(`/delivery/${reservationId}/receipt`, {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      ordinal,
      discordMessageId,
    }),
  });
}

export async function receiptDeliveryAuxiliary(
  reservationId: number,
  input: {
    kind: "progress" | "delivery_error";
    text: string;
    discordMessageId: string;
  },
) {
  return agentFetch<{ ok: boolean }>(`/delivery/${reservationId}/auxiliary`, {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      ...input,
    }),
  });
}

export async function finalizeDelivery(
  reservationId: number,
  cause:
    | "complete"
    | "cancel"
    | "send_failure"
    | "first_bubble_deadline"
    | "delivery_lease" = "complete",
) {
  return agentFetch<{
    state: string;
    finalizationReason: string;
    deliveredText: string;
  }>(`/delivery/${reservationId}/finalize`, {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      cause,
    }),
  });
}

export async function curiosityStatus() {
  return agentFetch<{
    enabled: boolean;
    sources: number;
    itemsToday: number;
    readToday: number;
    takesToday: number;
    lastTakeAt: string | null;
    presence?: {
      ownTime: boolean;
      proactivePaused: boolean;
      curiosityEnabled: boolean;
      owing: { topic: string; id: number } | null;
      lastTake: {
        title: string;
        depth: "full" | "excerpt";
        createdAt: string;
        ageMin: number;
      } | null;
      currentActivity?:
        | { state: "none" }
        | {
            state: "active";
            kind: "reading";
            id: string;
            title: string;
            startedAt?: string;
          }
        | null;
    };
  }>("/curiosity/status");
}

export async function reportReaction(messageId: string, emoji: string) {
  return agentFetch<{ ok: boolean; feedback: string }>("/signals/reaction", {
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId, messageId, emoji }),
  });
}

export async function reportGifFeedback(input: {
  query: string;
  gifUrl: string;
  reaction?: string | null;
}) {
  return agentFetch<{ ok: boolean }>("/signals/gif-feedback", {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      query: input.query,
      gifUrl: input.gifUrl,
      reaction: input.reaction ?? null,
    }),
  });
}

export async function fetchSuccessfulGifQueries(): Promise<string[]> {
  try {
    const q = new URLSearchParams({ owner_id: config.ownerId });
    const body = await agentFetch<{ queries: string[] }>(
      `/signals/gif-queries?${q}`,
    );
    return body.queries ?? [];
  } catch {
    return [];
  }
}

export async function reportEmojiWeight(input: {
  emoji: string;
  context: string;
  positive?: boolean;
}) {
  try {
    return await agentFetch<{ ok: boolean; weight: number }>(
      "/signals/emoji-weight",
      {
        method: "POST",
        body: JSON.stringify({
          userId: config.ownerId,
          emoji: input.emoji,
          context: input.context,
          positive: input.positive === true,
        }),
      },
    );
  } catch {
    return { ok: false, weight: 1 };
  }
}

/** Cheap and best effort: a failure here just means no interim bubble. */
export async function lookupPreflight(message: string): Promise<boolean> {
  try {
    const res = await fetch(`${config.agentUrl}/chat/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { lookup?: boolean };
    return Boolean(body.lookup);
  } catch {
    return false;
  }
}

export async function pinMemory(
  text: string,
  sensitivity: "none" | "private" = "none",
  discordMessageId?: string,
) {
  return agentFetch<{
    ok: boolean;
    queued?: boolean;
    duplicate?: boolean;
    fact?: { key: string; value: string } | null;
    evidenceRowId?: string;
    cycleId?: string;
  }>(
    "/memory/pin",
    {
      method: "POST",
      body: JSON.stringify({
        userId: config.ownerId,
        text,
        sensitivity,
        ...(discordMessageId ? { discordMessageId } : {}),
      }),
    },
  );
}

export async function memorySummary(includePrivate = false) {
  const q = new URLSearchParams({
    owner_id: config.ownerId,
    ...(includePrivate ? { include_private: "true" } : {}),
  });
  return agentFetch<{
    facts: Array<{ key: string; value: string; category: string }>;
    narrative: string | null;
    lastUpdated: string;
  }>(`/memory/summary?${q}`);
}

export async function newThread() {
  return agentFetch<{ threadId: string }>("/memory/newthread", {
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId }),
  });
}

export async function forgetTopic(topic: string, confirmed: boolean) {
  return agentFetch<{
    preview: string[];
    deleted: number;
    receiptId: string | null;
    previewId?: string | null;
    expiresAt?: string | null;
    categoryCounts?: Record<string, number>;
    honesty?: {
      local: string;
      discord: string;
      mistral: string;
      oldBackups: string;
    };
    counts: {
      messagesRedacted: number;
      episodesForgotten: number;
      factsReconciled: number;
      revisionsReconciled: number;
      stateReconciled: number;
      evidenceRemoved: number;
      runsRedacted: number;
    };
  }>("/memory/forget", {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      topic,
      confirmed,
    }),
  });
}

export async function bindForgetConfirmation(
  previewId: string,
  confirmationDiscordMessageId: string,
) {
  return agentFetch<{ ok: boolean }>("/memory/forget/bind", {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      previewId,
      confirmationDiscordMessageId,
    }),
  });
}

export async function resolveForgetPreview(
  confirmationDiscordMessageId: string,
) {
  return agentFetch<{ previewId: string | null }>("/memory/forget/resolve", {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      confirmationDiscordMessageId,
    }),
  });
}

export async function confirmForgetPreview(previewId: string) {
  return agentFetch<{
    preview: string[];
    deleted: number;
    receiptId: string | null;
    honesty?: {
      local: string;
      discord: string;
      mistral: string;
      oldBackups: string;
    };
  }>("/memory/forget", {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      previewId,
      confirmed: true,
    }),
  });
}

export async function cancelForgetPreview(previewId: string) {
  return agentFetch<{ previewId?: string | null }>("/memory/forget", {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      previewId,
      cancel: true,
    }),
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${config.agentUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ready?: boolean };
    return Boolean(data.ready);
  } catch {
    return false;
  }
}

export async function tickCognitiveIdle() {
  return agentFetch<{
    conversationId: string | null;
    eligible: boolean;
    reason: string | null;
    thoughtModelAttempts: number;
    acceptedSettlements: number;
    thoughtCalls: number;
    cycleId: string | null;
    dormant: boolean;
  }>("/initiative/idle", {
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId }),
  });
}

export async function pauseProactiveRemote() {
  return agentFetch<{ ok: boolean; paused: boolean }>("/initiative/pause", {
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId }),
  });
}

export async function resumeProactiveRemote() {
  return agentFetch<{ ok: boolean; paused: boolean }>("/initiative/resume", {
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId }),
  });
}

export async function initiativeStatus() {
  const q = new URLSearchParams({
    owner_id: config.ownerId,
  });
  return agentFetch<{
    enabled: boolean;
    paused: boolean;
    sentToday: number;
    maxPerDay: number;
    lastSentAt: string | null;
    lastUserMessageAt: string | null;
    minIdleHours: number;
    lastDiagnostic: {
      at: string;
      stage: string;
      code: string;
    } | null;
  }>(`/initiative/status?${q}`);
}

export type IdentityReview = {
  id: number;
  revisionId: number;
  targetKind: "value" | "boundary";
  targetKey: string;
  proposedValue: string;
  ashleyPosition: "affirm" | "object" | "defer" | null;
  docDecision: "approve" | "reject" | "defer" | null;
  appliedAt: string | null;
};

export async function identityReviews() {
  const query = new URLSearchParams({ owner_id: config.ownerId });
  return agentFetch<{ reviews: IdentityReview[] }>(
    `/nuclear/identity/reviews?${query.toString()}`,
  );
}

export async function decideIdentityReview(
  reviewId: number,
  decision: "approve" | "reject" | "defer",
  rationale?: string,
) {
  return agentFetch<{ recorded: boolean; reviews: IdentityReview[] }>(
    "/nuclear/identity/reviews/doc",
    {
      method: "POST",
      body: JSON.stringify({
        userId: config.ownerId,
        reviewId,
        decision,
        rationale,
      }),
    },
  );
}

export async function getRelationshipSummary(offset = 0) {
  return agentFetch<{
    docReminders: number;
    selfCommitments: number;
    mutualActive: number;
    mutualProposed: number;
    tensions: number;
    withdrawals: number;
    items: Array<{ kind: string; status: string; text: string }>;
  }>(
    `/nuclear/relationship?owner_id=${encodeURIComponent(config.ownerId)}&limit=25&offset=${offset}`,
  );
}

export async function getContinuitySnapshot() {
  return agentFetch<{
    available: boolean;
    lineageId: string | null;
    recentEvents: Array<{ kind: string; occurredAt: string; detail: unknown }>;
  }>(`/nuclear/continuity?owner_id=${encodeURIComponent(config.ownerId)}`);
}

export async function getNuclearStatus() {
  return agentFetch<{
    health: {
      ok: boolean;
      schemaVersion: number;
      cognitionMode: string;
      reflectionMode: string;
    };
    initiative: {
      enabled: boolean;
      paused: boolean;
      sentToday: number;
      maxPerDay: number;
    };
    continuity: {
      available: boolean;
      lineageId: string | null;
    };
    relationshipState?: { state: string };
  }>(`/nuclear/status?owner_id=${encodeURIComponent(config.ownerId)}`);
}
