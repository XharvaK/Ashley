import type { ChatInputCommandInteraction } from "discord.js";
import { newThread } from "../agent-client.js";

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await newThread();
  await interaction.editReply(
    "Fresh thread — same long-term memory, new conversational arc.",
  );
}
