import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { isOwner } from "../security/gate.js";
import { decideIdentityReview, identityReviews, currentPractices, revertPractice, type Practice } from "../agent-client.js";

export function renderReview(review: Awaited<ReturnType<typeof identityReviews>>["reviews"][number]): string {
  const status = review.appliedAt
    ? "applied"
    : `Ashley: ${review.ashleyPosition ?? "pending"}; Alex: ${review.docDecision ?? "pending"}`;
  const lines = [`#${review.id} ${review.targetKind}: ${review.targetKey}`];
  if (review.previousValue) lines.push(`was: ${review.previousValue}`);
  lines.push(review.proposedValue);
  if (review.ashleyRationale) lines.push(`Ashley: ${review.ashleyRationale}`);
  lines.push(review.evidenceCount === undefined ? status : `${status}; evidence: ${review.evidenceCount}`);
  return lines.join("\n");
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getString("action", true);
  if (action === "practices") {
    const { practices } = await currentPractices();
    const shown = practices.slice(0, 12);
    const buttons = shown.map(practice => new ButtonBuilder().setCustomId(`practice-revert:${practice.revisionId}`).setLabel(`Revert #${practice.revisionId}`).setStyle(ButtonStyle.Secondary));
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let n = 0; n < buttons.length; n += 3) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(n, n+3)));
    await interaction.editReply({ content: renderPractices(shown), components });
    return;
  }
  if (action === "review") {
    const result = await identityReviews();
    const pending = result.reviews
      .filter((review) => !review.appliedAt && (review.status === undefined || review.status === "proposed"))
      .slice(0, 10);
    await interaction.editReply(
      pending.length > 0
        ? pending.map(renderReview).join("\n\n")
        : "No foundational identity reviews are pending.",
    );
    return;
  }
  const reviewId = interaction.options.getInteger("review-id", true);
  const rationale = interaction.options.getString("rationale") ?? undefined;
  const decision = action as "approve" | "reject" | "defer";
  const result = await decideIdentityReview(reviewId, decision, rationale);
  await interaction.editReply(
    result.recorded
      ? `Recorded Alex's ${decision} decision for identity review #${reviewId}.${result.applied ? " Ashley had affirmed it, so it is now part of her identity." : ""}`
      : `Identity review #${reviewId} was not found or is no longer open.`,
  );
}

export function renderPractices(practices: readonly Practice[]): string {
  return practices.length ? practices.slice(0, 12).map(p => `#${p.revisionId} ${p.text.slice(0, 100)}`).join("\n") : "No practices are currently held.";
}
export async function handlePracticeRevert(interaction: ButtonInteraction): Promise<void> {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({ content: "Not authorized.", ephemeral: true });
    return;
  }
  const match = /^practice-revert:([1-9][0-9]*)$/.exec(interaction.customId);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return;
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await revertPractice(Number(match[1]));
    await interaction.editReply(result.reverted ? `Reverted practice #${match[1]}.` : "That practice is no longer current.");
  } catch { await interaction.editReply("The practice could not be reverted. Try again later."); }
}
