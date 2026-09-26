import type {
  ConcernObjectiveFacet,
  ConcernObjectiveTarget,
} from "../types.js";
import type { SocialAudience } from "../social/types.js";
import { parseSourceSupportRef } from "../evidence/interpretation-envelope.js";

const OBJECTIVE_KEYS = new Set([
  "intendedOutcome",
  "unresolvedQuestion",
  "adoptionRevision",
  "supportRefs",
  "delegationRef",
  "audience",
  "target",
  "continuationConsiderations",
  "stoppingConsiderations",
  "disposition",
  "relatedRefs",
]);

/** Structural names that would turn a meaning facet into a host workflow. */
const FORBIDDEN_WORKFLOW_KEYS = new Set([
  "workflow",
  "workflowSteps",
  "steps",
  "step",
  "operations",
  "operation",
  "operationList",
  "actions",
  "action",
  "tools",
  "tool",
  "toolSequence",
  "sequence",
  "plan",
  "task",
  "tasks",
  "executable",
  "execution",
]);

const OBJECTIVE_DISPOSITIONS = new Set([
  "active",
  "waiting",
  "satisfied",
  "abandoned",
  "needs_review",
]);

type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Row
    : null;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function socialAudience(value: unknown): value is SocialAudience {
  const item = row(value);
  if (!item || typeof item.kind !== "string") return false;
  if (item.kind === "owner_private") return Object.keys(item).length === 1;
  if (item.kind === "owner_dm") return Object.keys(item).length === 2 && nonEmptyText(item.threadId);
  if (item.kind === "dm") return Object.keys(item).length === 2 && nonEmptyText(item.principalId);
  if (item.kind === "room") return Object.keys(item).length === 2 && nonEmptyText(item.roomId);
  return false;
}

function target(value: unknown): value is ConcernObjectiveTarget {
  const item = row(value);
  return item !== null && Object.values(item).every((entry) => nonEmptyText(entry));
}

function workflowKey(value: unknown): string | null {
  if (Array.isArray(value)) return "objective_array";
  const item = row(value);
  if (!item) return null;
  const key = Object.keys(item).find((candidate) => FORBIDDEN_WORKFLOW_KEYS.has(candidate));
  return key ?? null;
}

/**
 * Return a stable mechanical rejection code. Text is never inspected for
 * entailment; only shape and known workflow-bearing keys are rejected.
 */
export function concernObjectiveValidationError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const forbidden = workflowKey(value);
  if (forbidden !== null) return "concern_objective_workflow_forbidden";
  const item = row(value);
  if (!item) return "concern_objective_invalid";
  if (Object.keys(item).some((key) => !OBJECTIVE_KEYS.has(key))) return "concern_objective_invalid";

  const hasOutcome = Object.prototype.hasOwnProperty.call(item, "intendedOutcome");
  const hasQuestion = Object.prototype.hasOwnProperty.call(item, "unresolvedQuestion");
  if (hasOutcome && hasQuestion) return "concern_objective_invalid";
  if (hasOutcome && !nonEmptyText(item.intendedOutcome)) return "concern_objective_invalid";
  if (hasQuestion && !nonEmptyText(item.unresolvedQuestion)) return "concern_objective_invalid";
  if (item.adoptionRevision !== undefined
    && (!Number.isSafeInteger(item.adoptionRevision) || (item.adoptionRevision as number) < 0)) {
    return "concern_objective_invalid";
  }
  if (item.supportRefs !== undefined
    && (!Array.isArray(item.supportRefs)
      || !item.supportRefs.every((support) => parseSourceSupportRef(support) !== null))) {
    return "concern_objective_invalid";
  }
  if (item.delegationRef !== undefined
    && item.delegationRef !== null
    && !nonEmptyText(item.delegationRef)) {
    return "concern_objective_invalid";
  }
  if (item.audience !== undefined && item.audience !== null && !socialAudience(item.audience)) {
    return "concern_objective_invalid";
  }
  if (item.target !== undefined && item.target !== null && !target(item.target)) {
    return "concern_objective_invalid";
  }
  for (const key of ["continuationConsiderations", "stoppingConsiderations"] as const) {
    if (item[key] !== undefined && !nonEmptyText(item[key])) return "concern_objective_invalid";
  }
  if (item.disposition !== undefined
    && (typeof item.disposition !== "string" || !OBJECTIVE_DISPOSITIONS.has(item.disposition))) {
    return "concern_objective_invalid";
  }
  if (item.relatedRefs !== undefined
    && (!Array.isArray(item.relatedRefs) || !item.relatedRefs.every(nonEmptyText))) {
    return "concern_objective_invalid";
  }
  return null;
}

export function isConcernObjectiveFacet(value: unknown): value is ConcernObjectiveFacet {
  return concernObjectiveValidationError(value) === null && value !== undefined && value !== null;
}

export function parseConcernObjectiveFacet(value: unknown): ConcernObjectiveFacet | null {
  return isConcernObjectiveFacet(value) ? value : null;
}

export function assertConcernObjectiveFacet(value: unknown): asserts value is ConcernObjectiveFacet | null | undefined {
  const error = concernObjectiveValidationError(value);
  if (error) throw new Error(error);
}
