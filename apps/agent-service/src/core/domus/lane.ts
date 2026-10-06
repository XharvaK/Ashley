// E1: the game is her own lane. A Domus pass runs in a conversation of its own, served by its own
// worker, so a Discord message never cancels or holds a game thought, and a game thought never holds
// a Discord turn. What she says from the game still reaches the Owner's own thread (the pass's home).
export const DOMUS_LANE_PREFIX = "domus-lane:";

export function domusLaneId(ownerId: string): string {
  if (!ownerId.trim()) throw new Error("domus_lane_owner_required");
  return DOMUS_LANE_PREFIX + ownerId;
}

export function isDomusLane(conversationId: string): boolean {
  return conversationId.startsWith(DOMUS_LANE_PREFIX);
}
