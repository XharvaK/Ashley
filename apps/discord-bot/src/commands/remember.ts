import type { ChatInputCommandInteraction } from "discord.js";
import { pinMemory } from "../agent-client.js";

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const text = interaction.options.getString("text", true);
  const isPrivate = interaction.options.getBoolean("private") ?? false;
  const result = await pinMemory(text, isPrivate ? "private" : "none", interaction.id);
  const queuedWithoutFact = result.queued === true && !result.fact;
  await interaction.editReply(
    queuedWithoutFact
      ? isPrivate
        ? `Queued privately — I'll only surface it when you bring it up.`
        : `Got it — I'll keep that in mind.`
      : isPrivate
      ? `Stored privately — I'll only surface it when you bring it up.`
      : `Got it — I'll keep in mind: ${result.fact?.value ?? text}`,
  );
}
