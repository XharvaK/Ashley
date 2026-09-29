import type { ChatInputCommandInteraction } from "discord.js";
import { decideIdentityReview, identityReviews } from "../agent-client.js";

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
