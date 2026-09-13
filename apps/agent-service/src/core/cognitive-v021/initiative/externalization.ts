import type { DeliveryIntent, ExternalizationGateReason } from "../types.js";
import type { PrivateBudgetProjection } from "../private-budget/ledger.js";

type AuthoritativePrivateBudget = Pick<
  PrivateBudgetProjection,
  "source" | "policyId" | "policyTimeMs" | "clockState" | "consumingCount" | "remaining"
>;

export type ExternalizationGateInput = {
  deliveryIntent: DeliveryIntent;
  paused: boolean;
  enabled: boolean;
  sentToday: number;
  maxPerDay: number;
  chatInProgress: boolean;
  availabilityOk: boolean;
  idleFloorRemainingSec: number;
  privateBudget: AuthoritativePrivateBudget;
};

export type ExternalizationGateResult =
  | { ok: true; reason: "ok" }
  | { ok: false; reason: Exclude<ExternalizationGateReason, "ok"> };

/** Executive delivery gate. It never chooses whether a concern is interesting. */
export function evaluateExternalizationGate(input: ExternalizationGateInput): ExternalizationGateResult {
  if (input.deliveryIntent.deliveryLane !== "proactive") return { ok: true, reason: "ok" };
  if (!input.enabled) return { ok: false, reason: "proactive_disabled" };
  if (input.paused) return { ok: false, reason: "proactive_paused" };
  if (input.chatInProgress) return { ok: false, reason: "chat_in_progress" };
  if (!input.availabilityOk) return { ok: false, reason: "unavailable" };
  if (input.idleFloorRemainingSec > 0) return { ok: false, reason: "idle_floor" };
  if (input.privateBudget.source !== "private_budget_ledger" || input.privateBudget.clockState !== "stable" || input.privateBudget.remaining <= 0) {
    return { ok: false, reason: "private_compute_budget" };
  }
  if (input.sentToday >= input.maxPerDay) return { ok: false, reason: "daily_cap" };
  return { ok: true, reason: "ok" };
}
