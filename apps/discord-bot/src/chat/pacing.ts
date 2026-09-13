/**
 * Gaps between her bubbles only. Nothing is added before the first one, because
 * Mistral already spends 1 to 5 seconds there and a human would have been typing
 * through it.
 *
 * Target band: 3–10s by next-bubble length (Doc locked 2026-08-01).
 */
export const PACE_BUDGET_MS = 20_000;

const MIN_MS = 3_000;
const MAX_MS = 10_000;

/**
 * `tempoGapMs` is how long Doc took to send this message after his previous one.
 * Char length dominates; rapid-fire from him slightly shortens the band.
 */
export function bubbleDelayMs(params: {
  tempoGapMs: number | null;
  chars: number;
  remainingBudgetMs: number;
  rand?: () => number;
}): number {
  if (params.remainingBudgetMs <= 0) return 0;
  const rand = params.rand ?? Math.random;
  const t = Math.min(1, Math.max(0, params.chars / 280));
  const base = MIN_MS + t * (MAX_MS - MIN_MS);
  const jitter = (rand() - 0.5) * 900;
  let tempoScale = 1;
  if (params.tempoGapMs !== null && params.tempoGapMs <= 20_000) {
    tempoScale = 0.9;
  } else if (params.tempoGapMs !== null && params.tempoGapMs > 120_000) {
    tempoScale = 1.08;
  }
  const ms = Math.round(
    Math.min(MAX_MS, Math.max(MIN_MS, (base + jitter) * tempoScale)),
  );
  return Math.min(ms, params.remainingBudgetMs);
}

export function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

/** Per-channel record of how fast Doc is going. */
export class TempoTracker {
  private readonly last = new Map<string, number>();
  private readonly gaps = new Map<string, number | null>();

  /** Gap since his previous message, then remembers this one. */
  mark(channelId: string, now = Date.now()): number | null {
    const prev = this.last.get(channelId) ?? null;
    this.last.set(channelId, now);
    const gap = prev === null ? null : now - prev;
    this.gaps.set(channelId, gap);
    return gap;
  }

  /** Most recent gap from mark(), for drains that run after a debounce. */
  lastGapMs(channelId: string): number | null {
    return this.gaps.get(channelId) ?? null;
  }
}

export const tempoTracker = new TempoTracker();
