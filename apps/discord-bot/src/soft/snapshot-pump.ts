import type { Client, DMChannel } from "discord.js";
import {
  claimDomusSnapshots,
  reportDomusSnapshotResult,
  type DomusSnapshot,
  type DomusSnapshotResult,
} from "../agent-client.js";
import { config } from "../config.js";

/**
 * Snapshot: a real picture of her game, sent only to the Owner's DM with her own caption.
 * The agent has already taken the picture and chosen the words; this sends it once and
 * reports what became of it.
 */

export const SNAPSHOT_POLL_MS = 5_000;

export type SnapshotDeps = {
  ownerDm: () => Promise<DMChannel>;
  claim: () => Promise<{ snapshots: DomusSnapshot[] }>;
  report: (snapshotId: string, result: DomusSnapshotResult) => Promise<unknown>;
};

/** The Owner's DM, resolved once and reused; the only destination a snapshot ever has. */
export function ownerDmOf(client: Client): () => Promise<DMChannel> {
  let dm: DMChannel | null = null;
  return async () => (dm ??= await (await client.users.fetch(config.ownerId)).createDM());
}

export async function sendSnapshot(
  snapshot: DomusSnapshot,
  ownerDm: () => Promise<DMChannel>,
): Promise<DomusSnapshotResult> {
  try {
    const dm = await ownerDm();
    const sent = await dm.send({
      content: snapshot.caption,
      files: [{ attachment: Buffer.from(snapshot.pngBase64, "base64"), name: "house.png" }],
    });
    return { status: "sent", discordMessageId: sent.id };
  } catch {
    return { status: "failed", reason: "discord_error" };
  }
}

export async function runSnapshots(deps: SnapshotDeps): Promise<number> {
  const { snapshots } = await deps.claim();
  for (const snapshot of snapshots) {
    const result = await sendSnapshot(snapshot, deps.ownerDm);
    await deps.report(snapshot.snapshotId, result).catch((error: unknown) => {
      console.warn(`[snapshot] report failed id=${snapshot.snapshotId} ${error instanceof Error ? error.name : "error"}`);
    });
  }
  return snapshots.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startSnapshotPump(client: Client): void {
  const deps: SnapshotDeps = {
    ownerDm: ownerDmOf(client),
    claim: claimDomusSnapshots,
    report: reportDomusSnapshotResult,
  };
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runSnapshots(deps);
    } catch (error) {
      console.warn(`[snapshot] tick failed ${error instanceof Error ? error.name : "error"}`);
    } finally {
      running = false;
    }
  };
  if (timer) clearInterval(timer);
  timer = setInterval(() => void tick(), SNAPSHOT_POLL_MS);
}

export function stopSnapshotPump(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
