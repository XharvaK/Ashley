export type JobContext = { signal: AbortSignal };
type Job = (ctx: JobContext) => Promise<void>;

/**
 * Serial per channel, and abortable. Abort does not mean "throw the rest away":
 * agent-service has already committed her reply to memory, so a swallowed bubble
 * is a message the DB thinks she said and Doc never saw. Delivery code treats an
 * abort as "stop pacing, send the rest now".
 */
export class ChannelQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly running = new Map<string, AbortController>();

  enqueue(channelId: string, job: Job): Promise<void> {
    const prev = this.tails.get(channelId) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const controller = new AbortController();
        this.running.set(channelId, controller);
        try {
          await job({ signal: controller.signal });
        } finally {
          if (this.running.get(channelId) === controller) {
            this.running.delete(channelId);
          }
        }
      })
      .catch((err) => {
        console.error(`[discord-bot] queue error on ${channelId}:`, err);
      });

    this.tails.set(channelId, next);
    void next.finally(() => {
      if (this.tails.get(channelId) === next) this.tails.delete(channelId);
    });
    return next;
  }

  enqueueOrThrow(channelId: string, job: Job): Promise<void> {
    const rawPrev = this.tails.get(channelId) ?? Promise.resolve();
    const prev = rawPrev.catch(() => {});
    const next = prev.then(async () => {
      const controller = new AbortController();
      this.running.set(channelId, controller);
      try {
        await job({ signal: controller.signal });
      } finally {
        if (this.running.get(channelId) === controller) {
          this.running.delete(channelId);
        }
      }
    });
    // keep queue moving even if this job fails — store caught version for chaining
    const forTail = next.catch(() => {});
    this.tails.set(channelId, forTail);
    void forTail.finally(() => {
      if (this.tails.get(channelId) === forTail) this.tails.delete(channelId);
    });
    void next.catch((err) => {
      console.error(`[discord-bot] queue error on ${channelId}:`, err);
    });
    return next;
  }

  /** Doc sent something new: stop waiting between her old bubbles. */
  abort(channelId: string): void {
    this.running.get(channelId)?.abort();
  }

  abortAll(): void {
    for (const controller of this.running.values()) controller.abort();
  }

  get activeCount(): number {
    return this.tails.size;
  }

  /** Shutdown: let in-flight deliveries land, but do not hang a deploy on them. */
  async drain(timeoutMs: number): Promise<void> {
    const tails = [...this.tails.values()];
    if (tails.length === 0) return;
    await Promise.race([
      Promise.allSettled(tails),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}

export const channelQueue = new ChannelQueue();
