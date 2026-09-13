/**
 * @deprecated Wave 03 replaced this process-local limiter with the durable
 * attention governor in `core/attention/`. Kept only so accidental imports
 * fail loudly in review; do not wire new callers here.
 */
export type Lane = "interactive" | "background";

export function acquireLane(): never {
  throw new Error(
    "mistral-limiter is retired; use core/attention runAttentiveDispatch",
  );
}

export function releaseLane(): void {
  /* no-op */
}

export function recordTokenUsage(): void {
  /* no-op */
}

export function resetLimiterForTests(): void {
  /* no-op */
}

export function limiterStats(): {
  inFlight: number;
  interactiveInFlight: number;
  queued: number;
} {
  return { inFlight: 0, interactiveInFlight: 0, queued: 0 };
}
