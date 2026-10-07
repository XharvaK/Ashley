import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActivityType } from "discord.js";
import type { Client } from "discord.js";
import { applyStatusDot, discordActivities } from "../presence.js";
import {
  AVATAR_AWAKE,
  AVATAR_ASLEEP,
  AVATAR_BACKOFF_MS,
  AVATAR_CHANGES_PER_DAY,
  AVATAR_DAY_MS,
  bannerFileId,
  emptyFaceMemory,
  loadFaceMemory,
  ownerLocalParts,
  reconcileFaceWindow,
  saveFaceMemory,
  skyFromWmo,
  statusDot,
  timeBucket,
  type FaceMemory,
  type FaceReconcileInput,
} from "./face-window.js";

const NOW = 1_700_000_000_000;
const PNG = Buffer.from("png");

function harness(overrides: Partial<FaceReconcileInput> = {}): {
  input: FaceReconcileInput;
  dots: string[];
  avatars: number;
  banners: string[];
  fetched: number;
  missing: string[];
  art: Set<string>;
} {
  const dots: string[] = [];
  const banners: string[] = [];
  const missing: string[] = [];
  const art = new Set<string>([AVATAR_ASLEEP, AVATAR_AWAKE, "banner/morning-sunny.png", "banner/noon-sunny.png", "banner/night-sunny.png", "banner/morning-raining.png", "banner/morning-snowing.png", "banner/noon-raining.png", "banner/noon-snowing.png", "banner/night-raining.png", "banner/night-snowing.png"]);
  let avatars = 0;
  let fetched = 0;
  const input: FaceReconcileInput = {
    nowMs: NOW,
    phase: "idle",
    healthy: true,
    memory: emptyFaceMemory(),
    local: { hour: 12, minute: 0 },
    weatherSwitch: false,
    loggedMissing: new Set<string>(),
    readArt: (id) => (art.has(id) ? PNG : null),
    fetchWeatherCode: async () => {
      fetched += 1;
      return 0;
    },
    setDot: async (dot) => {
      dots.push(dot);
    },
    setAvatar: async () => {
      avatars += 1;
    },
    setBanner: async () => {
      banners.push(input.memory.sky);
    },
    logMissing: (id) => missing.push(id),
    ...overrides,
  };
  return {
    input,
    dots,
    get avatars() { return avatars; },
    banners,
    get fetched() { return fetched; },
    missing,
    art,
  };
}

async function tick(box: ReturnType<typeof harness>, patch: Partial<FaceReconcileInput> = {}): Promise<void> {
  Object.assign(box.input, patch);
  await reconcileFaceWindow(box.input);
}

describe("status dot", () => {
  it("follows the phase and goes idle when she is unhealthy", () => {
    expect(statusDot("conversation", true)).toBe("online");
    expect(statusDot("awake", true)).toBe("online");
    expect(statusDot("afterglow", true)).toBe("online");
    expect(statusDot("night", true)).toBe("idle");
    expect(statusDot("idle", true)).toBe("idle");
    expect(statusDot("conversation", false)).toBe("idle");
    expect(statusDot("awake", false)).toBe("idle");
  });

  it("sets the dot only when it changes and keeps the public activity", async () => {
    const box = harness();
    await tick(box, { phase: "night" });
    await tick(box, { phase: "night" });
    await tick(box, { phase: "awake" });
    await tick(box, { phase: "conversation", healthy: false });
    await tick(box, { phase: "afterglow", healthy: true });
    expect(box.dots).toEqual(["idle", "online", "idle", "online"]);

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
    expect(await applyStatusDot(client, "idle")).toBe(true);
    expect(await applyStatusDot(client, "idle")).toBe(false);
    expect(seen).toEqual(["idle"]);
    expect(presenceCalls).toBe(0);
    expect(discordActivities("Exact public text.")).toEqual([
      { name: "Exact public text.", type: ActivityType.Custom },
    ]);
  });
});

describe("avatar", () => {
  it("sleeps when the night pass starts and wakes on the next awake or conversation", async () => {
    const box = harness();
    await tick(box, { phase: "night" });
    await tick(box, { phase: "night" });
    expect(box.avatars).toBe(1);
    expect(box.input.memory.avatarId).toBe(AVATAR_ASLEEP);
    expect(box.input.memory.sleeping).toBe(true);

    await tick(box, { phase: "afterglow" });
    expect(box.avatars).toBe(1);

    await tick(box, { phase: "awake" });
    expect(box.avatars).toBe(2);
    expect(box.input.memory.avatarId).toBe(AVATAR_AWAKE);
    expect(box.input.memory.sleeping).toBe(false);

    await tick(box, { phase: "night" });
    await tick(box, { phase: "conversation" });
    expect(box.input.memory.avatarId).toBe(AVATAR_AWAKE);
    expect(box.avatars).toBe(4);
  });

  it("stops at four avatar changes in 24 hours and backs off for an hour after 429", async () => {
    const box = harness();
    box.input.memory.avatarChangeAtMs = Array.from({ length: AVATAR_CHANGES_PER_DAY }, (_, index) => NOW - index * 1_000);
    await tick(box, { phase: "night" });
    expect(box.avatars).toBe(0);
    expect(box.input.memory.sleeping).toBe(false);

    box.input.memory.avatarChangeAtMs = [NOW - AVATAR_DAY_MS - 1];
    await tick(box, { phase: "night" });
    expect(box.avatars).toBe(1);

    const limited = harness();
    limited.input.setAvatar = async () => {
      throw { status: 429 };
    };
    await tick(limited, { phase: "night" });
    expect(limited.input.memory.backoffUntilMs).toBe(NOW + AVATAR_BACKOFF_MS);
    expect(limited.input.memory.avatarId).toBeNull();
    await tick(limited, { phase: "night", nowMs: NOW + 1_000 });
    expect(limited.input.memory.avatarId).toBeNull();
    limited.input.setAvatar = async () => undefined;
    await tick(limited, { phase: "night", nowMs: NOW + AVATAR_BACKOFF_MS });
    expect(limited.input.memory.avatarId).toBe(AVATAR_ASLEEP);
  });

  it("does not upload the same avatar again after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "face-window-"));
    try {
      const memory: FaceMemory = { ...emptyFaceMemory(), avatarId: AVATAR_ASLEEP, sleeping: true, dot: "idle" };
      saveFaceMemory(memory, dir);
      const loaded = loadFaceMemory(dir);
      const box = harness({ memory: loaded });
      await tick(box, { phase: "night" });
      expect(box.avatars).toBe(0);
      expect(loadFaceMemory(dir).avatarId).toBe(AVATAR_ASLEEP);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("window", () => {
  it("changes the banner on the local bucket boundaries", () => {
    expect(timeBucket(4, 59)).toBe("night");
    expect(timeBucket(5, 0)).toBe("morning");
    expect(timeBucket(10, 59)).toBe("morning");
    expect(timeBucket(11, 0)).toBe("noon");
    expect(timeBucket(17, 59)).toBe("noon");
    expect(timeBucket(18, 0)).toBe("night");
    const morning = Date.parse("2026-01-15T02:00:00.000Z");
    expect(ownerLocalParts(morning, "Etc/GMT-3")).toEqual({ hour: 5, minute: 0 });
    expect(ownerLocalParts(morning - 60_000, "Etc/GMT-3")).toEqual({ hour: 4, minute: 59 });
  });

  it("selects a banner only when the bucket changes", async () => {
    const box = harness();
    const seen: string[] = [];
    box.input.readArt = (id) => {
      seen.push(id);
      return PNG;
    };
    await tick(box, { local: { hour: 4, minute: 59 } });
    await tick(box, { local: { hour: 4, minute: 59 } });
    await tick(box, { local: { hour: 5, minute: 0 } });
    await tick(box, { local: { hour: 10, minute: 59 } });
    await tick(box, { local: { hour: 11, minute: 0 } });
    await tick(box, { local: { hour: 17, minute: 59 } });
    await tick(box, { local: { hour: 18, minute: 0 } });
    expect(box.input.memory.bannerId).toBe(bannerFileId("night", "sunny"));
    expect(seen.filter((id) => id.startsWith("banner/"))).toEqual([
      "banner/night-sunny.png",
      "banner/morning-sunny.png",
      "banner/noon-sunny.png",
      "banner/night-sunny.png",
    ]);
  });

  it("maps weather codes and stays sunny without a fetch when the switch is off", async () => {
    expect(skyFromWmo(71)).toBe("snowing");
    expect(skyFromWmo(77)).toBe("snowing");
    expect(skyFromWmo(85)).toBe("snowing");
    expect(skyFromWmo(86)).toBe("snowing");
    expect(skyFromWmo(51)).toBe("raining");
    expect(skyFromWmo(67)).toBe("raining");
    expect(skyFromWmo(80)).toBe("raining");
    expect(skyFromWmo(82)).toBe("raining");
    expect(skyFromWmo(95)).toBe("raining");
    expect(skyFromWmo(99)).toBe("raining");
    expect(skyFromWmo(0)).toBe("sunny");
    expect(skyFromWmo(45)).toBe("sunny");
    expect(skyFromWmo(70)).toBe("sunny");

    const off = harness({ weatherSwitch: false, memory: { ...emptyFaceMemory(), sky: "raining" } });
    await tick(off, { local: { hour: 12, minute: 0 } });
    expect(off.fetched).toBe(0);
    expect(off.input.memory.sky).toBe("sunny");
    expect(off.input.memory.bannerId).toBe("banner/noon-sunny.png");

    let code = 71;
    let fetches = 0;
    const on = harness({ weatherSwitch: true });
    on.input.fetchWeatherCode = async () => {
      fetches += 1;
      return code;
    };
    await tick(on, { local: { hour: 9, minute: 0 } });
    expect(fetches).toBe(1);
    expect(on.input.memory.sky).toBe("snowing");
    expect(on.input.memory.bannerId).toBe("banner/morning-snowing.png");
    await tick(on, { nowMs: NOW + 60_000 });
    expect(fetches).toBe(1);

    on.input.fetchWeatherCode = async () => {
      fetches += 1;
      throw new Error("weather_unavailable");
    };
    await tick(on, { nowMs: NOW + 31 * 60_000 });
    expect(fetches).toBe(2);
    expect(on.input.memory.sky).toBe("snowing");
  });

  it("skips a missing file and logs that id once", async () => {
    const box = harness();
    box.art.clear();
    await tick(box, { phase: "night", local: { hour: 9, minute: 0 } });
    await tick(box, { phase: "night", local: { hour: 9, minute: 0 } });
    expect(box.avatars).toBe(0);
    expect(box.input.memory.bannerId).toBeNull();
    expect(box.missing).toEqual([AVATAR_ASLEEP, "banner/morning-sunny.png"]);
  });
});
