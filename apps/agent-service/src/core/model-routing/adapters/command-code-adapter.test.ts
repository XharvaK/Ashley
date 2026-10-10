import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.js";
import { AppError } from "../../../errors.js";
import {
  thoughtOutputDeepSeekJsonObjectInstruction,
  thoughtOutputStructuredRequest,
} from "../../cognitive-v021/thought/output-contract.js";
import { COMMAND_CODE_DOMUS_POLICY, COMMAND_CODE_LIFEBOAT, COMMAND_CODE_POLICY } from "../../command-code/policy.js";
import { commandCodeBoundaryEvidenceFromError } from "../../command-code/evidence.js";
import type { ChatMessage } from "../types.js";
import { COMMAND_CODE_RESPONSE_WAIT_MS, createCommandCodeAdapter } from "./command-code-adapter.js";

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
      effort: "high",
    });
  });

  it("pins Muse high, the 65,536 output ceiling, and Ashley JSON compatibility", async () => {
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
      reasoning_effort: "high",
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

  it("gives Command Code its own dispatcher so a slow answer waits on the pass deadline", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    let init: (RequestInit & { dispatcher?: unknown }) | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, requestInit?: RequestInit) => {
      init = requestInit as RequestInit & { dispatcher?: unknown };
      return fakeResponse({
        id: "response-dispatcher",
        model: MODEL,
        choices: [{ message: { content: "{\"kind\":\"abstain\"}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });

    await createCommandCodeAdapter(fetcher).dispatch({
      messages,
      modelId: MODEL,
      options: {
        maxTokens: 65_536,
        reasoningEffort: COMMAND_CODE_POLICY.effort,
        structuredOutput: thoughtOutputStructuredRequest(),
      },
    });

    expect(COMMAND_CODE_RESPONSE_WAIT_MS).toBe(1_800_000);
    expect(init).toEqual(expect.objectContaining({ dispatcher: expect.anything() }));
  });

  it("reads both documented usage shapes, including cached tokens", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatchWith = async (usage: Record<string, unknown>) => {
      const fetcher = vi.fn(async () => fakeResponse({
        id: "response-usage",
        model: MODEL,
        choices: [{ message: { content: "{\"kind\":\"abstain\"}" }, finish_reason: "stop" }],
        usage,
      }));
      const adapter = createCommandCodeAdapter(fetcher);
      return adapter.dispatch({
        messages,
        modelId: MODEL,
        options: {
          maxTokens: 65_536,
          reasoningEffort: COMMAND_CODE_POLICY.effort,
          structuredOutput: thoughtOutputStructuredRequest(),
        },
      });
    };
    const chatShape = await dispatchWith({
      prompt_tokens: 40,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 30 },
    });
    const responsesShape = await dispatchWith({
      input_tokens: 41,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 12 },
    });
    expect(chatShape.usage).toMatchObject({ promptTokens: 40, completionTokens: 4, cachedTokens: 30 });
    expect(responsesShape.usage).toMatchObject({ promptTokens: 41, completionTokens: 5, cachedTokens: 12 });
  });

  it("adds a stable prompt cache key only when the env flag is on", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const capture = async () => {
      let request: Record<string, unknown> | undefined;
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return fakeResponse({
          id: "response-cache",
          model: MODEL,
          choices: [{ message: { content: "{\"kind\":\"abstain\"}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      });
      const adapter = createCommandCodeAdapter(fetcher);
      await adapter.dispatch({
        messages,
        modelId: MODEL,
        options: {
          maxTokens: 65_536,
          reasoningEffort: COMMAND_CODE_POLICY.effort,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtContractPass: "awake",
        },
      });
      return request;
    };
    delete process.env.ASHLEY_THOUGHT_PROMPT_CACHE_KEY;
    expect(await capture()).not.toHaveProperty("prompt_cache_key");
    process.env.ASHLEY_THOUGHT_PROMPT_CACHE_KEY = "true";
    expect(await capture()).toMatchObject({ prompt_cache_key: "ashley-thought-awake-v1" });
    delete process.env.ASHLEY_THOUGHT_PROMPT_CACHE_KEY;
  });

  it("uses medium effort for a domus notification and high otherwise", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const effortFor = async (thoughtTriggerKind: string, reasoningEffort: "high" | "medium" = "high") => {
      let request: Record<string, unknown> | undefined;
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return fakeResponse({
          id: "response-effort",
          model: MODEL,
          choices: [{ message: { content: "{\"kind\":\"abstain\"}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      });
      const adapter = createCommandCodeAdapter(fetcher);
      await adapter.dispatch({
        messages,
        modelId: MODEL,
        options: {
          maxTokens: 65_536,
          reasoningEffort,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtTriggerKind,
          thoughtContractPass: thoughtTriggerKind === "domus_notification" ? "chat" : "awake",
        },
      });
      return request?.reasoning_effort;
    };
    expect(await effortFor("domus_notification")).toBe("low");
    expect(await effortFor("owner_message")).toBe("high");
    expect(await effortFor("idle_opportunity")).toBe("high");
    // Medium is a Domus-only setting; any other trigger asking for it fails closed.
    await expect(effortFor("owner_message", "medium")).rejects.toMatchObject({
      message: expect.stringContaining("command_code_policy_effort_required"),
    });
  });

  it("sends a Domus pass to the Domus model and checks the reply came from it", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const DOMUS = COMMAND_CODE_DOMUS_POLICY.modelId;
    const run = async (modelId: string, thoughtTriggerKind: string, returned: string) => {
      let request: Record<string, unknown> | undefined;
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return fakeResponse({
          id: "response-domus",
          model: returned,
          choices: [{ message: { content: "{\"kind\":\"abstain\"}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      });
      const result = await createCommandCodeAdapter(fetcher).dispatch({
        messages,
        modelId,
        options: {
          maxTokens: 65_536,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtTriggerKind,
          thoughtContractPass: "chat",
        },
      });
      return { request, result, calls: fetcher.mock.calls.length };
    };
    const domus = await run(DOMUS, "domus_notification", DOMUS);
    expect(domus.request).toMatchObject({ model: DOMUS, reasoning_effort: "low" });
    expect(domus.result.providerModel).toBe(DOMUS);
    // The reply must come from the model that was asked.
    await expect(run(DOMUS, "domus_notification", MODEL)).rejects.toMatchObject({
      message: expect.stringContaining("command_code_model_identity_mismatch"),
    });
    // Only a Domus pass may use the Domus model; nothing is sent otherwise.
    const fetcher = vi.fn(async () => fakeResponse({}));
    await expect(createCommandCodeAdapter(fetcher).dispatch({
      messages,
      modelId: DOMUS,
      options: { maxTokens: 65_536, reasoningEffort: "high", structuredOutput: thoughtOutputStructuredRequest(), thoughtTriggerKind: "owner_message" },
    })).rejects.toMatchObject({ message: expect.stringContaining("command_code_model_not_qualified") });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends one lifeboat model at the lifeboat effort and rejects any other model", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const run = async (modelId: string, thoughtTriggerKind: string, thoughtLifeboat?: boolean) => {
      let request: Record<string, unknown> | undefined;
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return fakeResponse({
          id: "response-lifeboat",
          model: modelId,
          choices: [{ message: { content: "{\"kind\":\"abstain\"}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        });
      });
      const result = await createCommandCodeAdapter(fetcher).dispatch({
        messages,
        modelId,
        options: {
          maxTokens: 65_536,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtTriggerKind,
          thoughtContractPass: "chat",
          ...(thoughtLifeboat ? { thoughtLifeboat: true } : {}),
        },
      });
      return { request, result, calls: fetcher.mock.calls.length, fetcher };
    };
    const museLane = await run(COMMAND_CODE_LIFEBOAT.thought.modelId, "owner_message", true);
    expect(museLane.request).toMatchObject({
      model: "deepseek/deepseek-v4.1-flash",
      reasoning_effort: "high",
    });
    const domusLane = await run(COMMAND_CODE_LIFEBOAT.domus.modelId, "domus_notification", true);
    expect(domusLane.request).toMatchObject({ reasoning_effort: "low" });
    const wrongModel = vi.fn(async () => fakeResponse({}));
    await expect(createCommandCodeAdapter(wrongModel).dispatch({
      messages,
      modelId: "deepseek/deepseek-v4.1-flash-fast",
      options: {
        maxTokens: 65_536,
        structuredOutput: thoughtOutputStructuredRequest(),
        thoughtTriggerKind: "owner_message",
        thoughtLifeboat: true,
      },
    })).rejects.toMatchObject({ message: expect.stringContaining("command_code_model_not_qualified") });
    expect(wrongModel).not.toHaveBeenCalled();
    const noFlag = vi.fn(async () => fakeResponse({}));
    await expect(createCommandCodeAdapter(noFlag).dispatch({
      messages,
      modelId: COMMAND_CODE_LIFEBOAT.thought.modelId,
      options: {
        maxTokens: 65_536,
        structuredOutput: thoughtOutputStructuredRequest(),
        thoughtTriggerKind: "owner_message",
      },
    })).rejects.toMatchObject({ message: expect.stringContaining("command_code_model_not_qualified") });
    expect(noFlag).not.toHaveBeenCalled();
  });

  it("fails closed without the policy-owned high effort and does not call the provider", async () => {
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

describe("A8-4 the answer is read past any thinking the provider returns", () => {
  const dispatchContent = async (message: Record<string, unknown>, finish: string) => {
    env.commandCodeApiKey = "test-command-code-key";
    const fetcher = vi.fn(async () => fakeResponse({
      id: "response-thinking",
      model: MODEL,
      choices: [{ message, finish_reason: finish }],
    }));
    return createCommandCodeAdapter(fetcher).dispatch({
      messages,
      modelId: MODEL,
      options: { maxTokens: 65_536, reasoningEffort: COMMAND_CODE_POLICY.effort, structuredOutput: thoughtOutputStructuredRequest() },
    });
  };

  it("returns the answer after leading thinking, and only an absent answer is a provider failure", async () => {
    const answered = await dispatchContent({ content: "<think>plan the settlement</think>\n{\"kind\":\"abstain\"}" }, "stop");
    expect(answered).toMatchObject({ text: "{\"kind\":\"abstain\"}", finishReason: "stop" });

    // Reasoning with no answer and a spent output budget: an empty answer, not a provider outage.
    const spent = await dispatchContent({ content: null, reasoning_content: "still weighing it" }, "length");
    expect(spent).toMatchObject({ text: "", finishReason: "length" });

    // No content and no reasoning at all is still a provider failure.
    await expect(dispatchContent({ content: null }, "stop")).rejects.toMatchObject({
      message: expect.stringContaining("command_code_missing_text_content"),
    });
  });
});
