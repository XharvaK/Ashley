import type { ChatInputCommandInteraction } from "discord.js";
import { decideIdentityReview, identityReviews } from "../agent-client.js";

function renderReview(review: Awaited<ReturnType<typeof identityReviews>>["reviews"][number]): string {
  const status = review.appliedAt
    ? "applied"
    : `Ashley: ${review.ashleyPosition ?? "pending"}; Doc: ${review.docDecision ?? "pending"}`;
  return `#${review.id} ${review.targetKey}\n${review.proposedValue}\n${status}`;
}

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const action = interaction.options.getString("action", true);
  if (action === "review") {
    const result = await identityReviews();
    const pending = result.reviews.filter((review) => !review.appliedAt).slice(0, 10);
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
      ? `Recorded Doc's ${decision} decision for identity review #${reviewId}.`
      : `Identity review #${reviewId} was not found or is already applied.`,
  );
}
