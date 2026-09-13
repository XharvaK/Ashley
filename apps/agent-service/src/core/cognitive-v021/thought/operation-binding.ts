import { randomUUID } from "node:crypto";
import { sha256 } from "../../model-fabric/hash.js";
import type {
  EffectIntentSemanticOutput,
  EffectProposal,
  ObservationIntentSemanticOutput,
  ObservationRequest,
  AuthorityCurrentnessBinding,
} from "../types.js";

const OPERATION_DEADLINE_CAP_MS = 120_000;

type ObservationBindingInput = {
  intent: ObservationIntentSemanticOutput;
  cycleId: string;
  generation: number;
  parentDeadlineAtMs: number;
  nowMs: number;
  authorityCurrentness?: AuthorityCurrentnessBinding;
};

export type BoundObservationRequest = ObservationRequest & {
  correlationId: string;
  deadlineAtMs: number;
  operationKind: string;
  intent: ObservationIntentSemanticOutput;
};

export function bindObservationIntent(input: ObservationBindingInput): BoundObservationRequest {
  const deadlineAtMs = Math.min(input.parentDeadlineAtMs, input.nowMs + OPERATION_DEADLINE_CAP_MS);
  if (deadlineAtMs <= input.nowMs) throw new Error("deadline_exhausted");
  const requestId = `observation:${randomUUID()}`;
  return {
    requestId,
    cycleId: input.cycleId,
    generation: input.generation,
    kind: input.intent.operationKind,
    request: input.intent.request,
    replaySafe: true,
    correlationId: requestId,
    deadlineAtMs,
    operationKind: input.intent.operationKind,
    intent: input.intent,
    authorityCurrentness: input.authorityCurrentness,
  };
}

type EffectBindingInput = {
  intent: EffectIntentSemanticOutput;
  cycleId: string;
  generation: number;
  authorityEpoch: number;
  parentDeadlineAtMs: number;
  nowMs: number;
  authorityCurrentness?: AuthorityCurrentnessBinding;
};

export type BoundEffectProposal = EffectProposal & {
  correlationId: string;
  deadlineAtMs: number;
  replaySafe: false;
  intent: EffectIntentSemanticOutput;
};

export function bindEffectIntent(input: EffectBindingInput): BoundEffectProposal {
  const deadlineAtMs = Math.min(input.parentDeadlineAtMs, input.nowMs + OPERATION_DEADLINE_CAP_MS);
  if (deadlineAtMs <= input.nowMs) throw new Error("deadline_exhausted");
  const identity = sha256({ cycleId: input.cycleId, generation: input.generation, intent: input.intent });
  const effectId = `effect:${randomUUID()}`;
  const correlationId = `effect-correlation:${randomUUID()}`;
  return {
    effectId,
    cycleId: input.cycleId,
    generation: input.generation,
    idempotencyKey: `thought-effect:${input.cycleId}:${input.generation}:${identity}`,
    kind: input.intent.operationKind,
    request: input.intent.request,
    authorityEpoch: input.authorityEpoch,
    correlationId,
    deadlineAtMs,
    replaySafe: false,
    intent: input.intent,
    authorityCurrentness: input.authorityCurrentness,
  };
}
