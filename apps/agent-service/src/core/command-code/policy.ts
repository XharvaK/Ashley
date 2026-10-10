/**
 * Current Command Code model policy shared by Thought API and the CLI worker. High, not xhigh, since
 * 2026-10-10 (User: xhigh is not needed for anything; a room pass took 1.5-2 minutes at xhigh).
 */
export const COMMAND_CODE_POLICY = Object.freeze({
  modelId: "meta/muse-spark-1.3-contributor",
  effort: "high",
} as const);

/**
 * Thought passes whose trigger kind uses a lower reasoning effort.
 * Every trigger absent from this map keeps COMMAND_CODE_POLICY.effort.
 */
export const THOUGHT_EFFORT_BY_TRIGGER_KIND = Object.freeze({
  domus_notification: "low",
} as const);

/**
 * The model for Domus (game-body) Thought passes (User, 2026-10-06; SC-CON-08): DeepSeek V4.1
 * Flash, fast variant. Low effort since 2026-10-08 (User: try low and watch latency and play; at
 * medium a game pass spent about 7k hidden tokens and 35 s). Every other Thought keeps COMMAND_CODE_POLICY.
 */
export const COMMAND_CODE_DOMUS_POLICY = Object.freeze({
  modelId: "deepseek/deepseek-v4.1-flash-fast",
  effort: THOUGHT_EFFORT_BY_TRIGGER_KIND.domus_notification,
} as const);

export function thoughtModelForTrigger(triggerKind: string | null | undefined): CommandCodeThoughtModelId {
  return triggerKind === "domus_notification" ? COMMAND_CODE_DOMUS_POLICY.modelId : COMMAND_CODE_POLICY.modelId;
}

export function thoughtReasoningEffortForTrigger(
  triggerKind: string | null | undefined,
): CommandCodeThoughtEffort {
  if (triggerKind === "domus_notification") return THOUGHT_EFFORT_BY_TRIGGER_KIND.domus_notification;
  return COMMAND_CODE_POLICY.effort;
}

/**
 * HA2 provider lifeboat (User, 2026-10-06): one backup model per Thought pass, tried once, only
 * after the pass's own model failed because the provider was unavailable. Muse passes fall back
 * to DeepSeek V4.1 Flash at high; Domus passes fall back to Muse at low (2026-10-08, with the Domus
 * seat). The Discord backup's effort was max until
 * 2026-10-08: at max the backup thought for 5 minutes on average and 7 of 43 answers spent the whole 65,536-token
 * output on reasoning with no answer left (User: try high).
 */
export const COMMAND_CODE_LIFEBOAT = Object.freeze({
  thought: Object.freeze({ modelId: "deepseek/deepseek-v4.1-flash", effort: "high" } as const),
  domus: Object.freeze({ modelId: "meta/muse-spark-1.3-contributor", effort: "low" } as const),
});

export type CommandCodeLifeboat =
  | typeof COMMAND_CODE_LIFEBOAT.thought
  | typeof COMMAND_CODE_LIFEBOAT.domus;

export function thoughtLifeboatForTrigger(triggerKind: string | null | undefined): CommandCodeLifeboat {
  return triggerKind === "domus_notification" ? COMMAND_CODE_LIFEBOAT.domus : COMMAND_CODE_LIFEBOAT.thought;
}

export type CommandCodeThoughtModelId =
  | typeof COMMAND_CODE_POLICY.modelId
  | typeof COMMAND_CODE_DOMUS_POLICY.modelId
  | typeof COMMAND_CODE_LIFEBOAT.thought.modelId;

export const COMMAND_CODE_THOUGHT_MODELS: ReadonlySet<string> = new Set<CommandCodeThoughtModelId>([
  COMMAND_CODE_POLICY.modelId,
  COMMAND_CODE_DOMUS_POLICY.modelId,
  COMMAND_CODE_LIFEBOAT.thought.modelId,
]);

export type CommandCodeThoughtEffort =
  | typeof COMMAND_CODE_POLICY.effort
  | (typeof THOUGHT_EFFORT_BY_TRIGGER_KIND)[keyof typeof THOUGHT_EFFORT_BY_TRIGGER_KIND]
  | typeof COMMAND_CODE_LIFEBOAT.thought.effort;

export const COMMAND_CODE_THOUGHT_EFFORTS: ReadonlySet<string> = new Set([
  COMMAND_CODE_POLICY.effort,
  THOUGHT_EFFORT_BY_TRIGGER_KIND.domus_notification,
  COMMAND_CODE_LIFEBOAT.thought.effort,
  COMMAND_CODE_LIFEBOAT.domus.effort,
]);
