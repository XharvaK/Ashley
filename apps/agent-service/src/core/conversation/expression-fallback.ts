import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import type { ChatMessage } from "../model-routing/types.js";
import {
  DispatchDataPlaneMissingError,
  type CognitiveDispatchOptions,
} from "../../mistral-client.js";
import {
  stableIdentityBlock,
  mindStateHeadline,
  projectInspectionEvidenceBlock,
} from "../context-composer.js";
import { canOfferProjectInspection } from "../sandbox/project-registry.js";
import type { TurnContext } from "../context-composer.js";
import type { Decision } from "../types.js";
import { AppError } from "../../errors.js";
import {
  createModelFallbackChain,
  type ModelFabricDispatchMetadata,
  type ModelFallbackChain,
} from "../model-fabric/index.js";
import type { ContextBudgetMode } from "../context-allocation/types.js";
import type { ContextProjection } from "../model-fabric/projection.js";

export type ExpressionFallbackPolicy = "minimal_identity_allowed" | "mistral_only";
export type ExpressionFallbackLane = "interactive" | "urgent_grounded" | "exchange_cognition" | "curiosity_maintenance";

export const EXPRESSION_MAX_OUTPUT_TOKENS = 2048;
export const EXPRESSION_PROACTIVE_MAX_OUTPUT_TOKENS = 500;

export type ExpressionComplete = (
  messages: ChatMessage[],
  options: CognitiveDispatchOptions,
) => Promise<{
  text: string;
  model: string;
  modelFabric?: ModelFabricDispatchMetadata;
}>;

// Failures from which a visible fallback is permitted. Missing-key, budget,
// route-lifecycle and abort/deadline failures are intentionally NOT eligible:
// they are not recoverable by switching provider.
const INELIGIBLE_FAILURE_CODES: Set<string> = new Set([
  "route_disabled",
  "operator_disabled",
  "request_exceeds_tpm_budget",
  "endpoint_retired",
  "attention_deadline",
  "dispatch_data_plane_missing",
]);

const SECRET_PATTERN =
  /\b(api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|recovery[_-]?code|bearer)\b\s*[:=/]/i;

function failureCode(err: unknown): string | undefined {
  if (err instanceof AppError) return err.code;
  if (err && typeof err === "object" && "code" in err) {
    return typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;
  }
  return undefined;
}

export function isEligibleMistralFailure(err: unknown): boolean {
  if (err instanceof DispatchDataPlaneMissingError) {
    return false;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return false;
  }
  const code = failureCode(err);
  if (code && INELIGIBLE_FAILURE_CODES.has(code)) {
    return false;
  }
  return true;
}

/**
 * Computes the Expression fallback policy BEFORE primary Mistral dispatch.
 * Returns `mistral_only` when the turn relies on material the minimal
 * (fallback) profile deliberately excludes, else `minimal_identity_allowed`.
 */
export function buildExpressionFallbackPolicy(
  turn: TurnContext,
  decision: Decision,
  userMessage: string,
): ExpressionFallbackPolicy {
  if (
    env.mistralOnlyKinds.length > 0 &&
    env.mistralOnlyKinds.includes(decision.kind)
  ) {
    return "mistral_only";
  }
  // Identity evidence requires full identity docs the minimal profile excludes.
  if (decision.evidenceRefs.some((ref) => ref.type === "identity")) {
    return "mistral_only";
  }
  // Licensed external reads cannot be reproduced in the minimal profile.
  if (decision.authorizedClaims.readingRecordIds.length > 0) {
    return "mistral_only";
  }
  // Secret material must never cross the broader fallback provider boundary.
  if (SECRET_PATTERN.test(userMessage) || SECRET_PATTERN.test(turn.memoryBlock)) {
    return "mistral_only";
  }
  return "minimal_identity_allowed";
}

const MINIMAL_RENDERING_CONSTRAINTS = [
  "Honest and grounded: only state what is known or framed as tentative.",
  "Do not invent or fabricate; flag uncertainty explicitly.",
  "Render a single concise reply the user can see; no internal scaffolding.",
  "Minimal identity profile: stable values and principles only. No full identity documents, no long-term memory, no secrets.",
].join("\n");

/**
 * Builds the minimal profile that the visible fallback may send to its provider.
 * Constructed directly from approved typed components (never by redacting the
 * full provider prompt). Excludes full identity docs, full history, raw memory
 * rows, secrets, logs, sandbox output, and licensed reading excerpts.
 */
export function minimalExpressionContext(
  db: DatabaseSync,
  ownerId: string,
  turn: TurnContext,
  decision: Decision,
  userMessage: string,
): ChatMessage[] {
  const recent = env.expressionFallbackRecentTurns;
  const current = userMessage.trim();
  const systemParts = [
    stableIdentityBlock(db, ownerId),
    `## Mind state (headline only)\n${mindStateHeadline(db, ownerId)}`,
    projectInspectionEvidenceBlock(
      decision?.operationalLicense,
      decision?.inspectionObservation,
      {
        capabilityAvailable: canOfferProjectInspection(db),
        interpretationAvailable: Boolean(decision?.inspectionCognitiveResult),
        thoughtCompleted: decision?.thoughtSource === "model",
        thoughtError: decision?.thoughtError ?? null,
      },
    ),
    `## Honesty & rendering (minimal profile)\n${MINIMAL_RENDERING_CONSTRAINTS}`,
  ].filter(Boolean);

  const history = turn.hotMessages
    .filter((message) => (message.text ?? "").trim() !== current)
    .slice(-recent)
    .map((message) => ({
      role: message.role as "user" | "assistant" | "system",
      content: message.text,
    }));

  const userContent = [
    decision
      ? `## Decision intent\n${JSON.stringify({
            kind: decision.kind,
            objective: decision.objective ?? null,
            reason: decision.reason,
            urgency: decision.urgency,
          }).trim()}`
      : "",
    "Write only the message Doc will see.",
    "Minimal identity profile applies; do not invent or fabricate.",
    `Current user message follows once:`,
    current,
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: systemParts.join("\n\n") },
    ...history,
    { role: "user", content: userContent },
  ];
}

/**
 * Options for the visible fallback dispatch (one hop maximum).
 * - Route: ashley_expression_fallback (Groq qwen/qwen3.6-27b)
 * - No tools, no sandbox authority, no perception parts.
 */
export function fallbackCompletionOptions(input: {
  decisionId: number | null | undefined;
  deliveryReservationId: number | null | undefined;
  ownerId: string | null | undefined;
  deadlineAtMs: number | null | undefined;
  lane: ExpressionFallbackLane;
  attentionDb: DatabaseSync;
  modelFallbackChain?: ModelFallbackChain | null;
  contextBudgetMode?: ContextBudgetMode;
  contextBudgetPolicyId?: string;
  contextBudgetMaxUtf8Bytes?: number;
  contextBudgetSectionBudgets?: Record<string, number>;
  contextProjection?: ContextProjection;
}): CognitiveDispatchOptions {
  return {
    model: "qwen/qwen3.6-27b",
    route: "ashley_expression_fallback",
    maxTokens: EXPRESSION_MAX_OUTPUT_TOKENS,
    temperature: 0.7,
    reasoningEffort: "none",
    lane: input.lane,
    purpose: "expression",
    logicalRole: "expression",
    modelFallbackChain: input.modelFallbackChain ?? null,
    contextBudgetMode: input.contextBudgetMode,
    contextBudgetPolicyId: input.contextBudgetPolicyId,
    contextBudgetMaxUtf8Bytes: input.contextBudgetMaxUtf8Bytes,
    contextBudgetSectionBudgets: input.contextBudgetSectionBudgets,
    contextProjection: input.contextProjection,
    deadlineAtMs: input.deadlineAtMs ?? undefined,
    decisionId: input.decisionId ?? undefined,
    deliveryReservationId: input.deliveryReservationId ?? undefined,
    ownerId: input.ownerId ?? undefined,
    tools: undefined,
    attentionDb: input.attentionDb,
  };
}
