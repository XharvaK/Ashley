import {readSelfChangeLadder} from "./self-change-ladder.js";
// Thought chooses self-change; the Host exposes motive facts and binds its declared opportunity to L1.
import type { DatabaseSync } from "node:sqlite";
import type { FutureTrigger } from "../types.js";
import { frictionForThought } from "./friction.js";
import { listOpenRevisions } from "./revisions.js";
import { getConcern, getConcernAuthorityFacts } from "../concerns/lineage.js";
import { configureBudgetPolicy, resolveBudgetPolicy, PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS } from "../private-budget/policies.js";

export const SELF_CHANGE_POLICY_ID = "ashley.self_change.v1";
export const SELF_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;
export type SelfChangeRefusalReason = "self_change_ladder_l0" | "self_change_mixed_scope" | "self_change_concern_binding_invalid" | "self_change_motive_unavailable" | "self_change_budget_unconfigured" | "self_change_budget_policy_invalid";

/** Configuration is Host/Owner supplied; this function neither supplies a limit nor activates a capability. */
export function configureSelfChangeBudget(db: DatabaseSync, input: { limit: number; version: number }) {
  return configureBudgetPolicy(db, { policyId: SELF_CHANGE_POLICY_ID, version: input.version, limit: input.limit,
    windowMs: SELF_CHANGE_WINDOW_MS, clockDiscontinuityMs: PRIVATE_THOUGHT_CLOCK_DISCONTINUITY_MS });
}

export function selfChangeMotivesForThought(db: DatabaseSync, nowMs: number) {
  const friction = frictionForThought(db, nowMs);
  return {
    frictionPatterns: Object.entries(friction.last7d).filter(([,count]) => count >= 3).map(([kind,count]) => ({ kind, count })),
    proposedPractices: listOpenRevisions(db).filter(revision => revision.layer === "practice" && revision.createdAtMs <= nowMs)
      .map(revision => ({ revisionId: revision.revisionId, text: revision.proposedText })),
  };
}

/** The authored trigger and current concern bind a private self-change pass; no Host concern or wake is created here. */
export function selfChangeOpportunityPolicy(db: DatabaseSync, input: { conversationId: string; dueTriggers: readonly FutureTrigger[]; nowMs: number }):
  | { kind: "ordinary" } | { kind: "self_change"; policyId: string } | { kind: "refused"; reason: SelfChangeRefusalReason } {
  const declared = input.dueTriggers.filter(trigger => trigger.payload?.budgetPolicyId === SELF_CHANGE_POLICY_ID);
  if (declared.length === 0) return { kind: "ordinary" };
  if (readSelfChangeLadder(db).level === 0) return { kind: "refused", reason: "self_change_ladder_l0" };
  if (declared.length !== input.dueTriggers.length) return { kind: "refused", reason: "self_change_mixed_scope" };
  const motives = selfChangeMotivesForThought(db,input.nowMs);
  for (const trigger of declared) {
    const concern = getConcern(db,trigger.concernId);
    const authority = getConcernAuthorityFacts(db,trigger.concernId);
    const target = concern?.objective?.target;
    if (!concern || concern.conversationId !== input.conversationId || trigger.conversationId !== input.conversationId
      || concern.snapshotHash !== trigger.snapshotHash || !authority || authority.forgotten || authority.quarantineKind !== null
      || !["active","investigating","waiting_for_evidence"].includes(concern.status ?? "") || target?.kind !== "self_change") {
      return { kind: "refused", reason: "self_change_concern_binding_invalid" };
    }
    const supported = target.motiveKind === "friction_pattern"
      ? motives.frictionPatterns.some(pattern => pattern.kind === target.motiveRef)
      : target.motiveKind === "practice" && motives.proposedPractices.some(practice => String(practice.revisionId) === target.motiveRef);
    if (!supported) return { kind: "refused", reason: "self_change_motive_unavailable" };
  }
  try {
    if (resolveBudgetPolicy(db,SELF_CHANGE_POLICY_ID).windowMs !== SELF_CHANGE_WINDOW_MS) {
      return { kind: "refused", reason: "self_change_budget_policy_invalid" };
    }
  }
  catch { return { kind: "refused", reason: "self_change_budget_unconfigured" }; }
  return { kind: "self_change", policyId: SELF_CHANGE_POLICY_ID };
}
