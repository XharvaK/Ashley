/** Base open window after the first qualifying failure of a streak. */
export const THOUGHT_MODEL_CIRCUIT_MS = 10 * 60 * 1000;

/** Cap for a widened open window. */
export const THOUGHT_MODEL_CIRCUIT_MAX_MS = 60 * 60 * 1000;

type CircuitEntry = {
  openUntilMs: number;
  streak: number;
};

/**
 * In-process circuit for one Thought model id.
 * The caller supplies the clock. A qualifying failure opens the model.
 * Consecutive qualifying failures widen the window from the base to the cap.
 * After the window the next try is half-open: success removes the entry;
 * a qualifying failure opens it again on the next wider window.
 * A streak with no failure and no success for longer than max + base after
 * the window ended starts again at the base window.
 * A non-qualifying failure does not open, extend, or advance a streak.
 */
export type ThoughtModelCircuit = {
  isOpen(modelId: string, nowMs: number): boolean;
  /** Returns true when this call opened or re-opened the model. */
  noteFailure(modelId: string, qualifies: boolean, nowMs: number): boolean;
  /** Returns true when an entry was closed. */
  noteSuccess(modelId: string, nowMs: number): boolean;
  /** Open window last set for this model, or 0 when it has no entry. */
  windowMs(modelId: string): number;
  /** Qualifying-failure streak for this model, or 0 when it has no entry. */
  streak(modelId: string): number;
  reset(): void;
};

function windowForStreak(streak: number): number {
  const widened = THOUGHT_MODEL_CIRCUIT_MS * 2 ** (streak - 1);
  if (!Number.isFinite(widened)) return THOUGHT_MODEL_CIRCUIT_MAX_MS;
  return Math.min(widened, THOUGHT_MODEL_CIRCUIT_MAX_MS);
}

/** A streak still counts when the next failure is not past max + base after the window. */
function streakContinues(entry: CircuitEntry, nowMs: number): boolean {
  return nowMs <= entry.openUntilMs + THOUGHT_MODEL_CIRCUIT_MAX_MS + THOUGHT_MODEL_CIRCUIT_MS;
}

export function createThoughtModelCircuit(): ThoughtModelCircuit {
  const entries = new Map<string, CircuitEntry>();
  return {
    isOpen(modelId, nowMs) {
      const entry = entries.get(modelId);
      return entry !== undefined && nowMs < entry.openUntilMs;
    },
    noteFailure(modelId, qualifies, nowMs) {
      if (!qualifies) return false;
      const previous = entries.get(modelId);
      const streak = previous !== undefined && streakContinues(previous, nowMs) ? previous.streak + 1 : 1;
      const windowMs = windowForStreak(streak);
      entries.set(modelId, { openUntilMs: nowMs + windowMs, streak });
      return true;
    },
    noteSuccess(modelId, _nowMs) {
      if (!entries.has(modelId)) return false;
      entries.delete(modelId);
      return true;
    },
    windowMs(modelId) {
      const entry = entries.get(modelId);
      return entry === undefined ? 0 : windowForStreak(entry.streak);
    },
    streak(modelId) {
      return entries.get(modelId)?.streak ?? 0;
    },
    reset() {
      entries.clear();
    },
  };
}

/** Process-wide breaker. Thought passes in this process share it. */
export const thoughtModelCircuit = createThoughtModelCircuit();
