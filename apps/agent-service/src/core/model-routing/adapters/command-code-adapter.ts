import { createHash } from "node:crypto";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { thoughtOutputDeepSeekJsonObjectInstruction } from "../../cognitive-v021/thought/output-contract.js";
import {
  REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID,
  REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID,
  THOUGHT_OUTPUT_CONTRACT_ID,
  THOUGHT_OUTPUT_SCHEMA_ID,
} from "../../cognitive-v021/thought/contract-identity.js";
import { reflectionInitiativeJsonObjectInstruction } from "../../cognitive-v021/thought/reflection-output-contract.js";
import {
  VISION_MEDIA_OUTPUT_CONTRACT_ID,
  VISION_MEDIA_OUTPUT_SCHEMA_ID,
  visionMediaJsonObjectInstruction,
} from "../../cognitive-v021/perception/vision-output-contract.js";
import { COMMAND_CODE_POLICY, thoughtReasoningEffortForTrigger, type CommandCodeThoughtEffort } from "../../command-code/policy.js";
import {
  attachCommandCodeBoundaryEvidence,
  type CommandCodeBoundaryEvidence,
  type CommandCodeTransportOutcome,
} from "../../command-code/evidence.js";
import type {
  ChatMessage,
  CompletionOptions,
  ModelProviderAdapter,
  ProviderCompletion,
  ProviderDispatchArgs,
  TokenUsage,
  TrustedReasoningControl,
} from "../types.js";
import { attachProviderHttpStatusBoundary } from "../types.js";
import type { StructuredOutputRequest } from "../../model-fabric/types.js";

export const COMMAND_CODE_MUSE_MODEL = COMMAND_CODE_POLICY.modelId;
export const COMMAND_CODE_CHAT_COMPLETIONS_URL =
  "https://api.commandcode.ai/provider/v1/chat/completions" as const;
const MAX_OUTPUT_TOKENS = 65_536;

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
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
    input_tokens_details?: { cached_tokens?: unknown };
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
  const promptTokens = nonNegativeInteger(raw.prompt_tokens) ?? nonNegativeInteger(raw.input_tokens);
  const completionTokens = nonNegativeInteger(raw.completion_tokens) ?? nonNegativeInteger(raw.output_tokens);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  const usage: TokenUsage = { promptTokens, completionTokens };
  const totalTokens = nonNegativeInteger(raw.total_tokens);
  const cachedTokens = nonNegativeInteger(raw.prompt_tokens_details?.cached_tokens)
    ?? nonNegativeInteger(raw.input_tokens_details?.cached_tokens);
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

function mapMessages(
  messages: ChatMessage[],
  contract: CommandCodeContract,
): Array<Record<string, unknown>> {
  const systemInstruction = contract === "thought"
    ? thoughtOutputDeepSeekJsonObjectInstruction()
    : contract === "reflection_initiative"
      ? reflectionInitiativeJsonObjectInstruction()
      : visionMediaJsonObjectInstruction();
  return [
    { role: "system", content: systemInstruction },
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

function reasoningEffortFor(
  options: CompletionOptions,
  fabricReasoning?: TrustedReasoningControl,
): typeof COMMAND_CODE_POLICY.effort | undefined {
  if (fabricReasoning) {
    if (fabricReasoning.kind !== "command_code_reasoning_effort") {
      throw new AppError(
        "capability_mismatch",
        "command_code_reasoning_control_mismatch",
        400,
      );
    }
    return fabricReasoning.value;
  }
  return options.reasoningEffort as typeof COMMAND_CODE_POLICY.effort | undefined;
}

/**
 * Command Code serves exactly three recognized, code-owned output contracts.
 *
 * They are distinct contracts for distinct owners and are never conflated:
 *
 * - the Thought semantic contract, used by the direct Thought seam;
 * - the Reflection/Initiative adjudication contract, used by the bounded
 *   reflection adjudicator;
 * - the mediated visual evidence contract, used by the Host attachment path.
 *
 * There is deliberately no generic "accept any schema" path. An unrecognized
 * contract, a contract whose schema id does not match its contract id, or a
 * substituted contract is refused before any transport.
 */
type CommandCodeContract = "thought" | "reflection_initiative" | "vision_media";

function contractFor(structured: StructuredOutputRequest | undefined): CommandCodeContract | null {
  if (!structured) return null;
  if (
    structured.contractId === THOUGHT_OUTPUT_CONTRACT_ID &&
    structured.schemaId === THOUGHT_OUTPUT_SCHEMA_ID
  ) {
    return "thought";
  }
  if (
    structured.contractId === REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID &&
    structured.schemaId === REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID
  ) {
    return "reflection_initiative";
  }
  if (
    structured.contractId === VISION_MEDIA_OUTPUT_CONTRACT_ID &&
    structured.schemaId === VISION_MEDIA_OUTPUT_SCHEMA_ID
  ) {
    return "vision_media";
  }
  return null;
}

function bindingIdFor(contract: CommandCodeContract): string {
  if (contract === "thought") return `${THOUGHT_OUTPUT_CONTRACT_ID}:${THOUGHT_OUTPUT_SCHEMA_ID}`;
  if (contract === "reflection_initiative") {
    return `${REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID}:${REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID}`;
  }
  return `${VISION_MEDIA_OUTPUT_CONTRACT_ID}:${VISION_MEDIA_OUTPUT_SCHEMA_ID}`;
}

function buildRequestBody(args: ProviderDispatchArgs): Record<string, unknown> {
  if (args.modelId !== COMMAND_CODE_POLICY.modelId) {
    throw new AppError("capability_mismatch", "command_code_model_not_qualified", 400);
  }
  const effort = resolveThoughtEffort(args);
  if (!acceptedEffort(effort, contractFor(args.options.structuredOutput), args.options.thoughtTriggerKind)) {
    throw new AppError("capability_mismatch", "command_code_policy_effort_required", 400);
  }
  const contract = contractFor(args.options.structuredOutput);
  if (contract === null) {
    throw new AppError("capability_mismatch", "command_code_thought_contract_required", 400);
  }
  if (contract === "thought" && args.options.tools?.length) {
    throw new AppError("capability_mismatch", "command_code_thought_tools_unsupported", 400);
  }
  if (contract === "vision_media" && args.options.tools?.length) {
    throw new AppError("capability_mismatch", "command_code_vision_tools_unsupported", 400);
  }
  const maxTokens = args.options.maxTokens ?? MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS) {
    throw new AppError("capability_mismatch", "command_code_output_limit_unsupported", 400);
  }
  return {
    model: COMMAND_CODE_POLICY.modelId,
    messages: mapMessages(args.messages, contract),
    max_tokens: maxTokens,
    reasoning_effort: effort,
    response_format: { type: "json_object" },
    ...(promptCacheKey(args) ? { prompt_cache_key: promptCacheKey(args) } : {}),
    ...(args.options.temperature !== undefined ? { temperature: args.options.temperature } : {}),
  };
}

function resolveThoughtEffort(args: ProviderDispatchArgs): CommandCodeThoughtEffort | undefined {
  const mapped = thoughtReasoningEffortForTrigger(args.options.thoughtTriggerKind);
  if (args.options.thoughtTriggerKind === "domus_notification") return mapped;
  const requested = reasoningEffortFor(args.options, args.fabricReasoning);
  return requested === COMMAND_CODE_POLICY.effort ? requested : undefined;
}

// Medium is only reachable through the Domus trigger map (Owner, 2026-10-04).
function acceptedEffort(
  effort: CommandCodeThoughtEffort | undefined,
  contract: CommandCodeContract | null,
  triggerKind: string | null | undefined,
): effort is CommandCodeThoughtEffort {
  if (effort === COMMAND_CODE_POLICY.effort) return true;
  return contract === "thought" && effort === "medium" && triggerKind === "domus_notification";
}

function promptCacheKey(args: ProviderDispatchArgs): string | undefined {
  if (process.env.ASHLEY_THOUGHT_PROMPT_CACHE_KEY?.trim().toLowerCase() !== "true") return undefined;
  const pass = args.options.thoughtContractPass;
  if (!pass || contractFor(args.options.structuredOutput) !== "thought") return undefined;
  return `ashley-thought-${pass}-v1`;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
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
      const boundary: {
        backend: "command_code_api";
        requestedModelId: string;
        reasoningEffort: CommandCodeThoughtEffort;
        requestHash?: `sha256:${string}`;
        providerModel?: string | null;
        providerRequestId?: string | null;
        providerHttpStatus?: number | null;
        responseHash?: `sha256:${string}`;
        transportOutcome: CommandCodeTransportOutcome;
      } = {
        backend: "command_code_api",
        requestedModelId: args.modelId,
        reasoningEffort: COMMAND_CODE_POLICY.effort,
        transportOutcome: "not_sent",
      };
      try {
        const apiKey = env.commandCodeApiKey;
        if (!apiKey) {
          throw new AppError("agent_not_ready", "Command Code Provider API credential not configured", 503);
        }
        const body = buildRequestBody(args);
        boundary.reasoningEffort = body.reasoning_effort as CommandCodeThoughtEffort;
        const serializedBody = JSON.stringify(body);
        const providerRequestHash = sha256(serializedBody);
        boundary.requestHash = providerRequestHash;
        boundary.transportOutcome = "sent_outcome_unknown";
        const response = await fetcher(COMMAND_CODE_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: serializedBody,
          signal: args.signal ?? args.options.signal,
        });
        boundary.transportOutcome = "response_received";
        boundary.providerHttpStatus = response.status;
        boundary.providerRequestId = response.headers.get("x-request-id");
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
        boundary.providerModel = returnedModel;
        if (typeof result.id === "string" && result.id.length > 0) boundary.providerRequestId = result.id;
        if (returnedModel !== COMMAND_CODE_POLICY.modelId) {
          throw new AppError("capability_mismatch", "command_code_model_identity_mismatch", 502);
        }
        const firstChoice = Array.isArray(result.choices) ? result.choices[0] : undefined;
        const content = firstChoice?.message?.content;
        if (typeof content !== "string") {
          throw new AppError("provider_unavailable", "command_code_missing_text_content", 502);
        }
        const providerResponseHash = sha256(content);
        boundary.responseHash = providerResponseHash;
        const wireEvidence = {
          adapterId: "ashley.adapter.command_code.v1",
          wireFormat: "json_object",
          sanitizedBodyDigest: providerRequestHash,
          emittedEnforcementMode: "json_object_compatibility",
          providerDeclaredEnforcement: "unavailable",
          bindingId: bindingIdFor(contractFor(args.options.structuredOutput)!),
        } as const;
        const usage = toUsage(result.usage);
        const finish = finishReason(firstChoice?.finish_reason);
        return {
          text: content,
          ...(usage ? { usage } : {}),
          providerModel: returnedModel,
          providerRequestId: boundary.providerRequestId,
          providerHttpStatus: response.status,
          providerRequestHash,
          providerResponseHash,
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
      } catch (error) {
        attachCommandCodeBoundaryEvidence(error, boundary as CommandCodeBoundaryEvidence);
        throw error;
      }
    },
  };
}
