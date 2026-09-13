import type { ChatInputCommandInteraction } from "discord.js";
import {
  bindForgetConfirmation,
  forgetTopic,
} from "../agent-client.js";
import { registerForgetPending } from "../handlers/reactionAdd.js";

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const topic = interaction.options.getString("topic", true);
  const preview = await forgetTopic(topic, false);

  if (preview.preview.length === 0) {
    await interaction.editReply(`Nothing matched "${topic}".`);
    return;
  }

  const counts = preview.categoryCounts
    ? Object.entries(preview.categoryCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "";
  const list = preview.preview.map((p) => `• ${p}`).join("\n");
  const msg = await interaction.editReply({
    content:
      `Forget these?\n${list}` +
      (counts ? `\nCounts: ${counts}` : "") +
      `\n\nReact ✅ to confirm or ❌ to cancel.` +
      (preview.honesty
        ? `\n_(Local only; Discord/provider/old backups may retain copies.)_`
        : ""),
  });

  if (preview.previewId) {
    try {
      await bindForgetConfirmation(preview.previewId, msg.id);
      registerForgetPending(interaction.user.id, topic, msg.id, preview.previewId);
    } catch (err) {
      console.warn("[discord-bot] forget bind failed; preview left pending:", err);
      await interaction.followUp({
        content:
          "I could not bind this confirmation message. Reacting here will not confirm; run /forget again.",
        ephemeral: true,
      }).catch(() => undefined);
    }
  } else {
    await interaction.followUp({
      content: "Forget preview could not be stored; nothing confirmed.",
      ephemeral: true,
    }).catch(() => undefined);
    return;
  }

  await msg.react("✅");
  await msg.react("❌");
}
