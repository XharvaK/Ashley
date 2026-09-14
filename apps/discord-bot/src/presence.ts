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

export function discordActivities(publicText: string | null): Array<{
  name: string;
  type: ActivityType;
}> {
  return publicText === null
    ? []
    : [{ name: publicText, type: ActivityType.Custom }];
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
    status: operationalDiscordStatus(healthy),
    activities: discordActivities(publicText),
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
