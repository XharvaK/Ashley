import type { ChatInputCommandInteraction } from "discord.js";
import { postQuiet } from "../agent-client.js";

export const QUIET_DEFAULT_MS = 2 * 60 * 60 * 1000;
export const QUIET_MAX_MS = 12 * 60 * 60 * 1000;

export function parseQuietDuration(raw: string | null): { ok: true; durationMs: number } | { ok: false; error: string } {
  const text = raw?.trim() ?? "";
  if (!text) return { ok: true, durationMs: QUIET_DEFAULT_MS };
  const match = /^(\d+)\s*([mh])$/i.exec(text);
  if (!match) return { ok: false, error: "Use a duration like 30m or 2h." };
  const amount = Number(match[1]);
  const durationMs = match[2]!.toLowerCase() === "h" ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > QUIET_MAX_MS) {
    return { ok: false, error: "Quiet can last at most 12 hours." };
  }
  return { ok: true, durationMs };
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const parsed = parseQuietDuration(interaction.options.getString("duration"));
  if (!parsed.ok) {
    await interaction.editReply({ content: parsed.error });
    return;
  }
  const result = await postQuiet(parsed.durationMs);
  const until = new Date(result.window.untilMs).toISOString();
  await interaction.editReply({ content: `Quiet until ${until}.` });
}
