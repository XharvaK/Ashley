import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { AppError } from "../../errors.js";
import type { ChatMessage } from "../model-routing/types.js";
import type { CognitiveDispatchOptions } from "../../mistral-client.js";
import { bucketForRoute, routeBinding } from "../model-routing/registry.js";
import type { RouteId } from "../model-routing/types.js";
import type { TurnContext } from "../context-composer.js";
import type { Decision } from "../types.js";
import type { MemoryMessage } from "../memory/threads.js";
import {
  expressSpeak,
  type RenderedOutput,
} from "./expression.js";
import type { ExpressionComplete } from "./expression-fallback.js";
import { logDecision } from "../agency/log.js";
import { mapMistralError } from "../model-routing/adapters/mistral-adapter.js";

type SavedEnv = {
  enabled: boolean;
  kinds: string[];
  recentTurns: number;
};

function saveEnv(): SavedEnv {
  return {
    enabled: env.expressionFallbackEnabled,
    kinds: [...env.mistralOnlyKinds],
    recentTurns: env.expressionFallbackRecentTurns,
  };
}

function restoreEnv(saved: SavedEnv) {
  env.expressionFallbackEnabled = saved.enabled;
  env.mistralOnlyKinds = [...saved.kinds];
  (env as { expressionFallbackRecentTurns: number }).expressionFallbackRecentTurns =
    saved.recentTurns;
}

function baseDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    trigger: "reactive",
    kind: "speak",
    motivationIds: [1],
    score: 100,
    reason: "test-reason",
    objective: undefined,
    evidenceRefs: [],
    uncertainty: 0.1,
    urgency: 0.1,
    thoughtSource: "deterministic",
    thoughtError: null,
    affectLicense: {
      permitted: false,
      valence: 0,
      activation: 0,
      openness: 0,
      tension: 0,
      reason: "none",
    },
    cognitiveAllocation: { shouldSpeak: true, effort: "medium", completion: "complete" },
    authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
    ...overrides,
  };
}

const SYSTEMPROMPT = "SYSTEMPROMPT_FULL_CONTENT";
const MEMORYBLOCK = "MEMORYBLOCK_FULL_CONTENT";
const DECISIONPROMPT = "DECISION_PROMPT_FULL_CONTENT";
const USER_MARKER = "USER_MESSAGE_CONTENT";

function makeTurn(
  overrides: Partial<
    Pick<
      TurnContext,
      "systemPrompt" | "memoryBlock" | "decisionPrompt" | "hotMessages"
    >
  > = {},
): TurnContext {
  return {
    threadId: "t1",
    hotMessages: overrides.hotMessages ?? [],
    facts: [],
    memoryBlock: overrides.memoryBlock ?? MEMORYBLOCK,
    systemPrompt: overrides.systemPrompt ?? SYSTEMPROMPT,
    decisionPrompt: overrides.decisionPrompt ?? DECISIONPROMPT,
  };
}

type Call = { messages: ChatMessage[]; options: CognitiveDispatchOptions };
type Fake = { calls: Call[]; fn: ExpressionComplete };

function makeFake(opts: {
  primaryFail?: boolean;
  primaryError?: AppError;
  fallbackFail?: boolean;
  fallbackText?: string;
}): Fake {
  const calls: Call[] = [];
  const fn: ExpressionComplete = vi.fn(async (messages, options) => {
    calls.push({ messages, options });
    if (options?.route === "ashley_expression" && opts.primaryError) {
      throw opts.primaryError;
    }
    if (opts.primaryFail && options?.route === "ashley_expression") {
      throw new AppError("provider_unavailable", "provider", 503);
    }
    if (opts.fallbackFail && options?.route === "ashley_expression_fallback") {
      throw new AppError("provider_unavailable", "provider", 503);
    }
    return {
      text: opts.fallbackText ?? "fallback reply",
      model: options?.model ?? "model",
    };
  });
  return { calls, fn };
}

describe("expression fallback (Wave 3)", () => {
  let db: DatabaseSync;
  let saved: SavedEnv;

  afterEach(() => {
    restoreEnv(saved);
  });

  function setup() {
    saved = saveEnv();
    env.expressionFallbackEnabled = true;
    env.mistralOnlyKinds = [];
    (env as { expressionFallbackRecentTurns: number }).expressionFallbackRecentTurns = 6;
    db = openNuclearDb(new DatabaseSync(":memory:"));
  }

  it("dispatches the primary Mistral request first and only falls back on a recovered failure", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const turn = makeTurn();
    const decision = baseDecision();

    const result = await expressSpeak(
      turn,
      decision,
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );

    expect(fake.calls.length).toBe(2);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(fake.calls[1].options?.route).toBe("ashley_expression_fallback");
    expect(fake.calls[0].options?.attentionDb).toBe(db);
    expect(fake.calls[1].options?.attentionDb).toBe(db);
    expect(fake.calls[0].options?.logicalRole).toBe("expression");
    expect(fake.calls[1].options?.logicalRole).toBe("expression");
    expect(fake.calls[0].options?.modelFallbackChain).toMatchObject({
      invocationOrdinal: 1,
      fallbackFromInvocationId: null,
      fallbackClass: "none",
    });
    expect(fake.calls[1].options?.modelFallbackChain).toMatchObject({
      invocationOrdinal: 2,
      fallbackClass: "model_substitution",
    });
    expect(fake.calls[1].options?.modelFallbackChain?.chainId).toBe(
      fake.calls[0].options?.modelFallbackChain?.chainId,
    );
    const fallbackBinding = routeBinding("ashley_expression_fallback" as RouteId);
    expect(result.model).toBe(fallbackBinding.configuredModelId);
  });

  it("primary success never dispatches the fallback hop", async () => {
    setup();
    const fake = makeFake({ fallbackText: "should not be used" });
    const result = await expressSpeak(
      makeTurn(),
      baseDecision(),
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(fake.calls[0].options?.attentionDb).toBe(db);
    expect(result.model).toBe("model");
  });

  it("T2 primary complete hop receives the same attentionDb expressSpeak was given", async () => {
    setup();
    const fake = makeFake({ fallbackText: "primary" });
    await expressSpeak(
      makeTurn(),
      baseDecision(),
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.options?.attentionDb).toBe(db);
  });

  it("T3 fallback complete hop receives the same attentionDb as the primary hop", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    await expressSpeak(
      makeTurn(),
      baseDecision(),
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.options?.attentionDb).toBe(db);
    expect(fake.calls[1]!.options?.attentionDb).toBe(db);
    expect(fake.calls[0]!.options?.attentionDb).toBe(fake.calls[1]!.options?.attentionDb);
  });

  it("quota exhaustion (HTTP 402) falls back once to the Groq route and records the policy", async () => {
    setup();
    const fake = makeFake({
      primaryError: new AppError("quota_exhausted", "quota", 402),
    });
    const decision = baseDecision();
    const decisionId = logDecision(db, "doc", "discord", "reactive", decision);
    const result = await expressSpeak(
      makeTurn(),
      decision,
      USER_MARKER,
      "discord",
      { attentionDb: db, decisionId },
      fake.fn,
    );

    expect(fake.calls.length).toBe(2);
    expect(fake.calls[1].options?.route).toBe("ashley_expression_fallback");
    expect(fake.calls[1].options?.model).toBe("qwen/qwen3.6-27b");
    expect(fake.calls[1].options?.reasoningEffort).toBe("none");
    expect(result.model).toBe("qwen/qwen3.6-27b");
    const row = db
      .prepare(
        "SELECT expression_fallback_policy FROM decision_log WHERE id = ?",
      )
      .get(decisionId) as { expression_fallback_policy: string | null };
    expect(row.expression_fallback_policy).toBe("minimal_identity_allowed");
  });

  it("rate limiting (HTTP 429) falls back once", async () => {
    setup();
    const fake = makeFake({
      primaryError: new AppError("rate_limited", "limited", 429, 30),
    });
    const result = await expressSpeak(
      makeTurn(),
      baseDecision(),
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );

    expect(fake.calls.length).toBe(2);
    expect(fake.calls[1].options?.route).toBe("ashley_expression_fallback");
    expect(result.model).not.toBe("offline");
  });

  it("owner-marked mistral_only kinds never fall back and record the policy", async () => {
    setup();
    env.mistralOnlyKinds = ["speak"];
    const fake = makeFake({ primaryFail: true });
    const decision = baseDecision({ kind: "speak" });
    const decisionId = logDecision(db, "doc", "discord", "reactive", decision);
    const result = await expressSpeak(
      makeTurn(),
      decision,
      USER_MARKER,
      "discord",
      { attentionDb: db, decisionId },
      fake.fn,
    );

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(result.model).toBe("offline");
    const row = db
      .prepare(
        "SELECT expression_fallback_policy FROM decision_log WHERE id = ?",
      )
      .get(decisionId) as { expression_fallback_policy: string | null };
    expect(row.expression_fallback_policy).toBe("mistral_only");
  });

  it("turn-deadline aborts (AbortError) are not eligible for fallback", async () => {
    setup();
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const fake = makeFake({ primaryError: abort as AppError });
    const result = await expressSpeak(
      makeTurn(),
      baseDecision(),
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(result.model).toBe("offline");
  });

  it("fallback receives a minimal profile that excludes the full Expression context", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const turn = makeTurn();
    const result = await expressSpeak(turn, baseDecision(), USER_MARKER, "discord", { attentionDb: db }, fake.fn);

    expect(fake.calls.length).toBe(2);
    const fallbackSystem = fake.calls[1].messages[0];
    expect(fallbackSystem.content).toContain("Honest and grounded");
    expect(fallbackSystem.content).toContain("Minimal identity profile: stable values and principles only");
    expect(fallbackSystem.content).toContain("Mind state (headline only)");
    expect(fallbackSystem.content).not.toContain(SYSTEMPROMPT);
    expect(fallbackSystem.content).not.toContain(MEMORYBLOCK);
    expect(fallbackSystem.content).not.toContain(DECISIONPROMPT);
    expect(result).toBeDefined();
  });

  it("primary dispatch uses the full system prompt (no regression)", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const turn = makeTurn();
    const result = await expressSpeak(turn, baseDecision(), USER_MARKER, "discord", { attentionDb: db }, fake.fn);

    const primarySystem = fake.calls[0].messages[0];
    expect(primarySystem.content).toContain(SYSTEMPROMPT);
    expect(result.model).not.toBe("offline");
  });

  it("never falls back when decision evidence is identity (minimal profile excludes full identity)", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const turn = makeTurn();
    const result = await expressSpeak(
      turn,
      baseDecision({ evidenceRefs: [{ type: "identity", id: 1 }] }),
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(result.model).toBe("offline");
  });

  it("never falls back when a reading license is active", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const turn = makeTurn();
    const result = await expressSpeak(
      turn,
      baseDecision({
        authorizedClaims: { readingRecordIds: [101], readingTitles: ["t"], readingClaims: [] },
      }),
      USER_MARKER,
      "discord",
      { attentionDb: db },
      fake.fn,
    );

    expect(fake.calls.length).toBe(1);
    expect(result.model).toBe("offline");
  });

  it("never falls back when the user message contains a secret", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const result = await expressSpeak(
      turnWithSecret(),
      baseDecision(),
      "my api_key: abc123 please help",
      "discord",
      { attentionDb: db },
      fake.fn,
    );

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(result.model).toBe("offline");
  });

  it("never falls back when the memory block contains a secret", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const turn = makeTurn({ memoryBlock: "user secret=should_not_leave" });
    const result = await expressSpeak(turn, baseDecision(), USER_MARKER, "discord", { attentionDb: db }, fake.fn);

    expect(fake.calls.length).toBe(1);
    expect(result.model).toBe("offline");
  });

  it("never falls back when the fallback route is disabled by owner gate", async () => {
    setup();
    env.expressionFallbackEnabled = false;
    const fake = makeFake({ primaryFail: true });
    const result = await expressSpeak(makeTurn(), baseDecision(), USER_MARKER, "discord", { attentionDb: db }, fake.fn);

    expect(fake.calls.length).toBe(1);
    expect(result.model).toBe("offline");
  });

  it("non-interactive/urgent lanes never trigger a visible fallback", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const result = await expressSpeak(makeTurn(), baseDecision(), USER_MARKER, "discord", {
      attentionDb: db,
      lane: "exchange_cognition" as never,
    }, fake.fn);

    expect(fake.calls.length).toBe(1);
    expect(result.model).toBe("offline");
  });

  it("an expired deadline prevents fallback without suppressing the primary attempt", async () => {
    setup();
    const fake = makeFake({ primaryFail: true });
    const result = await expressSpeak(makeTurn(), baseDecision(), USER_MARKER, "discord", {
      attentionDb: db,
      deadlineAtMs: Date.now() - 5,
    }, fake.fn);

    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(result.model).toBe("offline");
  });

  it("fallback failure does not produce a third dispatch hop", async () => {
    setup();
    const fake = makeFake({ primaryFail: true, fallbackFail: true });
    const result = await expressSpeak(makeTurn(), baseDecision(), USER_MARKER, "discord", { attentionDb: db }, fake.fn);

    expect(fake.calls.length).toBe(2);
    expect(fake.calls[0].options?.route).toBe("ashley_expression");
    expect(fake.calls[1].options?.route).toBe("ashley_expression_fallback");
    expect(result.model).toBe("offline");
  });

  it("fallback history is bounded to a single turn slice on the fallback hop", async () => {
    setup();
    (env as { expressionFallbackRecentTurns: number }).expressionFallbackRecentTurns = 4;
    const fake = makeFake({ primaryFail: true });
    const hot: MemoryMessage[] = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      threadId: "t1",
      ownerId: "doc",
      role: i % 2 === 0 ? "user" : "assistant",
      text: `hist-${i}`,
      channel: "discord",
      createdAt: new Date(0).toISOString(),
    }));
    const turn = makeTurn({ hotMessages: hot });
    const result = await expressSpeak(turn, baseDecision(), USER_MARKER, "discord", { attentionDb: db }, fake.fn);

    expect(fake.calls.length).toBe(2);
    const primaryHistory = fake.calls[0].messages.slice(1, -1);
    expect(primaryHistory.length).toBe(8);
    const fallbackHistory = fake.calls[1].messages.slice(1, -1);
    expect(fallbackHistory.length).toBe(4);
    expect(result.model).toBe(routeBinding("ashley_expression_fallback" as RouteId).configuredModelId);
  });

  it("fallback result is honesty-finalized and rendered before return", async () => {
    setup();
    const fake = makeFake({ primaryFail: true, fallbackText: "hello world" });
    const result = await expressSpeak(makeTurn(), baseDecision(), USER_MARKER, "discord", { attentionDb: db }, fake.fn);

    const fallbackBinding = routeBinding("ashley_expression_fallback" as RouteId);
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.readingLicensed).toBe(false);
    expect(result.model).toBe(fallbackBinding.configuredModelId);
  });

  it("fallback route metadata is groq-managed with the correct quota bucket", () => {
    const route = "ashley_expression_fallback" as RouteId;
    const binding = routeBinding(route);
    expect(bucketForRoute(route)).toBe(`${binding.provider}:${binding.configuredModelId}`);
    expect(binding.provider).toBe("groq");
    expect(binding.route).toBe("ashley_expression_fallback");
  });
});

describe("Mistral failure classification (reason categories)", () => {
  it("HTTP 402 maps to quota_exhausted", () => {
    const mapped = mapMistralError(
      Object.assign(new Error("quota"), { statusCode: 402 }),
    );
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe("quota_exhausted");
    expect(mapped.httpStatus).toBe(402);
  });

  it("quota/payment wording without a status still maps to quota_exhausted", () => {
    const mapped = mapMistralError(
      new Error("Payment Required: subscription quota exceeded"),
    );
    expect(mapped.code).toBe("quota_exhausted");
  });

  it("HTTP 429 still maps to rate_limited (regression)", () => {
    const mapped = mapMistralError(
      Object.assign(new Error("limited"), { statusCode: 429 }),
    );
    expect(mapped.code).toBe("rate_limited");
  });

  it("HTTP 503 still maps to mistral_unavailable (regression)", () => {
    const mapped = mapMistralError(
      Object.assign(new Error("down"), { statusCode: 503 }),
    );
    expect(mapped.code).toBe("mistral_unavailable");
  });
});

function turnWithSecret(): TurnContext {
  return {
    threadId: "t1",
    hotMessages: [],
    facts: [],
    memoryBlock: MEMORYBLOCK,
    systemPrompt: SYSTEMPROMPT,
    decisionPrompt: DECISIONPROMPT,
  };
}
