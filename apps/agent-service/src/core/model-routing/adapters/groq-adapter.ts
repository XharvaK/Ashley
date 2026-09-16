import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import type {
  ChatMessage,
  CompletionOptions,
  ModelProviderAdapter,
  ProviderCompletion,
  TokenUsage,
  ToolCallResult,
  ProviderDispatchArgs,
} from "../types.js";
import type { TrustedStructuredOutputControl } from "../../model-fabric/types.js";
import { wireEvidenceFor } from "../../model-fabric/wire-evidence.js";
import type { TrustedReasoningControl } from "../types.js";
import { redactSecretShapes } from "../../privacy/redact-logs.js";

type GroqErrorResponse = {
  error?: { type?: string; message?: string };
};

type GroqMessage = {
  content?: string | Array<unknown>;
  /** gpt-oss hidden reasoning — never copied into Thought JSON text. */
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type GroqChoice = { message?: GroqMessage; finish_reason?: string };

type GroqUsage = {
  prompt_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

type GroqResponse = {
  choices?: GroqChoice[];
  usage?: GroqUsage;
  model?: string;
};

const QWEN_3_6_MODEL = "qwen/qwen3.6-27b";
const QWEN_3_8_MODEL = "qwen/qwen3.8-27b";

function toTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as GroqUsage;
  const promptTokens = Number(r.prompt_tokens);
  const completionTokens = Number(r.completion_tokens);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return undefined;
  }
  const reasoningRaw = Number(r.completion_tokens_details?.reasoning_tokens);
  const usage: TokenUsage = { promptTokens, completionTokens };
  const cachedRaw = r.prompt_tokens_details?.cached_tokens;
  if (typeof cachedRaw === "number" && Number.isFinite(cachedRaw) && cachedRaw >= 0) {
    usage.cachedTokens = cachedRaw;
  }
  if (Number.isFinite(reasoningRaw) && reasoningRaw >= 0) {
    usage.reasoningTokens = reasoningRaw;
  }
  return usage;
}

const FINISH_REASONS = new Set(["stop", "length", "tool_calls", "content_filter"]);

function toFinishReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 32);
  return FINISH_REASONS.has(value) ? value : "other";
}

function buildRequestBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
  fabricStructuredOutput?: TrustedStructuredOutputControl,
  fabricReasoning?: TrustedReasoningControl,
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
    if (fabricReasoning.kind === "groq_reasoning_effort") {
      const expectedEffort =
        model === QWEN_3_6_MODEL
          ? "default"
          : model === QWEN_3_8_MODEL
            ? "medium"
            : undefined;
      if (
        expectedEffort === undefined ||
        fabricReasoning.value !== expectedEffort ||
        fabricReasoning.reasoningFormat !== "hidden"
      ) {
        throw Object.assign(new Error("groq_reasoning_control_mismatch"), {
          code: "groq_reasoning_control_mismatch",
        });
      }
      body.reasoning_effort = expectedEffort;
      body.reasoning_format = "hidden";
    } else if (fabricReasoning.kind === "reasoning_effort") {
      if (model === QWEN_3_8_MODEL && fabricReasoning.value !== "none") {
        throw Object.assign(new Error("groq_reasoning_control_mismatch"), {
          code: "groq_reasoning_control_mismatch",
        });
      }
      const effort = groqReasoningEffortForModel(model, fabricReasoning.value);
      if (effort === undefined) {
        throw Object.assign(new Error("groq_reasoning_effort_unsupported"), {
          code: "groq_reasoning_effort_unsupported",
        });
      }
      body.reasoning_effort = effort;
    } else {
      throw Object.assign(new Error("groq_reasoning_control_mismatch"), {
        code: "groq_reasoning_control_mismatch",
      });
    }
  } else if (options.reasoningEffort !== undefined) {
    const effort = groqReasoningEffortForModel(model, options.reasoningEffort);
    if (effort === undefined) {
      throw Object.assign(new Error("groq_reasoning_effort_unsupported"), {
        code: "groq_reasoning_effort_unsupported",
      });
    }
    body.reasoning_effort = effort;
    if (model === QWEN_3_8_MODEL && effort === "medium") {
      body.reasoning_format = "hidden";
    }
  }
  if (fabricStructuredOutput) {
    if (fabricStructuredOutput.kind === "json_object_compatibility") {
      body.response_format = { type: "json_object" };
    } else {
      throw Object.assign(new Error("structured_output_native_unsupported"), {
        code: "structured_output_native_unsupported",
      });
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
 * gpt-oss accepts only low|medium|high. Qwen 3.6 accepts only none/default,
 * while Qwen 3.8 accepts only none/medium. The caller-facing
 * CompletionOptions type intentionally does not admit the Qwen 3.6-only
 * default value.
 */
export function groqReasoningEffortForModel(
  modelId: string,
  requested: NonNullable<CompletionOptions["reasoningEffort"]>,
): "none" | "low" | "medium" | "high" | undefined {
  if (modelId === QWEN_3_6_MODEL) {
    return requested === "none" ? "none" : undefined;
  }
  if (modelId === QWEN_3_8_MODEL) {
    return requested === "none" || requested === "medium" ? requested : undefined;
  }
  if (modelId.startsWith("openai/gpt-oss")) {
    if (requested === "none") return "low";
    return requested;
  }
  return requested;
}

function redactKnownSecrets(text: string, secrets: readonly string[]): string {
  let safe = redactSecretShapes(text);
  for (const secret of secrets) {
    if (secret.length > 0) safe = safe.split(secret).join("[redacted-credential]");
  }
  return safe;
}

export function mapGroqError(err: unknown, knownSecrets: readonly string[] = []): AppError {
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
  const msg = redactKnownSecrets(rawMessage, knownSecrets);
  const status = statusCode(err);
  console.error("[groq]", status ?? "no-status", msg.slice(0, 500));

  if (status === 429 || /429|rate.?limit/i.test(msg)) {
    return new AppError(
      "rate_limited",
      "Groq rate limited",
      429,
      parseRetryAfterSec(err) ?? 30,
    );
  }
  if (
    (status !== undefined && status >= 500) ||
    /5\d{2}|unavailable|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(msg)
  ) {
    return new AppError(
      "provider_unavailable",
      "Groq unavailable",
      503,
      parseRetryAfterSec(err),
    );
  }
  return new AppError("internal_error", "Groq request failed", 500);
}

function stripHiddenReasoning(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "");
}

function extractText(content: unknown, hiddenReasoning = false): string {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
      .filter(
        (c): c is { type?: string; text?: string } =>
          typeof c === "object" && c !== null,
      )
      .filter((c) => c.type === "text" || !c.type)
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join("")
      : "";
  return hiddenReasoning ? stripHiddenReasoning(text) : text;
}

function parseToolCalls(
  message: GroqMessage | undefined,
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

export type GroqFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  json(): Promise<unknown>;
}>;

export function createGroqAdapter(
  fetchFn: GroqFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
): ModelProviderAdapter {
  return {
    provider: "groq",
    async dispatch(args: ProviderDispatchArgs) {
      if (!env.groqApiKey) {
        throw new AppError("agent_not_ready", "Groq API key not configured", 503);
      }
      const body = buildRequestBody(
        args.messages,
        args.options,
        args.modelId,
        args.fabricStructuredOutput,
        args.fabricReasoning,
      );
      const wireEvidence = wireEvidenceFor({
        adapterId: "ashley.adapter.groq.v1",
        body,
        structuredOutput: args.fabricStructuredOutput,
      });
      const res = await fetchFn(`${env.groqBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.groqApiKey}`,
        },
        body: JSON.stringify(body),
        signal: args.signal,
      });
      if (!res.ok) {
        let detail = `groq_error:${res.status}`;
        try {
          const errJson = (await res.json()) as GroqErrorResponse;
          const providerMessage = errJson.error?.message;
          if (typeof providerMessage === "string" && providerMessage.length > 0) {
            detail = providerMessage.slice(0, 300);
          }
        } catch {
          /* body not JSON */
        }
        throw mapGroqError({
          statusCode: res.status,
          headers: res.headers,
          message: detail,
        }, [env.groqApiKey]);
      }
      const json = (await res.json()) as GroqResponse;
      const choice = json.choices?.[0];
      const msg = choice?.message;
      const text = msg?.content
        ? extractText(
            msg.content,
            args.fabricReasoning?.kind === "groq_reasoning_effort" &&
              args.fabricReasoning.reasoningFormat === "hidden",
          )
        : "";
      const completion: ProviderCompletion = {
        text,
        toolCalls: parseToolCalls(msg),
        usage: toTokenUsage(json.usage),
        providerModel:
          typeof json.model === "string" ? json.model : null,
        finishReason: toFinishReason(choice?.finish_reason),
        wireEvidence,
      };
      return completion;
    },
  };
}
