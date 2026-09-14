import assert from "node:assert/strict";
import test from "node:test";
import { ActivityType } from "discord.js";
import {
  discordActivities,
  operationalDiscordStatus,
  publicTextForRemoteState,
} from "../presence.js";

test("operational availability remains health-derived", () => {
  assert.equal(operationalDiscordStatus(true), "online");
  assert.equal(operationalDiscordStatus(false), "idle");
});

test("public activity is exact and absent when there is no admitted text", () => {
  assert.deepEqual(discordActivities("Exact public text."), [
    { name: "Exact public text.", type: ActivityType.Custom },
  ]);
  assert.deepEqual(discordActivities(null), []);
});

test("ready/resume projection keeps exact unexpired text and never revives expired or unknown state", () => {
  const remote = {
    audience: "FULLY_PUBLIC" as const,
    action: "set" as const,
    text: "Exact public text.",
    authoredAtMs: 1_000,
    expiresAtMs: 2_000,
    expired: false,
    stateRevision: 4,
    sourceEffectId: "effect-4",
    projectionState: "pending" as const,
  };
  assert.equal(publicTextForRemoteState(remote, 1_999), "Exact public text.");
  assert.equal(publicTextForRemoteState(remote, 2_000), null);
  assert.equal(publicTextForRemoteState({ ...remote, action: "clear", text: null, expiresAtMs: null, expired: false }, 1_500), null);
  assert.equal(publicTextForRemoteState({ ...remote, text: "   " }, 1_500), null);
});
