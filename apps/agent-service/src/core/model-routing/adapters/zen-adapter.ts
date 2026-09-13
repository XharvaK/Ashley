import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import type {
  ChatMessage,
  CompletionOptions,
  ModelProviderAdapter,
  ProviderCompletion,
  ProviderDispatchArgs,
  TokenUsage,
} from "../types.js";
import { wireEvidenceFor } from "../../model-fabric/wire-evidence.js";

type ZenErrorResponse = {
  error?: { message?: string; type?: string };
};

type ZenResponse = {
  choices?: Array<{
    message?: { content?: string | Array<unknown> };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  model?: string;
};

export type ZenFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  json(): Promise<unknown>;
}>;

export type ZenAdapterConfig = {
  endpoint?: "chat_completions" | "responses";
  privacyMode?: "free_utility" | "qualified_owner_private";
};

function statusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const value = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
  };
  for (const candidate of [
    value.status,
    value.statusCode,
    value.response?.status,
    value.response?.statusCode,
  ]) {
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 400 &&
      candidate <= 599
    ) {
      return candidate;
    }
  }
  return undefined;
}

function parseRetryAfterSec(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const value = err as {
    headers?: Headers | Record<string, string>;
    response?: { headers?: Headers | Record<string, string> };
  };
  const headers = value.headers ?? value.response?.headers;
  if (!headers) return undefined;
  const raw =
    typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("retry-after")
      : (headers as Record<string, string>)["retry-after"] ??
        (headers as Record<string, string>)["Retry-After"];
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  return undefined;
}

export function mapZenError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    throw err;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);
  const status = statusCode(err);
  console.error("[opencode_zen]", status ?? "no-status", message.slice(0, 300));
  if (status === 429 || /429|rate.?limit/i.test(message)) {
    return new AppError(
      "rate_limited",
      "OpenCode Zen rate limited",
      429,
      parseRetryAfterSec(err) ?? 30,
    );
  }
  if (
    (status !== undefined && status >= 500) ||
    /fetch failed|5\d{2}|unavailable|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(
      message,
    )
  ) {
    return new AppError(
      "provider_unavailable",
      "OpenCode Zen unavailable",
      503,
      parseRetryAfterSec(err),
    );
  }
  return new AppError("internal_error", "OpenCode Zen request failed", 502);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type?: string; text?: string } =>
        typeof part === "object" && part !== null,
    )
    .filter((part) => part.type === "text" || !part.type)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function toTokenUsage(raw: ZenResponse["usage"]): TokenUsage | undefined {
  if (!raw) return undefined;
  const promptTokens = Number(raw.prompt_tokens);
  const completionTokens = Number(raw.completion_tokens);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return undefined;
  }
  return { promptTokens, completionTokens };
}

function finishReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 32);
  return ["stop", "length", "content_filter"].includes(value)
    ? value
    : "other";
}

function buildRequestBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.imageUrls?.length
        ? [
            ...(message.content
              ? [{ type: "text", text: message.content }]
              : []),
            ...message.imageUrls.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ]
        : message.content,
    })),
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
  };
  if (options.presencePenalty !== undefined) {
    body.presence_penalty = options.presencePenalty;
  }
  if (options.reasoningEffort !== undefined && options.reasoningEffort !== "none") {
    body.reasoning_effort = options.reasoningEffort;
  }
  if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }
  return body;
}

export function createZenAdapter(
  fetchFn: ZenFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
  config: ZenAdapterConfig = {},
): ModelProviderAdapter {
  return {
    provider: "opencode_zen",
    async dispatch(args: ProviderDispatchArgs): Promise<ProviderCompletion> {
      if (!env.opencodeZenApiKey) {
        throw new AppError(
          "agent_not_ready",
          "OpenCode Zen API key not configured",
          503,
        );
      }
      if (config.endpoint !== undefined && config.endpoint !== "chat_completions") {
        throw new AppError(
          "capability_mismatch",
          "OpenCode Zen responses endpoint is not supported by this adapter",
          400,
        );
      }
      if ((args.options.tools?.length ?? 0) > 0 || args.options.toolChoice !== undefined) {
        throw new AppError(
          "capability_mismatch",
          "OpenCode Zen utility dispatch does not support tools",
          400,
        );
      }
      if (args.fabricStructuredOutput) {
        throw new AppError(
          "capability_mismatch",
          "OpenCode Zen adapter does not support the Thought structured-output contract",
          400,
        );
      }
      if (
        args.options.projectionClassification === "owner_private" &&
        config.privacyMode !== "qualified_owner_private"
      ) {
        throw new AppError(
          "capability_mismatch",
          "OpenCode Zen free utility backend cannot receive owner-private projections",
          400,
        );
      }

      let response: Awaited<ReturnType<ZenFetch>>;
      try {
        response = await fetchFn(
          `${env.opencodeZenBaseUrl.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.opencodeZenApiKey}`,
            },
            body: JSON.stringify(buildRequestBody(args.messages, args.options, args.modelId)),
            signal: args.signal,
          },
        );
      } catch (error) {
        throw mapZenError(error);
      }

      if (!response.ok) {
        let detail = `zen_error:${response.status}`;
        try {
          const errorBody = (await response.json()) as ZenErrorResponse;
          if (typeof errorBody.error?.message === "string") {
            detail = errorBody.error.message.slice(0, 300);
          }
        } catch {
          /* The provider returned no readable JSON error body. */
        }
        throw mapZenError({
          statusCode: response.status,
          headers: response.headers,
          message: detail,
        });
      }

      let json: ZenResponse;
      try {
        json = (await response.json()) as ZenResponse;
      } catch {
        throw new AppError(
          "internal_error",
          "OpenCode Zen returned malformed JSON",
          502,
        );
      }
      const choice = json.choices?.[0];
      const body = buildRequestBody(args.messages, args.options, args.modelId);
      return {
        text: extractText(choice?.message?.content),
        usage: toTokenUsage(json.usage),
        providerModel: typeof json.model === "string" ? json.model : null,
        finishReason: finishReason(choice?.finish_reason),
        toolCalls: undefined,
        wireEvidence: wireEvidenceFor({
          adapterId: "ashley.adapter.opencode-zen.v1",
          body,
        }),
      };
    },
  };
}
