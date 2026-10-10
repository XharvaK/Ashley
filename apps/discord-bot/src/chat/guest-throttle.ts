/**
 * Sliding-window admission per key (one guest in one place). Facts only: the
 * caller decides what a refusal means. Keys with no recent hits are forgotten.
 */
export function createSlidingWindowLimiter(options: { windowMs: number; max: number }): {
  admit(key: string, nowMs: number): boolean;
} {
  const hits = new Map<string, number[]>();
  return {
    admit(key: string, nowMs: number): boolean {
      const recent = (hits.get(key) ?? []).filter((at) => nowMs - at < options.windowMs);
      const admitted = recent.length < options.max;
      if (admitted) recent.push(nowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
      return admitted;
    },
  };
}

/** A guest may get this many messages into her attention per window; the rest are not captured. */
export const GUEST_WINDOW_MS = 20_000;
export const GUEST_MESSAGES_PER_WINDOW = 4;
