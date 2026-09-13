import { config } from "../config.js";
import {
  initiativeStatus,
  pauseProactiveRemote,
  resumeProactiveRemote,
  tickCognitiveIdle,
} from "../agent-client.js";

let cognitiveIdleTimer: ReturnType<typeof setInterval> | null = null;
let cognitiveIdleRunning = false;

export type CognitiveIdleSchedulerCycleResult = {
  outcome: "tick" | "error";
  result?: Awaited<ReturnType<typeof tickCognitiveIdle>>;
};

/** One private cognition tick. It never sends a Discord message directly. */
export async function runCognitiveIdleSchedulerCycle(
  tick: typeof tickCognitiveIdle = tickCognitiveIdle,
): Promise<CognitiveIdleSchedulerCycleResult> {
  try {
    return { outcome: "tick", result: await tick() };
  } catch {
    return { outcome: "error" };
  }
}

/** Start the current V0.2.1 idle wake scheduler. */
export function startCognitiveIdleScheduler(): void {
  if (cognitiveIdleTimer) return;
  const intervalMs = config.proactiveCheckIntervalMin * 60 * 1000;
  const tick = async (): Promise<void> => {
    if (cognitiveIdleRunning) return;
    cognitiveIdleRunning = true;
    try {
      const cycle = await runCognitiveIdleSchedulerCycle();
      if (cycle.outcome === "tick" && cycle.result?.reason) {
        console.log(`[discord-bot] cognitive idle: ${cycle.result.reason}`);
      } else if (cycle.outcome === "error") {
        console.warn("[discord-bot] cognitive idle tick failed");
      }
    } finally {
      cognitiveIdleRunning = false;
    }
  };
  console.log(`[discord-bot] cognitive idle scheduler every ~${config.proactiveCheckIntervalMin}m`);
  void tick();
  cognitiveIdleTimer = setInterval(() => { void tick(); }, intervalMs);
}

export function stopProactiveScheduler(): void {
  if (cognitiveIdleTimer) clearInterval(cognitiveIdleTimer);
  cognitiveIdleTimer = null;
  cognitiveIdleRunning = false;
}

export async function pauseProactive(): Promise<void> {
  await pauseProactiveRemote();
}

export async function resumeProactive(): Promise<void> {
  await resumeProactiveRemote();
}

export async function getProactiveStatus() {
  return initiativeStatus();
}
