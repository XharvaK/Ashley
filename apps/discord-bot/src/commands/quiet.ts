import type { ChatInputCommandInteraction } from "discord.js";
import { deleteQuiet, postQuiet } from "../agent-client.js";

export const QUIET_DEFAULT_MS = 2 * 60 * 60 * 1000;
export const QUIET_MAX_MS = 12 * 60 * 60 * 1000;

/** The duration value that ends an open quiet window: `/quiet duration:end`. */
export const QUIET_END_WORD = "end";

export function parseQuietDuration(raw: string | null): { ok: true; durationMs: number } | { ok: false; error: string } {
  const text = raw?.trim() ?? "";
  if (!text) return { ok: true, durationMs: QUIET_DEFAULT_MS };
  const match = /^(\d+)\s*([mh])$/i.exec(text);
  if (!match) return { ok: false, error: "Use a duration like 30m or 2h, or end to stop an open quiet." };
  const amount = Number(match[1]);
  if (amount === 0) return { ok: false, error: "Quiet needs at least one minute." };
  const durationMs = match[2]!.toLowerCase() === "h" ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
  if (!Number.isSafeInteger(durationMs) || durationMs > QUIET_MAX_MS) {
    return { ok: false, error: "Quiet can last at most 12 hours." };
  }
  return { ok: true, durationMs };
}

/** Discord shows `<t:…:t>` as a short time in each viewer's own zone, so no zone of the Owner's appears. */
export function quietUntilText(untilMs: number): string {
  return `<t:${Math.floor(untilMs / 1000)}:t>`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const raw = interaction.options.getString("duration")?.trim() ?? "";
  if (raw.toLowerCase() === QUIET_END_WORD) {
    await deleteQuiet();
    await interaction.editReply({ content: "Quiet is off." });
    return;
  }
  const parsed = parseQuietDuration(raw || null);
  if (!parsed.ok) {
    await interaction.editReply({ content: parsed.error });
    return;
  }
  const result = await postQuiet(parsed.durationMs);
  await interaction.editReply({ content: `Quiet until ${quietUntilText(result.window.untilMs)}.` });
}
