import type { ChatInputCommandInteraction } from "discord.js";
import { getContinuitySnapshot } from "../agent-client.js";

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const snapshot = await getContinuitySnapshot();
  const lines = [
    `Continuity available: ${snapshot.available}`,
    `Lineage: ${snapshot.lineageId ?? "none"}`,
    "",
    ...snapshot.recentEvents.slice(0, 10).map(
      (event) => `- ${event.occurredAt} ${event.kind}`,
    ),
  ];
  await interaction.editReply(lines.join("\n").slice(0, 1900));
}
