import type { ChatInputCommandInteraction } from "discord.js";
import { memorySummary } from "../agent-client.js";
import { formatFactLabel } from "../memory-labels.js";

export function renderMemorySummary(data: {
  narrative?: string | null;
  facts: Array<{ category: string; value: string }>;
  episodes?: Array<{ summary: string; endedAt: string }>;
  activity?: Array<{ at: string; pass: string; activity: string | null; entry: string | null }>;
  interests?: Array<{ root: string; branch: string }>;
}): string {
  const episodes = data.episodes ?? [];
  const activity = data.activity ?? [];
  const interests = data.interests ?? [];
  if (!data.narrative && data.facts.length === 0 && episodes.length === 0 && activity.length === 0) {
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
  if (activity.length) {
    lines.push("Own time lately:");
    for (const item of activity) {
      const what = [item.pass, item.activity].filter(Boolean).join(" · ");
      lines.push(`• ${item.at.slice(0, 16).replace("T", " ")} ${what}${item.entry ? `: ${item.entry}` : ""}`);
    }
    lines.push("");
  }
  if (interests.length) {
    lines.push(`Growing interests: ${interests.map((item) => `${item.branch} (${item.root})`).join(", ")}`);
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
