import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { completeChat } from "../../mistral-client.js";
import { openNuclearDb } from "../db.js";
import { expressSpeak } from "../conversation/expression.js";
import type { TurnContext } from "../context-composer.js";
import type { Decision } from "../types.js";

const APP_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const saved = {
  offline: process.env.ASHLEY_PHASE0_OFFLINE,
  envFile: process.env.COMPOSER_ENV_FILE,
  mistralApiKey: env.mistralApiKey,
  fallbackEnabled: env.expressionFallbackEnabled,
};

afterEach(() => {
  if (saved.offline === undefined) delete process.env.ASHLEY_PHASE0_OFFLINE;
  else process.env.ASHLEY_PHASE0_OFFLINE = saved.offline;
  if (saved.envFile === undefined) delete process.env.COMPOSER_ENV_FILE;
  else process.env.COMPOSER_ENV_FILE = saved.envFile;
  env.mistralApiKey = saved.mistralApiKey;
  env.expressionFallbackEnabled = saved.fallbackEnabled;
  vi.unstubAllGlobals();
});

function baseDecision(): Decision {
  return {
    trigger: "reactive",
    kind: "speak",
    motivationIds: [1],
    score: 100,
    reason: "offline fixture",
    evidenceRefs: [],
    uncertainty: 0,
    urgency: 0,
    thoughtSource: "deterministic",
    thoughtError: null,
    affectLicense: {
      permitted: false,
      valence: 0,
      activation: 0,
      openness: 0,
      tension: 0,
      reason: "offline fixture",
    },
    cognitiveAllocation: {
      shouldSpeak: true,
      effort: "medium",
      completion: "complete",
    },
    authorizedClaims: {
      readingRecordIds: [],
      readingTitles: [],
      readingClaims: [],
    },
  };
}

function baseTurn(): TurnContext {
  return {
    threadId: "offline-harness",
    hotMessages: [],
    facts: [],
    memoryBlock: "deterministic fixture memory",
    systemPrompt: "deterministic fixture system",
    decisionPrompt: "deterministic fixture decision",
  };
}

async function expectProviderBlocked(providerKey: string): Promise<void> {
  process.env.ASHLEY_PHASE0_OFFLINE = "true";
  env.mistralApiKey = providerKey;
  const fetchSpy = vi.fn(async () => {
    throw new Error("test_fetch_would_reach_external_network");
  });
  vi.stubGlobal("fetch", fetchSpy);
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  try {
    await expect(
      completeChat([{ role: "user", content: "offline probe" }], {
        route: "ashley_expression",
        attentionDb: db,
      }),
    ).rejects.toThrow("offline_network_blocked");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
}

describe("OFFLINE-HARNESS-01", () => {
  it("blocks the provider path before transport when credentials are absent", async () => {
    await expectProviderBlocked("");
  });

  it("blocks the provider path before transport when credentials are present", async () => {
    await expectProviderBlocked("fixture-present-provider-key");
  });

  it("keeps missing-credential tests meaningful with deterministic expression output", async () => {
    process.env.ASHLEY_PHASE0_OFFLINE = "true";
    env.mistralApiKey = "";
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const result = await expressSpeak(
      baseTurn(),
      baseDecision(),
      "fixture user message",
      "discord",
      { attentionDb: db },
      async () => ({
        text: "deterministic offline fixture response",
        model: "offline-fixture",
      }),
    );
    expect(result.text).toBe("deterministic offline fixture response");
    expect(result.model).toBe("offline-fixture");
    db.close();
  });

  it("represents provider failure with a deterministic fixture", async () => {
    process.env.ASHLEY_PHASE0_OFFLINE = "true";
    env.mistralApiKey = "";
    env.expressionFallbackEnabled = false;
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const result = await expressSpeak(
      baseTurn(),
      baseDecision(),
      "fixture provider failure",
      "discord",
      { attentionDb: db },
      async () => {
        throw new AppError(
          "provider_unavailable",
          "deterministic provider failure",
          503,
        );
      },
    );
    expect(result.model).toBe("offline");
    expect(result.text).toContain("offline at the moment");
    db.close();
  });

  it("fails a child qualification process loudly on external fetch", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx/esm",
        "--input-type=module",
        "-e",
        [
          'await import("./src/core/qualification/offline-network-guard.ts");',
          'try { await fetch("https://offline-guard.invalid/probe"); }',
          'catch (error) { console.log(String(error)); }',
          'for (const [transport, url] of [["http", "http://offline-guard.invalid/probe"], ["https", "https://offline-guard.invalid/probe"]]) {',
          '  const { request } = await import(`node:${transport}`);',
          '  try { request(url); }',
          '  catch (error) { console.log(String(error)); }',
          '}',
        ].join(" "),
      ],
      {
        cwd: APP_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          ASHLEY_PHASE0_OFFLINE: "true",
          COMPOSER_ENV_FILE: `${APP_ROOT}\\config\\env.example`,
        },
      },
    );
    expect(child.status).not.toBe(0);
    expect(`${child.stdout}\n${child.stderr}`).toContain(
      "offline_external_network_blocked",
    );
    expect(`${child.stdout}\n${child.stderr}`).toContain(
      "offline_external_network_blocked:http:",
    );
    expect(`${child.stdout}\n${child.stderr}`).toContain(
      "offline_external_network_blocked:https:",
    );
  });

  it("keeps the transport fence active inside the scoped application-gate seam", () => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx/esm",
        "--input-type=module",
        "-e",
        [
          'await import("./src/core/qualification/offline-network-guard.ts");',
          'const { withOfflineAppGateDisabled } = await import("./src/core/qualification/offline-test-helpers.ts");',
          'const { assertOutboundAllowed } = await import("./src/core/continuity/process-guards.ts");',
          'await withOfflineAppGateDisabled(async () => {',
          '  assertOutboundAllowed("deterministic-test");',
          '  console.log("application_guard_suppressed");',
          '  try { await fetch("https://offline-helper.invalid/probe"); } catch (error) { console.log(String(error)); }',
          '  for (const [transport, url] of [["http", "http://offline-helper.invalid/probe"], ["https", "https://offline-helper.invalid/probe"]]) {',
          '    const { request } = await import(`node:${transport}`);',
          '    try { request(url); } catch (error) { console.log(String(error)); }',
          '  }',
          '});',
        ].join(" "),
      ],
      {
        cwd: APP_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          ASHLEY_PHASE0_OFFLINE: "true",
          COMPOSER_ENV_FILE: `${APP_ROOT}\\config\\env.example`,
        },
      },
    );
    const output = `${child.stdout}\n${child.stderr}`;
    expect(child.status).not.toBe(0);
    expect(output).toContain("application_guard_suppressed");
    expect(output).toContain("offline_external_network_blocked:fetch:");
    expect(output).toContain("offline_external_network_blocked:http:");
    expect(output).toContain("offline_external_network_blocked:https:");
    expect(output).not.toContain("offline_network_blocked:deterministic-test");
  });
});
