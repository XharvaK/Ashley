import { config } from "./config.js";
import type { ExternalEnvelopeTransport } from "./chat/attachments.js";
import type { GateVerdict, OwnerRoomContext } from "./security/gate.js";

export type { ExternalEnvelopeTransport } from "./chat/attachments.js";

const AGENT_TRANSPORT_HARD_MS = 30_000;

export type AgentError = {
  error: string;
  code: string;
  retryAfterSec?: number;
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
        "X-Ashley-Bot-Service": config.token,
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
      sourceClass?: "supplied_image" | "supplied_screenshot";
    }>;
    inboundDiscordMessageIds?: string[];
    finalFragmentReceivedAtMs?: number;
    sourceSentAtMs?: number;
    ownerRoomContext?: OwnerRoomContext;
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
        inboundDiscordMessageIds: options?.inboundDiscordMessageIds,
        finalFragmentReceivedAtMs: options?.finalFragmentReceivedAtMs,
        sourceSentAtMs: options?.sourceSentAtMs,
        ownerRoomContext: options?.ownerRoomContext,
      }),
    },
  );
}

export type SocialEligibilityResult = {
  verdict: GateVerdict;
  audienceHint: "dm" | "room" | "unknown";
};

const botServiceHeaders = (): HeadersInit => ({
  "X-Ashley-Bot-Service": config.token,
});

/**
 * Admin acts are Alex's alone (SC-ADM-01). Only call sites reached after the
 * bot's own Owner check may send this: slash commands (handleSlash).
 */
const ownerActorHeaders = (): HeadersInit => ({
  "X-Ashley-Actor": config.ownerId,
});

export type OwnerTransportCapture = {
  discordMessageId: string;
  channelId: string;
  guildId?: string;
  message: string;
  attachments: Array<{
    discordAttachmentId: string;
    declaredMime: string;
    fileName: string;
    declaredByteSize?: number;
    sourceUrl: string;
    sourceClass?: "supplied_image" | "supplied_screenshot";
  }>;
  sentAtMs: number;
  capturedAtMs: number;
  ownerRoomContext?: OwnerRoomContext;
};

export async function captureOwnerTransport(
  input: OwnerTransportCapture,
): Promise<{ captured: true; duplicate: boolean; surfaceKey: string }> {
  return agentFetch<{ captured: true; duplicate: boolean; surfaceKey: string }>(
    "/chat/owner-transport/capture",
    {
      method: "POST",
      headers: botServiceHeaders(),
      body: JSON.stringify({
        userId: config.ownerId,
        discordMessageId: input.discordMessageId,
        channelId: input.channelId,
        guildId: input.guildId,
        message: input.message,
        attachments: input.attachments,
        sentAtMs: input.sentAtMs,
        capturedAtMs: input.capturedAtMs,
        ownerRoomContext: input.ownerRoomContext,
      }),
    },
  );
}

export type OwnerTransportSurface = {
  channelId: string;
  guildId?: string;
};

export type OwnerTransportPendingCapture = {
  discordMessageId: string;
  ownerId: string;
  surfaceKey: string;
  channelId: string;
  guildId: string | null;
  text: string;
  attachments: OwnerTransportCapture["attachments"];
  ownerRoomContext: OwnerRoomContext | null;
  sentAtMs: number;
  capturedAtMs: number;
  source: "live" | "history";
  admittedAtMs?: number | null;
};

export async function ownerTransportState(
  surface: OwnerTransportSurface,
): Promise<{ initialized: boolean; surfaceKey: string; afterMessageId: string | null; reason?: string }> {
  const query = new URLSearchParams({
    user_id: config.ownerId,
    channel_id: surface.channelId,
    ...(surface.guildId ? { guild_id: surface.guildId } : {}),
  });
  return agentFetch<{ initialized: boolean; surfaceKey: string; afterMessageId: string | null; reason?: string }>(
    `/chat/owner-transport/state?${query.toString()}`,
    {
    headers: botServiceHeaders(),
    },
  );
}

export async function recordOwnerTransportHistoryPage(input: {
  surface: OwnerTransportSurface;
  afterMessageId: string;
  nextAfterMessageId: string;
  messages: OwnerTransportCapture[];
}): Promise<{ accepted: true; surfaceKey: string; afterMessageId: string; newlyCaptured: number; duplicates: number }> {
  return agentFetch<{ accepted: true; surfaceKey: string; afterMessageId: string; newlyCaptured: number; duplicates: number }>("/chat/owner-transport/history-page", {
    method: "POST",
    headers: botServiceHeaders(),
    body: JSON.stringify({
      userId: config.ownerId,
      channelId: input.surface.channelId,
      guildId: input.surface.guildId,
      afterMessageId: input.afterMessageId,
      nextAfterMessageId: input.nextAfterMessageId,
      messages: input.messages.map((message) => ({
        discordMessageId: message.discordMessageId,
        message: message.message,
        attachments: message.attachments,
        sentAtMs: message.sentAtMs,
        ownerRoomContext: message.ownerRoomContext,
      })),
    }),
  });
}

export async function listPendingOwnerTransport(
  limit = 100,
): Promise<{ captures: OwnerTransportPendingCapture[] }> {
  const query = new URLSearchParams({ user_id: config.ownerId, limit: String(limit) });
  return agentFetch<{ captures: OwnerTransportPendingCapture[] }>(`/chat/owner-transport/pending?${query.toString()}`, {
    headers: botServiceHeaders(),
  });
}

export async function markOwnerTransportAdmitted(
  discordMessageIds: string[],
): Promise<{ ok: true; marked: number; alreadyAdmitted: number }> {
  return agentFetch<{ ok: true; marked: number; alreadyAdmitted: number }>("/chat/owner-transport/admitted", {
    method: "POST",
    headers: botServiceHeaders(),
    body: JSON.stringify({ userId: config.ownerId, discordMessageIds }),
  });
}

export async function querySocialEligibility(input: {
  authorId: string;
  channelId: string;
  guildId?: string;
  bot?: boolean;
}): Promise<SocialEligibilityResult> {
  const query = new URLSearchParams({
    author: input.authorId,
    channel: input.channelId,
    ...(input.guildId ? { guild: input.guildId } : {}),
    ...(input.bot === true ? { bot: "1" } : {}),
  });
  return agentFetch<SocialEligibilityResult>(`/social/eligibility?${query.toString()}`, {
    headers: botServiceHeaders(),
  }, 2_500);
}

export type ExternalCaptureResult = {
  captureRef: string;
  conversationKey: string;
  duplicate: boolean;
};

export async function captureExternalChat(
  envelope: ExternalEnvelopeTransport,
  message: string,
  options?: { gateHint?: GateVerdict; conversationKey?: string; names?: { speaker?: string; guild?: string; channel?: string } },
): Promise<ExternalCaptureResult> {
  return agentFetch<ExternalCaptureResult>("/chat/ingress-external/capture", {
    method: "POST",
    headers: botServiceHeaders(),
    body: JSON.stringify({
      envelope,
      message,
      discordMessageId: envelope.discordMessageId,
      attachments: envelope.attachmentRefs,
      gateHint: options?.gateHint,
      conversationKey: options?.conversationKey,
      ...(options?.names ? { names: options.names } : {}),
    }),
  });
}

export type PlacePost = {
  intent_id: string;
  target: { kind: "room"; guildId: string; channelId: string } | { kind: "contact"; principalId: string };
  text: string;
};
export type PlacePostReport = { intent_id: string; outcome: "posted" | "failed"; discord_message_id?: string; reason?: string };

/** B1: report what became of earlier posts and take the ones now due. */
export async function syncPlacePosts(reports: PlacePostReport[]): Promise<{ posts: PlacePost[] }> {
  return agentFetch<{ posts: PlacePost[] }>("/places/posts/sync", {
    method: "POST",
    headers: botServiceHeaders(),
    body: JSON.stringify({ reports }),
  }, 10_000);
}

export type ExternalBatchResult = {
  results: Array<{
    captureRef: string;
    disposition:
      | "external_eligible_pending"
      | "quarantined_external"
      | "already_batched"
      | "capture_missing"
      | "capture_invalid";
    notificationQueued?: boolean;
    reason?: string;
  }>;
};

export async function ingressExternalBatch(
  captureRefs: string[],
  conversationKey: string,
  finalFragmentReceivedAtMs?: number,
): Promise<ExternalBatchResult> {
  return agentFetch<ExternalBatchResult>("/chat/ingress-external", {
    method: "POST",
    headers: botServiceHeaders(),
    body: JSON.stringify({
      captureRefs,
      conversationKey,
      finalFragmentReceivedAtMs,
    }),
  });
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
  destination?: unknown;
};

export async function claimPendingDeliveries(options?: {
  lane?: "cognitive_v021" | "system_notice" | "social_notify";
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

export async function claimPendingSocialNotifications() {
  return claimPendingDeliveries({ lane: "social_notify" });
}

export async function claimPendingSystemNotifications() {
  return claimPendingDeliveries({ lane: "system_notice" });
}

export type ExternalPublicationRecheckResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function recheckExternalPublication(
  reservationId: number,
): Promise<ExternalPublicationRecheckResult> {
  return agentFetch<ExternalPublicationRecheckResult>(
    `/delivery/${reservationId}/recheck-external`,
    {
      method: "POST",
      body: JSON.stringify({ userId: config.ownerId }),
    },
  );
}

export async function recheckOwnerRoomPublication(
  reservationId: number,
): Promise<ExternalPublicationRecheckResult> {
  return agentFetch<ExternalPublicationRecheckResult>(
    `/delivery/${reservationId}/recheck-owner-room`,
    {
      method: "POST",
      body: JSON.stringify({ userId: config.ownerId }),
    },
  );
}

export async function recheckOwnerDmPublication(
  reservationId: number,
): Promise<ExternalPublicationRecheckResult> {
  return agentFetch<ExternalPublicationRecheckResult>(
    `/delivery/${reservationId}/recheck-owner-room`,
    {
      method: "POST",
      body: JSON.stringify({ userId: config.ownerId }),
    },
  );
}

export async function markDeliveryDispatchStarted(
  reservationId: number,
): Promise<{ ok: boolean; marked: boolean }> {
  return agentFetch<{ ok: boolean; marked: boolean }>(
    `/delivery/${reservationId}/dispatch-started`,
    {
      method: "POST",
      body: JSON.stringify({ userId: config.ownerId }),
    },
  );
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

export type PublicPresenceRemoteState = {
  audience: "FULLY_PUBLIC";
  action: "set" | "clear" | null;
  text: string | null;
  authoredAtMs: number | null;
  expiresAtMs: number | null;
  expired: boolean;
  stateRevision: number | null;
  sourceEffectId: string | null;
  projectionState: "pending" | "projected" | "failed" | "unknown" | null;
};

export async function publicPresenceState(): Promise<PublicPresenceRemoteState> {
  const query = new URLSearchParams({ owner_id: config.ownerId });
  return agentFetch<PublicPresenceRemoteState>(`/discord/public-presence?${query.toString()}`);
}

export async function recordPublicPresenceProjection(input: {
  stateRevision: number;
  sourceEffectId: string;
  outcome: "succeeded" | "failed" | "unknown";
  cause: string;
  error?: string | null;
  atMs?: number;
}) {
  return agentFetch<{ ok: boolean; accepted: boolean }>(
    "/discord/public-presence/projection-receipt",
    {
      method: "POST",
      body: JSON.stringify({
        userId: config.ownerId,
        ...input,
        atMs: input.atMs ?? Date.now(),
      }),
    },
  );
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
      headers: { "Content-Type": "application/json", "X-Ashley-Bot-Service": config.token },
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

/** Mood, opinions, and applied identity changes (Growth V1 G4). */
export type MemoryGrowth = {
  mood: { valence: number; energy: number; openness: number; tension: number; reason: string | null };
  opinions: Array<{ topic: string; stance: string }>;
  changes: Array<{ layer: string; text: string; appliedAt: string }>;
  becoming?: { text: string; writtenAt: string } | null;
  diary?: Array<{ day: string; text: string }>;
};

export async function memorySummary(includePrivate = false) {
  const q = new URLSearchParams({
    owner_id: config.ownerId,
    ...(includePrivate ? { include_private: "true" } : {}),
  });
  return agentFetch<{
    facts: Array<{ key: string; value: string; category: string }>;
    narrative: string | null;
    episodes?: Array<{ summary: string; endedAt: string }>;
    activity?: Array<{ at: string; pass: string; activity: string | null; entry: string | null }>;
    interests?: Array<{ root: string; branch: string }>;
    growth?: MemoryGrowth;
    lastUpdated: string;
  }>(`/memory/summary?${q}`);
}


export type TrustedContact = { principalId: string; scope: "dm_only" | "person_wide"; grantedAt: string; expiresAt: string | null };

/** A3: the Owner's trusted contacts. Writes are admin acts (Owner actor). */
export async function listContacts() {
  return agentFetch<{ contacts: TrustedContact[] }>("/social/contacts");
}

export async function addContact(principalId: string, scope: TrustedContact["scope"]) {
  return agentFetch<{ contact: Pick<TrustedContact, "principalId" | "scope" | "grantedAt"> }>("/social/contacts", {
    headers: ownerActorHeaders(),
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId, principalId, scope }),
  });
}

export async function removeContact(principalId: string) {
  return agentFetch<{ revoked: number }>("/social/contacts/revoke", {
    headers: ownerActorHeaders(),
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId, principalId }),
  });
}

export type OwnerPlace = { ref: string; kind: string; name: string; closed: boolean; theyAsked?: string[]; postsLast24h?: number };

/** G1: her places for the Owner, and the Owner's switch. */
export async function listPlaces() {
  return agentFetch<{ places: OwnerPlace[]; web: Array<{ origin: string; state: string; reason: string | null }>;
    rules: Array<{ place: string; rule: string; setAtMs: number }> }>("/places");
}

export async function switchPlace(place: string, state: "closed" | "open") {
  return agentFetch<{ place: string; state: string }>("/places/switch", {
    headers: ownerActorHeaders(),
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId, place, state }),
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
    headers: ownerActorHeaders(),
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId }),
  });
}

export async function resumeProactiveRemote() {
  return agentFetch<{ ok: boolean; paused: boolean }>("/initiative/resume", {
    headers: ownerActorHeaders(),
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId }),
  });
}

export type ThalamusStatus = {
  learning?:{gains:Record<string,number>;familyGains:Record<string,number>;habituation:Record<string,number>}|null;
  owner: "bot" | "thalamus";
  contractVersion: number;
  availability: "available" | "unavailable";
  watchCount: number | null;
  lastDecision: { atMs: number; code: string; reason: string; passType: string | null } | null;
};
export type InitiativeStatus = {
  thalamus?: ThalamusStatus;
  statusAvailability: "available" | "unavailable";
  legacyProactiveEnabled: boolean;
  legacyPaused: boolean;
  legacySentToday: number;
  legacyMaxPerDay: number;
  legacyLastSentAt: string | null;
  legacyMinIdleHours: number;
  periodicCognitionEnabled: boolean;
  periodicScheduleState: "unavailable" | "not_initialized" | "waiting" | "pending" | "disabled";
  periodicCadenceMs: number;
  nextEligibleAt: string | null;
  pendingOccurrenceId: string | null;
  activeConversationId: string | null;
  lastOwnerEvidenceAt: string | null;
  eligibleOccupiedConcernCount: number;
  lastPeriodicOccurrence: {
    outcome: string;
    detail: string | null;
    eligibleAt: string;
    closedAt: string;
  } | null;
  lastProactiveThought: {
    cycleId: string;
    generation: number;
    conversationId: string;
    triggerKind: string;
    state: string;
    admittedAt: string;
  } | null;
  lastProactiveDelivery: {
    outboxId: number;
    cycleId: string;
    generation: number;
    status: string;
    suppressed: boolean;
    nuclearReservationId: number | null;
  } | null;
};

export async function initiativeStatus(): Promise<InitiativeStatus> {
  const q = new URLSearchParams({
    owner_id: config.ownerId,
  });
  return agentFetch<InitiativeStatus>(`/initiative/status?${q}`);
}

export type InitiativeSchedulerContract={owner:"bot"|"thalamus";contractVersion:number};
export async function initiativeScheduler():Promise<InitiativeSchedulerContract>{
  return agentFetch(`/initiative/scheduler?${new URLSearchParams({owner_id:config.ownerId})}`);
}
export async function acknowledgeInitiativeScheduler(contract:InitiativeSchedulerContract,active:boolean,botUserId?:string):Promise<void>{
  await agentFetch("/initiative/scheduler/ack",{method:"POST",body:JSON.stringify({userId:config.ownerId,...contract,active,...(botUserId?{botUserId}:{})})});
}

/** A foundational revision Ashley proposed (Growth V1 G4). */
export type IdentityReview = {
  id: number;
  revisionId: number;
  targetKind: "value" | "boundary";
  targetKey: string;
  proposedValue: string;
  previousValue?: string | null;
  ashleyPosition: "affirm" | "object" | "defer" | null;
  ashleyRationale?: string | null;
  docDecision: "approve" | "reject" | "defer" | null;
  evidenceCount?: number;
  appliedAt: string | null;
  status?: string;
};

export type GrowthDimensionView = {
  id: string;
  name: string;
  question: string;
  status: "active" | "retired";
  origin: "owner_seed" | "ashley";
};
export type GrowthDimensionHistoryView = {
  historyId: string;
  dimensionId: string;
  op: string;
  actor: string;
  reason: string | null;
  createdAtMs: number;
};

export async function growthDimensions() {
  const query = new URLSearchParams({ owner_id: config.ownerId });
  return agentFetch<{ dimensions: GrowthDimensionView[]; history: GrowthDimensionHistoryView[] }>(
    `/growth/dimensions?${query.toString()}`,
  );
}

export async function seedGrowthDimension(name: string, question: string) {
  return agentFetch<{ dimension: GrowthDimensionView }>("/growth/dimensions/seed", {
    headers: ownerActorHeaders(),
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId, name, question }),
  });
}

export async function revertGrowthDimension(dimensionId: string) {
  return agentFetch<{ reverted: boolean }>("/growth/dimensions/revert", {
    headers: ownerActorHeaders(),
    method: "POST",
    body: JSON.stringify({ userId: config.ownerId, dimensionId }),
  });
}

export async function identityReviews() {
  const query = new URLSearchParams({ owner_id: config.ownerId });
  return agentFetch<{ reviews: IdentityReview[] }>(
    `/growth/identity/reviews?${query.toString()}`,
  );
}

export async function decideIdentityReview(
  reviewId: number,
  decision: "approve" | "reject" | "defer",
  rationale?: string,
) {
  return agentFetch<{ recorded: boolean; applied?: boolean; reviews: IdentityReview[] }>(
    "/growth/identity/reviews/doc",
    {
      headers: ownerActorHeaders(),
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

export type TemporalControlKind =
  | "future_trigger"
  | "subscription"
  | "commitment"
  | "directive";

export type TemporalControlOperation =
  | "list"
  | "inspect"
  | "cancel"
  | "amend"
  | "withdraw";

export type TemporalControlRecord = {
  kind: TemporalControlKind;
  id: string;
  conversationId: string | null;
  purpose: string | null;
  dueAtMs: number | null;
  concernId: string | null;
  status: string;
  cancellationState: string;
  [key: string]: unknown;
};

export type TemporalControlResponse = {
  operation: TemporalControlOperation;
  kind?: TemporalControlKind;
  id?: string;
  records?: {
    futureTriggers: TemporalControlRecord[];
    subscriptions: TemporalControlRecord[];
    commitments: TemporalControlRecord[];
    directives: TemporalControlRecord[];
  };
  record?: TemporalControlRecord;
  acknowledgement?: string;
  status?: string;
  cancellationState?: string;
  wakeState?: string | null;
  activeWorkAborted?: boolean;
  sourceReadable?: boolean;
  changed?: boolean;
};

export async function ownerTemporalControl(input: {
  operation: TemporalControlOperation;
  kind?: TemporalControlKind;
  id?: string;
  dueAtMs?: number;
  purpose?: string | null;
  limit?: number;
}): Promise<TemporalControlResponse> {
  return agentFetch<TemporalControlResponse>("/nuclear/temporal", {
    method: "POST",
    body: JSON.stringify({
      userId: config.ownerId,
      ...input,
    }),
  });
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
    thalamus?: ThalamusStatus;
  }>(`/nuclear/status?owner_id=${encodeURIComponent(config.ownerId)}`);
}

export type SocialOperationClass =
  | "public_search"
  | "public_fetch"
  | "supplied_attachment"
  | "bounded_followup";

export type SocialOperationDelegation = {
  entityUuid: string;
  ownerId: string;
  principalId: string;
  conversationId: string;
  operationClass: SocialOperationClass;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  version: number;
  sourceSpan: unknown;
};

export async function grantSocialOperationDelegations(input: {
  principalId: string;
  conversationId: string;
  operationClasses: SocialOperationClass[];
  expiresAt?: string | null;
}) {
  return agentFetch<{ ok: boolean; delegations: SocialOperationDelegation[] }>(
    "/nuclear/social-operation-delegations",
    {
      headers: ownerActorHeaders(),
      method: "POST",
      body: JSON.stringify({ userId: config.ownerId, ...input }),
    },
  );
}

export async function listSocialOperationDelegations(input: {
  principalId?: string;
  conversationId?: string;
}) {
  const query = new URLSearchParams({ owner_id: config.ownerId });
  if (input.principalId) query.set("principal_id", input.principalId);
  if (input.conversationId) query.set("conversation_id", input.conversationId);
  return agentFetch<{ delegations: SocialOperationDelegation[] }>(
    `/nuclear/social-operation-delegations?${query.toString()}`,
  );
}

export async function revokeSocialOperationDelegation(input: {
  entityUuid: string;
  expectedVersion?: number;
}) {
  return agentFetch<{ ok: boolean; delegation: SocialOperationDelegation }>(
    "/nuclear/social-operation-delegations/revoke",
    {
      headers: ownerActorHeaders(),
      method: "POST",
      body: JSON.stringify({ userId: config.ownerId, ...input }),
    },
  );
}

export type Practice = { revisionId: number; text: string; heldSinceMs: number };
export async function currentPractices() {
  const query = new URLSearchParams({ owner_id: config.ownerId });
  return agentFetch<{ practices: Practice[] }>(`/growth/practices?${query}`);
}
export async function revertPractice(revisionId: number) {
  return agentFetch<{ reverted: boolean }>("/growth/revisions/revert", {
    headers: ownerActorHeaders(), method: "POST",
    body: JSON.stringify({ userId: config.ownerId, revisionId }),
  });
}
