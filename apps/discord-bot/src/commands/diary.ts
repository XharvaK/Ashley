import type { ChatInputCommandInteraction } from "discord.js";
import { domusDiary } from "../agent-client.js";

export type SimsDiaryEntry = { world: string; at: string; text: string };

/** Discord refuses a message over 2,000 characters, so a long diary is cut with a visible mark. */
const DISCORD_LIMIT = 2_000;
const CUT_MARK = "\n… (cut to fit)";

export function renderSimsDiary(entries: SimsDiaryEntry[]): string {
  if (entries.length === 0) return "No Sims diary entries yet.";
  const lines = ["Her Sims diary:", ""];
  for (const entry of entries) {
    lines.push(`${entry.at.slice(0, 10)} (${entry.world}):`, entry.text, "");
  }
  const text = lines.join("\n").trimEnd();
  if (text.length <= DISCORD_LIMIT) return text;
  return text.slice(0, DISCORD_LIMIT - CUT_MARK.length).trimEnd() + CUT_MARK;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const data = await domusDiary(3);
  await interaction.editReply(renderSimsDiary(data.entries));
}
