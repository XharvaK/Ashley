import type { DatabaseSync } from "node:sqlite";
import { capabilityCanInfluence } from "../rollout/capabilities.js";

/** Relationship influence requires relationship_state apply + optional second gate. */
export function relationshipCanInfluence(
  db: DatabaseSync,
  cognitionMode: "observe" | "apply",
  secondCapability?: "relational_initiative",
): boolean {
  if (!capabilityCanInfluence(db, "relationship_state", cognitionMode)) {
    return false;
  }
  if (secondCapability) {
    return capabilityCanInfluence(db, secondCapability, cognitionMode);
  }
  return true;
}

export function relationshipCanRecord(
  db: DatabaseSync,
  cognitionMode: "observe" | "apply",
): boolean {
  return (
    capabilityCanInfluence(db, "relationship_state", cognitionMode) ||
    capabilityCanInfluence(db, "mind_state", cognitionMode)
  );
}
