import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import { openNuclearDb } from "../../db.js";
import { listCapabilityStatuses } from "../../rollout/capabilities.js";
import { defaultWebSearchProvider } from "../../perception/search-provider.js";
import { defaultWebFetchProvider } from "../../perception/web-fetch-provider.js";
import { getCapabilityReality, type CapabilityRealityOptions } from "../thought/capability-reality.js";

function maximallyAuthorisedDb(): DatabaseSync {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  listCapabilityStatuses(db, "apply");
  db.prepare("UPDATE capability_releases SET state = 'active'").run();
  return db;
}

function registry(): V2ProjectReadRegistry {
  return new V2ProjectReadRegistry([{
    projectId: "project-ashley",
    canonicalRoot: "/srv/projects/project-ashley",
    displayName: "Project Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    engineeringAllowed: false,
    verificationAllowed: true,
    allowedRecipeIds: ["recipe-1"],
    authorshipAllowed: true,
    operationAllowed: true,
    patchExportAllowed: true,
    exportDestinationCanonicalRoot: "/srv/review/project-ashley",
  }]);
}

function reality(overrides: CapabilityRealityOptions = {}) {
  return getCapabilityReality(currentDb, {
    registry: registry(),
    masterMode: "apply",
    lifecycleEnabled: true,
    substrateAvailable: true,
    ...overrides,
  });
}

let currentDb: DatabaseSync;

describe("CAM-W6-P2 gate 1: implementation contract complete is not faculty activated", () => {
  it("keeps the default capability live set empty for web, vision, and attachments under maximum production authority", () => {
    currentDb = maximallyAuthorisedDb();
    try {
      const facts = reality();

      expect(facts.vision).toBe(false);
      expect(facts.attachmentText).toBe(false);
      expect(facts.conversationalRead).toBe(false);
      expect(facts.webSearch).toBe(false);

      expect(facts.reachability?.reasons).toMatchObject({
        vision: "capability_not_in_live_set",
        attachmentText: "capability_not_in_live_set",
        conversationalRead: "capability_not_in_live_set",
        webSearch: "capability_not_in_live_set",
      });
    } finally {
      currentDb.close();
    }
  });

  it("binds no available web search or page fetch provider in the shipping default wiring", async () => {
    expect(defaultWebSearchProvider.available).toBe(false);
    expect(defaultWebFetchProvider.available).toBe(false);
    await expect(defaultWebSearchProvider.search("ashley phase a")).rejects.toThrow(
      "web_search_unavailable",
    );
    await expect(defaultWebFetchProvider.fetch("https://example.com")).rejects.toThrow(
      "web_fetch_unavailable",
    );
  });

  it("reaches the same assertions only when a test injects a double, so an accidental activation is detectable", () => {
    currentDb = maximallyAuthorisedDb();
    try {
      expect(reality({ webSearchProvider: { available: true } })).toMatchObject({
        webSearch: true,
        reachability: { reasons: { webSearch: "capability_exists" } },
      });
      expect(reality({ webFetchProvider: { available: true } })).toMatchObject({
        conversationalRead: true,
        reachability: { reasons: { conversationalRead: "capability_exists" } },
      });
      expect(reality({ visionMode: "direct" })).toMatchObject({
        vision: true,
        reachability: { reasons: { vision: "capability_exists" } },
      });
      expect(reality({ visionMode: "mediated" })).toMatchObject({ vision: "mediated" });
      expect(reality({ webSearchProvider: { available: false } }).webSearch).toBe(false);
      expect(reality({ webFetchProvider: { available: false } }).conversationalRead).toBe(false);
    } finally {
      currentDb.close();
    }
  });

  it("does not report the default-off faculties as externally reachable to a participant audience", () => {
    currentDb = maximallyAuthorisedDb();
    try {
      const room = reality({ audience: { kind: "room", roomId: "room:guild-1:channel-1" } });

      expect(room.vision).toBe(false);
      expect(room.attachmentText).toBe(false);
      expect(room.conversationalRead).toBe(false);
      expect(room.webSearch).toBe(false);
      expect(room.reachability?.reasons).toMatchObject({
        vision: "capability_not_in_live_set",
        attachmentText: "capability_not_in_live_set",
        conversationalRead: "capability_not_in_live_set",
        webSearch: "capability_not_in_live_set",
      });
    } finally {
      currentDb.close();
    }
  });
});
