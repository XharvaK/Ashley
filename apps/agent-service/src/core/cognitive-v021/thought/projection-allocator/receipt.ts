import type { AllocationSectionId } from "./sections.js";
import type { RequirednessContract } from "./sections.js";
import type { SemanticProjectionEnvelope } from "./budget.js";
import type { CoverageManifest } from "../coverage-manifest.js";

export type AllocationTokenBreakdown = {
  static_contract_tokens: number;
  conversation_tokens: number;
  working_context_tokens: number;
  identity_kernel_tokens: number;
  domain_pointer_tokens: number;
  learned_self_tokens: number;
  retrieval_tokens: number;
  observations_tokens: number;
  in_flight_effect_tokens: number;
  authority_revision_feedback_tokens: number;
  omitted_for_budget_tokens: number;
  omitted_for_budget_count: number;
  required_overflow_count: number;
};

/** Mechanical, content-free measurements used to establish the W0 baseline. */
export type AllocationDiagnostics = {
  system_message_bytes: number;
  logical_input_bytes?: number;
  logical_input_byte_limit?: number;
  max_supported_composition_bytes?: number;
  orientation_kernel_bytes: number;
  required_base_estimated_tokens: number;
  optional_context_estimated_tokens: number;
  system_prefix_bytes: number;
  system_prefix_estimated_tokens: number;
  candidate_S0_S1_prefix_bytes: number;
  candidate_S0_S1_prefix_estimated_tokens: number;
  first_volatile_field: string | null;
  first_volatile_byte_offset: number | null;
  allocation_candidate_count: number;
  renderTentative_call_count: number;
  thoughtMessagesForProjection_call_count: number;
  /** W4 request-local memoization witnesses; absent on pre-W4 receipts. */
  thoughtOutputCompatibilityInstruction_call_count?: number;
  formatThoughtStructuralFeedback_call_count?: number;
  formatThoughtStructuralCorrectionData_call_count?: number;
  inFlightEffectRefMap_call_count?: number;
  allocation_elapsed_ms: number;
};

export type AllocationDecision = {
  included: Array<{
    id: string;
    section: AllocationSectionId;
    ref?: string;
    required: boolean;
    priority?: number;
    estimatedTokens?: number;
    requiredness?: RequirednessContract;
  }>;
  omitted: Array<{
    id: string;
    section: AllocationSectionId;
    ref?: string;
    required?: boolean;
    priority?: number;
    estimatedTokens?: number;
    reason: "budget_omission" | "duplicate" | "fuse" | "not_eligible";
    requiredness?: RequirednessContract;
  }>;
  includedWireBytes: number;
  estimatedInputTokens: number;
};

export type AllocationReceipt = {
  cycleId: string;
  generation: number;
  requestId: string;
  policyId: string;
  policyVersion: number;
  semanticProjectionEnvelope: SemanticProjectionEnvelope;
  /** Honest domain coverage evidence; it never grants semantic authority. */
  coverageManifest?: CoverageManifest;
  /** W0 mechanical geometry and allocation-cost measurements; no prompt content. */
  diagnostics?: AllocationDiagnostics;
  tokenBreakdown: AllocationTokenBreakdown;
  /** @deprecated Provider capacity is owned by Attention, not this receipt. */
  quotaBucket: string;
  /** @deprecated Provider capacity is owned by Attention, not this receipt. */
  hardTpm: number;
  maxOutputTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  totalDemandTokens: number;
  headroomTokens: number;
  compression: boolean;
  requiredOverflow: boolean;
  decision: AllocationDecision;
  semanticProjectionHash: string;
  dispatchMessagesHash: string;
};
