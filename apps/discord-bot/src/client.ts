import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import {
  classifySocialSender,
  isAllowedMessage,
  isOwner,
  ownerIngressRouteForMessage,
} from "./security/gate.js";
import { handleSlash } from "./handlers/interactionCreate.js";
import { handleMessage } from "./handlers/messageCreate.js";
import { handleReaction } from "./handlers/reactionAdd.js";
import { startCognitiveIdleScheduler } from "./initiative/scheduler.js";
import { startFulfillmentPump } from "./initiative/fulfillment-pump.js";
import { reconcilePresence, startPresence } from "./presence.js";
import { querySocialEligibility } from "./agent-client.js";

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      // Without this, a laugh reaction on her message in a DM never arrives at
      // all, which is most of where Doc actually talks to her.
      GatewayIntentBits.DirectMessageReactions,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord-bot] logged in as ${c.user.tag}`);
    startCognitiveIdleScheduler();
    startFulfillmentPump(client);
    startPresence(client);
  });

  client.on(Events.ShardResume, () => {
    void reconcilePresence(client, "resume");
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) {
      void handleSlash(interaction);
    }
  });

  client.on(Events.MessageCreate, (message: Message) => {
    // Self-loop exclusion is structurally first: Ashley's own messages never
    // enter either the Owner path or the external capture path.
    if (client.user && message.author?.id === client.user.id) return;
    void (async () => {
      try {
        const full = message.partial ? await message.fetch() : message;
        const authorId = full.author?.id;
        const channelId = full.channel?.id;
        if (!authorId || !channelId) {
          console.warn("[discord-bot] dropped malformed message transport");
          return;
        }
        if (isOwner(authorId)) {
          if (!isAllowedMessage(full)) return;
          const ownerRoute = ownerIngressRouteForMessage(full);
          if (ownerRoute.kind === "reject_owner_guild") {
            console.warn("[discord-bot] Owner guild message is not an active trusted room; ignored");
            return;
          }
          console.log(
            `[discord-bot] message from ${authorId} in ${full.channel.isDMBased() ? "DM" : "guild"}`,
          );
          await handleMessage(
            full,
            ownerRoute.kind === "owner_trusted_room"
              ? { ownerRoomContext: ownerRoute.context }
              : undefined,
          );
          return;
        }
        let eligibility: { authorized: boolean; audienceHint?: "dm" | "room" | "unknown" } | undefined;
        let eligibilityFailed = false;
        if (config.socialCaptureEnabled) {
          try {
            const result = await querySocialEligibility({
              authorId,
              channelId,
              guildId: full.guild?.id,
              bot: full.author.bot,
            });
            eligibility = {
              authorized: result.verdict === "allow_social",
              audienceHint: result.audienceHint,
            };
          } catch {
            eligibilityFailed = true;
          }
        }
        const verdict = classifySocialSender({
          selfLoop: false,
          transportValid: true,
          socialCaptureEnabled: config.socialCaptureEnabled,
          eligibility,
          eligibilityFailed,
          externalBot: full.author.bot,
          botDmConfigured: !full.author.bot || config.botDmPrincipal === authorId,
        });
        if (verdict === "drop") return;
        console.log(
          `[discord-bot] external message from ${authorId} in ${full.channel.isDMBased() ? "DM" : "guild"} gate=${verdict}`,
        );
        await handleMessage(full, { gateVerdict: verdict });
      } catch (err) {
        console.error("[discord-bot] messageCreate error:", err);
      }
    })();
  });

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    if (!user || user.bot) return;
    if (!isOwner(user.id)) return;
    void handleReaction(reaction, user.id);
  });

  return client;
}

export async function startBot(): Promise<Client> {
  const client = createClient();
  await client.login(config.token);
  return client;
}
