import type { ChatInputCommandInteraction } from "discord.js";
import { domusDiary } from "../agent-client.js";

export type SimsDiaryEntry = { world: string; at: string; text: string };

export function renderSimsDiary(entries: SimsDiaryEntry[]): string {
  if (entries.length === 0) return "No Sims diary entries yet.";
  const lines = ["Her Sims diary:", ""];
  for (const entry of entries) {
    lines.push(`${entry.at.slice(0, 10)} (${entry.world}):`, entry.text, "");
  }
  return lines.join("\n").trimEnd();
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const data = await domusDiary(3);
  await interaction.editReply(renderSimsDiary(data.entries));
}
