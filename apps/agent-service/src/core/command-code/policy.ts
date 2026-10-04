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

export type CommandCodeThoughtEffort =
  | typeof COMMAND_CODE_POLICY.effort
  | (typeof THOUGHT_EFFORT_BY_TRIGGER_KIND)[keyof typeof THOUGHT_EFFORT_BY_TRIGGER_KIND];

export function thoughtReasoningEffortForTrigger(
  triggerKind: string | null | undefined,
): CommandCodeThoughtEffort {
  if (triggerKind === "domus_notification") return THOUGHT_EFFORT_BY_TRIGGER_KIND.domus_notification;
  return COMMAND_CODE_POLICY.effort;
}
