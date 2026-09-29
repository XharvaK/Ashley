import type { ChatInputCommandInteraction } from "discord.js";
import { memorySummary } from "../agent-client.js";
import { formatFactLabel } from "../memory-labels.js";

export function renderMemorySummary(data: {
  narrative?: string | null;
  facts: Array<{ category: string; value: string }>;
  episodes?: Array<{ summary: string; endedAt: string }>;
}): string {
  const episodes = data.episodes ?? [];
  if (!data.narrative && data.facts.length === 0 && episodes.length === 0) {
    return "Stored memory summary: no pinned memories.";
  }
  const lines: string[] = ["Stored memory summary:", ""];
  if (data.narrative) {
    lines.push("Where we left off:", data.narrative, "");
  }
  if (episodes.length) {
    lines.push("Recent moments:");
    for (const episode of episodes) lines.push(`• ${episode.endedAt.slice(0, 10)}: ${episode.summary}`);
    lines.push("");
  }
  if (data.facts.length) {
    lines.push("Standing notes:");
    for (const f of data.facts.slice(0, 20)) {
      lines.push(`• ${formatFactLabel(f.category, f.value)}`);
    }
  }
  return lines.join("\n").slice(0, 2000);
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const includePrivate = interaction.options.getBoolean("private") ?? false;
  const data = await memorySummary(includePrivate);
  await interaction.editReply(renderMemorySummary(data));
}
