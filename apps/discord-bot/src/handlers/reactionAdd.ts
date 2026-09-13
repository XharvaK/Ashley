import type {
  MessageReaction,
  PartialMessageReaction,
} from "discord.js";
import {
  cancelForgetPreview,
  confirmForgetPreview,
  resolveForgetPreview,
  reportReaction,
} from "../agent-client.js";
import { noteGifReaction } from "../chat/gif-search.js";

/** In-memory cache only — durable resolve uses sidecar binding. */
const pendingForget = new Map<
  string,
  { messageId: string; previewId: string }
>();

export function registerForgetPending(
  userId: string,
  _topic: string,
  messageId: string,
  previewId: string | null,
): void {
  if (!previewId) return;
  pendingForget.set(userId, { messageId, previewId });
}

/**
 * A reaction on her own message is a signal she should know about. Reactions on
 * Doc's own messages are his business and are not reported.
 */
async function reportOwnMessageReaction(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<void> {
  const emoji = reaction.emoji.name;
  if (!emoji) return;
  try {
    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;
    if (!message.author?.bot) return;
    await reportReaction(message.id, emoji);
    noteGifReaction(message.channelId, emoji);
  } catch (err) {
    console.warn("[discord-bot] reaction report failed:", err);
  }
}

export async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  userId: string,
): Promise<void> {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  let pending = pendingForget.get(userId);
  // Restart-safe: always prefer durable sidecar resolve by Discord message id.
  const resolved = await resolveForgetPreview(reaction.message.id);
  if (resolved.previewId) {
    pending = {
      messageId: reaction.message.id,
      previewId: resolved.previewId,
    };
    pendingForget.set(userId, pending);
  } else if (pending && reaction.message.id !== pending.messageId) {
    pending = undefined;
  }

  if (!pending || reaction.message.id !== pending.messageId || !pending.previewId) {
    await reportOwnMessageReaction(reaction);
    return;
  }
  const emoji = reaction.emoji.name;
  if (emoji !== "✅" && emoji !== "❌") return;

  pendingForget.delete(userId);

  if (emoji === "❌") {
    try {
      await cancelForgetPreview(pending.previewId);
    } catch (err) {
      console.warn("[discord-bot] forget cancel failed:", err);
    }
    const ch = reaction.message.channel;
    if (ch.isTextBased() && ch.isSendable()) {
      await ch.send("Forget cancelled.");
    }
    return;
  }

  // Hard invariant: never confirm by topic — preview_id only.
  const result = await confirmForgetPreview(pending.previewId);
  const ch = reaction.message.channel;
  if (ch.isTextBased() && ch.isSendable()) {
    const receipt = result.receiptId?.slice(0, 8) ?? "unavailable";
    const honesty = result.honesty
      ? ` ${result.honesty.discord} ${result.honesty.mistral} ${result.honesty.oldBackups}`
      : "";
    await ch.send(
      `Forget complete. Receipt ${receipt}; ${result.deleted} record(s) reconciled.${honesty}`,
    );
  }
}
