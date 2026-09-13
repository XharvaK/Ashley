import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { createGroqAdapter } from "../model-routing/adapters/groq-adapter.js";
import { createNimAdapter } from "../model-routing/adapters/nim-adapter.js";
import { selectAndRender } from "./render.js";

const originalGroqKey = env.groqApiKey;
const originalNimKey = env.nimApiKey;

afterEach(() => {
  env.groqApiKey = originalGroqKey;
  env.nimApiKey = originalNimKey;
  vi.restoreAllMocks();
});

function response() {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }),
  };
}

function allocation(routeId: "thought" | "ashley_expression_fallback") {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  const result = selectAndRender(db, {
    requestId: `provider-${routeId}`,
    ownerId: "provider-bound-owner",
    purpose: routeId === "thought" ? "thought" : "expression_fallback",
    routeId,
    surface: "private",
    capabilityMode: "dark_apply",
    inputs: [{
      ref: { type: "message", id: 1 },
      sourceType: "message",
      sourceId: 1,
      section: "safety",
      content: "user: [memory_context_role=current_source_evidence; assertion_ids=1; correction_ids=none] labeled",
      classification: "never_public",
      influenceEligible: true,
      retrievalEligible: true,
      required: true,
      memoryContextRole: "current_source_evidence",
      messageRole: "user",
    }],
  });
  return { db, result };
}

describe("C2 provider-bound role preservation", () => {
  it("passes the bounded C2 messages to Groq without changing role labels", async () => {
    env.groqApiKey = "fixture";
    let body: Record<string, unknown> | undefined;
    const adapter = createGroqAdapter(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return response();
    });
    const { db, result } = allocation("ashley_expression_fallback");
    try {
      await adapter.dispatch({
        messages: result.messages,
        modelId: "qwen/qwen3.6-27b",
        options: {},
      });
      expect(body?.messages).toEqual(result.messages);
      expect(JSON.stringify(body)).toContain("memory_context_role=current_source_evidence");
    } finally {
      db.close();
    }
  });

  it("passes the same bounded C2 messages to NIM without provider-native reconstruction", async () => {
    env.nimApiKey = "fixture";
    let body: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return response();
    });
    const { db, result } = allocation("thought");
    try {
      await adapter.dispatch({
        messages: result.messages,
        modelId: "openai/gpt-oss-20b",
        options: {},
      });
      expect(body?.messages).toEqual(result.messages);
      expect(result.projection.parts.every((part) => part.kind === "text")).toBe(true);
    } finally {
      db.close();
    }
  });
});
