import express from "express";
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { admitCognitiveIngress, createCognitiveIngressHandler } from "./http.js";
import { openTestSidecar } from "../test-support.js";
import { openNuclearDb } from "../../db.js";
import { createIsolatedDataPlane } from "../../data-plane.js";
import { getEvidenceByRowId } from "../evidence/conversation-log.js";
import { upsertTrustedRoom } from "../../relationship/social-authority.js";

const ownerRoomGuildId = "owner-room-guild";
const ownerRoomChannelId = "owner-room-channel";
const ownerRoomId = `room:${ownerRoomGuildId}:${ownerRoomChannelId}`;

function withOwnerRoomEnvironment<T>(callback: () => T): T {
  const previousSeed = process.env.RA_ROOM_SEED_ACTIVE;
  const previousPublication = process.env.RA_ROOM_PUBLICATION;
  process.env.RA_ROOM_SEED_ACTIVE = "true";
  process.env.RA_ROOM_PUBLICATION = ownerRoomChannelId;
  try {
    return callback();
  } finally {
    if (previousSeed === undefined) delete process.env.RA_ROOM_SEED_ACTIVE;
    else process.env.RA_ROOM_SEED_ACTIVE = previousSeed;
    if (previousPublication === undefined) delete process.env.RA_ROOM_PUBLICATION;
    else process.env.RA_ROOM_PUBLICATION = previousPublication;
  }
}

describe("v0.2.1 durable ingress", () => {
  it("returns 202 and persists two messages without invoking Thought", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const app = express();
    app.use(express.json());
    app.post("/chat/ingress", createCognitiveIngressHandler({
      sidecar,
      nuclearDb: nuclear,
      authorizeOwner: () => undefined,
    }));
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address_missing");
      const url = `http://127.0.0.1:${address.port}/chat/ingress`;
      const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "doc", message: "first", discordMessageIds: ["d1"] }) });
      const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "doc", message: "second", discordMessageIds: ["d2"] }) });
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get()).toMatchObject({ count: 2 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM inbox_events").get()).toMatchObject({ count: 2 });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      nuclear.close();
      sidecar.close();
    }
  });

  it("replays duplicate Discord ingress without creating a second evidence lineage or inbox event", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const first = admitDirect(sidecar, nuclear, "d-duplicate", "first");
    const replay = admitDirect(sidecar, nuclear, "d-duplicate", "changed text");
    expect(first.duplicate).toBeUndefined();
    expect(replay.duplicate).toBe(true);
    expect(replay.evidenceRowId).toBe(first.evidenceRowId);
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get()).toMatchObject({ count: 1 });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM inbox_events").get()).toMatchObject({ count: 1 });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM cycle_records").get()).toMatchObject({ count: 1 });
    nuclear.close(); sidecar.close();
  });

  it("rolls back evidence log row atomically if inbox admission fails downstream", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // Install trigger to force a failure during inbox event insertion
      sidecar.exec("CREATE TRIGGER fail_inbox BEFORE INSERT ON inbox_events BEGIN SELECT RAISE(ABORT, 'forced_inbox_failure'); END;");

      expect(() => {
        admitCognitiveIngress(sidecar, nuclear, {
          userId: "doc",
          message: "should roll back completely",
          channel: "discord",
          inboundDiscordMessageIds: ["d-atomic-fail"],
          finalFragmentReceivedAtMs: 1,
        }, { nowMs: 1 });
      }).toThrow("forced_inbox_failure");

      // Verify no evidence or cycle records leaked into the database
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get()).toMatchObject({ count: 0 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM cycle_records").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("admits authenticated Owner room context as a room conversation with room evidence", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      upsertTrustedRoom(nuclear, {
        ownerId: "doc",
        guildId: ownerRoomGuildId,
        channelId: ownerRoomChannelId,
        mode: "trusted_social",
        provenance: "explicit_config",
        addedBy: "doc",
        sourceSpan: { source: "owner-room-test" },
        nowMs: 100,
      });
      const result = withOwnerRoomEnvironment(() => admitCognitiveIngress(sidecar, nuclear, {
        userId: "doc",
        message: "hello from the room",
        channel: "discord",
        ownerRoomContext: { guildId: ownerRoomGuildId, channelId: ownerRoomChannelId },
        inboundDiscordMessageIds: ["owner-room-message"],
        finalFragmentReceivedAtMs: 100,
      }, { nowMs: 100 }));

      expect(result.conversationId).toBe(ownerRoomId);
      const evidence = getEvidenceByRowId(sidecar, result.evidenceRowId);
      expect(evidence).toMatchObject({
        conversationId: ownerRoomId,
        role: "owner",
        speakerPrincipalId: "doc",
        speakerKind: "owner",
        audienceAtCapture: "room",
        location: { kind: "room", guildId: ownerRoomGuildId, channelId: ownerRoomChannelId },
      });
      expect(sidecar.prepare("SELECT kind, payload_json FROM inbox_events").get()).toMatchObject({ kind: "owner_utterance" });
      const payload = JSON.parse(String(sidecar.prepare("SELECT payload_json FROM inbox_events").get()?.payload_json));
      expect(payload.ownerRoomContext).toEqual({ guildId: ownerRoomGuildId, channelId: ownerRoomChannelId });
      expect(sidecar.prepare("SELECT kind, audience FROM social_conversations WHERE conversation_id = ?").get(ownerRoomId)).toEqual({ kind: "room", audience: ownerRoomId });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM cycle_records WHERE trigger_kind = 'external_message'").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("rejects Owner room context outside the canonical trusted room before admission", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      upsertTrustedRoom(nuclear, {
        ownerId: "doc",
        guildId: ownerRoomGuildId,
        channelId: ownerRoomChannelId,
        mode: "trusted_social",
        provenance: "explicit_config",
        addedBy: "doc",
        nowMs: 100,
      });
      withOwnerRoomEnvironment(() => {
        expect(() => admitCognitiveIngress(sidecar, nuclear, {
          userId: "doc",
          message: "wrong room",
          channel: "discord",
          ownerRoomContext: { guildId: "wrong-guild", channelId: ownerRoomChannelId },
          inboundDiscordMessageIds: ["owner-wrong-room"],
        }, { nowMs: 100 })).toThrow("owner_room_not_authorized");
      });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get()).toMatchObject({ count: 0 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM cycle_records").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});

function admitDirect(sidecar: ReturnType<typeof openTestSidecar>, nuclear: DatabaseSync, id: string, message: string) {
  return admitCognitiveIngress(sidecar, nuclear, {
    userId: "doc",
    message,
    channel: "discord",
    inboundDiscordMessageIds: [id],
    finalFragmentReceivedAtMs: 1,
  }, { nowMs: 1 });
}
