import { vi } from "vitest";

const { groqDispatch, mistralDispatch, createGroqAdapter, createMistralAdapter, runAttentiveDispatch } =
  vi.hoisted(() => {
    const groqDispatch = vi.fn(async () => {
      throw new Error("groq_adapter_should_not_be_reached");
    });
    const mistralDispatch = vi.fn(async () => {
      throw new Error("mistral_adapter_should_not_be_reached");
    });
    return {
      groqDispatch,
      mistralDispatch,
      createGroqAdapter: vi.fn(() => ({
        provider: "groq" as const,
        dispatch: groqDispatch,
      })),
      createMistralAdapter: vi.fn(() => ({
        provider: "mistral" as const,
        dispatch: mistralDispatch,
      })),
      runAttentiveDispatch: vi.fn(async () => {
        throw new Error("runAttentiveDispatch_should_not_be_reached");
      }),
    };
  });

vi.mock("./core/model-routing/adapters/groq-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/model-routing/adapters/groq-adapter.js")>();
  return {
    ...actual,
    createGroqAdapter,
  };
});

vi.mock("./core/model-routing/adapters/mistral-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/model-routing/adapters/mistral-adapter.js")>();
  return {
    ...actual,
    createMistralAdapter,
  };
});

vi.mock("./core/attention/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./core/attention/index.js")>();
  return {
    ...actual,
    runAttentiveDispatch,
  };
});

import { describe, expect, it } from "vitest";
import {
  completeChat,
  DispatchDataPlaneMissingError,
} from "./mistral-client.js";

describe("T4 dispatch data-plane miss", () => {
  it("one-arg completeChat throws DispatchDataPlaneMissingError, not TypeError", async () => {
    // @ts-expect-error CognitiveDispatchOptions is required
    const pending = completeChat([{ role: "user", content: "x" }]);
    await expect(pending).rejects.toBeInstanceOf(DispatchDataPlaneMissingError);
    await expect(pending).rejects.toMatchObject({
      code: "dispatch_data_plane_missing",
    });
    expect(runAttentiveDispatch).not.toHaveBeenCalled();
    expect(createGroqAdapter).not.toHaveBeenCalled();
    expect(createMistralAdapter).not.toHaveBeenCalled();
    expect(groqDispatch).not.toHaveBeenCalled();
    expect(mistralDispatch).not.toHaveBeenCalled();
  });

  it("options without attentionDb throws the same miss identity", async () => {
    await expect(
      completeChat([{ role: "user", content: "x" }], {
        route: "thought",
      } as never),
    ).rejects.toMatchObject({
      name: "DispatchDataPlaneMissingError",
      code: "dispatch_data_plane_missing",
    });
    expect(runAttentiveDispatch).not.toHaveBeenCalled();
    expect(createGroqAdapter).not.toHaveBeenCalled();
    expect(createMistralAdapter).not.toHaveBeenCalled();
  });
});
