/**
 * Gaps between her bubbles. The wait before bubble 0 is the typing lead
 * (`typingLeadMs`), not this band.
 *
 * Target band: 3–10s by next-bubble length (Alex locked 2026-08-01).
 */
export const PACE_BUDGET_MS = 20_000;

/** Typing lead before bubble 0: clamp(chars * 25 ms, 400, 2000). */
export const TYPING_LEAD_MS_PER_CHAR = 25;
export const TYPING_LEAD_MIN_MS = 400;
export const TYPING_LEAD_MAX_MS = 2_000;

const MIN_MS = 3_000;
const MAX_MS = 10_000;

export function typingLeadMs(chars: number): number {
  const scaled = Math.max(0, chars) * TYPING_LEAD_MS_PER_CHAR;
  return Math.min(TYPING_LEAD_MAX_MS, Math.max(TYPING_LEAD_MIN_MS, scaled));
}

/**
 * `tempoGapMs` is how long Alex took to send this message after his previous one.
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

/** UX W2 Rhythm: the shape she chose for a thought. */
export type BubbleShape = "single" | "burst" | "aside" | "letter";

export const BURST_GAP_MIN_MS = 700;
export const BURST_GAP_MAX_MS = 2_000;
export const ASIDE_LEAD_MAX_MS = 900;
export const LETTER_LEAD_MS_PER_CHAR = 6;
export const LETTER_LEAD_MAX_MS = 4_000;

/** The typing lead before bubble 0: an aside comes quickly, a letter takes its time. */
export function shapedLeadMs(shape: BubbleShape | undefined, chars: number): number {
  const lead = typingLeadMs(chars);
  if (shape === "aside") return Math.min(lead, ASIDE_LEAD_MAX_MS);
  if (shape === "letter") {
    return Math.max(lead, Math.min(LETTER_LEAD_MAX_MS, Math.max(0, chars) * LETTER_LEAD_MS_PER_CHAR));
  }
  return lead;
}

/** The gap before a later bubble: a burst runs fast; every other shape keeps the band. */
export function shapedGapMs(shape: BubbleShape | undefined, gapMs: number, remainingBudgetMs: number): number {
  if (shape !== "burst" || gapMs <= 0) return gapMs;
  const fast = Math.min(BURST_GAP_MAX_MS, Math.max(BURST_GAP_MIN_MS, Math.round(gapMs * 0.25)));
  return Math.min(fast, Math.max(0, remainingBudgetMs));
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

/** Per-channel record of how fast Alex is going. */
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
