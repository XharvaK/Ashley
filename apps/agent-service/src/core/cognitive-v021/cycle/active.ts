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

export type ActiveThoughtHandle = {
  signal: AbortSignal;
  readonly cancellationReason: ActiveThoughtCancellationReason | null;
  unregister(): void;
};

/** Register only the currently executing provider call for one conversation. */
export function registerActiveThought(
  conversationId: string,
  cycleId: string,
  generation: number,
  controller = new AbortController(),
): ActiveThoughtHandle {
  const entry: ActiveThoughtEntry = {
    cycleId,
    generation,
    controller,
    reason: null,
  };
  activeThoughts.set(conversationId, entry);
  return {
    signal: controller.signal,
    get cancellationReason() {
      return entry.reason;
    },
    unregister() {
      if (activeThoughts.get(conversationId) === entry) activeThoughts.delete(conversationId);
    },
  };
}

/** Cancel an active Thought call after the durable fence has committed. */
export function cancelActiveThought(input: {
  conversationId: string;
  cycleId: string;
  generation: number;
  action: ActiveThoughtCancellationReason;
}): boolean {
  const entry = activeThoughts.get(input.conversationId);
  if (!entry) return false;
  const matches = input.action === "compose"
    ? entry.cycleId === input.cycleId && entry.generation === input.generation
    : entry.generation === input.generation;
  if (!matches) return false;
  entry.reason = input.action;
  if (!entry.controller.signal.aborted) entry.controller.abort(input.action);
  return true;
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
