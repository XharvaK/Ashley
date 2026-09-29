import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../../test-support.js";
import { REDACTED_MEMORY_STATEMENT, upsertMemoryAssertion } from "../assertions.js";
import {
  buildCoreProfile,
  getMemoryStrength,
  memoryStrengthScore,
  recordMemoryFormation,
  recordMemoryRecall,
  recordMemoryUse,
  STRENGTH_HALF_LIFE_MS,
} from "../strength.js";
import type { MemoryKind } from "../../types.js";

const DAY = 86_400_000;

function remember(
  db: DatabaseSync,
  key: string,
  kind: MemoryKind,
  salience: number,
  formedAtMs = 0,
  statement = `memory ${key}`,
  audienceScope?: { kind: "room"; roomId: string },
): void {
  const self = kind === "learned_self_evidence" || kind === "ashley_interpretation" || kind === "open_question";
  upsertMemoryAssertion(db, {
    assertionKey: key,
    statement,
    memoryKind: kind,
    dimensions: self
      ? { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" }
      : { source: "owner_utterance", status: "asserted", time: "unknown_freshness", reliability: "owner_supplied" },
    dataClassification: "ordinary",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
    ...(audienceScope ? { audienceScope, sourcePrincipal: "owner-1", protectionStatus: "admitted" as const } : {}),
  });
  recordMemoryFormation(db, { assertionKey: key, salience, nowMs: formedAtMs });
}

describe("Growth V1 memory strength", () => {
  it("halves with 30 days of disuse and grows with use", () => {
    const fresh = { assertionKey: "k", salience: 0.8, recallCount: 0, lastRecalledAtMs: null, useCount: 0, lastUsedAtMs: null, formedAtMs: 0 };
    expect(memoryStrengthScore(fresh, 0)).toBeCloseTo(0.8);
    expect(memoryStrengthScore(fresh, STRENGTH_HALF_LIFE_MS)).toBeCloseTo(0.4);
    const used = { ...fresh, useCount: 3, lastUsedAtMs: STRENGTH_HALF_LIFE_MS };
    expect(memoryStrengthScore(used, STRENGTH_HALF_LIFE_MS)).toBeCloseTo(0.8 * (1 + Math.log(4)));
  });

  it("keeps first formation and counts recall and use separately", () => {
    const db = openTestSidecar();
    try {
      recordMemoryFormation(db, { assertionKey: "k", salience: 0.9, nowMs: 10 });
      recordMemoryFormation(db, { assertionKey: "k", salience: 0.1, nowMs: 20 });
      recordMemoryFormation(db, { assertionKey: "clamped", salience: 7, nowMs: 10 });
      recordMemoryRecall(db, ["k", "k"], 30);
      recordMemoryUse(db, ["k"], 40);
      expect(getMemoryStrength(db, "k")).toEqual({
        assertionKey: "k", salience: 0.9, recallCount: 1, lastRecalledAtMs: 30, useCount: 1, lastUsedAtMs: 40, formedAtMs: 10,
      });
      expect(getMemoryStrength(db, "clamped")?.salience).toBe(1);
    } finally {
      db.close();
    }
  });

  it("builds a core profile of the strongest Owner and self memories", () => {
    const db = openTestSidecar();
    try {
      remember(db, "owner-strong", "owner_preference", 0.9);
      remember(db, "owner-weak", "owner_goal", 0.2);
      remember(db, "owner-stale", "owner_preference", 0.9, -120 * DAY);
      remember(db, "self", "learned_self_evidence", 0.6);
      remember(db, "forgotten", "owner_preference", 1, 0, REDACTED_MEMORY_STATEMENT);

      const profile = buildCoreProfile(db, 0, { owner: 2 });

      expect(profile.owner.map((entry) => entry.key)).toEqual(["owner-strong", "owner-weak"]);
      expect(profile.self.map((entry) => entry.key)).toEqual(["self"]);
      expect(profile.owner[0]).toMatchObject({ statement: "memory owner-strong", memoryKind: "owner_preference", source: "owner_utterance" });
    } finally {
      db.close();
    }
  });

  it("keeps room-scoped social memories out of the Owner-private profile", () => {
    const db = openTestSidecar();
    try {
      remember(db, "room-memory", "shared_episode", 0.9, 0, "memory room-memory", { kind: "room", roomId: "room:g:c" });
      expect(buildCoreProfile(db, 0).owner).toEqual([]);
    } finally {
      db.close();
    }
  });
});
