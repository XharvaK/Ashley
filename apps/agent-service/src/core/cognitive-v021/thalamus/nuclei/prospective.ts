// Authored deadlines and matched structured watches create timing obligations, not Host-authored intentions.
import type { Candidate } from "../core.js";
import { proposal, type Fact } from "./facts.js";
export type ProspectiveFact = Fact & { kind: "trigger" | "commitment" | "watch"; dueAtMs?: number;
  matched?: boolean; action?: "wake" | "wake_urgent" | "suppress" | "quiet_until"; expiresAtMs?: number };
export function prospective(items: readonly ProspectiveFact[], nowMs: number): Candidate[] {
  const result: Candidate[] = [];
  for (const item of items) {
    if (item.kind === "watch") {
      if (!item.matched || (item.expiresAtMs !== undefined && item.expiresAtMs <= nowMs)
        || (item.action !== "wake" && item.action !== "wake_urgent")) continue;
      result.push(proposal(item, "prospective", item.eventId, 1, "own_time", item.action === "wake_urgent" ? "ALWAYS_THROUGH" : "PRESSURE"));
    } else {
      if (!Number.isFinite(item.dueAtMs)) throw new Error("thalamus_due_time_required");
      result.push({ ...proposal(item, "prospective", item.eventId, 0, "own_time",
        item.dueAtMs! <= nowMs ? "ALWAYS_THROUGH" : "PRESSURE"), deadlineMs: item.dueAtMs });
    }
  }
  return result;
}
