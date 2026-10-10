import type { Message } from "discord.js";
import {
  captureExternalChat,
  captureOwnerTransport as captureOwnerDiscordMessage,
  ingressChat,
  ingressExternalBatch,
  markOwnerTransportAdmitted,
  pauseProactiveRemote,
  resumeProactiveRemote,
  type ExternalBatchResult,
  type ExternalCaptureResult,
} from "../agent-client.js";
import { channelQueue } from "../chat/channel-queue.js";
import {
  capTurnAttachments,
  describeIntake,
  messageNames,
  hasIngestibleTextAttachment,
  type ExternalEnvelopeTransport,
  type Intake,
} from "../chat/attachments.js";
import { config } from "../config.js";
import { agentErrorMessage } from "../chat/agent-errors.js";
import { readMedia, type MediaReading } from "../chat/media-reading.js";
import { createKillSwitchHandler } from "../chat/kill-switch.js";
import { isOwner } from "../security/gate.js";
import { tempoTracker } from "../chat/pacing.js";
import { TurnBuffer } from "../chat/turn-buffer.js";
import { GUEST_MESSAGES_PER_WINDOW, GUEST_WINDOW_MS, createSlidingWindowLimiter } from "../chat/guest-throttle.js";
import { BOT_EXCHANGE_LIMIT, createBotExchangeGuard } from "../chat/bot-loop-guard.js";
import type { GateVerdict, OwnerRoomContext } from "../security/gate.js";

export type MessageSocialContext = {
  gateVerdict?: GateVerdict;
  ownerRoomContext?: OwnerRoomContext;
};

export type MessageIngressChat = (
  message: string,
  options?: {
    threadId?: string;
    attachments?: Intake["attachments"];
    inboundDiscordMessageIds?: string[];
    finalFragmentReceivedAtMs?: number;
    sourceSentAtMs?: number;
    hasIngestibleTextAttachment?: boolean;
    ownerRoomContext?: OwnerRoomContext;
  },
) => Promise<unknown>;

export type OwnerTransportMessageCapture = {
  discordMessageId: string;
  channelId: string;
  guildId?: string;
  message: string;
  attachments: Intake["attachments"];
  sentAtMs: number;
  capturedAtMs: number;
  ownerRoomContext?: OwnerRoomContext;
};

export type BufferedMessageTurn = {
  text: string;
  attachments: Intake["attachments"];
  inboundDiscordMessageIds: string[];
  finalFragmentReceivedAtMs: number;
  sourceSentAtMs: number;
  hasIngestibleTextAttachment: boolean;
  gateVerdict?: GateVerdict;
  ownerRoomContext?: OwnerRoomContext;
};

type BufferedFragment = Intake & {
  sentAtMs?: number;
  gateVerdict?: GateVerdict;
  ownerRoomContext?: OwnerRoomContext;
  captureRef?: string;
  conversationKey?: string;
};

type BufferedTarget = Message | { kind: "external"; conversationKey: string };

export type MessageCreateHandler = {
  handleMessage: (message: Message, context?: MessageSocialContext) => Promise<void>;
  flushForTest: (channelId: string) => Promise<void>;
};

/**
 * Ingress-only handler seam. TurnBuffer still coalesces fragments and the
 * ChannelQueue may abort delivery pacing, but the durable agent admission is
 * deliberately outside ChannelQueue so a new owner message is not serialized
 * behind an older Thought request.
 */
export function createMessageCreateHandler(options: {
  ingressChat: MessageIngressChat;
  captureExternalChat?: (
    envelope: ExternalEnvelopeTransport,
    message: string,
    options?: { gateHint?: GateVerdict; conversationKey?: string; names?: { speaker?: string; guild?: string; channel?: string } },
  ) => Promise<ExternalCaptureResult>;
  ingressExternalBatch?: (
    captureRefs: string[],
    conversationKey: string,
    finalFragmentReceivedAtMs?: number,
  ) => Promise<ExternalBatchResult>;
  captureOwnerTransport?: (capture: OwnerTransportMessageCapture) => Promise<unknown>;
  markOwnerTransportAdmitted?: (discordMessageIds: string[]) => Promise<unknown>;
  botId?: string;
  channelQueue?: { abort(channelId: string): void };
  onFirstFragment?: (channelId: string) => void;
  quietMs?: number;
  hardCapMs?: number;
  /** UX Wave 2 Perception: GIF links and stickers read before the message is buffered. */
  readMedia?: (message: Message) => Promise<MediaReading>;
  /** Per-guest budget for messages captured from people outside the Owner's circle. */
  guestLimiter?: { admit(key: string, nowMs: number): boolean };
}): MessageCreateHandler {
  const guestLimiter = options.guestLimiter ?? createSlidingWindowLimiter({
    windowMs: GUEST_WINDOW_MS,
    max: GUEST_MESSAGES_PER_WINDOW,
  });
  // A GIF lookup takes a moment; messages in one channel still reach the buffer in the order sent.
  const ordered = new Map<string, Promise<unknown>>();
  let lastReadyPromise = Promise.resolve();
  let drain: (channelId: string) => Promise<void>;
  let externalCaptureFailures = 0;
  let externalBatchFailures = 0;
  const localTurns = new TurnBuffer<BufferedFragment, BufferedTarget>(
    (channelId) => {
      lastReadyPromise = drain(channelId);
      void lastReadyPromise.catch(() => {});
    },
    options.quietMs,
    options.hardCapMs,
  );
  drain = async (channelId: string) => {
    const buffered = localTurns.take(channelId);
    if (!buffered) return;
    const firstFragment = buffered.fragments[0];
    if (firstFragment?.gateVerdict) {
      const captureRefs = buffered.fragments.map((fragment) => fragment.captureRef);
      if (captureRefs.some((captureRef) => !captureRef)) {
        console.warn("[discord-bot] external buffer contained an incomplete capture reference");
        return;
      }
      try {
        await (options.ingressExternalBatch ?? ingressExternalBatch)(
          captureRefs as string[],
          channelId,
          buffered.finalFragmentReceivedAt,
        );
      } catch (error) {
        externalBatchFailures += 1;
        console.error(
          `[discord-bot] external batch admission failed; retry remains durable count=${externalBatchFailures}`,
          error,
        );
      }
      return;
    }
    const turn = {
      text: buffered.fragments.map((fragment) => fragment.text).join("\n"),
      attachments: capTurnAttachments(buffered.fragments.flatMap((fragment) => fragment.attachments)),
      inboundDiscordMessageIds: buffered.fragments.map((fragment) => fragment.messageId),
      finalFragmentReceivedAtMs: buffered.finalFragmentReceivedAt,
      sourceSentAtMs: buffered.fragments.at(-1)?.sentAtMs ?? buffered.finalFragmentReceivedAt,
      hasIngestibleTextAttachment: buffered.fragments.some((fragment) => hasIngestibleTextAttachment(fragment)),
    };
    const ownerRoomContexts = buffered.fragments
      .map((fragment) => fragment.ownerRoomContext)
      .filter((context): context is OwnerRoomContext => context !== undefined);
    const ownerRoomContext = ownerRoomContexts[0];
    if (ownerRoomContexts.some((context) =>
      context.guildId !== ownerRoomContext?.guildId || context.channelId !== ownerRoomContext?.channelId)) {
      console.warn("[discord-bot] Owner room buffer contained conflicting room context");
      return;
    }
    try {
      await options.ingressChat(turn.text, {
        attachments: turn.attachments,
        inboundDiscordMessageIds: turn.inboundDiscordMessageIds,
        finalFragmentReceivedAtMs: turn.finalFragmentReceivedAtMs,
        sourceSentAtMs: turn.sourceSentAtMs,
        hasIngestibleTextAttachment: turn.hasIngestibleTextAttachment,
        ...(ownerRoomContext ? { ownerRoomContext } : {}),
      });
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      const retryAfterSec = (error as Error & { retryAfterSec?: number }).retryAfterSec;
      console.error("[discord-bot] cognitive ingress failed closed:", error);
      if (
        "reply" in buffered.target &&
        typeof buffered.target.reply === "function"
      ) {
        await buffered.target.reply(agentErrorMessage(code, retryAfterSec)).catch(() => {});
      }
      return;
    }
    if (options.markOwnerTransportAdmitted) {
      try {
        await options.markOwnerTransportAdmitted(turn.inboundDiscordMessageIds);
      } catch (error) {
        console.error("[discord-bot] Owner transport admission mark failed; canonical admission already succeeded", error);
      }
    }
  };

  return {
    async handleMessage(message: Message, context?: MessageSocialContext): Promise<void> {
      // Slash commands arrive as interactions, so a "/" message is plain text and goes on to her.
      if (context?.gateVerdict === "drop") return;
      const key = typeof message.channel?.id === "string" ? message.channel.id : "";
      const reading = (options.readMedia ?? readMedia)(message).catch(() => undefined);
      const mine = (ordered.get(key) ?? Promise.resolve())
        .then(() => reading)
        .then((read) => handleRead(message, context, read));
      const settled = mine.catch(() => undefined);
      ordered.set(key, settled);
      void settled.then(() => {
        if (ordered.get(key) === settled) ordered.delete(key);
      });
      await mine;
    },
    async flushForTest(channelId: string): Promise<void> {
      const previous = lastReadyPromise;
      localTurns.flushForTest(channelId);
      if (lastReadyPromise === previous) return;
      await lastReadyPromise;
    },
  };

  async function handleRead(
    message: Message,
    context: MessageSocialContext | undefined,
    reading: MediaReading | undefined,
  ): Promise<void> {
    const intake = describeIntake(message, reading);
    if (!context?.gateVerdict && !intake.text && !hasIngestibleTextAttachment(intake)) return;
    if (context?.gateVerdict) {
      try {
        const envelope = intake.envelope;
        if (!envelope) throw new Error("external_envelope_unattributable");
        if (!guestLimiter.admit(envelope.speakerPrincipalId, Date.now())) {
          // Over the guest's budget: not captured, so a flood cannot turn into a flood of turns.
          return;
        }
        const conversationKey = externalConversationKey(
          envelope,
          options.botId ?? messageClientUserId(message),
        );
        const captured = await (options.captureExternalChat ?? captureExternalChat)(
          envelope,
          intake.text,
          { gateHint: context.gateVerdict, conversationKey, names: messageNames(message) },
        );
        if (!captured.captureRef || captured.conversationKey !== conversationKey) {
          throw new Error("external_capture_receipt_invalid");
        }
        const first = localTurns.push(conversationKey, {
          text: "",
          attachments: [],
          hasMedia: false,
          hasIngestibleTextAttachment: false,
          messageId: intake.messageId,
          gateVerdict: context.gateVerdict,
          captureRef: captured.captureRef,
          conversationKey,
        }, { kind: "external", conversationKey });
        if (first) options.channelQueue?.abort(conversationKey);
      } catch (error) {
        externalCaptureFailures += 1;
        console.error(
          `[discord-bot] external capture failed; reference not buffered count=${externalCaptureFailures}`,
          error,
        );
      }
      return;
    }
    const channelId = message.channel.id;
    const sentAtMs = Number.isSafeInteger(message.createdTimestamp) && message.createdTimestamp >= 0
      ? message.createdTimestamp
      : Date.now();
    const fragment: BufferedFragment = context?.ownerRoomContext
      ? { ...intake, ownerRoomContext: context.ownerRoomContext, sentAtMs }
      : { ...intake, sentAtMs };
    if (options.captureOwnerTransport) {
      try {
        await options.captureOwnerTransport({
          discordMessageId: intake.messageId,
          channelId,
          ...(message.guild?.id ? { guildId: message.guild.id } : {}),
          message: intake.text,
          attachments: intake.attachments,
          sentAtMs,
          capturedAtMs: Date.now(),
          ...(context?.ownerRoomContext ? { ownerRoomContext: context.ownerRoomContext } : {}),
        });
      } catch (error) {
        console.error("[discord-bot] Owner transport capture failed; history reconciliation remains authoritative:", error);
        return;
      }
    }
    const first = localTurns.push(channelId, fragment, message);
    if (first) {
      options.onFirstFragment?.(channelId);
      options.channelQueue?.abort(channelId);
    }
  }
}

function isBotAuthored(message: Message): boolean {
  return Boolean(message.author?.bot) || Boolean(message.webhookId);
}

function messageClientUserId(message: Message): string | undefined {
  const userId = (message as Message & {
    client?: { user?: { id?: string } | null };
  }).client?.user?.id;
  return typeof userId === "string" ? userId.trim() || undefined : undefined;
}

function externalConversationKey(
  envelope: ExternalEnvelopeTransport,
  botId: string | undefined,
): string {
  if (envelope.location.kind === "room") {
    return `room:${envelope.location.guildId}:${envelope.location.channelId}`;
  }
  const normalizedBotId = botId?.trim();
  if (!normalizedBotId) throw new Error("external_bot_identity_unavailable");
  return `dm:${normalizedBotId}:${envelope.location.principalId}`;
}

const messageCreateHandler = createMessageCreateHandler({
  ingressChat,
  captureOwnerTransport: (capture) => captureOwnerDiscordMessage(capture),
  markOwnerTransportAdmitted,
  channelQueue,
  onFirstFragment: (channelId) => tempoTracker.mark(channelId),
});

const handleKillSwitch = createKillSwitchHandler({
  isOwner,
  abort: (channelId) => channelQueue.abort(channelId),
  pause: pauseProactiveRemote,
  resume: resumeProactiveRemote,
});

const botExchangeGuard = createBotExchangeGuard({ limit: BOT_EXCHANGE_LIMIT });

export async function handleMessage(message: Message, context?: MessageSocialContext): Promise<void> {
  const channelId = typeof message.channel?.id === "string" ? message.channel.id : "";
  if (!botExchangeGuard.admit(channelId, isBotAuthored(message))) return;
  if (await handleKillSwitch(message)) return;
  await messageCreateHandler.handleMessage(message, context);
}
