import { afterEach, describe, expect, it, vi } from "vitest";
import { Mistral } from "@mistralai/mistralai";
import type { ChatMessage } from "../types.js";
import type { StructuredOutputSchemaFingerprint } from "../../model-fabric/types.js";
import { thoughtOutputStructuredRequest } from "../../cognitive-v021/thought/output-contract.js";
import { createMistralAdapter } from "./mistral-adapter.js";

const nativeThoughtSchema = {
  kind: "native_json_schema" as const,
  contractId: "ashley.thought.semantic.v1",
  schemaId: "ashley.thought.semantic.v1.schema",
  schemaFingerprint: ("sha256:" + "a".repeat(64)) as StructuredOutputSchemaFingerprint,
  bindingId: "wire:mistral-response-format-json-schema",
  wireFormat: "mistral_response_format_json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { kind: { type: "string" } },
    required: ["kind"],
  },
};

async function dispatchNativeResponse(
  providerResponse: Record<string, unknown>,
  options: { maxTokens?: number; reasoningEffort?: "none" | "high" } = {},
) {
  const fetchFn = vi.fn(async () =>
    new Response(JSON.stringify(providerResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const adapter = createMistralAdapter(
    () => ({ chat: { complete: vi.fn() } }) as unknown as Mistral,
    fetchFn,
    () => "test-primary-key",
  );
  return adapter.dispatch({
    messages: [{ role: "user", content: "synthetic qualification prompt" }],
    modelId: "mistral-small-2603",
    credentialSeat: "mistral_primary",
    options: {
      responseFormat: "json_schema",
      maxTokens: options.maxTokens ?? 256,
      reasoningEffort: options.reasoningEffort,
    },
    fabricReasoning: options.reasoningEffort
      ? { kind: "reasoning_effort", value: options.reasoningEffort }
      : undefined,
    fabricStructuredOutput: nativeThoughtSchema,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mistral-adapter W1 wire evidence", () => {
  it("records compatibility mode and sanitizes message content", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "private-mistral-content" },
    ];
    let capturedBody: Record<string, unknown> | undefined;
    const complete = vi.fn(async (body: unknown) => {
      capturedBody = body as Record<string, unknown>;
      return {
        choices: [{ message: { content: '{"kind":"speak"}' } }],
        usage: { promptTokens: 4, completionTokens: 2 },
        model: "mistral-medium-latest",
      };
    });
    const client = { chat: { complete } } as unknown as Mistral;
    const adapter = createMistralAdapter(() => client);

    const result = await adapter.dispatch({
      messages,
      modelId: "mistral-medium-latest",
      options: { responseFormat: "json_schema", maxTokens: 512 },
      fabricStructuredOutput: {
        kind: "json_object_compatibility",
        contractId: "ashley.thought.semantic.v1",
        schemaId: "ashley.thought.semantic.v1.schema",
        schemaFingerprint: ("sha256:" + "a".repeat(64)) as StructuredOutputSchemaFingerprint,
        bindingId: "wire:mistral-json-object",
      },
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(capturedBody?.responseFormat).toEqual({ type: "json_object" });
    expect(result).toMatchObject({
      text: '{"kind":"speak"}',
      providerModel: "mistral-medium-latest",
      wireEvidence: {
        adapterId: "ashley.adapter.mistral.v1",
        wireFormat: "json_object",
        emittedEnforcementMode: "json_object_compatibility",
        providerDeclaredEnforcement: "unavailable",
        bindingId: "wire:mistral-json-object",
      },
    });
    expect(JSON.stringify(result.wireEvidence)).not.toContain(
      "private-mistral-content",
    );
  });

  it("rejects a native schema request instead of claiming unsupported enforcement", async () => {
    const complete = vi.fn();
    const client = { chat: { complete } } as unknown as Mistral;
    const adapter = createMistralAdapter(() => client);

    await expect(
      adapter.dispatch({
        messages: [{ role: "user", content: "hello" }],
        modelId: "mistral-medium-latest",
        options: { responseFormat: "json_schema" },
        fabricStructuredOutput: {
          kind: "native_json_schema",
          contractId: "ashley.thought.semantic.v1",
          schemaId: "ashley.thought.semantic.v1.schema",
          schemaFingerprint: ("sha256:" + "a".repeat(64)) as StructuredOutputSchemaFingerprint,
          bindingId: "wire:mistral-native-unsupported",
          wireFormat: "nim_guided_json",
          schema: { type: "object" },
        },
      }),
    ).rejects.toMatchObject({ code: "structured_output_native_unsupported" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("emits native Mistral json_schema through the raw API path with trusted controls", async () => {
    const thoughtRequest = thoughtOutputStructuredRequest();
    const complete = vi.fn();
    const client = { chat: { complete } } as unknown as Mistral;
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"kind":"speak"}' },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
          model: "mistral-small-2603",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = createMistralAdapter(
      () => client,
      fetchFn,
      () => "primary-secret-must-not-leak",
    );

    const result = await adapter.dispatch({
      messages: [{ role: "user", content: "private-mistral-content" }],
      modelId: "mistral-small-2603",
      credentialSeat: "mistral_primary",
      options: { responseFormat: "json_schema", maxTokens: 4096, reasoningEffort: "high" },
      fabricReasoning: { kind: "reasoning_effort", value: "high" },
      fabricStructuredOutput: {
        kind: "native_json_schema",
        contractId: thoughtRequest.contractId,
        schemaId: thoughtRequest.schemaId,
        schemaFingerprint: thoughtRequest.schemaFingerprint,
        bindingId: "wire:mistral-response-format-json-schema",
        wireFormat: "mistral_response_format_json_schema",
        schema: thoughtRequest.schema,
      },
    });

    expect(complete).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(init?.headers).toEqual(expect.objectContaining({
      Authorization: "Bearer primary-secret-must-not-leak",
      "Content-Type": "application/json",
    }));
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(body).toMatchObject({
        model: "mistral-small-2603",
      max_tokens: 4096,
      temperature: expect.any(Number),
      stream: false,
        reasoning_effort: "high",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: thoughtRequest.schemaId,
          strict: true,
        },
      },
    });
    expect(body.response_format.json_schema.schema).toEqual(thoughtRequest.schema);
    expect(body.messages).toEqual([
      { role: "user", content: "private-mistral-content" },
    ]);
    expect(init?.body).not.toContain("primary-secret-must-not-leak");
    expect(JSON.stringify(result.wireEvidence)).not.toContain(
      "primary-secret-must-not-leak",
    );
    expect(result).toMatchObject({
      text: '{"kind":"speak"}',
      providerModel: "mistral-small-2603",
      wireEvidence: {
        wireFormat: "mistral_response_format_json_schema",
        emittedEnforcementMode: "native_json_schema",
        providerDeclaredEnforcement: "unavailable",
        bindingId: "wire:mistral-response-format-json-schema",
      },
    });
  });

  it("redacts the active credential from non-2xx provider diagnostics", async () => {
    const secret = "mistral-secret-from-provider-body";
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: `invalid key ${secret}` } }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = createMistralAdapter(
      () => ({ chat: { complete: vi.fn() } }) as unknown as Mistral,
      fetchFn,
      () => secret,
    );

    await expect(
      adapter.dispatch({
        messages: [{ role: "user", content: "hello" }],
        modelId: "mistral-small-2603",
        options: { responseFormat: "json_schema" },
        fabricStructuredOutput: {
          kind: "native_json_schema",
          contractId: "ashley.thought.semantic.v1",
          schemaId: "ashley.thought.semantic.v1.schema",
          schemaFingerprint: ("sha256:" + "a".repeat(64)) as StructuredOutputSchemaFingerprint,
          bindingId: "wire:mistral-response-format-json-schema",
          wireFormat: "mistral_response_format_json_schema",
          schema: { type: "object" },
        },
      }),
    ).rejects.toMatchObject({ code: "credential_invalid" });
    expect(log.mock.calls.flat().join(" ")).not.toContain(secret);
  });
});

describe("mistral-adapter response extraction", () => {
  it("A: preserves plain string content and captures bounded diagnostics", async () => {
    const text = '{"kind":"speak"}';
    const result = await dispatchNativeResponse(
      {
        choices: [{ message: { content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
        model: "mistral-small-2603",
      },
      { maxTokens: 256, reasoningEffort: "none" },
    );

    expect(result.text).toBe(text);
    expect(result.responseDiagnostics).toEqual({
      contentContainerType: "string",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      finalTextBytes: Buffer.byteLength(text, "utf8"),
      finishReason: "stop",
      finishReasonClass: "STOP",
      outputTokenLimit: 256,
      outputTokens: 2,
      reasoningTokens: null,
      extractionFailure: "none",
    });
  });

  it("B: ignores thinking chunks and extracts only final text chunks", async () => {
    const result = await dispatchNativeResponse(
      {
        choices: [
          {
            message: {
              content: [
                {
                  type: "thinking",
                  thinking: [{ type: "text", text: "private reasoning" }],
                },
                { type: "text", text: '{"kind":"speak"}' },
              ],
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 8 },
      },
      { reasoningEffort: "high" },
    );

    expect(result.text).toBe('{"kind":"speak"}');
    expect(result.text).not.toContain("private reasoning");
    expect(result.responseDiagnostics).toMatchObject({
      contentContainerType: "array",
      contentChunkTypes: ["thinking", "text"],
      textChunkCount: 1,
      thinkingChunkCount: 1,
      extractionFailure: "none",
    });
  });

  it("C: concatenates multiple final text chunks in provider order", async () => {
    const result = await dispatchNativeResponse({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "{\"kind\":" },
              { type: "text", text: "\"speak\"}" },
            ],
          },
          finish_reason: "stop",
        },
      ],
    });

    expect(result.text).toBe('{"kind":"speak"}');
    expect(result.responseDiagnostics).toMatchObject({
      contentChunkTypes: ["text", "text"],
      textChunkCount: 2,
      thinkingChunkCount: 0,
    });
  });

  it("D: returns no semantic content for a thinking-only response", async () => {
    const result = await dispatchNativeResponse({
      choices: [
        {
          message: {
            content: [
              {
                type: "thinking",
                thinking: [{ type: "text", text: '{"kind":"speak"}' }],
              },
            ],
          },
          finish_reason: "length",
        },
      ],
    });

    expect(result.text).toBe("");
    expect(result.responseDiagnostics).toMatchObject({
      contentContainerType: "array",
      contentChunkTypes: ["thinking"],
      textChunkCount: 0,
      thinkingChunkCount: 1,
      extractionFailure: "none",
    });
  });

  it.each([
    {
      label: "unknown chunk type",
      content: [
        { type: "text", text: "prefix" },
        { type: "unknown_provider_chunk", text: "must not pass" },
      ],
      failure: "unknown_chunk_type",
    },
    {
      label: "malformed text chunk",
      content: [{ type: "text", text: 42 }],
      failure: "malformed_chunk",
    },
  ])("E: fails closed for $label", async ({ content, failure }) => {
    const result = await dispatchNativeResponse({
      choices: [
        {
          message: { content },
          finish_reason: "stop",
        },
      ],
    });

    expect(result.text).toBe("");
    expect(result.responseDiagnostics?.extractionFailure).toBe(failure);
  });

  it("F: preserves JSON final text exactly after thinking", async () => {
    const exactJson = '{"kind":"speak","text":"exact"}';
    const result = await dispatchNativeResponse({
      choices: [
        {
          message: {
            content: [
              { type: "thinking", thinking: [{ type: "text", text: "hidden" }] },
              { type: "text", text: exactJson },
            ],
          },
          finish_reason: "stop",
        },
      ],
    });

    expect(result.text).toBe(exactJson);
    expect(JSON.parse(result.text)).toEqual({ kind: "speak", text: "exact" });
  });

  it("G: never promotes JSON found inside thinking to semantic output", async () => {
    const result = await dispatchNativeResponse({
      choices: [
        {
          message: {
            content: [
              { type: "thinking", thinking: [{ type: "text", text: '{"kind":"speak"}' }] },
            ],
          },
          finish_reason: "stop",
        },
      ],
    });

    expect(result.text).toBe("");
    expect(result.responseDiagnostics?.textChunkCount).toBe(0);
  });

  it("records null and missing content without treating either as final text", async () => {
    const nullResult = await dispatchNativeResponse({
      choices: [{ message: { content: null } }],
    });
    const missingResult = await dispatchNativeResponse({
      choices: [{ message: {} }],
    });

    expect(nullResult.text).toBe("");
    expect(nullResult.responseDiagnostics).toMatchObject({
      contentContainerType: "null",
      extractionFailure: "missing_content",
      finishReasonClass: "UNKNOWN",
    });
    expect(missingResult.text).toBe("");
    expect(missingResult.responseDiagnostics).toMatchObject({
      contentContainerType: "unknown",
      extractionFailure: "missing_content",
      finishReasonClass: "UNKNOWN",
    });
  });

  it("H: captures usage, output ceiling, and finish reason classification", async () => {
    const result = await dispatchNativeResponse(
      {
        choices: [
          {
            message: { content: "partial" },
            finish_reason: "length",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 128,
          completion_tokens_details: { reasoning_tokens: 90 },
        },
      },
      { maxTokens: 128, reasoningEffort: "high" },
    );

    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 128,
      reasoningTokens: 90,
    });
    expect(result.finishReason).toBe("length");
    expect(result.responseDiagnostics).toMatchObject({
      finishReason: "length",
      finishReasonClass: "LENGTH",
      outputTokenLimit: 128,
      outputTokens: 128,
      reasoningTokens: 90,
    });
  });
});
