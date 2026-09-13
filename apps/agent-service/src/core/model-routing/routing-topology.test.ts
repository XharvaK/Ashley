import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  currentPortfolio,
  resetCurrentPortfolioForTests,
  resolveCurrentPolicy,
} from "../model-fabric/portfolio.js";
import {
  loadRouteRecords,
  quotaContractFor,
  requireRouteEnabled,
  resolveRoute,
} from "./router.js";
import { routeBinding } from "./registry.js";

const LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";
const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const THOUGHT_MODEL = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const MISTRAL_SMALL = "mistral-small-2603";

afterEach(() => {
  resetCurrentPortfolioForTests();
});

describe("Phase 5 successor routing topology", () => {
  it("loads a new current revision while preserving the v2 snapshot", () => {
    const portfolio = currentPortfolio();

    expect(portfolio.portfolioRevisionId).toBe("mfp_current_compatibility_v4");
    expect(portfolio.replacesPortfolioRevisionId).toBe(
      "mfp_current_compatibility_v3",
    );
    expect(portfolio.sourcePath.replaceAll("\\", "/")).toMatch(
      /current-compatibility\.v3\.json$/,
    );
    expect(
      existsSync(join(portfolio.sourcePath, "..", "current-compatibility.v2.json")),
    ).toBe(true);
  });

  it("routes Expression and every direct utility purpose to NIM Lightning", () => {
    expect(resolveRoute("expression")).toMatchObject({
      route: "ashley_expression",
      provider: "nim",
      configuredModelId: LIGHTNING,
    });

    for (const purpose of [
      "exchange_cognition",
      "curiosity_consolidation",
      "maintenance",
    ]) {
      expect(resolveRoute(purpose)).toMatchObject({
        route: "utility_bulk",
        provider: "nim",
        configuredModelId: LIGHTNING,
      });
    }
  });

  it("keeps Thought-owned observation and reflection on Thought despite utility scars", () => {
    for (const purpose of ["thought_observation", "reflection_initiative"]) {
      expect(resolveRoute(purpose)).toMatchObject({
        route: "thought",
        provider: "cloudflare",
        configuredModelId: THOUGHT_MODEL,
      });
    }

    const observation = resolveCurrentPolicy({
      logicalRole: "thought_observation",
      purpose: "thought_observation",
      lane: "exchange_cognition",
    });
    const reflection = resolveCurrentPolicy({
      logicalRole: "reflection_initiative",
      purpose: "thought_observation",
      lane: "exchange_cognition",
    });

    expect(observation).toMatchObject({
      configuredRouteId: "utility_bulk",
      dispatchedRouteId: "thought",
      occupant: { provider: "cloudflare", configuredModelId: THOUGHT_MODEL },
    });
    expect(reflection).toMatchObject({
      configuredRouteId: "utility_bulk",
      dispatchedRouteId: "thought",
      occupant: { provider: "cloudflare", configuredModelId: THOUGHT_MODEL },
    });
  });

  it("binds every Cloudflare Thought row to JSON_OBJECT compatibility enforcement", () => {
    const thoughtRows = currentPortfolio().rows.filter((row) =>
      ["thought", "thought_observation", "reflection_initiative"].includes(
        row.logicalRole,
      ),
    );
    expect(thoughtRows).toHaveLength(4);
    for (const row of thoughtRows) {
      expect(row.structuredOutput).toBe("json_schema");
      expect(row.occupants[0]).toMatchObject({
        provider: "cloudflare",
        configuredModelId: THOUGHT_MODEL,
        reasoningPolicy: "high",
        effectiveReasoning: "high",
        structuredOutputBinding: {
          mode: "json_object_compatibility",
        },
      });
    }
  });

  it("keeps Expression fallback metadata on Groq Qwen without a stale Mistral occupant", () => {
    const expression = currentPortfolio().rows.find(
      (row) => row.logicalRole === "expression",
    );
    expect(expression?.occupants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "nim",
          configuredModelId: LIGHTNING,
        }),
        expect.objectContaining({
          provider: "groq",
          configuredModelId: "qwen/qwen3.6-27b",
          invocationMode: "caller_owned_chain",
        }),
      ]),
    );
    expect(expression?.occupants).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "mistral",
          configuredModelId: "mistral-medium-latest",
        }),
      ]),
    );
  });

  it("moves sandbox operator wiring to NIM while preserving disabled state", () => {
    expect(routeBinding("sandbox_operator_light")).toMatchObject({
      provider: "nim",
      configuredModelId: LIGHTNING,
      enabled: false,
    });
    expect(routeBinding("sandbox_operator_deep")).toMatchObject({
      provider: "nim",
      configuredModelId: ULTRA,
      enabled: false,
    });

    expect(() => requireRouteEnabled("sandbox_operator_light")).toThrow(
      "route disabled: sandbox_operator_light",
    );
    expect(() => requireRouteEnabled("sandbox_operator_deep")).toThrow(
      "route disabled: sandbox_operator_deep",
    );
  });

  it("has no Mistral Medium or Groq GPT-OSS occupant reachable in the new revision", () => {
    const portfolio = currentPortfolio();
    const occupants = portfolio.rows.flatMap((row) => row.occupants);
    const activeRouteModels = loadRouteRecords().map(
      (route) => `${route.provider}:${route.configuredModelId}`,
    );

    expect(occupants.map((occupant) => occupant.configuredModelId)).not.toContain(
      "mistral-medium-latest",
    );
    expect(occupants.map((occupant) => occupant.configuredModelId)).not.toContain(
      "openai/gpt-oss-20b",
    );
    expect(occupants.map((occupant) => occupant.configuredModelId)).not.toContain(
      "openai/gpt-oss-120b",
    );
    expect(activeRouteModels).not.toContain("groq:openai/gpt-oss-20b");
    expect(activeRouteModels).not.toContain("groq:openai/gpt-oss-120b");
  });

  it("shares the existing NIM quota/failure-domain contract across NIM route bindings", () => {
    const records = loadRouteRecords();
    const nimRecords = records.filter(
      (record) =>
        record.provider === "nim" &&
        (record.configuredModelId === LIGHTNING ||
          record.configuredModelId === ULTRA),
    );
    expect(nimRecords.length).toBeGreaterThan(0);
    expect(new Set(nimRecords.map((record) => JSON.stringify(record.quotaContract)))).toEqual(
      new Set([JSON.stringify(quotaContractFor("nim:shared-provider-contract"))]),
    );
    expect(records.filter((record) => record.configuredModelId === LIGHTNING).map(
      (record) => record.route,
    )).toEqual(
      expect.arrayContaining([
        "ashley_expression",
        "utility_bulk",
        "sandbox_operator_light",
      ]),
    );
    expect(routeBinding("ashley_expression").provider).toBe(
      routeBinding("utility_bulk").provider,
    );
    expect(routeBinding("sandbox_operator_light").provider).toBe(
      routeBinding("ashley_expression").provider,
    );
  });
});
