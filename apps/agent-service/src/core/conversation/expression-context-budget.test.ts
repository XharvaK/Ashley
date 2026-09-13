import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { openNuclearDb } from "../db.js";
import type { TurnContext } from "../context-composer.js";
import type { Decision } from "../types.js";
import { expressSpeak } from "./expression.js";

const OWNER_ID = "c2-expression-owner";
const originalFallbackEnabled = env.expressionFallbackEnabled;

afterEach(() => {
  env.expressionFallbackEnabled = originalFallbackEnabled;
});

const turn: TurnContext = {
  threadId: "thread-1",
  hotMessages: [],
  facts: [],
  memoryBlock: "",
  systemPrompt: "Constitutional system instructions.",
  decisionPrompt: "Answer the owner truthfully.",
};

const decision: Decision = {
  trigger: "reactive",
  kind: "speak",
  motivationIds: [1],
  score: 1,
  reason: "test",
  objective: "answer",
  evidenceRefs: [{ type: "message", id: 1 }],
  uncertainty: 0,
  urgency: 0,
  thoughtSource: "deterministic",
  thoughtError: null,
  affectLicense: {
    permitted: false,
    valence: 0,
    activation: 0,
    openness: 0,
    tension: 0,
    reason: "test",
  },
  cognitiveAllocation: { shouldSpeak: true, effort: "low", completion: "complete" },
  authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
};

describe("C2 Expression enrollment", () => {
  it("uses one bounded primary projection and keeps the current message once", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const calls: Array<{ messages: Array<{ role: string; content: string }>; options: Record<string, unknown> }> = [];
      const complete = async (
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        options: Record<string, unknown>,
      ): Promise<{ text: string; model: string }> => {
        calls.push({ messages, options });
        return { text: "bounded answer", model: "test" };
      };
      const result = await expressSpeak(
        turn,
        decision,
        "What is current?",
        "discord",
        {
          ownerId: OWNER_ID,
          attentionDb: db,
          contextBudgetMode: "dark_apply",
          contextBudgetMaxUtf8Bytes: 20_000,
          contextBudgetSectionBudgets: {
            safety: 10_000,
            history: 2_000,
            current_message: 8_000,
          },
        },
        complete,
      );
      expect(result.text).toContain("bounded answer");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.options.contextProjection).toMatchObject({
        purpose: "expression",
      });
      const contents = calls[0]!.messages.map((message) => message.content);
      expect(contents.filter((content) => content.includes("What is current?")).length).toBe(1);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM context_allocation_receipts WHERE purpose = 'expression'",
      ).get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("records Expression fallback as a distinct bounded request", async () => {
    env.expressionFallbackEnabled = true;
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const calls: Array<{ route?: string; purpose?: string; projection?: { purpose: string } }> = [];
      const complete = async (
        _messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
        options: import("../../mistral-client.js").CognitiveDispatchOptions,
      ): Promise<{ text: string; model: string }> => {
        calls.push({
          route: options.route,
          purpose: options.contextProjection?.purpose,
          projection: options.contextProjection,
        });
        if (options.route === "ashley_expression") {
          throw new AppError("provider_unavailable", "fixture", 503);
        }
        return { text: "fallback answer", model: "fallback" };
      };
      await expressSpeak(turn, decision, "fallback question", "discord", {
        ownerId: OWNER_ID,
        attentionDb: db,
        contextBudgetMode: "dark_apply",
        contextBudgetMaxUtf8Bytes: 20_000,
        contextBudgetSectionBudgets: { safety: 10_000, current_message: 8_000 },
      }, complete);
      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.route)).toEqual([
        "ashley_expression",
        "ashley_expression_fallback",
      ]);
      expect(calls.map((call) => call.purpose)).toEqual(["expression", "expression_fallback"]);
      expect(db.prepare(
        `SELECT purpose, COUNT(*) AS count FROM context_allocation_receipts
         GROUP BY purpose ORDER BY purpose`,
      ).all()).toEqual([
        { purpose: "expression", count: 1 },
        { purpose: "expression_fallback", count: 1 },
      ]);
    } finally {
      db.close();
    }
  });
});
