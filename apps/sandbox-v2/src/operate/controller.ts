/**
 * Sandbox V2 M6 sequential controller.
 *
 * Agency admits a finite sequence. This controller bounds, executes once per
 * admitted step, settles, and stops. It does not choose objectives, invent
 * steps, extend budgets, or cross an engineering border.
 */
import {
  M6_FORBIDDEN_EFFECT_OPERATIONS,
  M6_MAX_STEPS,
  M6_PERMITTED_STEP_KINDS,
} from "./limits.js";
import type {
  M6ControllerResult,
  M6StepExecution,
  M6StepRecord,
  M6StepSpec,
  M6StopReason,
} from "./types.js";

const PERMITTED = new Set<string>(M6_PERMITTED_STEP_KINDS);
const FORBIDDEN_EFFECTS = new Set<string>(M6_FORBIDDEN_EFFECT_OPERATIONS);

export type RunBoundedOperationInput = {
  steps: readonly M6StepSpec[];
  maxSteps: number;
  deadlineAtMs: number;
  continueUntilSolved?: unknown;
  cancelled?: () => boolean;
  clock?: { nowMs(): number };
  executeStep: (step: M6StepSpec, index: number) => Promise<M6StepExecution>;
};

function emptyResult(stopReason: M6StopReason): M6ControllerResult {
  return {
    stopReason,
    stepsExecuted: 0,
    stepRecords: [],
    borderState: "none",
  };
}

function isForbiddenEffect(step: M6StepSpec): boolean {
  if (FORBIDDEN_EFFECTS.has(step.kind)) return true;
  if (typeof step.operation === "string" && FORBIDDEN_EFFECTS.has(step.operation)) {
    return true;
  }
  return false;
}

export function admitBoundedOperationSequence(input: {
  steps: readonly M6StepSpec[];
  maxSteps: number;
  continueUntilSolved?: unknown;
}): { ok: true } | { ok: false; reason: M6StopReason } {
  if (input.continueUntilSolved === true) {
    return { ok: false, reason: "unbounded_continue_forbidden" };
  }
  if (typeof input.continueUntilSolved === "string") {
    return { ok: false, reason: "unbounded_continue_forbidden" };
  }
  if (!Array.isArray(input.steps) || input.steps.length < 1) {
    return { ok: false, reason: "empty_sequence" };
  }
  if (
    !Number.isInteger(input.maxSteps) ||
    input.maxSteps < 1 ||
    input.maxSteps > M6_MAX_STEPS ||
    input.steps.length > M6_MAX_STEPS ||
    input.maxSteps !== input.steps.length
  ) {
    return { ok: false, reason: "operation_ceiling_exceeded" };
  }
  for (const step of input.steps) {
    if (isForbiddenEffect(step)) {
      return { ok: false, reason: "m7_effect_forbidden" };
    }
    if (!PERMITTED.has(step.kind)) {
      return { ok: false, reason: "unpermitted_operation" };
    }
  }
  return { ok: true };
}

export async function runBoundedOperation(
  input: RunBoundedOperationInput,
): Promise<M6ControllerResult> {
  const admitted = admitBoundedOperationSequence({
    steps: input.steps,
    maxSteps: input.maxSteps,
    continueUntilSolved: input.continueUntilSolved,
  });
  if (!admitted.ok) return emptyResult(admitted.reason);

  const now = () => (input.clock ? input.clock.nowMs() : Date.now());
  if (now() >= input.deadlineAtMs) {
    return emptyResult("deadline_exceeded");
  }
  if (input.cancelled?.()) {
    return emptyResult("cancelled");
  }

  const records: M6StepRecord[] = [];
  for (let index = 0; index < input.steps.length; index += 1) {
    if (input.cancelled?.()) {
      return {
        stopReason: "cancelled",
        stepsExecuted: records.length,
        stepRecords: records,
        borderState: "none",
      };
    }
    if (now() >= input.deadlineAtMs) {
      return {
        stopReason: "deadline_exceeded",
        stepsExecuted: records.length,
        stepRecords: records,
        borderState: "none",
      };
    }
    if (index >= input.maxSteps) {
      return {
        stopReason: "budget_exhausted",
        stepsExecuted: records.length,
        stepRecords: records,
        borderState: "none",
      };
    }
    const step = input.steps[index]!;
    const execution = await input.executeStep(step, index);
    if (execution.ok) {
      records.push({
        index,
        kind: step.kind,
        ...(step.operation ? { operation: step.operation } : {}),
        outcome: "succeeded",
      });
      continue;
    }
    records.push({
      index,
      kind: step.kind,
      ...(step.operation ? { operation: step.operation } : {}),
      outcome: "failed",
      ...(execution.error ? { error: execution.error } : {}),
    });
    const stopReason: M6StopReason =
      execution.error === "authority_lost" || execution.error === "gate_denied"
        ? "authority_lost"
        : execution.error === "deadline_exceeded"
          ? "deadline_exceeded"
          : execution.error === "cancelled"
            ? "cancelled"
            : execution.error === "cleanup_failure"
              ? "cleanup_failure"
              : "step_failed";
    return {
      stopReason,
      stepsExecuted: records.length,
      stepRecords: records,
      borderState: "none",
    };
  }

  return {
    stopReason: "succeeded",
    stepsExecuted: records.length,
    stepRecords: records,
    borderState: "none",
  };
}
