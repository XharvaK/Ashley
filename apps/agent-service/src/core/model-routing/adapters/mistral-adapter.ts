import { Mistral } from "@mistralai/mistralai";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { redactSecretShapes } from "../../privacy/redact-logs.js";
import type {
  ChatMessage,
  CompletionOptions,
  ModelProviderAdapter,
  ProviderCompletion,
  ProviderDispatchArgs,
  ProviderFinishReasonClass,
  ProviderResponseDiagnostics,
  TokenUsage,
  ToolCallResult,
  MistralCredentialSeat,
  TrustedReasoningControl,
} from "../types.js";
import type { TrustedStructuredOutputControl } from "../../model-fabric/types.js";
import { wireEvidenceFor } from "../../model-fabric/wire-evidence.js";

export type MistralClientFactory = (seat?: MistralCredentialSeat) => Mistral;

export type MistralFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  json(): Promise<unknown>;
}>;

export type MistralApiKeyFactory = (
  seat?: MistralCredentialSeat,
) => string;

export type NormalizedMistralProviderContent = Pick<
  ProviderResponseDiagnostics,
  | "contentContainerType"
  | "contentChunkTypes"
  | "textChunkCount"
  | "thinkingChunkCount"
  | "extractionFailure"
> & { text: string };

function boundedChunkType(raw: unknown): string {
  return typeof raw === "string" && raw.length > 0
    ? raw.slice(0, 64)
    : "<invalid>";
}

function extractContent(content: unknown): NormalizedMistralProviderContent {
  if (typeof content === "string") {
    return {
      text: content,
      contentContainerType: "string",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "none",
    };
  }

  if (content === null) {
    return {
      text: "",
      contentContainerType: "null",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "missing_content",
    };
  }

  if (content === undefined) {
    return {
      text: "",
      contentContainerType: "unknown",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "missing_content",
    };
  }

  if (!Array.isArray(content)) {
    return {
      text: "",
      contentContainerType: "unknown",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "unsupported_container",
    };
  }

  const contentChunkTypes: string[] = [];
  const textParts: string[] = [];
  let textChunkCount = 0;
  let thinkingChunkCount = 0;
  let extractionFailure: NormalizedMistralProviderContent["extractionFailure"] = "none";

  for (const chunk of content) {
    if (typeof chunk !== "object" || chunk === null) {
      extractionFailure =
        extractionFailure === "none" ? "malformed_chunk" : extractionFailure;
      contentChunkTypes.push("<invalid>");
      continue;
    }

    const record = chunk as { type?: unknown; text?: unknown; thinking?: unknown };
    const type = record.type;
    contentChunkTypes.push(boundedChunkType(type));
    if (type === "text") {
      textChunkCount += 1;
      if (typeof record.text !== "string") {
        extractionFailure =
          extractionFailure === "none" ? "malformed_chunk" : extractionFailure;
      } else {
        textParts.push(record.text);
      }
      continue;
    }
    if (type === "thinking") {
      thinkingChunkCount += 1;
      if (!Array.isArray(record.thinking)) {
        extractionFailure =
          extractionFailure === "none" ? "malformed_chunk" : extractionFailure;
      }
      continue;
    }

    extractionFailure =
      extractionFailure === "none" ? "unknown_chunk_type" : extractionFailure;
  }

  return {
    text: extractionFailure === "none" ? textParts.join("") : "",
    contentContainerType: "array",
    contentChunkTypes,
    textChunkCount,
    thinkingChunkCount,
    extractionFailure,
  };
}

/**
 * The same pure content normalizer used by the live Mistral adapter. The W2
 * replay harness may use it with a safely reconstructed content container;
 * thinking chunks remain metadata and never become semantic text.
 */
export function normalizeMistralProviderContent(
  content: unknown,
): NormalizedMistralProviderContent {
  return extractContent(content);
}

export function extractTextDelta(delta: unknown): string {
  return normalizeMistralProviderContent(delta).text;
}

function toTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as {
    promptTokens?: unknown;
    completionTokens?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    completionTokensDetails?: { reasoningTokens?: unknown };
    completion_tokens_details?: { reasoning_tokens?: unknown };
  };
  const promptTokens = Number(r.promptTokens ?? r.prompt_tokens);
  const completionTokens = Number(r.completionTokens ?? r.completion_tokens);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return undefined;
  }
  const reasoningTokens = Number(
    r.completionTokensDetails?.reasoningTokens ??
      r.completion_tokens_details?.reasoning_tokens,
  );
  const usage: TokenUsage = { promptTokens, completionTokens };
  if (Number.isFinite(reasoningTokens) && reasoningTokens >= 0) {
    usage.reasoningTokens = reasoningTokens;
  }
  return usage;
}

function finishReasonClass(
  finishReason: string | null,
): ProviderFinishReasonClass {
  if (!finishReason) return "UNKNOWN";
  switch (finishReason?.toLowerCase()) {
    case "stop":
      return "STOP";
    case "length":
    case "model_length":
      return "LENGTH";
    case "content_filter":
      return "CONTENT_FILTER";
    case "tool":
    case "tool_calls":
      return "TOOL";
    default:
      return "OTHER";
  }
}

function providerMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => ({
    role: m.role,
    content: m.imageUrls?.length
      ? [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.imageUrls.map((url) => ({
            type: "image_url",
            image_url: { url },
          })),
        ]
      : m.content,
  }));
}

function sdkMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => ({
    role: m.role,
    content: m.imageUrls?.length
      ? [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.imageUrls.map((url) => ({ type: "image_url", imageUrl: url })),
        ]
      : m.content,
  }));
}

function reasoningEffortFor(
  options: CompletionOptions,
  fabricReasoning?: TrustedReasoningControl,
): "none" | "low" | "medium" | "high" | undefined {
  if (fabricReasoning) {
    if (fabricReasoning.kind !== "reasoning_effort") {
      throw Object.assign(new Error("mistral_reasoning_control_mismatch"), {
        code: "mistral_reasoning_control_mismatch",
      });
    }
    return fabricReasoning.value;
  }
  return options.reasoningEffort;
}

function buildChatBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
  stream: boolean,
  fabricStructuredOutput?: TrustedStructuredOutputControl,
  fabricReasoning?: TrustedReasoningControl,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: sdkMessages(messages),
    maxTokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? env.mistralChatTemperature,
    stream,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }
  if (options.toolChoice) {
    body.toolChoice = options.toolChoice;
  }
  if (options.presencePenalty !== undefined) {
    body.presencePenalty = options.presencePenalty;
  }
  const effort =
    reasoningEffortFor(options, fabricReasoning) ?? env.mistralReasoningEffort;
  if (effort) {
    // The SDK currently strips this unknown field. Native Thought calls use
    // buildNativeChatBody so their snake_case wire is preserved.
    body.reasoning_effort = effort;
  }
  if (fabricStructuredOutput) {
    if (fabricStructuredOutput.kind !== "json_object_compatibility") {
      throw Object.assign(new Error("structured_output_native_unsupported"), {
        code: "structured_output_native_unsupported",
      });
    }
    body.responseFormat = { type: "json_object" };
  } else if (options.responseFormat === "json_schema") {
    throw Object.assign(new Error("structured_output_untrusted"), {
      code: "structured_output_untrusted",
    });
  }
  return body;
}

function buildNativeChatBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
  fabricStructuredOutput: TrustedStructuredOutputControl,
  fabricReasoning?: TrustedReasoningControl,
): Record<string, unknown> {
  if (
    fabricStructuredOutput.kind !== "native_json_schema" ||
    fabricStructuredOutput.wireFormat !== "mistral_response_format_json_schema"
  ) {
    throw Object.assign(new Error("structured_output_native_unsupported"), {
      code: "structured_output_native_unsupported",
    });
  }
  const body: Record<string, unknown> = {
    model,
    messages: providerMessages(messages),
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? env.mistralChatTemperature,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: fabricStructuredOutput.schemaId,
        strict: true,
        schema: fabricStructuredOutput.schema,
      },
    },
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }
  if (options.toolChoice) {
    body.tool_choice = options.toolChoice;
  }
  if (options.presencePenalty !== undefined) {
    body.presence_penalty = options.presencePenalty;
  }
  const effort =
    reasoningEffortFor(options, fabricReasoning) ?? env.mistralReasoningEffort;
  if (effort) body.reasoning_effort = effort;
  return body;
}

function parseRetryAfterSec(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as {
    headers?: Headers | Record<string, string>;
    response?: { headers?: Headers | Record<string, string> };
  };
  const headers = e.headers ?? e.response?.headers;
  if (!headers) return undefined;
  const raw =
    typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("retry-after")
      : (headers as Record<string, string>)["retry-after"] ??
        (headers as Record<string, string>)["Retry-After"];
  if (!raw) return undefined;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  }
  return undefined;
}

function mistralStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { statusCode?: number; status?: number };
  const code = e.statusCode ?? e.status;
  return typeof code === "number" && Number.isFinite(code) ? code : undefined;
}

function redactKnownSecrets(text: string, secrets: readonly string[]): string {
  let safe = redactSecretShapes(text);
  for (const secret of secrets) {
    if (secret.length > 0) {
      safe = safe.split(secret).join("[redacted-credential]");
    }
  }
  return safe;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

function isAccountScopedMessage(message: string): boolean {
  return /\b(?:account|api[ _-]?key|credential|quota|billing|organization)\b/i.test(
    message,
  );
}

export function mapMistralError(
  err: unknown,
  knownSecrets: readonly string[] = [],
): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    throw err;
  }
  const msg = redactKnownSecrets(errorMessage(err), knownSecrets);
  const status = mistralStatusCode(err);
  console.error("[mistral]", status ?? "no-status", msg.slice(0, 500));

  if (status === 401 || status === 403) {
    return new AppError(
      "credential_invalid",
      "Mistral credential rejected",
      status,
      undefined,
      "account",
    );
  }
  if (status === 402 || /402|quota|payment/i.test(msg)) {
    return new AppError(
      "quota_exhausted",
      "Mistral quota exhausted",
      402,
      undefined,
      "account",
    );
  }
  if (status === 429 || /429|rate.?limit/i.test(msg)) {
    return new AppError(
      "rate_limited",
      "Mistral rate limited",
      429,
      parseRetryAfterSec(err) ?? 30,
      isAccountScopedMessage(msg) ? "account" : "provider",
    );
  }
  if (
    (status !== undefined && status >= 500) ||
    /5\d{2}|unavailable|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(msg)
  ) {
    return new AppError(
      "mistral_unavailable",
      "Mistral unavailable",
      503,
      parseRetryAfterSec(err),
      "provider",
    );
  }
  return new AppError("internal_error", "Mistral request failed", 500);
}

type MistralMessage = {
  content?: unknown;
  toolCalls?: unknown[];
  tool_calls?: unknown[];
};

function parseToolCalls(
  message: MistralMessage | undefined,
): ToolCallResult[] | undefined {
  const rawToolCalls = message?.toolCalls ?? message?.tool_calls;
  if (!Array.isArray(rawToolCalls)) return undefined;
  const toolCalls: ToolCallResult[] = [];
  for (const tc of rawToolCalls) {
    if (typeof tc !== "object" || tc === null || !("function" in tc)) continue;
    const fn = (tc as { function?: { name?: unknown; arguments?: unknown } })
      .function;
    if (fn && typeof fn.name === "string") {
      toolCalls.push({
        id: (tc as { id?: string }).id,
        function: {
          name: fn.name,
          arguments:
            typeof fn.arguments === "string"
              ? fn.arguments
              : JSON.stringify(fn.arguments ?? {}),
        },
      });
    }
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}

function normalizeCompletion(
  rawResponse: unknown,
  wireEvidence: ProviderCompletion["wireEvidence"],
  outputTokenLimit: number | null,
): ProviderCompletion {
  const response = rawResponse as {
    choices?: Array<{
      message?: MistralMessage;
      finish_reason?: unknown;
      finishReason?: unknown;
    }>;
    usage?: unknown;
    model?: unknown;
  };
  const choice = response.choices?.[0];
  const msg = choice?.message;
  const raw = msg?.content;
  const extracted = normalizeMistralProviderContent(raw);
  const text = extracted.text;
  const finishRaw = choice?.finish_reason ?? choice?.finishReason;
  const finishReason =
    typeof finishRaw === "string" ? finishRaw.trim().slice(0, 32) || null : null;
  const usage = toTokenUsage(response.usage);
  const responseDiagnostics: ProviderResponseDiagnostics = {
    contentContainerType: extracted.contentContainerType,
    contentChunkTypes: extracted.contentChunkTypes,
    textChunkCount: extracted.textChunkCount,
    thinkingChunkCount: extracted.thinkingChunkCount,
    finalTextBytes: Buffer.byteLength(text, "utf8"),
    finishReason,
    finishReasonClass: finishReasonClass(finishReason),
    outputTokenLimit,
    outputTokens: usage?.completionTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    extractionFailure: extracted.extractionFailure,
  };
  return {
    text,
    toolCalls: parseToolCalls(msg),
    usage,
    providerModel: typeof response.model === "string" ? response.model : null,
    finishReason,
    responseDiagnostics,
    wireEvidence,
  };
}

async function responseError(
  response: { status: number; headers: Headers; json(): Promise<unknown> },
  knownSecrets: readonly string[] = [],
): Promise<AppError> {
  let detail = `mistral_error:${response.status}`;
  try {
    const body = await response.json();
    if (body && typeof body === "object") {
      const record = body as {
        message?: unknown;
        error?: { message?: unknown };
      };
      const message = record.error?.message ?? record.message;
      if (typeof message === "string" && message.length > 0) {
        detail = redactKnownSecrets(message.slice(0, 300), knownSecrets);
      }
    }
  } catch {
    /* provider error body was not JSON */
  }
  return mapMistralError({
    statusCode: response.status,
    headers: response.headers,
    message: detail,
  }, knownSecrets);
}

function defaultApiKeyForSeat(
  seat: MistralCredentialSeat = "mistral_primary",
): string {
  return seat === "mistral_secondary"
    ? env.mistralApiKeySecondary
    : env.mistralApiKey;
}

/**
 * Mistral provider adapter. Compatibility calls use the SDK. Native Thought
 * calls use the raw Chat API because the installed SDK strips
 * `reasoning_effort` from its request schema.
 */
export function createMistralAdapter(
  getClient: MistralClientFactory,
  fetchFn: MistralFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
  apiKeyFor: MistralApiKeyFactory = defaultApiKeyForSeat,
): ModelProviderAdapter {
  return {
    provider: "mistral",
    async dispatch(args: ProviderDispatchArgs) {
      const seat = args.credentialSeat ?? "mistral_primary";
      const structured = args.fabricStructuredOutput;
      if (structured?.kind === "native_json_schema") {
        const body = buildNativeChatBody(
          args.messages,
          args.options,
          args.modelId,
          structured,
          args.fabricReasoning,
        );
        const wireEvidence = wireEvidenceFor({
          adapterId: "ashley.adapter.mistral.v1",
          body,
          structuredOutput: structured,
        });
        const apiKey = apiKeyFor(seat);
        if (!apiKey) {
          throw new AppError(
            "agent_not_ready",
            `Mistral ${seat} API key not configured`,
            503,
          );
        }
        let response: Awaited<ReturnType<MistralFetch>>;
        try {
          response = await fetchFn(`${env.mistralBaseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: args.signal,
          });
        } catch (err) {
          throw mapMistralError(err, [apiKey]);
        }
        if (!response.ok) throw await responseError(response, [apiKey]);
        try {
          return normalizeCompletion(
            await response.json(),
            wireEvidence,
            args.options.maxTokens ?? 2048,
          );
        } catch (err) {
          throw mapMistralError(err, [apiKey]);
        }
      }

      const body = buildChatBody(
        args.messages,
        args.options,
        args.modelId,
        false,
        structured,
        args.fabricReasoning,
      );
      const wireEvidence = wireEvidenceFor({
        adapterId: "ashley.adapter.mistral.v1",
        body,
        structuredOutput: structured,
      });
      const mistral = getClient(seat);
      try {
        const response = await mistral.chat.complete(
          body as Parameters<typeof mistral.chat.complete>[0],
          { fetchOptions: { signal: args.signal } },
        );
        return normalizeCompletion(
          response,
          wireEvidence,
          args.options.maxTokens ?? 2048,
        );
      } catch (err) {
        throw mapMistralError(err, [defaultApiKeyForSeat(seat)]);
      }
    },
  };
}
