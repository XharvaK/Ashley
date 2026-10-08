import express from "express";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { AgentManager } from "../../agent.js";
import { env } from "../../env.js";
import { createServer } from "../../server.js";
import { admitTestCycle, openTestSidecar } from "../cognitive-v021/test-support.js";
import type { OperationalEffectNamespace } from "../cognitive-v021/effect/effect-ref.js";
import { recordAftermathPending, recordSettlementAftermath } from "../cognitive-v021/thought/aftermath.js";
import { parseThoughtSemanticOutput } from "../cognitive-v021/thought/parse.js";
import {
  constrainThoughtOutputSchema, DOMUS_ACT_GUIDANCE, DOMUS_SNAPSHOT_GUIDANCE, thoughtContractProfile, thoughtOutputCompatibilityInstruction,
} from "../cognitive-v021/thought/output-contract.js";
import { createDomusIngressApp } from "./ingress.js";
import { domusNowForThought } from "./notification.js";
import { admitObservation, observationDigest } from "./store.js";
import {
  claimDomusSnapshots, domusSnapshotDirFor, domusSnapshotFacts, isDomusSnapshotClaim, receiveDomusSnapshot, recordDomusSnapshot,
  reportDomusSnapshot, requestedDomusSnapshots, DOMUS_SNAPSHOT_TTL_MS,
} from "./snapshots.js";

const NOW = 60_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const TOKEN = "s".repeat(32);
const BOT = "b".repeat(32);
const BOT_SERVICE = "snapshot-test-bot-service";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("invented picture bytes")]);
const PNG64 = PNG.toString("base64");
const OPTIONS = [{ object: "Bookshelf", object_id: "1001", acts: [{ ref: "a1", guid64: "13001", text: "Read a Book" }] }];
const CALLBACK_ACTING = { trigger: { kind: "owner_utterance" }, audience: { kind: "owner_private" }, domusNow: { options: OPTIONS } };

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ashley-snapshot-"));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function row(db: DatabaseSync, snapshotId: string) {
  return db.prepare("SELECT * FROM domus_snapshots WHERE snapshot_id = ?").get(snapshotId) as Record<string, unknown>;
}

function request(db: DatabaseSync, caption: string, cycleId: string, nowMs: number, attachment = "helper-a"): string {
  const id = recordDomusSnapshot(db, { attachment, claim: { caption }, cycleId, nowMs });
  if (!id) throw new Error("request_not_recorded");
  return id;
}

describe("SNAPSHOT her contract", () => {
  it("offers domusSnapshot exactly where domusAct is offered, with its one guidance sentence", () => {
    const namespace = { allowedOperationalEffectRefs: [], fingerprint: "sha256:test" } as unknown as OperationalEffectNamespace;
    const fieldsOf = (profile: ReturnType<typeof thoughtContractProfile>) => Object.keys(
      (constrainThoughtOutputSchema(namespace, profile).schema as { oneOf: Array<{ properties: Record<string, unknown> }> }).oneOf[0]!.properties,
    );
    const acting = thoughtContractProfile({ trigger: { kind: "domus_notification" }, audience: { kind: "owner_private" }, domus: { options: OPTIONS } });
    const chat = thoughtContractProfile(CALLBACK_ACTING);
    const watching = thoughtContractProfile({ trigger: { kind: "domus_notification" }, audience: { kind: "owner_private" }, domus: {} });
    expect(acting.domusAct).toBe(true);
    expect(chat.domusAct).toBe(true);
    expect(watching.domusAct).toBe(false);
    expect(fieldsOf(acting)).toContain("domusSnapshot");
    expect(fieldsOf(chat)).toContain("domusSnapshot");
    expect(fieldsOf(watching)).not.toContain("domusSnapshot");
    expect(fieldsOf(watching)).not.toContain("domusAct");
    expect(thoughtOutputCompatibilityInstruction(acting)).toContain(DOMUS_SNAPSHOT_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(acting)).toContain(DOMUS_ACT_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(watching)).not.toContain(DOMUS_SNAPSHOT_GUIDANCE);
  });

  it("parses a settlement domusSnapshot as one caption of 1 to 200 characters once trimmed, and refuses anything else", () => {
    const settle = (domusSnapshot: unknown) => parseThoughtSemanticOutput(JSON.stringify({
      kind: "settlement", speech: { mode: "none" }, journal: { activity: "think", entry: "I looked at the room." }, domusSnapshot,
    }), new Set<string>());
    expect(settle({ caption: "Look at my shelf." })).toMatchObject({ ok: true });
    expect(settle({ caption: "x".repeat(200) })).toMatchObject({ ok: true });
    expect(isDomusSnapshotClaim({ caption: "  Here.  " })).toBe(true);
    for (const bad of [{ caption: "   " }, { caption: "x".repeat(201) }, {}, { caption: "a", why: "x" }, { caption: 5 }, "a picture", ["a"]]) {
      expect(settle(bad)).toMatchObject({ ok: false });
    }
  });
});

describe("SNAPSHOT her settled request", () => {
  it("is kept once per pass, against the armed attachment that pass saw, and not at all for a pass that saw none", async () => {
    const db = openTestSidecar();
    try {
      for (const [cycleId, bound] of [["snap-cycle", true], ["unbound-cycle", false]] as const) {
        admitTestCycle(db, { cycleId, conversationId: "c", occupantId: "owner", generation: 1,
          triggerKind: "domus_notification", triggerRef: `domus-notification:${cycleId}`, nowMs: NOW });
        db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,?)")
          .run(`${cycleId}-settlement`, cycleId, JSON.stringify({ sawSecret: false, journal: { activity: "think", entry: "The room." },
            domusSnapshot: { caption: "  Look at the shelf.  " } }));
        recordAftermathPending(db, { settlementId: `${cycleId}-settlement`, cycleId, nowMs: NOW,
          context: { conversationId: "c", ownerPrivate: true, passKind: "private", channel: "domus:slot8", nightPass: null,
            ...(bound ? { domusAct: { world: "slot8", attachment: "helper-a", observationId: "helper-a.1" } } : {}) } });
        expect(recordSettlementAftermath(db, `${cycleId}-settlement`, { identityStore: null, timeZone: "UTC", nowMs: NOW })).toBe("recorded");
      }
      expect(db.prepare("SELECT cycle_id, attachment, caption, status, requested_at_ms FROM domus_snapshots").all()).toEqual([
        { cycle_id: "snap-cycle", attachment: "helper-a", caption: "Look at the shelf.", status: "requested", requested_at_ms: NOW },
      ]);
      expect(recordDomusSnapshot(db, { attachment: "helper-a", claim: { caption: "Again." }, cycleId: "snap-cycle", nowMs: NOW })).toBeNull();
      expect(db.prepare("SELECT COUNT(*) AS n FROM domus_snapshots").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });
});

describe("SNAPSHOT the helper's sync", () => {
  it("returns the open requests of its own attachment, and expires one older than ten minutes", () => {
    const db = openTestSidecar();
    try {
      const mine = request(db, "Mine.", "c1", NOW);
      const theirs = request(db, "Theirs.", "c2", NOW, "helper-b");
      expect(requestedDomusSnapshots(db, { helperSession: "helper-a", nowMs: NOW + MIN })).toEqual([{ snapshot_id: mine }]);
      expect(requestedDomusSnapshots(db, { helperSession: "helper-b", nowMs: NOW + MIN })).toEqual([{ snapshot_id: theirs }]);
      expect(requestedDomusSnapshots(db, { helperSession: "helper-a", nowMs: NOW + DOMUS_SNAPSHOT_TTL_MS + 1 })).toEqual([]);
      for (const id of [mine, theirs]) {
        expect(row(db, id)).toMatchObject({ status: "expired", reason: "no_picture_in_time", settled_at_ms: NOW + DOMUS_SNAPSHOT_TTL_MS + 1 });
      }
    } finally {
      db.close();
    }
  });
});

describe("SNAPSHOT POST /domus/snapshot and the sync answer", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

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

  async function start(snapshotDir?: string) {
    const db = openTestSidecar();
    const app = createDomusIngressApp({ db, token: TOKEN, botToken: BOT, now: () => NOW, ...(snapshotDir ? { snapshotDir } : {}) });
    const started = await listen(app);
    closers.push(async () => {
      await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
      db.close();
    });
    return { db, base: started.base };
  }

  async function post(base: string, path: string, body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["X-Domus-Token"] = token;
    return fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  }

  it("writes the picture under the data root, marks the request taken, and answers ok", async () => {
    const dir = tempDir();
    const { db, base } = await start(domusSnapshotDirFor(dir));
    const id = request(db, "Look.", "c1", NOW);
    const res = await post(base, "/domus/snapshot", { v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64 }, TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(readFileSync(join(domusSnapshotDirFor(dir), `${id}.png`))).toEqual(PNG);
    expect(row(db, id)).toMatchObject({ status: "taken", taken_at_ms: NOW });
  });

  it("keeps a failure as failed with the helper's reason", async () => {
    const { db, base } = await start(domusSnapshotDirFor(tempDir()));
    const id = request(db, "Look.", "c1", NOW);
    const res = await post(base, "/domus/snapshot", { v: 1, helper_session: "helper-a", snapshot_id: id, failed: "game_minimized" }, TOKEN);
    expect(res.status).toBe(200);
    expect(row(db, id)).toMatchObject({ status: "failed", reason: "game_minimized", settled_at_ms: NOW });
  });

  it("answers each refusal with its own code and leaves the request as it was", async () => {
    const { db, base } = await start(domusSnapshotDirFor(tempDir()));
    const id = request(db, "Look.", "c1", NOW);
    const body = (overrides: Record<string, unknown> = {}) => ({ v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64, ...overrides });
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [body({ snapshot_id: "no-such-request" }), 404, "unknown_snapshot"],
      [body({ helper_session: "helper-b" }), 409, "wrong_attachment"],
      [body({ png_base64: Buffer.from("not a picture at all").toString("base64") }), 400, "not_png"],
      [body({ png_base64: "A".repeat(8_388_612) }), 413, "too_large"],
    ];
    for (const [payload, status, code] of cases) {
      const res = await post(base, "/domus/snapshot", payload, TOKEN);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
    }
    expect(row(db, id)).toMatchObject({ status: "requested" });
  });

  it("refuses a request that is no longer open, once it has been answered", async () => {
    const { db, base } = await start(domusSnapshotDirFor(tempDir()));
    const id = request(db, "Look.", "c1", NOW);
    expect((await post(base, "/domus/snapshot", { v: 1, helper_session: "helper-a", snapshot_id: id, failed: "no_game_window" }, TOKEN)).status).toBe(200);
    const again = await post(base, "/domus/snapshot", { v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64 }, TOKEN);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "not_requested" });
  });

  it("refuses a malformed body or a missing token, and admits a picture far over 64 KiB only on this route", async () => {
    const dir = tempDir();
    const { db, base } = await start(domusSnapshotDirFor(dir));
    const id = request(db, "Look.", "c1", NOW);
    const bad: unknown[] = [
      { v: 1, helper_session: "helper-a", snapshot_id: id },
      { v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64, failed: "capture_failed" },
      { v: 1, helper_session: "helper-a", snapshot_id: id, failed: "bogus" },
      { v: 1, helper_session: "helper-a", snapshot_id: "x/../y", png_base64: PNG64 },
      { v: 2, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64 },
      { v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64, extra: 1 },
      { v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64.slice(0, -1) },
    ];
    for (const payload of bad) {
      const res = await post(base, "/domus/snapshot", payload, TOKEN);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
    }
    expect((await post(base, "/domus/snapshot", { v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: PNG64 })).status).toBe(401);
    const large = Buffer.concat([PNG, Buffer.alloc(300_000, 1)]).toString("base64");
    expect((await post(base, "/domus/snapshot", { v: 1, helper_session: "helper-a", snapshot_id: id, png_base64: large }, TOKEN)).status).toBe(200);
    const feed = await post(base, "/domus/feed", { v: 1, helper_session: "helper-a", pad: "x".repeat(70_000) }, TOKEN);
    expect(feed.status).toBe(413);
  });

  it("answers every sync with its open requests, and always with the key", async () => {
    const { db, base } = await start(domusSnapshotDirFor(tempDir()));
    const id = recordDomusSnapshot(db, { attachment: "helper-a", claim: { caption: "Look." }, cycleId: "c1", nowMs: NOW - 1000 })!;
    const mine = await (await post(base, "/domus/acts/sync", { v: 1, helper_session: "helper-a", events: [] }, TOKEN)).json() as Record<string, unknown>;
    expect(mine.snapshots).toEqual([{ snapshot_id: id }]);
    const theirs = await (await post(base, "/domus/acts/sync", { v: 1, helper_session: "helper-b", events: [] }, TOKEN)).json() as Record<string, unknown>;
    expect(theirs.snapshots).toEqual([]);
  });
});

describe("SNAPSHOT the bot's claim and result", () => {
  it("claims a taken picture once, claims it again only after ten minutes unreported, and takes one result", () => {
    const dir = tempDir();
    const snapshotDir = domusSnapshotDirFor(dir);
    const db = openTestSidecar();
    try {
      const id = request(db, "Here.", "c1", NOW);
      expect(receiveDomusSnapshot(db, { helperSession: "helper-a", snapshotId: id, pngBase64: PNG64, nowMs: NOW, snapshotDir })).toEqual({ ok: true, status: "taken" });
      expect(claimDomusSnapshots(db, { nowMs: NOW, snapshotDir })).toEqual([{ snapshotId: id, caption: "Here.", pngBase64: PNG64 }]);
      expect(claimDomusSnapshots(db, { nowMs: NOW + 5 * MIN, snapshotDir })).toEqual([]);
      expect(claimDomusSnapshots(db, { nowMs: NOW + 10 * MIN, snapshotDir })).toEqual([{ snapshotId: id, caption: "Here.", pngBase64: PNG64 }]);
      expect(reportDomusSnapshot(db, { snapshotId: id, status: "sent", discordMessageId: "message-1", nowMs: NOW + 10 * MIN })).toBe("recorded");
      expect(row(db, id)).toMatchObject({ status: "sent", settled_at_ms: NOW + 10 * MIN, discord_message_id: "message-1", reason: null });
      expect(reportDomusSnapshot(db, { snapshotId: id, status: "sent", nowMs: NOW + 10 * MIN })).toBe("not_claimed");
      expect(reportDomusSnapshot(db, { snapshotId: "no-such-request", status: "sent", nowMs: NOW })).toBe("unknown");
      expect(claimDomusSnapshots(db, { nowMs: NOW + 60 * MIN, snapshotDir })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("fails a taken picture whose file is gone, rather than sending it", () => {
    const db = openTestSidecar();
    try {
      const id = request(db, "Gone.", "c1", NOW);
      receiveDomusSnapshot(db, { helperSession: "helper-a", snapshotId: id, pngBase64: PNG64, nowMs: NOW, snapshotDir: domusSnapshotDirFor(tempDir()) });
      expect(claimDomusSnapshots(db, { nowMs: NOW, snapshotDir: domusSnapshotDirFor(tempDir()) })).toEqual([]);
      expect(row(db, id)).toMatchObject({ status: "failed", reason: "picture_missing" });
    } finally {
      db.close();
    }
  });

  it("reports a Discord failure with its reason, and the reason is kept", () => {
    const dir = tempDir();
    const snapshotDir = domusSnapshotDirFor(dir);
    const db = openTestSidecar();
    try {
      const id = request(db, "Here.", "c1", NOW);
      receiveDomusSnapshot(db, { helperSession: "helper-a", snapshotId: id, pngBase64: PNG64, nowMs: NOW, snapshotDir });
      claimDomusSnapshots(db, { nowMs: NOW, snapshotDir });
      expect(reportDomusSnapshot(db, { snapshotId: id, status: "failed", reason: "discord_error", nowMs: NOW + MIN })).toBe("recorded");
      expect(row(db, id)).toMatchObject({ status: "failed", reason: "discord_error", settled_at_ms: NOW + MIN });
    } finally {
      db.close();
    }
  });

  it("serves the claim and the result to the Owner only, and answers their codes", async () => {
    const dir = tempDir();
    const snapshotDir = domusSnapshotDirFor(dir);
    const db = openTestSidecar();
    const originalOwner = env.discordOwnerId;
    const owner = "snapshot-route-owner";
    env.discordOwnerId = owner;
    const id = request(db, "Here.", "c1", NOW);
    receiveDomusSnapshot(db, { helperSession: "helper-a", snapshotId: id, pngBase64: PNG64, nowMs: NOW, snapshotDir });
    const manager = { getState: () => "ready", dataPlane: { dataDir: dir }, core: {} } as unknown as AgentManager;
    const server = createServer(manager, { botServiceToken: BOT_SERVICE, cognitiveSidecar: db });
    const started = server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => started.once("listening", () => resolve()));
    const address = started.address();
    if (!address || typeof address === "string") throw new Error("address_missing");
    const url = `http://127.0.0.1:${address.port}`;
    const send = (path: string, body: unknown) => fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Ashley-Bot-Service": BOT_SERVICE, "X-Ashley-Actor": owner },
      body: JSON.stringify(body),
    });
    try {
      expect((await send("/domus/snapshots/claim", { userId: "someone-else" })).status).toBe(403);
      const claimed = await send("/domus/snapshots/claim", { userId: owner });
      expect(claimed.status).toBe(200);
      expect(await claimed.json()).toEqual({ snapshots: [{ snapshotId: id, caption: "Here.", pngBase64: PNG64 }] });
      const sent = await send(`/domus/snapshots/${id}/result`, { userId: owner, status: "sent", discordMessageId: "message-2" });
      expect(sent.status).toBe(200);
      expect(await sent.json()).toEqual({ recorded: true });
      expect((await send(`/domus/snapshots/${id}/result`, { userId: owner, status: "sent" })).status).toBe(409);
      expect((await send("/domus/snapshots/no-such-request/result", { userId: owner, status: "sent" })).status).toBe(404);
      expect((await send(`/domus/snapshots/${id}/result`, { userId: owner, status: "done" })).status).toBe(400);
    } finally {
      env.discordOwnerId = originalOwner;
      await new Promise<void>((resolve, reject) => started.close((error) => error ? reject(error) : resolve()));
      db.close();
    }
  });
});

describe("SNAPSHOT in her view of her Sim", () => {
  function observePortrait(db: DatabaseSync) {
    const payload = {
      v: 1, observation_id: "helper-a.1", world: "slot8", branch: "g", session: "s", attachment: "helper-a", body: "b", snapshot: "1",
      seq: 1, source_time_ms: NOW - 2000, expires_at_ms: NOW + 600_000, lineage_class: "CURRENT",
      percepts: [{ kind: "need", salience: 0.4, facts: { subject: "fun" } }], portrait: { mood: "Happy" },
    };
    admitObservation(db, { observationId: "helper-a.1", digest: observationDigest(payload), world: "slot8", branch: "g", session: "s",
      attachment: "helper-a", body: "b", snapshot: "1", seq: 1, sourceTimeMs: payload.source_time_ms, expiresAtMs: payload.expires_at_ms,
      receiptTimeMs: NOW - 1000, lineageClass: "CURRENT", payloadJson: JSON.stringify(payload) });
    db.prepare("UPDATE domus_observations SET admission_state='admitted' WHERE observation_id='helper-a.1'").run();
  }

  it("carries the newest three of the last day, with the status each reached, only when there are some", () => {
    const dir = tempDir();
    const snapshotDir = domusSnapshotDirFor(dir);
    const db = openTestSidecar();
    try {
      observePortrait(db);
      expect(domusNowForThought(db, NOW)).not.toHaveProperty("snapshots");
      request(db, "Long ago.", "old", NOW - 25 * HOUR);
      request(db, "Six hours.", "c0", NOW - 6 * HOUR);
      const taken = request(db, "Taken one.", "c1", NOW - 5 * HOUR);
      receiveDomusSnapshot(db, { helperSession: "helper-a", snapshotId: taken, pngBase64: PNG64, nowMs: NOW - 4 * HOUR, snapshotDir });
      const failed = request(db, "Failed one.", "c2", NOW - 3 * HOUR);
      receiveDomusSnapshot(db, { helperSession: "helper-a", snapshotId: failed, failed: "game_minimized", nowMs: NOW - 2 * HOUR, snapshotDir });
      request(db, "Just asked.", "c3", NOW - MIN);
      const now = domusNowForThought(db, NOW);
      expect(now?.snapshots).toEqual([
        { caption: "Taken one.", status: "taken", at: new Date(NOW - 4 * HOUR).toISOString() },
        { caption: "Failed one.", status: "failed", reason: "game_minimized", at: new Date(NOW - 2 * HOUR).toISOString() },
        { caption: "Just asked.", status: "requested", at: new Date(NOW - MIN).toISOString() },
      ]);
      expect(domusSnapshotFacts(db, NOW)).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it("shows a caption as its first sixty characters", () => {
    const db = openTestSidecar();
    try {
      request(db, "A".repeat(150), "c1", NOW - MIN);
      expect(domusSnapshotFacts(db, NOW)).toEqual([{ caption: "A".repeat(60), status: "requested", at: new Date(NOW - MIN).toISOString() }]);
    } finally {
      db.close();
    }
  });
});
