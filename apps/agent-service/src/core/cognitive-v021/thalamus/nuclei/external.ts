// External salience combines existing subscription and interest facts; only eligible apply-mode influence changes it.
import { THALAMUS_PARAMETERS as P } from "../parameters.js";
import type { InfluenceMode } from "../../influences/contract-state.js";
import { proposal, unit, type Fact } from "./facts.js";
export type ExternalFacts = Fact & { subscriptionId: string; subscriptionCurrent: boolean;
  novelty: number; interestMatch: number; influenceEligible: boolean };
export function external(input: ExternalFacts, mode: InfluenceMode) {
  if (!input.subscriptionCurrent) return null;
  const gain = mode === "apply" && input.influenceEligible ? P.curiosityInfluenceGain.default : 1;
  return proposal(input, "external", input.subscriptionId, unit(input.novelty) * unit(input.interestMatch) * gain, "own_time");
}
