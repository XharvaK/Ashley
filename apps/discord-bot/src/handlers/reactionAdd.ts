import type {
  MessageReaction,
  PartialMessageReaction,
} from "discord.js";
import { reportReaction } from "../agent-client.js";
import { noteGifReaction } from "../chat/gif-search.js";

/**
 * A reaction on her own message is a signal she should know about. Reactions on
 * Alex's own messages are their business and are not reported.
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
  _userId: string,
): Promise<void> {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  await reportOwnMessageReaction(reaction);
}
