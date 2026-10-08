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

  async function start(onAdmitted?: () => void) {
    const db = openTestSidecar();
    const app = createDomusIngressApp({
      db,
      token: TOKEN,
      botToken: BOT,
      now: () => NOW,
      ...(onAdmitted ? { onAdmitted } : {}),
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

  function undoBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { v: 1, world: "willow", branch: "main", session: "s1", after_source_time_ms: 10, reason: "RELOAD", ...overrides };
  }

  it("rejects undo without a token and with a wrong token", async () => {
    const { base } = await start();
    expect((await post(base, "/domus/undo", undoBody())).status).toBe(401);
    expect((await post(base, "/domus/undo", undoBody(), "x".repeat(32))).status).toBe(401);
  });

  it("rejects an unknown key, a bad reason, and a negative after time", async () => {
    const { base } = await start();
    expect((await post(base, "/domus/undo", undoBody({ extra: 1 }), TOKEN)).status).toBe(400);
    expect((await post(base, "/domus/undo", undoBody({ reason: "reload" }), TOKEN)).status).toBe(400);
    expect((await post(base, "/domus/undo", undoBody({ after_source_time_ms: -1 }), TOKEN)).status).toBe(400);
  });

  it("undoes a span and a second call is a zero count", async () => {
    const { db, base } = await start();
    db.prepare(`INSERT INTO domus_observations (
      observation_id, digest, world, branch, session, attachment, body, snapshot, seq,
      source_time_ms, expires_at_ms, receipt_time_ms, lineage_class, payload_json
    ) VALUES ('obs-u', 'd', 'willow', 'main', 's1', 'a', 'b', 's', 1, 50, 60, 55, 'WORLD_LINE', '{}')`).run();
    const response = await post(base, "/domus/undo", undoBody(), TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", observations: 1, supports: 0, assertions: 0, episodes: 0, journal: 0 });
    const again = await post(base, "/domus/undo", undoBody(), TOKEN);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "ok", observations: 0, supports: 0, assertions: 0, episodes: 0, journal: 0 });
  });

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

  it("E3: the overlay feed answers its own helper session behind the token", async () => {
    const { base } = await start();
    expect((await post(base, "/domus/feed", { v: 1, helper_session: "attachment" })).status).toBe(401);
    const response = await post(base, "/domus/feed", { v: 1, helper_session: "attachment" }, TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", items: [], marks: [] });
    expect((await post(base, "/domus/feed", { v: 1, helper_session: "attachment", extra: 1 }, TOKEN)).status).toBe(400);
  });

  it("H0.5: a newly admitted wake drops what still waits in her plan in that attachment", async () => {
    const { db, base } = await start();
    db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, label, state,
      requested_at_ms, expires_at_ms, updated_at_ms) VALUES ('p1', 'c1', 'world', 'attachment', 'o', 'a1', 'x', 'pushed', 1, 2, 1)`).run();
    db.prepare(`INSERT INTO domus_plan_steps (plan_id, step, world, attachment, option_ref, label, state, planned_at_ms, updated_at_ms)
      VALUES ('p1', 1, 'world', 'attachment', 'a2', 'y', 'planned', 1, 1)`).run();
    const state = () => (db.prepare("SELECT state, reason FROM domus_plan_steps").get() as { state: string; reason: string | null });
    await post(base, "/domus/observation", observation({ observation_id: "obs-idle",
      percepts: [{ kind: "interaction", salience: 0.5, facts: { urgency: "wake", bucket: "idle" } }] }), TOKEN);
    expect(state().state).toBe("planned");
    await post(base, "/domus/observation", observation({ observation_id: "obs-asked",
      percepts: [{ kind: "env", salience: 1, facts: { urgency: "wake", bucket: "asked", subject: "dialog" } }] }), TOKEN);
    expect(state()).toEqual({ state: "dropped", reason: "woken_by:env:asked" });
  });

  it("asks for an evaluation only when an observation is newly admitted", async () => {
    let calls = 0;
    const { base } = await start(() => { calls++; });
    expect((await post(base, "/domus/observation", observation(), TOKEN)).status).toBe(202);
    expect((await post(base, "/domus/observation", observation(), TOKEN)).status).toBe(200);
    expect((await post(base, "/domus/observation", { ...observation(), v: 2 }, TOKEN)).status).toBe(400);
    expect(calls).toBe(1);
    const { base: failing } = await start(() => { throw new Error("busy"); });
    expect((await post(failing, "/domus/observation", observation(), TOKEN)).status).toBe(202);
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

  it("admits an observation that carries a day, and refuses a day over 16384 bytes", async () => {
    const { db, base } = await start();
    const day = { slept: true, acts: [{ label: "Practice piano", startedBy: "sim" }] };
    const admitted = await post(base, "/domus/observation", observation({ observation_id: "obs-day", day }), TOKEN);
    expect(admitted.status).toBe(202);
    const stored = db.prepare("SELECT payload_json FROM domus_observations WHERE observation_id = 'obs-day'").get() as { payload_json: string };
    expect(JSON.parse(stored.payload_json).day).toEqual(day);
    const bulky = await post(base, "/domus/observation", observation({
      observation_id: "obs-big-day",
      day: { note: "x".repeat(20 * 1024) },
    }), TOKEN);
    expect(bulky.status).toBe(400);
    expect(await bulky.json()).toEqual({ error: "invalid_body" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM domus_observations WHERE observation_id = 'obs-big-day'").get()).toEqual({ n: 0 });
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

  it("weighs the lane at once when a heartbeat newly arms the game, and only then", async () => {
    let calls = 0;
    const { base } = await start(() => { calls += 1; });
    const body = { v: 1, helper_session: "helper-1", sent_at_ms: NOW, attached: false };
    expect((await post(base, "/domus/heartbeat", body, TOKEN)).status).toBe(200);
    expect(calls).toBe(0);
    expect((await post(base, "/domus/heartbeat", { ...body, attached: true }, TOKEN)).status).toBe(200);
    expect(calls).toBe(1);
    expect((await post(base, "/domus/heartbeat", { ...body, attached: true }, TOKEN)).status).toBe(200);
    expect(calls).toBe(1);
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
