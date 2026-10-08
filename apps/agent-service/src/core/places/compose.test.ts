import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { appendExternalUtteranceInTransaction, appendOwnerUtterance } from "../cognitive-v021/evidence/conversation-log.js";
import { upsertTrustedRoom } from "../relationship/social-authority.js";
import { findPlaceEntry, recordDiscordNames } from "./places.js";
import { placesHeld, recentPlaceActs, recordPlaceIntents, syncPlacePosts, PLACE_INTENT_TTL_MS } from "./intents.js";
import { openOwnerQuiet } from "../cognitive-v021/quiet/window.js";
import { applyPlaceRules, setPlaceSwitch } from "./rules.js";
import { composeDuePlaceWishes, placeWishThoughtInput, thoughtPlaceWish, PLACE_WISH_ATTEMPTS, type PlaceComposer, type PlaceWish } from "./compose.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ROOM = "room:g1:c1";
const PRIVATE = "the Owner told me privately that their sister is moving to Lisbon";

function world() {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  upsertTrustedRoom(nuclear, { ownerId: "owner", guildId: "g1", channelId: "c1", mode: "trusted_social", provenance: "explicit_config",
    addedBy: "owner", sourceSpan: { source: "compose-test" }, nowMs: NOW });
  recordDiscordNames(sidecar, [{ kind: "guild", id: "g1", name: "Friends" }, { kind: "channel", id: "c1", name: "general" }], NOW);
  return { sidecar, nuclear, close: () => { nuclear.close(); sidecar.close(); } };
}

const wishFromOwnTime = (sidecar: DatabaseSync, cycleId: string, say: string, nowMs = NOW) =>
  recordPlaceIntents(sidecar, { cycleId, claims: [{ place: ROOM, interaction: "initiate", say }], sawSecret: false, nowMs, ownerTurn: false })[0]!;

describe("CV05 pause and quiet hold what she starts on her own in every place", () => {
  it("holds her wishes and their written posts while paused, without expiring them, and lets the Owner's ask through", async () => {
    const { sidecar, nuclear, close } = world();
    try {
      wishFromOwnTime(sidecar, "awake-1", "own words");
      let calls = 0;
      const compose: PlaceComposer = async () => { calls++; return { post: "written here" }; };
      expect(await composeDuePlaceWishes(sidecar, nuclear, { nowMs: NOW + 10, compose, held: true })).toMatchObject({ written: 0 });
      expect(calls).toBe(0);
      await composeDuePlaceWishes(sidecar, nuclear, { nowMs: NOW + 20, compose });
      recordPlaceIntents(sidecar, { cycleId: "chat-9", nowMs: NOW + 30, sawSecret: false, ownerTurn: true,
        claims: [{ place: ROOM, interaction: "initiate", say: "the Owner asked for this", ownerAsked: true }] });
      const late = NOW + 30 + PLACE_INTENT_TTL_MS * 3;
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 40, held: true }).posts.map(post => post.text))
        .toEqual(["the Owner asked for this"]);
      for (let t = NOW + 60_000; t <= late; t += 60_000) syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: t, held: true });
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: late + 1 }).posts.map(post => post.text)).toEqual(["written here"]);
    } finally { close(); }
  });

  it("counts an open quiet window as held", () => {
    const { sidecar, close } = world();
    try {
      expect(placesHeld(sidecar, { proactivePaused: false, nowMs: NOW })).toBe(false);
      expect(placesHeld(sidecar, { proactivePaused: true, nowMs: NOW })).toBe(true);
      openOwnerQuiet(sidecar, { nowMs: NOW, durationMs: 60 * 60_000 });
      expect(placesHeld(sidecar, { proactivePaused: false, nowMs: NOW + 1 })).toBe(true);
    } finally { close(); }
  });
});

describe("B3 words are written where they go", () => {
  it("keeps an own-time intent as a wish; only a post the Owner asked for in their turn goes out as written", () => {
    const { sidecar, close } = world();
    try {
      expect(wishFromOwnTime(sidecar, "awake-1", "draft about dub techno")).toMatchObject({ state: "composing" });
      expect(recordPlaceIntents(sidecar, { cycleId: "chat-1", nowMs: NOW, sawSecret: false, ownerTurn: true,
        claims: [{ place: ROOM, interaction: "initiate", say: "not asked" }] })[0]).toMatchObject({ state: "composing" });
      expect(recordPlaceIntents(sidecar, { cycleId: "awake-2", nowMs: NOW, sawSecret: false, ownerTurn: false,
        claims: [{ place: ROOM, interaction: "initiate", say: "claims asked", ownerAsked: true }] })[0]).toMatchObject({ state: "composing" });
      expect(recordPlaceIntents(sidecar, { cycleId: "chat-2", nowMs: NOW, sawSecret: false, ownerTurn: true,
        claims: [{ place: ROOM, interaction: "initiate", say: "Alex asked me to say hi", ownerAsked: true }] })[0]).toMatchObject({ state: "requested" });
      expect(recentPlaceActs(sidecar, NOW).filter(act => act.state === "composing")).toHaveLength(3);
    } finally { close(); }
  });

  it("writes the post in the place, hands it to the bot, and records a let-go or a failure", async () => {
    const { sidecar, nuclear, close } = world();
    try {
      wishFromOwnTime(sidecar, "awake-1", "draft one");
      wishFromOwnTime(sidecar, "awake-2", "draft two", NOW + 1);
      const seen: string[] = [];
      const compose: PlaceComposer = async ({ placeWish }) => {
        seen.push(placeWish.draft);
        return placeWish.draft === "draft one" ? { post: "the words written here" } : { letGo: "it did not fit here" };
      };
      expect(await composeDuePlaceWishes(sidecar, nuclear, { nowMs: NOW + 10, compose })).toMatchObject({ written: 1, letGo: 1 });
      expect(seen).toEqual(["draft one", "draft two"]);
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 20 }).posts.map(post => post.text)).toEqual(["the words written here"]);
      expect(recentPlaceActs(sidecar, NOW + 30).find(act => act.say === "draft two")).toMatchObject({ state: "let_go", reason: "it did not fit here" });

      wishFromOwnTime(sidecar, "awake-3", "draft three", NOW + 40);
      const failing: PlaceComposer = async () => { throw new Error("thought_unavailable"); };
      for (let attempt = 0; attempt < PLACE_WISH_ATTEMPTS; attempt++) await composeDuePlaceWishes(sidecar, nuclear, { nowMs: NOW + 50 + attempt, compose: failing });
      expect(recentPlaceActs(sidecar, NOW + 60).find(act => act.say === "draft three")).toMatchObject({ state: "failed", reason: "thought_unavailable" });
    } finally { close(); }
  });

  it("spends no Thought on a place the Owner closed", async () => {
    const { sidecar, nuclear, close } = world();
    try {
      setPlaceSwitch(sidecar, ROOM, "closed", NOW);
      wishFromOwnTime(sidecar, "awake-1", "draft");
      let calls = 0;
      await composeDuePlaceWishes(sidecar, nuclear, { nowMs: NOW + 1, compose: async () => { calls++; return { post: "x" }; } });
      expect(calls).toBe(0);
      expect(recentPlaceActs(sidecar, NOW + 2)[0]).toMatchObject({ state: "refused", reason: "closed_by_owner" });
    } finally { close(); }
  });

  it("holds the Thought behind the room's walls: the room's lines, her draft and rules, never the Owner's DM", () => {
    const { sidecar, nuclear, close } = world();
    try {
      appendOwnerUtterance(sidecar, { conversationId: "owner-thread", text: PRIVATE, discordMessageIds: ["o1"], nowMs: NOW - 120_000 });
      sidecar.exec("BEGIN IMMEDIATE");
      appendExternalUtteranceInTransaction(sidecar, { conversationId: ROOM, text: "anyone into dub techno?", discordMessageIds: ["r1"], nowMs: NOW - 60_000,
        sourceStatus: "received", speakerPrincipalId: "p1", speakerKind: "external_human", location: { kind: "room", guildId: "g1", channelId: "c1" },
        audienceAtCapture: "room", sentAtMs: NOW - 60_000, mentionIds: [], attachmentRefs: [], provenance: { source: "discord", receivedAtMs: NOW - 60_000 } });
      sidecar.exec("COMMIT");
      applyPlaceRules(sidecar, { cycleId: "r", nowMs: NOW, claims: [{ place: ROOM, rule: "keep it short here" }] });
      wishFromOwnTime(sidecar, "awake-1", "share the Basic Channel find");
      const row = sidecar.prepare("SELECT * FROM place_wishes").get() as Record<string, unknown>;
      const wish: PlaceWish = { wishId: String(row.wish_id), cycleId: "awake-1", ordinal: 0, place: ROOM, interaction: "initiate",
        draft: String(row.draft), requestedAtMs: NOW, attempts: 0 };
      const entry = findPlaceEntry(nuclear, sidecar, ROOM, NOW)!;
      const { input, audience } = placeWishThoughtInput(sidecar, nuclear, {
        wish, entry, placeWish: thoughtPlaceWish(sidecar, wish, entry), nowMs: NOW, ownerId: "owner",
        constitution: { constitutional: ["truth first"], stableSelf: [] },
        capabilityReality: { vision: false, attachmentText: false, conversationalRead: false, webSearch: false } as never,
      });
      expect(audience).toEqual({ kind: "room", roomId: ROOM });
      const text = JSON.stringify(input);
      expect(text).toContain("anyone into dub techno?");
      expect(text).toContain("share the Basic Channel find");
      expect(text).toContain("keep it short here");
      expect(text).toContain("#general in Friends");
      expect(text).not.toContain("sister is moving");
    } finally { close(); }
  });
});
