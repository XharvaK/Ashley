import type { DeliveryIntent } from "../types.js";

/**
 * Growth V1 §5.5 delivery gate (Owner decision, 2026-09-29).
 *
 * The only Host limits on Ashley reaching out are Alex's `/proactive` pause
 * and the runaway fuse, and the fuse is enforced where she authors the
 * message (thought/run.ts, `unsolicitedFuseTripped`). This gate therefore
 * decides only *when* a proactive-lane message may leave, never whether it
 * was worth sending:
 *
 * - Speech Alex asked for — a due commitment, the result of work he started,
 *   a recovery of a turn he is owed — is never held.
 * - Her own initiative waits while Alex has paused it or is mid-conversation.
 *   Waiting is a deferral: the message stays pending and is never dropped.
 */

const REQUESTED_TRIGGERS: ReadonlySet<DeliveryIntent["trigger"]> = new Set([
  "owner_message_reactive",
  "commitment_due",
  "operation_completion",
  "recovery",
]);

export type ReachOutGateInput = {
  paused: boolean;
  chatInProgress: boolean;
};

export type ReachOutGateResult =
  | { ok: true }
  | { ok: false; reason: "proactive_paused" | "chat_in_progress"; defer: true };

export function evaluateReachOutGate(
  intent: Pick<DeliveryIntent, "deliveryLane" | "trigger">,
  input: ReachOutGateInput,
): ReachOutGateResult {
  if (intent.deliveryLane !== "proactive") return { ok: true };
  if (REQUESTED_TRIGGERS.has(intent.trigger)) return { ok: true };
  if (input.paused) return { ok: false, reason: "proactive_paused", defer: true };
  if (input.chatInProgress) return { ok: false, reason: "chat_in_progress", defer: true };
  return { ok: true };
}
