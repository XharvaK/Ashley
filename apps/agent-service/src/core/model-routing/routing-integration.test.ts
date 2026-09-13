import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import {
  completeChat,
  adapterFor,
} from "../../mistral-client.js";
import {
  resolveRoute,
  requireRouteEnabled,
  disabledRouteError,
} from "./router.js";
import { quotaBucketFor } from "./types.js";
import { runAttentiveDispatch } from "../attention/governor.js";
import type { EstimateMessage } from "../attention/estimate.js";
import type { ProviderId } from "./types.js";
import { AppError } from "../../errors.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";

const ORIGINAL_MISTRAL_KEY = env.mistralApiKey;
const ORIGINAL_GROQ_KEY = env.groqApiKey;
const ORIGINAL_NIM_KEY = env.nimApiKey;
const ORIGINAL_CLOUDFLARE_TOKEN = env.cloudflareApiToken;
const ORIGINAL_CLOUDFLARE_ACCOUNT = env.cloudflareAccountId;

afterEach(() => {
  env.mistralApiKey = ORIGINAL_MISTRAL_KEY;
  env.groqApiKey = ORIGINAL_GROQ_KEY;
  env.nimApiKey = ORIGINAL_NIM_KEY;
  env.cloudflareApiToken = ORIGINAL_CLOUDFLARE_TOKEN;
  env.cloudflareAccountId = ORIGINAL_CLOUDFLARE_ACCOUNT;
});

function freshDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function rowCount(db: DatabaseSync, table: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c,
  );
}

describe("route-to-provider mapping", () => {
  it("expression routes to the NIM Lightning primary", () => {
    const b = resolveRoute("expression");
    expect(b.route).toBe("ashley_expression");
    expect(b.provider).toBe("nim");
    expect(b.configuredModelId).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it("thought routes to the Cloudflare DeepSeek V4 Flash primary", () => {
    const b = resolveRoute("thought");
    expect(b.route).toBe("thought");
    expect(b.provider).toBe("cloudflare");
    expect(b.configuredModelId).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
  });

  it.each([
    "exchange_cognition",
    "curiosity_consolidation",
    "maintenance",
  ])("utility purpose %s routes to NIM Lightning", (purpose) => {
    const b = resolveRoute(purpose);
    expect(b.route).toBe("utility_bulk");
    expect(b.provider).toBe("nim");
    expect(b.configuredModelId).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it.each(["thought_observation", "reflection_initiative"])(
    "Thought-owned purpose %s routes to Cloudflare DeepSeek rather than utility Lightning",
    (purpose) => {
      const b = resolveRoute(purpose);
      expect(b.route).toBe("thought");
      expect(b.provider).toBe("cloudflare");
      expect(b.configuredModelId).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
    },
  );

  it("all direct utility purposes share the NIM Lightning quota bucket", () => {
    const buckets = [
      "exchange_cognition",
      "curiosity_consolidation",
      "maintenance",
    ].map((p) => quotaBucketFor(resolveRoute(p).provider, resolveRoute(p).configuredModelId));
    expect(new Set(buckets)).toEqual(
      new Set(["nim:nvidia/nemotron-3.5-lightning-30b-a3b"]),
    );
    expect(quotaBucketFor("cloudflare", "@cf/deepseek-ai/deepseek-v4-flash-0731")).toBe(
      "cloudflare:@cf/deepseek-ai/deepseek-v4-flash-0731",
    );
  });
});

describe("disabled routes fail closed", () => {
  const disabled: readonly string[] = [
    "sandbox_operator_light",
    "sandbox_operator_deep",
    "sandbox_reviewer",
    "experimental_auditor",
    "experimental_multimodal",
  ];

  it.each(disabled)("requireRouteEnabled rejects %s without dispatching", (route) => {
    const db = freshDb();
    let thrown: unknown;
    try {
      requireRouteEnabled(route as never);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("operator_disabled");
    expect(rowCount(db, "attention_requests")).toBe(0);
    db.close();
  });

  it.each(disabled)(
    "completeChat rejects %s before provider dispatch or reservation",
    async (route) => {
      const db = freshDb();
      // Mistral key present so any accidental mistral dispatch is not the reason
      // the call is rejected; the route itself must be the gate.
      env.mistralApiKey = "present";
      env.groqApiKey = "present";
      env.nimApiKey = "present";
      await expect(
        completeChat([], { route: route as never, attentionDb: db }),
      ).rejects.toMatchObject({ code: "operator_disabled" });
      expect(rowCount(db, "attention_requests")).toBe(0);
      db.close();
    },
  );

  it("adapterFor fails closed for unsupported providers", () => {
    expect(() => adapterFor("unknown_provider" as ProviderId)).toThrow(
      "unsupported_provider:unknown_provider",
    );
  });

  it("disabled route error is typed operator_disabled", () => {
    expect(disabledRouteError("sandbox_reviewer").code).toBe("operator_disabled");
    expect(disabledRouteError("sandbox_reviewer").httpStatus).toBe(503);
  });
});

describe("unknown routes fail closed", () => {
  it("requireRouteEnabled rejects an unknown route id", () => {
    expect(() => requireRouteEnabled("nope" as never)).toThrow();
  });

  it("completeChat rejects an unknown explicit route before dispatch", async () => {
    const db = freshDb();
    await expect(
      completeChat([], { route: "nope" as never, attentionDb: db }),
    ).rejects.toThrow();
    expect(rowCount(db, "attention_requests")).toBe(0);
    db.close();
  });
});

describe("provider-aware missing key gating", () => {
  it("NIM Expression route fails before reservation when NIM_API_KEY is absent", async () => {
    env.mistralApiKey = "present";
    env.groqApiKey = "present";
    env.nimApiKey = "";
    const db = freshDb();
    await expect(
      withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "hi" }],
        { route: "ashley_expression", attentionDb: db },
      )),
    ).rejects.toMatchObject({ code: "agent_not_ready" });
    expect(rowCount(db, "attention_requests")).toBe(0);
    db.close();
  });

  it("Thought route fails before reservation when Cloudflare credentials are absent", async () => {
    env.mistralApiKey = "";
    env.groqApiKey = "";
    env.nimApiKey = "";
    env.cloudflareApiToken = "";
    env.cloudflareAccountId = "";
    const db = freshDb();
    await expect(
      withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "hi" }],
        { route: "thought", attentionDb: db },
      )),
    ).rejects.toMatchObject({ code: "agent_not_ready" });
    expect(rowCount(db, "attention_requests")).toBe(0);
    db.close();
  });
});

describe("shared NIM Lightning quota bucket at the dispatch layer", () => {
  it("two utility purposes consume one shared bucket", async () => {
    env.mistralApiKey = "present";
    env.groqApiKey = "";
    env.nimApiKey = "present";
    const db = freshDb();

    const fake = vi.fn(
      async () => ({
        providerModel: "nvidia/nemotron-3.5-lightning-30b-a3b",
        usage: { promptTokens: 1, completionTokens: 1 },
        result: { consumed: true },
      }),
    );

    async function dispatchOne(purpose: string): Promise<number> {
      const b = resolveRoute(purpose);
      const res = await runAttentiveDispatch<{ consumed: boolean }>(db, {
        messages: [] as EstimateMessage[],
        purpose: purpose as never,
        providerId: b.provider as ProviderId,
        quotaBucket: quotaBucketFor(b.provider, b.configuredModelId),
        modelAlias: b.configuredModelId,
        dispatch: fake,
      });
      return res.requestId;
    }

    const idA = await dispatchOne("exchange_cognition");
    const idB = await dispatchOne("maintenance");

    const rowA = db
      .prepare(`SELECT quota_bucket FROM attention_requests WHERE id = ?`)
      .get(idA) as { quota_bucket: string };
    const rowB = db
      .prepare(`SELECT quota_bucket FROM attention_requests WHERE id = ?`)
      .get(idB) as { quota_bucket: string };
    expect(rowA.quota_bucket).toBe("nim:nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(rowB.quota_bucket).toBe("nim:nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(rowA.quota_bucket).toBe(rowB.quota_bucket);
    expect(fake).toHaveBeenCalledTimes(2);
    db.close();
  });

  describe("Wave 2: Cloudflare Thought failure isolates the NIM Expression lane", () => {
    it("Thought failure leaves Expression independently dispatchable in its own bucket", async () => {
      env.mistralApiKey = "";
      env.groqApiKey = "";
      env.nimApiKey = "test";
      env.cloudflareApiToken = "test-cloudflare-token";
      env.cloudflareAccountId = "test-account";
      const db = freshDb();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({ error: { message: "unavailable" } }),
      } as Response);
      await expect(
        withOfflineAppGateDisabled(() => completeChat(
          [{ role: "user", content: "x" }],
          { route: "thought", attentionDb: db },
        )),
      ).rejects.toMatchObject({ code: "provider_unavailable" });
      fetchSpy.mockRestore();
      const thoughtCompletedRows = Number(
        (
          db.prepare(
            `SELECT COUNT(*) AS c FROM attention_requests WHERE quota_bucket = 'cloudflare:@cf/deepseek-ai/deepseek-v4-flash-0731' AND outcome = 'completed'`,
          ).get() as { c: number }
        ).c,
      );
      expect(thoughtCompletedRows).toBe(0);

      // Expression (NIM Lightning lane) is untouched and still dispatches.
      const b = resolveRoute("expression");
      let called = false;
      const res = await runAttentiveDispatch<{ echo: string }>(db, {
        messages: [] as EstimateMessage[],
        purpose: "expression" as never,
        providerId: b.provider,
        quotaBucket: quotaBucketFor(b.provider, b.configuredModelId),
        modelAlias: b.configuredModelId,
        dispatch: async () => {
          called = true;
          return {
            providerModel: b.configuredModelId,
            usage: { promptTokens: 1, completionTokens: 1 },
            result: { echo: "ok" },
          };
        },
      });
      expect(called).toBe(true);
      const lightningRows = Number(
        (
          db.prepare(
            `SELECT COUNT(*) AS c FROM attention_requests WHERE quota_bucket = 'nim:nvidia/nemotron-3.5-lightning-30b-a3b'`,
          ).get() as { c: number }
        ).c,
      );
      expect(lightningRows).toBe(1);
      expect(res.result.echo).toBe("ok");
      db.close();
    });
  });
});
