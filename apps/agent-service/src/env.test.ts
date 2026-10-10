import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOUCHED_VARS = [
  "COMPOSER_ENV_FILE",
  "COGNITION_DISPATCH_INTERVAL_SEC",
  "MISTRAL_API_KEY",
  "MISTRAL_API_KEY_SECONDARY",
  "MISTRAL_MODEL",
  "MISTRAL_REQUESTS_PER_SECOND",
  "NIM_API_KEY",
  "ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID",
  "ASHLEY_SANDBOX_ENGINEERING_LIFECYCLE_ENABLED",
  "ASHLEY_SANDBOX_PROJECT_REGISTRY",
  "DISCORD_OWNER_ID",
  "DISCORD_BOT_TOKEN",
  "ASHLEY_SERVICE_TOKEN",
  "PROACTIVE_ENABLED",
  "CURIOSITY_ENABLED",
  "ASHLEY_OWNER_PRESENCE_FACTS",
  "ASHLEY_DEBUG_ROUTES",
];

const originals = new Map<string, string | undefined>(
  TOUCHED_VARS.map((name) => [name, process.env[name]]),
);

beforeEach(() => {
  for (const name of TOUCHED_VARS) delete process.env[name];
  process.env.COMPOSER_ENV_FILE = "";
  // Boot requires an Owner and the bot service token (SC-ADM-02).
  process.env.DISCORD_OWNER_ID = "env-test-owner";
  process.env.DISCORD_BOT_TOKEN = "env-test-bot-token";
  vi.resetModules();
});

afterEach(() => {
  for (const [name, original] of originals) {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  vi.resetModules();
});

async function loadEnv() {
  vi.resetModules();
  return import("./env.js");
}

describe("numeric environment validation", () => {
  it("falls back and warns instead of producing NaN", async () => {
    process.env.COGNITION_DISPATCH_INTERVAL_SEC = "not-a-number";
    process.env.MISTRAL_REQUESTS_PER_SECOND = "-3";
    const { env, validateBoot } = await loadEnv();

    expect(env.cognitionDispatchIntervalSec).toBe(30);
    expect(env.mistralRequestsPerSecond).toBe(1);
    expect(validateBoot().warnings).toEqual(expect.arrayContaining([
      "COGNITION_DISPATCH_INTERVAL_SEC invalid; using 30",
      "MISTRAL_REQUESTS_PER_SECOND invalid; using 1",
    ]));
  });
});

describe("Mistral credential seats", () => {
  it("keeps the secondary credential optional and separate from the model setting", async () => {
    process.env.MISTRAL_API_KEY = "primary-secret";
    process.env.MISTRAL_API_KEY_SECONDARY = "secondary-secret";
    process.env.MISTRAL_MODEL = "mistral-small-2603";
    const { env, validateBoot } = await loadEnv();

    expect(env.mistralApiKey).toBe("primary-secret");
    expect(env.mistralApiKeySecondary).toBe("secondary-secret");
    expect(env.mistralModel).toBe("mistral-small-2603");
    expect(validateBoot().errors).not.toContain(
      "MISTRAL_API_KEY_SECONDARY is required",
    );
  });
});

describe("Sandbox V2 environment", () => {
  it("fails closed on a malformed direct-lifecycle boolean", async () => {
    process.env.ASHLEY_SANDBOX_ENGINEERING_LIFECYCLE_ENABLED = "maybe";
    const { env, validateBoot } = await loadEnv();

    expect(env.sandboxEngineeringLifecycleEnabled).toBe(false);
    expect(validateBoot().ok).toBe(false);
    expect(validateBoot().errors).toContain(
      'ASHLEY_SANDBOX_ENGINEERING_LIFECYCLE_ENABLED must be "true" or "false"',
    );
  });

  it("accepts the current V2 lifecycle switch and refreshes the registry path", async () => {
    const { env, refreshEnvFromProcess, validateBoot } = await loadEnv();
    expect(env.sandboxEngineeringLifecycleEnabled).toBe(false);
    expect(validateBoot().ok).toBe(true);

    process.env.ASHLEY_SANDBOX_ENGINEERING_LIFECYCLE_ENABLED = "true";
    process.env.ASHLEY_SANDBOX_PROJECT_REGISTRY = " /tmp/ashley-project-roots.json ";
    refreshEnvFromProcess();

    expect(env.sandboxEngineeringLifecycleEnabled).toBe(true);
    expect(env.sandboxProjectRegistryPath).toBe("/tmp/ashley-project-roots.json");
    expect(validateBoot().ok).toBe(true);
  });
});

describe("NVIDIA configuration", () => {
  it("defaults to optional and unused when no NIM key is configured", async () => {
    const { env, validateBoot } = await loadEnv();

    expect(env.nimApiKey).toBe("");
    expect(env.nimBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(validateBoot().ok).toBe(true);
  });
});

describe("Cloudflare Thought session affinity", () => {
  it("stays disabled and boots normally when the affinity id is unset", async () => {
    const { env, validateBoot } = await loadEnv();

    expect(env.cloudflareThoughtAffinityId).toBe("");
    expect(validateBoot().ok).toBe(true);
  });

  it("accepts a valid opaque affinity id", async () => {
    process.env.ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID = "qual-synthetic-affinity-01";
    const { env, validateBoot } = await loadEnv();

    expect(env.cloudflareThoughtAffinityId).toBe("qual-synthetic-affinity-01");
    expect(validateBoot().ok).toBe(true);
  });

  it.each([
    ["too-short", "abc"],
    ["empty", ""],
    ["whitespace", "   "],
    ["spaces", "has spaces in it 123456"],
    ["punctuation", "12345678901234567890123456789012!"],
    ["content-derived", "user hello world, affinity please?"],
  ])("fails boot validation for a %s configured value", async (_label, value) => {
    process.env.ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID = value;
    const { env, validateBoot } = await loadEnv();

    expect(env.cloudflareThoughtAffinityId).toBe("");
    expect(validateBoot().ok).toBe(false);
    expect(validateBoot().errors).toContain(
      "ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID must be 16-128 chars of [A-Za-z0-9_-]",
    );
  });
});

describe("boolean environment flags parse one way", () => {
  it.each(["false", "0", "no", "off", "FALSE", " Off "])("reads %j as off for an opt-out switch", async (raw) => {
    process.env.PROACTIVE_ENABLED = raw;
    process.env.CURIOSITY_ENABLED = raw;
    const { env } = await loadEnv();

    expect(env.proactiveEnabled).toBe(false);
    expect(env.curiosityEnabled).toBe(false);
  });

  it.each(["true", "1", "yes", "on"])("reads %j as on for an opt-in switch", async (raw) => {
    process.env.ASHLEY_OWNER_PRESENCE_FACTS = raw;
    const { env } = await loadEnv();

    expect(env.ownerPresenceFacts).toBe(true);
  });

  it("keeps the default and reports a malformed value instead of silently reading it as on", async () => {
    process.env.PROACTIVE_ENABLED = "maybe";
    const { env, validateBoot } = await loadEnv();

    expect(env.proactiveEnabled).toBe(true);
    expect(validateBoot().warnings).toContain("PROACTIVE_ENABLED is not a boolean; using true");
  });

  it("keeps opt-in switches off when they are unset", async () => {
    const { env } = await loadEnv();

    expect(env.ownerPresenceFacts).toBe(false);
    expect(env.proactiveEnabled).toBe(true);
  });
});

describe("agent service token (ASHLEY_SERVICE_TOKEN)", () => {
  it("prefers the separate service token over the Discord bot token", async () => {
    process.env.ASHLEY_SERVICE_TOKEN = "service-test-token";
    const { env, validateBoot } = await loadEnv();

    expect(env.agentServiceToken).toBe("service-test-token");
    expect(validateBoot().ok).toBe(true);
    expect(validateBoot().warnings.join(" ")).not.toMatch(/ASHLEY_SERVICE_TOKEN/);
  });

  it("falls back to the bot token for one release and says so at boot", async () => {
    const { env, validateBoot } = await loadEnv();

    expect(env.agentServiceToken).toBe("env-test-bot-token");
    expect(validateBoot().ok).toBe(true);
    expect(validateBoot().warnings).toContain(
      "ASHLEY_SERVICE_TOKEN unset; using DISCORD_BOT_TOKEN as the agent service token (deprecated fallback)",
    );
  });

  it("refuses boot when neither token is set", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const { validateBoot } = await loadEnv();

    expect(validateBoot().ok).toBe(false);
    expect(validateBoot().errors).toContain(
      "ASHLEY_SERVICE_TOKEN or DISCORD_BOT_TOKEN missing — every route but /health requires the agent service token",
    );
  });
});

describe("debug routes", () => {
  it("are off unless the explicit debug flag is set, whatever NODE_ENV says", async () => {
    const { env } = await loadEnv();
    expect(env.debugRoutesEnabled).toBe(false);

    process.env.ASHLEY_DEBUG_ROUTES = "true";
    const reloaded = await loadEnv();
    expect(reloaded.env.debugRoutesEnabled).toBe(true);
  });
});
