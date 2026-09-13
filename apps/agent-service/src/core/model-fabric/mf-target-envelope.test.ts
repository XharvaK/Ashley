import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPRESSION_MAX_OUTPUT_TOKENS,
  EXPRESSION_PROACTIVE_MAX_OUTPUT_TOKENS,
} from "../conversation/expression-fallback.js";
import { loadFabricCatalog, loadTargetPortfolio } from "./catalog.js";
import { currentPortfolio } from "./portfolio.js";
import {
  createInferencePolicyFingerprint,
  translateReasoningPolicy,
} from "./index.js";

const controlDir = join(homedir(), ".composer-assistant", "control", "model-fabric");

describe("TARGET portfolio + token envelope reconciliation", () => {
  const current = currentPortfolio();
  const target = loadTargetPortfolio();
  const catalog = loadFabricCatalog();

  it("loads a new declared TARGET identity and preserves historical v1", () => {
    expect(target.portfolioRevisionId).toBe("mfp_target_12_9_v2");
    expect(target.status).toBe("declared");
    expect(target.kind).toBe("candidate_target");
    expect(target.sourcePath.replaceAll("\\", "/")).toMatch(/target-12-9\.v2\.json$/);
    expect(existsSync(join(target.sourcePath, "..", "target-12-9.v1.json"))).toBe(true);
    expect(current.portfolioRevisionId).toBe("mfp_current_compatibility_v4");
    expect(current.kind).toBe("current_compatibility");
  });

  it("keeps CURRENT Thought and Expression model identities with owner-approved ceilings", () => {
    const thought = current.rows.find((row) => row.policyRowId === "mfr_thought_interactive_compat_v1")!;
    const durable = current.rows.find((row) => row.policyRowId === "mfr_thought_durable_proactive_compat_v1")!;
    const expression = current.rows.find((row) => row.policyRowId === "mfr_expression_compat_v1")!;
    expect(thought.occupants[0]).toMatchObject({
      provider: "cloudflare",
      configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      reasoningPolicy: "high",
      effectiveReasoning: "high",
    });
    expect(thought.deadlineMs).toBe(60000);
    expect(thought.maxOutputTokens).toBe(16384);
    expect(durable.maxOutputTokens).toBe(16384);
    expect(expression.occupants[0]).toMatchObject({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
    expect(expression.occupants[1]).toMatchObject({
      provider: "groq",
      configuredModelId: "qwen/qwen3.6-27b",
      invocationMode: "caller_owned_chain",
    });
    expect(expression.maxOutputTokens).toBe(2048);
    expect(EXPRESSION_MAX_OUTPUT_TOKENS).toBe(2048);
    expect(EXPRESSION_PROACTIVE_MAX_OUTPUT_TOKENS).toBe(500);
    expect(current.routeBindings.thought).toMatchObject({
      provider: "cloudflare",
      configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    });
    expect(current.routeBindings.ashley_expression).toMatchObject({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
  });

  it("keeps the target envelope separate from the owner-approved CURRENT deadline", () => {
    const observation = current.rows.find((row) => row.policyRowId === "mfr_thought_observation_compat_v1")!;
    expect(observation.maxOutputTokens).toBe(450);
    // P2 unrelated-8192 guard: non-Thought CURRENT rows are byte-identical.
    expect(current.rows.find((row) => row.policyRowId === "mfr_reflection_initiative_compat_v1")!.maxOutputTokens).toBe(300);
    expect(current.rows.find((row) => row.policyRowId === "mfr_exchange_cognition_compat_v1")!.maxOutputTokens).toBe(1100);
    expect(current.rows.find((row) => row.policyRowId === "mfr_curiosity_consolidation_compat_v1")!.maxOutputTokens).toBe(900);
    expect(current.rows.find((row) => row.policyRowId === "mfr_maintenance_compat_v1")!.maxOutputTokens).toBe(2048);
    expect(current.rows.find((row) => row.policyRowId === "mfr_thought_interactive_compat_v1")!.deadlineMs).toBe(60000);
    expect(target.rows.find((row) => row.policyRowId === "mfr_thought_interactive_target_v1")!.deadlineMs).toBe(6000);
    expect(target.rows.find((row) => row.policyRowId === "mfr_thought_observation_target_v1")!.deadlineMs).toBeNull();
  });

  it("sets Ultra/Super high TARGET envelopes to 4096 with unchanged translator mappings", () => {
    const observation = target.rows.find((row) => row.policyRowId === "mfr_thought_observation_target_v1")!;
    const reflection = target.rows.find((row) => row.policyRowId === "mfr_reflection_initiative_target_v1")!;
    const exchange = target.rows.find((row) => row.policyRowId === "mfr_exchange_cognition_target_v1")!;
    const curiosity = target.rows.find((row) => row.policyRowId === "mfr_curiosity_consolidation_target_v1")!;
    expect(observation.maxOutputTokens).toBe(4096);
    expect(reflection.maxOutputTokens).toBe(4096);
    expect(exchange.maxOutputTokens).toBe(4096);
    expect(curiosity.maxOutputTokens).toBe(4096);
    expect(observation.occupants[0]?.occupantId).toBe("mfo_nim_nemotron_3_ultra_max");
    expect(reflection.occupants[0]?.occupantId).toBe("mfo_nim_nemotron_3_ultra_max_reflection");
    expect(exchange.occupants[0]?.occupantId).toBe("mfo_nim_nemotron_3_super_high");
    expect(curiosity.occupants[0]?.occupantId).toBe("mfo_nim_nemotron_3_super_high_curiosity");
    const ultra = translateReasoningPolicy({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3-ultra-550b-a55b",
      semanticPolicy: "max_supported",
    });
    const superHigh = translateReasoningPolicy({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3-super-120b-a12b",
      semanticPolicy: "high",
    });
    const superLow = translateReasoningPolicy({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3-super-120b-a12b",
      semanticPolicy: "economical",
    });
    expect(ultra).toEqual({
      status: "translated",
      familyId: "nim_nemotron_ultra",
      control: { kind: "reasoning_effort", value: "high" },
    });
    expect(superHigh).toEqual({
      status: "translated",
      familyId: "nim_nemotron_super",
      control: { kind: "reasoning_effort", value: "high" },
    });
    expect(superLow).toEqual({
      status: "translated",
      familyId: "nim_nemotron_super",
      control: { kind: "reasoning_effort", value: "low" },
    });
  });

  it("selects Super economical for intended utility TARGET rows and keeps Lightning deferred", () => {
    const maintenance = target.rows.find((row) => row.policyRowId === "mfr_maintenance_target_v1")!;
    const validation = target.rows.find((row) => row.seat === "routine_validation")!;
    expect(maintenance.reasoningPolicy).toBe("economical");
    expect(maintenance.maxOutputTokens).toBe(2048);
    expect(maintenance.occupants[0]).toMatchObject({
      occupantId: "mfo_nim_nemotron_3_super_economical_maintenance",
      configuredModelId: "nvidia/nemotron-3-super-120b-a12b",
      reasoningPolicy: "economical",
      effectiveReasoning: "economical",
    });
    expect(validation.reasoningPolicy).toBe("economical");
    expect(validation.maxOutputTokens).toBe(1000);
    expect(validation.occupants[0]).toMatchObject({
      occupantId: "mfo_nim_nemotron_3_super_economical_validation",
      configuredModelId: "nvidia/nemotron-3-super-120b-a12b",
      reasoningPolicy: "economical",
      effectiveReasoning: "economical",
    });
    const intendedModels = target.rows.flatMap((row) => row.occupants.map((occupant) => occupant.configuredModelId));
    expect(intendedModels).not.toContain("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(maintenance.quotaCouplingIds).toContain("qc_nim_nemotron_super");
    expect(maintenance.quotaCouplingIds).not.toContain("qc_nim_lightning");
    expect(catalog.couplings.qc_nim_lightning).toBeDefined();
    expect(catalog.independenceGroups.nvidia_nemotron).toContain(
      "nvidia/nemotron-3.5-lightning-30b-a3b",
    );
  });

  it("changes material fingerprints when maxTokens changes and does not reuse old envelopes", () => {
    const oldObservation = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3-ultra-550b-a55b",
      reasoningEffort: "high",
      translatedWireControl: "reasoning_effort=high",
      temperature: 0.15,
      maxTokens: 450,
      responseFormat: "json_object",
      toolCount: 0,
      toolNames: [],
    });
    const newObservation = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3-ultra-550b-a55b",
      reasoningEffort: "high",
      translatedWireControl: "reasoning_effort=high",
      temperature: 0.15,
      maxTokens: 4096,
      responseFormat: "json_object",
      toolCount: 0,
      toolNames: [],
    });
    expect(oldObservation).toBe(
      "sha256:0254e166c53d189c23f4ca8ebf359ae9af4db510cba12a77c93281ea639ad8e9",
    );
    expect(newObservation).not.toBe(oldObservation);
    const oldThought = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: "openai/gpt-oss-20b",
      reasoningEffort: "low",
      temperature: 0.15,
      maxTokens: 1000,
      responseFormat: "json_object",
      toolCount: 0,
      toolNames: [],
    });
    const newThought = createInferencePolicyFingerprint({
      provider: "nim",
      configuredModelId: "openai/gpt-oss-20b",
      reasoningEffort: "low",
      temperature: 0.15,
      maxTokens: 2048,
      responseFormat: "json_object",
      toolCount: 0,
      toolNames: [],
    });
    expect(newThought).not.toBe(oldThought);
  });

  it("keeps TARGET dark: no active.json and CURRENT remains the dispatchable portfolio", () => {
    expect(existsSync(join(controlDir, "active.json"))).toBe(false);
    expect(existsSync(join(controlDir, "approvals"))).toBe(false);
    expect(existsSync(join(controlDir, "activations"))).toBe(false);
    expect(current.kind).toBe("current_compatibility");
    expect(target.kind).toBe("candidate_target");
  });
});
