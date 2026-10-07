import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentManager } from "./agent.js";
import { env } from "./env.js";
import {
  OWNER_CONVERSATION_WINDOW_MS,
  readPresencePhase,
} from "./core/cognitive-v021/initiative/presence-phase.js";
import { createServer } from "./server.js";

const OWNER = "owner-1";
const CONV = "conv-1";
const NOW = 1_800_000_000_000;

function openPair(): { nuclear: DatabaseSync; sidecar: DatabaseSync } {
  const nuclear = new DatabaseSync(":memory:");
  const sidecar = new DatabaseSync(":memory:");
  nuclear.exec(`CREATE TABLE mem_threads (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    status TEXT NOT NULL,
    channel TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);
  sidecar.exec(`
    CREATE TABLE conversation_evidence_log (
      row_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE cycle_records (
      cycle_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      state TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      admitted_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE night_state (conversation_id TEXT PRIMARY KEY, updated_at_ms INTEGER NOT NULL);
    CREATE TABLE inner_state (conversation_id TEXT PRIMARY KEY, updated_at_ms INTEGER NOT NULL);
    CREATE TABLE afterglow_state (conversation_id TEXT PRIMARY KEY, updated_at_ms INTEGER NOT NULL);
  `);
  nuclear.prepare(
    `INSERT INTO mem_threads (id, owner_id, status, channel, created_at, updated_at)
     VALUES (?, ?, 'active', 'discord', 't', 't')`,
  ).run(CONV, OWNER);
  return { nuclear, sidecar };
}

function phaseOf(
  pair: { nuclear: DatabaseSync; sidecar: DatabaseSync },
  healthy = true,
  nowMs = NOW,
) {
  return readPresencePhase({
    sidecar: pair.sidecar,
    nuclear: pair.nuclear,
    ownerId: OWNER,
    nowMs,
    healthy,
  });
}

function insertPass(
  sidecar: DatabaseSync,
  id: string,
  status: string,
  createdAtMs: number,
): void {
  sidecar.prepare(
    `INSERT INTO inbox_events (id, conversation_id, payload_json, created_at_ms, status)
     VALUES (?, ?, '{}', ?, ?)`,
  ).run(id, CONV, createdAtMs, status);
}

describe("presence phase derivation", () => {
  it("names each inner phase from the live pass, and idle when none is live", () => {
    const pair = openPair();
    try {
      pair.sidecar.prepare("INSERT INTO night_state (conversation_id, updated_at_ms) VALUES (?, ?)").run(CONV, 40);
      pair.sidecar.prepare("INSERT INTO inner_state (conversation_id, updated_at_ms) VALUES (?, ?)").run(CONV, 50);
      expect(phaseOf(pair)).toEqual({ phase: "idle", healthy: true, sinceMs: 50 });

      insertPass(pair.sidecar, "afterglow:conv:a:1", "pending", 100);
      expect(phaseOf(pair)).toEqual({ phase: "afterglow", healthy: true, sinceMs: 100 });

      insertPass(pair.sidecar, "night:conv:1", "claimed", 200);
      expect(phaseOf(pair)).toEqual({ phase: "night", healthy: true, sinceMs: 200 });

      insertPass(pair.sidecar, "awake:conv:1", "failed_retryable", 300);
      expect(phaseOf(pair)).toEqual({ phase: "awake", healthy: true, sinceMs: 300 });

      pair.sidecar.prepare("UPDATE inbox_events SET status = 'consumed'").run();
      expect(phaseOf(pair)).toMatchObject({ phase: "idle", healthy: true });
    } finally {
      pair.nuclear.close();
      pair.sidecar.close();
    }
  });

  it("reports conversation for an open Owner cycle or an Owner message in the last 10 minutes", () => {
    const pair = openPair();
    try {
      insertPass(pair.sidecar, "night:conv:1", "pending", 200);
      pair.sidecar.prepare(
        `INSERT INTO cycle_records
           (cycle_id, conversation_id, generation, state, trigger_kind, admitted_at_ms, updated_at_ms)
         VALUES ('c-old', ?, 1, 'silent', 'owner_message', 10, 10)`,
      ).run(CONV);
      expect(phaseOf(pair).phase).toBe("night");

      pair.sidecar.prepare(
        `INSERT INTO cycle_records
           (cycle_id, conversation_id, generation, state, trigger_kind, admitted_at_ms, updated_at_ms)
         VALUES ('c-live', ?, 2, 'thinking', 'owner_message', 80, 90)`,
      ).run(CONV);
      expect(phaseOf(pair)).toEqual({ phase: "conversation", healthy: true, sinceMs: 80 });

      pair.sidecar.prepare("UPDATE cycle_records SET state = 'silent' WHERE cycle_id = 'c-live'").run();
      const recent = NOW - OWNER_CONVERSATION_WINDOW_MS + 1_000;
      pair.sidecar.prepare(
        `INSERT INTO conversation_evidence_log (row_id, conversation_id, role, created_at_ms)
         VALUES ('m1', ?, 'owner', ?)`,
      ).run(CONV, recent);
      expect(phaseOf(pair)).toEqual({ phase: "conversation", healthy: true, sinceMs: recent });

      pair.sidecar.prepare("DELETE FROM conversation_evidence_log").run();
      const stale = NOW - OWNER_CONVERSATION_WINDOW_MS - 1;
      pair.sidecar.prepare(
        `INSERT INTO conversation_evidence_log (row_id, conversation_id, role, created_at_ms)
         VALUES ('m2', ?, 'owner', ?)`,
      ).run(CONV, stale);
      expect(phaseOf(pair).phase).toBe("night");
    } finally {
      pair.nuclear.close();
      pair.sidecar.close();
    }
  });

  it("keeps the phase and reports the same health flag /status uses", () => {
    const pair = openPair();
    try {
      insertPass(pair.sidecar, "awake:conv:2", "pending", 300);
      expect(phaseOf(pair, false)).toEqual({ phase: "awake", healthy: false, sinceMs: 300 });
    } finally {
      pair.nuclear.close();
      pair.sidecar.close();
    }
  });
});

describe("GET /presence/phase", () => {
  const previousOwner = env.discordOwnerId;
  afterEach(() => {
    env.discordOwnerId = previousOwner;
  });

  it("requires the Owner and returns the derived phase", async () => {
    env.discordOwnerId = OWNER;
    const pair = openPair();
    let healthy = true;
    const manager = {
      getState: () => "ready",
      core: {
        getDatabase: () => pair.nuclear,
        getHealth: () => ({ ok: healthy }),
      },
    } as unknown as AgentManager;
    const app = createServer(manager, {
      cognitiveSidecar: pair.sidecar,
      botServiceToken: "phase-token",
      ownerId: OWNER,
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${address.port}/presence/phase?owner_id=${OWNER}`;
      const headers = { "X-Ashley-Bot-Service": "phase-token" };

      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(`${url.replace(OWNER, "other")}`, { headers })).status).toBe(403);

      insertPass(pair.sidecar, "night:conv:9", "pending", 900);
      const body = await (await fetch(url, { headers })).json() as {
        phase: string;
        healthy: boolean;
        sinceMs: number;
      };
      expect(body).toEqual({ phase: "night", healthy: true, sinceMs: 900 });

      healthy = false;
      const unhealthy = await (await fetch(url, { headers })).json() as { healthy: boolean; phase: string };
      expect(unhealthy).toMatchObject({ phase: "night", healthy: false });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      pair.nuclear.close();
      pair.sidecar.close();
    }
  });
});
