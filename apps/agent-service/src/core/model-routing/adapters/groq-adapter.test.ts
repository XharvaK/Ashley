import { describe, expect, it, afterEach, vi } from "vitest";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { createGroqAdapter, mapGroqError } from "./groq-adapter.js";
import type { ChatMessage } from "../types.js";
import type { StructuredOutputSchemaFingerprint } from "../../model-fabric/types.js";

const originalKey = env.groqApiKey;

afterEach(() => {
  env.groqApiKey = originalKey;
  vi.restoreAllMocks();
});

function fakeResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
  };
}

describe("groq-adapter fixtures", () => {
  const messages: ChatMessage[] = [
    { role: "user" as const, content: "hello" },
  ];

  it("maps a chat completion to a ProviderCompletion", async () => {
    env.groqApiKey = "test";
    const adapter = createGroqAdapter(async () =>
      fakeResponse({
        choices: [{ message: { content: "hi there" } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
        model: "llama-3-70b",
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "qwen/qwen3.6-27b",
      options: {},
    });
    expect(result.text).toBe("hi there");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2 });
    expect(result.providerModel).toBe("llama-3-70b");
  });

  it("maps prompt cache usage to cachedTokens", async () => {
    env.groqApiKey = "test";
    const adapter = createGroqAdapter(async () =>
      fakeResponse({
        choices: [{ message: { content: "hi there" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "qwen/qwen3.6-27b",
      options: {},
    });
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      cachedTokens: 4,
    });
  });

  it("does not report a cached token count for a non-numeric provider field", async () => {
    env.groqApiKey = "test";
    const adapter = createGroqAdapter(async () =>
      fakeResponse({
        choices: [{ message: { content: "hi there" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: "unknown" as never },
        },
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "qwen/qwen3.6-27b",
      options: {},
    });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2 });
  });

  it("extracts tool calls", async () => {
    env.groqApiKey = "test";
    const adapter = createGroqAdapter(async () =>
      fakeResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "summarize", arguments: '{"n":3}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "qwen/qwen3.6-27b",
      options: {},
    });
    expect(result.toolCalls).toEqual([
      { id: "call_1", function: { name: "summarize", arguments: '{"n":3}' } },
    ]);
  });

  it("serializes reasoning_effort in request body when specified", async () => {
    env.groqApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createGroqAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "qwen/qwen3.6-27b",
      options: { reasoningEffort: "none" },
    });
    expect(capturedBody?.reasoning_effort).toBe("none");
    expect(capturedBody?.model).toBe("qwen/qwen3.6-27b");
  });

  it("maps gpt-oss reasoning_effort none to low so Groq does not 400", async () => {
    env.groqApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createGroqAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-120b",
      options: {
        reasoningEffort: "none",
        responseFormat: "json_object",
        maxTokens: 1000,
      },
    });
    expect(capturedBody?.reasoning_effort).toBe("low");
    expect(capturedBody?.response_format).toEqual({ type: "json_object" });
    expect(capturedBody?.max_tokens).toBe(1000);
  });

  it("surfaces Groq 400 provider text instead of [object Object]", async () => {
    env.groqApiKey = "test";
    const adapter = createGroqAdapter(async () =>
      fakeResponse(
        {
          error: {
            message:
              "'none' is not a valid reasoning_effort for model openai/gpt-oss-120b",
          },
        },
        { status: 400 },
      ),
    );
    await expect(
      adapter.dispatch({
        messages,
        modelId: "openai/gpt-oss-120b",
        options: { reasoningEffort: "none" },
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
  });

  it("serializes json_object response_format when requested", async () => {
    env.groqApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createGroqAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-120b",
      options: { responseFormat: "json_object", reasoningEffort: "none" },
    });
    expect(capturedBody?.response_format).toEqual({ type: "json_object" });
  });

  it("uses the trusted compatibility binding for Thought schema requests", async () => {
    env.groqApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createGroqAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
      options: { responseFormat: "json_schema" },
      fabricStructuredOutput: {
        kind: "json_object_compatibility",
        contractId: "ashley.thought.step.v1",
        schemaId: "ashley.thought.step.v1.schema",
        schemaFingerprint: `sha256:${"a".repeat(64)}` as StructuredOutputSchemaFingerprint,
        bindingId: "compat_thought_groq_gpt_oss_20b_json_object_v1",
      },
    });
    expect(capturedBody?.response_format).toEqual({ type: "json_object" });
  });

  it("uses message.content only and ignores gpt-oss reasoning fields", async () => {
    env.groqApiKey = "test";
    const adapter = createGroqAdapter(async () =>
      fakeResponse({
        choices: [
          {
            finish_reason: "length",
            message: {
              content:
                '{"kind":"speak","operationalRequest":{"kind":"candidate_verification"',
              reasoning: "a".repeat(4000),
              reasoning_content: "hidden chain of thought that must not parse",
            },
          },
        ],
        usage: {
          prompt_tokens: 2293,
          completion_tokens: 1000,
          completion_tokens_details: { reasoning_tokens: 850 },
        },
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-120b",
      options: { maxTokens: 1000 },
    });
    expect(result.text).toBe(
      '{"kind":"speak","operationalRequest":{"kind":"candidate_verification"',
    );
    expect(result.text).not.toContain("hidden chain");
    expect(result.usage).toEqual({
      promptTokens: 2293,
      completionTokens: 1000,
      reasoningTokens: 850,
    });
    expect(result.finishReason).toBe("length");
  });

  it("throws agent_not_ready when the API key is missing", async () => {
    env.groqApiKey = "";
    const adapter = createGroqAdapter(async () => fakeResponse({}));
    await expect(
      adapter.dispatch({ messages, modelId: "x", options: {} }),
    ).rejects.toThrow(AppError);
  });

  it("rethrows AbortError", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(() => mapGroqError(err)).toThrow(err);
  });

  it("rethrows deadline TimeoutError without inventing provider_unavailable", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(() => mapGroqError(err)).toThrow(err);
  });
});

describe("mapGroqError", () => {
  it("maps 429 to rate_limited with retry-after", () => {
    const mapped = mapGroqError({
      statusCode: 429,
      headers: new Headers({ "retry-after": "17" }),
    });
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe("rate_limited");
    expect(mapped.httpStatus).toBe(429);
    expect(mapped.retryAfterSec).toBe(17);
  });

  it("maps 503 to provider_unavailable without retry-after", () => {
    const mapped = mapGroqError({
      statusCode: 503,
      headers: new Headers(),
    });
    expect(mapped.code).toBe("provider_unavailable");
    expect(mapped.httpStatus).toBe(503);
    expect(mapped.retryAfterSec).toBeUndefined();
  });
});
