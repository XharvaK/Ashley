import type { ChatInputCommandInteraction } from "discord.js";
import { getRelationshipSummary } from "../agent-client.js";

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const offset = interaction.options.getInteger("offset") ?? 0;
  const summary = await getRelationshipSummary(offset);
  const lines = [
    `Doc reminders: ${summary.docReminders}`,
    `Self commitments: ${summary.selfCommitments}`,
    `Mutual active: ${summary.mutualActive} (proposed: ${summary.mutualProposed})`,
    `Open tensions: ${summary.tensions}`,
    `Active withdrawals: ${summary.withdrawals}`,
    "",
    ...summary.items.map((item) => `- [${item.kind}/${item.status}] ${item.text}`),
  ];
  await interaction.editReply(lines.join("\n").slice(0, 1900));
}
