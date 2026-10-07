import { ActivityType, type Client } from "discord.js";
import {
  checkHealth,
  publicPresenceState,
  recordPublicPresenceProjection,
  type PublicPresenceRemoteState,
} from "./agent-client.js";

const REFRESH_MS = 10 * 60 * 1000;
const MAX_PUBLIC_PRESENCE_CHARS = 128;

type ProjectionMetadata = {
  stateRevision: number;
  sourceEffectId: string;
};

type KnownProjection = ProjectionMetadata & {
  text: string;
  expiresAtMs: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let lastKnown: KnownProjection | null = null;
let pinnedStatus: "online" | "idle" | null = null;
let playing = false;

/** UX W3: the game Discord shows her playing while a Domus session is live. */
export const PLAYING_NAME = "The Sims 4";

/** Live game on or off; a change reconciles the presence at once. */
export function applyPlaying(client: Client, live: boolean): boolean {
  if (playing === live) return false;
  playing = live;
  // After any reconcile already in flight, which may have read the old value.
  void (inFlight ?? Promise.resolve()).then(() => reconcilePresence(client, live ? "playing" : "stopped_playing"));
  return true;
}

export async function applyStatusDot(
  client: Client,
  status: "online" | "idle",
): Promise<boolean> {
  if (pinnedStatus === status) return false;
  pinnedStatus = status;
  if (!client.user) return true;
  // setStatus sends no activity list, so a public-presence activity already
  // on the client stays. An empty list would clear it.
  client.user.setStatus(status);
  return true;
}

/** Playing comes first while the game is live (a bot shows its first activity); her public text follows. */
export function discordActivities(publicText: string | null, live = false): Array<{
  name: string;
  type: ActivityType;
}> {
  return [
    ...(live ? [{ name: PLAYING_NAME, type: ActivityType.Playing }] : []),
    ...(publicText === null ? [] : [{ name: publicText, type: ActivityType.Custom }]),
  ];
}

export function operationalDiscordStatus(healthy: boolean): "online" | "idle" {
  return healthy ? "online" : "idle";
}

function validRemoteText(text: string | null, expiresAtMs: number | null, nowMs: number): string | null {
  if (
    typeof text !== "string"
    || text.length === 0
    || text.trim().length === 0
    || [...text].length > MAX_PUBLIC_PRESENCE_CHARS
    || expiresAtMs === null
    || expiresAtMs <= nowMs
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)
  ) return null;
  return text;
}

function remoteProjection(
  remote: PublicPresenceRemoteState,
  nowMs: number,
): { text: string | null; metadata: ProjectionMetadata | null; known: KnownProjection | null } {
  const text = remote.action === "set"
    ? validRemoteText(remote.text, remote.expiresAtMs, nowMs)
    : null;
  const metadata = remote.stateRevision !== null
    && remote.sourceEffectId !== null
    ? {
        stateRevision: remote.stateRevision,
        sourceEffectId: remote.sourceEffectId,
      }
    : null;
  const known = metadata
    && text !== null
    && remote.expiresAtMs !== null
    && remote.expiresAtMs > nowMs
    ? { ...metadata, text, expiresAtMs: remote.expiresAtMs }
    : null;
  return { text, metadata, known };
}

function locallyKnownText(nowMs: number): string | null {
  if (!lastKnown || lastKnown.expiresAtMs <= nowMs) {
    lastKnown = null;
    return null;
  }
  return lastKnown.text;
}

async function reportProjection(
  metadata: ProjectionMetadata | null,
  outcome: "succeeded" | "failed",
  cause: string,
  error?: unknown,
): Promise<void> {
  if (!metadata) return;
  try {
    await recordPublicPresenceProjection({
      stateRevision: metadata.stateRevision,
      sourceEffectId: metadata.sourceEffectId,
      outcome,
      cause,
      error: error instanceof Error ? error.message : error == null ? null : String(error),
    });
  } catch {
    // The desired state remains durable in the agent. The next bounded
    // lifecycle reconciliation can retry the projection receipt.
  }
}

async function reconcile(client: Client, cause: string): Promise<void> {
  const nowMs = Date.now();
  const healthy = await checkHealth();
  let publicText: string | null = null;
  let metadata: ProjectionMetadata | null = null;
  try {
    const remote = await publicPresenceState();
    const projected = remoteProjection(remote, nowMs);
    publicText = projected.text;
    metadata = projected.metadata;
    lastKnown = projected.known;
  } catch {
    // Cold-start unknown state fails closed. A known local value may survive
    // only until its persisted expiry.
    publicText = locallyKnownText(nowMs);
    metadata = lastKnown
      ? { stateRevision: lastKnown.stateRevision, sourceEffectId: lastKnown.sourceEffectId }
      : null;
  }

  const presence = {
    status: pinnedStatus ?? operationalDiscordStatus(healthy),
    activities: discordActivities(publicText, playing),
  } as const;
  try {
    if (!client.user) return;
    await Promise.resolve(client.user.setPresence(presence));
    await reportProjection(metadata, "succeeded", cause);
  } catch (error) {
    await reportProjection(metadata, "failed", cause, error);
  }
}

export function reconcilePresence(client: Client, cause = "refresh"): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = reconcile(client, cause).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Pure lifecycle projection rule used by ready/resume qualification. */
export function publicTextForRemoteState(
  remote: PublicPresenceRemoteState,
  nowMs: number,
): string | null {
  return remoteProjection(remote, nowMs).text;
}

export function startPresence(client: Client): void {
  if (timer) clearInterval(timer);
  void reconcilePresence(client, "ready");
  timer = setInterval(() => void reconcilePresence(client, "refresh"), REFRESH_MS);
}

export function stopPresence(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
