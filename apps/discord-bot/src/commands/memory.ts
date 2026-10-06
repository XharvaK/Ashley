import type { ChatInputCommandInteraction } from "discord.js";
import { memorySummary, type MemoryGrowth } from "../agent-client.js";
import { formatFactLabel } from "../memory-labels.js";

export function renderMemorySummary(data: {
  narrative?: string | null;
  facts: Array<{ category: string; value: string }>;
  episodes?: Array<{ summary: string; endedAt: string }>;
  activity?: Array<{ at: string; pass: string; activity: string | null; entry: string | null }>;
  interests?: Array<{ root: string; branch: string }>;
  growth?: MemoryGrowth;
}): string {
  const episodes = data.episodes ?? [];
  const activity = data.activity ?? [];
  const interests = data.interests ?? [];
  const grown = (data.growth?.opinions.length ?? 0) + (data.growth?.changes.length ?? 0)
    + (data.growth?.diary?.length ?? 0) + (data.growth?.becoming ? 1 : 0) + (data.growth?.dream ? 1 : 0) > 0;
  if (!data.narrative && data.facts.length === 0 && episodes.length === 0 && activity.length === 0 && !grown) {
    return "Stored memory summary: no pinned memories.";
  }
  const lines: string[] = ["Stored memory summary:", ""];
  if (data.growth?.becoming) {
    lines.push(`Who she is becoming (${data.growth.becoming.writtenAt.slice(0, 10)}):`, data.growth.becoming.text, "");
  }
  if (data.growth?.dream) {
    const dream = data.growth.dream;
    const extras = [
      dream.diary ? "wrote her diary" : "",
      dream.narrative ? "wrote who she is becoming" : "",
    ].filter(Boolean);
    const tail = extras.length ? ` · ${extras.join(" · ")}` : "";
    lines.push(`Last night (${dream.at.slice(0, 10)}): merged ${dream.merged.length} · closed ${dream.closed.length} · re-weighed ${dream.rescored}${tail}`);
    for (const item of dream.merged.slice(0, 3)) lines.push(`• ${item.statement}`);
    lines.push("");
  }
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
  if (data.growth) {
    const { mood, opinions, changes } = data.growth;
    const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
    lines.push(`Mood: valence ${signed(mood.valence)}, energy ${mood.energy.toFixed(2)}, openness ${mood.openness.toFixed(2)}, tension ${mood.tension.toFixed(2)}${mood.reason ? ` (${mood.reason})` : ""}`);
    if (opinions.length) {
      lines.push("Opinions she holds:");
      for (const item of opinions) lines.push(`• ${item.topic}: ${item.stance}`);
    }
    if (changes.length) {
      lines.push("How she has changed lately:");
      for (const item of changes) lines.push(`• ${item.appliedAt.slice(0, 10)} ${item.layer}: ${item.text}`);
    }
    for (const entry of data.growth.diary ?? []) lines.push(`Diary ${entry.day}: ${entry.text}`);
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
