import type { Message } from "discord.js";
import {
  ingressChat,
  pauseProactiveRemote,
  resumeProactiveRemote,
} from "../agent-client.js";
import { channelQueue } from "../chat/channel-queue.js";
import { MAX_IMAGES, describeIntake, type Intake } from "../chat/attachments.js";
import { config } from "../config.js";
import { agentErrorMessage } from "../chat/agent-errors.js";
import { readKillSwitch } from "../chat/kill-switch.js";
import { tempoTracker } from "../chat/pacing.js";
import { getDiscordPresence } from "../presence.js";
import { TurnBuffer } from "../chat/turn-buffer.js";

export type MessageIngressChat = (
  message: string,
  options?: {
    threadId?: string;
    attachments?: Intake["attachments"];
    discordPresence?: ReturnType<typeof getDiscordPresence>;
    inboundDiscordMessageIds?: string[];
    finalFragmentReceivedAtMs?: number;
  },
) => Promise<unknown>;

export type BufferedMessageTurn = {
  text: string;
  attachments: Intake["attachments"];
  inboundDiscordMessageIds: string[];
  finalFragmentReceivedAtMs: number;
};

export type MessageCreateHandler = {
  handleMessage: (message: Message) => Promise<void>;
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
  channelQueue?: { abort(channelId: string): void };
  onFirstFragment?: (channelId: string) => void;
  quietMs?: number;
  hardCapMs?: number;
}): MessageCreateHandler {
  let lastReadyPromise = Promise.resolve();
  let drain: (channelId: string) => Promise<void>;
  const localTurns = new TurnBuffer<Intake, Message>(
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
    const turn = {
      text: buffered.fragments.map((fragment) => fragment.text).join("\n"),
      attachments: buffered.fragments.flatMap((fragment) => fragment.attachments).slice(0, MAX_IMAGES),
      inboundDiscordMessageIds: buffered.fragments.map((fragment) => fragment.messageId),
      finalFragmentReceivedAtMs: buffered.finalFragmentReceivedAt,
    };
    try {
      await options.ingressChat(turn.text, {
        attachments: turn.attachments,
        discordPresence: getDiscordPresence(),
        inboundDiscordMessageIds: turn.inboundDiscordMessageIds,
        finalFragmentReceivedAtMs: turn.finalFragmentReceivedAtMs,
      });
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      const retryAfterSec = (error as Error & { retryAfterSec?: number }).retryAfterSec;
      console.error("[discord-bot] cognitive ingress failed closed:", error);
      if (typeof buffered.target.reply === "function") {
        await buffered.target.reply(agentErrorMessage(code, retryAfterSec)).catch(() => {});
      }
    }
  };

  return {
    async handleMessage(message: Message): Promise<void> {
      if (message.content.trim().startsWith("/")) return;
      const intake = describeIntake(message);
      if (!intake.text) return;
      const channelId = message.channel.id;
      const first = localTurns.push(channelId, intake, message);
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

export async function handleMessage(message: Message): Promise<void> {
  if (await handleKillSwitch(message)) return;
  await messageCreateHandler.handleMessage(message);
}
