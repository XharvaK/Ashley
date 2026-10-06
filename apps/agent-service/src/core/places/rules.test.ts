import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { grantPerson, upsertTrustedRoom } from "../relationship/social-authority.js";
import { placesForThought } from "./places.js";
import { recentPlaceActs, recordPlaceIntents, syncPlacePosts } from "./intents.js";
import { thoughtPlaces } from "./thought.js";
import {
  applyContactStop, applyPlaceRules, contactRestrictions, isContactStop, isPlaceRuleClaims, setPlaceSwitch, PLACE_RULES_MAX,
} from "./rules.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const ROOM = "room:g1:c1";

function world() {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  upsertTrustedRoom(nuclear, { ownerId: "owner", guildId: "g1", channelId: "c1", mode: "trusted_social", provenance: "explicit_config",
    addedBy: "owner", sourceSpan: { source: "rules-test" }, nowMs: NOW });
  grantPerson(nuclear, { ownerId: "owner", principalId: "p1", scope: "person_wide", sourceSpan: { source: "test" }, nowMs: NOW });
  return { sidecar, nuclear, close: () => { nuclear.close(); sidecar.close(); } };
}

describe("G1 her standing rules", () => {
  it("keeps one rule per place in her words, replaces and clears it, and shows them with her places", () => {
    const { sidecar, nuclear, close } = world();
    try {
      applyPlaceRules(sidecar, { cycleId: "c1", nowMs: NOW, claims: [{ place: ROOM, rule: "only when someone talks to me" },
        { place: "everywhere", rule: "never more than two posts in a row" }] });
      applyPlaceRules(sidecar, { cycleId: "c2", nowMs: NOW + 1, claims: [{ place: ROOM, rule: "join in when the topic is music" }] });
      expect(thoughtPlaces(sidecar, nuclear, { nowMs: NOW + 2 })!.rules).toEqual([
        { place: "everywhere", rule: "never more than two posts in a row", setAtMs: NOW },
        { place: ROOM, rule: "join in when the topic is music", setAtMs: NOW + 1 },
      ]);
      applyPlaceRules(sidecar, { cycleId: "c3", nowMs: NOW + 3, claims: [{ place: "everywhere", clear: true }] });
      expect(thoughtPlaces(sidecar, nuclear, { nowMs: NOW + 4 })!.rules).toHaveLength(1);
      for (let index = 0; index < PLACE_RULES_MAX; index++) {
        applyPlaceRules(sidecar, { cycleId: `x${index}`, nowMs: NOW + 10 + index, claims: [{ place: `contact:q${index}`, rule: "r" }] });
      }
      expect(applyPlaceRules(sidecar, { cycleId: "y", nowMs: NOW + 100, claims: [{ place: "contact:new", rule: "r" }] }))
        .toEqual([{ place: "contact:new", ok: false, reason: "too_many_rules" }]);
    } finally { close(); }
  });

  it("validates her rules and a contact's stop", () => {
    expect(isPlaceRuleClaims([{ place: ROOM, rule: "quiet at night" }])).toBe(true);
    expect(isPlaceRuleClaims([{ place: "https://agents.example.org", clear: true }])).toBe(true);
    expect(isPlaceRuleClaims([{ place: "somewhere", rule: "x" }])).toBe(false);
    expect(isPlaceRuleClaims([{ place: ROOM, rule: "x", clear: true }])).toBe(false);
    expect(isContactStop("no_initiation")).toBe(true);
    expect(isContactStop("forever")).toBe(false);
  });
});

describe("G1 the Owner's switch and a contact's stop", () => {
  it("refuses a post to a place the Owner closed, until it is reopened", () => {
    const { sidecar, nuclear, close } = world();
    try {
      setPlaceSwitch(sidecar, ROOM, "closed", NOW);
      expect(placesForThought(sidecar, nuclear, { nowMs: NOW }).find(place => place.ref === ROOM)).toMatchObject({ closedByOwner: true });
      recordPlaceIntents(sidecar, { cycleId: "c1", claims: [{ place: ROOM, interaction: "initiate", say: "hi all" }], sawSecret: false, nowMs: NOW });
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 1 }).posts).toEqual([]);
      expect(recentPlaceActs(sidecar, NOW + 2).at(-1)).toMatchObject({ state: "refused", reason: "closed_by_owner" });
      setPlaceSwitch(sidecar, ROOM, "open", NOW + 3);
      recordPlaceIntents(sidecar, { cycleId: "c2", claims: [{ place: ROOM, interaction: "initiate", say: "hi again" }], sawSecret: false, nowMs: NOW + 3 });
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 4 }).posts).toHaveLength(1);
    } finally { close(); }
  });

  it("holds a contact's stop at hand-over: no_initiation still lets her answer, do_not_contact stops both, resume clears", () => {
    const { sidecar, nuclear, close } = world();
    try {
      applyContactStop(nuclear, { ownerId: "owner", principalId: "p1", stop: "no_initiation", sourceMessageRef: "row-1", nowMs: NOW });
      expect(contactRestrictions(nuclear, "p1")).toEqual(["no_initiation"]);
      expect(placesForThought(sidecar, nuclear, { nowMs: NOW }).find(place => place.ref === "contact:p1")).toMatchObject({ theyAsked: ["no_initiation"] });
      recordPlaceIntents(sidecar, { cycleId: "c1", nowMs: NOW, sawSecret: false, claims: [
        { place: "contact:p1", interaction: "initiate", say: "thinking of you" },
        { place: "contact:p1", interaction: "continue", say: "about what you said earlier" }] });
      const handed = syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 1 }).posts;
      expect(handed.map(post => post.text)).toEqual(["about what you said earlier"]);
      expect(recentPlaceActs(sidecar, NOW + 2).find(act => act.say === "thinking of you")).toMatchObject({ state: "refused", reason: "they_asked:no_initiation" });

      applyContactStop(nuclear, { ownerId: "owner", principalId: "p1", stop: "do_not_contact", sourceMessageRef: "row-2", nowMs: NOW + 3 });
      recordPlaceIntents(sidecar, { cycleId: "c2", nowMs: NOW + 3, sawSecret: false, claims: [{ place: "contact:p1", interaction: "continue", say: "ok" }] });
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 4 }).posts).toEqual([]);

      applyContactStop(nuclear, { ownerId: "owner", principalId: "p1", stop: "resume", sourceMessageRef: "row-3", nowMs: NOW + 5 });
      expect(contactRestrictions(nuclear, "p1")).toEqual([]);
      recordPlaceIntents(sidecar, { cycleId: "c3", nowMs: NOW + 5, sawSecret: false, claims: [{ place: "contact:p1", interaction: "initiate", say: "hey" }] });
      expect(syncPlacePosts(sidecar, nuclear, { reports: [], nowMs: NOW + 6 }).posts).toHaveLength(1);
    } finally { close(); }
  });
});
