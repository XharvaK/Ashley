/** How long a Thought model stays open after a lifeboat-qualifying failure. */
export const THOUGHT_MODEL_CIRCUIT_MS = 10 * 60 * 1000;

/**
 * In-process circuit for one Thought model id.
 * The caller supplies the clock. A qualifying failure opens the model until
 * that clock passes the window. After the window the next try is half-open:
 * success removes the entry; a qualifying failure opens it again.
 * A non-qualifying failure does not open or extend an entry.
 */
export type ThoughtModelCircuit = {
  isOpen(modelId: string, nowMs: number): boolean;
  /** Returns true when this call opened or re-opened the model. */
  noteFailure(modelId: string, qualifies: boolean, nowMs: number): boolean;
  /** Returns true when a half-open entry was closed. */
  noteSuccess(modelId: string, nowMs: number): boolean;
  reset(): void;
};

export function createThoughtModelCircuit(): ThoughtModelCircuit {
  const openUntilMs = new Map<string, number>();
  return {
    isOpen(modelId, nowMs) {
      const until = openUntilMs.get(modelId);
      return until !== undefined && nowMs < until;
    },
    noteFailure(modelId, qualifies, nowMs) {
      if (!qualifies) return false;
      openUntilMs.set(modelId, nowMs + THOUGHT_MODEL_CIRCUIT_MS);
      return true;
    },
    noteSuccess(modelId, _nowMs) {
      if (!openUntilMs.has(modelId)) return false;
      openUntilMs.delete(modelId);
      return true;
    },
    reset() {
      openUntilMs.clear();
    },
  };
}

/** Process-wide breaker. Thought passes in this process share it. */
export const thoughtModelCircuit = createThoughtModelCircuit();
