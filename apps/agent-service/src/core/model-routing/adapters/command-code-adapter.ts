import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { thoughtOutputDeepSeekJsonObjectInstruction } from "../../cognitive-v021/thought/output-contract.js";
import type { TrustedStructuredOutputControl } from "../../model-fabric/types.js";
import { wireEvidenceFor } from "../../model-fabric/wire-evidence.js";
import type {
  ChatMessage,
  ModelProviderAdapter,
  ProviderCompletion,
  ProviderDispatchArgs,
  TokenUsage,
} from "../types.js";
import { attachProviderHttpStatusBoundary } from "../types.js";

export const COMMAND_CODE_MUSE_MODEL = "meta/muse-spark-1.3-contributor" as const;
export const COMMAND_CODE_CHAT_COMPLETIONS_URL =
  "https://api.commandcode.ai/provider/v1/chat/completions" as const;
const MAX_OUTPUT_TOKENS = 65_536;
const THOUGHT_CONTRACT_ID = "ashley.thought.semantic.v2";
const THOUGHT_SCHEMA_ID = "ashley.thought.semantic.v2.schema";

type CommandCodeResponse = {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
    completion_tokens_details?: { reasoning_tokens?: unknown };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function toUsage(raw: CommandCodeResponse["usage"]): TokenUsage | undefined {
  if (!raw) return undefined;
  const promptTokens = nonNegativeInteger(raw.prompt_tokens);
  const completionTokens = nonNegativeInteger(raw.completion_tokens);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  const usage: TokenUsage = { promptTokens, completionTokens };
  const totalTokens = nonNegativeInteger(raw.total_tokens);
  const cachedTokens = nonNegativeInteger(raw.prompt_tokens_details?.cached_tokens);
  const reasoningTokens = nonNegativeInteger(raw.completion_tokens_details?.reasoning_tokens);
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens;
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
  return usage;
}

function finishReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ["stop", "length", "content_filter", "tool_calls"].includes(normalized)
    ? normalized
    : "other";
}

function mapMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return [
    { role: "system", content: thoughtOutputDeepSeekJsonObjectInstruction() },
    ...messages.map((message) => ({
      role: message.role,
      content: message.imageUrls?.length
        ? [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...message.imageUrls.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ]
        : message.content,
    })),
  ];
}

function buildRequestBody(args: ProviderDispatchArgs): Record<string, unknown> {
  if (args.modelId !== COMMAND_CODE_MUSE_MODEL) {
    throw new AppError("capability_mismatch", "command_code_model_not_qualified", 400);
  }
  if (
    args.fabricReasoning?.kind !== "command_code_reasoning_effort" ||
    args.fabricReasoning.value !== "xhigh"
  ) {
    throw new AppError("capability_mismatch", "command_code_xhigh_control_required", 400);
  }
  const structured = args.fabricStructuredOutput;
  if (
    structured?.kind !== "json_object_compatibility" ||
    structured.contractId !== THOUGHT_CONTRACT_ID ||
    structured.schemaId !== THOUGHT_SCHEMA_ID
  ) {
    throw new AppError("capability_mismatch", "command_code_thought_json_compatibility_required", 400);
  }
  if (args.options.tools?.length) {
    throw new AppError("capability_mismatch", "command_code_thought_tools_unsupported", 400);
  }
  const maxTokens = args.options.maxTokens ?? MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS) {
    throw new AppError("capability_mismatch", "command_code_output_limit_unsupported", 400);
  }
  return {
    model: COMMAND_CODE_MUSE_MODEL,
    messages: mapMessages(args.messages),
    max_tokens: maxTokens,
    reasoning_effort: "xhigh",
    response_format: { type: "json_object" },
    ...(args.options.temperature !== undefined ? { temperature: args.options.temperature } : {}),
  };
}

export function commandCodeRequestWireAdditionalBytes(args: ProviderDispatchArgs): number {
  const nonMessageFields = { ...buildRequestBody(args) };
  delete nonMessageFields.messages;
  return Buffer.byteLength(JSON.stringify(nonMessageFields), "utf8");
}

function requestWireAdditionalBytes(body: Record<string, unknown>): number {
  const nonMessageFields = { ...body };
  delete nonMessageFields.messages;
  return Buffer.byteLength(JSON.stringify(nonMessageFields), "utf8");
}

function providerStatusError(status: number, headers: Headers): AppError {
  const retryAfterRaw = headers.get("retry-after");
  const retryAfterParsed = retryAfterRaw === null ? NaN : Number.parseInt(retryAfterRaw, 10);
  const retryAfterSec = Number.isSafeInteger(retryAfterParsed) && retryAfterParsed >= 0
    ? retryAfterParsed
    : undefined;
  const error = status === 401
    ? new AppError("credential_invalid", "command_code_authentication_rejected", 401, undefined, "account")
    : status === 429
      ? new AppError("rate_limited", "command_code_rate_limited", 429, retryAfterSec)
      : status === 403
        ? new AppError("provider_unavailable", "command_code_external_service_rejected_403", 503)
        : status >= 500
          ? new AppError("provider_unavailable", `command_code_http_${status}`, 503, retryAfterSec)
          : new AppError("capability_mismatch", `command_code_http_${status}`, status);
  attachProviderHttpStatusBoundary(error, status);
  return error;
}

export type CommandCodeFetch = typeof fetch;

export function mapCommandCodeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    throw error;
  }
  return new AppError("provider_unavailable", "command_code_transport_unavailable", 503);
}

export function createCommandCodeAdapter(
  fetcher: CommandCodeFetch = globalThis.fetch,
): ModelProviderAdapter {
  return {
    provider: "command_code",
    async dispatch(args): Promise<ProviderCompletion> {
      const apiKey = env.commandCodeApiKey;
      if (!apiKey) {
        throw new AppError("agent_not_ready", "Command Code Provider API credential not configured", 503);
      }
      const body = buildRequestBody(args);
      const serializedBody = JSON.stringify(body);
      const response = await fetcher(COMMAND_CODE_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: serializedBody,
        signal: args.signal ?? args.options.signal,
      });
      if (!response.ok) throw providerStatusError(response.status, response.headers);

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new AppError("provider_unavailable", "command_code_invalid_json_response", 502);
      }
      if (!isRecord(raw)) {
        throw new AppError("provider_unavailable", "command_code_invalid_response", 502);
      }
      const result = raw as CommandCodeResponse;
      const returnedModel = typeof result.model === "string" ? result.model : null;
      if (returnedModel !== COMMAND_CODE_MUSE_MODEL) {
        throw new AppError("capability_mismatch", "command_code_model_identity_mismatch", 502);
      }
      const firstChoice = Array.isArray(result.choices) ? result.choices[0] : undefined;
      const content = firstChoice?.message?.content;
      if (typeof content !== "string") {
        throw new AppError("provider_unavailable", "command_code_missing_text_content", 502);
      }
      const structured = args.fabricStructuredOutput as TrustedStructuredOutputControl;
      const wireEvidence = wireEvidenceFor({
        adapterId: "ashley.adapter.command_code.v1",
        body,
        structuredOutput: structured,
      });
      const usage = toUsage(result.usage);
      const finish = finishReason(firstChoice?.finish_reason);
      return {
        text: content,
        ...(usage ? { usage } : {}),
        providerModel: returnedModel,
        providerRequestId:
          typeof result.id === "string" && result.id.length > 0
            ? result.id
            : response.headers.get("x-request-id"),
        providerHttpStatus: response.status,
        finishReason: finish,
        responseDiagnostics: {
          contentContainerType: "string",
          contentChunkTypes: [],
          textChunkCount: 1,
          thinkingChunkCount: 0,
          finalTextBytes: Buffer.byteLength(content, "utf8"),
          finishReason: finish,
          finishReasonClass: finish === "stop"
            ? "STOP"
            : finish === "length"
              ? "LENGTH"
              : finish === "content_filter"
                ? "CONTENT_FILTER"
                : finish === "tool_calls"
                  ? "TOOL"
                  : finish === null
                    ? "UNKNOWN"
                    : "OTHER",
          outputTokenLimit: args.options.maxTokens ?? MAX_OUTPUT_TOKENS,
          outputTokens: usage?.completionTokens ?? null,
          reasoningTokens: usage?.reasoningTokens ?? null,
          requestWireBytes: Buffer.byteLength(serializedBody, "utf8"),
          requestWireAdditionalBytes: requestWireAdditionalBytes(body),
          extractionFailure: "none",
        },
        wireEvidence,
      };
    },
  };
}
