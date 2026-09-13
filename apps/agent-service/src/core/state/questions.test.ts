import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  buildQuestionsBlock,
  bumpPriority,
  createQuestion,
  listOpenQuestions,
  resolveQuestion,
  updateQuestionStatus,
} from "./questions.js";

describe("nuclear questions", () => {
  it("creates, prioritizes, updates, and resolves questions", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const id = createQuestion(db, {
      ownerId: "doc",
      subject: "about_doc",
      text: "what happened with the deployment?",
      priority: 0.8,
    });
    expect(listOpenQuestions(db, "doc")).toHaveLength(1);
    bumpPriority(db, id, 0.4);
    updateQuestionStatus(db, id, "pursuing");
    expect(buildQuestionsBlock(db, "doc")).toContain("deployment");
    resolveQuestion(db, id);
    expect(listOpenQuestions(db, "doc")).toHaveLength(0);
  });
});
