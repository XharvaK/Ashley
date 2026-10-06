// B1: her posts in her other places. Every few seconds the bot reports what became of the posts it
// took and takes the ones now due; the agent has already checked each place is hers and its fuse.
// The bot only sends exactly the text she wrote, to exactly that channel or person.
import type { Client } from "discord.js";
import { syncPlacePosts, type PlacePost, type PlacePostReport } from "../agent-client.js";

export const PLACE_POST_POLL_MS = 4_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let pending: PlacePostReport[] = [];

async function send(client: Client, post: PlacePost): Promise<PlacePostReport> {
  try {
    const text = post.text.slice(0, 2000);
    if (post.target.kind === "room") {
      const channel = await client.channels.fetch(post.target.channelId);
      if (!channel || !channel.isTextBased() || !("send" in channel) || ("guildId" in channel && channel.guildId !== post.target.guildId)) {
        return { intent_id: post.intent_id, outcome: "failed", reason: "channel_unavailable" };
      }
      const sent = await (channel as { send(text: string): Promise<{ id: string }> }).send(text);
      return { intent_id: post.intent_id, outcome: "posted", discord_message_id: sent.id };
    }
    const user = await client.users.fetch(post.target.principalId);
    const sent = await user.send(text);
    return { intent_id: post.intent_id, outcome: "posted", discord_message_id: sent.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/[0-9]{15,}/g, "<id>").slice(0, 120) : "send_failed";
    return { intent_id: post.intent_id, outcome: "failed", reason };
  }
}

export async function pumpPlacePostsOnce(client: Client, sync: typeof syncPlacePosts = syncPlacePosts): Promise<number> {
  const reports = pending;
  pending = [];
  let result: { posts: PlacePost[] };
  try {
    result = await sync(reports);
  } catch {
    pending = [...reports, ...pending];
    return 0;
  }
  const sent: PlacePostReport[] = [];
  for (const post of result.posts ?? []) sent.push(await send(client, post));
  if (sent.length) {
    try { await sync(sent); } catch { pending.push(...sent); }
  }
  return sent.length;
}

export function startPlacePostPump(client: Client): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void pumpPlacePostsOnce(client).finally(() => { running = false; });
  }, PLACE_POST_POLL_MS);
}
