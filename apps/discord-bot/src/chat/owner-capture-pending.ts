import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ashleyDataDir } from "../data-root.js";

export type PendingOwnerCapture = { discordMessageId: string };

export type OwnerCaptureStore<T extends PendingOwnerCapture> = {
  load: () => T[];
  save: (items: readonly T[]) => void;
};

/** Outcome of a live capture: "captured" lets the turn go on at once; "not_captured" leaves it to the replay. */
export type OwnerCaptureOutcome = "captured" | "not_captured";

export type OwnerCaptureQueue<T extends PendingOwnerCapture> = {
  submit: (item: T) => Promise<OwnerCaptureOutcome>;
  flush: () => Promise<void>;
  pending: () => number;
  onDrained: (listener: () => void) => void;
};

/** Discord history is the backstop: the oldest waiting capture is left to reconciliation when the backlog is full. */
export const OWNER_CAPTURE_PENDING_LIMIT = 200;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;

export function ownerCapturePendingPath(dataDir: string = ashleyDataDir()): string {
  return join(dataDir, "discord-bot", "owner-capture-pending.json");
}

function isPendingCapture(value: unknown): value is PendingOwnerCapture {
  return typeof value === "object" && value !== null &&
    typeof (value as { discordMessageId?: unknown }).discordMessageId === "string";
}

/** A small JSON file in the data directory, written whole and renamed into place. */
export function fileOwnerCaptureStore<T extends PendingOwnerCapture>(path: string): OwnerCaptureStore<T> {
  return {
    load() {
      if (!existsSync(path)) return [];
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return Array.isArray(parsed) ? parsed.filter(isPendingCapture) as T[] : [];
      } catch {
        return [];
      }
    },
    save(items) {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, JSON.stringify(items), "utf8");
      renameSync(temporary, path);
    },
  };
}

/** A 4xx other than a timeout or rate limit will not succeed on retry: the capture is dropped, not held forever. */
function isPermanentRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function createOwnerCaptureQueue<T extends PendingOwnerCapture>(options: {
  capture: (item: T) => Promise<unknown>;
  store?: OwnerCaptureStore<T>;
  limit?: number;
  schedule?: (run: () => void, delayMs: number) => void;
  log?: Pick<Console, "warn" | "error">;
}): OwnerCaptureQueue<T> {
  const store: OwnerCaptureStore<T> = options.store ?? { load: () => [], save: () => undefined };
  const limit = options.limit ?? OWNER_CAPTURE_PENDING_LIMIT;
  const schedule = options.schedule ?? ((run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    (timer as { unref?: () => void }).unref?.();
  });
  const log = options.log ?? console;
  let items: T[] | null = null;
  let failures = 0;
  let retryScheduled = false;
  // Drains run one after another; a flush asked for during a run starts a fresh pass after it.
  let chain: Promise<void> = Promise.resolve();
  let drained: (() => void) | null = null;

  // Loaded on first use, so importing the bot never reads the data directory.
  function waiting(): T[] {
    if (items === null) items = store.load().slice(-limit);
    return items;
  }

  function persist(): void {
    try {
      store.save(waiting());
    } catch (error) {
      log.error("[discord-bot] owner capture pending list could not be saved; it stays in memory", error);
    }
  }

  function enqueue(item: T): void {
    const list = waiting();
    if (list.some((existing) => existing.discordMessageId === item.discordMessageId)) return;
    list.push(item);
    if (list.length > limit) {
      list.shift();
      log.warn("[discord-bot] owner capture backlog is full; the oldest waiting capture is left to history reconciliation");
    }
    persist();
  }

  function scheduleRetry(): void {
    if (retryScheduled || waiting().length === 0) return;
    retryScheduled = true;
    const delayMs = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(failures, 6));
    schedule(() => {
      retryScheduled = false;
      void flush();
    }, delayMs);
  }

  async function drain(): Promise<void> {
    let progressed = false;
    const list = waiting();
    while (list.length > 0) {
      const next = list[0]!;
      try {
        await options.capture(next);
      } catch (error) {
        if (isPermanentRefusal(error)) {
          list.shift();
          persist();
          log.error("[discord-bot] owner capture refused for good; dropped from the pending list", error);
          continue;
        }
        failures += 1;
        log.error("[discord-bot] owner capture still failing; retry scheduled", error);
        scheduleRetry();
        return;
      }
      list.shift();
      failures = 0;
      progressed = true;
      persist();
    }
    if (progressed && drained) {
      try {
        drained();
      } catch (error) {
        log.error("[discord-bot] owner capture drained listener failed", error);
      }
    }
  }

  function flush(): Promise<void> {
    const run = chain.then(drain);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    async submit(item: T): Promise<OwnerCaptureOutcome> {
      if (waiting().length === 0) {
        try {
          await options.capture(item);
          failures = 0;
          return "captured";
        } catch (error) {
          if (isPermanentRefusal(error)) {
            log.error("[discord-bot] owner capture refused for good; the turn is not admitted live", error);
            return "not_captured";
          }
          failures += 1;
          log.error("[discord-bot] owner capture failed; kept for retry", error);
          enqueue(item);
          scheduleRetry();
          return "not_captured";
        }
      }
      // Earlier captures are still waiting: this one queues behind them so the order holds.
      enqueue(item);
      void flush();
      return "not_captured";
    },
    flush,
    pending: () => waiting().length,
    onDrained(listener) {
      drained = listener;
    },
  };
}
