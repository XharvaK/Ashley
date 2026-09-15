import type { Message } from "discord.js";
import {
  captureExternalChat,
  ingressChat,
  ingressExternalBatch,
  pauseProactiveRemote,
  resumeProactiveRemote,
  type ExternalBatchResult,
  type ExternalCaptureResult,
} from "../agent-client.js";
import { channelQueue } from "../chat/channel-queue.js";
import {
  MAX_IMAGES,
  describeIntake,
  hasIngestibleTextAttachment,
  type ExternalEnvelopeTransport,
  type Intake,
} from "../chat/attachments.js";
import { config } from "../config.js";
import { agentErrorMessage } from "../chat/agent-errors.js";
import { readKillSwitch } from "../chat/kill-switch.js";
import { tempoTracker } from "../chat/pacing.js";
import { TurnBuffer } from "../chat/turn-buffer.js";
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
    hasIngestibleTextAttachment?: boolean;
    ownerRoomContext?: OwnerRoomContext;
  },
) => Promise<unknown>;

export type BufferedMessageTurn = {
  text: string;
  attachments: Intake["attachments"];
  inboundDiscordMessageIds: string[];
  finalFragmentReceivedAtMs: number;
  hasIngestibleTextAttachment: boolean;
  gateVerdict?: GateVerdict;
  ownerRoomContext?: OwnerRoomContext;
};

type BufferedFragment = Intake & {
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
    options?: { gateHint?: GateVerdict; conversationKey?: string },
  ) => Promise<ExternalCaptureResult>;
  ingressExternalBatch?: (
    captureRefs: string[],
    conversationKey: string,
    finalFragmentReceivedAtMs?: number,
  ) => Promise<ExternalBatchResult>;
  botId?: string;
  channelQueue?: { abort(channelId: string): void };
  onFirstFragment?: (channelId: string) => void;
  quietMs?: number;
  hardCapMs?: number;
}): MessageCreateHandler {
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
      attachments: buffered.fragments.flatMap((fragment) => fragment.attachments).slice(0, MAX_IMAGES),
      inboundDiscordMessageIds: buffered.fragments.map((fragment) => fragment.messageId),
      finalFragmentReceivedAtMs: buffered.finalFragmentReceivedAt,
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
    }
  };

  return {
    async handleMessage(message: Message, context?: MessageSocialContext): Promise<void> {
      if (message.content.trim().startsWith("/")) return;
      if (context?.gateVerdict === "drop") return;
      const intake = describeIntake(message);
      if (!context?.gateVerdict && !intake.text && !hasIngestibleTextAttachment(intake)) return;
      if (context?.gateVerdict) {
        try {
          const envelope = intake.envelope;
          if (!envelope) throw new Error("external_envelope_unattributable");
          const conversationKey = externalConversationKey(
            envelope,
            options.botId ?? messageClientUserId(message),
          );
          const captured = await (options.captureExternalChat ?? captureExternalChat)(
            envelope,
            intake.text,
            { gateHint: context.gateVerdict, conversationKey },
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
      const fragment: BufferedFragment = context?.ownerRoomContext
        ? { ...intake, ownerRoomContext: context.ownerRoomContext }
        : intake;
      const first = localTurns.push(channelId, fragment, message);
      if (first) {
        options.onFirstFragment?.(channelId);
        options.channelQueue?.abort(channelId);
      }
    },
    async flushForTest(channelId: string): Promise<void> {
      const previous = lastReadyPromise;
      localTurns.flushForTest(channelId);
      if (lastReadyPromise === previous) return;
      await lastReadyPromise;
    },
  };
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
  channelQueue,
  onFirstFragment: (channelId) => tempoTracker.mark(channelId),
});

async function handleKillSwitch(message: Message): Promise<boolean> {
  const switched = readKillSwitch(message.content);
  if (!switched) return false;

  const channelId = message.channel.id;
  channelQueue.abort(channelId);
  try {
    if (switched === "pause") {
      await pauseProactiveRemote();
      await message.reply("alright, going quiet. say devam when you want me back");
    } else {
      await resumeProactiveRemote();
      await message.reply("back on then");
    }
  } catch (err) {
    console.warn("[discord-bot] kill switch failed:", err);
    return false;
  }
  return true;
}

export async function handleMessage(message: Message, context?: MessageSocialContext): Promise<void> {
  if (await handleKillSwitch(message)) return;
  await messageCreateHandler.handleMessage(message, context);
}
