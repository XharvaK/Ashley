import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { appendAshleyEvidence, appendExternalUtteranceInTransaction } from "../cognitive-v021/evidence/conversation-log.js";
import { grantPerson, upsertTrustedRoom } from "../relationship/social-authority.js";
import { placesForThought, placesSeenMarks, recordDiscordNames, recordPlacesSeen } from "./places.js";
import { isPlaceIntentClaims, parsePlaceSyncReports, recentPlaceActs, recordPlaceIntents, syncPlacePosts, PLACE_INTENT_TTL_MS } from "./intents.js";
import { PLACE_POST_LIMITS } from "./places.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ROOM = "room:g1:c1";

function world() {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  upsertTrustedRoom(nuclear, { ownerId: "owner", guildId: "g1", channelId: "c1", mode: "trusted_social", provenance: "explicit_config",
    addedBy: "owner", sourceSpan: { source: "places-test" }, nowMs: NOW });
  recordDiscordNames(sidecar, [{ kind: "guild", id: "g1", name: "Friends" }, { kind: "channel", id: "c1", name: "general" },
    { kind: "user", id: "p1", name: "Kim" }], NOW);
  return { sidecar, nuclear, close: () => { nuclear.close(); sidecar.close(); } };
}

function say(sidecar: DatabaseSync, id: string, atMs: number, text: string) {
  sidecar.exec("BEGIN IMMEDIATE");
  appendExternalUtteranceInTransaction(sidecar, { conversationId: ROOM, text, discordMessageIds: [id], nowMs: atMs, sourceStatus: "received",
    speakerPrincipalId: "p1", speakerKind: "external_human", location: { kind: "room", guildId: "g1", channelId: "c1" },
    audienceAtCapture: "room", sentAtMs: atMs, mentionIds: [], attachmentRefs: [], provenance: { source: "discord", receivedAtMs: atMs } });
  sidecar.exec("COMMIT");
}

describe("A1 her places", () => {
  it("names her rooms and people, shows the newest lines and what is new since she last looked", () => {
    const { sidecar, nuclear, close } = world();
    try {
      say(sidecar, "m1", NOW - 60_000, "anyone around?");
      say(sidecar, "m2", NOW - 30_000, "ashley you there?");
      const [dm, room] = placesForThought(sidecar, nuclear, { nowMs: NOW, here: "owner_dm" });
      expect(dm).toMatchObject({ ref: "owner_dm", here: true });
      expect(room).toMatchObject({ ref: ROOM, kind: "room", name: "#general in Friends", unread: 2, people: ["Kim"],
        posts: { last24h: 0, limit: PLACE_POST_LIMITS.room } });
      expect(room!.recent).toEqual([{ atMs: NOW - 60_000, who: "Kim", text: "anyone around?" }, { atMs: NOW - 30_000, who: "Kim", text: "ashley you there?" }]);
      recordPlacesSeen(sidecar, placesSeenMarks([room!]), NOW);
      say(sidecar, "m3", NOW + 1000, "hello?");
      expect(placesForThought(sidecar, nuclear, { nowMs: NOW + 2000 })[1]!.unread).toBe(1);
    } finally { close(); }
  });

  it("lists a contact with a live DM permit, and the game when it was seen", () => {
    const { sidecar, nuclear, close } = world();
    try {
      grantPerson(nuclear, { ownerId: "owner", principalId: "p1", scope: "person_wide", sourceSpan: { source: "test" }, nowMs: NOW });
      const places = placesForThought(sidecar, nuclear, { nowMs: NOW, game: { world: "slot8", live: true } });
      expect(places.map(place => place.ref)).toEqual(["owner_dm", ROOM, "contact:p1", "domus:slot8"]);
      expect(places[2]).toMatchObject({ kind: "contact", name: "Kim" });
      expect(places[3]).toMatchObject({ kind: "game", live: true });
    } finally { close(); }
  });
});

describe("B1 acting in her places", () => {
  const claim = (place: string, text: string, atMs?: number) => ({ place, interaction: "initiate" as const, say: text, ...(atMs ? { atMs } : {}) });

  it("hands a due post to the bot once, and a posted receipt lands in the place's log and her acts", () => {
    const { sidecar, nuclear, close } = world();
    try {
      const [recorded] = recordPlaceIntents(sidecar, { cycleId: "c-1", claims: [claim(ROOM, "I can see the server now")], sawSecret: false, nowMs: NOW });
      expect(recorded).toMatchObject({ state: "requested" });
      const first = syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 1000 });
      expect(first.posts).toEqual([{ intent_id: recorded!.intentId, target: { kind: "room", guildId: "g1", channelId: "c1" }, text: "I can see the server now" }]);
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 2000 }).posts).toEqual([]);
      syncPlacePosts(sidecar, nuclear, { reports: [{ intentId: recorded!.intentId, outcome: "posted", discordMessageId: "555" }], nowMs: NOW + 3000 });
      expect(recentPlaceActs(sidecar, NOW + 4000)).toEqual([expect.objectContaining({ place: ROOM, state: "posted", say: "I can see the server now" })]);
      const room = placesForThought(sidecar, nuclear, { nowMs: NOW + 4000 })[1]!;
      expect(room.recent!.at(-1)).toMatchObject({ who: "you", text: "I can see the server now" });
      expect(room.posts).toEqual({ last24h: 1, limit: PLACE_POST_LIMITS.room });
    } finally { close(); }
  });

  it("refuses a place that is not hers, a turn that saw secrets, and posts past the fuse", () => {
    const { sidecar, nuclear, close } = world();
    try {
      recordPlaceIntents(sidecar, { cycleId: "c-x", claims: [claim("room:g9:c9", "hi")], sawSecret: false, nowMs: NOW });
      expect(recordPlaceIntents(sidecar, { cycleId: "c-s", claims: [claim(ROOM, "hi")], sawSecret: true, nowMs: NOW + 1 })[0]).toMatchObject({ state: "refused", reason: "secret_in_view" });
      syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 1 });
      expect(recentPlaceActs(sidecar, NOW + 1).map(act => [act.place, act.state, act.reason])).toEqual([
        ["room:g9:c9", "refused", "not_one_of_your_places"], [ROOM, "refused", "secret_in_view"]]);
      for (let index = 0; index <= PLACE_POST_LIMITS.room; index++) {
        recordPlaceIntents(sidecar, { cycleId: `c-f${index}`, claims: [claim(ROOM, `line ${index}`)], sawSecret: false, nowMs: NOW + 2 + index });
      }
      const handed = syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 100 }).posts.length
        + syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 200 }).posts.length;
      expect(handed).toBe(PLACE_POST_LIMITS.room);
      expect(recentPlaceActs(sidecar, NOW + 300).some(act => act.reason === "place_fuse")).toBe(true);
    } finally { close(); }
  });

  it("waits for a later time, and expires a post nobody sent", () => {
    const { sidecar, nuclear, close } = world();
    try {
      recordPlaceIntents(sidecar, { cycleId: "c-later", claims: [claim(ROOM, "good morning", NOW + 3_600_000)], sawSecret: false, nowMs: NOW });
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 60_000 }).posts).toEqual([]);
      expect(recentPlaceActs(sidecar, NOW + 60_000)[0]).toMatchObject({ state: "requested", dueAtMs: NOW + 3_600_000 });
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 3_600_000 }).posts).toHaveLength(1);
      recordPlaceIntents(sidecar, { cycleId: "c-stale", claims: [claim(ROOM, "late")], sawSecret: false, nowMs: NOW });
      syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + PLACE_INTENT_TTL_MS + 3_600_000 });
      expect(recentPlaceActs(sidecar, NOW + PLACE_INTENT_TTL_MS + 3_600_000).find(act => act.say === "late"))
        .toMatchObject({ state: "expired" });
    } finally { close(); }
  });

  it("validates her claims and the bot's reports", () => {
    expect(isPlaceIntentClaims([claim(ROOM, "hi")])).toBe(true);
    expect(isPlaceIntentClaims([])).toBe(false);
    expect(isPlaceIntentClaims([{ place: ROOM, interaction: "shout", say: "hi" }])).toBe(false);
    expect(isPlaceIntentClaims([{ ...claim(ROOM, "hi"), extra: 1 }])).toBe(false);
    expect(parsePlaceSyncReports({ reports: [{ intent_id: "intent:1", outcome: "posted", discord_message_id: "123" }] }))
      .toEqual([{ intentId: "intent:1", outcome: "posted", discordMessageId: "123" }]);
    expect(() => parsePlaceSyncReports({ reports: [{ intent_id: "x", outcome: "maybe" }] })).toThrow("place_sync_invalid");
  });
});

describe("B1 aftermath", () => {
  it("records her intents and marks the places she was shown as seen", async () => {
    const { recordAftermathPending, recordSettlementAftermath } = await import("../cognitive-v021/thought/aftermath.js");
    const { admitTestCycle } = await import("../cognitive-v021/test-support.js");
    const { sidecar, close } = world();
    try {
      admitTestCycle(sidecar, { cycleId: "chat-cycle", conversationId: "owner-thread", occupantId: "owner", generation: 1, triggerKind: "owner_message", nowMs: NOW });
      sidecar.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,?)").run("s-chat", "chat-cycle",
        JSON.stringify({ sawSecret: false, intents: [{ place: ROOM, interaction: "initiate", say: "hey everyone" }] }));
      recordAftermathPending(sidecar, { settlementId: "s-chat", cycleId: "chat-cycle", nowMs: NOW,
        context: { conversationId: "owner-thread", ownerPrivate: true, passKind: null, nightPass: null, placesSeen: { [ROOM]: NOW - 5 } } });
      expect(recordSettlementAftermath(sidecar, "s-chat", { identityStore: null, timeZone: "UTC", nowMs: NOW })).toBe("recorded");
      expect(recentPlaceActs(sidecar, NOW)).toEqual([expect.objectContaining({ place: ROOM, say: "hey everyone", state: "requested" })]);
      expect(sidecar.prepare("SELECT seen_through_ms FROM place_seen WHERE place_ref = ?").get(ROOM)).toEqual({ seen_through_ms: NOW - 5 });
    } finally { close(); }
  });
});

describe("A1 names arrive with a captured message", () => {
  it("keeps the speaker, server and channel names the bot reports", async () => {
    const { admitExternalCapture } = await import("../cognitive-v021/ingress/http.js");
    const { discordName } = await import("./places.js");
    const { sidecar, nuclear, close } = world();
    try {
      admitExternalCapture(sidecar, nuclear, {
        envelope: { speakerPrincipalId: "p2", speakerKind: "external_human", location: { kind: "room", guildId: "g1", channelId: "c1" },
          audienceAtCapture: "unknown", sentAtMs: NOW, discordMessageId: "m9", mentionIds: [], attachmentRefs: [],
          provenance: { source: "discord", receivedAtMs: NOW } },
        message: "hello", discordMessageId: "m9", attachments: [], gateHint: "allow_social", conversationKey: ROOM,
        names: { speaker: "Sam", guild: "Friends 2", channel: "lounge" },
      }, { nowMs: NOW });
      expect([discordName(sidecar, "user", "p2"), discordName(sidecar, "guild", "g1"), discordName(sidecar, "channel", "c1")])
        .toEqual(["Sam", "Friends 2", "lounge"]);
    } finally { close(); }
  });
});
