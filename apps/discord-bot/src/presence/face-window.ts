import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "discord.js";
import { presencePhase, type PresencePhaseName } from "../agent-client.js";
import { ashleyDataDir } from "../data-root.js";
import { applyPlaying, applyStatusDot } from "../presence.js";
import { errorSummary } from "../soft/error-summary.js";

export const POLL_MS = 60_000;
export const AVATAR_CHANGES_PER_DAY = 4;
/** Sleep and wake flips have their own budget, so they never use up the faces she chooses. */
export const AVATAR_SLEEP_WAKE_PER_DAY = 6;
export const AVATAR_DAY_MS = 24 * 60 * 60_000;
export const AVATAR_BACKOFF_MS = 60 * 60_000;

export const AVATAR_ASLEEP = "avatar/day-asleep.png";
export const AVATAR_AWAKE = "avatar/day-awake.png";
/** UX W3: her face follows her Sim's mood no more often than this (Discord limits avatar changes). */
export const BODY_FACE_FLOOR_MS = 30 * 60_000;

/** UX_PACK v4 mood map: the game's mood → her mood face. Calm is her day face; anything unlisted is calm. */
const MOOD_FACES: Readonly<Record<string, string>> = {
  fine: AVATAR_AWAKE, dazed: AVATAR_AWAKE,
  happy: "avatar/mood-glad.png", confident: "avatar/mood-glad.png", flirty: "avatar/mood-glad.png",
  energized: "avatar/mood-spark.png", inspired: "avatar/mood-spark.png", playful: "avatar/mood-spark.png",
  focused: "avatar/mood-focused.png",
  sad: "avatar/mood-low.png", bored: "avatar/mood-low.png",
  // The game's Tense is Mood_Stressed.
  tense: "avatar/mood-frayed.png", stressed: "avatar/mood-frayed.png", angry: "avatar/mood-frayed.png",
  uncomfortable: "avatar/mood-frayed.png", embarrassed: "avatar/mood-frayed.png", scared: "avatar/mood-frayed.png",
};

export function moodFace(mood: string | null | undefined): string | null {
  if (!mood) return null;
  return MOOD_FACES[mood.replace(/^mood_/i, "").toLowerCase()] ?? AVATAR_AWAKE;
}

export type GameNow = { live: true; mood: string | null };

export type StatusDot = "online" | "idle";

export type FaceMemory = {
  avatarId: string | null;
  /** UX W2: the face she chose (avatar/<wardrobe id>.png); she wakes into it. */
  chosenId?: string | null;
  /** UX W3: the face worn now is her Sim's mood, while the game is live. */
  bodyWorn?: boolean;
  bodyChangeAtMs?: number;
  sleeping: boolean;
  /** Faces she chose (the day cap for her own choices). */
  avatarChangeAtMs: number[];
  /** Sleep and wake flips, counted apart from her choices. */
  sleepWakeChangeAtMs?: number[];
  backoffUntilMs: number;
  dot: StatusDot | null;
};

export function emptyFaceMemory(): FaceMemory {
  return {
    avatarId: null,
    sleeping: false,
    avatarChangeAtMs: [],
    backoffUntilMs: 0,
    dot: null,
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
      chosenId: typeof parsed.chosenId === "string" ? parsed.chosenId : null,
      bodyWorn: parsed.bodyWorn === true,
      bodyChangeAtMs: typeof parsed.bodyChangeAtMs === "number" ? parsed.bodyChangeAtMs : 0,
      sleeping: parsed.sleeping === true,
      avatarChangeAtMs: Array.isArray(parsed.avatarChangeAtMs)
        ? parsed.avatarChangeAtMs.filter((value) => typeof value === "number")
        : [],
      sleepWakeChangeAtMs: Array.isArray(parsed.sleepWakeChangeAtMs)
        ? parsed.sleepWakeChangeAtMs.filter((value) => typeof value === "number")
        : [],
      backoffUntilMs: typeof parsed.backoffUntilMs === "number" ? parsed.backoffUntilMs : 0,
      dot: parsed.dot === "online" || parsed.dot === "idle" ? parsed.dot : null,
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

export function avatarChoice(
  phase: PresencePhaseName,
  sleeping: boolean,
  chosenId?: string | null,
): { id: string; sleeping: boolean } | null {
  if (phase === "night" && !sleeping) return { id: AVATAR_ASLEEP, sleeping: true };
  if (sleeping && (phase === "awake" || phase === "conversation")) return { id: chosenId || AVATAR_AWAKE, sleeping: false };
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
  /** UX W3: the live game and her Sim's mood, when a session is live. */
  game?: GameNow;
  memory: FaceMemory;
  loggedMissing: Set<string>;
  readArt: (id: string) => Buffer | null;
  setDot: (dot: StatusDot) => Promise<void>;
  setAvatar: (bytes: Buffer) => Promise<void>;
  logMissing: (id: string) => void;
};

function noteMissing(input: FaceReconcileInput, id: string): void {
  if (input.loggedMissing.has(id)) return;
  input.loggedMissing.add(id);
  input.logMissing(id);
}

async function wear(input: FaceReconcileInput, id: string): Promise<boolean> {
  const bytes = input.readArt(id);
  if (!bytes) {
    noteMissing(input, id);
    return false;
  }
  try {
    await input.setAvatar(bytes);
  } catch (error) {
    if (isDiscordRateLimit(error)) {
      input.memory.backoffUntilMs = input.nowMs + AVATAR_BACKOFF_MS;
      return false;
    }
    throw error;
  }
  input.memory.avatarId = id;
  return true;
}

function lastChangeMs(memory: FaceMemory): number {
  return Math.max(memory.bodyChangeAtMs ?? 0, ...memory.avatarChangeAtMs, ...(memory.sleepWakeChangeAtMs ?? []));
}

/** UX W3: while the game is live her face is her Sim's mood, changed only when it changes, with a floor. */
async function applyBody(input: FaceReconcileInput, id: string): Promise<void> {
  const memory = input.memory;
  if (id === memory.avatarId) {
    memory.bodyWorn = true;
    memory.sleeping = false;
    return;
  }
  if (input.nowMs < memory.backoffUntilMs || input.nowMs - lastChangeMs(memory) < BODY_FACE_FLOOR_MS) return;
  if (!(await wear(input, id))) return;
  memory.bodyWorn = true;
  memory.sleeping = false;
  memory.bodyChangeAtMs = input.nowMs;
}

async function applyAvatar(input: FaceReconcileInput, phase: PresencePhaseName): Promise<void> {
  const memory = input.memory;
  if (input.game?.live) {
    const body = moodFace(input.game.mood);
    if (body) await applyBody(input, body);
    return;
  }
  // The game ended: back to the face she rests in (asleep at night, else the one she chose).
  const choice = memory.bodyWorn
    ? { id: phase === "night" ? AVATAR_ASLEEP : memory.chosenId || AVATAR_AWAKE, sleeping: phase === "night" }
    : avatarChoice(phase, memory.sleeping, memory.chosenId);
  if (!choice || choice.id === memory.avatarId) {
    if (choice) memory.sleeping = choice.sleeping;
    memory.bodyWorn = false;
    return;
  }
  if (input.nowMs < memory.backoffUntilMs) return;
  if (memory.bodyWorn && input.nowMs - lastChangeMs(memory) < BODY_FACE_FLOOR_MS) return;
  const recent = recentChanges(memory.sleepWakeChangeAtMs ?? [], input.nowMs);
  memory.sleepWakeChangeAtMs = recent;
  if (recent.length >= AVATAR_SLEEP_WAKE_PER_DAY) return;
  if (!(await wear(input, choice.id))) return;
  memory.sleeping = choice.sleeping;
  memory.bodyWorn = false;
  memory.sleepWakeChangeAtMs = [...recent, input.nowMs];
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
}

export function readArtFile(artDir: string | undefined, id: string): Buffer | null {
  const root = artDir?.trim();
  if (!root) return null;
  const full = join(root, ...id.split("/"));
  if (!existsSync(full)) return null;
  return readFileSync(full);
}

let timer: ReturnType<typeof setInterval> | null = null;
let loggedMissing = new Set<string>();

export function startFaceWindow(
  client: Client,
  options: {
    env?: NodeJS.ProcessEnv;
    dataDir?: string;
    nowMs?: () => number;
  } = {},
): void {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? ashleyDataDir();
  const nowMs = options.nowMs ?? Date.now;
  loggedMissing = new Set<string>();
  const tick = async (): Promise<void> => {
    // Read each tick: her soft acts may have changed her face since.
    const memory = loadFaceMemory(dataDir);
    const now = nowMs();
    let phase: PresencePhaseName | null = null;
    let healthy = false;
    let game: GameNow | undefined;
    try {
      const report = await presencePhase();
      phase = report.phase;
      healthy = report.healthy;
      game = report.game?.live === true ? report.game : undefined;
    } catch {
      phase = null;
      healthy = false;
    }
    applyPlaying(client, game !== undefined);
    await reconcileFaceWindow({
      nowMs: now,
      phase,
      healthy,
      ...(game ? { game } : {}),
      memory,
      loggedMissing,
      readArt: (id) => readArtFile(env.ASHLEY_ART_DIR, id),
      setDot: async (dot) => {
        await applyStatusDot(client, dot);
      },
      setAvatar: async (bytes) => {
        if (!client.user) return;
        await client.user.setAvatar(bytes);
      },
      logMissing: (id) => {
        console.warn(`[face] missing ${id}`);
      },
    });
    saveFaceMemory(memory, dataDir);
  };
  if (timer) clearInterval(timer);
  void tick().catch((error: unknown) => {
    console.warn(`[face] tick failed ${errorSummary(error)}`);
  });
  timer = setInterval(() => {
    void tick().catch((error: unknown) => {
      console.warn(`[face] tick failed ${errorSummary(error)}`);
    });
  }, POLL_MS);
}

export function stopFaceWindow(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
