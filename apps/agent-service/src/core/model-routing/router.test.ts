import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi, afterEach } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  requireRouteEnabled,
  resolveRoute,
  quotaContractFor,
  routeForBucket,
} from "./router.js";
import { routeBinding } from "./registry.js";
import * as portfolioModule from "../model-fabric/portfolio.js";

const originalRps = env.mistralRequestsPerSecond;
const originalTpm = env.mistralTokensPerMinute;

afterEach(() => {
  env.mistralRequestsPerSecond = originalRps;
  env.mistralTokensPerMinute = originalTpm;
  vi.restoreAllMocks();
});

describe("model-routing router", () => {
  it("resolves expression and maintenance purposes to their routes", () => {
    expect(resolveRoute("expression")).toMatchObject({
      route: "ashley_expression",
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
    expect(resolveRoute("maintenance")).toMatchObject({
      route: "utility_bulk",
      provider: "nim",
      configuredModelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    });
  });

  it("resolves Thought-owned observation and reflection to the Thought route", () => {
    expect(resolveRoute("thought_observation")).toMatchObject({
      route: "thought",
      provider: "cloudflare",
      configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    });
    expect(resolveRoute("reflection_initiative")).toMatchObject({
      route: "thought",
      provider: "cloudflare",
      configuredModelId: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    });
  });

  it("derives mistral bucket limits from env", () => {
    env.mistralRequestsPerSecond = 3;
    env.mistralTokensPerMinute = 12_345;
    const c = quotaContractFor("mistral:mistral-small-2603");
    expect(c.rps).toBe(3);
    expect(c.tpm).toBe(12_345);
    expect(c.rpm).toBe(180);
    expect(c.tpd).toBe(12_345 * 60);
  });

  it("derives groq bucket limits from the contract table", () => {
    const c = quotaContractFor("groq:openai/gpt-oss-20b");
    expect(c).toMatchObject({ rps: 40, tpm: 8000 });
  });

  it("returns undefined for unknown buckets", () => {
    expect(routeForBucket("bogus:model")).toBeUndefined();
  });

  it("returns provider/model/context from the CURRENT snapshot record", () => {
    vi.spyOn(portfolioModule, "routeRecordsFromCurrentPortfolio").mockReturnValue([
      {
        route: "thought",
        provider: "groq",
        configuredModelId: "fixture/current-model",
        contextProfile: "thought_summary",
        enabled: true,
        quotaContract: { rps: 1, rpm: 1, rpd: 1, tpm: 1, tpd: 1 },
      },
    ]);

    expect(requireRouteEnabled("thought")).toMatchObject({
      provider: "groq",
      configuredModelId: "fixture/current-model",
      contextProfile: "thought_summary",
      enabled: true,
    });
  });

  it("survives a full migrate to v18 with routing columns present", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const cols = (
      db
        .prepare(`PRAGMA table_info(attention_requests)`)
        .all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["provider_id", "route_alias", "quota_bucket"]),
    );
    expect(routeBinding("thought").provider).toBe("cloudflare");
    expect(routeBinding("thought").configuredModelId).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
    db.close();
    continuity.close();
  });
});
