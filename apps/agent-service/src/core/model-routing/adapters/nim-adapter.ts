import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { applyTranslatedControlToNimBody } from "../../model-fabric/reasoning-translation.js";
import { sha256Text } from "../../model-fabric/hash.js";
import {
  attachProviderHttpStatusBoundary,
  providerHttpStatusFromBoundary,
  validateProviderHttpStatus,
} from "../types.js";
import type {
  ChatMessage,
  CompletionOptions,
  ModelProviderAdapter,
  ProviderCompletion,
  TokenUsage,
  ToolCallResult,
  ProviderDispatchArgs,
  TrustedReasoningControl,
  ProviderFinishReasonClass,
  ProviderResponseDiagnostics,
} from "../types.js";
import type { TrustedStructuredOutputControl } from "../../model-fabric/types.js";
import { wireEvidenceFor } from "../../model-fabric/wire-evidence.js";

type NimMessage = {
  content?: string | Array<unknown> | null;
  /** gpt-oss hidden reasoning — never copied into Thought JSON text. */
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type NimChoice = { message?: NimMessage; finish_reason?: string | null };

type NimUsage = {
  prompt_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

type NimResponse = {
  choices?: NimChoice[];
  usage?: NimUsage;
  model?: string;
};

function parseNonNegativeInteger(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0
    ? raw
    : undefined;
}

function toTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as NimUsage;
  const promptTokens = Number(r.prompt_tokens);
  const completionTokens = Number(r.completion_tokens);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return undefined;
  }
  const usage: TokenUsage = { promptTokens, completionTokens };
  const cachedTokens = parseNonNegativeInteger(r.prompt_tokens_details?.cached_tokens);
  if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens;
  const reasoningTokens = parseNonNegativeInteger(
    r.completion_tokens_details?.reasoning_tokens,
  );
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
  return usage;
}

const FINISH_REASONS = new Set(["stop", "length", "tool_calls", "content_filter"]);

function toFinishReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 32);
  return FINISH_REASONS.has(value) ? value : "other";
}

function finishReasonClass(
  finishReason: string | null,
): ProviderFinishReasonClass {
  if (!finishReason) return "UNKNOWN";
  switch (finishReason) {
    case "stop":
      return "STOP";
    case "length":
      return "LENGTH";
    case "content_filter":
      return "CONTENT_FILTER";
    case "tool_calls":
      return "TOOL";
    default:
      return "OTHER";
  }
}

function boundedChunkType(value: unknown): string {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, 64)
    : "<invalid>";
}

function contentDiagnostics(
  content: unknown,
): Pick<
  ProviderResponseDiagnostics,
  "contentContainerType" | "contentChunkTypes" | "textChunkCount" | "thinkingChunkCount" | "extractionFailure"
> {
  if (typeof content === "string") {
    return {
      contentContainerType: "string",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "none",
    };
  }
  if (content === null) {
    return {
      contentContainerType: "null",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "missing_content",
    };
  }
  if (content === undefined) {
    return {
      contentContainerType: "unknown",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "missing_content",
    };
  }
  if (!Array.isArray(content)) {
    return {
      contentContainerType: "unknown",
      contentChunkTypes: [],
      textChunkCount: 0,
      thinkingChunkCount: 0,
      extractionFailure: "unsupported_container",
    };
  }
  const contentChunkTypes: string[] = [];
  let textChunkCount = 0;
  let thinkingChunkCount = 0;
  let extractionFailure: ProviderResponseDiagnostics["extractionFailure"] = "none";
  for (const chunk of content) {
    if (typeof chunk !== "object" || chunk === null) {
      contentChunkTypes.push("<invalid>");
      if (extractionFailure === "none") extractionFailure = "malformed_chunk";
      continue;
    }
    const record = chunk as { type?: unknown; text?: unknown; thinking?: unknown };
    const type = record.type;
    contentChunkTypes.push(boundedChunkType(type));
    if (type === "text" || type === undefined) {
      textChunkCount += 1;
      if (typeof record.text !== "string" && extractionFailure === "none") {
        extractionFailure = "malformed_chunk";
      }
    } else if (type === "thinking") {
      thinkingChunkCount += 1;
    } else if (extractionFailure === "none") {
      extractionFailure = "unknown_chunk_type";
    }
  }
  return {
    contentContainerType: "array",
    contentChunkTypes,
    textChunkCount,
    thinkingChunkCount,
    extractionFailure,
  };
}

function reasoningContentBytes(message: NimMessage | undefined): number | undefined {
  const value = message?.reasoning_content ?? message?.reasoning;
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : undefined;
}

function reasoningContentHash(message: NimMessage | undefined): `sha256:${string}` | undefined {
  const value = message?.reasoning_content ?? message?.reasoning;
  return typeof value === "string" ? `sha256:${sha256Text(value)}` : undefined;
}

function buildRequestBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
  fabricReasoning?: TrustedReasoningControl,
  fabricStructuredOutput?: TrustedStructuredOutputControl,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.imageUrls?.length
        ? [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.imageUrls.map((url) => ({ type: "image_url", imageUrl: url })),
          ]
        : m.content,
    })),
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
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
  if (fabricReasoning) {
    applyTranslatedControlToNimBody(body, model, fabricReasoning);
  } else if (options.reasoningEffort !== undefined) {
    const effort = nimReasoningEffortForModel(model, options.reasoningEffort);
    if (effort !== undefined) {
      body.reasoning_effort = effort;
      if (model === "nvidia/nemotron-3-super-120b-a12b" && effort === "high") {
        body.reasoning_budget = 1024;
      }
    }
  }
  if (fabricStructuredOutput) {
    if (fabricStructuredOutput.kind === "json_object_compatibility") {
      body.response_format = { type: "json_object" };
    } else if (fabricStructuredOutput.wireFormat === "nim_guided_json") {
      body.guided_json = fabricStructuredOutput.schema;
    } else if (fabricStructuredOutput.wireFormat === "nim_response_format_json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: fabricStructuredOutput.schemaId,
          strict: true,
          schema: fabricStructuredOutput.schema,
        },
      };
    }
  } else if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  } else if (options.responseFormat === "json_schema") {
    throw Object.assign(new Error("structured_output_untrusted"), {
      code: "structured_output_untrusted",
    });
  }
  return body;
}

export function buildNimRequestBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
  fabricReasoning?: TrustedReasoningControl,
  fabricStructuredOutput?: TrustedStructuredOutputControl,
): Record<string, unknown> {
  return buildRequestBody(
    messages,
    options,
    model,
    fabricReasoning,
    fabricStructuredOutput,
  );
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

function statusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { statusCode?: number; status?: number };
  const code = e.statusCode ?? e.status;
  return typeof code === "number" && Number.isFinite(code) ? code : undefined;
}

/**
 * gpt-oss accepts low|medium|high. Normalize illegal `none` to `low`.
 */
export function nimReasoningEffortForModel(
  modelId: string,
  requested: NonNullable<CompletionOptions["reasoningEffort"]>,
): "none" | "low" | "medium" | "high" {
  if (modelId.startsWith("openai/gpt-oss")) {
    if (requested === "none") return "low";
    return requested;
  }
  return requested;
}

export function mapNimError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    throw err;
  }
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);
  const msg = rawMessage;
  const status = statusCode(err);
  const providerHttpStatus = providerHttpStatusFromBoundary(err);
  let mapped: AppError;
  if (status === 429 || /429|rate.?limit/i.test(msg)) {
    mapped = new AppError(
      "rate_limited",
      "NVIDIA NIM rate limited",
      429,
      parseRetryAfterSec(err) ?? 30,
    );
  } else if (
    (status !== undefined && status >= 500) ||
    /5\d{2}|unavailable|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(msg)
  ) {
    mapped = new AppError(
      "provider_unavailable",
      "NVIDIA NIM unavailable",
      503,
      parseRetryAfterSec(err),
    );
  } else {
    mapped = new AppError("internal_error", "NVIDIA NIM request failed", 500);
  }
  attachProviderHttpStatusBoundary(mapped, providerHttpStatus);
  const configuredModelId = err && typeof err === "object"
    && typeof (err as { configuredModelId?: unknown }).configuredModelId === "string"
    ? (err as { configuredModelId: string }).configuredModelId
    : undefined;
  console.error("[nim]", {
    provider: "nim",
    ...(configuredModelId ? { model: configuredModelId } : {}),
    ...(providerHttpStatus !== undefined ? { providerHttpStatus } : {}),
    code: mapped.code,
    ...(mapped.retryAfterSec !== undefined
      ? { retryAfterSec: mapped.retryAfterSec }
      : {}),
  });
  return mapped;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type?: string; text?: string } =>
          typeof c === "object" && c !== null,
      )
      .filter((c) => c.type === "text" || !c.type)
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join("");
  }
  return "";
}

function parseToolCalls(
  message: NimMessage | undefined,
): ToolCallResult[] | undefined {
  const rawToolCalls = message?.tool_calls;
  if (!Array.isArray(rawToolCalls)) return undefined;
  const toolCalls: ToolCallResult[] = [];
  for (const tc of rawToolCalls) {
    if (typeof tc !== "object" || tc === null || tc.type !== "function") continue;
    const fn = tc.function;
    if (fn && typeof fn.name === "string") {
      toolCalls.push({
        id: tc.id,
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

export type NimFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  json(): Promise<unknown>;
}>;

export function createNimAdapter(
  fetchFn: NimFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
): ModelProviderAdapter {
  return {
    provider: "nim",
    async dispatch(args: ProviderDispatchArgs) {
      if (!env.nimApiKey) {
        throw new AppError("agent_not_ready", "NVIDIA NIM API key not configured", 503);
      }
      const body = buildRequestBody(
        args.messages,
        args.options,
        args.modelId,
        args.fabricReasoning,
        args.fabricStructuredOutput,
      );
      const wireEvidence = wireEvidenceFor({
        adapterId: "ashley.adapter.nim.v1",
        body,
        structuredOutput: args.fabricStructuredOutput,
      });
      const res = await fetchFn(`${env.nimBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.nimApiKey}`,
        },
        body: JSON.stringify(body),
        signal: args.signal,
      });
      const providerHttpStatus = validateProviderHttpStatus(res.status);
      if (!res.ok) {
        const boundaryError: Record<string, unknown> = {
          statusCode: providerHttpStatus,
          headers: res.headers,
          configuredModelId: args.modelId,
        };
        attachProviderHttpStatusBoundary(boundaryError, providerHttpStatus);
        throw mapNimError(boundaryError);
      }
      let json: NimResponse;
      try {
        json = (await res.json()) as NimResponse;
      } catch (error) {
        attachProviderHttpStatusBoundary(error, providerHttpStatus);
        throw error;
      }
      const choice = json.choices?.[0];
      const msg = choice?.message;
      const text = msg?.content ? extractText(msg.content) : "";
      const finishReason = toFinishReason(choice?.finish_reason);
      const usage = toTokenUsage(json.usage);
      const shape = contentDiagnostics(msg?.content);
      const reasoningBytes = reasoningContentBytes(msg);
      const reasoningHash = reasoningContentHash(msg);
      const completion: ProviderCompletion = {
        text,
        toolCalls: parseToolCalls(msg),
        usage,
        ...(providerHttpStatus !== undefined ? { providerHttpStatus } : {}),
        providerModel:
          typeof json.model === "string" ? json.model : null,
        finishReason,
        responseDiagnostics: {
          ...shape,
          finalTextBytes: Buffer.byteLength(text, "utf8"),
          finishReason,
          finishReasonClass: finishReasonClass(finishReason),
          outputTokenLimit: args.options.maxTokens ?? 2048,
          outputTokens: usage?.completionTokens ?? null,
          reasoningTokens: usage?.reasoningTokens ?? null,
          ...(reasoningBytes !== undefined
            ? { reasoningContentBytes: reasoningBytes }
            : {}),
          ...(reasoningHash ? { reasoningHash } : {}),
        },
        wireEvidence,
      };
      return completion;
    },
  };
}
