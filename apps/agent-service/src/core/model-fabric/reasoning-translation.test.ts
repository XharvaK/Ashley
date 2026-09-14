import { describe, expect, it } from "vitest";
import { createInferencePolicyFingerprint } from "./profiles.js";
import {
  applyTranslatedControlToNimBody,
  formatTranslatedWireControl,
  inspectFabricNimRequest,
  loadReasoningMaps,
  observedReasoningFromUsage,
  resolveOccupantSemanticPolicy,
  translateReasoningPolicy,
} from "./reasoning-translation.js";
import { createNimAdapter } from "../model-routing/adapters/nim-adapter.js";
import { env } from "../../env.js";
import type { ChatMessage } from "../model-routing/types.js";

const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const CLOUDFLARE_SUPER = "@cf/nvidia/nemotron-3-120b-a12b";
const LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";
const GPT_OSS = "openai/gpt-oss-20b";
const MISTRAL_SMALL = "mistral-small-2603";
const QWEN_3_6 = "qwen/qwen3.6-27b";
const QWEN_3_8 = "qwen/qwen3.8-27b";

describe("Nemotron reasoning maps", () => {
  it("loads v2 maps as runtime configuration", () => {
    const maps = loadReasoningMaps();
    expect(maps.schema).toBe("ashley.model_fabric.reasoning_maps.v2");
    expect(maps.families.map((family) => family.familyId).sort()).toEqual([
      "nim_nemotron_lightning",
      "nim_nemotron_super",
      "nim_nemotron_ultra",
      "cloudflare_nemotron_super",
      "cloudflare_deepseek_v4_flash",
      "groq_qwen_3_6",
      "groq_qwen_3_8",
      "mistral_small",
    ].sort());
  });
});

describe("Mistral Small translation", () => {
  it("maps every Ashley semantic policy to the exact Mistral reasoning_effort wire value", () => {
    const expected = {
      disabled: "none",
      economical: "none",
      high: "high",
      max_supported: "high",
    } as const;

    for (const [semanticPolicy, wireValue] of Object.entries(expected)) {
      const translated = translateReasoningPolicy({
        provider: "mistral",
        configuredModelId: MISTRAL_SMALL,
        semanticPolicy: semanticPolicy as keyof typeof expected,
      });
      expect(translated).toEqual({
        status: "translated",
        familyId: "mistral_small",
        control: { kind: "reasoning_effort", value: wireValue },
      });
    }

    expect(translateReasoningPolicy({
      provider: "mistral",
      configuredModelId: MISTRAL_SMALL,
      semanticPolicy: "standard",
    })).toEqual({
      status: "unsupported",
      code: "unsupported_reasoning_mapping",
    });
  });

  it("fails closed for a Mistral model that is not the exact Thought occupant", () => {
    expect(
      translateReasoningPolicy({
        provider: "mistral",
        configuredModelId: "mistral-medium-latest",
        semanticPolicy: "economical",
      }),
    ).toEqual({ status: "unmapped_family" });
  });
});

describe("Ultra translation", () => {
  it("maps max_supported to reasoning_effort high and never emits the alias", () => {
    const probe = inspectFabricNimRequest({
      provider: "nim",
      configuredModelId: ULTRA,
      reasoningPolicy: "max_supported",
    });
    expect(probe.semanticPolicy).toBe("max_supported");
    expect(probe.translation.status).toBe("translated");
    expect(probe.requestBody?.reasoning_effort).toBe("high");
    expect(JSON.stringify(probe.requestBody)).not.toContain("max_supported");
  });

  it("never maps any semantic policy to reasoning_effort low", () => {
    for (const policy of [
      "disabled",
      "economical",
      "standard",
      "high",
      "max_supported",
    ] as const) {
      const translated = translateReasoningPolicy({
        provider: "nim",
        configuredModelId: ULTRA,
        semanticPolicy: policy,
      });
      if (translated.status === "translated" && translated.control.kind === "reasoning_effort") {
        expect(translated.control.value).not.toBe("low");
      }
    }
  });
});

describe("Super translation", () => {
  it("maps semantic high to reasoning_effort high and sets reasoning_budget 1024", () => {
    const probe = inspectFabricNimRequest({
      provider: "nim",
      configuredModelId: SUPER,
      reasoningPolicy: "high",
    });
    expect(probe.requestBody?.reasoning_effort).toBe("high");
    expect(probe.requestBody?.reasoning_budget).toBe(1024);
    expect(JSON.stringify(probe.requestBody)).not.toContain("thinking_on");
  });

  it("treats stale thinking_on as high when occupant policy is missing", () => {
    const resolved = resolveOccupantSemanticPolicy({
      provider: "nim",
      configuredModelId: SUPER,
      reasoningPolicy: null,
      effectiveReasoning: "thinking_on",
    });
    expect(resolved).toEqual({ ok: true, policy: "high" });
    const probe = inspectFabricNimRequest({
      provider: "nim",
      configuredModelId: SUPER,
      effectiveReasoning: "thinking_on",
    });
    expect(probe.requestBody?.reasoning_effort).toBe("high");
    expect(probe.requestBody?.reasoning_budget).toBe(1024);
    expect(JSON.stringify(probe.requestBody)).not.toContain("thinking_on");
  });

  it("does not invent medium for semantic standard", () => {
    const translated = translateReasoningPolicy({
      provider: "nim",
      configuredModelId: SUPER,
      semanticPolicy: "standard",
    });
    expect(translated).toEqual({
      status: "unsupported",
      code: "unsupported_reasoning_mapping",
    });
  });
});

describe("Cloudflare Nemotron translation", () => {
  it("maps semantic high to reasoning_effort high for the exact hosted model", () => {
    expect(translateReasoningPolicy({
      provider: "cloudflare",
      configuredModelId: CLOUDFLARE_SUPER,
      semanticPolicy: "high",
    })).toEqual({
      status: "translated",
      familyId: "cloudflare_nemotron_super",
      control: { kind: "reasoning_effort", value: "high" },
    });
  });

  it("does not invent a standard reasoning mapping", () => {
    expect(translateReasoningPolicy({
      provider: "cloudflare",
      configuredModelId: CLOUDFLARE_SUPER,
      semanticPolicy: "standard",
    })).toEqual({
      status: "unsupported",
      code: "unsupported_reasoning_mapping",
    });
  });
});

describe("Lightning translation", () => {
  it("disables thinking for economical", () => {
    const probe = inspectFabricNimRequest({
      provider: "nim",
      configuredModelId: LIGHTNING,
      reasoningPolicy: "economical",
    });
    expect(probe.requestBody?.chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
    expect(probe.requestBody?.reasoning_budget).toBeUndefined();
    expect(probe.requestBody?.reasoning_effort).toBeUndefined();
  });

  it("disables thinking for disabled", () => {
    const probe = inspectFabricNimRequest({
      provider: "nim",
      configuredModelId: LIGHTNING,
      reasoningPolicy: "disabled",
    });
    expect(probe.requestBody?.chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
    expect(probe.requestBody?.reasoning_budget).toBeUndefined();
    expect(probe.requestBody?.reasoning_effort).toBeUndefined();
  });

  it("maps standard to bounded thinking without reasoning_effort", () => {
    const probe = inspectFabricNimRequest({
      provider: "nim",
      configuredModelId: LIGHTNING,
      reasoningPolicy: "standard",
    });
    expect(probe.semanticPolicy).toBe("standard");
    expect(probe.translation).toEqual({
      status: "translated",
      familyId: "nim_nemotron_lightning",
      control: {
        kind: "chat_template_thinking",
        enableThinking: true,
        reasoningBudgetTokens: 512,
      },
    });
    expect(probe.requestBody).toMatchObject({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_budget: 512,
    });
    expect(probe.requestBody?.reasoning_effort).toBeUndefined();
    expect(
      probe.translation.status === "translated"
        ? formatTranslatedWireControl(probe.translation.control)
        : null,
    ).toBe("chat_template_kwargs.enable_thinking=true;reasoning_budget=512");
  });

  it.each(["high", "max_supported"] as const)(
    "fails closed for Lightning %s",
    (reasoningPolicy) => {
      const probe = inspectFabricNimRequest({
        provider: "nim",
        configuredModelId: LIGHTNING,
        reasoningPolicy,
      });
      expect(probe.requestBody).toBeNull();
      expect(probe.translation).toEqual({
        status: "unsupported",
        code: "unsupported_reasoning_mapping",
      });
    },
  );
});

describe("Groq Qwen 3.6 translation", () => {
  it("maps standard to provider default reasoning with hidden output", () => {
    const translated = translateReasoningPolicy({
      provider: "groq",
      configuredModelId: QWEN_3_6,
      semanticPolicy: "standard",
    });
    expect(translated).toEqual({
      status: "translated",
      familyId: "groq_qwen_3_6",
      control: {
        kind: "groq_reasoning_effort",
        value: "default",
        reasoningFormat: "hidden",
      },
    });
    expect(
      translated.status === "translated"
        ? formatTranslatedWireControl(translated.control)
        : null,
    ).toBe("reasoning_effort=default;reasoning_format=hidden");
  });

  it("keeps disabled and economical at none and rejects unsupported higher policies", () => {
    for (const semanticPolicy of ["disabled", "economical"] as const) {
      expect(translateReasoningPolicy({
        provider: "groq",
        configuredModelId: QWEN_3_6,
        semanticPolicy,
      })).toEqual({
        status: "translated",
        familyId: "groq_qwen_3_6",
        control: { kind: "reasoning_effort", value: "none" },
      });
    }
    for (const semanticPolicy of ["high", "max_supported"] as const) {
      expect(translateReasoningPolicy({
        provider: "groq",
        configuredModelId: QWEN_3_6,
        semanticPolicy,
      })).toEqual({
        status: "unsupported",
        code: "unsupported_reasoning_mapping",
      });
    }
  });
});

describe("Groq Qwen 3.8 translation", () => {
  it("maps standard to medium reasoning with hidden output", () => {
    const translated = translateReasoningPolicy({
      provider: "groq",
      configuredModelId: QWEN_3_8,
      semanticPolicy: "standard",
    });
    expect(translated).toEqual({
      status: "translated",
      familyId: "groq_qwen_3_8",
      control: {
        kind: "groq_reasoning_effort",
        value: "medium",
        reasoningFormat: "hidden",
      },
    });
    expect(
      translated.status === "translated"
        ? formatTranslatedWireControl(translated.control)
        : null,
    ).toBe("reasoning_effort=medium;reasoning_format=hidden");
  });

  it("keeps disabled and economical at none and rejects unsupported higher policies", () => {
    for (const semanticPolicy of ["disabled", "economical"] as const) {
      expect(translateReasoningPolicy({
        provider: "groq",
        configuredModelId: QWEN_3_8,
        semanticPolicy,
      })).toEqual({
        status: "translated",
        familyId: "groq_qwen_3_8",
        control: { kind: "reasoning_effort", value: "none" },
      });
    }
    for (const semanticPolicy of ["high", "max_supported"] as const) {
      expect(translateReasoningPolicy({
        provider: "groq",
        configuredModelId: QWEN_3_8,
        semanticPolicy,
      })).toEqual({
        status: "unsupported",
        code: "unsupported_reasoning_mapping",
      });
    }
  });
});

describe("fail-closed provider capability", () => {
  it("rejects unknown Nemotron families instead of guessing", () => {
    expect(
      translateReasoningPolicy({
        provider: "nim",
        configuredModelId: "nvidia/nemotron-unknown-99b",
        semanticPolicy: "max_supported",
      }),
    ).toEqual({ status: "unsupported", code: "unknown_nemotron_family" });
  });

  it("rejects unknown reasoning semantics", () => {
    expect(
      resolveOccupantSemanticPolicy({
        provider: "nim",
        configuredModelId: ULTRA,
        reasoningPolicy: "thinking_on",
        effectiveReasoning: "provider_default",
      }),
    ).toEqual({ ok: false, code: "unknown_reasoning_semantic" });
  });

  it("does not silently map unmatched families as Nemotron", () => {
    expect(
      translateReasoningPolicy({
        provider: "nim",
        configuredModelId: GPT_OSS,
        semanticPolicy: "economical",
      }),
    ).toEqual({ status: "unmapped_family" });
    expect(
      translateReasoningPolicy({
        provider: "mistral",
        configuredModelId: "mistral-medium-latest",
        semanticPolicy: "standard",
      }),
    ).toEqual({ status: "unmapped_family" });
  });

  it("refuses Ultra reasoning_effort low and Super medium on the wire", () => {
    const ultraBody: Record<string, unknown> = {};
    expect(() =>
      applyTranslatedControlToNimBody(ultraBody, ULTRA, {
        kind: "reasoning_effort",
        value: "low",
      }),
    ).toThrow("ultra_rejects_reasoning_effort_low");
    const superBody: Record<string, unknown> = {};
    expect(() =>
      applyTranslatedControlToNimBody(superBody, SUPER, {
        kind: "reasoning_effort",
        value: "medium",
      }),
    ).toThrow("super_rejects_reasoning_effort_medium");
  });
});

describe("receipt observation layers", () => {
  it("keeps semantic, wire, and observed reasoning distinct", () => {
    const probe = inspectFabricNimRequest({
      provider: "nim",
      configuredModelId: ULTRA,
      reasoningPolicy: "max_supported",
    });
    expect(probe.semanticPolicy).toBe("max_supported");
    expect(
      probe.translation.status === "translated"
        ? formatTranslatedWireControl(probe.translation.control)
        : null,
    ).toBe("reasoning_effort=high");
    expect(observedReasoningFromUsage({ reasoningTokens: 523 })).toEqual({
      status: "tokens",
      reasoningTokens: 523,
    });
  });

  it("treats missing reasoning tokens as unknown, never zero", () => {
    expect(observedReasoningFromUsage(undefined)).toEqual({ status: "unknown" });
    expect(observedReasoningFromUsage({})).toEqual({ status: "unknown" });
    expect(observedReasoningFromUsage({}).status).not.toBe("tokens");
  });
});

describe("inference fingerprint materiality", () => {
  it("changes when wire translation is applied instead of hashing the semantic alias", () => {
    const aliasHash = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: ULTRA,
      reasoningEffort: "max_supported",
    });
    const repairedHash = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: ULTRA,
      reasoningEffort: "high",
      translatedWireControl: "reasoning_effort=high",
    });
    const gptOssCurrent = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: GPT_OSS,
      reasoningEffort: "low",
    });
    const gptOssStillCurrent = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: GPT_OSS,
      reasoningEffort: "low",
    });
    expect(repairedHash).not.toBe(aliasHash);
    expect(gptOssStillCurrent).toBe(gptOssCurrent);
  });

  it("changes when the Lightning reasoning budget changes", () => {
    const bounded = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: LIGHTNING,
      reasoningEffort: null,
      translatedWireControl:
        "chat_template_kwargs.enable_thinking=true;reasoning_budget=512",
      maxTokens: 4096,
    });
    const materiallyDifferent = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: LIGHTNING,
      reasoningEffort: null,
      translatedWireControl:
        "chat_template_kwargs.enable_thinking=true;reasoning_budget=256",
      maxTokens: 4096,
    });
    expect(materiallyDifferent).not.toBe(bounded);
  });

  it("changes when Qwen provider reasoning or hidden-output mode changes", () => {
    const enabled = createInferencePolicyFingerprint({
      provider: "groq",
      configuredModelId: QWEN_3_8,
      reasoningEffort: "medium",
      translatedWireControl: "reasoning_effort=medium;reasoning_format=hidden",
      maxTokens: 4096,
    });
    const disabled = createInferencePolicyFingerprint({
      provider: "groq",
      configuredModelId: QWEN_3_8,
      reasoningEffort: "none",
      translatedWireControl: "reasoning_effort=none",
      maxTokens: 4096,
    });
    const visible = createInferencePolicyFingerprint({
      provider: "groq",
      configuredModelId: QWEN_3_8,
      reasoningEffort: "medium",
      translatedWireControl: "reasoning_effort=medium;reasoning_format=visible",
      maxTokens: 4096,
    });
    expect(enabled).not.toBe(disabled);
    expect(enabled).not.toBe(visible);
  });
});

describe("NIM adapter GPT-OSS and Nemotron isolation", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hello" }];

  it("keeps CURRENT GPT-OSS reasoning_effort low", async () => {
    const original = env.nimApiKey;
    env.nimApiKey = "test";
    let captured: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      captured = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      };
    });
    await adapter.dispatch({
      messages,
      modelId: GPT_OSS,
      options: { reasoningEffort: "low" },
    });
    expect(captured?.reasoning_effort).toBe("low");
    expect(captured?.chat_template_kwargs).toBeUndefined();
    env.nimApiKey = original;
  });

  it("does not attach Nemotron kwargs to generic NIM models", async () => {
    const original = env.nimApiKey;
    env.nimApiKey = "test";
    let captured: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      captured = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      };
    });
    await adapter.dispatch({
      messages,
      modelId: GPT_OSS,
      options: { reasoningEffort: "low" },
    });
    expect(captured?.chat_template_kwargs).toBeUndefined();
    env.nimApiKey = original;
  });

  it("emits Lightning enable_thinking false from trusted Fabric translation", async () => {
    const original = env.nimApiKey;
    env.nimApiKey = "test";
    let captured: Record<string, unknown> | undefined;
    const adapter = createNimAdapter(async (_url, init) => {
      captured = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      };
    });
    await adapter.dispatch({
      messages,
      modelId: LIGHTNING,
      options: {},
      fabricReasoning: { kind: "chat_template_thinking", enableThinking: false },
    });
    expect(captured?.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(captured?.reasoning_effort).toBeUndefined();
    env.nimApiKey = original;
  });
});
