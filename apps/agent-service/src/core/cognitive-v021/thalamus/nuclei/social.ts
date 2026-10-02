// Social timing wraps existing eligibility and fuse facts; Owner ingress remains outside this nucleus.
import { proposal, unit, type Fact } from "./facts.js";
export type SocialFacts = Fact & { coalesceKey: string; isOwner: boolean; eligible: boolean; fuseAvailable: boolean;
  relationshipBasis: number; addressedToHer: number; novelty: number };
export function social(input: SocialFacts) {
  if (input.isOwner || !input.eligible || !input.fuseAvailable) return null;
  return proposal(input, "social", input.coalesceKey,
    unit(input.relationshipBasis) * unit(input.addressedToHer) * unit(input.novelty), "conversation");
}
