import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import { thoughtOutputDeepSeekJsonObjectInstruction } from "../../cognitive-v021/thought/output-contract.js";
import { capabilityProfileFor } from "../../model-fabric/profiles.js";
import { translateReasoningPolicy } from "../../model-fabric/reasoning-translation.js";
import { currentPortfolio } from "../../model-fabric/portfolio.js";
import type { StructuredOutputSchemaFingerprint } from "../../model-fabric/types.js";
import { quotaContractFor } from "../router.js";
import type { ChatMessage } from "../types.js";
import { createCommandCodeAdapter } from "./command-code-adapter.js";

const originalKey = env.commandCodeApiKey;
const MODEL = "meta/muse-spark-1.3-contributor";
const SCHEMA_FINGERPRINT = "sha256:test-schema" as StructuredOutputSchemaFingerprint;
const messages: ChatMessage[] = [{ role: "user", content: "Return the requested JSON." }];

function fakeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "x-request-id": "request-123" }),
    json: async () => body,
  } as Response;
}

afterEach(() => {
  env.commandCodeApiKey = originalKey;
  vi.restoreAllMocks();
});

describe("command-code-adapter", () => {
  it("resolves the current Thought route to Muse xhigh under the existing local budget", () => {
    const modelProfile = capabilityProfileFor("command_code", MODEL);
    const translation = translateReasoningPolicy({
      provider: "command_code",
      configuredModelId: MODEL,
      semanticPolicy: "max_supported",
    });
    const thoughtRow = currentPortfolio().rows.find((row) => row.policyRowId === "mfr_thought_interactive_compat_v1");

    expect(currentPortfolio().portfolioRevisionId).toBe("mfp_current_compatibility_v6");
    expect(thoughtRow?.occupants[0]).toMatchObject({
      provider: "command_code",
      configuredModelId: MODEL,
      effectiveReasoning: "xhigh",
    });
    expect(translation).toMatchObject({
      status: "translated",
      control: { kind: "command_code_reasoning_effort", value: "xhigh" },
    });
    expect(modelProfile.reasoning).toEqual({ mode: "configurable", efforts: ["xhigh"] });
    expect(modelProfile.limits).toMatchObject({
      contextTokens: 1_048_576,
      maxOutputTokens: 65_536,
    });
    expect(quotaContractFor(`command_code:${MODEL}`)).toMatchObject({
      rps: 1,
      tpm: 524_288,
    });
  });

  it("pins Muse xhigh, the 65,536 output ceiling, and Ashley JSON compatibility", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    let requestedUrl: string | undefined;
    let request: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return fakeResponse({
        id: "response-123",
        model: MODEL,
        choices: [{ message: { content: "{\"kind\":\"abstain\"}" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 37,
          completion_tokens: 9,
          total_tokens: 46,
          completion_tokens_details: { reasoning_tokens: 5 },
        },
      });
    });
    const adapter = createCommandCodeAdapter(fetcher);

    const result = await adapter.dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 65_536 },
      fabricReasoning: { kind: "command_code_reasoning_effort", value: "xhigh" },
      fabricStructuredOutput: {
        kind: "json_object_compatibility",
        contractId: "ashley.thought.semantic.v2",
        schemaId: "ashley.thought.semantic.v2.schema",
        schemaFingerprint: SCHEMA_FINGERPRINT,
        bindingId: "compat_thought_command_code_muse_json_object_v1",
      },
    });

    expect(requestedUrl).toBe("https://api.commandcode.ai/provider/v1/chat/completions");
    expect(request).toMatchObject({
      model: MODEL,
      max_tokens: 65_536,
      reasoning_effort: "xhigh",
      response_format: { type: "json_object" },
    });
    expect(request?.messages).toEqual([
      { role: "system", content: thoughtOutputDeepSeekJsonObjectInstruction() },
      { role: "user", content: messages[0]!.content },
    ]);
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-cmd-zdr");
    expect(result).toMatchObject({
      text: "{\"kind\":\"abstain\"}",
      providerModel: MODEL,
      providerRequestId: "response-123",
      providerHttpStatus: 200,
      finishReason: "stop",
      usage: {
        promptTokens: 37,
        completionTokens: 9,
        totalTokens: 46,
        reasoningTokens: 5,
      },
      wireEvidence: {
        adapterId: "ashley.adapter.command_code.v1",
        wireFormat: "json_object",
        emittedEnforcementMode: "json_object_compatibility",
      },
    });
  });

  it("fails closed without the trusted xhigh control and does not call the provider", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const fetcher = vi.fn(async () => fakeResponse({}));
    const adapter = createCommandCodeAdapter(fetcher);

    await expect(adapter.dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 65_536 },
    })).rejects.toMatchObject({ code: "capability_mismatch" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("classifies external HTTP refusal without retaining response text or credentials", async () => {
    const secret = "test-command-code-key";
    env.commandCodeApiKey = secret;
    const fetcher = vi.fn(async () => fakeResponse({ error: { message: `${secret} policy refusal` } }, 403));
    const adapter = createCommandCodeAdapter(fetcher);

    await expect(adapter.dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 65_536 },
      fabricReasoning: { kind: "command_code_reasoning_effort", value: "xhigh" },
      fabricStructuredOutput: {
        kind: "json_object_compatibility",
        contractId: "ashley.thought.semantic.v2",
        schemaId: "ashley.thought.semantic.v2.schema",
        schemaFingerprint: SCHEMA_FINGERPRINT,
        bindingId: "compat_thought_command_code_muse_json_object_v1",
      },
    })).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "command_code_external_service_rejected_403",
    } satisfies Partial<AppError>);
  });

  it("rejects a response that reports a different model", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const adapter = createCommandCodeAdapter(async () => fakeResponse({
      model: "another-model",
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
    }));

    await expect(adapter.dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 65_536 },
      fabricReasoning: { kind: "command_code_reasoning_effort", value: "xhigh" },
      fabricStructuredOutput: {
        kind: "json_object_compatibility",
        contractId: "ashley.thought.semantic.v2",
        schemaId: "ashley.thought.semantic.v2.schema",
        schemaFingerprint: SCHEMA_FINGERPRINT,
        bindingId: "compat_thought_command_code_muse_json_object_v1",
      },
    })).rejects.toMatchObject({ code: "capability_mismatch" });
  });
});
