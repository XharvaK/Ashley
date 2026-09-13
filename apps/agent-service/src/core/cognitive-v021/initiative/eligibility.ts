import type { DatabaseSync } from "node:sqlite";
import { env } from "../../../env.js";
import { capabilityCanInfluence } from "../../rollout/capabilities.js";
import { hasUrgentMindState } from "../../state/mind-items.js";
import { hasOpenOwnTimeSession } from "../../state/own-time.js";
import { getState } from "../../state/store.js";

export type InitiativeClass = "ordinary" | "urgent_grounded";

export type ProactiveEligibility =
  | { ok: true; initiativeClass: InitiativeClass }
  | {
      ok: false;
      reason: string;
      initiativeClass: InitiativeClass;
      cooldownRemainingSec?: number;
    };

export type ProactiveEligibilityInput = {
  ownerId: string;
  chatInProgress: boolean;
  paused: boolean;
  enabled?: boolean;
  sentToday: number;
  maxPerDay: number;
  lastUserMessageAt: string | null;
  minIdleHours: number;
  /** Read-only classification input. Never claim an urgent wake here. */
  hasUrgent: boolean;
};

function idleRemainingSec(
  lastUserMessageAt: string | null,
  minIdleHours: number,
  nowMs: number,
): number {
  if (minIdleHours <= 0 || !lastUserMessageAt) return 0;
  const lastMs = Date.parse(lastUserMessageAt);
  if (!Number.isFinite(lastMs)) return 0;
  const needMs = minIdleHours * 3_600_000;
  const elapsed = nowMs - lastMs;
  if (elapsed >= needMs) return 0;
  return Math.ceil((needMs - elapsed) / 1000);
}

/** Classify initiative without mutating wake leases. */
export function classifyInitiativeClass(
  db: DatabaseSync,
  ownerId: string,
): InitiativeClass {
  if (
    capabilityCanInfluence(db, "relational_initiative") &&
    hasUrgentMindState(db, ownerId)
  ) {
    return "urgent_grounded";
  }
  return "ordinary";
}

/** Read-only executive eligibility for current V0.2.1 idle externalization. */
export function evaluateProactiveEligibility(
  db: DatabaseSync,
  input: ProactiveEligibilityInput,
  now = new Date(),
): ProactiveEligibility {
  const initiativeClass: InitiativeClass = input.hasUrgent
    ? "urgent_grounded"
    : "ordinary";
  const enabled = input.enabled ?? env.proactiveEnabled;

  if (!enabled) return { ok: false, reason: "proactive_disabled", initiativeClass };
  if (input.paused) return { ok: false, reason: "proactive_paused", initiativeClass };
  if (input.sentToday >= input.maxPerDay) return { ok: false, reason: "daily_cap", initiativeClass };
  if (input.chatInProgress) return { ok: false, reason: "chat_in_progress", initiativeClass };

  const openOwnTime = hasOpenOwnTimeSession(db, input.ownerId);
  const state = getState(db, input.ownerId);
  if (openOwnTime || state.availability !== "available" || state.focus === "own_time") {
    return { ok: false, reason: "unavailable", initiativeClass };
  }

  if (initiativeClass === "ordinary") {
    const remaining = idleRemainingSec(
      input.lastUserMessageAt,
      input.minIdleHours,
      now.getTime(),
    );
    if (remaining > 0) {
      return {
        ok: false,
        reason: "idle_floor",
        initiativeClass,
        cooldownRemainingSec: remaining,
      };
    }
  }

  return { ok: true, initiativeClass };
}
