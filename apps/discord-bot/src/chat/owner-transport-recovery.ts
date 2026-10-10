import {
  Client,
  type Message,
} from "discord.js";
import {
  captureOwnerTransport,
  ingressChat,
  listPendingOwnerTransport,
  markOwnerTransportAdmitted,
  ownerTransportState,
  recordOwnerTransportHistoryPage,
  type OwnerTransportCapture,
  type OwnerTransportPendingCapture,
  type OwnerTransportSurface,
} from "../agent-client.js";
import { capTurnAttachments, describeIntake, hasIngestibleTextAttachment } from "./attachments.js";
import { config, getRaEffectiveConfig } from "../config.js";
import {
  isAllowedMessage,
  isOwner,
  ownerIngressRouteForMessage,
} from "../security/gate.js";
import type { OwnerRoomContext } from "../security/gate.js";
import type { MessageIngressChat } from "../handlers/messageCreate.js";

export const OWNER_TRANSPORT_QUIET_MS = 1_500;
export const OWNER_TRANSPORT_HARD_CAP_MS = 5_000;
const OWNER_TRANSPORT_PAGE_LIMIT = 100;
const OWNER_TRANSPORT_MAX_PAGES = 10;
const OWNER_TRANSPORT_PENDING_LIMIT = 100;

export type OwnerTransportRecoveryApi = {
  state: (surface: OwnerTransportSurface) => ReturnType<typeof ownerTransportState>;
  historyPage: (input: {
    surface: OwnerTransportSurface;
    afterMessageId: string;
    nextAfterMessageId: string;
    messages: OwnerTransportCapture[];
  }) => ReturnType<typeof recordOwnerTransportHistoryPage>;
  pending: (limit?: number) => ReturnType<typeof listPendingOwnerTransport>;
  admitted: (ids: string[]) => ReturnType<typeof markOwnerTransportAdmitted>;
  ingress: MessageIngressChat;
  capture: (input: OwnerTransportCapture) => ReturnType<typeof captureOwnerTransport>;
};

function defaultApi(): OwnerTransportRecoveryApi {
  return {
    state: ownerTransportState,
    historyPage: recordOwnerTransportHistoryPage,
    pending: listPendingOwnerTransport,
    admitted: markOwnerTransportAdmitted,
    ingress: ingressChat as MessageIngressChat,
    capture: captureOwnerTransport,
  };
}

function compareIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCaptures(left: OwnerTransportPendingCapture, right: OwnerTransportPendingCapture): number {
  const surface = left.surfaceKey.localeCompare(right.surfaceKey);
  if (surface !== 0) return surface;
  if (left.sentAtMs !== right.sentAtMs) return left.sentAtMs - right.sentAtMs;
  if (left.capturedAtMs !== right.capturedAtMs) return left.capturedAtMs - right.capturedAtMs;
  return compareIds(left.discordMessageId, right.discordMessageId);
}

/** Group transport facts using timing only. This does not create semantic turns. */
export function groupOwnerTransportCaptures(
  captures: OwnerTransportPendingCapture[],
): OwnerTransportPendingCapture[][] {
  const ordered = [...captures].sort(compareCaptures);
  const groups: OwnerTransportPendingCapture[][] = [];
  for (const capture of ordered) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const first = group?.[0];
    const sameSurface = previous?.surfaceKey === capture.surfaceKey;
    const withinQuiet = previous ? capture.sentAtMs - previous.sentAtMs <= OWNER_TRANSPORT_QUIET_MS : false;
    const withinHardCap = first ? capture.sentAtMs - first.sentAtMs <= OWNER_TRANSPORT_HARD_CAP_MS : false;
    if (group && sameSurface && withinQuiet && withinHardCap) {
      group.push(capture);
    } else {
      groups.push([capture]);
    }
  }
  return groups;
}

async function resolveSurfaces(client: Client): Promise<OwnerTransportSurface[]> {
  const surfaces: OwnerTransportSurface[] = [];
  try {
    const owner = await client.users.fetch(config.ownerId);
    const dm = await owner.createDM();
    if (dm?.id) surfaces.push({ channelId: dm.id });
  } catch (error) {
    console.warn("[discord-bot] Owner DM transport surface unavailable; catch-up remains retryable", error);
  }
  for (const channelId of config.allowedChannels) {
    const trimmed = channelId.trim();
    if (!trimmed) continue;
    surfaces.push({ channelId: trimmed, guildId: config.trustedRoomSeed.guildId || undefined });
  }
  const seen = new Set<string>();
  return surfaces.filter((surface) => {
    const key = `${surface.guildId ?? "dm"}:${surface.channelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activeTrustedRoomSurface(surface: OwnerTransportSurface): boolean {
  if (!surface.guildId) return true;
  const effective = getRaEffectiveConfig();
  return config.trustedRoomSeed.guildId === surface.guildId &&
    config.trustedRoomSeed.channelIds.includes(surface.channelId) &&
    effective.roomSeedActive &&
    effective.roomPublicationChannelId === surface.channelId;
}

type HistoryChannel = {
  messages: {
    fetch: (options: { limit: number; after?: string; cache?: boolean }) => Promise<CollectionLike>;
  };
};

type CollectionLike = {
  values: () => IterableIterator<Message>;
};

async function fetchHistoryPage(
  client: Client,
  surface: OwnerTransportSurface,
  afterMessageId: string,
): Promise<Message[]> {
  let channel: unknown;
  if (surface.guildId) {
    channel = await client.channels.fetch(surface.channelId);
  } else {
    const owner = await client.users.fetch(config.ownerId);
    channel = await owner.createDM();
  }
  const candidate = channel as HistoryChannel | null;
  if (!candidate?.messages || typeof candidate.messages.fetch !== "function") {
    throw new Error("owner_transport_history_channel_unavailable");
  }
  const fetched = await candidate.messages.fetch({
    limit: OWNER_TRANSPORT_PAGE_LIMIT,
    after: afterMessageId,
    cache: false,
  });
  return [...fetched.values()].sort((left, right) => {
    if (left.createdTimestamp !== right.createdTimestamp) {
      return left.createdTimestamp - right.createdTimestamp;
    }
    return compareIds(left.id, right.id);
  });
}

function snapshotForHistory(
  client: Client,
  message: Message,
  surface: OwnerTransportSurface,
): OwnerTransportCapture | null {
  if (client.user?.id && message.author?.id === client.user.id) return null;
  if (!message.author?.id || !isOwner(message.author.id)) return null;
  if (!isAllowedMessage(message)) return null;
  const route = ownerIngressRouteForMessage(message);
  if (route.kind === "reject_owner_guild") return null;
  const intake = describeIntake(message);
  if (!intake.text && !hasIngestibleTextAttachment(intake)) return null;
  if (!Number.isSafeInteger(message.createdTimestamp) || message.createdTimestamp < 0) {
    throw new Error("owner_transport_history_timestamp_invalid");
  }
  const ownerRoomContext: OwnerRoomContext | undefined = route.kind === "owner_trusted_room"
    ? route.context
    : undefined;
  return {
    discordMessageId: intake.messageId,
    channelId: surface.channelId,
    ...(surface.guildId ? { guildId: surface.guildId } : {}),
    message: intake.text,
    attachments: intake.attachments,
    sentAtMs: message.createdTimestamp,
    capturedAtMs: Date.now(),
    ...(ownerRoomContext ? { ownerRoomContext } : {}),
  };
}

export async function reconcileOwnerTransportSurface(
  client: Client,
  surface: OwnerTransportSurface,
  api: OwnerTransportRecoveryApi,
  reason: string,
): Promise<void> {
  if (!activeTrustedRoomSurface(surface)) {
    console.log(`[discord-bot] Owner transport surface inactive; skipped surface=${surface.guildId ? `${surface.guildId}:${surface.channelId}` : `dm:${surface.channelId}`} reason=${reason}`);
    return;
  }
  const state = await api.state(surface);
  if (!state.initialized || !state.afterMessageId) {
    console.warn(`[discord-bot] Owner transport history boundary unavailable; surface=${state.surfaceKey} reason=${state.reason ?? "unknown"}`);
    return;
  }

  let afterMessageId = state.afterMessageId;
  let pageCount = 0;
  let examined = 0;
  let captured = 0;
  for (; pageCount < OWNER_TRANSPORT_MAX_PAGES; pageCount += 1) {
    const messages = await fetchHistoryPage(client, surface, afterMessageId);
    if (messages.length === 0) break;
    examined += messages.length;
    const nextAfterMessageId = messages.at(-1)?.id;
    if (!nextAfterMessageId || compareIds(nextAfterMessageId, afterMessageId) <= 0) {
      throw new Error("owner_transport_history_cursor_not_advanced");
    }
    const captures = messages
      .map((message) => snapshotForHistory(client, message, surface))
      .filter((capture): capture is OwnerTransportCapture => capture !== null);
    const result = await api.historyPage({
      surface,
      afterMessageId,
      nextAfterMessageId,
      messages: captures,
    });
    captured += result.newlyCaptured;
    afterMessageId = result.afterMessageId;
    if (messages.length < OWNER_TRANSPORT_PAGE_LIMIT) break;
  }
  const incomplete = pageCount >= OWNER_TRANSPORT_MAX_PAGES;
  console.log(
    `[discord-bot] Owner transport history reconciled surface=${surface.guildId ? `${surface.guildId}:${surface.channelId}` : `dm:${surface.channelId}`} reason=${reason} pages=${pageCount} examined=${examined} captured=${captured} incomplete=${incomplete}`,
  );
}

export async function replayPendingOwnerTransport(
  api: OwnerTransportRecoveryApi,
): Promise<void> {
  for (let batch = 0; batch < OWNER_TRANSPORT_MAX_PAGES; batch += 1) {
    const pending = (await api.pending(OWNER_TRANSPORT_PENDING_LIMIT)).captures;
    if (pending.length === 0) return;
    const groups = groupOwnerTransportCaptures(pending);
    for (const group of groups) {
      const first = group[0]!;
      const ownerRoomContext = first.ownerRoomContext ?? undefined;
      if (group.some((capture) =>
        capture.ownerRoomContext?.guildId !== ownerRoomContext?.guildId ||
        capture.ownerRoomContext?.channelId !== ownerRoomContext?.channelId)) {
        throw new Error("owner_transport_replay_room_conflict");
      }
      await api.ingress(
        group.map((capture) => capture.text).join("\n"),
        {
          attachments: capTurnAttachments(group.flatMap((capture) => capture.attachments)),
          inboundDiscordMessageIds: group.map((capture) => capture.discordMessageId),
          finalFragmentReceivedAtMs: Date.now(),
          sourceSentAtMs: group.at(-1)!.sentAtMs,
          ...(ownerRoomContext ? { ownerRoomContext } : {}),
        },
      );
      await api.admitted(group.map((capture) => capture.discordMessageId));
    }
  }
  throw new Error("owner_transport_pending_replay_bound_reached");
}

export type OwnerTransportReconciler = {
  reconcile: (reason: string) => Promise<void>;
};

export function createOwnerTransportReconciler(
  client: Client,
  overrides: Partial<OwnerTransportRecoveryApi> = {},
): OwnerTransportReconciler {
  const api = { ...defaultApi(), ...overrides };
  let inFlight: Promise<void> | null = null;
  return {
    reconcile(reason: string): Promise<void> {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const surfaces = await resolveSurfaces(client);
        for (const surface of surfaces) {
          try {
            await reconcileOwnerTransportSurface(client, surface, api, reason);
          } catch (error) {
            console.error(
              `[discord-bot] Owner transport history reconciliation failed; retry remains available surface=${surface.guildId ? `${surface.guildId}:${surface.channelId}` : `dm:${surface.channelId}`}`,
              error,
            );
          }
        }
        try {
          await replayPendingOwnerTransport(api);
        } catch (error) {
          console.error("[discord-bot] Owner transport replay failed; pending capture remains durable", error);
        }
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
