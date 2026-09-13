import { ActivityType, type Client } from "discord.js";
import { checkHealth, curiosityStatus } from "./agent-client.js";
import {
  pickPresenceLabel,
  shouldApplyPresence,
  type PresencePick,
} from "./chat/presence-label.js";

const REFRESH_MS = 10 * 60 * 1000;

export type DiscordPresence = {
  status: "online" | "idle";
  label: string;
};

let timer: ReturnType<typeof setInterval> | null = null;
let last: DiscordPresence = { status: "online", label: "around" };
let sticky: {
  priority: number;
  contentKey: string;
  appliedAt: number;
} | null = null;

/** Same string Discord is showing; chat uses this so she can own her status. */
export function getDiscordPresence(): DiscordPresence {
  return last;
}

function applyPick(client: Client, pick: PresencePick, now: number): void {
  last = { status: pick.discordStatus, label: pick.label };
  sticky = {
    priority: pick.priority,
    contentKey: pick.contentKey,
    appliedAt: now,
  };
  client.user?.setPresence({
    status: pick.discordStatus,
    activities: [{ name: pick.label, type: ActivityType.Custom }],
  });
}

/**
 * Informative glanceable state from real ops + curiosity facts.
 * Never a KPI count. Cute rotating filler is the same lie as a fake read.
 */
async function apply(client: Client): Promise<void> {
  const now = Date.now();
  const healthy = await checkHealth();
  if (!healthy) {
    const pick = pickPresenceLabel({
      healthy: false,
      enabled: true,
      takesToday: 0,
      presence: null,
    });
    if (shouldApplyPresence(sticky, pick, now)) {
      applyPick(client, pick, now);
    }
    return;
  }

  try {
    const status = await curiosityStatus();
    const pick = pickPresenceLabel({
      healthy: true,
      enabled: status.enabled,
      takesToday: status.takesToday,
      presence: status.presence ?? null,
    });
    if (shouldApplyPresence(sticky, pick, now)) {
      applyPick(client, pick, now);
    }
  } catch {
    // Keep last sticky label; a missing curiosity status is not worth a lie.
  }
}

export function startPresence(client: Client): void {
  void apply(client);
  timer = setInterval(() => void apply(client), REFRESH_MS);
}

export function stopPresence(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
