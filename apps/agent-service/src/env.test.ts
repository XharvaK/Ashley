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
];

const originals = new Map<string, string | undefined>(
  TOUCHED_VARS.map((name) => [name, process.env[name]]),
);

beforeEach(() => {
  for (const name of TOUCHED_VARS) delete process.env[name];
  process.env.COMPOSER_ENV_FILE = "";
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
    process.env.ASHLEY_SANDBOX_ENGINEERING_LIFECYCLE_ENABLED = "yes";
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
