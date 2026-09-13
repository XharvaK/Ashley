import { describe, expect, it } from "vitest";
import { adaptPerception } from "./adapter.js";

describe("v0.2.1 perception adapter", () => {
  it("normalizes observations for the active cycle before Thought", async () => {
    const observations = await adaptPerception({
      cycleId: "cycle-1",
      generation: 1,
      ownerMessage: "hello",
      runPerception: async () => [{
        observationId: "observation-1",
        cycleId: "wrong-cycle",
        generation: 99,
        derived: false,
        replaySafe: true,
        modality: "text",
        payload: { text: "raw" },
        provenance: "test",
        dataClassification: "ordinary",
        secretOmitted: false,
      }],
    });
    expect(observations).toMatchObject([{ observationId: "observation-1", cycleId: "cycle-1", generation: 1, derived: false }]);
  });
});
