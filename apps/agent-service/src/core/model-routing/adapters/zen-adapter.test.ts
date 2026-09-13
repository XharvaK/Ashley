import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../env.js";
import { currentPortfolio } from "../../model-fabric/portfolio.js";
import { loadRouteRecords } from "../router.js";
import type { ChatMessage } from "../types.js";
import { createZenAdapter, mapZenError } from "./zen-adapter.js";

const originalKey = env.opencodeZenApiKey;
const originalBaseUrl = env.opencodeZenBaseUrl;

afterEach(() => {
  env.opencodeZenApiKey = originalKey;
  env.opencodeZenBaseUrl = originalBaseUrl;
  vi.restoreAllMocks();
});

function fakeResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
  };
}

const messages: ChatMessage[] = [{ role: "user", content: "utility question" }];

describe("MF-M4 OpenCode Zen adapter", () => {
  it("fails closed without a key and does not call the network", async () => {
    env.opencodeZenApiKey = "";
    const fetchFn = vi.fn(async () => fakeResponse({}));
    const adapter = createZenAdapter(fetchFn);

    await expect(
      adapter.dispatch({ messages, modelId: "minimax/minimax-m2", options: {} }),
    ).rejects.toMatchObject({ code: "agent_not_ready" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends one chat-completions POST and normalizes the response", async () => {
    env.opencodeZenApiKey = "zen-test";
    env.opencodeZenBaseUrl = "https://zen.example/v1";
    let capturedUrl: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return fakeResponse({
        choices: [
          {
            message: { content: "utility answer" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
        model: "minimax/minimax-m2",
      });
    });
    const adapter = createZenAdapter(fetchFn);

    const result = await adapter.dispatch({
      messages,
      modelId: "minimax/minimax-m2",
      options: { maxTokens: 128, temperature: 0.2 },
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe("https://zen.example/v1/chat/completions");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer zen-test",
      "Content-Type": "application/json",
    });
    expect(result).toMatchObject({
      text: "utility answer",
      usage: { promptTokens: 7, completionTokens: 3 },
      providerModel: "minimax/minimax-m2",
      finishReason: "stop",
      toolCalls: undefined,
      wireEvidence: {
        adapterId: "ashley.adapter.opencode-zen.v1",
        wireFormat: "provider_default",
        emittedEnforcementMode: "none",
        providerDeclaredEnforcement: "unavailable",
      },
    });
  });

  it("does not put tools or tool choice on the Zen request", async () => {
    env.opencodeZenApiKey = "zen-test";
    let capturedBody: Record<string, unknown> | undefined;
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return fakeResponse({ choices: [{ message: { content: "ok" } }] });
    });
    const adapter = createZenAdapter(fetchFn);

    await adapter.dispatch({ messages, modelId: "minimax/minimax-m2", options: {} });

    expect(capturedBody).toBeDefined();
    expect(capturedBody).not.toHaveProperty("tools");
    expect(capturedBody).not.toHaveProperty("tool_choice");
  });

  it("rejects tool-bearing requests before dispatch", async () => {
    env.opencodeZenApiKey = "zen-test";
    const fetchFn = vi.fn(async () => fakeResponse({}));
    const adapter = createZenAdapter(fetchFn);

    await expect(
      adapter.dispatch({
        messages,
        modelId: "minimax/minimax-m2",
        options: {
          tools: [
            {
              type: "function",
              function: { name: "forbidden", description: "forbidden" },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "capability_mismatch" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a responses-only adapter configuration", async () => {
    env.opencodeZenApiKey = "zen-test";
    const fetchFn = vi.fn(async () => fakeResponse({}));
    const adapter = createZenAdapter(fetchFn, { endpoint: "responses" });

    await expect(
      adapter.dispatch({ messages, modelId: "responses-only-model", options: {} }),
    ).rejects.toMatchObject({ code: "capability_mismatch" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects owner-private projections for the default free utility backend", async () => {
    env.opencodeZenApiKey = "zen-test";
    const fetchFn = vi.fn(async () => fakeResponse({}));
    const adapter = createZenAdapter(fetchFn);

    await expect(
      adapter.dispatch({
        messages,
        modelId: "minimax/minimax-m2",
        options: { projectionClassification: "owner_private" },
      }),
    ).rejects.toMatchObject({ code: "capability_mismatch" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not retry an unreachable endpoint", async () => {
    env.opencodeZenApiKey = "zen-test";
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const adapter = createZenAdapter(fetchFn);

    await expect(
      adapter.dispatch({ messages, modelId: "minimax/minimax-m2", options: {} }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("keeps Zen dark and leaves the compatibility Thought failover untouched", () => {
    expect(loadRouteRecords().some((record) => record.provider === "opencode_zen")).toBe(
      false,
    );
    const thought = Object.entries(currentPortfolio().routeBindings).find(
      ([route]) => route === "thought",
    );
    expect(thought?.[1].provider).toBe("cloudflare");
    expect(thought?.[1].configuredModelId).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
    expect(Object.values(currentPortfolio().routeBindings)).not.toContainEqual(
      expect.objectContaining({ provider: "opencode_zen" }),
    );
  });

  it("maps a Zen 429 response to a retryable provider error without retrying", async () => {
    env.opencodeZenApiKey = "zen-test";
    const fetchFn = vi.fn(async () =>
      fakeResponse({ error: { message: "busy" } }, { status: 429, headers: { "retry-after": "9" } }),
    );
    const adapter = createZenAdapter(fetchFn);

    await expect(
      adapter.dispatch({ messages, modelId: "minimax/minimax-m2", options: {} }),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterSec: 9 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rethrows AbortError without converting transport truth", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(() => mapZenError(abort)).toThrow(abort);
  });

  it("rethrows deadline TimeoutError without converting transport truth", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(() => mapZenError(timeout)).toThrow(timeout);
  });
});
