import * as attention from "../commands/attention.js";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { agentErrorMessage } from "../chat/agent-errors.js";
import { isOwner } from "../security/gate.js";
import * as remember from "../commands/remember.js";
import * as memory from "../commands/memory.js";
import * as diary from "../commands/diary.js";
import * as proactive from "../commands/proactive.js";
import * as identity from "../commands/identity.js";
import * as commitments from "../commands/commitments.js";
import * as continuity from "../commands/continuity.js";
import * as status from "../commands/status.js";
import * as delegation from "../commands/delegation.js";
import * as contacts from "../commands/contacts.js";
import * as places from "../commands/places.js";
import * as quiet from "../commands/quiet.js";

/** Every reply shows only to the Owner, except a proactive pause or resume, which the room may see. */
const PRIVATE_COMMANDS = new Set([
  "memory",
  "remember",
  "diary",
  "identity",
  "commitments",
  "continuity",
  "status",
  "attention",
  "delegation",
  "contacts",
  "places",
  "quiet",
]);

export function isEphemeralCommand(name: string, action?: string | null): boolean {
  if (PRIVATE_COMMANDS.has(name)) return true;
  return name === "proactive" && action === "status";
}

export async function handleSlash(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    if (interaction.deferred || interaction.replied) return;
    await interaction.reply({
      content: "Not authorized.",
      flags: MessageFlags.Ephemeral,
    }).catch((replyErr) => console.error("[discord-bot] refused slash reply failed", replyErr));
    return;
  }

  try {
    const ephemeral = isEphemeralCommand(
      interaction.commandName,
      interaction.options.getString("action"),
    );
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }

    switch (interaction.commandName) {
      case "remember":
        await remember.execute(interaction);
        break;
      case "memory":
        await memory.execute(interaction);
        break;
      case "diary":
        await diary.execute(interaction);
        break;
      case "proactive":
        await proactive.execute(interaction);
        break;
      case "identity":
        await identity.execute(interaction);
        break;
      case "commitments":
        await commitments.execute(interaction);
        break;
      case "continuity":
        await continuity.execute(interaction);
        break;
      case "attention":
        await attention.execute(interaction);
        break;
      case "status":
        await status.execute(interaction);
        break;
      case "delegation":
        await delegation.execute(interaction);
        break;
      case "contacts":
        await contacts.execute(interaction);
        break;
      case "places":
        await places.execute(interaction);
        break;
      case "quiet":
        await quiet.execute(interaction);
        break;
    }
  } catch (err) {
    console.error("[discord-bot] slash error:", err);
    const code = (err as Error & { code?: string }).code;
    const retryAfterSec = (err as Error & { retryAfterSec?: number })
      .retryAfterSec;
    const msg = agentErrorMessage(code, retryAfterSec);
    // The interaction may have expired (Unknown interaction); the reply failing must not escape as a rejection.
    await (interaction.deferred || interaction.replied
      ? interaction.editReply(msg)
      : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral })
    ).catch((replyErr) => console.error("[discord-bot] slash error reply failed", replyErr));
  }
}
