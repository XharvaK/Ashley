import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "../model-routing/types.js";
import { renderMemoryContextMessage } from "../memory/context-role.js";
import { createContextProjection } from "../model-fabric/projection.js";
import { buildEligibleInputs, deriveContextRoute } from "./eligibility.js";
import {
  ensureContextBudgetPolicy,
  loadContextBudgetPolicy,
  planBudget,
  selectContextInputs,
} from "./plan.js";
import { writeContextAllocationReceipt } from "./receipts.js";
import type {
  ContextAllocation,
  ContextBudgetPolicy,
  ContextInputCandidate,
  ContextRequest,
  EligibleInputRef,
} from "./types.js";
import { assertC2ContractCompatible } from "./contract-state.js";

function isEligibleInput(value: ContextInputCandidate | EligibleInputRef): value is EligibleInputRef {
  return "routeClass" in value && "correctionIds" in value && "messageRole" in value;
}

function addCurrentMessage(
  request: ContextRequest,
  eligible: EligibleInputRef[],
): EligibleInputRef[] {
  const current = request.currentMessage;
  if (!current || eligible.some((item) => item.content === current)) return eligible;
  const route = deriveContextRoute(request);
  return [
    ...eligible,
    {
      ref: { type: "message", id: `current:${request.requestId ?? "request"}` },
      sourceType: "message",
      sourceId: `current:${request.requestId ?? "request"}`,
      section: "current_message",
      content: current,
      classification: "never_public",
      influenceClass: null,
      provenance: null,
      memoryContextRole: null,
      assertionId: null,
      correctionIds: [],
      barrierCovered: false,
      influenceEligible: true,
      retrievalEligible: true,
      required: true,
      priority: Number.MAX_SAFE_INTEGER,
      authorized: true,
      observedAt: null,
      routeClass: route.routeClass,
      entityUuid: null,
      messageRole: "user",
    },
  ];
}

function renderEligibleInput(input: EligibleInputRef): string {
  if (!input.memoryContextRole) return input.content;
  if (input.content.includes("memory_context_role=")) {
    const prefix = input.sourceType === "message" ? input.messageRole : input.sourceType;
    return input.content.startsWith(`${prefix}:`) ? input.content : `${prefix}: ${input.content}`;
  }
  const annotated = renderMemoryContextMessage({
    role: input.messageRole,
    text: input.content,
    memory_context_role: input.memoryContextRole,
    memory_assertion_ids: input.assertionId == null ? [] : [input.assertionId],
    memory_correction_ids: input.correctionIds,
  });
  if (input.sourceType === "message") return annotated;
  return `${input.sourceType}:${annotated.slice(input.messageRole.length + 1)}`;
}

function policyForRequest(
  db: DatabaseSync,
  request: ContextRequest,
): ContextBudgetPolicy {
  const policyId = request.policyId ?? "c2-default";
  const policyVersion = request.policyVersion ?? 1;
  const existing = loadContextBudgetPolicy(db, policyId, policyVersion);
  if (existing) return existing;
  return ensureContextBudgetPolicy(db, {
    policyId,
    version: policyVersion,
    totalUtf8Bytes: request.maxUtf8Bytes ?? request.totalUtf8Bytes,
    sectionBudgets: request.sectionBudgets,
    tokenEstimateDivisor: request.tokenEstimateDivisor,
  });
}

/** Select and render one bounded C2 request, then persist only its allocation metadata. */
export function selectAndRender(
  db: DatabaseSync,
  request: ContextRequest,
  supplied?: ContextInputCandidate[] | EligibleInputRef[],
): ContextAllocation {
  assertC2ContractCompatible(db);
  const policy = policyForRequest(db, request);
  const source = supplied ?? request.inputs ?? [];
  let eligible = source.length > 0 && isEligibleInput(source[0]!)
    ? [...source] as EligibleInputRef[]
    : buildEligibleInputs(db, { ...request, inputs: source as ContextInputCandidate[] });
  eligible = addCurrentMessage(request, eligible);
  // Account for the exact C1 role envelope before applying the hard byte cap.
  // Omitting a whole labeled item is safer than truncating its role metadata.
  const budgetInputs = eligible.map((input) => ({
    ...input,
    content: renderEligibleInput(input),
  }));
  const plan = planBudget(request, budgetInputs, policy);
  const selection = selectContextInputs(plan, budgetInputs);
  const orderedIncluded = [...selection.included].sort(
    (left, right) => Number(left.section === "current_message") - Number(right.section === "current_message"),
  );
  const orderedSelection = {
    ...selection,
    included: orderedIncluded,
  };
  const messages: ChatMessage[] = orderedIncluded.map((input) => ({
    role: input.messageRole,
    content: input.content,
  }));
  const projection = createContextProjection({
    contextPolicyId: `${plan.policyId}:${plan.policyVersion}`,
    purpose: request.purpose,
    messages,
    currentMessage: request.currentMessage,
    evidenceRefs: orderedIncluded.map((input) => input.ref),
    tokenEstimateDivisor: plan.tokenEstimateDivisor,
    bounds: {
      maxParts: 64,
      maxUtf8Bytes: plan.totalUtf8Bytes,
      maxEstimatedTokens: plan.maxEstimatedTokens,
    },
  });
  const receipt = writeContextAllocationReceipt({
    db,
    requestId: plan.requestId,
    ownerId: request.ownerId,
    purpose: request.purpose,
    route: plan.route,
    plan,
    projection,
    selection: orderedSelection,
    capabilityMode: request.capabilityMode ?? request.mode ?? "observe",
    sameSnapshotId: plan.snapshotId,
  });
  return { messages, projection, receipt, selection, plan };
}

export const renderContextProjection = selectAndRender;
