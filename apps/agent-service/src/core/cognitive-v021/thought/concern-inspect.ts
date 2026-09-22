import type { ProjectedThoughtInput } from "./projection.js";
import type { ThoughtInput } from "../types.js";
import type { ConcernInspectDependencies } from "./source-currentness.js";

export const CONCERN_DISCOVER_DEFAULT_LIMIT = 32;
export const CONCERN_DISCOVER_MAX_LIMIT = 64;

export type ConcernInspectAuthority = Readonly<{
  refs: ReadonlySet<string>;
  expectations: ConcernInspectDependencies;
  /** Owner-private only; absent/unknown fails closed. */
  discoverAllowed?: boolean;
}>;

const EMPTY: ConcernInspectDependencies = Object.freeze({});

export function concernInspectRefsFor(
  expectations: ConcernInspectDependencies | undefined,
  discoverAllowed = false,
): ConcernInspectAuthority {
  const owned = expectations ?? EMPTY;
  return {
    refs: new Set(Object.keys(owned)),
    expectations: owned,
    discoverAllowed,
  };
}

export function concernInspectRefsForInput(
  input: ThoughtInput | ProjectedThoughtInput,
): ConcernInspectAuthority {
  const direct = (input as { concernInspectDependencies?: ConcernInspectDependencies }).concernInspectDependencies;
  return concernInspectRefsFor(direct && typeof direct === "object" ? direct : undefined, false);
}

export function isConcernDiscoverRequest(request: unknown): boolean {
  if (typeof request !== "object" || request === null || Array.isArray(request)) return false;
  const record = request as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, "discover")
    && !Object.prototype.hasOwnProperty.call(record, "concernRef");
}

export function concernDiscoverLimitOf(request: unknown): number {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    return CONCERN_DISCOVER_DEFAULT_LIMIT;
  }
  const discover = (request as Record<string, unknown>).discover;
  if (typeof discover !== "object" || discover === null || Array.isArray(discover)) {
    return CONCERN_DISCOVER_DEFAULT_LIMIT;
  }
  const limit = (discover as Record<string, unknown>).limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    return CONCERN_DISCOVER_DEFAULT_LIMIT;
  }
  return Math.min(limit, CONCERN_DISCOVER_MAX_LIMIT);
}

export function concernDiscoverCursorOf(request: unknown): string | null {
  if (typeof request !== "object" || request === null || Array.isArray(request)) return null;
  const discover = (request as Record<string, unknown>).discover;
  if (typeof discover !== "object" || discover === null || Array.isArray(discover)) return null;
  const cursor = (discover as Record<string, unknown>).cursor;
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

/** AUTHORABLE_TARGET predicate for same-cycle discover append (content-free). */
export function concernDiscoverItemAuthorable(
  item: { cognitiveStatus: string | null; quarantineKind: string | null },
): boolean {
  return item.cognitiveStatus === null
    || item.cognitiveStatus === "resolved"
    || item.quarantineKind !== null;
}
