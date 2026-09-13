export type FairWorkCandidate = {
  eventId: string;
  lane: string;
  conversationId: string;
  state: "pending" | "retry_wait" | "quarantined" | "terminal" | "leased";
  nextEligibleAtMs: number | null;
  createdAtMs: number;
  lastServedAtMs: number;
};

function laneRank(lane: string): number {
  if (lane === "interactive" || lane === "owner_interactive") return 0;
  if (lane === "proactive") return 1;
  if (lane === "background") return 2;
  return 3;
}

/** Pure selector used by the durable claim transaction. */
export function selectFairEligibleHead(candidates: FairWorkCandidate[], nowMs: number): FairWorkCandidate | null {
  const activeConversations = new Set(
    candidates.filter((candidate) => candidate.state === "leased").map((candidate) => `${candidate.lane}\u0000${candidate.conversationId}`),
  );
  return candidates
    .filter((candidate) => candidate.state === "pending")
    .filter((candidate) => candidate.nextEligibleAtMs == null || candidate.nextEligibleAtMs <= nowMs)
    .filter((candidate) => !activeConversations.has(`${candidate.lane}\u0000${candidate.conversationId}`))
    .sort((left, right) => laneRank(left.lane) - laneRank(right.lane)
      || left.lastServedAtMs - right.lastServedAtMs
      || left.createdAtMs - right.createdAtMs
      || left.eventId.localeCompare(right.eventId))[0] ?? null;
}

/** Compatibility name retained for existing pure-selector callers. */
export const selectFairWork = selectFairEligibleHead;
