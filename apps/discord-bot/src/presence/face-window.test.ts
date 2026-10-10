import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityType } from "discord.js";
import type { Client } from "discord.js";
import { applyStatusDot, discordActivities } from "../presence.js";
import {
  AVATAR_AWAKE,
  AVATAR_ASLEEP,
  AVATAR_BACKOFF_MS,
  AVATAR_CHANGES_PER_DAY,
  AVATAR_SLEEP_WAKE_PER_DAY,
  AVATAR_DAY_MS,
  emptyFaceMemory,
  loadFaceMemory,
  reconcileFaceWindow,
  saveFaceMemory,
  statusDot,
  type FaceMemory,
  type FaceReconcileInput,
} from "./face-window.js";

const NOW = 1_700_000_000_000;
const PNG = Buffer.from("png");

function harness(overrides: Partial<FaceReconcileInput> = {}): {
  input: FaceReconcileInput;
  dots: string[];
  avatars: number;
  missing: string[];
  art: Set<string>;
} {
  const dots: string[] = [];
  const missing: string[] = [];
  const art = new Set<string>([AVATAR_ASLEEP, AVATAR_AWAKE]);
  let avatars = 0;
  const input: FaceReconcileInput = {
    nowMs: NOW,
    phase: "idle",
    healthy: true,
    memory: emptyFaceMemory(),
    loggedMissing: new Set<string>(),
    readArt: (id) => (art.has(id) ? PNG : null),
    setDot: async (dot) => {
      dots.push(dot);
    },
    setAvatar: async () => {
      avatars += 1;
    },
    logMissing: (id) => missing.push(id),
    ...overrides,
  };
  return {
    input,
    dots,
    get avatars() { return avatars; },
    missing,
    art,
  };
}

async function tick(box: ReturnType<typeof harness>, patch: Partial<FaceReconcileInput> = {}): Promise<void> {
  Object.assign(box.input, patch);
  await reconcileFaceWindow(box.input);
}

test("status dot follows the phase and goes idle when she is unhealthy", () => {
  assert.equal(statusDot("conversation", true), "online");
  assert.equal(statusDot("awake", true), "online");
  assert.equal(statusDot("afterglow", true), "online");
  assert.equal(statusDot("night", true), "idle");
  assert.equal(statusDot("idle", true), "idle");
  assert.equal(statusDot("conversation", false), "idle");
  assert.equal(statusDot("awake", false), "idle");
});

test("status dot changes only when it changes and keeps the public activity", async () => {
  const box = harness();
  await tick(box, { phase: "night" });
  await tick(box, { phase: "night" });
  await tick(box, { phase: "awake" });
  await tick(box, { phase: "conversation", healthy: false });
  await tick(box, { phase: "afterglow", healthy: true });
  assert.deepEqual(box.dots, ["idle", "online", "idle", "online"]);

  const seen: string[] = [];
  let presenceCalls = 0;
  const client = {
    user: {
      setStatus: (status: string) => {
        seen.push(status);
      },
      setPresence: () => {
        presenceCalls += 1;
      },
    },
  } as unknown as Client;
  assert.equal(await applyStatusDot(client, "idle"), true);
  assert.equal(await applyStatusDot(client, "idle"), false);
  assert.deepEqual(seen, ["idle"]);
  assert.equal(presenceCalls, 0);
  assert.deepEqual(discordActivities("Exact public text."), [
    { name: "Exact public text.", type: ActivityType.Custom },
  ]);
});

test("avatar sleeps when the night pass starts and wakes on the next awake or conversation", async () => {
  const box = harness();
  await tick(box, { phase: "night" });
  await tick(box, { phase: "night" });
  assert.equal(box.avatars, 1);
  assert.equal(box.input.memory.avatarId, AVATAR_ASLEEP);
  assert.equal(box.input.memory.sleeping, true);

  await tick(box, { phase: "afterglow" });
  assert.equal(box.avatars, 1);

  await tick(box, { phase: "awake" });
  assert.equal(box.avatars, 2);
  assert.equal(box.input.memory.avatarId, AVATAR_AWAKE);
  assert.equal(box.input.memory.sleeping, false);

  await tick(box, { phase: "night" });
  await tick(box, { phase: "conversation" });
  assert.equal(box.input.memory.avatarId, AVATAR_AWAKE);
  assert.equal(box.avatars, 4);
});

test("four faces she chose do not use up the sleep and wake budget", async () => {
  const box = harness();
  box.input.memory.avatarChangeAtMs = Array.from({ length: AVATAR_CHANGES_PER_DAY }, (_, index) => NOW - index * 1_000);
  await tick(box, { phase: "night" });
  assert.equal(box.avatars, 1);
  assert.equal(box.input.memory.sleeping, true);
});

test("sleep and wake flips stop at their own daily budget and back off for an hour after 429", async () => {
  const box = harness();
  box.input.memory.sleepWakeChangeAtMs = Array.from({ length: AVATAR_SLEEP_WAKE_PER_DAY }, (_, index) => NOW - index * 1_000);
  await tick(box, { phase: "night" });
  assert.equal(box.avatars, 0);
  assert.equal(box.input.memory.sleeping, false);

  box.input.memory.sleepWakeChangeAtMs = [NOW - AVATAR_DAY_MS - 1];
  await tick(box, { phase: "night" });
  assert.equal(box.avatars, 1);

  const limited = harness();
  limited.input.setAvatar = async () => {
    throw { status: 429 };
  };
  await tick(limited, { phase: "night" });
  assert.equal(limited.input.memory.backoffUntilMs, NOW + AVATAR_BACKOFF_MS);
  assert.equal(limited.input.memory.avatarId, null);
  await tick(limited, { phase: "night", nowMs: NOW + 1_000 });
  assert.equal(limited.input.memory.avatarId, null);
  limited.input.setAvatar = async () => undefined;
  await tick(limited, { phase: "night", nowMs: NOW + AVATAR_BACKOFF_MS });
  assert.equal(limited.input.memory.avatarId, AVATAR_ASLEEP);
});

test("avatar is not uploaded again after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "face-window-"));
  try {
    const memory: FaceMemory = { ...emptyFaceMemory(), avatarId: AVATAR_ASLEEP, sleeping: true, dot: "idle" };
    saveFaceMemory(memory, dir);
    const loaded = loadFaceMemory(dir);
    const box = harness({ memory: loaded });
    await tick(box, { phase: "night" });
    assert.equal(box.avatars, 0);
    assert.equal(loadFaceMemory(dir).avatarId, AVATAR_ASLEEP);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing avatar is skipped and logged once", async () => {
  const box = harness();
  box.art.clear();
  await tick(box, { phase: "night" });
  await tick(box, { phase: "night" });
  assert.equal(box.avatars, 0);
  assert.deepEqual(box.missing, [AVATAR_ASLEEP]);
});
