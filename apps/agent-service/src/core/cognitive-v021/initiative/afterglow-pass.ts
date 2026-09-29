import type { EpisodeReflection } from "../memory/episodes.js";

/** Afterglow identity carried on an inbox payload (Growth V1 §5.1). Dependency-free. */

export type AfterglowMode = "silence" | "rolling";

/** Host record of what one afterglow covers, carried on its inbox event. */
export type AfterglowPass = {
  kind: "afterglow";
  mode: AfterglowMode;
  rowIds: string[];
  throughSeq: number;
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
  return {
    kind: "afterglow",
    mode: value.mode === "rolling" ? "rolling" : "silence",
    rowIds: [...value.rowIds as string[]],
    throughSeq: value.throughSeq as number,
  };
}

