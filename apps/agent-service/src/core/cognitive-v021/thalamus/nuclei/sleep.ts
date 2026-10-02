// Sleep pressure comes from work since NIGHT; a supplied local quiet hour only shapes its preference.
import { THALAMUS_PARAMETERS as P } from "../parameters.js";
import { proposal, nonnegative, type Fact } from "./facts.js";
export type SleepFacts = Fact & { episodes: number; memories: number; rows: number; openRevisions: number;
  expectations: number; quietHour: number | null; currentLocalHour: number | null };
export function sleep(input: SleepFacts) {
  const work = nonnegative(input.episodes) * P.episodeWorkWeight.default + nonnegative(input.memories) * P.memoryWorkWeight.default
    + nonnegative(input.rows) * P.rowWorkWeight.default + nonnegative(input.openRevisions) * P.revisionWorkWeight.default
    + nonnegative(input.expectations) * P.expectationWorkWeight.default;
  if (!work) return null;
  const knownHour = input.quietHour !== null && input.currentLocalHour !== null
    && Number.isFinite(input.quietHour) && Number.isFinite(input.currentLocalHour);
  const preference = knownHour ? 1 + P.sleepQuietHourAmplitude.default * Math.cos(
    2 * Math.PI * (input.currentLocalHour! - input.quietHour!) / P.hoursPerDay.default) : 1;
  return proposal(input, "sleep", "sleep-work", work / P.sleepPressureCeiling.default * preference, "night",
    work > P.sleepPressureCeiling.default ? "ALWAYS_THROUGH" : "PRESSURE");
}
