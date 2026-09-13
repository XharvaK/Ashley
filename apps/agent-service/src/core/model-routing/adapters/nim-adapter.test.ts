import { describe, expect, it, afterEach, vi } from "vitest";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { buildNimRequestBody, createNimAdapter, mapNimError } from "./nim-adapter.js";
import type { ChatMessage } from "../types.js";
import { providerHttpStatusFromBoundary } from "../types.js";
import type { StructuredOutputSchemaFingerprint } from "../../model-fabric/types.js";

const originalKey = env.nimApiKey;

afterEach(() => {
  env.nimApiKey = originalKey;
  vi.restoreAllMocks();
});

function fakeResponse(
  body: unknown,
  init: {
    status?: number;
    headers?: Record<string, string>;
    json?: () => Promise<unknown>;
  } = {},
) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    json: init.json ?? (async () => body),
  };
}

describe("nim-adapter fixtures", () => {
  const messages: ChatMessage[] = [
    { role: "user" as const, content: "hello" },
  ];

  it("maps a chat completion to a ProviderCompletion", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
      fakeResponse({
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
        model: "openai/gpt-oss-20b",
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
      options: {},
    });
    expect(result.text).toBe("hi there");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2 });
    expect(result.providerModel).toBe("openai/gpt-oss-20b");
    expect(result.finishReason).toBe("stop");
    expect(result.providerHttpStatus).toBe(200);
  });

  it("preserves observed status across provider errors and post-header body failures", async () => {
    env.nimApiKey = "test";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const providerMessage = "provider body must never enter logs";
    const errorAdapter = createNimAdapter(async () =>
      fakeResponse({ error: { message: providerMessage } }, { status: 503 }),
    );
    let providerError: unknown;
    try {
      await errorAdapter.dispatch({ messages, modelId: "openai/gpt-oss-20b", options: {} });
    } catch (error) {
      providerError = error;
    }
    expect(providerError).toMatchObject({ code: "provider_unavailable" });
    expect(providerHttpStatusFromBoundary(providerError)).toBe(503);
    expect(Object.keys(providerError as object)).not.toContain("__ashley_provider_http_status");
    expect(log.mock.calls.flat().join(" ")).not.toContain(providerMessage);

    const bodyError = new Error("body read failed");
    const bodyAdapter = createNimAdapter(async () =>
      fakeResponse({}, { status: 200, json: async () => { throw bodyError; } }),
    );
    await expect(
      bodyAdapter.dispatch({ messages, modelId: "openai/gpt-oss-20b", options: {} }),
    ).rejects.toBe(bodyError);
    expect(providerHttpStatusFromBoundary(bodyError)).toBe(200);

    const abortError = new Error("aborted after headers");
    abortError.name = "AbortError";
    const abortAdapter = createNimAdapter(async () =>
      fakeResponse({}, { status: 200, json: async () => { throw abortError; } }),
    );
    await expect(
      abortAdapter.dispatch({ messages, modelId: "openai/gpt-oss-20b", options: {} }),
    ).rejects.toBe(abortError);
    expect(providerHttpStatusFromBoundary(abortError)).toBe(200);

    const networkError = new Error("network failed");
    const networkAdapter = createNimAdapter(async () => { throw networkError; });
    await expect(
      networkAdapter.dispatch({ messages, modelId: "openai/gpt-oss-20b", options: {} }),
    ).rejects.toBe(networkError);
    expect(providerHttpStatusFromBoundary(networkError)).toBeUndefined();
  });

  it("maps prompt cache usage to cachedTokens", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
      fakeResponse({
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 4 },
        },
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
      options: {},
    });
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      cachedTokens: 4,
    });
  });

  it("keeps only strict nonnegative integer reasoning and cached token observations", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
      fakeResponse({
        choices: [{ message: { content: "ok" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    );
    const zero = await adapter.dispatch({ messages, modelId: "openai/gpt-oss-20b", options: {} });
    expect(zero.usage).toMatchObject({ cachedTokens: 0, reasoningTokens: 0 });

    const invalidValues = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "100"];
    for (const invalid of invalidValues) {
      const invalidAdapter = createNimAdapter(async () =>
        fakeResponse({
          choices: [{ message: { content: "ok" } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            prompt_tokens_details: { cached_tokens: invalid as never },
            completion_tokens_details: { reasoning_tokens: invalid as never },
          },
        }),
      );
      const result = await invalidAdapter.dispatch({ messages, modelId: "openai/gpt-oss-20b", options: {} });
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2 });
    }
  });

  it("does not report a cached token count for a non-numeric provider field", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
      fakeResponse({
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: "unknown" as never },
        },
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
      options: {},
    });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2 });
  });

  it("extracts tool calls", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
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
      modelId: "openai/gpt-oss-20b",
      options: {},
    });
    expect(result.toolCalls).toEqual([
      { id: "call_1", function: { name: "summarize", arguments: '{"n":3}' } },
    ]);
  });

  it("serializes reasoning_effort in request body when specified", async () => {
    env.nimApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
      options: { reasoningEffort: "low" },
    });
    expect(capturedBody?.reasoning_effort).toBe("low");
    expect(capturedBody?.model).toBe("openai/gpt-oss-20b");
  });

  it("maps gpt-oss reasoning_effort none to low", async () => {
    env.nimApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
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

  it("applies trusted Ultra fabric translation as reasoning_effort high", async () => {
    env.nimApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "nvidia/nemotron-3-ultra-550b-a55b",
      options: {},
      fabricReasoning: { kind: "reasoning_effort", value: "high" },
    });
    expect(capturedBody?.reasoning_effort).toBe("high");
    expect(JSON.stringify(capturedBody)).not.toContain("max_supported");
  });

  it("applies trusted Super fabric translation as reasoning_effort high and reasoning_budget 1024", async () => {
    env.nimApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "nvidia/nemotron-3-super-120b-a12b",
      options: {},
      fabricReasoning: { kind: "reasoning_effort", value: "high" },
    });
    expect(capturedBody?.reasoning_effort).toBe("high");
    expect(capturedBody?.reasoning_budget).toBe(1024);
  });

  it("serializes reasoning_budget 1024 for direct Super high reasoning effort without fabric", async () => {
    env.nimApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "nvidia/nemotron-3-super-120b-a12b",
      options: { reasoningEffort: "high" },
    });
    expect(capturedBody?.reasoning_effort).toBe("high");
    expect(capturedBody?.reasoning_budget).toBe(1024);
  });

  it("builds exact wire request for Super Thought with reasoning_budget 1024 and max_tokens 8192", () => {
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    };
    const body = buildNimRequestBody(
      messages,
      { responseFormat: "json_schema", temperature: 1.0, maxTokens: 8192 },
      "nvidia/nemotron-3-super-120b-a12b",
      { kind: "reasoning_effort", value: "high" },
      {
        kind: "native_json_schema",
        contractId: "ashley.thought.semantic.v1",
        schemaId: "ashley.thought.semantic.v1.schema",
        schemaFingerprint: `sha256:${"b".repeat(64)}` as StructuredOutputSchemaFingerprint,
        bindingId: "compat_thought_nim_nemotron_super_native_json_schema_v1",
        wireFormat: "nim_response_format_json_schema",
        schema,
      },
    );
    expect(body.model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(body.temperature).toBe(1.0);
    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning_budget).toBe(1024);
    expect(body.max_tokens).toBe(8192);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "ashley.thought.semantic.v1.schema",
        strict: true,
        schema,
      },
    });
  });

  it("builds structural retry and authority revision wire requests with reasoning_budget 1024 and max_tokens 8192", () => {
    const structuralRetryBody = buildNimRequestBody(
      messages,
      { responseFormat: "json_schema", temperature: 1.0, maxTokens: 8192 },
      "nvidia/nemotron-3-super-120b-a12b",
      { kind: "reasoning_effort", value: "high" },
      {
        kind: "native_json_schema",
        contractId: "ashley.thought.semantic.v1",
        schemaId: "ashley.thought.semantic.v1.schema",
        schemaFingerprint: `sha256:${"b".repeat(64)}` as StructuredOutputSchemaFingerprint,
        bindingId: "compat_thought_nim_nemotron_super_native_json_schema_v1",
        wireFormat: "nim_response_format_json_schema",
        schema: { type: "object" },
      },
    );
    expect(structuralRetryBody.reasoning_budget).toBe(1024);
    expect(structuralRetryBody.reasoning_effort).toBe("high");
    expect(structuralRetryBody.max_tokens).toBe(8192);

    const revisionBody = buildNimRequestBody(
      [...messages, { role: "user", content: "settlementRevision" }],
      { responseFormat: "json_schema", temperature: 1.0, maxTokens: 8192 },
      "nvidia/nemotron-3-super-120b-a12b",
      { kind: "reasoning_effort", value: "high" },
      {
        kind: "native_json_schema",
        contractId: "ashley.thought.semantic.v1",
        schemaId: "ashley.thought.semantic.v1.schema",
        schemaFingerprint: `sha256:${"b".repeat(64)}` as StructuredOutputSchemaFingerprint,
        bindingId: "compat_thought_nim_nemotron_super_native_json_schema_v1",
        wireFormat: "nim_response_format_json_schema",
        schema: { type: "object" },
      },
    );
    expect(revisionBody.reasoning_budget).toBe(1024);
    expect(revisionBody.reasoning_effort).toBe("high");
    expect(revisionBody.max_tokens).toBe(8192);
  });

  it("surfaces NIM 400 provider error message", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
      fakeResponse(
        {
          error: {
            message: "Invalid model parameters",
          },
        },
        { status: 400 },
      ),
    );
    await expect(
      adapter.dispatch({
        messages,
        modelId: "openai/gpt-oss-20b",
        options: {},
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
  });

  it("serializes json_object response_format when requested", async () => {
    env.nimApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return fakeResponse({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });
    });
    await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
      options: { responseFormat: "json_object" },
    });
    expect(capturedBody?.response_format).toEqual({ type: "json_object" });
  });

  it("uses only the trusted Model Fabric compatibility binding for Thought schema requests", async () => {
    env.nimApiKey = "test";
    let capturedBody: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
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
        bindingId: "compat_thought_nim_gpt_oss_20b_json_object_v1",
      },
    });
    expect(capturedBody?.response_format).toEqual({ type: "json_object" });
    expect(capturedBody).not.toHaveProperty("guided_json");
    expect(capturedBody).not.toHaveProperty("json_schema");
  });

  it("maps a trusted native Thought schema to the selected NIM wire format", () => {
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    };
    const body = buildNimRequestBody(
      messages,
      { responseFormat: "json_schema" },
      "openai/gpt-oss-20b",
      undefined,
      {
        kind: "native_json_schema",
        contractId: "ashley.thought.step.v1",
        schemaId: "ashley.thought.step.v1.schema",
        schemaFingerprint: `sha256:${"a".repeat(64)}` as StructuredOutputSchemaFingerprint,
        bindingId: "nim-native-fixture",
        wireFormat: "nim_guided_json",
        schema,
      },
    );
    expect(body.guided_json).toEqual(schema);
    expect(body).not.toHaveProperty("response_format");
  });

  it("fails closed when json_schema has no trusted provider binding", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () => fakeResponse({}));
    await expect(
      adapter.dispatch({
        messages,
        modelId: "openai/gpt-oss-20b",
        options: { responseFormat: "json_schema" },
      }),
    ).rejects.toMatchObject({ code: "structured_output_untrusted" });
  });

  it("uses message.content only and captures reasoning tokens in usage", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
      fakeResponse({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '{"kind":"speak","reason":"hello"}',
              reasoning: "hidden chain of thought",
              reasoning_content: "hidden chain of thought",
            },
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 50,
          completion_tokens_details: { reasoning_tokens: 30 },
        },
      }),
    );
    const result = await adapter.dispatch({
      messages,
      modelId: "openai/gpt-oss-20b",
      options: { maxTokens: 1000 },
    });
    expect(result.text).toBe('{"kind":"speak","reason":"hello"}');
    expect(result.text).not.toContain("hidden chain");
    expect(result.usage).toEqual({
      promptTokens: 200,
      completionTokens: 50,
      reasoningTokens: 30,
    });
    expect(result.finishReason).toBe("stop");
    expect(result.responseDiagnostics).toMatchObject({
      contentContainerType: "string",
      finalTextBytes: Buffer.byteLength('{"kind":"speak","reason":"hello"}', "utf8"),
      finishReason: "stop",
      finishReasonClass: "STOP",
      outputTokenLimit: 1000,
      outputTokens: 50,
      reasoningTokens: 30,
      reasoningContentBytes: Buffer.byteLength("hidden chain of thought", "utf8"),
      reasoningHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      extractionFailure: "none",
    });
    expect(JSON.stringify(result.responseDiagnostics)).not.toContain("hidden chain of thought");
  });

  it("keeps thinking chunks out of semantic text while preserving their shape", async () => {
    env.nimApiKey = "test";
    const adapter = createNimAdapter(async () =>
      fakeResponse({
        choices: [
          {
            message: {
              content: [
                { type: "thinking", thinking: [{ type: "text", text: "private reasoning" }] },
                { type: "text", text: '{"kind":"speak"}' },
              ],
            },
            finish_reason: "stop",
          },
        ],
      }),
    );

    const result = await adapter.dispatch({ messages, modelId: "openai/gpt-oss-20b", options: {} });

    expect(result.text).toBe('{"kind":"speak"}');
    expect(result.text).not.toContain("private reasoning");
    expect(result.responseDiagnostics).toMatchObject({
      contentContainerType: "array",
      contentChunkTypes: ["thinking", "text"],
      textChunkCount: 1,
      thinkingChunkCount: 1,
      extractionFailure: "none",
    });
    expect(JSON.stringify(result.responseDiagnostics)).not.toContain("private reasoning");
  });

  it("throws agent_not_ready when the API key is missing", async () => {
    env.nimApiKey = "";
    const adapter = createNimAdapter(async () => fakeResponse({}));
    await expect(
      adapter.dispatch({ messages, modelId: "x", options: {} }),
    ).rejects.toThrow(AppError);
  });

  it("rethrows AbortError", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(() => mapNimError(err)).toThrow(err);
  });

  it("rethrows deadline TimeoutError without inventing provider_unavailable", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(() => mapNimError(err)).toThrow(err);
  });
});

describe("mapNimError", () => {
  it("maps 429 to rate_limited with retry-after", () => {
    const mapped = mapNimError({
      statusCode: 429,
      headers: new Headers({ "retry-after": "25" }),
    });
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe("rate_limited");
    expect(mapped.httpStatus).toBe(429);
    expect(mapped.retryAfterSec).toBe(25);
  });

  it("maps 503 to provider_unavailable without retry-after", () => {
    const mapped = mapNimError({
      statusCode: 503,
      headers: new Headers(),
    });
    expect(mapped.code).toBe("provider_unavailable");
    expect(mapped.httpStatus).toBe(503);
    expect(mapped.retryAfterSec).toBeUndefined();
  });
});
