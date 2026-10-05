/** Current Command Code model policy shared by Thought API and the CLI worker. */
export const COMMAND_CODE_POLICY = Object.freeze({
  modelId: "meta/muse-spark-1.3-contributor",
  effort: "xhigh",
} as const);

/**
 * Thought passes whose trigger kind uses a lower reasoning effort.
 * Every trigger absent from this map keeps COMMAND_CODE_POLICY.effort.
 */
export const THOUGHT_EFFORT_BY_TRIGGER_KIND = Object.freeze({
  domus_notification: "medium",
} as const);

/**
 * The model for Domus (game-body) Thought passes (User, 2026-10-06; SC-CON-08): DeepSeek V4.1
 * Flash, fast variant, at medium effort. Every other Thought keeps COMMAND_CODE_POLICY.
 */
export const COMMAND_CODE_DOMUS_POLICY = Object.freeze({
  modelId: "deepseek/deepseek-v4.1-flash-fast",
  effort: "medium",
} as const);

export type CommandCodeThoughtModelId =
  | typeof COMMAND_CODE_POLICY.modelId
  | typeof COMMAND_CODE_DOMUS_POLICY.modelId;

export const COMMAND_CODE_THOUGHT_MODELS: ReadonlySet<string> = new Set<CommandCodeThoughtModelId>([
  COMMAND_CODE_POLICY.modelId,
  COMMAND_CODE_DOMUS_POLICY.modelId,
]);

export function thoughtModelForTrigger(triggerKind: string | null | undefined): CommandCodeThoughtModelId {
  return triggerKind === "domus_notification" ? COMMAND_CODE_DOMUS_POLICY.modelId : COMMAND_CODE_POLICY.modelId;
}

export type CommandCodeThoughtEffort =
  | typeof COMMAND_CODE_POLICY.effort
  | (typeof THOUGHT_EFFORT_BY_TRIGGER_KIND)[keyof typeof THOUGHT_EFFORT_BY_TRIGGER_KIND];

export function thoughtReasoningEffortForTrigger(
  triggerKind: string | null | undefined,
): CommandCodeThoughtEffort {
  if (triggerKind === "domus_notification") return THOUGHT_EFFORT_BY_TRIGGER_KIND.domus_notification;
  return COMMAND_CODE_POLICY.effort;
}
