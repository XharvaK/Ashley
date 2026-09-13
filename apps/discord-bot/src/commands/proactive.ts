import type { ChatInputCommandInteraction } from "discord.js";
import {
  getProactiveStatus,
  pauseProactive,
  resumeProactive,
} from "../initiative/scheduler.js";

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getString("action", true);

  if (action === "status") {
    const status = await getProactiveStatus();
    const lines = [
      `Unprompted messages: ${status.enabled ? "on" : "off"}`,
      status.paused ? "Paused right now." : "Not paused.",
      `Sent today: ${status.sentToday}/${status.maxPerDay}`,
      `Quiet until you've been idle ~${status.minIdleHours}h`,
      `Last time I texted first: ${status.lastSentAt ?? "never"}`,
      `Last thing you said: ${status.lastUserMessageAt ?? "never"}`,
    ];
    await interaction.editReply(lines.join("\n"));
    return;
  }

  if (action === "pause") {
    await pauseProactive();
    await interaction.editReply({
      content: "Okay — I won't text first until you `/proactive resume`.",
    });
    return;
  }

  if (action === "resume") {
    await resumeProactive();
    await interaction.editReply({
      content: "Alright, I might text first again when there's a reason.",
    });
  }
}
