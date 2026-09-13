import type { ChatInputCommandInteraction } from "discord.js";
import { getNuclearStatus } from "../agent-client.js";

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const status = await getNuclearStatus();
  const lines = [
    `Schema: v${status.health.schemaVersion} (${status.health.ok ? "ok" : "degraded"})`,
    `Cognition: ${status.health.cognitionMode}`,
    `Reflection: ${status.health.reflectionMode}`,
    `Proactive: ${status.initiative.enabled ? "on" : "off"}${status.initiative.paused ? " (paused)" : ""}`,
    `Sent today: ${status.initiative.sentToday}/${status.initiative.maxPerDay}`,
    `relationship_state: ${status.relationshipState?.state ?? "unknown"}`,
    `Continuity: ${status.continuity.available ? status.continuity.lineageId : "unavailable"}`,
  ];
  await interaction.editReply(lines.join("\n"));
}
