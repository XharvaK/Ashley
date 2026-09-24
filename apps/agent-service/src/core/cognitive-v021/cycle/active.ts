import type { DatabaseSync } from "node:sqlite";
import { recordWakeCancellation } from "../wake/ledger.js";

export type ActiveThoughtCancellationReason = "compose" | "preempt";

type ActiveThoughtEntry = {
  cycleId: string;
  generation: number;
  controller: AbortController;
  reason: ActiveThoughtCancellationReason | null;
};

const activeThoughts = new Map<string, ActiveThoughtEntry>();
const activeEffectExecutions = new Map<string, ActiveThoughtEntry>();

export type ActiveThoughtHandle = {
  signal: AbortSignal;
  readonly cancellationReason: ActiveThoughtCancellationReason | null;
  unregister(): void;
};

/** Register the currently executing provider call for one conversation. */
export function registerActiveThought(
  conversationId: string,
  cycleId: string,
  generation: number,
  controller = new AbortController(),
): ActiveThoughtHandle {
  return registerActive(activeThoughts, conversationId, cycleId, generation, controller);
}

/** Register an awaited effect so durable cancellation can stop its backend. */
export function registerActiveEffectExecution(
  conversationId: string,
  cycleId: string,
  generation: number,
  controller = new AbortController(),
): ActiveThoughtHandle {
  return registerActive(activeEffectExecutions, conversationId, cycleId, generation, controller);
}

function registerActive(
  owners: Map<string, ActiveThoughtEntry>,
  conversationId: string,
  cycleId: string,
  generation: number,
  controller: AbortController,
): ActiveThoughtHandle {
  const entry: ActiveThoughtEntry = {
    cycleId,
    generation,
    controller,
    reason: null,
  };
  owners.set(conversationId, entry);
  return {
    signal: controller.signal,
    get cancellationReason() {
      return entry.reason;
    },
    unregister() {
      if (owners.get(conversationId) === entry) owners.delete(conversationId);
    },
  };
}

/** Cancel active Thought and effect work after the durable fence commits. */
export function cancelActiveThought(input: {
  conversationId: string;
  cycleId: string;
  generation: number;
  action: ActiveThoughtCancellationReason;
}): boolean {
  let cancelled = false;
  for (const owners of [activeThoughts, activeEffectExecutions]) {
    const entry = owners.get(input.conversationId);
    if (!entry) continue;
    const matches = input.action === "compose"
      ? entry.cycleId === input.cycleId && entry.generation === input.generation
      : entry.generation === input.generation;
    if (!matches) continue;
    entry.reason = input.action;
    if (!entry.controller.signal.aborted) entry.controller.abort(input.action);
    cancelled = true;
  }
  return cancelled;
}

/** Persist the cancellation fence before issuing the best-effort process-local abort. */
export function cancelActiveThoughtDurable(
  db: DatabaseSync,
  input: {
    conversationId: string;
    cycleId: string;
    generation: number;
    wakeId: string;
    action: ActiveThoughtCancellationReason;
    nowMs?: number;
  },
): boolean {
  recordWakeCancellation(db, { wakeId: input.wakeId, nowMs: input.nowMs ?? Date.now() });
  return cancelActiveThought(input);
}
