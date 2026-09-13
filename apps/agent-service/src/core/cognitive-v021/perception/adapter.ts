import {
  type CycleId,
  type Generation,
  type Observation,
} from "../types.js";

export type PerceptionAdapterInput = {
  cycleId: CycleId;
  generation: Generation;
  ownerMessage: string;
  runPerception: (input: {
    cycleId: CycleId;
    generation: Generation;
    ownerMessage: string;
  }) => Promise<Observation[]>;
};

/**
 * Perception is an upstream read. It is normalized into the active cycle
 * identity before Thought sees it; this adapter has no semantic publication
 * or execution side effects.
 */
export async function adaptPerception(
  input: PerceptionAdapterInput,
): Promise<Observation[]> {
  const observations = await input.runPerception({
    cycleId: input.cycleId,
    generation: input.generation,
    ownerMessage: input.ownerMessage,
  });
  return observations.map((observation) => ({
    ...observation,
    cycleId: input.cycleId,
    generation: input.generation,
    derived: observation.derived === true,
    replaySafe: observation.replaySafe === true,
    provenance: observation.provenance || "perception",
    dataClassification: observation.dataClassification ?? "never_public",
    secretOmitted: observation.secretOmitted === true,
  }));
}

export const runPerceptionBeforeThought = adaptPerception;
