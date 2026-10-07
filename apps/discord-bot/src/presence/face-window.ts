import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "discord.js";
import { presencePhase, type PresencePhaseName } from "../agent-client.js";
import { ashleyDataDir } from "../data-root.js";
import { applyStatusDot } from "../presence.js";

export const POLL_MS = 60_000;
export const AVATAR_CHANGES_PER_DAY = 4;
export const AVATAR_DAY_MS = 24 * 60 * 60_000;
export const AVATAR_BACKOFF_MS = 60 * 60_000;

export const AVATAR_ASLEEP = "avatar/day-asleep.png";
export const AVATAR_AWAKE = "avatar/day-awake.png";

export type StatusDot = "online" | "idle";

export type FaceMemory = {
  avatarId: string | null;
  /** UX W2: the face she chose (avatar/<wardrobe id>.png); she wakes into it. */
  chosenId?: string | null;
  sleeping: boolean;
  avatarChangeAtMs: number[];
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
      sleeping: parsed.sleeping === true,
      avatarChangeAtMs: Array.isArray(parsed.avatarChangeAtMs)
        ? parsed.avatarChangeAtMs.filter((value) => typeof value === "number")
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

async function applyAvatar(input: FaceReconcileInput, phase: PresencePhaseName): Promise<void> {
  const choice = avatarChoice(phase, input.memory.sleeping, input.memory.chosenId);
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
    try {
      const report = await presencePhase();
      phase = report.phase;
      healthy = report.healthy;
    } catch {
      phase = null;
      healthy = false;
    }
    await reconcileFaceWindow({
      nowMs: now,
      phase,
      healthy,
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
