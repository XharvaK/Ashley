import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import {
  thoughtOutputDeepSeekJsonObjectInstruction,
  thoughtOutputStructuredRequest,
} from "../../cognitive-v021/thought/output-contract.js";
import { COMMAND_CODE_POLICY } from "../../command-code/policy.js";
import { commandCodeBoundaryEvidenceFromError } from "../../command-code/evidence.js";
import type { ChatMessage } from "../types.js";
import { createCommandCodeAdapter } from "./command-code-adapter.js";

const originalKey = env.commandCodeApiKey;
const MODEL = COMMAND_CODE_POLICY.modelId;
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
  it("uses the single Command Code policy for both model and effort", () => {
    expect(COMMAND_CODE_POLICY).toEqual({
      modelId: "meta/muse-spark-1.3-contributor",
      effort: "xhigh",
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
      options: {
        maxTokens: 65_536,
        reasoningEffort: COMMAND_CODE_POLICY.effort,
        structuredOutput: thoughtOutputStructuredRequest(),
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

  it("fails closed without the policy-owned xhigh effort and does not call the provider", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const fetcher = vi.fn(async () => fakeResponse({}));
    const adapter = createCommandCodeAdapter(fetcher);

    await expect(adapter.dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 65_536, structuredOutput: thoughtOutputStructuredRequest() },
    })).rejects.toMatchObject({ code: "capability_mismatch" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("records a missing credential as not sent with zero provider dispatches", async () => {
    env.commandCodeApiKey = "";
    const fetcher = vi.fn(async () => fakeResponse({}));
    const adapter = createCommandCodeAdapter(fetcher);
    let caught: unknown;
    try {
      await adapter.dispatch({
        messages,
        modelId: MODEL,
        options: {
          maxTokens: 65_536,
          reasoningEffort: COMMAND_CODE_POLICY.effort,
          structuredOutput: thoughtOutputStructuredRequest(),
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(commandCodeBoundaryEvidenceFromError(caught)).toMatchObject({
      backend: "command_code_api",
      requestedModelId: MODEL,
      reasoningEffort: COMMAND_CODE_POLICY.effort,
      transportOutcome: "not_sent",
    });
  });

  it("classifies external HTTP refusal without retaining response text or credentials", async () => {
    const secret = "test-command-code-key";
    env.commandCodeApiKey = secret;
    const fetcher = vi.fn(async () => fakeResponse({ error: { message: `${secret} policy refusal` } }, 403));
    const adapter = createCommandCodeAdapter(fetcher);

    await expect(adapter.dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 65_536, reasoningEffort: COMMAND_CODE_POLICY.effort, structuredOutput: thoughtOutputStructuredRequest() },
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
      options: { maxTokens: 65_536, reasoningEffort: COMMAND_CODE_POLICY.effort, structuredOutput: thoughtOutputStructuredRequest() },
    })).rejects.toMatchObject({ code: "capability_mismatch" });
  });
});
