// Boredom uses a supplied idle reference and Thought-authored mood/resting facts, without a new clock.
import { MOOD_BASELINE } from "../../growth/mood.js";
import { THALAMUS_PARAMETERS as P } from "../parameters.js";
import { proposal, nonnegative, unit, type Fact } from "./facts.js";
export type BoredomFacts = Fact & { idleSinceMs: number | null; energy: number; openness: number; agendaPressure: number; resting: boolean };
export function boredom(input: BoredomFacts, nowMs: number) {
  if (input.idleSinceMs === null) return null;
  const idle = nonnegative(nowMs - input.idleSinceMs);
  if (!idle) return null;
  const score = P.theta0.default * idle / P.boredomRiseMs.default
    * unit(input.energy) / MOOD_BASELINE.energy * unit(input.openness) / MOOD_BASELINE.openness
    * (1 + unit(input.agendaPressure)) / (input.resting ? P.restingRiseMultiplier.default : 1);
  return proposal(input, "boredom", "own-time", score, "own_time");
}
