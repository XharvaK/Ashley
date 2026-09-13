import { describe, expect, it } from "vitest";
import { adaptExpression, assertNoForbiddenEvidence, expressionPromptHash } from "./expression-adapter.js";

const input = {
  draft: "I selected HY4.",
  commitments: {
    epistemic: [],
    operational: [],
    conversational: ["answer" as const],
    stance: { warmth: "medium" as const, humorAllowed: false, disagreement: false, uncertaintyDisplay: true },
  },
  stance: { warmth: "medium" as const, humorAllowed: false, disagreement: false, uncertaintyDisplay: true },
  directives: ["concise"],
  profile: "plain",
  medium: "discord" as const,
};

describe("v0.2.1 starved Expression adapter", () => {
  it("does not accept transcript or memory context", async () => {
    expect(() => assertNoForbiddenEvidence("owner transcript hotMessages mem_facts perceptionExpressionParts Workspace")).toThrow();
    const calls: string[] = [];
    const text = await adaptExpression(input, {
      complete: async (prompt) => {
        calls.push(prompt);
        return "I selected HY4.";
      },
    });
    expect(text).toBe("I selected HY4.");
    expect(calls[0]).not.toMatch(/hotMessages|mem_facts|perceptionExpressionParts|Workspace|transcript/i);
  });

  it("hashes only the starved prompt fields", () => {
    const poisoned = { ...input, transcript: "owner secret transcript" } as typeof input & { transcript: string };
    expect(expressionPromptHash(input)).toBe(expressionPromptHash(poisoned));
  });
});
