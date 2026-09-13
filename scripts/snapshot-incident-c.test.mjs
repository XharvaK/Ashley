import assert from "node:assert/strict";
import test from "node:test";
import { generateSyntheticIncidentC } from "./snapshot-incident-c.mjs";

test("Incident C synthetic generation is deterministic and preserves length", () => {
  const snapshot = {
    triggerText: "I need to sleep soon - let's talk tomorrow, ok?",
    matched: [
      {
        assertionKey: "memory:one",
        statement: "I need to sleep soon and talk tomorrow.",
        memoryKind: "owner_world_claim",
        dimensions: { time: "current" },
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
        matchedTerms: ["sleep", "soon", "talk", "tomorrow"],
      },
      {
        assertionKey: "memory:two",
        statement: "A private credential-shaped value",
        memoryKind: "owner_world_claim",
        dimensions: { time: "current" },
        dataClassification: "secret",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
        matchedTerms: ["private"],
      },
    ],
  };

  const first = generateSyntheticIncidentC(snapshot);
  const second = generateSyntheticIncidentC(snapshot);

  assert.deepEqual(first, second);
  assert.equal(first.items.length, 1);
  assert.equal(first.labels[first.items[0].assertionKey], "relevant");
  assert.equal(first.items[0].syntheticLength, first.items[0].originalLength);
  assert.equal(first.fidelity.excludedSecretCount, 1);
});
