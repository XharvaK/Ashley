import { sha256 } from "../../model-fabric/hash.js";

export function occurrenceIdFor(input: {
  sourceKind: "inbox" | "future_trigger" | "idle" | "subscription";
  triggerRef: string;
  conversationId: string;
}): string {
  return `wake-occurrence:${sha256(input)}`;
}

export function wakeIdFor(occurrenceId: string): string {
  return `wake:${sha256(occurrenceId)}`;
}

/** Kernel-owned cycle identity. Retries and duplicate producers reuse it. */
export function cycleIdFor(wakeId: string): string {
  return `cycle:${sha256(wakeId)}`;
}
