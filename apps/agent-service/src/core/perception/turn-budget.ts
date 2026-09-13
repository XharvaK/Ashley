import { env } from "../../env.js";
import { MIN_FETCH_MS } from "./types.js";

const CURIOSITY_MAX_MS = 20_000;

export function remainingMs(deadlineAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, deadlineAtMs - nowMs);
}

export function usableFetchMs(
  deadlineAtMs: number,
  nowMs = Date.now(),
): number {
  const dispatchSafetyMs = env.perceptionDispatchSafetyMs;
  const thoughtRemaining = remainingMs(deadlineAtMs, nowMs);
  return Math.min(
    CURIOSITY_MAX_MS,
    Math.max(0, thoughtRemaining - dispatchSafetyMs),
  );
}

export function canStartFetch(
  deadlineAtMs: number,
  nowMs = Date.now(),
): boolean {
  return (
    nowMs < deadlineAtMs &&
    usableFetchMs(deadlineAtMs, nowMs) >= MIN_FETCH_MS
  );
}
