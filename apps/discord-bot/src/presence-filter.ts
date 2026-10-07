import { GatewayIntentBits } from "discord.js";
import { postOwnerPresence, postQuietDnd } from "./agent-client.js";

export function presenceIntentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_PRESENCE_INTENT === "true";
}

export function ownerPresenceFactsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASHLEY_OWNER_PRESENCE_FACTS === "true";
}

export function gatewayIntentList(presenceIntent: boolean): number[] {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    // Without DirectMessageReactions, a reaction in a DM never arrives.
    GatewayIntentBits.DirectMessageReactions,
  ];
  if (presenceIntent) intents.push(GatewayIntentBits.GuildPresences);
  return intents;
}

export type OwnerPresenceInput = {
  userId: string;
  status: string | null;
};

export type OwnerPresenceDeps = {
  ownerId: string;
  factsEnabled: boolean;
  nowMs: () => number;
  postDnd: (on: boolean) => Promise<unknown>;
  postFact: (status: "online" | "idle", sinceMs: number) => Promise<unknown>;
  log?: (message: string) => void;
};

/**
 * Keep the Owner only. Every other presence update returns before any
 * storage or log. DND opens or closes the quiet window. Online and idle
 * become facts only when the Owner opted in. Activity names are never read.
 */
export async function applyOwnerPresence(input: OwnerPresenceInput, deps: OwnerPresenceDeps): Promise<void> {
  if (!input.userId || input.userId !== deps.ownerId) return;
  if (input.status === "dnd") {
    await deps.postDnd(true);
    return;
  }
  await deps.postDnd(false);
  if (deps.factsEnabled && (input.status === "online" || input.status === "idle")) {
    await deps.postFact(input.status, deps.nowMs());
  }
}

export function liveOwnerPresenceDeps(ownerId: string, factsEnabled: boolean): OwnerPresenceDeps {
  return {
    ownerId,
    factsEnabled,
    nowMs: () => Date.now(),
    postDnd: postQuietDnd,
    postFact: postOwnerPresence,
    log: (message) => console.error(message),
  };
}
