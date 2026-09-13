import type { ChatInputCommandInteraction } from "discord.js";
import { agentErrorMessage } from "../chat/agent-errors.js";
import { isOwner } from "../security/gate.js";
import * as remember from "../commands/remember.js";
import * as memory from "../commands/memory.js";
import * as newCmd from "../commands/new.js";
import * as forget from "../commands/forget.js";
import * as proactive from "../commands/proactive.js";
import * as identity from "../commands/identity.js";
import * as commitments from "../commands/commitments.js";
import * as continuity from "../commands/continuity.js";
import * as status from "../commands/status.js";

export async function handleSlash(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    if (interaction.deferred || interaction.replied) return;
    await interaction.reply({
      content: "Not authorized.",
      ephemeral: true,
    });
    return;
  }

  const ephemeral =
    interaction.commandName === "memory" ||
    interaction.commandName === "forget" ||
    interaction.commandName === "identity" ||
    interaction.commandName === "commitments" ||
    interaction.commandName === "continuity" ||
    interaction.commandName === "status" ||
    (interaction.commandName === "proactive" &&
      interaction.options.getString("action") === "status");
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral });
  }

  try {
    switch (interaction.commandName) {
      case "remember":
        await remember.execute(interaction);
        break;
      case "memory":
        await memory.execute(interaction);
        break;
      case "new":
        await newCmd.execute(interaction);
        break;
      case "forget":
        await forget.execute(interaction);
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
      case "status":
        await status.execute(interaction);
        break;
    }
  } catch (err) {
    console.error("[discord-bot] slash error:", err);
    const code = (err as Error & { code?: string }).code;
    const retryAfterSec = (err as Error & { retryAfterSec?: number })
      .retryAfterSec;
    const msg = agentErrorMessage(code, retryAfterSec);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
}
