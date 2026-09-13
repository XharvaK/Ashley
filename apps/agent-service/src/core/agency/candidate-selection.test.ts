import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { upsertFact } from "../memory/facts.js";
import { createQuestion } from "../state/questions.js";
import type { Motivation } from "../types.js";
import { selectMotivationCandidates } from "./candidate-selection.js";

const OWNER_ID = "doc";

function motivation(
  id: number,
  kind: Motivation["kind"],
  score: number,
  summary: string,
  refType: string,
  refId: number,
): Motivation {
  return {
    id,
    ownerId: OWNER_ID,
    kind,
    score,
    summary,
    refType,
    refId,
  };
}

describe("bounded motivation candidate selection", () => {
  it("caps producer dominance, removes duplicate refs, and preserves silence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const questions = Array.from({ length: 6 }, (_, index) =>
        createQuestion(db, OWNER_ID, "about_doc", `Question ${index}`, 0.9),
      );
      const facts = Array.from({ length: 3 }, (_, index) =>
        upsertFact(db, {
          ownerId: OWNER_ID,
          category: "ongoing",
          key: `fact-${index}`,
          value: `Fact ${index}`,
          importance: 80,
        }),
      );
      const motivations: Motivation[] = [
        ...questions.map((id, index) =>
          motivation(100 + index, "question", 90 - index, `Question ${index}`, "question", id),
        ),
        ...facts.map((id, index) =>
          motivation(200 + index, "fact", 70 - index, `Fact ${index}`, "fact", id),
        ),
        motivation(999, "question", 95, "Question 0 duplicate", "question", questions[0]!),
        {
          id: 1000,
          ownerId: OWNER_ID,
          kind: "silence_ok",
          score: 8,
          summary: "Silence is always available.",
        },
      ];

      const selected = selectMotivationCandidates(
        db,
        OWNER_ID,
        "proactive",
        motivations,
      );
      expect(selected.length).toBeLessThanOrEqual(8);
      expect(selected.filter((item) => item.refType === "question")).toHaveLength(3);
      expect(selected.filter((item) => item.refType === "fact")).toHaveLength(3);
      expect(selected.some((item) => item.kind === "silence_ok")).toBe(true);
      const refs = selected
        .filter((item) => item.refType && item.refId != null)
        .map((item) => `${item.refType}:${item.refId}`);
      expect(new Set(refs).size).toBe(refs.length);
    } finally {
      db.close();
    }
  });
});
