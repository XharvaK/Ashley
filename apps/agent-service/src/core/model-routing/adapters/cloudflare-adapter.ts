import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { sha256Text } from "../../model-fabric/hash.js";
import {
  attachProviderBoundaryTransport,
  attachProviderHttpStatusBoundary,
  PROVIDER_BOUNDARY_TRANSPORT_ABSENT,
  providerHttpStatusFromBoundary,
  validateProviderHttpStatus,
} from "../types.js";
import type {
  ChatMessage,
  CompletionOptions,
  ModelProviderAdapter,
  ProviderBoundaryTransport,
  ProviderCompletion,
  ProviderDispatchArgs,
  ProviderFinishReasonClass,
  ProviderResponseDiagnostics,
  TokenUsage,
  ToolCallResult,
  TrustedReasoningControl,
} from "../types.js";
import type { TrustedStructuredOutputControl } from "../../model-fabric/types.js";
import { wireEvidenceFor } from "../../model-fabric/wire-evidence.js";
import { thoughtOutputDeepSeekJsonObjectInstruction } from "../../cognitive-v021/thought/output-contract.js";

const CLOUDFLARE_MODEL = "@cf/nvidia/nemotron-3-120b-a12b";
const DEEPSEEK_THOUGHT_MODEL = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const THOUGHT_SEMANTIC_CONTRACT_ID = "ashley.thought.semantic.v2";
const THOUGHT_SEMANTIC_SCHEMA_ID = "ashley.thought.semantic.v2.schema";
const THOUGHT_AFFINITY_POLICY = "cloudflare_thought_route_affinity_v1" as const;
const SESSION_AFFINITY_HEADER = "x-session-affinity";
/**
 * Exact finite allowlist of the currently qualified Cloudflare DeepSeek
 * Thought-route bindings whose authoritative dispatched ownership is the
 * Thought route (portfolio current-compatibility.v3.json):
 * main interactive/durable Thought, Thought Observation, Reflection.
 * No other binding is eligible, including any invented future binding.
 */
const THOUGHT_ROUTE_AFFINITY_BINDINGS: ReadonlySet<string> = new Set([
  "compat_thought_cloudflare_deepseek_v4_flash_json_object_v1",
  "compat_thought_observation_cloudflare_deepseek_v4_flash_json_object_v1",
  "compat_reflection_cloudflare_deepseek_v4_flash_json_object_v1",
]);
const CLOUDFLARE_ERROR_CODE_BOUNDARY = "__ashley_cloudflare_error_code" as const;
const CLOUDFLARE_ERROR_CLASS_BOUNDARY = "__ashley_cloudflare_error_class" as const;
const CLOUDFLARE_ERROR_MESSAGE_BOUNDARY = "__ashley_cloudflare_error_message" as const;

type CloudflareMessage = {
  content?: unknown;
  /** Provider-hidden reasoning; never copied into Thought semantic text. */
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type CloudflareUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  cached_tokens?: unknown;
  neurons?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown };
  completion_tokens_details?: { reasoning_tokens?: unknown };
};

type CloudflareResponse = {
  id?: unknown;
  choices?: Array<{
    message?: CloudflareMessage;
    finish_reason?: unknown;
  }>;
  usage?: CloudflareUsage;
  model?: unknown;
};

function isDeepSeekThoughtJsonObject(
  model: string,
  structuredOutput?: TrustedStructuredOutputControl,
): boolean {
  return model === DEEPSEEK_THOUGHT_MODEL
    && structuredOutput?.kind === "json_object_compatibility"
    && structuredOutput.contractId === THOUGHT_SEMANTIC_CONTRACT_ID
    && structuredOutput.schemaId === THOUGHT_SEMANTIC_SCHEMA_ID;
}

/**
 * True only for the exact current Cloudflare DeepSeek Thought wire: the
 * configured DeepSeek model plus a trusted json_object_compatibility Thought
 * control whose binding belongs to the finite allowlist of currently
 * qualified Thought-route bindings (main, observation, reflection).
 * Grounded in Model Fabric translation facts available at the adapter
 * boundary — never in message contents or caller claims. Model alone is
 * never sufficient, and no binding outside the allowlist is accepted.
 */
export function isThoughtRouteAffinityEligible(
  model: string,
  structuredOutput?: TrustedStructuredOutputControl,
): boolean {
  const bindingId = structuredOutput?.bindingId;
  return isDeepSeekThoughtJsonObject(model, structuredOutput)
    && typeof bindingId === "string"
    && THOUGHT_ROUTE_AFFINITY_BINDINGS.has(bindingId);
}

export type ThoughtRouteAffinityResolution = Readonly<{
  /** True only when the outgoing fetch will carry the affinity header. */
  applied: boolean;
  /** Observed transport truth for this attempt; never the raw identifier. */
  transport: ProviderBoundaryTransport;
  /** Configured opaque identifier; header use only, never persisted. */
  value: string | null;
}>;

/**
 * Resolve affinity for one dispatch. The identifier is Host/operator
 * configuration read at dispatch time; eligibility is trusted translation
 * state. Anything other than eligible-plus-configured resolves to absent.
 */
export function resolveThoughtRouteAffinity(
  model: string,
  structuredOutput?: TrustedStructuredOutputControl,
): ThoughtRouteAffinityResolution {
  const configured = env.cloudflareThoughtAffinityId;
  if (!isThoughtRouteAffinityEligible(model, structuredOutput) || !configured) {
    return {
      applied: false,
      transport: PROVIDER_BOUNDARY_TRANSPORT_ABSENT,
      value: null,
    };
  }
  return {
    applied: true,
    transport: Object.freeze({
      sessionAffinityApplied: true,
      affinityPolicy: THOUGHT_AFFINITY_POLICY,
    }),
    value: configured,
  };
}

function messagesForCloudflareWire(
  messages: ChatMessage[],
  model: string,
  structuredOutput?: TrustedStructuredOutputControl,
): ChatMessage[] {
  if (!isDeepSeekThoughtJsonObject(model, structuredOutput)) return messages;
  const protocol = thoughtOutputDeepSeekJsonObjectInstruction();
  const systemIndex = messages.findIndex((message) => message.role === "system");
  if (systemIndex < 0) {
    return [{ role: "system", content: protocol }, ...messages];
  }
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${protocol}\n\n${message.content}` }
    : message);
}

export type CloudflareFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  json(): Promise<unknown>;
}>;

type CloudflareFailureClass =
  | "free_plan_restriction"
  | "daily_quota_exhausted"
  | "out_of_capacity"
  | "structured_output_failure"
  | "authentication"
  | "invalid_request"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_failure";

function defineBoundaryValue(
  error: unknown,
  key: string,
  value: unknown,
): void {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return;
  Object.defineProperty(error, key, {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  });
}

function boundaryValue(error: unknown, key: string): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[key];
}

export function cloudflareErrorCodeFromBoundary(error: unknown): string | undefined {
  const value = boundaryValue(error, CLOUDFLARE_ERROR_CODE_BOUNDARY);
  return typeof value === "string" ? value : undefined;
}

export function cloudflareErrorClassFromBoundary(
  error: unknown,
): CloudflareFailureClass | undefined {
  const value = boundaryValue(error, CLOUDFLARE_ERROR_CLASS_BOUNDARY);
  return typeof value === "string" ? value as CloudflareFailureClass : undefined;
}

function parseNonNegativeInteger(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0
    ? raw
    : undefined;
}

function toTokenUsage(raw: unknown, headers: Headers): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as CloudflareUsage;
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return undefined;
  }
  const result: TokenUsage = { promptTokens, completionTokens };
  const totalTokens = parseNonNegativeInteger(usage.total_tokens);
  if (totalTokens !== undefined) result.totalTokens = totalTokens;
  const cachedTokens = parseNonNegativeInteger(
    usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens,
  );
  if (cachedTokens !== undefined) result.cachedTokens = cachedTokens;
  const reasoningTokens = parseNonNegativeInteger(
    usage.completion_tokens_details?.reasoning_tokens,
  );
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens;
  const headerNeurons = headers.get("cf-ai-neurons");
  const neuronUsage = parseNonNegativeInteger(
    usage.neurons ?? (headerNeurons === null ? undefined : Number(headerNeurons)),
  );
  if (neuronUsage !== undefined) result.neuronUsage = neuronUsage;
  return result;
}

const FINISH_REASONS = new Set(["stop", "length", "tool_calls", "content_filter"]);

function toFinishReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 32);
  return FINISH_REASONS.has(value) ? value : "other";
}

function finishReasonClass(finishReason: string | null): ProviderFinishReasonClass {
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
  if (content === null || content === undefined) {
    return {
      contentContainerType: content === null ? "null" : "unknown",
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
    if (!chunk || typeof chunk !== "object") {
      contentChunkTypes.push("<invalid>");
      if (extractionFailure === "none") extractionFailure = "malformed_chunk";
      continue;
    }
    const record = chunk as { type?: unknown; text?: unknown };
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

function reasoningContentBytes(message: CloudflareMessage | undefined): number | undefined {
  const value = message?.reasoning_content ?? message?.reasoning;
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : undefined;
}

function reasoningContentHash(message: CloudflareMessage | undefined): `sha256:${string}` | undefined {
  const value = message?.reasoning_content ?? message?.reasoning;
  return typeof value === "string" ? `sha256:${sha256Text(value)}` : undefined;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((chunk): chunk is { type?: unknown; text?: unknown } =>
      Boolean(chunk) && typeof chunk === "object",
    )
    .filter((chunk) => chunk.type === "text" || chunk.type === undefined)
    .map((chunk) => (typeof chunk.text === "string" ? chunk.text : ""))
    .join("");
}

function parseToolCalls(message: CloudflareMessage | undefined): ToolCallResult[] | undefined {
  if (!Array.isArray(message?.tool_calls)) return undefined;
  const toolCalls: ToolCallResult[] = [];
  for (const toolCall of message.tool_calls) {
    if (!toolCall || toolCall.type !== "function") continue;
    const fn = toolCall.function;
    if (fn && typeof fn.name === "string") {
      toolCalls.push({
        id: toolCall.id,
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

function buildRequestBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
  fabricReasoning?: TrustedReasoningControl,
  fabricStructuredOutput?: TrustedStructuredOutputControl,
): Record<string, unknown> {
  const wireMessages = messagesForCloudflareWire(messages, model, fabricStructuredOutput);
  const deepSeekThoughtJsonObject = isDeepSeekThoughtJsonObject(model, fabricStructuredOutput);
  const body: Record<string, unknown> = {
    model,
    messages: wireMessages.map((message) => ({
      role: message.role,
      content: message.imageUrls?.length
        ? [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...message.imageUrls.map((url) => ({ type: "image_url", imageUrl: url })),
          ]
        : message.content,
    })),
    max_completion_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
  };
  if (options.tools && options.tools.length > 0) body.tools = options.tools;
  if (options.toolChoice) body.tool_choice = options.toolChoice;
  if (options.presencePenalty !== undefined) body.presence_penalty = options.presencePenalty;

  const reasoning = fabricReasoning ?? (
    options.reasoningEffort
      ? { kind: "reasoning_effort", value: options.reasoningEffort } as const
      : undefined
  );
  if (reasoning?.kind === "chat_template_thinking") {
    throw new AppError(
      "capability_mismatch",
      "Cloudflare reasoning control is not supported for this model",
      400,
    );
  }
  if (reasoning?.kind === "reasoning_effort") {
    body.reasoning_effort = reasoning.value;
    if (model === CLOUDFLARE_MODEL && reasoning.value === "high") {
      body.reasoning_budget = 1024;
    }
  }

  if (deepSeekThoughtJsonObject || fabricStructuredOutput?.kind === "json_object_compatibility") {
    body.response_format = { type: "json_object" };
  } else if (fabricStructuredOutput?.kind === "native_json_schema") {
    if (fabricStructuredOutput.wireFormat !== "cloudflare_response_format_json_schema") {
      throw new AppError(
        "capability_mismatch",
        "Cloudflare structured-output binding is invalid",
        400,
      );
    }
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: fabricStructuredOutput.schemaId,
        strict: true,
        schema: fabricStructuredOutput.schema,
      },
    };
  } else if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  } else if (options.responseFormat === "json_schema") {
    throw Object.assign(new Error("structured_output_untrusted"), {
      code: "structured_output_untrusted",
    });
  }
  return body;
}

/**
 * Count the current Cloudflare request bytes that are not represented by the
 * logical role/content text or the separately-accounted tools JSON. The
 * Attention estimator adds its conservative framing overhead exactly once.
 */
export function cloudflareRequestWireAdditionalBytes(input: {
  body: Record<string, unknown>;
  toolsJson?: string;
}): number {
  const bodyWithoutMessages = { ...input.body };
  delete bodyWithoutMessages.messages;
  let bytes = Buffer.byteLength(JSON.stringify(bodyWithoutMessages), "utf8");
  if (input.toolsJson) {
    bytes = Math.max(0, bytes - Buffer.byteLength(input.toolsJson, "utf8"));
  }
  return bytes;
}

export function buildCloudflareRequestBody(
  messages: ChatMessage[],
  options: CompletionOptions,
  model: string,
  fabricReasoning?: TrustedReasoningControl,
  fabricStructuredOutput?: TrustedStructuredOutputControl,
): Record<string, unknown> {
  return buildRequestBody(messages, options, model, fabricReasoning, fabricStructuredOutput);
}

function parseRetryAfterSec(headers?: Headers): number | undefined {
  const raw = headers?.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { statusCode?: unknown; status?: unknown };
  const result = value.statusCode ?? value.status;
  return typeof result === "number" && Number.isFinite(result) ? result : undefined;
}

function messageFrom(error: unknown): string {
  const boundary = boundaryValue(error, CLOUDFLARE_ERROR_MESSAGE_BOUNDARY);
  if (typeof boundary === "string") return boundary;
  if (error instanceof Error) return error.message;
  return typeof (error as { message?: unknown })?.message === "string"
    ? (error as { message: string }).message
    : String(error);
}

function attachCloudflareFailureMetadata(
  error: unknown,
  code: string | undefined,
  failureClass: CloudflareFailureClass | undefined,
  message?: string,
): void {
  if (code) defineBoundaryValue(error, CLOUDFLARE_ERROR_CODE_BOUNDARY, code.slice(0, 32));
  if (failureClass) defineBoundaryValue(error, CLOUDFLARE_ERROR_CLASS_BOUNDARY, failureClass);
  if (message) defineBoundaryValue(error, CLOUDFLARE_ERROR_MESSAGE_BOUNDARY, message.slice(0, 256));
}

function classifyFailure(
  status: number | undefined,
  providerCode: string | undefined,
  message: string,
): CloudflareFailureClass {
  const code = providerCode?.toLowerCase();
  if (code === "5035" || (status === 403 && /free.?plan|plan restriction|not available/i.test(message))) {
    return "free_plan_restriction";
  }
  if (code === "3036" || (status === 429 && /daily|quota|limit exceeded/i.test(message))) {
    return "daily_quota_exhausted";
  }
  if (code === "3040" || /out of capacity|capacity/i.test(message)) return "out_of_capacity";
  if (/json|schema|response.?format|structured|valid output/i.test(message)) {
    return "structured_output_failure";
  }
  if (status === 401 || (status === 403 && /auth|token|permission|credential/i.test(message))) {
    return "authentication";
  }
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 429 || /rate.?limit|too many requests/i.test(message)) return "rate_limited";
  if (
    (status !== undefined && status >= 500) ||
    /timeout|unavailable|fetch failed|network|socket|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(message)
  ) {
    return "provider_unavailable";
  }
  return "provider_failure";
}

function mapFailureClass(
  failureClass: CloudflareFailureClass,
  headers?: Headers,
): AppError {
  switch (failureClass) {
    case "free_plan_restriction":
      return new AppError("capability_mismatch", "Cloudflare Workers AI plan does not permit this model", 403);
    case "daily_quota_exhausted":
      return new AppError("quota_exhausted", "Cloudflare Workers AI daily quota exhausted", 429, parseRetryAfterSec(headers));
    case "out_of_capacity":
      return new AppError("provider_unavailable", "Cloudflare Workers AI is out of capacity", 503, parseRetryAfterSec(headers));
    case "structured_output_failure":
      return new AppError("capability_mismatch", "Cloudflare structured JSON output was not satisfied", 502);
    case "authentication":
      return new AppError("credential_invalid", "Cloudflare Workers AI authentication failed", 401, undefined, "account");
    case "invalid_request":
      return new AppError("bad_request", "Cloudflare Workers AI rejected the request", 400);
    case "rate_limited":
      return new AppError("rate_limited", "Cloudflare Workers AI rate limited", 429, parseRetryAfterSec(headers) ?? 30);
    case "provider_unavailable":
      return new AppError("provider_unavailable", "Cloudflare Workers AI unavailable", 503, parseRetryAfterSec(headers));
    default:
      return new AppError("internal_error", "Cloudflare Workers AI request failed", 500);
  }
}

export function mapCloudflareError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw error;
  const status = statusCode(error);
  const providerHttpStatus = providerHttpStatusFromBoundary(error);
  const providerCode = cloudflareErrorCodeFromBoundary(error);
  const message = messageFrom(error);
  const failureClass = cloudflareErrorClassFromBoundary(error)
    ?? classifyFailure(status, providerCode, message);
  const mapped = mapFailureClass(failureClass, boundaryValue(error, "headers") as Headers | undefined);
  attachProviderHttpStatusBoundary(mapped, providerHttpStatus);
  attachCloudflareFailureMetadata(mapped, providerCode, failureClass);
  const configuredModelId =
    error && typeof error === "object" && typeof (error as { configuredModelId?: unknown }).configuredModelId === "string"
      ? (error as { configuredModelId: string }).configuredModelId
      : undefined;
  console.error("[cloudflare]", {
    provider: "cloudflare",
    ...(configuredModelId ? { model: configuredModelId } : {}),
    ...(providerHttpStatus !== undefined ? { providerHttpStatus } : {}),
    ...(providerCode ? { providerErrorCode: providerCode } : {}),
    providerFailureClass: failureClass,
    code: mapped.code,
  });
  return mapped;
}

function extractProviderError(body: unknown): { code?: string; message?: string } {
  if (!body || typeof body !== "object") return {};
  const root = body as Record<string, unknown>;
  const first = Array.isArray(root.errors) && root.errors[0] && typeof root.errors[0] === "object"
    ? root.errors[0] as Record<string, unknown>
    : undefined;
  const error = root.error && typeof root.error === "object"
    ? root.error as Record<string, unknown>
    : undefined;
  const code = first?.code ?? error?.code ?? root.code;
  const message = first?.message ?? error?.message ?? root.message;
  return {
    ...(code !== undefined ? { code: String(code).slice(0, 32) } : {}),
    ...(typeof message === "string" ? { message: message.slice(0, 256) } : {}),
  };
}

async function providerFailure(
  response: { readonly status: number; readonly headers: Headers; json(): Promise<unknown> },
  configuredModelId: string,
): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = extractProviderError(body);
  const providerHttpStatus = validateProviderHttpStatus(response.status);
  const boundaryError: Record<string, unknown> = {
    statusCode: providerHttpStatus,
    headers: response.headers,
    configuredModelId,
  };
  attachProviderHttpStatusBoundary(boundaryError, providerHttpStatus);
  const failureClass = classifyFailure(providerHttpStatus, parsed.code, parsed.message ?? "");
  attachCloudflareFailureMetadata(boundaryError, parsed.code, failureClass, parsed.message);
  throw mapCloudflareError(boundaryError);
}

export function createCloudflareAdapter(
  fetchFn: CloudflareFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
): ModelProviderAdapter {
  return {
    provider: "cloudflare",
    async dispatch(args: ProviderDispatchArgs) {
      if (!env.cloudflareApiToken || !env.cloudflareAccountId) {
        throw new AppError("agent_not_ready", "Cloudflare Workers AI credentials not configured", 503);
      }
      const body = buildRequestBody(
        args.messages,
        args.options,
        args.modelId,
        args.fabricReasoning,
        args.fabricStructuredOutput,
      );
      const requestWireBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
      const requestWireAdditionalBytes = cloudflareRequestWireAdditionalBytes({
        body,
        toolsJson: args.options.tools ? JSON.stringify(args.options.tools) : undefined,
      });
      const wireEvidence = wireEvidenceFor({
        adapterId: "ashley.adapter.cloudflare.v1",
        body,
        structuredOutput: args.fabricStructuredOutput,
      });
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.cloudflareAccountId)}/ai/v1/chat/completions`;
      // Affinity is transport metadata only: the body above is already final
      // and byte-identical whether or not the header below is attached.
      const affinity = resolveThoughtRouteAffinity(args.modelId, args.fabricStructuredOutput);
      const transport = affinity.transport;
      try {
        const response = await fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.cloudflareApiToken}`,
            ...(affinity.applied && affinity.value !== null
              ? { [SESSION_AFFINITY_HEADER]: affinity.value }
              : {}),
          },
          body: JSON.stringify(body),
          signal: args.signal,
        });
        const providerHttpStatus = validateProviderHttpStatus(response.status);
      if (!response.ok) {
        await providerFailure(response, args.modelId);
      }
      let json: CloudflareResponse;
      try {
        json = await response.json() as CloudflareResponse;
      } catch (error) {
        attachProviderHttpStatusBoundary(error, providerHttpStatus);
        throw error;
      }
      const choice = json.choices?.[0];
      const message = choice?.message;
      const text = extractText(message?.content);
      const finishReason = toFinishReason(choice?.finish_reason);
      const usage = toTokenUsage(json.usage, response.headers);
      // P3 S5: read-only cf-ray surfacing for attempt diagnostics. The raw
      // header value is bounded and never sent anywhere; absent ⇒ null.
      const cfRayRaw = response.headers.get("cf-ray");
      const cfRay = typeof cfRayRaw === "string" && cfRayRaw.trim()
        ? cfRayRaw.trim().slice(0, 64)
        : null;
      const shape = contentDiagnostics(message?.content);
      const reasoningBytes = reasoningContentBytes(message);
      const reasoningHash = reasoningContentHash(message);
      return {
        text,
        toolCalls: parseToolCalls(message),
        usage,
        ...(providerHttpStatus !== undefined ? { providerHttpStatus } : {}),
        providerModel: typeof json.model === "string" ? json.model : null,
        providerRequestId: typeof json.id === "string" ? json.id : null,
        cfRay,
        finishReason,
        responseDiagnostics: {
          ...shape,
          finalTextBytes: Buffer.byteLength(text, "utf8"),
          finishReason,
          finishReasonClass: finishReasonClass(finishReason),
          outputTokenLimit: args.options.maxTokens ?? 2048,
          outputTokens: usage?.completionTokens ?? null,
          reasoningTokens: usage?.reasoningTokens ?? null,
          requestWireBytes,
          requestWireAdditionalBytes,
          ...(reasoningBytes !== undefined ? { reasoningContentBytes: reasoningBytes } : {}),
          ...(reasoningHash ? { reasoningHash } : {}),
        },
        wireEvidence,
        providerBoundaryTransport: transport,
      } satisfies ProviderCompletion;
      } catch (error) {
        // The fetch above was constructed/invoked with the resolved
        // transport, so the observed applied/policy truth survives HTTP
        // failures, transport errors, and deadline/cancellation paths.
        // The raw affinity identifier is never attached to the error.
        attachProviderBoundaryTransport(error, transport);
        throw error;
      }
    },
  };
}
