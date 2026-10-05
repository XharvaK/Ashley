// The Domus helper's peripheral thalamus already chose what reaches Ashley; a delivered observation is due, never habituated twice.
import type { Candidate } from "../core.js";
import { proposal } from "./facts.js";
export type DomusPendingObservation = { observationId: string; receiptTimeMs: number; salience: number; alwaysThrough: boolean };
export type DomusPending = { attachment: string; observations: readonly DomusPendingObservation[] };
/** One candidate per armed attachment over its pending observations (oldest first). */
export function domus(pending: readonly DomusPending[]): Candidate[] {
  const result: Candidate[] = [];
  for (const item of pending) {
    if (!item.observations.length) continue;
    const newest = item.observations.at(-1)!;
    const salience = Math.max(...item.observations.map(observation => observation.salience));
    const candidate = proposal({ eventId: `domus:${newest.observationId}`, observedAtMs: newest.receiptTimeMs,
      refs: item.observations.map(observation => observation.observationId) }, "domus", `domus:${item.attachment}`,
      salience, "own_time", item.observations.some(observation => observation.alwaysThrough) ? "ALWAYS_THROUGH" : "PRESSURE");
    result.push({ ...candidate, deadlineMs: newest.receiptTimeMs });
  }
  return result;
}
