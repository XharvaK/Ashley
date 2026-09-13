/**
 * Informative Discord custom status — glanceable true state, never a KPI count.
 *
 * Discord renders currentness. It does not infer currentness from lastTake age.
 */

export type PresenceCurrentActivity =
  | { state: "none" }
  | {
      state: "active";
      kind: "reading";
      id: string;
      title: string;
      startedAt?: string;
    };

export type PresenceSnapshot = {
  healthy: boolean;
  enabled: boolean;
  takesToday: number;
  presence: {
    ownTime: boolean;
    proactivePaused: boolean;
    curiosityEnabled: boolean;
    networkActivity?: string | null;
    owing: { topic: string; id: number } | null;
    currentActivity?: PresenceCurrentActivity | null;
    lastTake: {
      title: string;
      depth: "full" | "excerpt";
      createdAt: string;
      ageMin: number;
    } | null;
  } | null;
};

export type PresencePick = {
  priority: number;
  label: string;
  contentKey: string;
  discordStatus: "online" | "idle";
};

const SOFT_MAX = 56;
const TITLE_MAX = 36;

/** Strip site suffixes and shorten for the member list. */
export function snipTitle(raw: string, max = TITLE_MAX): string {
  let t = raw.trim();
  t = t.replace(/\s*[|\-–—]\s*[^|\-–—]{2,40}$/u, "").trim();
  t = t.replace(/^(the|a|an)\s+/i, "");
  if ([...t].length <= max) return t;
  const chars = [...t];
  let cut = chars.slice(0, max).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp >= 12) cut = cut.slice(0, sp);
  return `${cut.trimEnd()}…`;
}

function clampLabel(label: string): string {
  if ([...label].length <= SOFT_MAX) return label;
  const chars = [...label];
  let cut = chars.slice(0, SOFT_MAX - 1).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp >= 16) cut = cut.slice(0, sp);
  return `${cut.trimEnd()}…`;
}

/**
 * Priority ladder (first match). Pure — sticky/dwell lives in presence.ts.
 */
export function pickPresenceLabel(snap: PresenceSnapshot): PresencePick {
  if (!snap.healthy) {
    return {
      priority: 0,
      label: "brain offline",
      contentKey: "p0:offline",
      discordStatus: "idle",
    };
  }

  const p = snap.presence;
  if (p?.ownTime) {
    return {
      priority: 1,
      label: "own time",
      contentKey: "p1:owntime",
      discordStatus: "online",
    };
  }
  if (p?.proactivePaused) {
    return {
      priority: 2,
      label: "proactive paused",
      contentKey: "p2:paused",
      discordStatus: "online",
    };
  }
  // Only when heartbeat actually set a short-lived activity label.
  if (p?.networkActivity === "browsing") {
    return {
      priority: 3,
      label: "browsing",
      contentKey: "p3:browsing",
      discordStatus: "online",
    };
  }
  if ((p as any)?.researchTopic) {
    const topic = snipTitle((p as any).researchTopic, 28);
    const label = clampLabel(`researching ${topic}`);
    return {
      priority: 3,
      label,
      contentKey: `p3:researching:${topic}`,
      discordStatus: "online",
    };
  }

  const live = liveReadingPick(p?.currentActivity);
  if (live) return live;

  const curiosityOn = p?.curiosityEnabled ?? snap.enabled;
  if (curiosityOn && snap.takesToday === 0) {
    return {
      priority: 5,
      label: "feed quiet",
      contentKey: "p5:quiet",
      discordStatus: "online",
    };
  }
  if (!curiosityOn) {
    return {
      priority: 6,
      label: "curiosity off",
      contentKey: "p6:off",
      discordStatus: "online",
    };
  }

  return {
    priority: 7,
    label: "around",
    contentKey: "p7:around",
    discordStatus: "online",
  };
}

function liveReadingPick(
  activity: PresenceCurrentActivity | null | undefined,
): PresencePick | null {
  if (!activity || activity.state === "none") return null;
  switch (activity.kind) {
    case "reading": {
      const title = snipTitle(activity.title);
      return {
        priority: 4,
        label: clampLabel(`reading ${title}`),
        contentKey: `p4:reading:${activity.id}`,
        discordStatus: "online",
      };
    }
    default: {
      const _exhaustive: never = activity.kind;
      return _exhaustive;
    }
  }
}

/** Min dwell (ms) before swapping within the same priority band. */
export function minDwellMs(priority: number): number {
  if (priority <= 4) return 0;
  return 45 * 60_000;
}

/** How long a sticky label can block a weaker (higher) priority. */
export function stickyTtlMs(priority: number): number {
  if (priority <= 4) return 0;
  return 45 * 60_000;
}

export function shouldApplyPresence(
  sticky: { priority: number; contentKey: string; appliedAt: number } | null,
  candidate: PresencePick,
  now = Date.now(),
): boolean {
  if (!sticky) return true;
  if (candidate.priority < sticky.priority) return true;
  if (candidate.contentKey === sticky.contentKey) return false;
  const age = now - sticky.appliedAt;
  if (candidate.priority === sticky.priority) {
    return age >= minDwellMs(candidate.priority);
  }
  if (sticky.priority <= 4) return true;
  return age >= stickyTtlMs(sticky.priority);
}
