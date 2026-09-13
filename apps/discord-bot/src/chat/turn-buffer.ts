/**
 * Doc types in fragments. Three lines in five seconds are one turn, not three,
 * and answering each separately is what makes a bot feel like a form handler.
 *
 * Fragments are merged rather than dropped: a dropped line never reaches the
 * agent at all, so it never reaches memory either.
 *
 * Quiet window: wait ~1500ms after the last fragment before draining, with a
 * 5s hard cap from the first fragment so a never-ending drip still drains.
 *
 * Latency budget starts at finalFragmentReceivedAt (last fragment arrival),
 * not at quiet-window close.
 */

const DEFAULT_QUIET_MS = 1500;
const DEFAULT_HARD_CAP_MS = 5000;

type BufferEntry<F, T> = {
  fragments: F[];
  target: T;
  openedAt: number;
  finalFragmentReceivedAt: number;
};

export class TurnBuffer<F, T> {
  private readonly buffers = new Map<string, BufferEntry<F, T>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onReady: (channelId: string) => void,
    private readonly quietMs = DEFAULT_QUIET_MS,
    private readonly hardCapMs = DEFAULT_HARD_CAP_MS,
  ) {}

  /** True when nothing was waiting yet (first fragment of a new turn). */
  push(channelId: string, fragment: F, target: T): boolean {
    const now = Date.now();
    const existing = this.buffers.get(channelId);
    if (existing) {
      existing.fragments.push(fragment);
      existing.target = target;
      existing.finalFragmentReceivedAt = now;
      this.schedule(channelId);
      return false;
    }
    this.buffers.set(channelId, {
      fragments: [fragment],
      target,
      openedAt: now,
      finalFragmentReceivedAt: now,
    });
    this.schedule(channelId);
    return true;
  }

  take(channelId: string): {
    fragments: F[];
    target: T;
    finalFragmentReceivedAt: number;
  } | null {
    this.clearTimer(channelId);
    const buffered = this.buffers.get(channelId);
    if (!buffered) return null;
    this.buffers.delete(channelId);
    return {
      fragments: buffered.fragments,
      target: buffered.target,
      finalFragmentReceivedAt: buffered.finalFragmentReceivedAt,
    };
  }

  /** Test helper: force the quiet timer to fire now. */
  flushForTest(channelId: string): void {
    this.clearTimer(channelId);
    if (this.buffers.has(channelId)) this.onReady(channelId);
  }

  private schedule(channelId: string): void {
    this.clearTimer(channelId);
    const buf = this.buffers.get(channelId);
    if (!buf) return;
    const elapsed = Date.now() - buf.openedAt;
    const remainingCap = Math.max(0, this.hardCapMs - elapsed);
    const delay = Math.min(this.quietMs, remainingCap);
    this.timers.set(
      channelId,
      setTimeout(() => {
        this.timers.delete(channelId);
        if (this.buffers.has(channelId)) this.onReady(channelId);
      }, delay),
    );
  }

  private clearTimer(channelId: string): void {
    const t = this.timers.get(channelId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(channelId);
    }
  }
}
