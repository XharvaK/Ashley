import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "discord.js";
import { presencePhase, type PresencePhaseName } from "../agent-client.js";
import { ashleyDataDir } from "../data-root.js";
import { applyStatusDot } from "../presence.js";

/** Same fixed default as the agent clock when ASHLEY_OWNER_TIME_ZONE is empty. */
export const DEFAULT_OWNER_TIME_ZONE = "Etc/GMT-3";

export const POLL_MS = 60_000;
export const WEATHER_EVERY_MS = 30 * 60_000;
export const AVATAR_CHANGES_PER_DAY = 4;
export const AVATAR_DAY_MS = 24 * 60 * 60_000;
export const AVATAR_BACKOFF_MS = 60 * 60_000;

export const AVATAR_ASLEEP = "avatar/day-asleep.png";
export const AVATAR_AWAKE = "avatar/day-awake.png";

export type TimeBucket = "morning" | "noon" | "night";
export type Sky = "sunny" | "raining" | "snowing";
export type StatusDot = "online" | "idle";

export type FaceMemory = {
  avatarId: string | null;
  sleeping: boolean;
  avatarChangeAtMs: number[];
  backoffUntilMs: number;
  dot: StatusDot | null;
  sky: Sky;
  bannerId: string | null;
  weatherAtMs: number;
};

export function emptyFaceMemory(): FaceMemory {
  return {
    avatarId: null,
    sleeping: false,
    avatarChangeAtMs: [],
    backoffUntilMs: 0,
    dot: null,
    sky: "sunny",
    bannerId: null,
    weatherAtMs: 0,
  };
}

export function faceMemoryPath(dataDir = ashleyDataDir()): string {
  return join(dataDir, "face-window.json");
}

export function loadFaceMemory(dataDir = ashleyDataDir()): FaceMemory {
  const path = faceMemoryPath(dataDir);
  if (!existsSync(path)) return emptyFaceMemory();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<FaceMemory>;
    return {
      avatarId: typeof parsed.avatarId === "string" ? parsed.avatarId : null,
      sleeping: parsed.sleeping === true,
      avatarChangeAtMs: Array.isArray(parsed.avatarChangeAtMs)
        ? parsed.avatarChangeAtMs.filter((value) => typeof value === "number")
        : [],
      backoffUntilMs: typeof parsed.backoffUntilMs === "number" ? parsed.backoffUntilMs : 0,
      dot: parsed.dot === "online" || parsed.dot === "idle" ? parsed.dot : null,
      sky: parsed.sky === "raining" || parsed.sky === "snowing" ? parsed.sky : "sunny",
      bannerId: typeof parsed.bannerId === "string" ? parsed.bannerId : null,
      weatherAtMs: typeof parsed.weatherAtMs === "number" ? parsed.weatherAtMs : 0,
    };
  } catch {
    return emptyFaceMemory();
  }
}

export function saveFaceMemory(memory: FaceMemory, dataDir = ashleyDataDir()): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(faceMemoryPath(dataDir), JSON.stringify(memory), "utf8");
}

/** Online in conversation or an awake/afterglow pass. Night, quiet idle, and a health failure are idle. */
export function statusDot(phase: PresencePhaseName, healthy: boolean): StatusDot {
  if (!healthy) return "idle";
  if (phase === "conversation" || phase === "awake" || phase === "afterglow") return "online";
  return "idle";
}

export function timeBucket(hour: number, minute: number): TimeBucket {
  const mins = hour * 60 + minute;
  if (mins >= 5 * 60 && mins < 11 * 60) return "morning";
  if (mins >= 11 * 60 && mins < 18 * 60) return "noon";
  return "night";
}

export function skyFromWmo(code: number): Sky {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowing";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return "raining";
  return "sunny";
}

export function bannerFileId(bucket: TimeBucket, sky: Sky): string {
  return `banner/${bucket}-${sky}.png`;
}

export function ownerLocalParts(nowMs: number, timeZone: string): { hour: number; minute: number } {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const hour = Number(formatted.find((part) => part.type === "hour")?.value);
  const minute = Number(formatted.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("local_clock_unavailable");
  }
  return { hour, minute };
}

export function weatherSwitchOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ASHLEY_WEATHER_SWITCH?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
}

export function avatarChoice(
  phase: PresencePhaseName,
  sleeping: boolean,
): { id: string; sleeping: boolean } | null {
  if (phase === "night" && !sleeping) return { id: AVATAR_ASLEEP, sleeping: true };
  if (sleeping && (phase === "awake" || phase === "conversation")) return { id: AVATAR_AWAKE, sleeping: false };
  return null;
}

function recentChanges(atMs: number[], nowMs: number): number[] {
  return atMs.filter((at) => nowMs - at < AVATAR_DAY_MS && nowMs >= at);
}

export function isDiscordRateLimit(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 429;
}

export type FaceReconcileInput = {
  nowMs: number;
  phase: PresencePhaseName | null;
  healthy: boolean;
  memory: FaceMemory;
  local: { hour: number; minute: number };
  weatherSwitch: boolean;
  loggedMissing: Set<string>;
  readArt: (id: string) => Buffer | null;
  fetchWeatherCode: () => Promise<number>;
  setDot: (dot: StatusDot) => Promise<void>;
  setAvatar: (bytes: Buffer) => Promise<void>;
  setBanner: (bytes: Buffer) => Promise<void>;
  logMissing: (id: string) => void;
};

function noteMissing(input: FaceReconcileInput, id: string): void {
  if (input.loggedMissing.has(id)) return;
  input.loggedMissing.add(id);
  input.logMissing(id);
}

async function applyAvatar(input: FaceReconcileInput, phase: PresencePhaseName): Promise<void> {
  const choice = avatarChoice(phase, input.memory.sleeping);
  if (!choice || choice.id === input.memory.avatarId) {
    if (choice) input.memory.sleeping = choice.sleeping;
    return;
  }
  if (input.nowMs < input.memory.backoffUntilMs) return;
  const recent = recentChanges(input.memory.avatarChangeAtMs, input.nowMs);
  input.memory.avatarChangeAtMs = recent;
  if (recent.length >= AVATAR_CHANGES_PER_DAY) return;
  const bytes = input.readArt(choice.id);
  if (!bytes) {
    noteMissing(input, choice.id);
    return;
  }
  try {
    await input.setAvatar(bytes);
  } catch (error) {
    if (isDiscordRateLimit(error)) {
      input.memory.backoffUntilMs = input.nowMs + AVATAR_BACKOFF_MS;
      return;
    }
    throw error;
  }
  input.memory.avatarId = choice.id;
  input.memory.sleeping = choice.sleeping;
  input.memory.avatarChangeAtMs = [...recent, input.nowMs];
}

async function applySky(input: FaceReconcileInput): Promise<void> {
  if (!input.weatherSwitch) {
    input.memory.sky = "sunny";
    return;
  }
  if (input.memory.weatherAtMs !== 0 && input.nowMs - input.memory.weatherAtMs < WEATHER_EVERY_MS) return;
  try {
    input.memory.sky = skyFromWmo(await input.fetchWeatherCode());
    input.memory.weatherAtMs = input.nowMs;
  } catch {
    input.memory.weatherAtMs = input.nowMs;
  }
}

async function applyBanner(input: FaceReconcileInput): Promise<void> {
  const id = bannerFileId(timeBucket(input.local.hour, input.local.minute), input.memory.sky);
  if (id === input.memory.bannerId) return;
  const bytes = input.readArt(id);
  if (!bytes) {
    noteMissing(input, id);
    return;
  }
  await input.setBanner(bytes);
  input.memory.bannerId = id;
}

export async function reconcileFaceWindow(input: FaceReconcileInput): Promise<void> {
  const phase = input.phase;
  const healthy = phase !== null && input.healthy;
  const dot = phase === null ? "idle" : statusDot(phase, healthy);
  if (dot !== input.memory.dot) {
    await input.setDot(dot);
    input.memory.dot = dot;
  }
  if (phase !== null) await applyAvatar(input, phase);
  await applySky(input);
  await applyBanner(input);
}

export function readArtFile(artDir: string | undefined, id: string): Buffer | null {
  const root = artDir?.trim();
  if (!root) return null;
  const full = join(root, ...id.split("/"));
  if (!existsSync(full)) return null;
  return readFileSync(full);
}

export async function fetchWeatherCode(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const latitude = env.ASHLEY_WEATHER_LAT?.trim() ?? "";
  const longitude = env.ASHLEY_WEATHER_LON?.trim() ?? "";
  if (!latitude || !longitude || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    throw new Error("weather_unavailable");
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current", "weather_code");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("weather_unavailable");
  const body = await response.json() as { current?: { weather_code?: unknown } };
  const code = body.current?.weather_code;
  if (typeof code !== "number" || !Number.isFinite(code)) throw new Error("weather_unavailable");
  return code;
}

let timer: ReturnType<typeof setInterval> | null = null;
let loggedMissing = new Set<string>();



function ownerZone(env: NodeJS.ProcessEnv): string {
  const configured = env.ASHLEY_OWNER_TIME_ZONE?.trim();
  return configured || DEFAULT_OWNER_TIME_ZONE;
}

export function startFaceWindow(
  client: Client,
  options: {
    env?: NodeJS.ProcessEnv;
    dataDir?: string;
    fetchImpl?: typeof fetch;
    nowMs?: () => number;
  } = {},
): void {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? ashleyDataDir();
  const memory = loadFaceMemory(dataDir);
  const nowMs = options.nowMs ?? Date.now;
  loggedMissing = new Set<string>();
  const tick = async (): Promise<void> => {
    const now = nowMs();
    let phase: PresencePhaseName | null = null;
    let healthy = false;
    try {
      const report = await presencePhase();
      phase = report.phase;
      healthy = report.healthy;
    } catch {
      phase = null;
      healthy = false;
    }
    let local = { hour: 0, minute: 0 };
    try {
      local = ownerLocalParts(now, ownerZone(env));
    } catch {
      local = ownerLocalParts(now, DEFAULT_OWNER_TIME_ZONE);
    }
    await reconcileFaceWindow({
      nowMs: now,
      phase,
      healthy,
      memory,
      local,
      weatherSwitch: weatherSwitchOn(env),
      loggedMissing,
      readArt: (id) => readArtFile(env.ASHLEY_ART_DIR, id),
      fetchWeatherCode: () => fetchWeatherCode(env, options.fetchImpl),
      setDot: async (dot) => {
        await applyStatusDot(client, dot);
      },
      setAvatar: async (bytes) => {
        if (!client.user) return;
        await client.user.setAvatar(bytes);
      },
      setBanner: async (bytes) => {
        if (!client.user) return;
        await client.user.setBanner(bytes);
      },
      logMissing: (id) => {
        console.warn(`[face] missing ${id}`);
      },
    });
    saveFaceMemory(memory, dataDir);
  };
  if (timer) clearInterval(timer);
  void tick().catch((error: unknown) => {
    console.warn(`[face] tick failed ${error instanceof Error ? error.name : "error"}`);
  });
  timer = setInterval(() => {
    void tick().catch((error: unknown) => {
      console.warn(`[face] tick failed ${error instanceof Error ? error.name : "error"}`);
    });
  }, POLL_MS);
}

export function stopFaceWindow(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
