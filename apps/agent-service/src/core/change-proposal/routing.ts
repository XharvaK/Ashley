import type { ChangeProposalTargetCategory } from "./types.js";

export type RoutingPolicy = {
  consultationRequired: boolean;
  requiresAshleyPosition: boolean;
  requiresDocDecision: boolean;
  mayAutoApply: boolean;
  routeToRevisions: boolean;
  routeToIdentityReview: boolean;
};

export function routingPolicy(
  category: ChangeProposalTargetCategory,
): RoutingPolicy {
  switch (category) {
    case "runtime_code":
    case "prompt_expression":
    case "evaluation":
      return {
        consultationRequired: false,
        requiresAshleyPosition: false,
        requiresDocDecision: true,
        mayAutoApply: false,
        routeToRevisions: false,
        routeToIdentityReview: false,
      };
    case "ordinary_identity":
      return {
        consultationRequired: false,
        requiresAshleyPosition: false,
        requiresDocDecision: false,
        mayAutoApply: false,
        routeToRevisions: true,
        routeToIdentityReview: false,
      };
    case "foundational_identity":
      return {
        consultationRequired: true,
        requiresAshleyPosition: true,
        requiresDocDecision: true,
        mayAutoApply: false,
        routeToRevisions: false,
        routeToIdentityReview: true,
      };
    case "ethics_governance":
    case "capability_policy":
    case "vision":
      return {
        consultationRequired: true,
        requiresAshleyPosition: true,
        requiresDocDecision: true,
        mayAutoApply: false,
        routeToRevisions: false,
        routeToIdentityReview: false,
      };
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

export function docDecisionAuthorizesBroker(_decision: string | null): boolean {
  return false;
}
