import type { EpisodeReflection } from "../memory/episodes.js";

/** Inner-pass identity carried on an inbox payload (Growth V1 §5.1). Dependency-free. */

export type AfterglowMode = "silence" | "rolling" | "session";

/** M2: one stretch of her life in a game world (mode session): no conversation rows. */
export type AfterglowSession = { world: string; fromMs: number; throughMs: number; observationIds: string[] };

/** Host record of what one afterglow covers, carried on its inbox event. */
export type AfterglowPass = {
  kind: "afterglow";
  mode: AfterglowMode;
  rowIds: string[];
  throughSeq: number;
  session?: AfterglowSession;
};

/** What Ashley authors in an afterglow settlement. */
export type AfterglowReflection = {
  episode?: EpisodeReflection;
  threadStory?: string;
};

type Row = Record<string, unknown>;

/** The afterglow pass an inbox payload carries, if it is one. */
export function afterglowPassFromPayload(payload: unknown): AfterglowPass | null {
  if (typeof payload !== "object" || payload === null) return null;
  const pass = (payload as Row).innerPass;
  if (typeof pass !== "object" || pass === null) return null;
  const value = pass as Row;
  if (value.kind !== "afterglow") return null;
  if (!Array.isArray(value.rowIds) || !value.rowIds.every((id) => typeof id === "string")) return null;
  if (!Number.isSafeInteger(value.throughSeq)) return null;
  if (value.mode === "session") {
    const session = value.session as Row | undefined;
    if (!session || typeof session.world !== "string" || !Number.isSafeInteger(session.fromMs) || !Number.isSafeInteger(session.throughMs)
      || !Array.isArray(session.observationIds) || !session.observationIds.every((id) => typeof id === "string")) return null;
    return {
      kind: "afterglow", mode: "session", rowIds: [], throughSeq: 0,
      session: { world: session.world, fromMs: session.fromMs as number, throughMs: session.throughMs as number,
        observationIds: [...session.observationIds as string[]] },
    };
  }
  return {
    kind: "afterglow",
    mode: value.mode === "rolling" ? "rolling" : "silence",
    rowIds: [...value.rowIds as string[]],
    throughSeq: value.throughSeq as number,
  };
}


/** Host record of one AWAKE pass: which slot, and where its layering watermark stands. */
export type AwakePass = {
  kind: "awake";
  slot: number;
  /** Episodes that ended after this instant are new to this pass (layering rule 3). */
  sinceMs: number;
};

/** The AWAKE pass an inbox payload carries, if it is one. */
export function awakePassFromPayload(payload: unknown): AwakePass | null {
  if (typeof payload !== "object" || payload === null) return null;
  const pass = (payload as Row).innerPass;
  if (typeof pass !== "object" || pass === null) return null;
  const value = pass as Row;
  if (value.kind !== "awake") return null;
  if (!Number.isSafeInteger(value.slot) || !Number.isSafeInteger(value.sinceMs)) return null;
  return { kind: "awake", slot: value.slot as number, sinceMs: value.sinceMs as number };
}

/** Host record of one NIGHT pass (Growth V1 §5.4, §6.6). */
export type NightPass = {
  kind: "night";
  slot: number;
  /** The day this night closes: what happened after this instant. */
  sinceMs: number;
  /** Every seventh night is also the long arc. */
  weekly: boolean;
  weekSinceMs: number;
};

/** The NIGHT pass an inbox payload carries, if it is one. */
export function nightPassFromPayload(payload: unknown): NightPass | null {
  if (typeof payload !== "object" || payload === null) return null;
  const pass = (payload as Row).innerPass;
  if (typeof pass !== "object" || pass === null) return null;
  const value = pass as Row;
  if (value.kind !== "night") return null;
  if (!Number.isSafeInteger(value.slot) || !Number.isSafeInteger(value.sinceMs) || !Number.isSafeInteger(value.weekSinceMs)) return null;
  return {
    kind: "night",
    slot: value.slot as number,
    sinceMs: value.sinceMs as number,
    weekly: value.weekly === true,
    weekSinceMs: value.weekSinceMs as number,
  };
}
