import { startSoftPump } from "./soft/soft-pump.js";
import { startSnapshotPump } from "./soft/snapshot-pump.js";
import {
  Client,
  Partials,
  Events,
  type Message,
  type Presence,
} from "discord.js";
import { applyOwnerPresence, gatewayIntentList, liveOwnerPresenceDeps } from "./presence-filter.js";
import { config } from "./config.js";
import {
  classifySocialSender,
  isAllowedMessage,
  isOwner,
  ownerIngressRouteForMessage,
} from "./security/gate.js";
import { handlePracticeRevert } from "./commands/identity.js";
import { handleSlash } from "./handlers/interactionCreate.js";
import { handleMessage } from "./handlers/messageCreate.js";
import { handleReaction } from "./handlers/reactionAdd.js";
import { startSchedulerHandoff } from "./initiative/scheduler.js";
import { startFulfillmentPump } from "./initiative/fulfillment-pump.js";
import { startPlacePostPump } from "./places/post-pump.js";
import { startFaceWindow } from "./presence/face-window.js";
import { reconcilePresence, startPresence } from "./presence.js";
import { querySocialEligibility } from "./agent-client.js";
import { createOwnerTransportReconciler } from "./chat/owner-transport-recovery.js";

export function createClient(): Client {
  const client = new Client({
    intents: gatewayIntentList(config.presenceIntent),
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });
  const ownerTransportReconciler = createOwnerTransportReconciler(client);
  let ownerTransportReady = Promise.resolve();

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord-bot] logged in as ${c.user.tag}`);
    ownerTransportReady = ownerTransportReconciler.reconcile("ready").catch((error) => {
      console.error("[discord-bot] Owner transport startup reconciliation failed; live capture remains active", error);
    });
    startSchedulerHandoff(c.user.id);
    startFulfillmentPump(client);
    startPlacePostPump(client);
    startPresence(client);
    startFaceWindow(client);
    startSoftPump(client);
    startSnapshotPump(client);
  });

  client.on(Events.ShardResume, () => {
    void reconcilePresence(client, "resume");
    ownerTransportReady = ownerTransportReconciler.reconcile("resume").catch((error) => {
      console.error("[discord-bot] Owner transport resume reconciliation failed; retry remains available", error);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("practice-revert:")) {
      void handlePracticeRevert(interaction).catch(error => console.error("[discord-bot] practice revert failed", error));
    } else if (interaction.isChatInputCommand()) {
      void handleSlash(interaction).catch((error) => console.error("[discord-bot] slash handling failed", error));
    }
  });

  // MessageCreate is admission-time snapshot semantics: later Discord edits or
  // deletes do not revoke admitted work; deletion is not forget; Ashley must
  // not claim awareness of an edit she never received. Do not subscribe to
  // MessageUpdate or MessageDelete.
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
          await ownerTransportReady;
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

  client.on(Events.PresenceUpdate, (_previous: Presence | null, update: Presence) => {
    const userId = update.userId ?? update.user?.id ?? "";
    void applyOwnerPresence(
      { userId, status: update.status ?? null },
      liveOwnerPresenceDeps(config.ownerId, config.ownerPresenceFacts),
    ).catch((error) => {
      console.error("[discord-bot] owner presence call failed", error);
    });
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
