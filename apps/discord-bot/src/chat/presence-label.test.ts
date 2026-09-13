import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickPresenceLabel,
  shouldApplyPresence,
  snipTitle,
  type PresenceSnapshot,
} from "./presence-label.js";

function snap(presence: PresenceSnapshot["presence"]): PresenceSnapshot {
  return {
    healthy: true,
    enabled: true,
    takesToday: 1,
    presence,
  };
}

const idlePresence = {
  ownTime: false,
  proactivePaused: false,
  curiosityEnabled: true,
  owing: null,
  lastTake: null,
} as const;

describe("snipTitle", () => {
  it("strips site suffixes and truncates", () => {
    assert.equal(snipTitle("Hello World - Example.com"), "Hello World");
    const long = "a".repeat(50);
    assert.ok(snipTitle(long).endsWith("…"));
    assert.ok([...snipTitle(long)].length <= 37);
  });
});

describe("pickPresenceLabel", () => {
  it("prefers brain offline", () => {
    const pick = pickPresenceLabel({
      healthy: false,
      enabled: true,
      takesToday: 3,
      presence: null,
    });
    assert.equal(pick.label, "brain offline");
    assert.equal(pick.discordStatus, "idle");
  });

  it("may say reading only while currentActivity is an active read", () => {
    const pick = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: {
          state: "active",
          kind: "reading",
          id: "read:42",
          title: "Solid State Batteries Explained",
        },
        lastTake: null,
      }),
    );
    assert.match(pick.label, /^reading /);
    assert.doesNotMatch(pick.label, /\d+/);
    assert.equal(pick.contentKey, "p4:reading:read:42");
  });

  it("does not treat a completed take as currently reading", () => {
    const pick = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: { state: "none" },
        lastTake: {
          title: "The Left Hand of Darkness",
          depth: "full",
          createdAt: "2026-08-01T01:00:00Z",
          ageMin: 30,
        },
      }),
    );
    assert.doesNotMatch(pick.label, /^reading /);
    assert.doesNotMatch(pick.label, /last:/);
    assert.doesNotMatch(pick.label, /skimmed /);
  });

  it("does not resurrect currentness from take age inside the old 120-minute window", () => {
    const pick = pickPresenceLabel(
      snap({
        ...idlePresence,
        lastTake: {
          title: "Old article",
          depth: "full",
          createdAt: "2026-08-01T01:00:00Z",
          ageMin: 119,
        },
      }),
    );
    assert.doesNotMatch(pick.label, /^reading /);
  });

  it("does not leak last: historical syntax from a take beyond that window", () => {
    const pick = pickPresenceLabel(
      snap({
        ...idlePresence,
        lastTake: {
          title: "Older article",
          depth: "full",
          createdAt: "2026-08-01T01:00:00Z",
          ageMin: 200,
        },
      }),
    );
    assert.doesNotMatch(pick.label, /last:/);
  });

  it("ignores excerpt takes the same way: take existence is not current activity", () => {
    const pick = pickPresenceLabel(
      snap({
        ...idlePresence,
        lastTake: {
          title: "Feed blurb",
          depth: "excerpt",
          createdAt: "2026-08-01T01:00:00Z",
          ageMin: 10,
        },
      }),
    );
    assert.doesNotMatch(pick.label, /^skimmed /);
    assert.doesNotMatch(pick.label, /^reading /);
  });

  it("replaces a completed read when a newer read is genuinely active", () => {
    const pick = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: {
          state: "active",
          kind: "reading",
          id: "read:2",
          title: "New title",
        },
        lastTake: {
          title: "Old title",
          depth: "full",
          createdAt: "2026-08-01T01:00:00Z",
          ageMin: 5,
        },
      }),
    );
    assert.match(pick.label, /^reading New title$/);
    assert.doesNotMatch(pick.label, /Old title/);
  });

  it("shows feed quiet when curiosity on and no takes", () => {
    const pick = pickPresenceLabel({
      healthy: true,
      enabled: true,
      takesToday: 0,
      presence: {
        ...idlePresence,
        lastTake: null,
      },
    });
    assert.equal(pick.label, "feed quiet");
  });

  it("keeps around as the idle default when takes exist but nothing is current", () => {
    const pick = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: { state: "none" },
        lastTake: {
          title: "Yesterday",
          depth: "full",
          createdAt: "2026-08-01T01:00:00Z",
          ageMin: 800,
        },
      }),
    );
    assert.equal(pick.label, "around");
  });
});

describe("shouldApplyPresence", () => {
  it("applies stronger priority immediately", () => {
    const sticky = {
      priority: 5,
      contentKey: "p5:quiet",
      appliedAt: Date.now(),
    };
    const offline = pickPresenceLabel({
      healthy: false,
      enabled: true,
      takesToday: 0,
      presence: null,
    });
    assert.equal(shouldApplyPresence(sticky, offline), true);
  });

  it("blocks same-key refresh", () => {
    const pick = pickPresenceLabel({
      healthy: true,
      enabled: true,
      takesToday: 0,
      presence: {
        ...idlePresence,
        lastTake: null,
      },
    });
    const sticky = {
      priority: pick.priority,
      contentKey: pick.contentKey,
      appliedAt: Date.now(),
    };
    assert.equal(shouldApplyPresence(sticky, pick), false);
  });

  it("drops a live reading label as soon as current activity ends", () => {
    const reading = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: {
          state: "active",
          kind: "reading",
          id: "read:1",
          title: "Live",
        },
        lastTake: null,
      }),
    );
    const idle = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: { state: "none" },
        lastTake: {
          title: "Live",
          depth: "full",
          createdAt: new Date().toISOString(),
          ageMin: 1,
        },
      }),
    );
    assert.equal(
      shouldApplyPresence(
        {
          priority: reading.priority,
          contentKey: reading.contentKey,
          appliedAt: Date.now(),
        },
        idle,
      ),
      true,
    );
  });

  it("replaces an older live read with a newer live read immediately", () => {
    const older = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: {
          state: "active",
          kind: "reading",
          id: "read:1",
          title: "Old",
        },
        lastTake: null,
      }),
    );
    const newer = pickPresenceLabel(
      snap({
        ...idlePresence,
        currentActivity: {
          state: "active",
          kind: "reading",
          id: "read:2",
          title: "New",
        },
        lastTake: null,
      }),
    );
    assert.equal(
      shouldApplyPresence(
        {
          priority: older.priority,
          contentKey: older.contentKey,
          appliedAt: Date.now(),
        },
        newer,
      ),
      true,
    );
  });
});
