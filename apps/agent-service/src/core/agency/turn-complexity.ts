import type { Decision, DecisionKind, Motivation, Trigger } from "../types.js";

/** Stable inspectable reason codes for turn-complexity classification. */
export type HardTurnReason =
  | "explicit_space_request"
  | "completion_hold"
  | "should_not_speak"
  | "kind_silence"
  | "kind_delay"
  | "applicable_refusal_candidate"
  | "material_action_conflict"
  | "high_stakes_safety"
  | "consequential_uncertainty"
  | "meaningful_initiative"
  | "own_time_report_active"
  | "high_effort_complexity"
  | "explicit_urgency";

export type TurnComplexity =
  | { mode: "terminal"; reasons: HardTurnReason[] }
  | { mode: "easy"; reasons: HardTurnReason[] }
  | { mode: "hard"; reasons: HardTurnReason[] };

export type TurnComplexityInput = {
  decision: Decision;
  motivations: Motivation[];
  trigger: Trigger;
  userMessage?: string;
  /** True when a typed own-time constraint is active and may influence. */
  ownTimeReportActive?: boolean;
  /** Boundary motivation ids already licensed by relevance. */
  relevantBoundaryIds?: ReadonlySet<number>;
};

const INCOMPATIBLE_PAIRS: ReadonlyArray<readonly [DecisionKind, DecisionKind]> = [
  ["speak", "silence"],
  ["share", "refuse"],
  ["ask", "silence"],
  ["revisit", "silence"],
  ["challenge", "silence"],
  ["share", "silence"],
];

const ACTION_KINDS = new Set<Motivation["kind"]>([
  "silence_signal",
  "boundary",
  "take",
  "question",
  "unfinished",
  "opinion",
  "callback",
  "identity",
  "reminder",
  "scheduled_proactive",
]);

const HIGH_STAKES_RE =
  /\b(?:delete (?:my |all )?(?:memory|identity|data)|wipe (?:me|memory)|kill (?:yourself|ashley)|password|api[_ -]?key|private key|recovery code|foundational (?:identity|value)|change who you are|harm yourself|suicide|overdose)\b/i;

const URGENCY_RE =
  /\b(?:urgent|emergency|right now|immediately|asap|危|danger|crisis)\b/i;

function actionKind(motivation: Motivation): DecisionKind | null {
  switch (motivation.kind) {
    case "silence_signal":
      return "silence";
    case "boundary":
      return "refuse";
    case "take":
      return "share";
    case "question":
      return "ask";
    case "unfinished":
    case "callback":
    case "fact":
      return "revisit";
    case "opinion":
      return "challenge";
    case "identity":
      return "share";
    case "user_message":
    case "silence_ok":
    case "availability":
    case "reminder":
    case "scheduled_proactive":
    case "learned_interest":
      return null;
    default: {
      const _exhaustive: never = motivation.kind;
      return _exhaustive;
    }
  }
}

function hasMaterialActionConflict(
  motivations: Motivation[],
  relevantBoundaryIds: ReadonlySet<number> | undefined,
): boolean {
  const candidates = motivations
    .filter((item) => {
      if (!ACTION_KINDS.has(item.kind)) return false;
      if (item.kind === "boundary") {
        return item.id !== undefined && relevantBoundaryIds?.has(item.id) === true;
      }
      return true;
    })
    .map((item) => ({
      kind: actionKind(item),
      score: item.score,
    }))
    .filter((item): item is { kind: DecisionKind; score: number } => item.kind !== null);

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (Math.abs(a.score - b.score) > 15) continue;
      for (const [left, right] of INCOMPATIBLE_PAIRS) {
        if (
          (a.kind === left && b.kind === right) ||
          (a.kind === right && b.kind === left)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Deterministic terminal / easy / hard classification.
 * Never calls a model. Typed reasons only.
 */
export function classifyTurnComplexity(
  input: TurnComplexityInput,
): TurnComplexity {
  const { decision, motivations, trigger, userMessage } = input;
  const reasons: HardTurnReason[] = [];
  const message = userMessage?.trim() ?? "";

  if (decision.kind === "silence") reasons.push("kind_silence");
  if (decision.kind === "delay") reasons.push("kind_delay");
  if (decision.cognitiveAllocation.completion === "hold") {
    reasons.push("completion_hold");
  }
  if (!decision.cognitiveAllocation.shouldSpeak) {
    reasons.push("should_not_speak");
  }
  if (
    motivations.some(
      (item) => item.kind === "silence_signal" && item.score >= 70,
    )
  ) {
    reasons.push("explicit_space_request");
  }

  if (
    reasons.includes("kind_silence") ||
    reasons.includes("kind_delay") ||
    reasons.includes("completion_hold") ||
    reasons.includes("should_not_speak") ||
    reasons.includes("explicit_space_request")
  ) {
    return { mode: "terminal", reasons };
  }

  const hardReasons: HardTurnReason[] = [];

  if (input.ownTimeReportActive) {
    hardReasons.push("own_time_report_active");
  }

  const relevantBoundaries = motivations.filter(
    (item) =>
      item.kind === "boundary" &&
      item.id !== undefined &&
      input.relevantBoundaryIds?.has(item.id) === true,
  );
  if (trigger === "reactive" && relevantBoundaries.length > 0) {
    hardReasons.push("applicable_refusal_candidate");
  }

  if (hasMaterialActionConflict(motivations, input.relevantBoundaryIds)) {
    hardReasons.push("material_action_conflict");
  }

  if (message && HIGH_STAKES_RE.test(message)) {
    hardReasons.push("high_stakes_safety");
  }

  if (decision.uncertainty >= 0.5) {
    hardReasons.push("consequential_uncertainty");
  }

  if (decision.cognitiveAllocation.effort === "high") {
    hardReasons.push("high_effort_complexity");
  }

  if (decision.urgency >= 0.75) {
    hardReasons.push("explicit_urgency");
  }

  if (
    trigger === "proactive" &&
    (decision.kind === "share" ||
      decision.kind === "ask" ||
      decision.kind === "revisit" ||
      decision.kind === "challenge")
  ) {
    hardReasons.push("meaningful_initiative");
  }

  if (message && URGENCY_RE.test(message) && decision.urgency >= 0.5) {
    if (!hardReasons.includes("explicit_urgency")) {
      hardReasons.push("explicit_urgency");
    }
  }

  if (hardReasons.length > 0) {
    return { mode: "hard", reasons: hardReasons };
  }

  return { mode: "easy", reasons: [] };
}

/** True when Expression must not run. */
export function isTerminalDecision(decision: Decision): boolean {
  return (
    !decision.cognitiveAllocation.shouldSpeak ||
    decision.cognitiveAllocation.completion === "hold" ||
    decision.kind === "silence" ||
    decision.kind === "delay"
  );
}
