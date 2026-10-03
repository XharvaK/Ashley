import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AgentManager } from "../../agent.js";
import { env } from "../../env.js";
import { createServer } from "../../server.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { triggerKindForInbox } from "../cognitive-v021/cycle/inbox.js";
import { createDomusIngressApp, decideDomusIngress } from "./ingress.js";

const TOKEN = "h".repeat(32);
const BOT = "b".repeat(32);
const NOW = 1_700_000_000_000;

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    observation_id: "obs-1",
    world: "world",
    branch: "branch",
    session: "session",
    attachment: "attachment",
    body: "body",
    snapshot: "snapshot",
    seq: 1,
    source_time_ms: NOW - 1_000,
    expires_at_ms: NOW + 60_000,
    lineage_class: "WORLD_LINE",
    percepts: [{ kind: "light", salience: 0.5, facts: { n: 1 } }],
    ...overrides,
  };
}

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address_missing");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

describe("domus ingress", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  async function start() {
    const db = openTestSidecar();
    const app = createDomusIngressApp({
      db,
      token: TOKEN,
      botToken: BOT,
      now: () => NOW,
    });
    const started = await listen(app);
    closers.push(async () => {
      await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
      db.close();
    });
    return { db, base: started.base };
  }

  async function post(base: string, path: string, body: unknown, token?: string, raw?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["X-Domus-Token"] = token;
    return fetch(`${base}${path}`, { method: "POST", headers, body: raw ?? JSON.stringify(body) });
  }

  it("rejects a missing token", async () => {
    const { base } = await start();
    expect((await post(base, "/domus/observation", observation())).status).toBe(401);
  });

  it("rejects the bot token", async () => {
    const { base } = await start();
    const response = await post(base, "/domus/observation", observation(), BOT);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a wrong token", async () => {
    const { base } = await start();
    expect((await post(base, "/domus/observation", observation(), "x".repeat(32))).status).toBe(401);
  });

  it("admits a valid observation", async () => {
    const { db, base } = await start();
    const response = await post(base, "/domus/observation", observation(), TOKEN);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "admitted", observation_id: "obs-1", receipt_time_ms: NOW });
    expect(db.prepare("SELECT COUNT(*) AS n FROM domus_observations").get()).toEqual({ n: 1 });
  });

  it("returns the original receipt for a duplicate digest", async () => {
    const { db, base } = await start();
    await post(base, "/domus/observation", observation(), TOKEN);
    const response = await post(base, "/domus/observation", observation(), TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "duplicate", observation_id: "obs-1", receipt_time_ms: NOW });
    expect(db.prepare("SELECT COUNT(*) AS n FROM domus_observations").get()).toEqual({ n: 1 });
  });

  it("conflicts when the same id has a different digest", async () => {
    const { base } = await start();
    await post(base, "/domus/observation", observation(), TOKEN);
    const response = await post(base, "/domus/observation", observation({ body: "other" }), TOKEN);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "observation_conflict" });
  });

  it("rejects an expired observation", async () => {
    const { base } = await start();
    const response = await post(base, "/domus/observation", observation({
      source_time_ms: NOW - 10_000,
      expires_at_ms: NOW - 1,
    }), TOKEN);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "expired" });
  });

  it("rejects an over-long window and future clock skew", async () => {
    const { base } = await start();
    const window = await post(base, "/domus/observation", observation({
      source_time_ms: NOW,
      expires_at_ms: NOW + 600_001,
    }), TOKEN);
    expect(window.status).toBe(400);
    const skew = await post(base, "/domus/observation", observation({
      source_time_ms: NOW + 120_001,
      expires_at_ms: NOW + 180_000,
    }), TOKEN);
    expect(skew.status).toBe(400);
    expect(await skew.json()).toEqual({ error: "clock_skew" });
  });

  it("rejects an unknown top-level key", async () => {
    const { base } = await start();
    expect((await post(base, "/domus/observation", observation({ extra: 1 }), TOKEN)).status).toBe(400);
  });

  it("rejects 33 percepts", async () => {
    const { base } = await start();
    const percepts = Array.from({ length: 33 }, (_, i) => ({ kind: `k${i}`, salience: 0, facts: {} }));
    expect((await post(base, "/domus/observation", observation({ percepts }), TOKEN)).status).toBe(400);
  });

  it("rejects facts larger than 2048 bytes", async () => {
    const { base } = await start();
    const response = await post(base, "/domus/observation", observation({
      percepts: [{ kind: "light", salience: 0, facts: { blob: "x".repeat(2100) } }],
    }), TOKEN);
    expect(response.status).toBe(400);
  });

  it("rejects a body over 64 KiB", async () => {
    const { base } = await start();
    const response = await post(base, "/domus/observation", {}, TOKEN, `{"pad":"${"x".repeat(70_000)}"}`);
    expect(response.status).toBe(413);
  });

  it("upserts a heartbeat without inbox or cycle rows", async () => {
    const { db, base } = await start();
    const beforeInbox = db.prepare("SELECT COUNT(*) AS n FROM inbox_events").get();
    const beforeCycles = db.prepare("SELECT COUNT(*) AS n FROM cycle_records").get();
    const body = { v: 1, helper_session: "helper-1", sent_at_ms: NOW, attached: true };
    expect((await post(base, "/domus/heartbeat", body, TOKEN)).status).toBe(200);
    expect((await post(base, "/domus/heartbeat", body, TOKEN)).status).toBe(200);
    expect(db.prepare("SELECT count, last_sent_at_ms FROM domus_heartbeats").get()).toEqual({ count: 2, last_sent_at_ms: NOW });
    expect(db.prepare("SELECT COUNT(*) AS n FROM inbox_events").get()).toEqual(beforeInbox);
    expect(db.prepare("SELECT COUNT(*) AS n FROM cycle_records").get()).toEqual(beforeCycles);
  });

  it("does not write an inbox row for an observation", async () => {
    const { db, base } = await start();
    const before = db.prepare("SELECT COUNT(*) AS n FROM inbox_events").get();
    expect((await post(base, "/domus/observation", observation(), TOKEN)).status).toBe(202);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inbox_events").get()).toEqual(before);
  });

  it("returns 404 for any other path", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/health`, { headers: { "X-Domus-Token": TOKEN } })).status).toBe(404);
    expect((await post(base, "/domus/other", {}, TOKEN)).status).toBe(404);
  });

  it("disables the listener for a missing, short, or bot-equal token", () => {
    expect(decideDomusIngress({ helperToken: "", botToken: BOT })).toEqual({ enabled: false, reason: "token_missing" });
    expect(decideDomusIngress({ helperToken: "short", botToken: BOT })).toEqual({ enabled: false, reason: "token_too_short" });
    const same = "s".repeat(32);
    expect(decideDomusIngress({ helperToken: same, botToken: same })).toEqual({ enabled: false, reason: "token_matches_bot" });
    expect(decideDomusIngress({ helperToken: TOKEN, botToken: BOT })).toEqual({ enabled: true });
  });

  it("maps domus_notification to its own trigger kind", () => {
    expect(triggerKindForInbox("domus_notification")).toBe("domus_notification");
  });

  it("keeps GET /domus/status owner-only", async () => {
    const previous = env.discordOwnerId;
    env.discordOwnerId = "p8a-owner";
    const manager = { core: {} } as unknown as AgentManager;
    const app = createServer(manager, { botServiceToken: "route-test-bot-token" });
    const started = await listen(app);
    closers.push(() => new Promise((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve())));
    try {
      const response = await fetch(`${started.base}/domus/status?owner_id=not-the-owner`, {
        headers: { "X-Ashley-Bot-Service": "route-test-bot-token", "X-Ashley-Actor": "p8a-owner" },
      });
      expect(response.status).toBe(403);
    } finally {
      env.discordOwnerId = previous;
    }
  });
});
