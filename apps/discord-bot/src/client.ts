import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { isAllowedMessage, isOwner } from "./security/gate.js";
import { handleSlash } from "./handlers/interactionCreate.js";
import { handleMessage } from "./handlers/messageCreate.js";
import { handleReaction } from "./handlers/reactionAdd.js";
import { startCognitiveIdleScheduler } from "./initiative/scheduler.js";
import { startFulfillmentPump } from "./initiative/fulfillment-pump.js";
import { startPresence } from "./presence.js";

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

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) {
      void handleSlash(interaction);
    }
  });

  client.on(Events.MessageCreate, (message: Message) => {
    if (message.author.bot) return;
    void (async () => {
      try {
        const full = message.partial ? await message.fetch() : message;
        if (!isAllowedMessage(full)) return;
        console.log(
          `[discord-bot] message from ${full.author.id} in ${full.channel.isDMBased() ? "DM" : "guild"}`,
        );
        await handleMessage(full);
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
